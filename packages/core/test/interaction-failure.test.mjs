import test from 'node:test';
import assert from 'node:assert/strict';
import { SitefClient, SitefError, sanitizeInteractionFailure } from '../dist/index.js';

const configuration = { server: '127.0.0.1', storeId: '00000000', terminalId: 'AA123456' };
const input = { functionId: 0, amount: '10,00', fiscalDocument: '123456', fiscalDate: '20261107', fiscalTime: '120000', operator: 'DEV' };
const exchange = (command, fieldType = -1) => ({ status: 10000, command, fieldType, minLength: 0, maxLength: 20, buffer: '' });
async function setup(steps, options = {}) {
  const calls = [], records = [];
  let record;
  const transport = {
    async call(method, params = {}) {
      calls.push({ method, params });
      if (method === 'configure') return { status: 0 };
      if (method === 'start') return { status: 10000 };
      if (method === 'continue') return params.continueFlag === -1 ? { status: -2 } : (steps.shift() ?? { status: -2 });
      if (method === 'finish') return { returned: true };
      return {};
    },
    async close() {}
  };
  const journal = {
    async acquire() {}, async release() {}, async read() { return record; },
    async write(value) { record = structuredClone(value); records.push(record); }
  };
  const client = await SitefClient.connect({ transport, journal, configuration, interaction: async () => ({}), fields: { receiptStoragePolicy: 'explicit-return' }, ...options });
  return { client, calls, records };
}
async function failure(client) {
  try { await client.transact(input); }
  catch (error) { assert.equal(error.code, 'INTERACTION_FAILED'); return error; }
  assert.fail('Expected interaction failure');
}

for (const fieldType of [5042, 5043]) {
  test(`missing pinpad hook ${fieldType} has safe context before onExchange`, async () => {
    let seen = 0;
    const { client, calls, records } = await setup([exchange(0, fieldType)], { onExchange: () => { seen++; } });
    const error = await failure(client);
    assert.deepEqual(error.interactionFailure, { stage: 'process-field', command: 0, fieldType, reasonCode: 'MISSING_FIELD_HANDLER' });
    assert.equal(error.nativeStatus, -2);
    assert.equal(error.cause.code, 'MISSING_FIELD_HANDLER');
    assert.equal(seen, 0);
    assert.equal(client.state, 'idle');
    assert.equal(records.at(-1).payments[0].state, 'ended');
    assert.deepEqual(records.at(-1).payments[0].assessmentIssues, ['INTERACTION_FAILED']);
    assert.equal(JSON.stringify(records).includes('interactionFailure'), false);
    assert.deepEqual(calls.filter(call => call.method === 'continue').map(call => call.params.continueFlag), [0, -1]);
    await client.close();
  });
}

test('hook-backed pinpad events proceed without collecting a password in the CLI', async () => {
  const seen = [], hooks = [];
  const { client } = await setup([exchange(0, 5042), exchange(0, 5018), exchange(0, 5051), exchange(0, 5043)], {
    onExchange: request => seen.push(request.fieldType),
    interaction: () => assert.fail('Pinpad events are not operator input'),
    fields: { hooks: { lockResources: () => { hooks.push('lock'); return true; }, unlockResources: () => { hooks.push('unlock'); return true; } } }
  });
  assert.equal((await client.transact(input)).status, -2);
  assert.deepEqual(seen, [5042, 5018, 5051, 5043]);
  assert.deepEqual(hooks, ['lock', 'unlock']);
  await client.close();
});

test('observer and interaction failures retain the precise stage without messages', async () => {
  for (const stage of ['on-exchange', 'interaction']) {
    const cause = Object.assign(new Error('synthetic private callback content'), { code: 'UNTRUSTED_CUSTOM_CODE' });
    const { client } = await setup([exchange(1, -1)], stage === 'on-exchange'
      ? { onExchange: () => { throw cause; } }
      : { interaction: () => { throw cause; } });
    const error = await failure(client);
    assert.deepEqual(error.interactionFailure, { stage, command: 1, fieldType: -1, reasonCode: 'UNCLASSIFIED_INTERACTION_ERROR' });
    assert.equal(error.cause, cause);
    assert.equal(JSON.stringify(error.interactionFailure).includes('private'), false);
    await client.close();
  }
});

test('response validation failure identifies command and field', async () => {
  const { client } = await setup([exchange(20, -1)], { interaction: async () => ({ buffer: 'invalid' }) });
  const error = await failure(client);
  assert.deepEqual(error.interactionFailure, { stage: 'validate-response', command: 20, fieldType: -1, reasonCode: 'INVALID_CONFIRMATION' });
  await client.close();
});

test('cleanup and finish failures do not misleadingly name the last native field', async () => {
  for (const stage of ['cleanup', 'finish']) {
    const { client } = await setup(stage === 'cleanup' ? [exchange(0, 5042)] : [], {
      fields: { hooks: stage === 'cleanup'
        ? { lockResources: () => true, unlockResources: () => false }
        : { resolveConfirmationNetwork: () => { throw new Error('synthetic private details'); } } }
    });
    const error = await failure(client);
    assert.deepEqual(error.interactionFailure, { stage, reasonCode: stage === 'cleanup' ? 'FIELD_ACTION_FAILED' : 'UNCLASSIFIED_INTERACTION_ERROR' });
    await client.close();
  }
});

