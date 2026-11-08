import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import {
  ClientSitef, Operations, TransactionControl, SitefError, getPartialTransaction
} from '../dist/index.js';

const configuration = { server: 'synthetic.invalid', storeId: '00000000', terminalId: 'AA000001' };
const base = { amount: '10,00', fiscalDocument: '123', fiscalDate: '20261030', fiscalTime: '120102', operator: 'Test' };
const input = (overrides = {}) => ({ ...base, operation: Operations.Credit, ...overrides });
const exchange = (command, buffer = '', fieldType = -1, extra = {}) => ({
  status: 10000, command, fieldType, minLength: 0, maxLength: 20000, buffer, ...extra
});
class FakeTransport {
  calls = [];
  closes = 0;
  constructor(steps = []) { this.steps = [...steps]; }
  async call(method, params) {
    this.calls.push({ method, params });
    if (method === 'load') return { protocolVersion: 1, platform: 'windows', architecture: 'x86_64' };
    if (method === 'configure') return { status: 0 };
    if (method === 'start') return { status: 10000 };
    if (method === 'continue') {
      const value = this.steps.shift() ?? { status: 0 };
      if (value instanceof Error) throw value;
      return typeof value === 'function' ? value(params) : value;
    }
    if (method === 'finish') return { returned: true };
    return { status: 0 };
  }
  async close() { this.closes++; }
}
async function setup(steps = [], extra = {}) {
  const transport = new FakeTransport(steps);
  let factories = 0;
  const client = await ClientSitef.create({
    bridgeExecutable: '/synthetic/bridge', bridgeDirectory: '/synthetic', libraryPath: '/synthetic/library',
    configuration, transportFactory: () => { factories++; return transport; }, ...extra
  });
  return { client, transport, factories };
}
const methods = transport => transport.calls.map(call => call.method);
const errorCode = code => error => error?.code === code;

 test('one connection loads/configures once, keeps pending payments, finalizes exact identities and closes once', async () => {
  const { client, transport, factories } = await setup([
    exchange(0, '7', 161), exchange(0, 'first', 999999), exchange(0, 'second', 999999),
    exchange(0, '', 999998, { bufferBase64: '/w==', decodingError: true }), { status: 0 },
    exchange(0, '8', 161), { status: 0 }
  ]);
  const first = client.createTransaction(input());
  const result = await first.process({ event() {} });
  assert.strictEqual(first.result, result);
  assert.equal(first.status, 0);
  assert.equal(first.state, 'awaiting-finalization');
  assert.equal(result.requiresFinalization, true);
  assert.deepEqual(result.data.getAll(999999).map(field => field.raw), ['first', 'second']);
  assert.equal(result.data.getLast(999998).bufferBase64, '/w==');
  assert.equal(result.data.getLast(999998).decodingError, true);
  assert.equal(result.fields.length, 4);
  const second = client.createTransaction(input());
  const other = await second.process();
  const firstId = result.transactionId;
  // The caller can annotate the legacy result, but cannot redirect fiscal decisions or native status.
  result.transactionId = other.transactionId;
  result.status = -999;
  assert.equal(first.status, 0);
  assert.deepEqual((await first.confirm()).payments, [firstId]);
  assert.equal(first.state, 'finalized-local');
  assert.equal(second.state, 'awaiting-finalization');
  assert.equal((await second.undo()).remoteConfirmation, 'not-reported');
  const finishes = transport.calls.filter(call => call.method === 'finish');
  assert.equal(finishes[0].params.additionalParameters, '{NumeroPagamentoCupom=7}');
  assert.equal(finishes[1].params.additionalParameters, '{NumeroPagamentoCupom=8}');
  assert.equal(finishes[0].params.confirm, 1);
  assert.equal(finishes[1].params.confirm, 0);
  first.dispose(); first.dispose();
  assert.equal(first.state, 'disposed');
  assert.equal(first.result, undefined);
  assert.equal(client.recovery.payments.length, 2);
  await client.close(); await client.close();
  assert.equal(factories, 1);
  assert.equal(methods(transport).filter(method => method === 'load').length, 1);
  assert.equal(methods(transport).filter(method => method === 'configure').length, 1);
  assert.equal(transport.closes, 1);
});

