import { mkdtemp, writeFile, access, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(process.argv[2] ?? '.');
const directory = await mkdtemp(join(tmpdir(), 'sitef-tarball-consumer-'));
const version = JSON.parse(await (await import('node:fs/promises')).readFile(join(root, 'package.json'), 'utf8')).version;
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: directory, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Consumer check failed: ' + result.status);
}
try {
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error('Run through npm run test:bridge-consumer');
  const filename = name => 'cosmemilton-' + name + '-' + version + '.tgz';
  for (const name of ['sitef', 'sitef-bridge-linux-ia32', 'sitef-bridge-win32-x64'])
    await copyFile(join(root, filename(name)), join(directory, filename(name)));
  const file = name => 'file:./' + filename(name);
  await writeFile(join(directory,'package.json'),JSON.stringify({private:true,type:'module',
    dependencies:{'@cosmemilton/sitef':file('sitef')},
    optionalDependencies:{
      '@cosmemilton/sitef-bridge-linux-ia32':file('sitef-bridge-linux-ia32'),
      '@cosmemilton/sitef-bridge-win32-x64':file('sitef-bridge-win32-x64')
    }}));
  run([npm,'install','--offline','--ignore-scripts','--no-audit','--no-fund']);
  run(['--input-type=module','-e', `import assert from 'node:assert/strict'; import {resolveBridge} from '@cosmemilton/sitef'; import {existsSync} from 'node:fs'; const result=await resolveBridge({}); assert.ok(existsSync(result.executable)); console.log('Packed consumer resolves:',result.executable);`]);
  const skipped = process.platform === 'linux' ? 'win32-x64' : 'linux-ia32';
  try { await access(join(directory,'node_modules/@cosmemilton/sitef-bridge-'+skipped)); throw new Error('Foreign optional package unexpectedly installed'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  console.log('Foreign optional package skipped; no workspace linkage or install scripts required.');
  const installed = process.platform === 'linux' ? 'linux-ia32' : 'win32-x64';
  await rm(join(directory,'node_modules/@cosmemilton/sitef-bridge-'+installed), {recursive:true,force:true});
  run(['--input-type=module','-e', `import assert from 'node:assert/strict'; import {resolveBridge} from '@cosmemilton/sitef'; assert.throws(() => resolveBridge({}), e => e.code === 'BRIDGE_NOT_INSTALLED'); assert.equal(resolveBridge({bridgeExecutable:process.execPath}).executable, process.execPath); console.log('Missing optional package diagnostic and manual fallback pass.');`]);
} finally { await rm(directory,{recursive:true,force:true}); }
