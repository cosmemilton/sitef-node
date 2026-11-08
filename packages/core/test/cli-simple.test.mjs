import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main, transactionInput } from '../../../examples/windows-simple.mjs';
import { SitefError, getPartialTransaction } from '../dist/index.js';

// Real SDK, synthetic transport only. The placeholder DLL/EXE are never executed.
const windows = { skip: process.platform !== 'win32' || process.arch !== 'x64' };
const capabilities = { protocolVersion: 1, platform: 'windows', architecture: 'x86_64', fieldTypeBytes: 4 };
const field = (fieldType, buffer = '') => ({ status: 10000, command: 0, fieldType, buffer, minLength: 0, maxLength: 1000 });
function terminal(answers = []) {
  return {
    writes: [], prompts: [],
    write(text) { this.writes.push(text); },
    async ask(prompt, options) {
      this.prompts.push({ prompt, options });
      assert.ok(answers.length, 'unexpected prompt: ' + prompt);
      const answer = answers.shift();
      return typeof answer === 'function' ? answer(prompt, options) : answer;
    }
  };
}
function fakeTransport(cycles = [], finishError) {
  let steps;
  return {
    calls: [],
    async call(method, params) {
      this.calls.push({ method, params });
      if (method === 'load') return capabilities;
      if (['configure', 'pinpadPermanentMessage'].includes(method)) return { status: 0 };
      if (method === 'start') { assert.ok(cycles.length, 'unexpected start'); steps = [...cycles.shift()]; return { status: 10000 }; }
      if (method === 'continue') {
        assert.ok(steps.length, 'unexpected continue');
        const next = steps.shift();
        if (next instanceof Error) throw next;
        return typeof next === 'function' ? next(params) : next;
      }
      if (method === 'finish') { if (finishError) throw finishError; return { returned: true }; }
      assert.fail('Unexpected native action ' + method);
    },
    async close() { this.calls.push({ method: 'close' }); }
  };
}
const calls = (transport, method) => transport.calls.filter(call => call.method === method);
async function prepared(fn) {
  const parent = resolve(tmpdir());
  const root = await mkdtemp(join(parent, 'sitef-cli-simple-'));
  assert.equal(dirname(resolve(root)), parent);
  assert.ok(basename(root).startsWith('sitef-cli-simple-'));
  try {
    const directory = join(root, 'synthetic-runtime');
    await mkdir(directory);
    await writeFile(join(directory, 'CliSiTef64I.dll'), 'INERT TEST FILE, NEVER EXECUTE');
    await writeFile(join(root, 'sitef-bridge.exe'), 'INERT TEST FILE, NEVER EXECUTE');
    const run = (io, transport, env = {}) => main({
      env: { SITEF_ROOT: root, SITEF_RUNTIME: directory, ...env },
      createIO: () => io, createTransport: () => transport
    });
    await fn({ root, directory, run });
  } finally {
    // Delete only this exact, verified mkdtemp result, never operational paths.
    assert.equal(dirname(resolve(root)), parent);
    assert.ok(basename(root).startsWith('sitef-cli-simple-'));
    await rm(root, { recursive: true, force: true });
  }
}
async function journal(root) {
  const directory = join(root, 'state', 'automation');
  const names = await readdir(directory);
  assert.equal(names.length, 1, 'writer lock must be released');
  assert.match(names[0], /\.journal\.json$/);
  const bytes = await readFile(join(directory, names[0]), 'utf8');
  return { bytes, record: JSON.parse(bytes) };
}

test('simple fiscal helper preserves caller parameters and makes unique documents at the same instant', () => {
  const documents = new Set(), now = new Date(2026, 10, 8, 9, 10, 11);
  const env = { SITEF_OPERATOR: 'TEST', SITEF_TRANSACTION_PARAMS: '[synthetic=1]' };
  const input = transactionInput({ functionId: 3, amount: '1,00' }, env, documents, now);
  assert.equal(input.fiscalDate, '20261108'); assert.equal(input.fiscalTime, '091011');
  assert.equal(input.operator, 'TEST'); assert.equal(input.additionalParameters, '[synthetic=1]');
  assert.equal(input.functionId, 3); assert.equal(input.amount, '1,00');
  assert.notEqual(transactionInput({ functionId: 3 }, env, documents, now).fiscalDocument, input.fiscalDocument);
  assert.equal(transactionInput({}, {}, new Set(), now).operator, 'DEV');
  assert.equal(transactionInput({}, {}, new Set(), now).additionalParameters, '');
});

