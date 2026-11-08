import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { ClientSitef } from '../dist/index.js';
import { cliConnection } from '../../../examples/cli/connection.mjs';
import { runSimulation, fiscalInput } from '../../../examples/cli/session.mjs';
import { createCallbacks, createSimulatedReceiptPrinter, displayResultReceipts,
  clearReceiptPresentation } from '../../../examples/cli/interaction.mjs';
import { terminalIO } from '../../../examples/cli/terminal.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const pending = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const receipt = (fieldType = 121, id = 'SYNTHETIC:1') => Object.freeze({
  id, fieldType, buffer: '  SYNTHETIC RECEIPT\n\tTOTAL 1,00\n',
  bufferBase64: 'SYNTHETIC_BYTES', timing: 'immediate', printed: false
});

test('CLI simulated printer: awaits every receipt write, preserves bytes, and reuses completed preview exactly once', async () => {
  const writes = [], gates = [], io = {
    write() { assert.fail('Prefer the receipt-specific writer'); },
    writeReceipt(line) { writes.push(line); const gate = pending(); gates.push(gate); return gate.promise; }
  };
  const copy = receipt(), before = structuredClone(copy), context = { signal: new AbortController().signal };
  let complete = false;
  const preview = createCallbacks(io).receipt(copy, context).then(() => { complete = true; });
  await tick();
  assert.equal(writes.length, 1); assert.equal(complete, false);
  gates[0].resolve(); await tick();
  assert.equal(writes.length, 2); assert.equal(writes[1], copy.buffer); assert.equal(complete, false);
  gates[1].resolve(); await tick();
  assert.equal(writes.length, 3); assert.match(writes[2], /impressao simulada/); assert.equal(complete, false);
  gates[2].resolve(); await preview;
  assert.equal(await createSimulatedReceiptPrinter(io)(copy, context), true);
  assert.equal(displayResultReceipts({ details: { receipts: [copy] } }, io, { skipPresented: true }), 0);
  assert.equal(writes.length, 3);
  assert.deepEqual(copy, before);
  clearReceiptPresentation(io);
});

for (const fieldType of [120, 121, 122, 625]) test('CLI simulated printer: labels actual receipt field ' + fieldType + ' without exposing metadata', async () => {
  const writes = [], io = { write: line => writes.push(line) }, copy = receipt(fieldType);
  assert.equal(await createSimulatedReceiptPrinter(io)(copy), true);
  assert.equal(writes[1], copy.buffer);
  assert.match(writes[0], new RegExp('campo ' + fieldType));
  const label = { 120: /autenticacao no verso do cheque/, 121: /via do cliente/,
    122: /via da loja/, 625: /beneficiario\/cedente/ }[fieldType];
  assert.match(writes[0], label);
  assert.doesNotMatch(writes.join('\n'), /SYNTHETIC_BYTES/);
  assert.equal(copy.printed, false);
  clearReceiptPresentation(io);
});

test('CLI simulated printer: unknown output and malformed receipt cannot attest success', async () => {
  const io = { write() { assert.fail('Unknown/malformed content must not be dumped'); } };
  assert.equal(await createSimulatedReceiptPrinter(io)(receipt(999999)), false);
  await assert.rejects(createSimulatedReceiptPrinter(io)({ ...receipt(), buffer: undefined }),
    error => error.code === 'CLI_INVALID_RECEIPT_TEXT');
  clearReceiptPresentation(io);
});

