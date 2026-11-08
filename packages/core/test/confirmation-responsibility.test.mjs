import test from 'node:test';
import assert from 'node:assert/strict';
import { SitefClient, getPartialTransaction } from '../dist/index.js';

const configuration = { server: '127.0.0.1', storeId: '00000000', terminalId: 'AA000001' };
const input = { functionId: 0, amount: '10,00', fiscalDocument: '100', fiscalDate: '20261107', fiscalTime: '120000', operator: 'TEST' };
const output = (fieldType, buffer = '') => ({ status: 10000, command: 0, fieldType, buffer, minLength: 0, maxLength: 200 });
const automation = { finalizationResponsibility: 'automation', receiptStoragePolicy: 'explicit-return' };
const reviewAndReceipts = () => [output(175, '2'), output(121, 'SYNTHETIC CLIENT RECEIPT'), output(122, 'SYNTHETIC STORE RECEIPT'), output(5074)];
class Transport {
  calls = [];
  failFinish = false;
  constructor(steps = []) { this.steps = [...steps, { status: 0 }]; }
  async call(method, params = {}) {
    this.calls.push({ method, params: structuredClone(params) });
    if (method === 'configure') return { status: 0 };
    if (method === 'start') return { status: 10000 };
    if (method === 'continue') return this.steps.shift() ?? { status: 0 };
    if (method === 'finish') {
      if (this.failFinish) throw new Error('synthetic transport interruption');
      return { returned: true };
    }
    return { status: 0 };
  }
  async close() {}
}
const finishes = (transport) => transport.calls.filter((c) => c.method === 'finish');
async function setup(steps = [], options = {}) {
  const transport = new Transport(steps);
  const client = await SitefClient.connect({ configuration, transport, interaction: async () => ({}), ...options });
  return { client, transport };
}
async function historicalState() {
  const { client } = await setup(reviewAndReceipts(), { fields: { receiptStoragePolicy: 'explicit-return' } });
  await client.transact(input);
  const state = client.recovery;
  await client.close();
  return state;
}

test('explicit automation decision reaches native finish without inventing printing or signature', async () => {
  const snapshots = [];
  const forbidden = () => { throw new Error('External obligations must not be performed by SDK hooks'); };
  const { client, transport } = await setup(reviewAndReceipts(), {
    fields: { ...automation, hooks: { printReceipt: forbidden, captureSignature: forbidden } },
    onStateChange: (state) => { snapshots.push(structuredClone(state)); }
  });
  const result = await client.transact(input);
  assert.equal(result.status, 0);
  assert.equal(result.requiresFinalization, true);
  assert.equal(result.details.assessment.accepted, false);
  assert.deepEqual(result.details.assessment.issues, ['PRODUCT_CONSTRAINT_REVIEW_REQUIRED:APPLICATION_MUST_REVIEW_DOCUMENTED_PRODUCT_CONSTRAINTS']);
  assert.equal(result.details.signatureRequired, true);
  assert.equal(result.details.signatureCaptured, undefined);
  assert.equal(client.recovery.payments[0].confirmationAllowed, false);
  assert.equal(finishes(transport).length, 0);
  const finalized = await client.finalizeTransaction(true, result.transactionId);
  assert.deepEqual(finalized, { returned: true, remoteConfirmation: 'not-reported', payments: [result.transactionId] });
  assert.deepEqual(finishes(transport)[0].params, {
    confirm: 1, fiscalDocument: input.fiscalDocument, fiscalDate: input.fiscalDate,
    fiscalTime: input.fiscalTime, additionalParameters: ''
  });
  const payment = client.recovery.payments[0];
  assert.equal(payment.state, 'finalized-local');
  assert.equal(payment.finalizationResponsibility, 'automation');
  assert.equal(payment.signatureRequired, true);
  assert.equal(payment.signatureCaptured, undefined);
  assert.equal(payment.receipts.every((r) => r.printed === false), true);
  assert.equal(result.details.receipts.every((r) => r.printed === false), true);
  assert.equal(JSON.stringify(snapshots).includes('SYNTHETIC CLIENT RECEIPT'), false);
  assert.equal(snapshots.find((s) => s.state === 'finalizing').payments[0].finalizationResponsibility, 'automation');
  await client.close();
  assert.equal(finishes(transport).length, 1);
});