test('simple initializes once before the first menu even when immediately exiting', windows, () => prepared(async ({ root, run }) => {
  const before = process.listenerCount('SIGINT');
  const transport = fakeTransport();
  const io = terminal([() => {
    assert.deepEqual(transport.calls.map(c => c.method), ['load', 'configure']);
    return '';
  }]);
  assert.equal(await run(io, transport), undefined);
  assert.deepEqual(transport.calls.map(c => c.method), ['load', 'configure', 'close']);
  assert.deepEqual(await readdir(join(root, 'state', 'automation')), []);
  assert.equal(process.listenerCount('SIGINT'), before);
}));

for (const stage of ['load', 'configure']) test('simple ' + stage + ' failure precedes menu and releases resources', windows, () => prepared(async ({ root, run }) => {
  const transport = fakeTransport(), call = transport.call.bind(transport);
  const original = new SitefError('SYNTHETIC_INITIALIZATION_FAILURE', 'synthetic initialization failure');
  transport.call = async (method, params) => {
    if (method === stage) { transport.calls.push({ method, params }); throw original; }
    return call(method, params);
  };
  const io = terminal(), before = process.listenerCount('SIGINT');
  await assert.rejects(run(io, transport), error => error === original);
  assert.deepEqual(io.prompts, []);
  assert.equal(calls(transport, 'start').length, 0);
  assert.equal(calls(transport, 'finish').length, 0);
  assert.equal(calls(transport, stage).length, 1);
  assert.equal(calls(transport, 'close').length, 1);
  assert.equal(transport.calls.at(-1).method, 'close');
  assert.deepEqual(await readdir(join(root, 'state', 'automation')), []);
  assert.equal(process.listenerCount('SIGINT'), before);
}));

for (const stage of ['load', 'configure']) for (const fallbackFails of [false, true])
  test('simple ' + stage + ' cleanup failure uses one raw close fallback, failing=' + fallbackFails, windows, () => prepared(async ({ root, run }) => {
    const transport = fakeTransport(), call = transport.call.bind(transport);
    const original = new SitefError('SYNTHETIC_INITIALIZATION_FAILURE', 'private initialization failure', { nativeStatus: -98765 });
    transport.call = async (method, params) => {
      if (method === stage) { transport.calls.push({ method, params }); throw original; }
      return call(method, params);
    };
    transport.close = async () => {
      transport.calls.push({ method: 'close' });
      if (calls(transport, 'close').length === 1 || fallbackFails) throw Error('private cleanup failure');
    };
    const io = terminal(), before = process.listenerCount('SIGINT');
    await assert.rejects(run(io, transport), error => {
      assert.equal(error.code, original.code);
      assert.equal(error.nativeStatus, original.nativeStatus);
      assert.equal(error.cleanupFailed, true);
      assert.equal(error.uncertain, true);
      return true;
    });
    assert.deepEqual(io.prompts, []);
    assert.deepEqual(transport.calls.map(c => c.method), stage === 'load'
      ? ['load', 'close', 'close'] : ['load', 'configure', 'close', 'close']);
    assert.equal(calls(transport, 'start').length, 0);
    assert.equal(calls(transport, 'finish').length, 0);
    assert.deepEqual(await readdir(join(root, 'state', 'automation')), []);
    assert.equal(process.listenerCount('SIGINT'), before);
    assert.doesNotMatch(io.writes.join('\n'), /private initialization failure|private cleanup failure/);
  }));

