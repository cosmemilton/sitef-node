import test from 'node:test';
import assert from 'node:assert/strict';
import { SitefClient, SitefError, getPartialTransaction } from '../dist/index.js';

const configuration = { server: '127.0.0.1', storeId: '00000000', terminalId: 'AA000001' };
const input = { functionId: 0, amount: '10,00', fiscalDocument: '100', fiscalDate: '20261107', fiscalTime: '120000', operator: 'TEST' };
const output = (fieldType, buffer) => ({ status: 10000, command: 0, fieldType, buffer, minLength: 0, maxLength: 100 });
class Transport {
  calls = [];
  closed = false;
  cycles = [];
  steps = [];
  fail;
  hold;
  constructor(cycles = []) { this.cycles = cycles; }
  async call(method, params = {}) {
    this.calls.push({ method, params });
    if (this.fail === method) throw new SitefError('BRIDGE_TIMEOUT', 'synthetic timeout', { uncertain: true });
    if (this.hold?.method === method) return this.hold.promise;
    if (method === 'configure') return { status: 0 };
    if (method === 'start') { this.steps = [...(this.cycles.shift() ?? [{ status: 0 }])]; return { status: 10000 }; }
    if (method === 'continue') return this.steps.shift() ?? { status: 0 };
    if (method === 'finish') return { returned: true };
    return { status: 0 };
  }
  async close() { this.closed = true; }
}
async function setup(options = {}, cycles = []) {
  const transport = new Transport(cycles);
  const client = await SitefClient.connect({ configuration, transport, interaction: async () => ({}), ...options });
  return { client, transport };
}
const finishes = (transport) => transport.calls.filter((c) => c.method === 'finish');
const starts = (transport) => transport.calls.filter((c) => c.method === 'start');

test('no journal required: a pending coupon does not block another and scoped finish preserves the first', async () => {
  const { client, transport } = await setup();
  const first = await client.transact(input);
  const second = await client.transact({ ...input, fiscalDocument: '200' });
  assert.equal(first.requiresFinalization, true);
  assert.equal(second.requiresFinalization, true);
  assert.equal(client.recovery.payments.length, 2);
  await assert.rejects(client.finalize(true), { code: 'FINALIZATION_SCOPE_REQUIRED' });
  assert.equal(finishes(transport).length, 0);
  assert.deepEqual((await client.finalizeTransaction(true, second.transactionId)).payments, [second.transactionId]);
  assert.equal(finishes(transport)[0].params.fiscalDocument, '200');
  assert.equal(client.recovery.payments.find((p) => p.id === first.transactionId).state, 'awaiting-finalization');
  await client.close();
  assert.equal(finishes(transport).length, 1);
  assert.equal(client.state, 'closed');
  assert.equal(client.recovery.payments.length, 2);
});

test('different dates also require explicit fiscal selection', async () => {
  const { client, transport } = await setup();
  const first = await client.transact(input);
  const second = await client.transact({ ...input, fiscalDate: '20261108' });
  await assert.rejects(client.finalize(false), { code: 'FINALIZATION_SCOPE_REQUIRED' });
  assert.deepEqual((await client.finalizeFiscal(false, { fiscalDocument: '100', fiscalDate: '20261108' })).payments, [second.transactionId]);
  assert.equal(finishes(transport)[0].params.fiscalDate, '20261108');
  assert.equal(client.recovery.payments.find((p) => p.id === first.transactionId).state, 'awaiting-finalization');
  await client.close();
});

test('same coupon without index cannot widen transaction selection; explicit fiscal selection can', async () => {
  const { client, transport } = await setup();
  const first = await client.transact(input);
  const second = await client.transact(input);
  await assert.rejects(client.finalizeTransaction(false, second.transactionId), { code: 'PAYMENT_INDEX_REQUIRED' });
  assert.equal(finishes(transport).length, 0);
  assert.deepEqual((await client.finalizeFiscal(false, input)).payments, [first.transactionId, second.transactionId]);
  assert.equal(finishes(transport).length, 1);
  await client.close();
});

