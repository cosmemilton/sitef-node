import test from 'node:test';
import assert from 'node:assert/strict';
import {SitefClient, FileJournal} from '../dist/index.js';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const configuration = {server: '127.0.0.1', storeId: '00000000', terminalId: 'AA000001', additionalParameters: '[NovoParametro=valor]'};
const input = {functionId: 0, amount: '10,00', fiscalDocument: '123456', fiscalDate: '20261030', fiscalTime: '120102', operator: 'Operador', additionalParameters: '{Futuro=1}'};
const exchange = (command, buffer = '', fieldType = 0) => ({status: 10000, command, fieldType, minLength: 0, maxLength: 20, buffer});
class MemoryJournal {
  record; locked = false; writes = []; failState;
  async acquire() { if (this.locked) throw new Error('locked'); this.locked = true; }
  async read() { return this.record; }
  async write(record) { if (record.state === this.failState) throw new Error('disk'); this.record = structuredClone(record); this.writes.push(this.record); }
  async release() { this.locked = false; }
}
class FakeTransport {
  calls = []; steps; fail; closed = false;
  constructor(steps = [{status: 0}]) { this.steps = [...steps]; }
  async call(method, params = {}) {
    this.calls.push({method, params});
    if (this.fail === method) throw new Error('bridge failure');
    if (method === 'configure') return {status: 0};
    if (method === 'start') return {status: 10000};
    if (method === 'continue') return this.steps.shift() ?? {status: 0};
    if (method === 'finish') return {returned: true};
    return {};
  }
  async close() { this.closed = true; }
}
async function setup(steps, interaction = async () => ({}), extra = {}) {
  const transport = new FakeTransport(steps), journal = new MemoryJournal();
  const client = await SitefClient.connect({configuration, transport, journal, interaction, ...extra});
  return {client, transport, journal};
}
test('preserva campos repetidos e desconhecidos, reinicia buffers e finaliza com identidade original', async () => {
  const seen = [];
  const {client, transport, journal} = await setup([exchange(30, 'Digite'), exchange(0, 'A', 99999), exchange(0, 'B', 99999), exchange(999, 'novo'), {status: 0}], async req => {
    seen.push(req); return {buffer: req.command === 30 ? 'entrada' : '', continueFlag: req.command === 999 ? 10000 : 0};
  });
  const result = await client.transact(input);
  assert.deepEqual(result.fields.map(f => f.buffer), ['A', 'B']);
  assert.equal(seen[1].kind, 'unknown');
  assert.equal(client.state, 'awaiting-finalization');
  await assert.rejects(client.transact(input), {code: 'SESSION_BUSY'});
  const continuations = transport.calls.filter(c => c.method === 'continue');
  assert.equal(continuations[2].params.buffer, 'A');
  assert.equal(continuations.at(-1).params.continueFlag, 10000);
  assert.equal(journal.writes[0].state, 'started');
  assert.equal(transport.calls.find(c => c.method === 'start').params.additionalParameters, '{Futuro=1}');
  assert.deepEqual(await client.finalize(true, '{NumeroPagamentoCupom=1}'), {returned: true, remoteConfirmation: 'not-reported'});
  assert.deepEqual(transport.calls.at(-1).params, {confirm: 1, fiscalDocument: '123456', fiscalDate: '20261030', fiscalTime: '120102', additionalParameters: '{NumeroPagamentoCupom=1}'});
  await client.close();
});
test('status positivo/negativo desconhecido não é perdido', async () => {
  for (const status of [987654, -987654]) {
    const {client} = await setup([{status}]);
    const result = await client.transact(input);
    assert.equal(result.status, status); assert.equal(result.requiresFinalization, false);
    await client.close();
  }
});
test('falha de callback aborta cooperativamente e esvazia buffer', async () => {
  const {client, transport} = await setup([exchange(999), exchange(1, 'aguarde'), {status: -2}], async () => { throw new Error('unsupported'); });
  await assert.rejects(client.transact(input), {code: 'INTERACTION_FAILED', nativeStatus: -2});
  assert.deepEqual(transport.calls.filter(c => c.method === 'continue').slice(1).map(c => c.params.continueFlag), [-1, -1]);
  assert.equal(client.state, 'idle'); await client.close();
});
test('AbortSignal interrompe callback pendente e continua até retorno terminal', async () => {
  const external = new AbortController();
  const {client, transport} = await setup([exchange(30), exchange(23), {status: -2}], async () => { external.abort(); return new Promise(() => {}); });
  const result = await client.transact(input, {signal: external.signal});
  assert.equal(result.status, -2);
  assert.equal(transport.calls.at(-1).params.continueFlag, -1);
  await client.close();
});
test('falha nativa mantém journal incerto e proíbe nova venda', async () => {
  const {client, transport, journal} = await setup(); transport.fail = 'continue';
  await assert.rejects(client.transact(input), {code: 'TRANSACTION_UNCERTAIN', uncertain: true});
  assert.equal(journal.record.state, 'uncertain');
  await assert.rejects(client.transact(input), {code: 'SESSION_BUSY'});
  await assert.rejects(client.callNative('pinpad'), {code: 'RECOVERY_REQUIRED'});
  await client.close();
});
test('disco falha antes da venda e impede entrada nativa', async () => {
  const {client, transport, journal} = await setup(); journal.failState = 'started';
  await assert.rejects(client.transact(input));
  assert.equal(transport.calls.some(c => c.method === 'start'), false);
  assert.equal(client.state, 'idle'); await client.close();
});
test('disco falha depois do retorno aprovado: resultado permanece incerto', async () => {
  const {client, journal} = await setup(); journal.failState = 'awaiting-finalization';
  await assert.rejects(client.transact(input), {code: 'TRANSACTION_UNCERTAIN'});
  assert.equal(client.state, 'uncertain'); await client.close();
});
test('perda na finalização não vira confirmação remota ou repetição', async () => {
  const {client, transport, journal} = await setup();
  await client.transact(input); transport.fail = 'finish';
  await assert.rejects(client.finalize(false), {code: 'FINALIZATION_UNCERTAIN'});
  assert.equal(client.state, 'uncertain'); assert.equal(journal.record.decision, 0);
  assert.equal(transport.calls.filter(c => c.method === 'finish').length, 1);
  await client.close();
});
test('recuperação não inicia nova transação e exige identidade explícita', async () => {
  const journal = new MemoryJournal();
  journal.record = {version: 1, id: 'recovery-id', ...configuration, ...input, state: 'started', updatedAt: '2026-10-30'};
  const transport = new FakeTransport();
  const client = await SitefClient.connect({configuration, transport, journal, interaction: async () => ({})});
  assert.equal(client.state, 'uncertain');
  await assert.rejects(client.finalizeRecovery(false, 'wrong'), {code: 'INVALID_RECOVERY'});
  await client.finalizeRecovery(false, 'recovery-id'); assert.equal(client.state, 'idle');
  await client.close();
});
test('valida dinheiro/data sem chamadas financeiras', async () => {
  const {client, transport} = await setup();
  await assert.rejects(client.transact({...input, amount: 10.23}), {code: 'INVALID_ARGUMENT'});
  await assert.rejects(client.transact({...input, fiscalDate: '20260230'}), {code: 'INVALID_FISCAL_ID'});
  assert.equal(transport.calls.some(c => c.method === 'start'), false); await client.close();
});
test('journal em disco é atômico, exclusivo e não guarda dados coletados', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitef-test-'));
  try {
    const path = join(directory, 'terminal.journal.json'), a = new FileJournal(path), b = new FileJournal(path);
    const {client} = await setup([exchange(0, 'SENSITIVE', 121), {status: 0}], undefined, {journal: a});
    await assert.rejects(b.acquire(), {code: 'EEXIST'});
    await client.transact(input);
    assert.equal((await readFile(path, 'utf8')).includes('SENSITIVE'), false);
    await client.finalize(false); await client.close();
    await b.acquire(); assert.equal((await b.read()).state, 'finalized-local'); await b.release();
  } finally { await rm(directory, {recursive: true, force: true}); }
});
test('falha tardia do observador de polling não cancela a próxima transação', async () => {
  let rejectOldObserver;
  let respond;
  let activeSignal;
  const {client, transport} = await setup([exchange(23), {status: 0}], async (_request, {signal}) => {
    activeSignal = signal; return new Promise(resolve => { respond = resolve; });
  }, {onExchange: request => request.command === 23 ? new Promise((_resolve, reject) => { rejectOldObserver = reject; }) : undefined});
  await client.transact(input); await client.finalize(false);
  transport.steps = [exchange(30), {status: -2}];
  const next = client.transact(input);
  while (!respond) await new Promise(resolve => setImmediate(resolve));
  rejectOldObserver(new Error('late observer failure'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(activeSignal.aborted, false);
  respond({buffer: 'ok'}); await next; await client.close();
});
