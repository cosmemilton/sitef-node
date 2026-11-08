import test from 'node:test';
import assert from 'node:assert/strict';
import { ClientSitef, getPartialTransaction } from '../dist/index.js';
import { FieldProcessor, functionDefinition } from '../dist/fields.js';

const configuration = { server: 'synthetic.invalid', storeId: '00000000', terminalId: 'AA000001' };
const input = { functionId: 110, amount: '0,00', fiscalDocument: '123', fiscalDate: '20261108', fiscalTime: '120000', operator: 'TEST' };
const output = (fieldType, buffer = '', extra = {}) => ({
  status: 10000, command: 0, fieldType, minLength: 0, maxLength: 20000, buffer, ...extra
});
const automation = { finalizationResponsibility: 'automation', receiptStoragePolicy: 'explicit-return' };
const context = (functionId = 110) => ({
  functionId, paymentId: 'synthetic-payment', groupId: 'synthetic-group',
  input: { ...input, functionId }, signal: new AbortController().signal,
  definition: functionDefinition(functionId)
});
const processor = (fields = {}, functionId = 110) => new FieldProcessor({
  receiptStoragePolicy: 'explicit-return', ...fields
}, context(functionId));
const pending = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
class FakeTransport {
  calls = [];
  constructor(steps) { this.steps = [...steps]; }
  async call(method, params = {}) {
    this.calls.push({ method, params: structuredClone(params) });
    if (method === 'load') return { protocolVersion: 1, platform: 'windows', architecture: 'x86_64' };
    if (method === 'configure') return { status: 0 };
    if (method === 'start') return { status: 10000 };
    if (method === 'continue') {
      if (params.continueFlag === -1) return { status: -2 };
      return this.steps.shift() ?? { status: 0 };
    }
    if (method === 'finish') return { returned: true };
    return { status: 0 };
  }
  async close() {}
}
async function setup(steps, options = {}) {
  const transport = new FakeTransport(steps);
  const client = await ClientSitef.create({
    bridgeExecutable: '/synthetic/bridge', bridgeDirectory: '/synthetic', libraryPath: '/synthetic/library',
    configuration, transportFactory: () => transport, ...options
  });
  return { client, transport };
}
const continuations = transport => transport.calls.filter(call => call.method === 'continue');
const noFinish = transport => assert.equal(transport.calls.filter(call => call.method === 'finish').length, 0);

for (const responsibility of [undefined, 'sdk', 'automation']) {
  test(`receipt observer never substitutes for immediate printing (${responsibility ?? 'default sdk'})`, async () => {
    let observed = 0;
    const fields = processor({ finalizationResponsibility: responsibility,
      hooks: { onReceipt(receipt) { observed++; assert.equal(receipt.printed, false); return true; } }
    });
    await assert.rejects(fields.process(output(121, 'SYNTHETIC IMMEDIATE RECEIPT')),
      { code: 'MISSING_FIELD_HANDLER' });
    assert.equal(observed, 1);
    assert.equal(fields.snapshot.receipts.length, 1);
    assert.equal(fields.snapshot.receipts[0].printed, false);
    assert.equal(fields.snapshot.receipts[0].buffer, 'SYNTHETIC IMMEDIATE RECEIPT');
  });
}

test('immediate receipt without observer or printer still fails explicitly and retains receipt', async () => {
  const fields = processor(automation);
  await assert.rejects(fields.process(output(121, 'SYNTHETIC RECEIPT')), { code: 'MISSING_FIELD_HANDLER' });
  assert.equal(fields.snapshot.receipts[0].printed, false);
});

for (const type of ['04', '05']) {
  test(`receipt type ${type} remains immediate even for a deferred financial function`, async () => {
    const fields = processor({ ...automation, hooks: { onReceipt() {} } }, 0);
    await fields.process(output(123, type));
    await assert.rejects(fields.process(output(122, 'SYNTHETIC RECEIPT')), { code: 'MISSING_FIELD_HANDLER' });
    assert.equal(fields.snapshot.receipts[0].timing, 'immediate');
    assert.equal(fields.snapshot.receipts[0].type, type);
    assert.equal(fields.snapshot.receipts[0].printed, false);
  });
}