test('first interaction failure is preserved when cleanup also fails', async () => {
  const cause = new SitefError('CLI_UNSUPPORTED_COMMAND', 'synthetic private callback content');
  const { client } = await setup([exchange(0, 5042), exchange(999, 98765)], {
    interaction: () => { throw cause; },
    fields: { hooks: { lockResources: () => true, unlockResources: () => false } }
  });
  const error = await failure(client);
  assert.equal(error.cause, cause);
  assert.deepEqual(error.interactionFailure, { stage: 'interaction', command: 999, fieldType: 98765, reasonCode: 'CLI_UNSUPPORTED_COMMAND' });
  await client.close();
});

test('asynchronous command 23 rejection keeps its own envelope and first cause', async () => {
  let rejectPoll;
  const cause = new SitefError('CLI_PINPAD_BUSY', 'synthetic private polling error');
  const later = new Error('synthetic later observer error');
  const { client } = await setup([exchange(23, 5018), exchange(1, 99999)], {
    onExchange: async request => {
      if (request.command === 23) return new Promise((_, reject) => { rejectPoll = reject; });
      rejectPoll(cause);
      await new Promise(resolve => setImmediate(resolve));
      throw later;
    }
  });
  const error = await failure(client);
  assert.equal(error.cause, cause);
  assert.deepEqual(error.interactionFailure, { stage: 'on-exchange', command: 23, fieldType: 5018, reasonCode: 'CLI_PINPAD_BUSY' });
  await client.close();
});

test('synchronous command 23 rejection has on-exchange stage', async () => {
  const { client } = await setup([exchange(23, 5001)], { onExchange: () => { throw new Error('synthetic polling error'); } });
  const error = await failure(client);
  assert.deepEqual(error.interactionFailure, { stage: 'on-exchange', command: 23, fieldType: 5001, reasonCode: 'UNCLASSIFIED_INTERACTION_ERROR' });
  await client.close();
});

test('throwing undefined is still a failed interaction and triggers cancellation', async () => {
  const { client, calls } = await setup([exchange(1)], { interaction: () => { throw undefined; } });
  const error = await failure(client);
  assert.equal(error.interactionFailure.stage, 'interaction');
  assert.equal(calls.filter(call => call.method === 'continue').at(-1).params.continueFlag, -1);
  await client.close();
});

test('diagnostic sanitizer accepts only fixed stages, codes and int32 metadata', () => {
  const safe = sanitizeInteractionFailure({ stage: 'interaction', command: 41, fieldType: 99999, reasonCode: 'CLI_NATIVE_DECODING_FAILED', buffer: 'synthetic private data', cause: new Error('synthetic'), message: 'synthetic' });
  assert.deepEqual(safe, { stage: 'interaction', command: 41, fieldType: 99999, reasonCode: 'CLI_NATIVE_DECODING_FAILED' });
  assert.ok(Object.isFrozen(safe));
  assert.deepEqual(sanitizeInteractionFailure({ stage: 'finish', command: '41', fieldType: 2147483648, reasonCode: 'UNTRUSTED_CUSTOM_CODE' }), { stage: 'finish', reasonCode: 'UNCLASSIFIED_INTERACTION_ERROR' });
  assert.equal(sanitizeInteractionFailure({ stage: 'untrusted stage' }), undefined);
  assert.equal(sanitizeInteractionFailure(null), undefined);
  let getters = 0;
  assert.equal(sanitizeInteractionFailure({ get stage() { getters++; return 'interaction'; } }), undefined);
  assert.equal(getters, 0);
  assert.equal(sanitizeInteractionFailure(new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('synthetic'); } })), undefined);
  const error = new SitefError('INTERACTION_FAILED', 'safe', { interactionFailure: { stage: 'interaction', command: 41, fieldType: -1, reasonCode: 'UNTRUSTED_CUSTOM_CODE', buffer: 'synthetic private data' } });
  assert.deepEqual(error.interactionFailure, { stage: 'interaction', command: 41, fieldType: -1, reasonCode: 'UNCLASSIFIED_INTERACTION_ERROR' });
});

test('hostile thrown error metadata cannot turn a known cancellation into uncertain', async () => {
  for (const handler of [
    { getOwnPropertyDescriptor() { throw new Error('synthetic descriptor failure'); } },
    { getPrototypeOf() { throw new Error('synthetic prototype failure'); } }
  ]) {
    const cause = new Proxy(new SitefError('CLI_PINPAD_BUSY', 'synthetic'), handler);
    const { client } = await setup([exchange(1)], { interaction: () => { throw cause; } });
    const error = await failure(client);
    assert.equal(error.cause, cause);
    assert.equal(error.nativeStatus, -2);
    assert.equal(client.state, 'idle');
    assert.deepEqual(error.interactionFailure, { stage: 'interaction', command: 1, fieldType: -1, reasonCode: 'UNCLASSIFIED_INTERACTION_ERROR' });
    await client.close();
  }
});
