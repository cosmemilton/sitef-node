import test from 'node:test';
import assert from 'node:assert/strict';
import { displayResultReceipts } from '../../../examples/cli/interaction.mjs';
import { terminalIO } from '../../../examples/cli/terminal.mjs';
import { SitefClient } from '../dist/index.js';

const receipt = (fieldType, buffer, changes = {}) => ({
  id: 'synthetic:' + fieldType, fieldType, buffer, timing: 'deferred', printed: false, ...changes
});
const resultWith = receipts => ({ status: 0, details: { receipts } });
function screen() {
  return { writes: [], write(text) { this.writes.push(text); } };
}

test('CLI receipts: either configured copy is presented independently', () => {
  for (const [fieldType, copy] of [[121, 'via do cliente'], [122, 'via da loja']]) {
    const io = screen();
    assert.equal(displayResultReceipts(resultWith([receipt(fieldType, 'COMPROVANTE SINTETICO\nTOTAL 5,25\n')]), io), 1);
    assert.deepEqual(io.writes, [
      '[Comprovante 1: ' + copy + ', campo ' + fieldType + ']', 'COMPROVANTE SINTETICO\nTOTAL 5,25\n'
    ]);
    assert.ok(!io.writes[0].includes(fieldType === 121 ? '122' : '121'));
  }
});

test('CLI receipts: both copies retain returned order and repeated occurrences', () => {
  const io = screen();
  const receipts = [receipt(122, 'LOJA UM'), receipt(121, 'CLIENTE'), receipt(122, 'LOJA DOIS'), receipt(121, 'CLIENTE')];
  assert.equal(displayResultReceipts(resultWith(receipts), io), 4);
  assert.deepEqual(io.writes, [
    '[Comprovante 1: via da loja, campo 122]', 'LOJA UM',
    '[Comprovante 2: via do cliente, campo 121]', 'CLIENTE',
    '[Comprovante 3: via da loja, campo 122]', 'LOJA DOIS',
    '[Comprovante 4: via do cliente, campo 121]', 'CLIENTE'
  ]);
});

test('CLI receipts: absent copies are not invented and other fields are never dumped', () => {
  for (const result of [{ status: 0 }, { status: -2 }, { details: {} }, resultWith([]), resultWith([
    receipt(120, 'SYNTHETIC_CHEQUE_AUTH'), receipt(625, 'SYNTHETIC_OTHER_FORMAT')
  ])]) {
    Object.defineProperties(result, {
      fields: { get() { assert.fail('Raw fields must not be read for receipt presentation.'); } },
      rawValues: { get() { assert.fail('Raw values must not be read for receipt presentation.'); } }
    });
    const io = screen();
    assert.equal(displayResultReceipts(result, io), 0);
    assert.deepEqual(io.writes, []);
  }
});

test('CLI receipts: exact LF layout, spaces, empty copies and literal backslashes survive', () => {
  const io = screen();
  const text = '  COMPROVANTE SINTETICO  \n\tTOTAL 5,25\n\nC:\\local\\arquivo\n';
  assert.equal(displayResultReceipts(resultWith([receipt(121, text), receipt(122, '')]), io), 2);
  assert.equal(io.writes[1], text);
  assert.equal(io.writes[3], '');
});

test('CLI receipts: terminal controls are inert and raw result/printed flags remain untouched', () => {
  const io = screen();
  const first = Object.freeze(receipt(121, '\x1b[2JCLIENTE\r\n\x07\x00TOTAL 1,00\x9b', {
    bufferBase64: 'SYNTHETIC_BASE64_NEVER_DISPLAY', billIndex: 'SYNTHETIC_METADATA_NEVER_DISPLAY'
  }));
  const second = Object.freeze(receipt(122, 'LOJA', { printed: true, timing: 'immediate' }));
  const receipts = Object.freeze([first, second]);
  const result = Object.freeze({ status: -1, details: Object.freeze({ receipts }) });
  const before = structuredClone(result);
  assert.equal(displayResultReceipts(result, io), 2);
  assert.equal(io.writes[1], '[2JCLIENTE\nTOTAL 1,00');
  assert.doesNotMatch(io.writes.join('\n'), /[\x00-\x08\x0b-\x1f\x7f-\x9f]|SYNTHETIC_BASE64|SYNTHETIC_METADATA/);
  assert.deepEqual(result, before);
});

test('CLI receipts: no base64 fallback or invented text for malformed receipt buffers', () => {
  for (const buffer of [undefined, null, { secret: 'SYNTHETIC_PRIVATE' }]) {
    const io = screen();
    assert.throws(() => displayResultReceipts(resultWith([receipt(121, buffer, { bufferBase64: 'SYNTHETIC_PRIVATE' })]), io),
      error => error.code === 'CLI_INVALID_RECEIPT_TEXT' && !error.message.includes('SYNTHETIC_PRIVATE'));
    assert.deepEqual(io.writes, []);
  }
});

test('CLI receipts: production terminal refuses redirected input or output', () => {
  for (const [inputTTY, outputTTY] of [[false, true], [true, false], [false, false]])
    assert.throws(() => terminalIO({ isTTY: inputTTY }, { isTTY: outputTTY }), /Redirecionamento/);
});


test('CLI receipts: actual SDK synthetic result displays copies without printing, persisting or finalizing', async () => {
  let record;
  const calls = [];
  const copies = [receipt(122, 'SYNTHETIC STORE\nTOTAL 5,25'), receipt(121, 'SYNTHETIC CUSTOMER\nTOTAL 5,25'), receipt(121, '')];
  const steps = copies.map(({ fieldType, buffer }) => ({ status: 10000, command: 0, fieldType, buffer, minLength: 0, maxLength: 0 }));
  steps.push({ status: 0 });
  const client = await SitefClient.connect({
    transport: {
      async call(method) {
        calls.push(method);
        if (method === 'configure') return { status: 0 };
        if (method === 'start') return { status: 10000 };
        if (method === 'continue') return steps.shift();
        assert.fail('Unexpected native action ' + method);
      },
      async close() {}
    },
    configuration: { server: '127.0.0.1', storeId: '00000000', terminalId: 'SR000001' },
    journal: { async acquire() {}, async release() {}, async read() { return record; }, async write(next) { record = next; } },
    fields: {
      receiptStoragePolicy: 'explicit-return',
      hooks: {
        printReceipt() { assert.fail('Display must not invoke physical printing.'); },
        storeReceipt() { assert.fail('Display must not persist receipt bodies.'); }
      }
    },
    interaction() { assert.fail('Synthetic output-only sequence must not prompt.'); }
  });
  try {
    const result = await client.transact({
      functionId: 3, amount: '5,25', fiscalDocument: 'SYNTHETICRECEIPTS',
      fiscalDate: '20261107', fiscalTime: '120000', operator: 'TEST'
    });
    const io = screen();
    const callsBefore = [...calls];
    assert.equal(displayResultReceipts(result, io), 3);
    assert.deepEqual(io.writes.filter((_, index) => index % 2 === 1), copies.map(copy => copy.buffer));
    assert.deepEqual(calls, callsBefore);
    assert.ok(result.details.receipts.every(copy => copy.printed === false));
    assert.equal(client.state, 'awaiting-finalization');
    assert.doesNotMatch(JSON.stringify(record), /SYNTHETIC STORE|SYNTHETIC CUSTOMER|TOTAL 5,25/);
  } finally {
    await client.close();
  }
  assert.equal(record.state, 'awaiting-finalization');
  assert.ok(!calls.includes('finish'));
});