test('typed callbacks preserve displays, native option IDs, text, confirmation and raw extensions', async () => {
  const { client, transport } = await setup([
    exchange(1, 'operator'), exchange(12), exchange(3, 'both'), exchange(14), exchange(15, 'header'),
    exchange(21, '4:Alpha;9:Beta;'), exchange(42, '1|7:Alpha:code:type;'),
    exchange(30, 'text', 999999), exchange(20, 'Confirm?'), exchange(20, 'No?'),
    exchange(29, 'application', 999998), exchange(41, 'secret', 999997),
    exchange(22, 'ack'), exchange(50, 'qr', 584), exchange(51), exchange(52, 'footer', 4128),
    exchange(999, 'future', 999996), { status: -98765 }
  ]);
  const seen = [];
  const tx = client.createTransaction(input({ operation: 98765 }), { requiresFinalization: false });
  const result = await tx.process({
    display(request) { seen.push([request.target, request.action, request.buffer]); },
    menu(request) { return request.command === 21 ? '9' : '7'; },
    collect(request) { seen.push(['secret', request.secret]); return request.secret ? '4321' : 'hello'; },
    confirm(request) { return request.buffer === 'Confirm?'; },
    application() { return 'auto'; }, acknowledge() {}, qr(request) { seen.push(['qr', request.command]); },
    raw(request) { assert.equal(request.command, 999); return { buffer: 'extension' }; }
  });
  assert.equal(result.status, -98765);
  assert.equal(tx.status, -98765);
  assert.equal(tx.state, 'completed');
  assert.deepEqual(seen.slice(0, 5), [
    ['operator', 'show', 'operator'], ['customer', 'clear', ''], ['both', 'show', 'both'],
    ['menu-title', 'clear', ''], ['header', 'show', 'header']
  ]);
  assert.deepEqual(seen.slice(5), [['secret', false], ['secret', true], ['qr', 50], ['qr', 51], ['qr', 52]]);
  const buffers = transport.calls.filter(call => call.method === 'continue').map(call => call.params.buffer);
  assert.deepEqual(buffers.slice(6, 13), ['9', '7', 'hello', '0', '1', 'auto', '4321']);
  await client.close();
});

test('command 23 observers are asynchronous and event return values never alter command 0 buffers', async () => {
  let finishPoll;
  let called = false;
  const polling = new Promise(resolve => { finishPoll = resolve; });
  const { client, transport } = await setup([exchange(23), exchange(0, 'output', 999999), { status: 0 }]);
  const tx = client.createTransaction(input({ operation: Operations.CommunicationTest }));
  const result = await tx.process({
    event(request) {
      if (request.command === 23) { called = true; return polling; }
      return { buffer: 'must-not-be-input', continueFlag: -1 };
    }
  });
  assert.equal(called, true);
  assert.equal(result.status, 0);
  assert.equal(transport.calls.filter(call => call.method === 'continue')[2].params.buffer, 'output');
  finishPoll();
  await client.close();
});

test('per-transaction callback overrides do not replace defaults used by later operations', async () => {
  let defaults = 0, local = 0;
  const { client } = await setup([exchange(1), { status: 0 }, exchange(1), { status: 0 }], {
    callbacks: { display() { defaults++; } }
  });
  await client.createTransaction(input()).process({ display() { local++; } });
  await client.createTransaction(input({ fiscalDocument: '456' })).process();
  assert.equal(local, 1); assert.equal(defaults, 1);
  await client.close();
});

test('missing interaction callback cancels explicitly and preserves partial native data', async () => {
  const { client, transport } = await setup([exchange(0, 'retained', 999999), exchange(30, 'prompt'), { status: -2 }]);
  const tx = client.createTransaction(input());
  await assert.rejects(tx.process(), error => {
    assert.equal(error.code, 'INTERACTION_FAILED');
    assert.deepEqual(error.interactionFailure, { stage: 'interaction', command: 30, fieldType: -1, reasonCode: 'MISSING_INTERACTION_HANDLER' });
    assert.strictEqual(tx.partialResult, getPartialTransaction(error));
    assert.equal(tx.partialResult.data.getLast(999999).raw, 'retained');
    assert.equal(tx.partialResult.status, -2);
    return true;
  });
  assert.equal(tx.result, undefined);
  assert.equal(tx.status, -2);
  assert.equal(tx.state, 'failed');
  assert.equal(transport.calls.filter(call => call.method === 'continue').at(-1).params.continueFlag, -1);
  await assert.rejects(tx.process(), errorCode('TRANSACTION_ALREADY_PROCESSED'));
  assert.equal(methods(transport).filter(method => method === 'start').length, 1);
  await client.close();
});

