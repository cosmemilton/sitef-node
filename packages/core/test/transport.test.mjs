import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {BridgeTransport} from '../dist/index.js';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const cwd = fileURLToPath(new URL('.', import.meta.url));
const bridge = mode => new BridgeTransport({executable: process.execPath, cwd, args: [fileURLToPath(new URL('./fake-bridge.mjs', import.meta.url)), mode], timeoutMs: mode === 'timeout' ? 100 : 3000, maxFrameBytes: 1024});
test('IPC serializa chamadas e preserva UTF-8 dividido em chunks', async () => {
  const transport = bridge('normal');
  try {
    const results = await Promise.all([transport.call('a', {receipt: 'linha1\nlinha2'}), transport.call('b')]);
    assert.equal(results[0].accented, 'ação'); assert.equal(results[0].params.receipt, 'linha1\nlinha2'); assert.equal(results[1].method, 'b');
  } finally { await transport.close(); }
});
for (const [mode, code] of [['timeout', 'BRIDGE_TIMEOUT'], ['exit', 'BRIDGE_EOF'], ['invalid', 'INVALID_FRAME'], ['wrong-id', 'INVALID_FRAME'], ['large', 'FRAME_TOO_LARGE']]) {
  test(`IPC falha ${mode} não permite replay`, async () => {
    const transport = bridge(mode);
    await assert.rejects(transport.call('start'), error => error.uncertain && (error.code === code || (mode === 'exit' && error.code === 'BRIDGE_EXIT')));
    await assert.rejects(transport.call('start'), {code: 'BRIDGE_CLOSED'}); await transport.close();
  });
}
test('erro de símbolo mantém seu código sem derrubar ponte', async () => {
  const transport = bridge('error');
  await assert.rejects(transport.call('optional'), {code: 'SYMBOL_UNAVAILABLE', uncertain: false}); await transport.close();
});
test('close entrega EOF e aguarda descarregamento normal antes de liberar a sessão', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitef-close-'));
  const marker = join(directory, 'closed.txt');
  const transport = new BridgeTransport({executable: process.execPath, cwd, args: [fileURLToPath(new URL('./fake-bridge.mjs', import.meta.url)), 'graceful', marker]});
  try {
    await transport.call('capabilities');
    await transport.close();
    assert.equal(await readFile(marker, 'utf8'), 'closed-normally');
  } finally { await transport.close(); await rm(directory, {recursive: true, force: true}); }
});
