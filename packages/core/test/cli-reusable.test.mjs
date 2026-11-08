import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { main, connectClient, fiscalInput, runSession, runSimulation } from '../../../examples/windows-cli.mjs';
import { createCallbacks } from '../../../examples/cli/interaction.mjs';
import { collectFunctionInput } from '../../../examples/cli/functions.mjs';
import { ClientSitef, SitefError, getPartialTransaction } from '../dist/index.js';
import { cliConnection } from '../../../examples/cli/connection.mjs';

const configuration = { server: 'synthetic', storeId: '00000000', terminalId: 'SR000001' };
const capabilities = { protocolVersion: 1, platform: 'windows', architecture: 'x86_64', fieldTypeBytes: 4 };
const field = (fieldType, buffer = '') => ({ status: 10000, command: 0, fieldType, buffer, minLength: 0, maxLength: 1000 });
function terminal(answers = []) {
  return {
    writes: [], prompts: [],
    write(text) { this.writes.push(text); },
    async ask(prompt, options) {
      this.prompts.push({ prompt, options });
      assert.ok(answers.length, 'unexpected prompt: ' + prompt);
      return answers.shift();
    }
  };
}
function fakeTransport(cycles = []) {
  let steps;
  return {
    calls: [],
    async call(method, params) {
      this.calls.push({ method, params });
      if (method === 'load') return capabilities;
      if (method === 'configure') return { status: 0 };
      if (method === 'start') { assert.ok(cycles.length, 'unexpected start'); steps = [...cycles.shift()]; return { status: 10000 }; }
      if (method === 'continue') {
        assert.ok(steps.length, 'unexpected continue');
        const next = steps.shift();
        if (next instanceof Error) throw next;
        return typeof next === 'function' ? next(params) : next;
      }
      if (method === 'finish') return { returned: true };
      assert.fail('Unexpected native action ' + method);
    },
    async close() { this.calls.push({ method: 'close' }); }
  };
}
async function prepared(fn) {
  const root = await mkdtemp(join(tmpdir(), 'sitef-cli-reusable-'));
  try {
    const directory = join(root, 'synthetic-runtime');
    await mkdir(directory);
    await writeFile(join(directory, 'CliSiTef64I.dll'), 'INERT TEST FILE, NEVER EXECUTE');
    await writeFile(join(root, 'sitef-bridge.exe'), 'INERT TEST FILE, NEVER EXECUTE');
    await fn(root, directory);
  } finally { await rm(root, { recursive: true, force: true }); }
}

// Todos os testes usam transporte sintetico; nenhum binario do fornecedor e executado.
test('CLI reusable main: one load/configure/close, pending sale then exact confirmation then another operation',
  { skip: process.platform !== 'win32' }, async () => prepared(async (root, directory) => {
    const io = terminal(['3', '1,00', '3', '2', '2,00', '1', '111', '']);
    const transport = fakeTransport([
      [field(122, 'STORE FIRST'), field(121, 'CUSTOMER FIRST'), field(170, 'never-dump-fields'), { status: 0 }],
      [field(5074), field(121, 'CUSTOMER SECOND'), field(121, 'CUSTOMER SECOND REPEAT'), { status: 0 }],
      [{ status: 0 }]
    ]);
    let created = 0;
    await main(['--diretorio', root, '--runtime', directory], {
      createIO: () => io, createTransport: () => { created++; return transport; }
    });
    assert.equal(created, 1);
    for (const method of ['load', 'configure', 'close']) assert.equal(transport.calls.filter(c => c.method === method).length, 1);
    const starts = transport.calls.filter(c => c.method === 'start');
    assert.deepEqual(starts.map(c => c.params.functionId), [3, 2, 111]);
    assert.deepEqual(starts.map(c => c.params.amount), ['1,00', '2,00', '']);
    assert.equal(new Set(starts.map(c => c.params.fiscalDocument)).size, 3);
    const finish = transport.calls.filter(c => c.method === 'finish');
    assert.equal(finish.length, 1);
    assert.equal(finish[0].params.confirm, 1);
    assert.equal(finish[0].params.fiscalDocument, starts[1].params.fiscalDocument);
    assert.equal(transport.calls.at(-1).method, 'close');
    assert.equal(io.prompts.filter(p => p.prompt.startsWith('Finalizacao')).length, 2);
    assert.doesNotMatch(io.writes.join('\n'), /never-dump-fields/);
    assert.deepEqual(io.writes.filter(x => /^(STORE|CUSTOMER)/.test(x)),
      ['STORE FIRST', 'CUSTOMER FIRST', 'CUSTOMER SECOND', 'CUSTOMER SECOND REPEAT']);
    assert.ok(io.writes.some(x => x.includes('5074')));
    assert.ok(io.writes.some(x => x.includes('nao comprova impressao nem assinatura')));
    const names = await readdir(join(root, 'state', 'automation'));
    assert.equal(names.length, 1); assert.match(names[0], /\.journal\.json$/);
    const bytes = await readFile(join(root, 'state', 'automation', names[0]), 'utf8');
    const record = JSON.parse(bytes);
    assert.equal(record.payments.length, 2);
    assert.deepEqual(record.payments.map(p => p.state), ['awaiting-finalization', 'finalized-local']);
    assert.ok(record.payments.slice(0, 2).every(p => p.receipts.every(r => r.printed === false)));
    assert.equal(record.payments[1].signatureRequired, true);
    assert.notEqual(record.payments[1].signatureCaptured, true);
    assert.doesNotMatch(bytes, /STORE FIRST|CUSTOMER|never-dump-fields/);
  }));