test('transaction index selects exactly one payment in a shared coupon', async () => {
  const { client, transport } = await setup({}, [
    [output(161, '1'), { status: 0 }], [output(161, '2'), { status: 0 }]
  ]);
  const first = await client.transact(input);
  const second = await client.transact(input);
  await client.finalizeTransaction(false, second.transactionId, '{Extension=1}');
  assert.equal(finishes(transport)[0].params.additionalParameters, '{NumeroPagamentoCupom=2}{Extension=1}');
  assert.equal(client.recovery.payments.find((p) => p.id === first.transactionId).state, 'awaiting-finalization');
  await client.close();
});

test('previous receipt processors survive another transaction and finalize only with their original payment', async () => {
  const printed = [];
  const { client } = await setup({ fields: { hooks: {
    storeReceipt: async () => true,
    printReceipt: async (receipt, context) => { printed.push({ buffer: receipt.buffer, id: context.paymentId }); return true; }
  } } }, [[output(121, 'FIRST RECEIPT'), { status: 0 }], [output(121, 'SECOND RECEIPT'), { status: 0 }]]);
  const first = await client.transact(input);
  const second = await client.transact({ ...input, fiscalDocument: '200' });
  await client.finalizeTransaction(true, second.transactionId);
  assert.deepEqual(printed, [{ buffer: 'SECOND RECEIPT', id: second.transactionId }]);
  await client.finalizeTransaction(true, first.transactionId);
  assert.deepEqual(printed[1], { buffer: 'FIRST RECEIPT', id: first.transactionId });
  await client.close();
});

test('automation can persist, restore and mutate isolated snapshots without a Journal', async () => {
  const snapshots = [];
  const { client } = await setup({ onStateChange: async (state) => { snapshots.push(structuredClone(state)); state.payments[0].state = 'ended'; } });
  const first = await client.transact(input);
  assert.equal(client.recovery.payments[0].state, 'awaiting-finalization');
  const saved = snapshots.at(-1);
  await client.close();
  const { client: next, transport } = await setup({ initialState: saved });
  saved.payments[0].state = 'ended';
  const second = await next.transact({ ...input, fiscalDocument: '200' });
  await next.finalizeTransaction(false, second.transactionId);
  assert.equal(next.recovery.payments.find((p) => p.id === first.transactionId).state, 'awaiting-finalization');
  await next.finalizeTransaction(false, first.transactionId);
  assert.equal(finishes(transport).length, 2);
  await next.close();
});

test('restored uncertain transaction does not block a new independent coupon', async () => {
  const { client: original, transport: originalTransport } = await setup();
  originalTransport.fail = 'continue';
  await assert.rejects(original.transact(input), { code: 'TRANSACTION_UNCERTAIN' });
  const saved = original.recovery;
  await original.close();
  const { client, transport } = await setup({ initialState: saved });
  const second = await client.transact({ ...input, fiscalDocument: '200' });
  assert.equal(client.state, 'uncertain');
  await client.finalizeTransaction(false, second.transactionId);
  assert.equal(client.recovery.payments[0].state, 'uncertain');
  await client.finalizeRecovery(false, saved.id, undefined, { transactionId: saved.payments[0].id });
  assert.equal(finishes(transport).length, 2);
  await client.close();
});

test('callback failure before native entry does not start a transaction', async () => {
  const { client, transport } = await setup({ onStateChange: async () => { throw new Error('storage unavailable'); } });
  await assert.rejects(client.transact(input), (error) => {
    assert.equal(getPartialTransaction(error).started, false);
    return true;
  });
  assert.equal(starts(transport).length, 0);
  assert.equal(client.recovery, undefined);
  assert.equal(client.state, 'idle');
  await client.close();
});

test('callback failure after native terminal status retains the partial result and does not finalize', async () => {
  const { client, transport } = await setup({ onStateChange: async (state) => {
    if (state.state === 'awaiting-finalization') throw new Error('storage unavailable');
  } }, [[output(99999, 'original'), { status: 0 }]]);
  await assert.rejects(client.transact(input), (error) => {
    assert.equal(error.code, 'JOURNAL_UNCERTAIN');
    const partial = getPartialTransaction(error);
    assert.equal(partial.status, 0);
    assert.equal(partial.terminalKnown, true);
    assert.equal(partial.requiresRecovery, true);
    return true;
  });
  assert.equal(starts(transport).length, 1);
  assert.equal(finishes(transport).length, 0);
  assert.equal(client.recovery.payments[0].status, 0);
  await client.close();
});

