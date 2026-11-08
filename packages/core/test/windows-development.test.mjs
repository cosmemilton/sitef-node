import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../../../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('Windows launch tasks are portable and retain the four supported entry points', async () => {
  const launch = JSON.parse(await read('.vscode/launch.json'));
  const tasks = JSON.parse(await read('.vscode/tasks.json'));
  assert.equal(launch.configurations.length, 4);
  const task = tasks.tasks.find(task => task.label === 'SiTef: compilar TypeScript (debug)');
  assert.equal(task.type, 'process');
  assert.equal(task.command, 'node.exe');
  assert.deepEqual(task.args, ['${workspaceFolder}/scripts/build-debug.mjs']);
  assert.doesNotMatch(JSON.stringify([launch, tasks]), /Ubuntu|\/home\/|milton|wsl\.exe/);
  for (const config of launch.configurations) {
    assert.equal(config.runtimeExecutable, 'node.exe');
    assert.equal(config.sourceMaps, true);
    assert.ok(config.resolveSourceMapLocations.includes('**/packages/core/dist/**'));
    assert.equal(config.sourceMapPathOverrides, undefined);
    if (config.preLaunchTask) assert.equal(config.preLaunchTask, task.label);
  }
  const simple = launch.configurations.find(config => config.program.endsWith('/windows-simple.mjs'));
  assert.equal(simple.name, 'SiTef: exemplo simples (Windows)');
  assert.deepEqual(simple.args, []);
});

for (const fail of [false, true]) {
  test(`debug build runs local scripts directly and ${fail ? 'stops on failure' : 'compiles in order'}`, async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'sitef debug build '));
    try {
      await mkdir(join(fixture, 'scripts'), { recursive: true });
      await mkdir(join(fixture, 'node_modules/typescript/bin'), { recursive: true });
      await copyFile(new URL('scripts/build-debug.mjs', root), join(fixture, 'scripts/build-debug.mjs'));
      await writeFile(join(fixture, 'scripts/sync-semantic-data.mjs'), `import { appendFileSync } from 'node:fs'; appendFileSync('steps.txt', 'sync\\n');`);
      await writeFile(join(fixture, 'node_modules/typescript/bin/tsc'), `const { appendFileSync } = require('node:fs'); appendFileSync('steps.txt', process.argv.slice(2).join(' ') + '\\n'); ${fail ? 'process.exit(7);' : ''}`);
      const result = spawnSync(process.execPath, [join(fixture, 'scripts/build-debug.mjs')], {
        cwd: tmpdir(), encoding: 'utf8', shell: false,
      });
      assert.equal(result.status, fail ? 7 : 0, result.stderr);
      assert.deepEqual((await readFile(join(fixture, 'steps.txt'), 'utf8')).trim().split('\n'), fail
        ? ['sync', '-p packages/core/tsconfig.debug.json']
        : ['sync', '-p packages/core/tsconfig.debug.json']);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
}

test('setup includes the simple reference and all owned helpers without deleting runtime data', async () => {
  const script = await read('scripts/prepare-windows-cli.ps1');
  assert.match(script, /examples\\windows-simple\.mjs/);
  assert.match(script, /examples\\cli\\\*\.mjs/);
  assert.match(script, /if \(!\(Test-Path -LiteralPath \$simple\)\)/);
  assert.match(script, /Arquivo local diferente; nao foi sobrescrito/);
  assert.doesNotMatch(script, /Remove-Item|Start-Process|Invoke-Expression/);
});

test('debug source maps embed TypeScript and use portable relative sources', async () => {
  const config = JSON.parse(await read('packages/core/tsconfig.debug.json'));
  assert.equal(config.compilerOptions.inlineSourceMap, true);
  assert.equal(config.compilerOptions.inlineSources, true);
  assert.equal(config.compilerOptions.sourceRoot, undefined);
  const script = await read('scripts/build-debug.mjs');
  assert.match(script, /process\.execPath/);
  assert.match(script, /shell: false/);
  assert.doesNotMatch(script, /cmd\.exe['"]|wsl\.exe|npm\.cmd/);
});