test('observer receives a frozen detached copy of every receipt before existing print/store hooks', async () => {
  const order = [], observed = [];
  const fields = processor({ hooks: {
    onReceipt(receipt, receivedContext) {
      order.push(`observe:${receipt.fieldType}`);
      observed.push(receipt);
      assert.equal(receivedContext, fields.context);
      assert.equal(Object.isFrozen(receipt), true);
      assert.notEqual(receipt, fields.snapshot.receipts.at(-1));
      assert.equal(fields.snapshot.receipts.at(-1).buffer, receipt.buffer);
      assert.throws(() => { receipt.printed = true; }, TypeError);
      assert.throws(() => { receipt.buffer = 'forged'; }, TypeError);
      assert.throws(() => { receipt.bufferBase64 = 'Zm9yZ2Vk'; }, TypeError);
    },
    printReceipt(receipt) { order.push(`print:${receipt.fieldType}`); return true; },
    storeReceipt(receipt) { order.push(`store:${receipt.fieldType}`); assert.equal(receipt.printed, true); return true; }
  }, receiptStoragePolicy: 'persist' });
  for (const fieldType of [121, 122, 120, 625])
    await fields.process(output(fieldType, `SYNTHETIC ${fieldType}`, { bufferBase64: 'U1lOVEhFVElD' }));
  assert.deepEqual(order, [121, 122, 120, 625].flatMap(id => [`observe:${id}`, `print:${id}`, `store:${id}`]));
  assert.equal(fields.snapshot.receipts.every(receipt => receipt.printed), true);
  assert.equal(observed.every(receipt => !receipt.printed), true);
  assert.equal(fields.snapshot.receipts.every(receipt => receipt.bufferBase64 === 'U1lOVEhFVElD'), true);
});

for (const printResult of [false, undefined, 'true']) {
  test(`immediate printing must return literal true, not ${String(printResult)}`, async () => {
    let observed = 0;
    const fields = processor({ ...automation, hooks: {
      onReceipt() { observed++; }, printReceipt: () => printResult
    } });
    await assert.rejects(fields.process(output(121, 'SYNTHETIC RECEIPT')), { code: 'FIELD_ACTION_FAILED' });
    assert.equal(observed, 1);
    assert.equal(fields.snapshot.receipts[0].printed, false);
  });
}

test('receipt callback is awaited before printing and the next native continuation', async () => {
  const entered = pending(), release = pending(), order = [];
  const { client, transport } = await setup([output(121, 'SYNTHETIC RECEIPT'), { status: 0 }], {
    fields: { hooks: { printReceipt() { order.push('print'); return true; } } }
  });
  const tx = client.createTransaction(input, { requiresFinalization: false });
  const run = tx.process({ async receipt(receipt, { signal }) {
    assert.equal(receipt.timing, 'immediate');
    assert.equal(receipt.printed, false);
    assert.equal(signal.aborted, false);
    order.push('observe-start'); entered.resolve();
    await release.promise;
    order.push('observe-end');
  } });
  await entered.promise;
  try {
    assert.equal(continuations(transport).length, 1);
    assert.deepEqual(order, ['observe-start']);
    assert.equal(tx.state, 'running');
  } finally { release.resolve(); }
  const result = await run;
  assert.equal(result.status, 0);
  assert.deepEqual(order, ['observe-start', 'observe-end', 'print']);
  assert.equal(result.details.receipts[0].printed, true);
  assert.deepEqual(continuations(transport).map(call => call.params.continueFlag), [0, 0]);
  assert.equal(continuations(transport)[1].params.buffer, 'SYNTHETIC RECEIPT');
  noFinish(transport);
  await client.close();
});