test('a native timeout poisons the connection and never repeats, queries or finalizes automatically', async () => {
  const { client, transport } = await setup();
  transport.fail = 'continue';
  await assert.rejects(client.transact(input), { code: 'TRANSACTION_UNCERTAIN' });
  const count = transport.calls.length;
  transport.fail = undefined;
  await assert.rejects(client.transact({ ...input, fiscalDocument: '200' }), { code: 'RECONNECT_REQUIRED' });
  await assert.rejects(client.queryPendingTransactions(), { code: 'RECONNECT_REQUIRED' });
  await assert.rejects(client.finalizeRecovery(false, client.recovery.id), { code: 'RECONNECT_REQUIRED' });
  await assert.rejects(client.capabilities(), { code: 'RECONNECT_REQUIRED' });
  assert.equal(transport.calls.length, count);
  await client.close();
  assert.equal(finishes(transport).length, 0);
});

test('a nonfinancial query timeout also blocks further native operations', async () => {
  const { client, transport } = await setup();
  transport.fail = 'continue';
  await assert.rejects(client.queryPendingTransactions());
  assert.equal(client.state, 'uncertain');
  await assert.rejects(client.transact(input), { code: 'RECONNECT_REQUIRED' });
  assert.equal(starts(transport).length, 1);
  await client.close();
});

test('unknown positive and negative native codes remain results without synthetic finalization', async () => {
  for (const status of [987654, -987654]) {
    const { client, transport } = await setup({}, [[output(99998, 'original'), { status }]]);
    const result = await client.transact(input);
    assert.equal(result.status, status);
    assert.equal(result.requiresFinalization, false);
    assert.equal(result.fields[0].buffer, 'original');
    assert.equal(finishes(transport).length, 0);
    await client.close();
  }
});

test('a pending result does not block query 130/131 and queries preserve all local records', async () => {
  const query = [output(210, '1'), output(160, '100'), output(161, '1'), output(163, '20261107'), output(164, '120000'), output(211, '0'), output(1319, '10,00'), { status: 0 }];
  const { client, transport } = await setup({}, [[{ status: 0 }], query, query]);
  const result = await client.transact(input);
  for (const options of [{}, { fiscalDocument: '100', fiscalDate: '20261107' }]) {
    const pending = await client.queryPendingTransactions(options);
    assert.equal(pending.count, 1);
    assert.equal(pending.transactions[0].amount, '10,00');
    assert.equal(client.recovery.payments[0].id, result.transactionId);
    assert.equal(client.recovery.payments[0].state, 'awaiting-finalization');
  }
  assert.deepEqual(starts(transport).map((c) => c.params.functionId), [0, 130, 131]);
  await client.close();
});

test('operation lock blocks concurrent work during both native and persistence callbacks', async () => {
  let release, entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  const hold = new Promise((resolve) => { release = resolve; });
  const { client, transport } = await setup({ onStateChange: async (state) => {
    if (state.state === 'started') { entered(); await hold; }
  } });
  const result = client.transact(input);
  await ready;
  await assert.rejects(client.transact(input), { code: 'SESSION_BUSY' });
  await assert.rejects(client.queryPendingTransactions(), { code: 'SESSION_BUSY' });
  await assert.rejects(client.close(), { code: 'SESSION_BUSY' });
  assert.equal(starts(transport).length, 0);
  release();
  await result;
  await client.close();
});

test('uncertain finalization plan survives explicit close/reconnect with no automatic retry', async () => {
  const { client, transport } = await setup();
  const first = await client.transact(input);
  await client.transact({ ...input, fiscalDocument: '200' });
  transport.fail = 'finish';
  await assert.rejects(client.finalizeTransaction(false, first.transactionId), { code: 'FINALIZATION_UNCERTAIN' });
  assert.equal(finishes(transport).length, 1);
  const saved = client.recovery;
  await assert.rejects(client.finalizeRecovery(false, saved.id, undefined, { transactionId: first.transactionId }), { code: 'RECONNECT_REQUIRED' });
  await client.close();
  const { client: next, transport: nextTransport } = await setup({ initialState: saved });
  assert.equal(finishes(nextTransport).length, 0);
  await assert.rejects(next.finalizeRecovery(false, saved.id), { code: 'FINALIZATION_SCOPE_REQUIRED' });
  await assert.rejects(next.finalizeRecovery(true, saved.id, undefined, { transactionId: first.transactionId }), { code: 'RECOVERY_DECISION_MISMATCH' });
  await next.finalizeRecovery(false, saved.id, undefined, { transactionId: first.transactionId });
  assert.equal(finishes(nextTransport).length, 1);
  assert.equal(finishes(nextTransport)[0].params.fiscalDocument, '100');
  assert.equal(next.recovery.payments[1].state, 'awaiting-finalization');
  await next.close();
});


