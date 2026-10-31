import test from 'node:test';
import assert from 'node:assert/strict';
import {SitefClient, SitefError} from '../dist/index.js';

const configuration = {server: '127.0.0.1', storeId: '00000000', terminalId: 'AA000001'};
const input = {functionId: 0, amount: '10,00', fiscalDocument: '12345', fiscalDate: '20261030', fiscalTime: '103045', operator: 'Caixa'};
class MemoryJournal {
  record;
  locked = false;
  async acquire() { assert.equal(this.locked, false); this.locked = true; }
  async release() { this.locked = false; }
  async read() { return this.record && structuredClone(this.record); }
  async write(record) { this.record = structuredClone(record); }
}
class Transport {
  calls = [];
  steps;
  failFinish = false;
  constructor(steps = [{status: 0}]) { this.steps = [...steps]; }
  async call(method, params = {}) {
    this.calls.push({method, params: structuredClone(params)});
    if (method === 'configure') return {status: 0};
    if (method === 'start' || method === 'startBanking') return {status: 10000};
    if (method === 'continue') return this.steps.shift() ?? {status: 0};
    if (method === 'finish') {
      if (this.failFinish) throw new Error('Synthetic process connection lost');
      return {returned: true};
    }
    return {};
  }
  async close() {}
}
const connect = (transport, journal, extra = {}) => SitefClient.connect({transport, journal, configuration, interaction: async () => ({}), ...extra});

test('retomada mantém decisão e escopo persistidos após perda da finalização', async () => {
  const journal = new MemoryJournal();
  const firstTransport = new Transport();
  const first = await connect(firstTransport, journal);
  const sale = await first.transact(input);
  const scope = '{NumeroPagamentoCupom=2}{ExtensaoFutura=valor}';
  firstTransport.failFinish = true;
  await assert.rejects(first.finalize(true, scope), error => error.code === 'FINALIZATION_UNCERTAIN');
  assert.equal(journal.record.finalizationParameters, scope);
  await first.close();

  const secondTransport = new Transport();
  const second = await connect(secondTransport, journal);
  assert.equal(second.state, 'uncertain');
  await assert.rejects(second.finalizeRecovery(false, sale.transactionId), error => error.code === 'RECOVERY_DECISION_MISMATCH');
  await assert.rejects(second.finalizeRecovery(true, sale.transactionId, '{NumeroPagamentoCupom=3}'), error => error.code === 'RECOVERY_SCOPE_MISMATCH');
  assert.equal(secondTransport.calls.filter(call => call.method === 'finish').length, 0);
  await second.finalizeRecovery(true, sale.transactionId);
  const finish = secondTransport.calls.find(call => call.method === 'finish');
  assert.deepEqual(finish.params, {confirm: 1, fiscalDocument: input.fiscalDocument, fiscalDate: input.fiscalDate, fiscalTime: input.fiscalTime, additionalParameters: scope});
  assert.equal(secondTransport.calls.some(call => call.method === 'start'), false);
  await second.close();
});

test('comando zero ecoa bytes originais mesmo quando o texto é uma decodificação com perda', async () => {
  const rawBase64 = Buffer.from([0xff, 0x81, 0xfe]).toString('base64');
  const transport = new Transport([
    {status: 10000, command: 0, fieldType: 99999, minLength: 0, maxLength: 0, buffer: '\uFFFD\uFFFD\uFFFD', bufferBase64: rawBase64},
    {status: 0},
  ]);
  const client = await connect(transport, new MemoryJournal(), {interaction: async () => { throw new Error('Command zero is not a collection'); }});
  const sale = await client.transact(input);
  const continues = transport.calls.filter(call => call.method === 'continue');
  assert.equal(continues[1].params.bufferBase64, rawBase64);
  assert.equal(sale.fields[0].bufferBase64, rawBase64);
  assert.equal(sale.fields[0].fieldType, 99999);
  await client.finalize(false);
  await client.close();
});

test('strings obrigatórias ausentes são rejeitadas antes de qualquer chamada financeira', async () => {
  for (const key of ['amount', 'fiscalDocument', 'fiscalDate', 'fiscalTime', 'operator']) {
    const transport = new Transport();
    const journal = new MemoryJournal();
    const client = await connect(transport, journal);
    const incomplete = {...input};
    delete incomplete[key];
    await assert.rejects(client.transact(incomplete), error => error instanceof SitefError && error.code.startsWith('INVALID_'));
    assert.equal(transport.calls.some(call => call.method === 'start'), false);
    assert.equal(journal.record, undefined);
    await client.close();
  }
});

test('início Corban usa a identidade fiscal registrada no journal e na finalização', async () => {
  const transport = new Transport();
  const client = await connect(transport, new MemoryJournal());
  await client.transact({...input, functionId: 310}, {nativeStart: {method: 'startBanking', params: {fiscalDocument: 'outra', fiscalDate: '20000101', fiscalTime: '000000', operator: 'Outro', additionalParameters: '{PortaPinPadCB=7}'}}});
  const start = transport.calls.find(call => call.method === 'startBanking');
  assert.equal(start.params.fiscalDocument, input.fiscalDocument);
  assert.equal(start.params.fiscalDate, input.fiscalDate);
  assert.equal(start.params.fiscalTime, input.fiscalTime);
  assert.equal(start.params.operator, input.operator);
  assert.equal(start.params.additionalParameters, '{PortaPinPadCB=7}');
  await client.finalize(true);
  const finish = transport.calls.find(call => call.method === 'finish');
  assert.equal(finish.params.fiscalDocument, start.params.fiscalDocument);
  assert.equal(finish.params.fiscalDate, start.params.fiscalDate);
  assert.equal(finish.params.fiscalTime, start.params.fiscalTime);
  await client.close();
});