for (const callbacks of [{}, { receipt() { return true; } }]) {
  test(`facade immediate receipt ${callbacks.receipt ? 'observer' : 'missing observer'} does not silently acknowledge printing`, async () => {
    const { client, transport } = await setup([output(121, 'SYNTHETIC RECEIPT')]);
    const tx = client.createTransaction(input, { requiresFinalization: false });
    await assert.rejects(tx.process(callbacks), error => {
      assert.equal(error.code, 'INTERACTION_FAILED');
      assert.deepEqual(error.interactionFailure, {
        stage: 'process-field', command: 0, fieldType: 121, reasonCode: 'MISSING_FIELD_HANDLER'
      });
      assert.equal(error.nativeStatus, -2);
      assert.equal(getPartialTransaction(error).status, -2);
      assert.equal(tx.partialResult.data.getLast(121).raw, 'SYNTHETIC RECEIPT');
      return true;
    });
    assert.deepEqual(continuations(transport).map(call => call.params.continueFlag), [0, -1]);
    assert.equal(client.recovery, undefined);
    noFinish(transport);
    await client.close();
  });
}

test('receipt callback failure in a financial cycle preserves repeated raw fields, bytes and unprinted receipt records', async () => {
  const cause = new Error('Synthetic delivery failure');
  let observations = 0, printed = 0, signal;
  const { client, transport } = await setup([
    output(123, '04'),
    output(121, 'FIRST SYNTHETIC RECEIPT', { bufferBase64: 'Zmlyc3Q=' }),
    output(121, 'SECOND SYNTHETIC RECEIPT', { bufferBase64: '/w==', decodingError: true })
  ], { fields: { hooks: { printReceipt() { printed++; return true; } } } });
  const tx = client.createTransaction({ ...input, functionId: 0, amount: '10,00' });
  await assert.rejects(tx.process({ async receipt(receipt, ctx) {
    signal = ctx.signal;
    observations++;
    if (observations === 2) throw cause;
  } }), error => {
    assert.equal(error.code, 'INTERACTION_FAILED');
    assert.equal(error.cause, cause);
    assert.equal(error.nativeStatus, -2);
    assert.deepEqual(error.interactionFailure, {
      stage: 'process-field', command: 0, fieldType: 121, reasonCode: 'UNCLASSIFIED_INTERACTION_ERROR'
    });
    const partial = getPartialTransaction(error);
    assert.strictEqual(partial, tx.partialResult);
    assert.equal(partial.terminalKnown, true);
    assert.equal(partial.status, -2);
    assert.deepEqual(partial.data.getAll(121).map(field => field.raw), ['FIRST SYNTHETIC RECEIPT', 'SECOND SYNTHETIC RECEIPT']);
    assert.deepEqual(partial.data.getAll(121).map(field => field.bufferBase64), ['Zmlyc3Q=', '/w==']);
    assert.equal(partial.data.getLast(121).decodingError, true);
    return true;
  });
  assert.equal(signal.aborted, true);
  assert.equal(observations, 2);
  assert.equal(printed, 1);
  assert.deepEqual(client.recovery.payments[0].receipts.map(receipt => receipt.printed), [true, false]);
  assert.deepEqual(continuations(transport).map(call => call.params.continueFlag), [0, 0, 0, -1]);
  assert.equal(transport.calls.filter(call => call.method === 'start').length, 1);
  noFinish(transport);
  await client.close();
});

test('observer failure retains the receipt snapshot before any printing or storage', async () => {
  const cause = new Error('Synthetic delivery failure');
  const fields = processor({ hooks: {
    onReceipt() { throw cause; },
    printReceipt() { assert.fail('Printing must not run after failed delivery'); },
    storeReceipt() { assert.fail('Storage must not run after failed delivery'); }
  }, receiptStoragePolicy: 'persist' });
  await assert.rejects(fields.process(output(121, 'SYNTHETIC RECEIPT', { bufferBase64: '/w==' })), error => error === cause);
  assert.equal(fields.snapshot.receipts[0].buffer, 'SYNTHETIC RECEIPT');
  assert.equal(fields.snapshot.receipts[0].bufferBase64, '/w==');
  assert.equal(fields.snapshot.receipts[0].printed, false);
});

