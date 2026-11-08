import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { bridgePackageFor, resolveBridge, createSitef } from '../dist/index.js';

test('selects helper ABI independently of Node architecture', () => {
  assert.equal(bridgePackageFor('win32', 'x64'), '@cosmemilton/sitef-bridge-win32-x64');
  for (const arch of ['x64', 'ia32'])
    assert.equal(bridgePackageFor('linux', arch), '@cosmemilton/sitef-bridge-linux-ia32');
  for (const [platform, arch] of [['darwin', 'x64'], ['linux', 'arm64'], ['win32', 'ia32']])
    assert.throws(() => bridgePackageFor(platform, arch), { code: 'UNSUPPORTED_PLATFORM' });
});

test('explicit executable wins and directory defaults without package loading', () => {
  const executable = resolve('synthetic/bridge');
  assert.deepEqual(resolveBridge({ bridgeExecutable: executable }),
    { executable, cwd: dirname(executable) });
  const cwd = resolve('synthetic/runtime');
  assert.deepEqual(resolveBridge({ bridgeExecutable: executable, bridgeDirectory: cwd }),
    { executable, cwd });
  for (const options of [{ bridgeExecutable: 'relative' },
      { bridgeExecutable: executable, bridgeDirectory: 'relative' }])
    assert.throws(() => resolveBridge(options), { code: 'INVALID_PATH' });
});

const linux = { protocolVersion: 1, platform: 'linux', architecture: 'x86',
  fieldTypeBytes: 4, runtimeTarget: 'linux-ia32' };
async function connect(capabilities, extra = {}) {
  const calls = [];
  let closes = 0;
  const options = {
    bridgeExecutable: resolve('synthetic/bridge'), libraryPath: resolve('synthetic/library'),
    configuration: { server: 'synthetic.invalid', storeId: '00000000', terminalId: 'AA000001' },
    interaction: async () => ({}),
    transportFactory: () => ({
      call: async method => { calls.push(method); return method === 'load' ? capabilities : { status: 0 }; },
      close: async () => { closes++; }
    }), ...extra
  };
  try { return { client: await createSitef(options), calls, closes: () => closes }; }
  catch (error) { error.testCalls = calls; error.testCloses = closes; throw error; }
}

test('Linux i686 capabilities configure once without testMode', async () => {
  const { client, calls, closes } = await connect(linux);
  assert.deepEqual(calls, ['load', 'configure']);
  await client.close();
  assert.equal(closes(), 1);
});
test('wrong Linux ABI/target rejected before configure with exactly one cleanup', async () => {
  for (const patch of [{ architecture: 'x86_64' }, { fieldTypeBytes: 8 },
    { fieldTypeBytes: undefined }, { runtimeTarget: undefined }, { platform: 'macos' }]) {
    await assert.rejects(connect({ ...linux, ...patch }), error => {
      assert.equal(error.code, 'UNSUPPORTED_PLATFORM');
      assert.deepEqual(error.testCalls, ['load']);
      assert.equal(error.testCloses, 1);
      return true;
    });
  }
});
test('legacy Windows x64 helper remains accepted', async () => {
  const { client } = await connect({ protocolVersion: 1, platform: 'windows', architecture: 'x86_64' });
  await client.close();
});
test('synthetic x64 Linux integration remains test-only', async () => {
  const { client } = await connect({ ...linux, architecture: 'x86_64', runtimeTarget: undefined }, { testMode: true });
  await client.close();
});
test('protocol mismatch remains fail-closed', async () => {
  await assert.rejects(connect({ ...linux, protocolVersion: 2 }), { code: 'PROTOCOL_MISMATCH' });
});

test('bridge env and manual working directory reach only transport construction', async () => {
  let bridgeOptions;
  const before = process.env.SITEF_SYNTHETIC_CHILD;
  const transportFactory = options => {
    bridgeOptions = options;
    return {
      call: async method => method === 'load' ? linux : { status: 0 },
      close: async () => {}
    };
  };
  const cwd = resolve('synthetic/operational');
  const { client } = await connect(linux, {
    transportFactory, bridgeDirectory: cwd,
    bridgeEnv: { SITEF_SYNTHETIC_CHILD: 'isolated' }
  });
  assert.deepEqual(bridgeOptions.env, { SITEF_SYNTHETIC_CHILD: 'isolated' });
  assert.equal(bridgeOptions.cwd, cwd);
  assert.equal(process.env.SITEF_SYNTHETIC_CHILD, before);
  await client.close();
});