for (const lateOutcome of ['resolve', 'reject']) test('CLI simulated printer: cancelled awaited display never retries or resumes after late ' + lateOutcome, { timeout: 3000 }, async () => {
  const entered = pending(), gate = pending(), controller = new AbortController(), writes = [], calls = [];
  const copy = receipt();
  const io = { write(line) {
    writes.push(line);
    if (line === copy.buffer) { entered.resolve(); return gate.promise; }
  }, ask() { assert.fail('No operator question is required'); } };
  let emitted = false;
  const transport = { async call(method, params) {
    calls.push({ method, params });
    if (method === 'load') return { protocolVersion: 1, platform: 'windows', architecture: 'x86_64', fieldTypeBytes: 4 };
    if (method === 'configure') return { status: 0 };
    if (method === 'start') return { status: 10000 };
    if (method === 'continue') {
      if (!emitted) {
        emitted = true;
        return { status: 10000, command: 0, fieldType: 121, buffer: copy.buffer,
          bufferBase64: Buffer.from(copy.buffer, 'latin1').toString('base64'), minLength: 0, maxLength: 20000 };
      }
      assert.equal(params.continueFlag, -1);
      return { status: -2 };
    }
    assert.fail('No native retry, finalization or other action: ' + method);
  }, async close() {} };
  const connection = cliConnection({ io, transport, directory: process.cwd(),
    configuration: { server: 'synthetic', storeId: '00000000', terminalId: 'SR000001' } });
  const print = connection.options.fields.hooks.printReceipt;
  let printCalls = 0;
  connection.options.fields.hooks.printReceipt = (...args) => { printCalls++; return print(...args); };
  const client = await ClientSitef.create(connection.options);
  try {
    const run = runSimulation(client, fiscalInput('', 110), io, controller.signal);
    await entered.promise;
    controller.abort();
    const result = await run;
    assert.equal(result.status, -2);
    assert.equal(result.details.receipts[0].printed, false);
    assert.equal(result.details.receipts[0].buffer, copy.buffer);
    assert.equal(writes.filter(line => line === copy.buffer).length, 1);
    assert.equal(printCalls, 0);
    assert.deepEqual(calls.filter(call => call.method === 'continue').map(call => call.params.continueFlag), [0, -1]);
    const writeCount = writes.length, callCount = calls.length;
    if (lateOutcome === 'resolve') gate.resolve(); else gate.reject(new Error('SYNTHETIC LATE OUTPUT FAILURE'));
    await tick(); await tick();
    assert.equal(writes.length, writeCount); assert.equal(calls.length, callCount); assert.equal(printCalls, 0);
    assert.equal(calls.filter(call => call.method === 'start').length, 1);
  } finally { await client.close(); }
});

test('CLI simulated printer: failed attempt is not retried by printing or returned-result display', async () => {
  const copy = receipt(), writes = [];
  const io = { write(line) { writes.push(line); throw new Error('SYNTHETIC OUTPUT FAILURE'); } };
  await assert.rejects(createCallbacks(io).receipt(copy), /SYNTHETIC OUTPUT FAILURE/);
  assert.equal(await createSimulatedReceiptPrinter(io)(copy), false);
  assert.equal(displayResultReceipts({ details: { receipts: [copy] } }, io, { skipPresented: true }), 0);
  assert.equal(writes.length, 1);
  clearReceiptPresentation(io);
});

test('CLI terminal receipt writer: stream completion is awaited and terminal controls remain inert', async () => {
  const input = new EventEmitter(); input.isTTY = true;
  let finishWrite, text;
  const output = new Writable({ write(chunk, _encoding, callback) { text = chunk.toString(); finishWrite = callback; } });
  output.isTTY = true;
  let complete = false;
  const writing = terminalIO(input, output).writeReceipt('\x1b[2JTEXT\n').then(() => { complete = true; });
  await tick();
  assert.equal(complete, false); assert.equal(text, '[2JTEXT\n\n');
  finishWrite(); await writing;
  assert.equal(complete, true); assert.equal(output.listenerCount('error'), 0);
});

for (const mode of ['callback', 'throw', 'event']) test('CLI terminal receipt writer: ' + mode + ' failure rejects without unhandled stream error', async () => {
  const input = new EventEmitter(); input.isTTY = true;
  const error = new Error('SYNTHETIC STREAM FAILURE');
  const output = mode === 'callback'
    ? new Writable({ write(_chunk, _encoding, callback) { callback(error); } })
    : new EventEmitter();
  output.isTTY = true;
  if (mode === 'throw') output.write = () => { throw error; };
  if (mode === 'event') output.write = () => { setImmediate(() => output.emit('error', error)); };
  await assert.rejects(terminalIO(input, output).writeReceipt('SYNTHETIC'), failure => failure === error);
  await tick();
  assert.equal(output.listenerCount('error'), 0);
});