test('recorded fiscal, network and NFPAG plans never capture a later sibling silently', async () => {
  for (const parameters of ['', '{RedeConfirmacao=9}', '{NumeroPagamentoNFPAG=1}']) {
    const { client: original } = await setup({}, [
      [output(161, '1'), output(158, '9'), { status: 0 }],
      [output(161, '2'), output(158, '9'), { status: 0 }]
    ]);
    const first = await original.transact(input);
    const second = await original.transact(input);
    const saved = original.recovery;
    await original.close();
    const old = saved.payments[0];
    old.state = 'uncertain'; old.decision = 0; old.finalizationParameters = parameters;
    saved.state = 'uncertain';
    const { client, transport } = await setup({ initialState: saved });
    await assert.rejects(client.finalizeRecovery(false, saved.id, undefined, { transactionId: first.transactionId }), { code: 'RECOVERY_SCOPE_MISMATCH' });
    assert.equal(finishes(transport).length, 0);
    assert.equal(client.recovery.payments[1].state, 'awaiting-finalization');
    assert.equal(client.recovery.payments[0].finalizationParameters, parameters);
    await client.finalizeTransaction(false, second.transactionId);
    await client.finalizeRecovery(false, saved.id, undefined, { transactionId: first.transactionId });
    assert.equal(finishes(transport).length, 2);
    await client.close();
  }
});

test('a native call still in flight excludes a new sale, query, finalization and close', async () => {
  const { client, transport } = await setup();
  let release;
  transport.hold = { method: 'continue', promise: new Promise((resolve) => { release = resolve; }) };
  const result = client.transact(input);
  while (!transport.calls.some((c) => c.method === 'continue')) await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(client.transact({ ...input, fiscalDocument: '200' }), { code: 'SESSION_BUSY' });
  await assert.rejects(client.queryPendingTransactions(), { code: 'SESSION_BUSY' });
  await assert.rejects(client.finalize(false), { code: 'INVALID_STATE' });
  await assert.rejects(client.capabilities(), { code: 'SESSION_BUSY' });
  await assert.rejects(client.close(), { code: 'SESSION_BUSY' });
  release({ status: 0 });
  await result;
  await client.close();
  assert.equal(starts(transport).length, 1);
});

test('closing a pending connection holds the lock without finalization until transport closure returns', async () => {
  const { client, transport } = await setup();
  await client.transact(input);
  let release;
  transport.close = () => new Promise((resolve) => { release = resolve; });
  const closing = client.close();
  await assert.rejects(client.transact(input), { code: 'SESSION_BUSY' });
  release();
  await closing;
  assert.equal(client.state, 'closed');
  assert.equal(finishes(transport).length, 0);
});


test('an unresolved sibling index prevents a selector from claiming it only affects the selected local record', async () => {
  const { client, transport } = await setup({}, [[{ status: 0 }], [output(161, '2'), { status: 0 }]]);
  const first = await client.transact(input);
  const second = await client.transact(input);
  await assert.rejects(client.finalizeTransaction(false, second.transactionId), { code: 'RECOVERY_SCOPE_MISMATCH' });
  assert.equal(finishes(transport).length, 0);
  assert.equal(client.recovery.payments.find((p) => p.id === first.transactionId).state, 'awaiting-finalization');
  await client.close();
});


test('pre-start persistence failure restores the original pending records and aggregate exactly', async () => {
  let fail = false;
  const { client, transport } = await setup({ onStateChange: async () => { if (fail) throw new Error('storage'); } });
  await client.transact(input);
  const before = client.recovery;
  fail = true;
  await assert.rejects(client.transact({ ...input, fiscalDocument: '200' }));
  assert.deepEqual(client.recovery, before);
  assert.equal(starts(transport).length, 1);
  assert.equal(client.state, 'awaiting-finalization');
  await client.close();
});

