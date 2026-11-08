import test from 'node:test';
import assert from 'node:assert/strict';
import { ClientSitef, getPartialTransaction } from '../dist/index.js';
import { cliConnection } from '../../../examples/cli/connection.mjs';
import { runSimulation, fiscalInput } from '../../../examples/cli/session.mjs';
import { cliErrorLines } from '../../../examples/cli/diagnostics.mjs';

const field = (id, text) => ({ status: 10000, command: 0, fieldType: id, buffer: text, bufferBase64: Buffer.from(text, 'latin1').toString('base64'), minLength: 0, maxLength: 20000 });
const request = (command, buffer) => ({ status: 10000, command, fieldType: -1, buffer, minLength: 0, maxLength: 20000 });
async function setup(steps, answers = [], printReceipt) {
  const calls = [], records = [], screen = [], prompts = [];
  const io = { write: value => screen.push(value), async ask(prompt) {
    prompts.push(prompt); assert.ok(answers.length, 'unexpected prompt'); return answers.shift();
  } };
  const transport = { async call(method, params) {
    calls.push({ method, params });
    if (method === 'load') return { protocolVersion: 1, platform: 'windows', architecture: 'x86_64', fieldTypeBytes: 4 };
    if (method === 'configure') return { status: 0 };
    if (method === 'start') return { status: 10000 };
    if (method === 'continue') {
      assert.ok(steps.length, 'unexpected continue'); const next = steps.shift();
      return typeof next === 'function' ? next(params) : next;
    }
    assert.fail('No other native call, including finish, is allowed: ' + method);
  }, async close() { calls.push({ method: 'close' }); } };
  const client = await ClientSitef.create(cliConnection({ transport, directory: process.cwd(), io, printReceipt,
    configuration: { server: 'synthetic', storeId: '00000000', terminalId: 'SR000001' },
    onStateChange: state => records.push(structuredClone(state)) }).options);
  return { client, io, screen, prompts, calls, records };
}

// Fictional menus/credentials/receipt text only. No vendor library is loaded.
test('CLI reprint: native yes is distinct from printer result; preview precedes printer/continue and is not repeated', async () => {
  let printed = 0, f;
  const copies = [field(121, 'SYNTHETIC CLIENT\n'), field(122, 'SYNTHETIC STORE\n'), field(121, 'SYNTHETIC CLIENT\n')];
  f = await setup([
    request(21, '7:Reimpressao;'), request(21, '2:Ultimo;'), request(41, 'Supervisor'), request(20, 'Confirma reimpressao?'),
    params => { assert.equal(params.buffer, '0'); return field(123, '04'); },
    copies[0], params => { assert.equal(printed, 1); assert.equal(params.buffer, copies[0].buffer); assert.equal(params.continueFlag, 0); return copies[1]; },
    params => { assert.equal(printed, 2); assert.equal(params.buffer, copies[1].buffer); return copies[2]; },
    params => { assert.equal(printed, 3); assert.equal(params.buffer, copies[2].buffer); return { status: 0 }; }
  ], ['7', '2', 'SYNTHETIC_PASSWORD', 's'], async receipt => {
    assert.equal(f.screen.filter(line => line === receipt.buffer).length, receipt.fieldType === 121 && printed === 2 ? 2 : 1);
    await Promise.resolve(); printed++; return true; // mocked physical printer, never console-as-printer
  });
  try {
    const result = await runSimulation(f.client, fiscalInput('', 110), f.io);
    assert.equal(result.status, 0);
    assert.equal(result.data.getAll(121).length, 2);
    assert.deepEqual(result.details.receipts.map(r => r.buffer), copies.map(r => r.buffer));
    assert.ok(result.details.receipts.every(r => r.printed));
    assert.deepEqual(f.screen.filter(line => /^SYNTHETIC (CLIENT|STORE)/.test(line)), copies.map(r => r.buffer));
    assert.equal(f.prompts.length, 4); // only the four native prompts, no artificial print/finalization question
    assert.doesNotMatch(f.screen.join('\n'), /SYNTHETIC_PASSWORD/);
    assert.doesNotMatch(JSON.stringify(f.records), /SYNTHETIC CLIENT|SYNTHETIC STORE|SYNTHETIC_PASSWORD/);
    assert.ok(!f.calls.some(c => c.method === 'finish'));
  } finally { await f.client.close(); }
});