test('simple rejects obsolete arguments before creating state or loading native code', windows, () => prepared(async ({ root, directory }) => {
  const script = fileURLToPath(new URL('../../../examples/windows-simple.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--verificar'], {
    env: { ...process.env, SITEF_ROOT: root, SITEF_RUNTIME: directory }, encoding: 'utf8', timeout: 15000
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /nao aceita opcoes/);
  assert.doesNotMatch(result.stdout + result.stderr, /Registro desta execucao|BRIDGE|ENOENT|DLL_LOAD/);
  assert.deepEqual((await readdir(root)).sort(), ['sitef-bridge.exe', 'synthetic-runtime']);
}));

test('simple top-level config, transaction params and optional permanent message are forwarded', windows, () => prepared(async ({ root, directory }) => {
  const transport = fakeTransport([[{ status: -2 }]]);
  await main({ env: { SITEF_ROOT: root, SITEF_RUNTIME: directory,
    SITEF_SERVER: 'synthetic', SITEF_STORE: '12345678', SITEF_TERMINAL: 'TS000001',
    SITEF_CONFIG_PARAMS: '[config=synthetic]', SITEF_OPERATOR: 'TEST',
    SITEF_TRANSACTION_PARAMS: '[tx=synthetic]', SITEF_PINPAD_MESSAGE: 'TEST ONLY' },
    createIO: () => terminal(['3', '1', '']), createTransport: () => transport });
  assert.deepEqual(calls(transport, 'configure')[0].params, { server: '127.0.0.1', storeId: '00000000', terminalId: 'SR000001', reserved: 0, additionalParameters: '' });
  assert.deepEqual(calls(transport, 'pinpadPermanentMessage')[0].params, { message: 'TEST ONLY' });
  assert.equal(calls(transport, 'start')[0].params.operator, 'TEST');
  assert.equal(calls(transport, 'start')[0].params.additionalParameters, '[tx=synthetic]');
  assert.equal(calls(transport, 'start').length, 1);
}));

test('simple multiple operations reuse one client and pending/confirm/undo bind exact fiscal document', windows, () => prepared(async ({ root, run }) => {
  const transport = fakeTransport([[{ status: 0 }], [{ status: 0 }], [{ status: 0 }]]);
  const io = terminal(['3', '1', '3', '2', '2', '1', '3', '3', '2', '']);
  const result = await run(io, transport);
  assert.equal(result.status, 0);
  for (const method of ['load', 'configure', 'close']) assert.equal(calls(transport, method).length, 1);
  assert.equal(calls(transport, 'pinpadPermanentMessage').length, 0);
  const starts = calls(transport, 'start'), finishes = calls(transport, 'finish');
  assert.deepEqual(starts.map(c => c.params.functionId), [3, 2, 3]);
  assert.equal(new Set(starts.map(c => c.params.fiscalDocument)).size, 3);
  assert.deepEqual(finishes.map(c => c.params.confirm), [1, 0]);
  assert.deepEqual(finishes.map(c => c.params.fiscalDocument), starts.slice(1).map(c => c.params.fiscalDocument));
  assert.deepEqual((await journal(root)).record.payments.map(p => p.state), ['awaiting-finalization', 'finalized-local', 'finalized-local']);
}));

for (const functionId of [3, 110, 123]) test('simple receipts 121/122 keep repeated occurrences exactly once, function ' + functionId, windows, () => prepared(async ({ root, run }) => {
  const transport = fakeTransport([[field(122, 'STORE COPY'), field(121, 'SAME COPY'), field(121, 'SAME COPY'), field(987654, 'private-unknown-value'), field(987654, 'private-unknown-repeat'), { status: 0 }]]);
  const io = terminal(functionId === 3 ? ['3', '1', '3', ''] : functionId === 123 ? ['123', '3', ''] : ['110', '']);
  const result = await run(io, transport);
  assert.equal(result.data.getLast(987654).raw, 'private-unknown-repeat');
  assert.equal(result.fields.filter(f => f.fieldType === 987654).length, 2);
  assert.equal(result.details.receipts.length, 3);
  assert.equal(new Set(result.details.receipts.map(r => r.id)).size, 3);
  assert.equal(io.writes.filter(line => line === 'STORE COPY').length, 1);
  assert.equal(io.writes.filter(line => line === 'SAME COPY').length, 2);
  assert.equal(calls(transport, 'finish').length, 0);
  if (functionId === 110) assert.equal(io.prompts.length, 2);
  assert.doesNotMatch(io.writes.join('\n'), /private-unknown/);
  assert.doesNotMatch((await journal(root)).bytes, /STORE COPY|SAME COPY|private-unknown/);
}));

for (const status of [-2, 876543]) test('simple preserves nonzero status ' + status + ' without finalization', windows, () => prepared(async ({ run }) => {
  const transport = fakeTransport([[{ status }]]), io = terminal(['3', '1', '']);
  const result = await run(io, transport);
  assert.equal(result.status, status); assert.equal(io.prompts.length, 3);
  assert.equal(calls(transport, 'finish').length, 0);
  assert.ok(io.writes.some(line => line.includes('Retorno ' + status)));
}));

test('simple native command 41 remains visible without persisting collected value', windows, () => prepared(async ({ root, run }) => {
  const transport = fakeTransport([[{ ...field(99999, 'Synthetic prompt'), command: 41, minLength: 1, maxLength: 40 }, { status: -2 }]]);
  const io = terminal(['111', 'private-keyboard-value', '']);
  await run(io, transport);
  assert.equal(io.prompts[1].options.secret, false);
  assert.equal(calls(transport, 'continue').at(-1).params.buffer, 'private-keyboard-value');
  assert.ok(io.writes.some(line => line.includes('Entrada visivel')));
  assert.deepEqual(await readdir(join(root, 'state', 'automation')), []);
  assert.doesNotMatch(io.writes.join('\n'), /private-keyboard-value/);
}));

for (const stage of ['first-menu', 'next-menu', 'cycle', 'decision']) test('simple Ctrl+C at ' + stage + ' cancels cooperatively and cleans up', windows, () => prepared(async ({ root, run }) => {
  const interrupt = (_prompt, options) => { process.emit('SIGINT'); assert.equal(options.signal.aborted, true); return '1'; };
  const cycles = stage === 'cycle' ? [[() => { process.emit('SIGINT'); return { ...field(-1), command: 23 }; }, params => { assert.equal(params.continueFlag, -1); return { status: -2 }; }]] : [[{ status: 0 }]];
  const answers = stage === 'first-menu' ? [interrupt] : stage === 'next-menu' ? ['3', '1', '3', interrupt] : stage === 'decision' ? ['3', '1', interrupt] : ['3', '1'];
  const transport = fakeTransport(cycles), before = process.listenerCount('SIGINT');
  await run(terminal(answers), transport);
  assert.equal(process.listenerCount('SIGINT'), before);
  assert.equal(calls(transport, 'finish').length, 0);
  assert.equal(calls(transport, 'start').length, stage === 'first-menu' ? 0 : 1);
  assert.equal(transport.calls.at(-1).method, 'close');
  assert.equal(calls(transport, 'load').length, 1);
  if (stage !== 'first-menu') await journal(root);
  else assert.deepEqual(await readdir(join(root, 'state', 'automation')), []);
}));

test('simple timeout preserves partial raw data, never retries and releases journal and signal listener', windows, () => prepared(async ({ root, run }) => {
  const transport = fakeTransport([[field(987654, 'private-partial'), new SitefError('BRIDGE_TIMEOUT', 'private-native-error', { uncertain: true })]]);
  const io = terminal(['3', '1']), before = process.listenerCount('SIGINT');
  await assert.rejects(run(io, transport), error => {
    assert.equal(error.code, 'TRANSACTION_UNCERTAIN');
    assert.equal(getPartialTransaction(error).data.getLast(987654).raw, 'private-partial'); return true;
  });
  assert.equal(calls(transport, 'start').length, 1); assert.equal(calls(transport, 'continue').length, 2);
  assert.equal(calls(transport, 'finish').length, 0); assert.equal(transport.calls.at(-1).method, 'close');
  assert.equal(process.listenerCount('SIGINT'), before);
  assert.doesNotMatch(io.writes.join('\n') + (await journal(root)).bytes, /private-partial|private-native-error/);
}));

test('simple finish failure attempts exactly once, never undoes and still closes', windows, () => prepared(async ({ root, run }) => {
  const error = new SitefError('BRIDGE_TIMEOUT', 'private-finish-error', { uncertain: true });
  const transport = fakeTransport([[{ status: 0 }]], error), before = process.listenerCount('SIGINT');
  await assert.rejects(run(terminal(['3', '1', '1']), transport));
  assert.equal(calls(transport, 'start').length, 1); assert.equal(calls(transport, 'finish').length, 1);
  assert.equal(calls(transport, 'finish')[0].params.confirm, 1);
  assert.equal(transport.calls.at(-1).method, 'close'); assert.equal(process.listenerCount('SIGINT'), before);
  await journal(root);
}));

test('simple failed immediate receipt display sends -1, never retries printing or finalizes', windows, () => prepared(async ({ root, run }) => {
  const transport = fakeTransport([[field(121, 'UNDISPLAYED COPY'), params => { assert.equal(params.continueFlag, -1); return { status: -2 }; }]]);
  const io = terminal(['110']); let attempts = 0;
  io.writeReceipt = async () => { attempts++; throw Error('synthetic display failure'); };
  await assert.rejects(run(io, transport));
  assert.equal(attempts, 1); assert.equal(calls(transport, 'continue').length, 2);
  assert.equal(calls(transport, 'start').length, 1); assert.equal(calls(transport, 'finish').length, 0);
  assert.equal(transport.calls.at(-1).method, 'close'); await journal(root);
}));


test('simple debugger entries retain existing launches and use Windows Node with existing build task', async () => {
  const launch = JSON.parse(await readFile(new URL('../../../.vscode/launch.json', import.meta.url), 'utf8'));
  const tasks = JSON.parse(await readFile(new URL('../../../.vscode/tasks.json', import.meta.url), 'utf8'));
  for (const [name, program] of [
    ['SiTef: verificar arquivos (sem DLL)', 'windows-cli.mjs'],
    ['SiTef: CLI interativa (Windows)', 'windows-cli.mjs'],
    ['SiTef: inspecionar journal (somente leitura)', 'windows-reconcile.mjs']
  ]) assert.equal(launch.configurations.find(c => c.name === name)?.program, '${workspaceFolder}/examples/' + program);
  assert.equal(launch.configurations.some(c => c.name === 'SiTef: exemplo simples verificar (sem DLL)'), false);
  for (const [name, args, terminal] of [
    ['SiTef: exemplo simples (Windows)', [], 'integratedTerminal']
  ]) {
    const entry = launch.configurations.find(c => c.name === name);
    assert.ok(entry); assert.equal(entry.program, '${workspaceFolder}/examples/windows-simple.mjs');
    assert.equal(entry.runtimeExecutable, 'node.exe'); assert.equal(entry.stopOnEntry, true);
    assert.equal(entry.sourceMaps, true); assert.equal(entry.console, terminal);
    assert.deepEqual(entry.args, args); assert.equal(entry.preLaunchTask, 'SiTef: compilar TypeScript (debug)');
    assert.ok(tasks.tasks.some(task => task.label === entry.preLaunchTask));
  }
});

test('simple initialization never reads or changes earlier synthetic journal and lock', windows, () => prepared(async ({ root, run }) => {
  const directory = join(root, 'state', 'automation');
  await mkdir(directory, { recursive: true });
  const previous = join(directory, 'synthetic-previous.journal.json');
  const lock = previous + '.lock';
  const contents = 'INERT SYNTHETIC HISTORY, NOT AN OPERATIONAL JOURNAL';
  await writeFile(previous, contents); await writeFile(lock, 'synthetic-owner');
  const transport = fakeTransport(), io = terminal(['']);
  await run(io, transport);
  assert.deepEqual(transport.calls.map(c => c.method), ['load', 'configure', 'close']);
  assert.equal(await readFile(previous, 'utf8'), contents);
  assert.equal(await readFile(lock, 'utf8'), 'synthetic-owner');
  assert.deepEqual((await readdir(directory)).sort(), ['synthetic-previous.journal.json', 'synthetic-previous.journal.json.lock']);
  assert.equal(calls(transport, 'start').length, 0); assert.equal(calls(transport, 'finish').length, 0);
  assert.doesNotMatch(io.writes.join('\n'), /Inspecao somente leitura|Aviso:|synthetic-previous/);
}));