test('a snapshot with more than 10000 records restores without losing an old pending transaction', async () => {
  const { client, transport } = await setup();
  const first = await client.transact(input);
  const originalCall = transport.call.bind(transport);
  transport.call = (method, params) => method === 'start' ? Promise.resolve({ status: -2 }) : originalCall(method, params);
  for (let index = 0; index < 10000; index++)
    await client.transact({ ...input, fiscalDocument: String(200 + index) });
  const saved = client.recovery;
  assert.equal(saved.payments.length, 10001);
  assert.equal(saved.payments[0].id, first.transactionId);
  assert.equal(saved.payments[0].state, 'awaiting-finalization');
  await client.close();
  const { client: restored } = await setup({ initialState: saved });
  assert.equal(restored.recovery.payments.length, 10001);
  assert.equal(restored.recovery.payments[0].state, 'awaiting-finalization');
  await restored.close();
});


test('abort or cancel while the started snapshot is being persisted never enters the native transaction', async () => {
  for (const mode of ['signal', 'cancel']) {
    let release, entered;
    const ready = new Promise((resolve) => { entered = resolve; });
    const hold = new Promise((resolve) => { release = resolve; });
    const controller = new AbortController();
    const external = [];
    const { client, transport } = await setup({ onStateChange: async (state) => {
      external.push(state); entered(); await hold;
    } });
    const promise = client.transact(input, { signal: controller.signal });
    await ready;
    if (mode === 'signal') controller.abort(); else client.cancel();
    release();
    await assert.rejects(promise, (error) => {
      assert.equal(error.code, 'ABORTED');
      assert.equal(getPartialTransaction(error).started, false);
      assert.equal(getPartialTransaction(error).requiresRecovery, false);
      return true;
    });
    assert.equal(starts(transport).length, 0);
    assert.equal(finishes(transport).length, 0);
    assert.equal(client.recovery.payments[0].state, 'ended');
    assert.equal(client.recovery.payments[0].status, undefined);
    assert.deepEqual(client.recovery.payments[0].assessmentIssues, ['ABORTED_BEFORE_START']);
    assert.equal(client.state, 'idle');
    assert.equal(external.length, 2);
    assert.equal(external[0].payments[0].state, 'started');
    assert.equal(external[1].payments[0].state, 'ended');
    assert.equal(external[1].payments[0].status, undefined);
    assert.deepEqual(external[1], client.recovery);
    const { client: restored } = await setup({ initialState: external[1] });
    assert.equal(restored.state, 'idle');
    await restored.close();
    await client.close();
  }
});


test('initialState never migrates embedded legacy NFPAG or invokes persistence hooks implicitly', async () => {
  const { client: original } = await setup();
  await original.transact(input);
  const saved = original.recovery;
  await original.close();
  saved.payments[0].state = 'uncertain';
  saved.payments[0].decision = 0;
  saved.payments[0].finalizationParameters = '{NumeroPagamentoNFPAG=1}{NFPAG=legacy-private-payload}';
  const before = structuredClone(saved);
  let stores = 0, saves = 0;
  const transport = new Transport();
  await assert.rejects(SitefClient.connect({
    configuration, transport, initialState: saved, interaction: async () => ({}),
    onStateChange: async () => { saves++; },
    fields: { hooks: { storeFinalizationPayload: async () => { stores++; return true; } } }
  }), { code: 'LEGACY_PAYLOAD_MIGRATION_REQUIRED' });
  assert.equal(stores, 0);
  assert.equal(saves, 0);
  assert.deepEqual(saved, before);
  assert.equal(starts(transport).length, 0);
  assert.equal(finishes(transport).length, 0);
  assert.equal(transport.closed, true);
});


