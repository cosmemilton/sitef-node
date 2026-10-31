// Full original-contract integration: Node API -> Rust process -> synthetic C ABI.
// No vendor library, payment network or PIN capture is involved.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSitef } from '../dist/index.js';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'sitef-sdk-contract-'));
let client;
try {
  let libraryPath;
  if (process.platform === 'win32') {
    assert.ok(
      process.env.SITEF_SYNTHETIC_LIBRARY,
      'Build native/tests/fixture.c for Windows x64 and set SITEF_SYNTHETIC_LIBRARY; never use a vendor DLL for this test.'
    );
    libraryPath = resolve(process.env.SITEF_SYNTHETIC_LIBRARY);
  } else {
    libraryPath = join(temporary, 'libsynthetic.so');
    const compile = spawnSync(
      'cc',
      [
        '-shared',
        '-fPIC',
        '-Wall',
        '-Wextra',
        '-Werror',
        join(root, 'native/tests/fixture.c'),
        '-o',
        libraryPath
      ],
      { encoding: 'utf8' }
    );
    assert.equal(compile.status, 0, compile.stderr);
  }
  const bridgeExecutable = resolve(
    process.env.SITEF_TEST_BRIDGE ??
      join(
        root,
        'native/target/debug/sitef-bridge' +
          (process.platform === 'win32' ? '.exe' : '')
      )
  );
  client = await createSitef({
    bridgeExecutable,
    bridgeDirectory: dirname(bridgeExecutable),
    libraryPath,
    stateDirectory: join(temporary, 'state'),
    testMode: true,
    configuration: {
      server: '127.0.0.1',
      storeId: '00000000',
      terminalId: 'AA123456',
      additionalParameters: '[X=1]'
    },
    interaction: async (request) => {
      assert.equal(request.command, 30);
      assert.equal(request.fieldType, 999123);
      return { buffer: '1234' };
    },
    fields: {
      hooks: { storeReceipt: async () => true, printReceipt: async () => true }
    }
  });
  const result = await client.transact({
    functionId: 0,
    amount: '12,34',
    fiscalDocument: '123',
    fiscalDate: '20261030',
    fiscalTime: '120000',
    operator: 'test',
    additionalParameters: '{X=1}'
  });
  assert.equal(result.status, 0);
  assert.equal(result.requiresFinalization, true);
  assert.equal(result.fields[0].buffer, 'Ação\n');
  assert.equal(
    result.fields[0].bufferBase64,
    Buffer.from([65, 231, 227, 111, 10]).toString('base64')
  );
  assert.deepEqual(await client.finalize(false), {
    returned: true,
    remoteConfirmation: 'not-reported',
    payments: [result.transactionId]
  });
  assert.equal(client.recovery.payments[0].finalizationParameters, '');
  await client.close();
  client = undefined;
  console.log(
    'SDK + Rust + C synthetic ABI + durable journal integration passed'
  );
} finally {
  if (client && !['running', 'awaiting-finalization'].includes(client.state))
    await client.close();
  await rm(temporary, { recursive: true, force: true });
}
