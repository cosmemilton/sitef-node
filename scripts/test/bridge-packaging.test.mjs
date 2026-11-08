import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateBinary, targets } from '../bridge-package.mjs';
test('ELF rejects x64, missing interpreter and malformed headers', () => {
  for (const buffer of [Buffer.alloc(0), Buffer.alloc(52)]) assert.throws(() => validateBinary(buffer, 'linux-ia32'));
  const b = Buffer.alloc(104); b.writeUInt32LE(52,28); b.writeUInt16LE(32,42); b.writeUInt16LE(1,44); b.writeUInt32LE(3,52); b.writeUInt32LE(84,56); b.writeUInt32LE(19,68); b.write('/lib/ld-linux.so.2\0',84); b.write('7f454c46', 0, 'hex'); b[4]=1; b[5]=1; b.writeUInt16LE(3, 18); b.writeUInt16LE(3, 16);
  assert.doesNotThrow(() => validateBinary(b, 'linux-ia32'));
  b.writeUInt32LE(1,52); assert.throws(() => validateBinary(b,'linux-ia32')); b.writeUInt32LE(3,52);
  b[4]=2; assert.throws(() => validateBinary(b, 'linux-ia32'));
});
test('PE rejects wrong architecture, DLLs and truncated data', () => {
  const b = Buffer.alloc(256); b.writeUInt16LE(1,70); b.writeUInt16LE(112,84); b.writeUInt16LE(2,86); b.write('MZ'); b.writeUInt32LE(64,60); b.write('50450000',64,'hex'); b.writeUInt16LE(0x8664,68); b.writeUInt16LE(0x20b,88);
  assert.doesNotThrow(() => validateBinary(b,'win32-x64'));
  b.writeUInt16LE(0x2000,86); assert.throws(() => validateBinary(b,'win32-x64'));
  b.writeUInt32LE(0xffffff,60); assert.throws(() => validateBinary(b,'win32-x64'));
});
test('optional bridge packages match root release and host architectures', async () => {
  const read = async p => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));
  const root = await read('../../package.json'), core = await read('../../packages/core/package.json');
  for (const [target, config] of Object.entries(targets)) {
    const p = await read('../../packages/bridge-'+target+'/package.json');
    assert.equal(p.version, root.version); assert.equal(core.optionalDependencies[p.name], root.version);
    assert.deepEqual(p.os,config.os); assert.deepEqual(p.cpu,config.cpu); assert.deepEqual(p.libc,config.libc);
    assert.deepEqual(p.files,['bin','index.cjs','README.md','LICENSE','THIRD_PARTY_NOTICES.txt']);
    assert.equal(p.scripts.prepack,'node ../../scripts/bridge-package.mjs validate '+target);
  }
});

test('reject personal source paths and unrecognized target names', () => {
  assert.throws(() => validateBinary(Buffer.from('/home/example/.cargo/source.rs'), 'linux-ia32'), /Personal build path/);
  assert.throws(() => validateBinary(Buffer.from('C:\\Users\\example\\source.rs'), 'win32-x64'), /Personal build path/);
  assert.throws(() => validateBinary(Buffer.alloc(0), 'linux-x64'), /Unknown bridge target/);
});
test('ELF rejects RPATH and out-of-bounds program segments', () => {
  const b = Buffer.alloc(128); b.write('7f454c46',0,'hex'); b[4]=1; b[5]=1;
  b.writeUInt16LE(3,16); b.writeUInt16LE(3,18); b.writeUInt32LE(52,28); b.writeUInt16LE(32,42); b.writeUInt16LE(1,44);
  b.writeUInt32LE(2,52); b.writeUInt32LE(84,56); b.writeUInt32LE(8,68); b.writeInt32LE(29,84);
  assert.throws(() => validateBinary(b,'linux-ia32'), /RPATH/);
  b.writeUInt32LE(1000,56); assert.throws(() => validateBinary(b,'linux-ia32'), /Truncated/);
});

test('both bridges carry identical notices for all locked dependencies and Rust stdlib', async () => {
  const read = p => readFile(new URL(p, import.meta.url), 'utf8');
  const text = await read('../../packages/bridge-linux-ia32/THIRD_PARTY_NOTICES.txt');
  assert.equal(text, await read('../../packages/bridge-win32-x64/THIRD_PARTY_NOTICES.txt'));
  const lock = await read('../../native/Cargo.lock');
  for (const block of lock.split('[[package]]').slice(1)) {
    const name = block.match(/name = "([^"]+)"/)[1], version = block.match(/version = "([^"]+)"/)[1];
    if (name !== 'sitef-bridge') assert.ok(text.includes(name+' '+version+'\n'), name);
  }
  assert.ok(text.includes('Rust standard library notices (rustc '));
  assert.ok(text.includes('LICENSE-WHATWG'));
  assert.ok(text.includes('LICENSE-UNICODE'));
});