test('default sdk policy still requires review and can explicitly cancel without receipt/signature hooks', async () => {
  const { client, transport } = await setup(reviewAndReceipts(), { fields: { receiptStoragePolicy: 'explicit-return' } });
  const result = await client.transact(input);
  assert.equal(client.recovery.payments[0].confirmationAllowed, false);
  await assert.rejects(client.finalizeTransaction(true, result.transactionId), { code: 'TRANSACTION_DECISION_REQUIRED' });
  assert.equal(finishes(transport).length, 0);
  await client.finalizeTransaction(false, result.transactionId);
  assert.equal(finishes(transport)[0].params.confirm, 0);
  assert.equal(client.recovery.payments[0].finalizationResponsibility, 'sdk');
  await client.close();
});

test('automation mode does not bypass immediate receipt printing before continuation', async () => {
  const { client, transport } = await setup([output(121, 'SYNTHETIC IMMEDIATE RECEIPT')], { fields: automation });
  await assert.rejects(client.transact({ ...input, functionId: 112 }), (error) => {
    assert.equal(error.code, 'INTERACTION_FAILED');
    assert.equal(getPartialTransaction(error).status, 0);
    return true;
  });
  assert.equal(transport.calls.filter((c) => c.method === 'continue').at(-1).params.continueFlag, -1);
  assert.equal(finishes(transport).length, 0);
  await client.close();
});

test('immediate receipt hooks still execute with automation responsibility', async () => {
  let printed = 0;
  const { client } = await setup([output(123, '04'), output(121, 'SYNTHETIC IMMEDIATE RECEIPT')], {
    fields: { ...automation, hooks: { printReceipt: () => { printed++; return true; } } }
  });
  const result = await client.transact(input);
  assert.equal(printed, 1);
  assert.equal(result.details.receipts[0].printed, true);
  await client.finalizeTransaction(false, result.transactionId);
  await client.close();
});

test('known product violation and PBM decline remain blocked despite automation mode', async () => {
  for (const steps of [
    [output(1122, '1'), output(1115, '123,A,1,10;456,B,1,20;')],
    [output(4039, '17')]
  ]) {
    const { client, transport } = await setup(steps, { fields: automation });
    const result = await client.transact(input);
    assert.equal(client.recovery.payments[0].confirmationAllowed, false);
    await assert.rejects(client.finalizeTransaction(true, result.transactionId), { code: 'TRANSACTION_DECISION_REQUIRED' });
    assert.equal(finishes(transport).length, 0);
    await client.finalizeTransaction(false, result.transactionId);
    await client.close();
  }
});

test('automation owns monetary review and installment fallback but still makes a separate explicit decision', async () => {
  for (const [functionId, steps] of [[0, [output(137, '1000')]], [16, []], [17, []]]) {
    const { client, transport } = await setup(steps, { fields: automation });
    const result = await client.transact({ ...input, functionId });
    assert.equal(result.status, 0);
    assert.equal(result.details.assessment.accepted, false);
    assert.equal(client.recovery.payments[0].confirmationAllowed, false);
    assert.equal(finishes(transport).length, 0);
    await client.finalizeTransaction(true, result.transactionId);
    assert.equal(finishes(transport).length, 1);
    await client.close();
  }
});

test('real callback failure remains blocking with native status zero', async () => {
  const { client, transport } = await setup([output(175, '2')], {
    fields: automation, onExchange: () => { throw new Error('synthetic callback failure'); }
  });
  await assert.rejects(client.transact(input), { code: 'INTERACTION_FAILED' });
  const payment = client.recovery.payments[0];
  assert.equal(payment.status, 0);
  assert.equal(payment.confirmationAllowed, false);
  await assert.rejects(client.finalizeTransaction(true, payment.id), { code: 'TRANSACTION_DECISION_REQUIRED' });
  assert.equal(finishes(transport).length, 0);
  await client.close();
});

test('historical false review flag can be explicitly resolved by automation without receipt bodies', async () => {
  const state = await historicalState();
  assert.equal(state.payments[0].confirmationAllowed, false);
  const { client, transport } = await setup([], { initialState: state, fields: automation });
  const result = await client.finalizeRecovery(true, state.id, undefined, { transactionId: state.payments[0].id });
  assert.equal(result.remoteConfirmation, 'not-reported');
  assert.equal(finishes(transport).length, 1);
  assert.equal(client.recovery.payments[0].confirmationAllowed, true);
  assert.equal(client.recovery.payments[0].receipts.every((r) => !r.printed), true);
  assert.equal(client.recovery.payments[0].signatureCaptured, undefined);
  await client.close();
});