test('facade receipt callback overrides are transaction-local and advanced operations use defaults', async () => {
  const seen = [];
  const { client, transport } = await setup([
    output(121, 'SYNTHETIC LOCAL'), { status: 0 },
    output(121, 'SYNTHETIC DEFAULT'), { status: 0 },
    output(121, 'SYNTHETIC ADVANCED'), { status: 0 }
  ], { callbacks: { receipt(receipt) { seen.push(`default:${receipt.buffer}`); } },
    fields: { hooks: { printReceipt: () => true } }
  });
  await client.createTransaction(input, { requiresFinalization: false }).process({ receipt(receipt) { seen.push(`local:${receipt.buffer}`); } });
  await client.createTransaction(input, { requiresFinalization: false }).process();
  await client.advanced.transact(input, { requiresFinalization: false });
  assert.deepEqual(seen, ['local:SYNTHETIC LOCAL', 'default:SYNTHETIC DEFAULT', 'default:SYNTHETIC ADVANCED']);
  noFinish(transport);
  await client.close();
});

test('explicit fields onReceipt takes precedence over facade callbacks without replacing other hooks', async () => {
  const seen = [];
  const { client } = await setup([output(121, 'SYNTHETIC RECEIPT'), { status: 0 }], {
    callbacks: { receipt() { assert.fail('Default callback must not replace explicit hook'); } },
    fields: { hooks: {
      onReceipt(receipt, ctx) { seen.push(['hook', receipt.buffer, ctx.functionId]); },
      printReceipt() { seen.push(['printer']); return true; }
    } }
  });
  const result = await client.createTransaction(input, { requiresFinalization: false }).process({
    receipt() { assert.fail('Local callback must not replace explicit hook'); }
  });
  assert.deepEqual(seen, [['hook', 'SYNTHETIC RECEIPT', 110], ['printer']]);
  assert.equal(result.details.receipts[0].printed, true);
  await client.close();
});

test('deferred receipts keep optional delivery and never invoke printer during processing', async () => {
  for (const withCallback of [false, true]) {
    let observed = 0;
    const { client, transport } = await setup([output(121, 'SYNTHETIC DEFERRED'), { status: 0 }], {
      fields: { hooks: { printReceipt() { assert.fail('Deferred printing is not part of processing'); } } }
    });
    const result = await client.createTransaction({ ...input, functionId: 0, amount: '10,00' }).process(withCallback ? {
      receipt(receipt) { observed++; assert.equal(receipt.timing, 'deferred'); }
    } : {});
    assert.equal(observed, withCallback ? 1 : 0);
    assert.equal(result.details.receipts[0].printed, false);
    assert.equal(result.requiresFinalization, true);
    noFinish(transport);
    await client.close();
  }
});

for (const timing of ['immediate', 'deferred']) {
  for (const cancellation of ['transaction', 'external signal']) {
    test(`${cancellation} cancellation releases a hanging ${timing} receipt observer`, { timeout: 2000 }, async () => {
      const entered = pending(), controller = new AbortController();
      const { client, transport } = await setup([
        output(121, 'SYNTHETIC CANCELED RECEIPT', { bufferBase64: '/w==', decodingError: true })
      ], { fields: { receiptStoragePolicy: 'persist', hooks: {
        printReceipt() { assert.fail('Canceled observation must not start printing'); },
        storeReceipt() { assert.fail('Canceled observation must not start storage'); }
      } } });
      const tx = client.createTransaction(timing === 'immediate' ? input : { ...input, functionId: 0, amount: '10,00' }, {
        requiresFinalization: timing !== 'immediate', signal: controller.signal
      });
      let observerSignal;
      const run = tx.process({ receipt(receipt, { signal }) {
        observerSignal = signal;
        entered.resolve();
        return new Promise(() => {});
      } });
      await entered.promise;
      assert.equal(continuations(transport).length, 1);
      if (cancellation === 'transaction') tx.cancel();
      else controller.abort();
      const result = await run;
      assert.equal(observerSignal.aborted, true);
      assert.equal(result.status, -2);
      assert.equal(result.data.getLast(121).raw, 'SYNTHETIC CANCELED RECEIPT');
      assert.equal(result.data.getLast(121).bufferBase64, '/w==');
      assert.equal(result.data.getLast(121).decodingError, true);
      assert.equal(result.details.receipts[0].printed, false);
      assert.equal(result.details.receipts[0].timing, timing);
      assert.deepEqual(continuations(transport).map(call => call.params.continueFlag), [0, -1]);
      assert.equal(transport.calls.filter(call => call.method === 'start').length, 1);
      noFinish(transport);
      await client.close();
    });
  }
}