test('cancellation waits for barcode validation before sending the next native abort continuation', async () => {
  let releaseBarcode, enteredBarcode, client;
  const ready = new Promise((resolve) => { enteredBarcode = resolve; });
  const barcode = new Promise((resolve) => { releaseBarcode = resolve; });
  const transport = new Transport([[{ ...output(0, 'barcode'), command: 35 }, { status: -2 }]]);
  const originalCall = transport.call.bind(transport);
  transport.call = (method, params) => {
    if (method === 'validateBarcode') { enteredBarcode(); return barcode; }
    return originalCall(method, params);
  };
  client = await SitefClient.connect({ configuration, transport,
    interaction: async () => { await client.validateBarcode('1234'); return { buffer: '1234' }; }
  });
  const result = client.transact(input);
  await ready;
  client.cancel();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(transport.calls.filter((c) => c.method === 'continue').length, 1);
  releaseBarcode({ status: 0, documentType: 0 });
  assert.equal((await result).status, -2);
  const continuations = transport.calls.filter((c) => c.method === 'continue');
  assert.equal(continuations.length, 2);
  assert.equal(continuations[1].params.continueFlag, -1);
  await client.close();
});


test('a pre-start abort preserves older pending records and persists only the new attempt as locally ended', async () => {
  let release, entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  const hold = new Promise((resolve) => { release = resolve; });
  const external = [];
  const { client, transport } = await setup({ onStateChange: async (state) => {
    external.push(state);
    if (state.payments.length === 2 && state.payments[1].state === 'started') { entered(); await hold; }
  } });
  await client.transact(input);
  const old = client.recovery.payments[0];
  const controller = new AbortController();
  const attempt = client.transact({ ...input, fiscalDocument: '200' }, { signal: controller.signal });
  await ready;
  controller.abort(); release();
  await assert.rejects(attempt, (error) => {
    assert.equal(error.code, 'ABORTED');
    assert.equal(getPartialTransaction(error).started, false);
    assert.equal(getPartialTransaction(error).status, undefined);
    return true;
  });
  assert.deepEqual(client.recovery.payments[0], old);
  assert.equal(client.recovery.payments[1].state, 'ended');
  assert.deepEqual(external.at(-1), client.recovery);
  assert.equal(client.state, 'awaiting-finalization');
  assert.equal(starts(transport).length, 1);
  assert.equal(finishes(transport).length, 0);
  await client.close();
});

test('failure to persist a pre-start abort is explicit and never retries or enters native code', async () => {
  let release, entered, saves = 0;
  const ready = new Promise((resolve) => { entered = resolve; });
  const hold = new Promise((resolve) => { release = resolve; });
  const external = [];
  const correctionFailure = new Error('correction write failed');
  const { client, transport } = await setup({ onStateChange: async (state) => {
    saves++;
    if (state.payments[0].state === 'ended') throw correctionFailure;
    external.push(state); entered(); await hold;
  } });
  const controller = new AbortController();
  const attempt = client.transact(input, { signal: controller.signal });
  await ready;
  controller.abort(); release();
  await assert.rejects(attempt, (error) => {
    assert.equal(error.code, 'STATE_PERSISTENCE_FAILED');
    assert.equal(error.cause, correctionFailure);
    assert.equal(error.nativeStatus, undefined);
    const partial = getPartialTransaction(error);
    assert.equal(partial.started, false);
    assert.equal(partial.status, undefined);
    assert.equal(partial.terminalKnown, false);
    assert.equal(partial.requiresFinalization, false);
    assert.equal(partial.requiresRecovery, true);
    return true;
  });
  assert.equal(saves, 2);
  assert.equal(external.length, 1);
  assert.equal(external[0].payments[0].state, 'started');
  assert.equal(client.recovery.payments[0].state, 'ended');
  assert.equal(client.recovery.payments[0].status, undefined);
  assert.equal(client.state, 'idle');
  assert.equal(starts(transport).length, 0);
  assert.equal(finishes(transport).length, 0);
  await client.close();
  assert.equal(saves, 2);
});

test('an initial persistence failure during abort is not followed by an automatic correction write', async () => {
  let saves = 0;
  const controller = new AbortController();
  const initialFailure = new Error('initial write failed');
  const { client, transport } = await setup({ onStateChange: async () => {
    saves++; controller.abort(); throw initialFailure;
  } });
  await assert.rejects(client.transact(input, { signal: controller.signal }), (error) => {
    assert.equal(error, initialFailure);
    assert.equal(getPartialTransaction(error).started, false);
    return true;
  });
  assert.equal(saves, 1);
  assert.equal(client.recovery, undefined);
  assert.equal(client.state, 'idle');
  assert.equal(starts(transport).length, 0);
  assert.equal(finishes(transport).length, 0);
  await client.close();
});