test('CLI reprint: explicitly supplied printer failure is not replaced by simulated success', async () => {
  const printReceipt = () => false;
  const copy = field(121, 'SYNTHETIC PARTIAL RECEIPT\n');
  const f = await setup([field(123, '04'), copy, params => {
    assert.equal(params.continueFlag, -1); assert.equal(params.buffer, ''); return { status: -2 };
  }], [], printReceipt);
  try {
    await assert.rejects(runSimulation(f.client, fiscalInput('', 110), f.io), error => {
      assert.equal(error.code, 'INTERACTION_FAILED'); assert.equal(error.nativeStatus, -2);
      assert.equal(error.interactionFailure.reasonCode, 'FIELD_ACTION_FAILED');
      const partial = getPartialTransaction(error);
      assert.equal(partial.data.getLast(121).raw, copy.buffer);
      assert.equal(f.client.recovery.payments[0].receipts[0].printed, false);
      const diagnostic = cliErrorLines(error).join('\n');
      assert.doesNotMatch(diagnostic, /SYNTHETIC PARTIAL/);
      assert.match(diagnostic, /Retorno nativo -2/);
      return true;
    });
    assert.equal(f.screen.filter(line => line === copy.buffer).length, 1);
    assert.equal(f.prompts.length, 0);
    assert.equal(f.calls.filter(c => c.method === 'start').length, 1);
    assert.ok(!f.calls.some(c => c.method === 'finish'));
    assert.doesNotMatch(JSON.stringify(f.records), /SYNTHETIC PARTIAL/);
  } finally { await f.client.close(); }
});

test('CLI dedicated reprint: no receipt copy is invented and no financial decision is made', async () => {
  for (const copies of [[], [field(121, '')], [field(122, 'SYNTHETIC STORE ONLY')]]) {
    const f = await setup([...copies, { status: 0 }], [], () => true);
    try {
      const result = await runSimulation(f.client, fiscalInput('', 114), f.io);
      assert.equal(result.requiresFinalization, false);
      assert.equal(result.details.receipts.length, copies.length);
      assert.equal(f.prompts.length, 0);
      assert.ok(!f.calls.some(c => c.method === 'finish'));
      assert.equal(f.screen.filter(line => /^\[Comprovante /.test(line)).length, copies.length);
    } finally { await f.client.close(); }
  }
});
for (const ids of [[], [121], [122], [121, 122], [122, 121, 121], [120, 625]]) {
  test('CLI simulated printing: complete displayed receipt sequence ' + JSON.stringify(ids) + ' continues without printer or extra prompt', async () => {
    let f;
    const copies = ids.map((id, index) => field(id, `SYNTHETIC COPY ${index}\nTOTAL 1,00\n`));
    const steps = [request(20, 'Confirma reimpressao?'), params => {
      assert.equal(params.buffer, '0'); return field(123, '04');
    }];
    if (copies.length) steps.push(copies[0]);
    for (let index = 0; index < copies.length; index++) steps.push(params => {
      assert.equal(params.continueFlag, 0);
      assert.equal(params.buffer, copies[index].buffer);
      assert.equal(params.bufferBase64, copies[index].bufferBase64);
      assert.equal(f.screen.filter(value => value === copies[index].buffer).length, 1);
      return copies[index + 1] ?? { status: 0 };
    });
    if (!copies.length) steps.push({ status: 0 });
    f = await setup(steps, ['s']);
    try {
      const result = await runSimulation(f.client, fiscalInput('', 110), f.io);
      assert.equal(result.status, 0);
      assert.equal(result.details.receipts.length, ids.length);
      assert.ok(result.details.receipts.every(receipt => receipt.printed === true));
      assert.deepEqual(result.details.receipts.map(receipt => receipt.buffer), copies.map(copy => copy.buffer));
      for (const copy of copies) assert.equal(f.screen.filter(value => value === copy.buffer).length, 1);
      assert.equal(f.prompts.length, 1); // only the native yes/no
      assert.ok(!f.calls.some(call => call.method === 'finish'));
      assert.doesNotMatch(JSON.stringify(f.records), /SYNTHETIC COPY/);
    } finally { await f.client.close(); }
  });
}

for (const asynchronous of [false, true]) test('CLI simulated printing: display ' + (asynchronous ? 'rejection' : 'exception') + ' cancels with -1 instead of acknowledging success', async () => {
  const copy = field(121, 'SYNTHETIC DISPLAY FAILURE');
  const f = await setup([copy, params => {
    assert.equal(params.continueFlag, -1); return { status: -2 };
  }]);
  const write = f.io.write.bind(f.io);
  f.io.write = value => {
    if (value === copy.buffer) {
      if (asynchronous) return Promise.reject(new Error('SYNTHETIC OUTPUT ERROR'));
      throw new Error('SYNTHETIC OUTPUT ERROR');
    }
    return write(value);
  };
  try {
    await assert.rejects(runSimulation(f.client, fiscalInput('', 110), f.io), error => {
      assert.equal(error.code, 'INTERACTION_FAILED'); assert.equal(error.nativeStatus, -2);
      assert.equal(getPartialTransaction(error).data.getLast(121).raw, copy.buffer);
      assert.equal(f.client.recovery.payments[0].receipts[0].printed, false);
      assert.doesNotMatch(cliErrorLines(error).join('\n'), /SYNTHETIC OUTPUT ERROR|SYNTHETIC DISPLAY FAILURE/);
      return true;
    });
    assert.equal(f.calls.filter(call => call.method === 'start').length, 1);
    assert.ok(!f.calls.some(call => call.method === 'finish'));
    assert.equal(f.prompts.length, 0);
  } finally { await f.client.close(); }
});