import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateReleaseFile } from '../prepack.mjs';

for (const file of ['index.js', 'index.d.ts', 'fields.json']) {
  test(`accept production file ${file}`, () => assert.doesNotThrow(() => validateReleaseFile(file, '{}')));
}
for (const file of ['bridge.exe', 'vendor.dll', 'keys.pem', 'sitef.ini', 'manual.pdf', 'index.js.map', 'fixture.ts']) {
  test(`reject non-production file ${file}`, () => assert.throws(() => validateReleaseFile(file, '')));
}
test('reject inline and external debug maps', () => {
  for (const value of ['//# sourceMappingURL=index.js.map', '//# sourceMappingURL=data:application/json;base64,AA==']) {
    assert.throws(() => validateReleaseFile('index.js', value));
  }
});
test('reject personal absolute paths', () => {
  for (const value of ['/home/example/project', '/Users/example/project', 'C:\\Users\\example\\project']) {
    assert.throws(() => validateReleaseFile('index.js', value));
  }
});
test('workspace versions, licenses and release hooks are coherent', async () => {
  const read = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
  const root = await read('../../package.json');
  const core = await read('../../packages/core/package.json');
  const ui = await read('../../packages/ui/package.json');
  assert.equal(root.private, true);
  for (const pkg of [core, ui]) {
    assert.equal(pkg.version, root.version);
    assert.equal(pkg.license, 'UNLICENSED');
    assert.deepEqual(pkg.files, ['dist', 'README.md']);
    assert.equal(pkg.scripts.prepack, 'node ../../scripts/prepack.mjs');
  }
  assert.equal(ui.peerDependencies[core.name], `^${core.version}`);
});