test('unknown review, administrative review and unobserved status are not overridden', async () => {
  for (const patch of [
    { assessmentIssues: ['FUTURE_POLICY'] },
    { assessmentIssues: ['ADMINISTRATIVE_REVIEW_REQUIRED'] },
    { status: undefined, state: 'uncertain' }
  ]) {
    const state = await historicalState();
    Object.assign(state.payments[0], patch);
    const { client, transport } = await setup([], { initialState: state, fields: automation });
    await assert.rejects(client.finalizeRecovery(true, state.id), { code: 'TRANSACTION_DECISION_REQUIRED' });
    assert.equal(finishes(transport).length, 0);
    await client.close();
  }
});

test('automation finalization plan keeps its original responsibility and decision across recovery', async () => {
  const { client, transport } = await setup(reviewAndReceipts(), { fields: automation });
  const result = await client.transact(input);
  transport.failFinish = true;
  await assert.rejects(client.finalizeTransaction(true, result.transactionId), { code: 'FINALIZATION_UNCERTAIN' });
  const state = client.recovery;
  assert.equal(state.payments[0].finalizationResponsibility, 'automation');
  await client.close();
  const restored = await setup([], { initialState: state });
  await assert.rejects(restored.client.finalizeRecovery(false, state.id), { code: 'RECOVERY_DECISION_MISMATCH' });
  await restored.client.finalizeRecovery(true, state.id);
  assert.deepEqual(finishes(restored.transport)[0].params, finishes(transport)[0].params);
  assert.equal(restored.client.recovery.payments[0].receipts.every((r) => !r.printed), true);
  assert.equal(restored.client.recovery.payments[0].signatureCaptured, undefined);
  await restored.client.close();
});

test('sdk finalization plan cannot silently delegate its obligations on reconnect', async () => {
  const state = await historicalState();
  Object.assign(state.payments[0], { state: 'uncertain', decision: 1, finalizationParameters: '', confirmationAllowed: true, finalizationResponsibility: 'sdk' });
  const { client, transport } = await setup([], { initialState: state, fields: automation });
  await assert.rejects(client.finalizeRecovery(true, state.id), { code: 'RECEIPT_RECOVERY_REQUIRED' });
  assert.equal(finishes(transport).length, 0);
  await client.close();
});

test('V1 unknown obligations still need attestation even with automation responsibility', async () => {
  const initialState = { version: 1, id: 'legacy', storeId: configuration.storeId, terminalId: configuration.terminalId,
    ...input, state: 'uncertain', updatedAt: new Date().toISOString() };
  const { client, transport } = await setup([], { initialState, fields: automation });
  await assert.rejects(client.finalizeRecovery(true, 'legacy'), { code: 'LEGACY_OBLIGATIONS_REQUIRED' });
  assert.equal(finishes(transport).length, 0);
  await client.close();
});

test('invalid responsibility fails before native entry or journal restore', async () => {
  const transport = new Transport();
  await assert.rejects(SitefClient.connect({ configuration, transport, interaction: async () => ({}),
    fields: { finalizationResponsibility: 'pretend-printed' } }), { code: 'INVALID_OPTIONS' });
  assert.equal(transport.calls.length, 0);
  const state = await historicalState();
  state.payments[0].finalizationResponsibility = 'pretend-printed';
  await assert.rejects(setup([], { initialState: state }), { code: 'JOURNAL_INVALID' });
});


test('native status zero after external or local cancellation cannot be approved by advisory review', async () => {
  for (const kind of ['signal', 'cancel']) {
    const controller = new AbortController();
    let client;
    const connected = await setup([output(175, '2')], {
      fields: automation,
      onExchange: () => kind === 'signal' ? controller.abort() : client.cancel()
    });
    client = connected.client;
    const result = await client.transact(input, { signal: controller.signal });
    assert.equal(result.status, 0);
    assert.equal(client.recovery.payments[0].confirmationAllowed, false);
    assert.ok(client.recovery.payments[0].assessmentIssues.includes('ABORTED'));
    await assert.rejects(client.finalizeTransaction(true, result.transactionId), { code: 'TRANSACTION_DECISION_REQUIRED' });
    assert.equal(finishes(connected.transport).length, 0);
    await client.close();
    const restored = await setup([], { initialState: client.recovery, fields: automation });
    await assert.rejects(restored.client.finalizeRecovery(true, client.recovery.id), { code: 'TRANSACTION_DECISION_REQUIRED' });
    assert.equal(finishes(restored.transport).length, 0);
    await restored.client.close();
  }
});


