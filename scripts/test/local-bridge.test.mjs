import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, readdir, rm, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareLocalBridge, localBridgeTarget } from '../prepare-local-bridge.mjs';

async function fixture(action) {
  const root = await mkdtemp(join(tmpdir(), 'sitef-local-bridge-'));
  try {
    const source = join(root, 'packages/bridge-linux-ia32');
    await mkdir(join(source, 'bin'), { recursive: true });
    for (const name of ['package.json', 'index.cjs', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.txt'])
      await copyFile(new URL('../../packages/bridge-linux-ia32/' + name, import.meta.url), join(source, name));
    const binary = Buffer.alloc(104);
    binary.writeUInt32LE(52,28); binary.writeUInt16LE(32,42); binary.writeUInt16LE(1,44);
    binary.writeUInt32LE(3,52); binary.writeUInt32LE(84,56); binary.writeUInt32LE(19,68);
    binary.write('/lib/ld-linux.so.2' + String.fromCharCode(0),84); binary.write('7f454c46',0,'hex');
    binary[4]=1; binary[5]=1; binary.writeUInt16LE(3,18); binary.writeUInt16LE(3,16);
    await writeFile(join(source, 'bin/sitef-bridge'), binary);
    await chmod(join(source, 'bin/sitef-bridge'), 0o755);
    await action({ root, source, binary, options: {rootDirectory:root, platform:'linux', architecture:'x64'} });
  } finally { await rm(root, { recursive: true, force: true }); }
}
test('local development selects supported helper independently of Node width', () => {
  assert.equal(localBridgeTarget('win32', 'x64'), 'win32-x64');
  assert.equal(localBridgeTarget('linux', 'x64'), 'linux-ia32');
  assert.equal(localBridgeTarget('linux', 'ia32'), 'linux-ia32');
  assert.throws(() => localBridgeTarget('linux', 'arm64'));
});
test('local preparation copies only validated owned package and is idempotent', () => fixture(async ({ root, binary, options }) => {
  const target = await prepareLocalBridge(options);
  assert.deepEqual(await readFile(join(target, 'bin/sitef-bridge')), binary);
  assert.equal(await prepareLocalBridge(options), target);
  assert.deepEqual((await readdir(join(root, 'node_modules/@cosmemilton'))).sort(), ['sitef-bridge-linux-ia32']);
}));
test('local preparation refuses to overwrite divergent installed package', () => fixture(async ({ options }) => {
  const target = await prepareLocalBridge(options);
  const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
  manifest.version = '0.0.0-local';
  const text = JSON.stringify(manifest);
  await writeFile(join(target, 'package.json'), text);
  await assert.rejects(prepareLocalBridge(options), /Invalid bridge package manifest/);
  assert.equal(await readFile(join(target, 'package.json'), 'utf8'), text);
}));
test('missing binary stops preparation without installing partial package', () => fixture(async ({ root, source, options }) => {
  await rm(join(source, 'bin/sitef-bridge'));
  await assert.rejects(prepareLocalBridge(options), /Bridge local ainda nao preparada/);
  assert.deepEqual(await readdir(join(root, 'node_modules/@cosmemilton')), []);
}));
test('redirected node_modules is never followed', { skip: process.platform === 'win32' }, () => fixture(async ({ root, options }) => {
  const outside = join(root, 'outside');
  await mkdir(outside);
  await symlink(outside, join(root, 'node_modules'));
  await assert.rejects(prepareLocalBridge(options), /Recusado diretorio redirecionado/);
  assert.deepEqual(await readdir(outside), []);
}));