test('old cancel/dispose cannot interrupt the next transaction and active close/dispose are rejected', async () => {
  const { client, transport } = await setup([{ status: 0 }, exchange(30), { status: -2 }]);
  const old = client.createTransaction(input());
  await old.process();
  const current = client.createTransaction(input({ fiscalDocument: '456' }));
  let inCallback;
  const entered = new Promise(resolve => { inCallback = resolve; });
  let currentSignal;
  const running = current.process({ collect(request, { signal }) {
    currentSignal = signal; inCallback(); return new Promise(() => {});
  } });
  await entered;
  old.cancel(); old.dispose(); old.cancel();
  assert.equal(currentSignal.aborted, false);
  assert.throws(() => current.dispose(), errorCode('TRANSACTION_ACTIVE'));
  await assert.rejects(client.close(), errorCode('SESSION_BUSY'));
  assert.equal(transport.closes, 0);
  assert.equal(client.state, 'running');
  current.cancel();
  const result = await running;
  assert.equal(result.status, -2);
  assert.equal(transport.calls.filter(call => call.method === 'continue').at(-1).params.continueFlag, -1);
  assert.equal(client.recovery.payments[0].state, 'awaiting-finalization');
  await client.close();
});

test('reentrant second transaction cannot replace callbacks or duplicate a process attempt', async () => {
  const { client, transport } = await setup([exchange(1, 'one'), exchange(1, 'two'), { status: 0 }]);
  const tx = client.createTransaction(input());
  const other = client.createTransaction(input({ fiscalDocument: '456' }));
  let calls = 0, wrongCalls = 0;
  await tx.process({ async display() {
    calls++;
    if (calls === 1) {
      await assert.rejects(other.process({ display() { wrongCalls++; } }), errorCode('SESSION_BUSY'));
      await assert.rejects(tx.process(), errorCode('TRANSACTION_ALREADY_PROCESSED'));
    }
  } });
  assert.equal(calls, 2); assert.equal(wrongCalls, 0);
  assert.equal(methods(transport).filter(method => method === 'start').length, 1);
  assert.equal(client.recovery.payments.length, 1);
  await client.close();
});

test('abort before entry and transport timeout never retry and retain truthful partial outcomes', async () => {
  const controller = new AbortController(); controller.abort();
  const { client, transport } = await setup([exchange(0, 'partial', 999999), new SitefError('BRIDGE_TIMEOUT', 'Synthetic timeout', { uncertain: true })]);
  const aborted = client.createTransaction(input(), { signal: controller.signal });
  await assert.rejects(aborted.process(), errorCode('ABORTED'));
  assert.equal(methods(transport).includes('start'), false);
  assert.equal(aborted.status, undefined);
  const tx = client.createTransaction(input());
  await assert.rejects(tx.process(), errorCode('TRANSACTION_UNCERTAIN'));
  assert.equal(tx.state, 'uncertain');
  assert.equal(tx.status, undefined);
  assert.equal(tx.partialResult.terminalKnown, false);
  assert.equal(tx.partialResult.lastNativeStatus, 10000);
  assert.equal(tx.partialResult.data.getLast(999999).raw, 'partial');
  await assert.rejects(tx.process(), errorCode('TRANSACTION_ALREADY_PROCESSED'));
  await assert.rejects(client.createTransaction(input()).process(), errorCode('RECONNECT_REQUIRED'));
  assert.equal(methods(transport).filter(method => method === 'start').length, 1);
  await client.close();
});

test('input snapshot, open operation numbers and mutually exclusive function selectors', async () => {
  const { client, transport } = await setup();
  assert.deepEqual(Object.values(Operations), [0, 2, 3, 110, 111, 122, 123]);
  assert.throws(() => client.createTransaction(input({ functionId: 2 })), errorCode('INVALID_ARGUMENT'));
  const original = input({ operation: 123456 });
  const tx = client.createTransaction(original, { requiresFinalization: false });
  original.operation = 0; original.fiscalDocument = 'changed';
  await tx.process();
  const start = transport.calls.find(call => call.method === 'start');
  assert.equal(start.params.functionId, 123456); assert.equal(start.params.fiscalDocument, '123');
  assert.equal('operation' in start.params, false);
  await client.createTransaction({ ...base, functionId: 111 }).process();
  await client.close();
});

test('typed cancel/back are native controls, not finalization', async () => {
  const { client, transport } = await setup([exchange(30), exchange(30), { status: -2 }]);
  let step = 0;
  await client.createTransaction(input()).process({ collect() { return step++ ? TransactionControl.CANCEL : TransactionControl.BACK; } });
  assert.deepEqual(transport.calls.filter(call => call.method === 'continue').map(call => call.params.continueFlag), [0, 1, -1]);
  assert.equal(methods(transport).includes('finish'), false);
  await client.close();
});