test('configured application review veto or failure cannot be overridden by automation mode', async () => {
  for (const [throws, hook] of [[false, () => false], [true, () => { throw new Error('synthetic review failure'); }]]) {
    const { client, transport } = await setup([output(175, '2')], {
      fields: { ...automation, hooks: { validateTransaction: hook } }
    });
    if (throws)
      await assert.rejects(client.transact(input), { code: 'INTERACTION_FAILED' });
    else {
      const result = await client.transact(input);
      assert.ok(result.details.assessment.issues.includes('TRANSACTION_REJECTED_BY_APPLICATION'));
    }
    const payment = client.recovery.payments[0];
    assert.equal(payment.status, 0);
    assert.equal(payment.confirmationAllowed, false);
    await assert.rejects(client.finalizeTransaction(true, payment.id), { code: 'TRANSACTION_DECISION_REQUIRED' });
    assert.equal(finishes(transport).length, 0);
    await client.close();
    const restored = await setup([], { initialState: client.recovery, fields: automation });
    await assert.rejects(restored.client.finalizeRecovery(true, client.recovery.id), { code: 'TRANSACTION_DECISION_REQUIRED' });
    await restored.client.close();
  }
});


test('unresolved automation assessment does not become accepted when restored under default sdk policy', async () => {
  const { client } = await setup([output(175, '2')], { fields: automation });
  await client.transact(input);
  assert.equal(client.recovery.payments[0].confirmationAllowed, false);
  assert.equal(client.recovery.payments[0].finalizationResponsibility, undefined);
  await client.close();
  const restored = await setup([], { initialState: client.recovery });
  await assert.rejects(restored.client.finalizeRecovery(true, client.recovery.id), { code: 'TRANSACTION_DECISION_REQUIRED' });
  assert.equal(finishes(restored.transport).length, 0);
  await restored.client.close();
});


test('older V2 plan without responsibility metadata retains SDK obligations on automation reconnect', async () => {
  for (const planState of ['uncertain', 'finalizing']) {
    const state = await historicalState();
    Object.assign(state.payments[0], { state: planState, decision: 1, finalizationParameters: '', confirmationAllowed: true });
    assert.equal(state.payments[0].finalizationResponsibility, undefined);
    const { client, transport } = await setup([], { initialState: state, fields: automation });
    await assert.rejects(client.finalizeRecovery(true, state.id), { code: 'RECEIPT_RECOVERY_REQUIRED' });
    assert.equal(finishes(transport).length, 0);
    assert.equal(client.recovery.payments[0].receipts.every((r) => !r.printed), true);
    assert.equal(client.recovery.payments[0].signatureCaptured, undefined);
    await client.close();
  }
});

test('caller field-option mutation cannot change finalization responsibility after connection', async () => {
  for (const initial of ['sdk', 'automation']) {
    const fields = { receiptStoragePolicy: 'explicit-return', finalizationResponsibility: initial };
    const { client, transport } = await setup([output(175, '2')], { fields });
    fields.finalizationResponsibility = initial === 'sdk' ? 'automation' : 'sdk';
    const result = await client.transact(input);
    if (initial === 'sdk') {
      await assert.rejects(client.finalizeTransaction(true, result.transactionId), { code: 'TRANSACTION_DECISION_REQUIRED' });
      assert.equal(finishes(transport).length, 0);
    } else {
      await client.finalizeTransaction(true, result.transactionId);
      assert.equal(finishes(transport).length, 1);
      assert.equal(client.recovery.payments[0].finalizationResponsibility, 'automation');
    }
    await client.close();
  }
});

test('mutating caller policy during awaited receipt persistence does not relabel the finalization plan', async () => {
  const fields = { receiptStoragePolicy: 'explicit-return', finalizationResponsibility: 'sdk',
    hooks: { printReceipt: () => true, captureSignature: () => true }
  };
  const { client, transport } = await setup([output(121, 'SYNTHETIC RECEIPT'), output(5074)], {
    fields,
    onStateChange: async (state) => {
      if (state.state === 'awaiting-finalization' && state.payments[0].signatureCaptured)
        fields.finalizationResponsibility = 'automation';
      await Promise.resolve();
    }
  });
  const result = await client.transact(input);
  await client.finalizeTransaction(true, result.transactionId);
  assert.equal(fields.finalizationResponsibility, 'automation');
  assert.equal(client.recovery.payments[0].finalizationResponsibility, 'sdk');
  assert.equal(client.recovery.payments[0].signatureCaptured, true);
  assert.equal(finishes(transport).length, 1);
  await client.close();
});