test('CLI reusable main: exit before load creates no client or state, --funcao runs once',
  { skip: process.platform !== 'win32' }, async () => prepared(async (root, directory) => {
    await main(['--diretorio', root, '--runtime', directory], {
      createIO: () => terminal(['']), createTransport() { assert.fail('must not load'); }
    });
    assert.deepEqual((await readdir(root)).sort(), ['sitef-bridge.exe', 'synthetic-runtime']);
    const transport = fakeTransport([[{ status: -2 }]]), io = terminal(['1,00']);
    await main(['--funcao', '3', '--diretorio', root, '--runtime', directory], {
      createIO: () => io, createTransport: () => transport
    });
    assert.equal(io.prompts.length, 1);
    assert.equal(transport.calls.filter(c => c.method === 'start').length, 1);
    assert.equal(transport.calls.at(-1).method, 'close');
  }));

test('CLI reusable session: pending transactions do not block, abort at next menu closes without another start', async () => {
  const transport = fakeTransport([[{ status: 0 }]]);
  const io = terminal(['3']);
  const ask = io.ask.bind(io);
  io.ask = async (prompt, options) => {
    if (prompt.startsWith('Finalizacao')) return ask(prompt, options);
    process.emit('SIGINT');
    assert.equal(options.signal.aborted, true);
    return '2';
  };
  const client = await ClientSitef.create(cliConnection({ transport, directory: process.cwd(), configuration, io }).options);
  await runSession({ client, transport, input: fiscalInput('1,00', 3), io, repeat: true });
  assert.equal(transport.calls.filter(c => c.method === 'start').length, 1);
  assert.equal(transport.calls.filter(c => c.method === 'finish').length, 0);
  assert.equal(client.recovery.payments[0].state, 'awaiting-finalization');
});

test('CLI reusable session: SIGINT during native cycle is cooperative and never confirms', async () => {
  const transport = fakeTransport([[
    () => { process.emit('SIGINT'); return { status: 10000, command: 23, fieldType: -1, buffer: '', minLength: 0, maxLength: 0 }; },
    params => { assert.equal(params.continueFlag, -1); return { status: -2 }; }
  ]]);
  const io = terminal(), before = process.listenerCount('SIGINT');
  const client = await ClientSitef.create(cliConnection({ transport, directory: process.cwd(), configuration, io }).options);
  await runSession({ client, transport, input: fiscalInput('1,00', 3), io, repeat: true });
  assert.equal(process.listenerCount('SIGINT'), before);
  assert.equal(io.prompts.length, 0);
  assert.equal(transport.calls.filter(c => c.method === 'finish').length, 0);
  assert.equal(client.recovery.payments[0].status, -2);
});

test('CLI reusable session: uncertain failure retains partial result and original error without retry', async () => {
  const timeout = new SitefError('BRIDGE_TIMEOUT', 'private-native-error', { uncertain: true });
  const transport = fakeTransport([[field(170, 'private-result-value'), timeout]]), io = terminal();
  const client = await ClientSitef.create(cliConnection({ transport, directory: process.cwd(), configuration, io }).options);
  await assert.rejects(runSession({ client, transport, input: fiscalInput('1,00', 3), io, repeat: true }), error => {
    assert.equal(error.code, 'TRANSACTION_UNCERTAIN');
    assert.equal(getPartialTransaction(error).data.getLast(170).raw, 'private-result-value');
    return true;
  });
  assert.equal(transport.calls.filter(c => c.method === 'start').length, 1);
  assert.equal(transport.calls.filter(c => c.method === 'finish').length, 0);
  assert.equal(transport.calls.at(-1).method, 'close');
  assert.equal(io.prompts.length, 0);
  assert.doesNotMatch(io.writes.join('\n'), /private-result-value|private-native-error/);
});

test('CLI facade: preserves unknown status, returned data, receipts, no implicit financial action', async () => {
  const transport = fakeTransport([[field(170, 'private-data'), field(121, 'RETURNED COPY'), { status: 876543 }]]);
  const io = terminal();
  const client = await ClientSitef.create(cliConnection({ transport, directory: process.cwd(), configuration, io }).options);
  const result = await runSimulation(client, fiscalInput('1,00', 3), io);
  assert.equal(result.status, 876543);
  assert.equal(result.data.getLast(170).raw, 'private-data');
  assert.equal(result.details.receipts[0].printed, false);
  assert.ok(io.writes.includes('RETURNED COPY'));
  assert.doesNotMatch(io.writes.join('\n'), /private-data/);
  await client.close();
  assert.equal(transport.calls.filter(c => c.method === 'finish').length, 0);
});