test('application hook wins over convenience callback and existing field hooks remain required', async () => {
  let hookCalls = 0, callbackCalls = 0;
  const { client, transport } = await setup([exchange(29, '', 999999), { status: 0 }], {
    fields: { hooks: { resolveApplicationData() { hookCalls++; return { buffer: 'native-app-data' }; } } }
  });
  await client.createTransaction(input()).process({ application() { callbackCalls++; return 'wrong'; } });
  assert.equal(hookCalls, 1); assert.equal(callbackCalls, 0);
  assert.equal(transport.calls.filter(call => call.method === 'continue')[1].params.buffer, 'native-app-data');
  await client.close();
});

test('default automation responsibility exposes deferred receipts without pretending to print', async () => {
  const { client } = await setup([exchange(0, 'synthetic receipt', 121), { status: 0 }]);
  const tx = client.createTransaction(input());
  const result = await tx.process();
  assert.equal(result.details.receipts[0].printed, false);
  assert.equal(result.data.getLast(121).raw, 'synthetic receipt');
  assert.equal(client.recovery.payments[0].finalizationResponsibility, undefined);
  await tx.confirm();
  assert.equal(client.recovery.payments[0].finalizationResponsibility, 'automation');
  assert.equal(client.recovery.payments[0].receipts[0].printed, false);
  await client.close();
});

test('SDK policy overrides retain deferred print obligations', async () => {
  const strict = await setup([exchange(0, 'synthetic receipt', 121), { status: 0 }], {
    fields: { finalizationResponsibility: 'sdk', receiptStoragePolicy: 'explicit-return' }
  });
  const tx = strict.client.createTransaction(input());
  await tx.process();
  await assert.rejects(tx.confirm());
  assert.equal(methods(strict.transport).includes('finish'), false);
  await strict.client.close();
});

test('initial pinpad message is optional, auxiliary, checked and never reconfigures', async () => {
  const { client, transport } = await setup([], { initialPinpadMessage: 'Synthetic ready' });
  assert.deepEqual(methods(transport), ['load', 'configure', 'pinpadPermanentMessage']);
  assert.deepEqual(transport.calls[2].params, { message: 'Synthetic ready' });
  await client.close();
  const failed = new FakeTransport();
  const call = failed.call.bind(failed);
  failed.call = async (method, params) => method === 'pinpadPermanentMessage' ? { status: -43 } : call(method, params);
  await assert.rejects(setup([], { transportFactory: () => failed, initialPinpadMessage: 'Synthetic ready' }), error => {
    assert.equal(error.code, 'PINPAD_MESSAGE_FAILED'); assert.equal(error.nativeStatus, -43); return true;
  });
  assert.equal(failed.closes, 1);
  assert.equal(methods(failed).filter(method => method === 'configure').length, 1);
});

test('factory initialization failure closes its transport once', async () => {
  for (const failure of ['load', 'configure']) {
    const transport = new FakeTransport();
    const call = transport.call.bind(transport);
    transport.call = async (method, params) => {
      if (method === failure) throw new Error('Synthetic setup failure');
      return call(method, params);
    };
    await assert.rejects(setup([], { transportFactory: () => transport }));
    assert.equal(transport.closes, 1);
  }
});

test('public facade TypeScript signatures preserve raw input and callback contracts', () => {
  const fixture = fileURLToPath(new URL('./types/transaction-facade.mts', import.meta.url));
  const program = ts.createProgram([fixture], {
    strict: true, noEmit: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n'
  }));
});

test('advanced pending query retains its dispatcher under concurrent rejected transaction attempts', async () => {
  let defaults = 0, wrong = 0, rejected = 0;
  const { client, transport } = await setup([exchange(30, 'value', 999999), { status: 0 }], {
    callbacks: { collect() { defaults++; return 'default'; } }
  });
  const query = client.advanced.queryPendingTransactions();
  assert.equal(client.advanced.isBusy, true);
  let done = false;
  const attempts = [];
  const churn = () => {
    if (done || !client.advanced.isBusy) return;
    const tx = client.createTransaction(input({ operation: 111 }));
    attempts.push(tx.process({ collect() { wrong++; return 'wrong'; } }).catch(error => {
      assert.equal(error.code, 'SESSION_BUSY'); rejected++;
    }));
    queueMicrotask(churn);
  };
  queueMicrotask(churn);
  await query;
  done = true;
  await Promise.all(attempts);
  assert.ok(rejected > 0);
  assert.equal(defaults, 1); assert.equal(wrong, 0);
  assert.equal(client.advanced.isBusy, false);
  assert.equal(methods(transport).filter(method => method === 'start').length, 1);
  await client.close();
});