test('synchronous observer cancellation returns native cancellation without printing or storage', async () => {
  const { client, transport } = await setup([output(121, 'SYNTHETIC RECEIPT')], {
    fields: { receiptStoragePolicy: 'persist', hooks: {
      printReceipt() { assert.fail('Synchronous cancellation must prevent printing'); },
      storeReceipt() { assert.fail('Synchronous cancellation must prevent storage'); }
    } }
  });
  const tx = client.createTransaction(input, { requiresFinalization: false });
  const result = await tx.process({ receipt() { tx.cancel(); } });
  assert.equal(result.status, -2);
  assert.equal(result.details.receipts[0].printed, false);
  assert.deepEqual(continuations(transport).map(call => call.params.continueFlag), [0, -1]);
  assert.equal(tx.partialResult, undefined);
  noFinish(transport);
  await client.close();
});

for (const alreadyAborted of [true, false]) {
  test(`cancellation ${alreadyAborted ? 'before processing' : 'before observer entry'} skips all receipt hooks`, async () => {
    const controller = new AbortController();
    const fields = new FieldProcessor({ receiptStoragePolicy: 'persist', hooks: {
      onReceipt() { assert.fail('Canceled receipt observation must not start'); },
      printReceipt() { assert.fail('Canceled receipt printing must not start'); },
      storeReceipt() { assert.fail('Canceled receipt storage must not start'); }
    } }, { ...context(), signal: controller.signal });
    if (alreadyAborted) controller.abort();
    const run = fields.process(output(121, 'SYNTHETIC RECEIPT'));
    controller.abort();
    const request = await run;
    assert.equal(request.fieldType, 121);
    assert.equal(request.buffer, 'SYNTHETIC RECEIPT');
    assert.equal(fields.snapshot.receipts[0].buffer, 'SYNTHETIC RECEIPT');
    assert.equal(fields.snapshot.receipts[0].printed, false);
  });
}

for (const lateOutcome of ['resolve', 'reject']) {
  test(`late observer ${lateOutcome} after cancellation never resumes printing or native continuation`, { timeout: 2000 }, async () => {
    const entered = pending();
    let finishObserver;
    const { client, transport } = await setup([output(121, 'SYNTHETIC RECEIPT')], {
      fields: { receiptStoragePolicy: 'persist', hooks: {
        printReceipt() { assert.fail('Late observer completion must not start printing'); },
        storeReceipt() { assert.fail('Late observer completion must not start storage'); }
      } }
    });
    const tx = client.createTransaction(input, { requiresFinalization: false });
    const run = tx.process({ receipt() {
      return new Promise((resolve, reject) => {
        finishObserver = lateOutcome === 'resolve' ? resolve : () => reject(new Error('Synthetic late rejection'));
        entered.resolve();
      });
    } });
    await entered.promise;
    tx.cancel();
    const result = await run;
    assert.equal(result.status, -2);
    const callsBeforeLateOutcome = transport.calls.length;
    finishObserver();
    // The test runner also fails on an unhandled rejection after this abort race.
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(transport.calls.length, callsBeforeLateOutcome);
    assert.equal(result.details.receipts[0].printed, false);
    assert.deepEqual(continuations(transport).map(call => call.params.continueFlag), [0, -1]);
    noFinish(transport);
    await client.close();
  });
}