test('CLI callbacks: typed categories retain raw validation and unsupported QR fails explicitly', async () => {
  const io = terminal(['s', '9', '1,25']), callbacks = createCallbacks(io), signal = new AbortController().signal;
  const request = command => ({ status: 10000, command, fieldType: 99999, buffer: '', minLength: 0, maxLength: 40 });
  assert.deepEqual(await callbacks.confirm(request(20), { signal }), { buffer: '0' });
  assert.deepEqual(await callbacks.menu({ ...request(21), buffer: '9:Nove;' }, { signal }), { buffer: '9' });
  assert.deepEqual(await callbacks.collect(request(34), { signal }), { buffer: '1,25' });
  await assert.rejects(callbacks.qr({ ...request(50), buffer: 'private-qr' }, { signal }), { code: 'CLI_QR_RENDERER_REQUIRED' });
  await assert.rejects(callbacks.raw(request(999), { signal }), { code: 'CLI_UNSUPPORTED_COMMAND' });
  assert.doesNotMatch(io.writes.join('\n'), /private-qr/);
  assert.equal(await collectFunctionInput(terminal(), undefined, { signal: AbortSignal.abort() }), null);
});

test('CLI connection: unsafe field width is rejected before configure without duplicating load', async () => {
  const transport = fakeTransport();
  transport.call = async function (method) { this.calls.push({ method }); assert.equal(method, 'load'); return { ...capabilities, fieldTypeBytes: 2 }; };
  await assert.rejects(connectClient({ transport, directory: process.cwd(), configuration, io: terminal() }), { code: 'CLI_INCOMPATIBLE_BRIDGE' });
  assert.deepEqual(transport.calls.map(c => c.method), ['load', 'close']);
});

test('CLI lifecycle: dispose and close failure do not replace the original processing failure', async () => {
  const error = new SitefError('ORIGINAL_FAILURE', 'private original'), calls = [];
  const tx = {
    async process() { calls.push('process'); throw error; },
    dispose() { calls.push('dispose'); throw new SitefError('TRANSACTION_ACTIVE', 'still active'); },
    cancel() { calls.push('cancel'); }
  };
  const client = {
    createTransaction() { return tx; },
    async close() { calls.push('close'); throw Error('close failure'); }
  };
  await assert.rejects(runSession({ client, transport: { async close() { calls.push('transport.close'); } },
    input: fiscalInput('1,00', 3), io: terminal() }), e => e === error);
  assert.deepEqual(calls, ['process', 'dispose', 'close', 'transport.close']);
  await assert.rejects(runSimulation(client, fiscalInput('1,00', 3), terminal()), e => e === error);
});


test('CLI legacy connectClient: returns SitefClient methods and preserves interactive callbacks', async () => {
  const transport = fakeTransport([[
    { status: 10000, command: 21, fieldType: -1, buffer: '7:Sete;', minLength: 0, maxLength: 1 }, { status: 0 }
  ]]);
  const io = terminal(['7']);
  const client = await connectClient({ transport, directory: process.cwd(), configuration, io });
  assert.equal(typeof client.transact, 'function');
  assert.equal(typeof client.finalizeTransaction, 'function');
  const result = await client.transact(fiscalInput('1,00', 3));
  await client.finalizeTransaction(false, result.transactionId);
  await client.close();
  assert.equal(transport.calls.filter(c => c.method === 'finish').length, 1);
  assert.equal(transport.calls.find(c => c.method === 'finish').params.confirm, 0);
  assert.equal(io.prompts.length, 1);
});

test('CLI reusable facade: screen printing is simulated while native status stays original', async () => {
  for (const functionId of [110, 123]) {
    const transport = fakeTransport([[field(121, 'PRIVATE IMMEDIATE RECEIPT'), { status: -2 }]]), io = terminal();
    const client = await ClientSitef.create(cliConnection({ transport, directory: process.cwd(), configuration, io }).options);
    await runSession({ client, transport, input: fiscalInput('', functionId), io, repeat: false });
    assert.equal(transport.calls.filter(c => c.method === 'finish').length, 0);
    assert.equal(transport.calls.filter(c => c.method === 'start').length, 1);
    assert.equal(transport.calls.filter(c => c.method === 'continue').at(-1).params.continueFlag, 0);
    assert.equal(io.prompts.length, 0);
    assert.equal(io.writes.filter(line => line === 'PRIVATE IMMEDIATE RECEIPT').length, 1);
    assert.equal(client.recovery.payments[0].status, -2);
    assert.equal(client.recovery.payments[0].receipts[0].printed, true);
  }
});