test('advanced auxiliary occupancy rejects transactions before starting native work', async () => {
  let resolveCall;
  const pending = new Promise(resolve => { resolveCall = resolve; });
  const transport = new FakeTransport();
  const call = transport.call.bind(transport);
  transport.call = async (method, params) => method === 'pendingCount' ? pending : call(method, params);
  const { client } = await setup([], { transportFactory: () => transport });
  const auxiliary = client.callNative('pendingCount');
  assert.equal(client.advanced.isBusy, true);
  await assert.rejects(client.createTransaction(input()).process(), errorCode('SESSION_BUSY'));
  assert.equal(methods(transport).includes('start'), false);
  resolveCall({ status: 0 });
  await auxiliary;
  await client.close();
});
test('initialization preserves primary native status when closing also fails', async () => {
  for (const stage of ['configure', 'pinpadPermanentMessage']) {
    const transport = new FakeTransport();
    const call = transport.call.bind(transport);
    transport.call = async (method, params) => method === stage ? { status: stage === 'configure' ? 7 : -43 } : call(method, params);
    transport.close = async () => { transport.closes++; throw new Error('Synthetic cleanup failure'); };
    await assert.rejects(setup([], { transportFactory: () => transport, initialPinpadMessage: 'Ready' }), error => {
      assert.equal(error.code, stage === 'configure' ? 'CONFIGURATION_FAILED' : 'PINPAD_MESSAGE_FAILED');
      assert.equal(error.nativeStatus, stage === 'configure' ? 7 : -43);
      assert.equal(error.cleanupFailed, true);
      assert.equal(error.uncertain, true);
      return true;
    });
    assert.equal(transport.closes, 1);
  }
});

test('immediate print obligations and existing resource hooks are not bypassed by automation defaults', async () => {
  const { client, transport } = await setup([exchange(0, 'synthetic immediate receipt', 121), { status: -2 }]);
  const tx = client.createTransaction(input({ operation: 101 }));
  await assert.rejects(tx.process(), error => {
    assert.equal(error.code, 'INTERACTION_FAILED');
    assert.equal(error.interactionFailure.reasonCode, 'MISSING_FIELD_HANDLER');
    return true;
  });
  assert.equal(tx.partialResult.data.getLast(121).raw, 'synthetic immediate receipt');
  assert.equal(methods(transport).includes('finish'), false);
  await client.close();
});

test('public details cannot attest printing/signature, replace receipt bytes or change NFPAG constraints', async () => {
  const printed = [];
  let paymentRequirements;
  const { client, transport } = await setup([
    exchange(0, '1', 161), exchange(0, 'native receipt', 121), exchange(0, '1', 5074), { status: 0 }
  ], { fields: { finalizationResponsibility: 'sdk', hooks: {
    printReceipt(receipt) { printed.push({ ...receipt }); return true; },
    paymentData(requirements) { paymentRequirements = requirements; return []; }
  } } });
  const tx = client.createTransaction(input());
  const result = await tx.process();
  const originalReceipt = { ...result.details.receipts[0] };
  result.details.receipts[0].printed = true;
  result.details.receipts[0].buffer = 'tampered';
  result.details.receipts[0].bufferBase64 = 'dGFtcGVyZWQ=';
  result.details.receipts[0].id = 'tampered';
  result.details.signatureRequired = false;
  result.details.signatureCaptured = true;
  result.details.nfpag.maximum = 999;
  result.details.nfpag.types.fake = { fields: ['fake'], allowedNetworks: ['fake'] };
  // Printing still runs against the original receipt, then the real signature obligation blocks confirmation.
  await assert.rejects(tx.confirm(), error => {
    assert.equal(error.code, 'MISSING_FIELD_HANDLER'); return true;
  });
  assert.equal(printed.length, 1);
  assert.deepEqual(printed[0], originalReceipt);
  assert.equal(methods(transport).includes('finish'), false);
  await assert.rejects(client.advanced.finalizeWithPayments(true, result.transactionId, undefined, '10,00'));
  assert.equal(paymentRequirements.maximum, undefined);
  assert.equal(paymentRequirements.types.fake, undefined);
  await client.close();
});

test('result snapshot isolation does not clone or serialize opaque resolver values', async () => {
  const values = [() => 'application value', Symbol('application value')];
  for (const value of values) {
    const { client } = await setup([exchange(0, 'native value', 170), { status: 0 }], {
      fields: { hooks: { resolveField: () => value } }
    });
    const tx = client.createTransaction(input());
    const result = await tx.process();
    assert.strictEqual(result.details.fields.find(field => field.fieldType === 170).value, value);
    assert.equal(result.data.getLast(170).raw, 'native value');
    await client.close();
  }
});
