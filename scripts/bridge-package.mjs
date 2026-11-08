import { readFile, readdir, lstat, copyFile, mkdir, chmod, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateReleaseLicense } from './prepack.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const targets = {
  'win32-x64': { rust: 'x86_64-pc-windows-msvc', file: 'sitef-bridge.exe', os: ['win32'], cpu: ['x64'] },
  'linux-ia32': { rust: 'i686-unknown-linux-gnu', file: 'sitef-bridge', os: ['linux'], cpu: ['x64', 'ia32'], libc: ['glibc'] }
};
export function validateBinary(bytes, target) {
  if (/(?:\/home\/|\/Users\/|[A-Z]:[\\/]Users[\\/])[^\s]+/i.test(bytes.toString('latin1'))) throw new Error('Personal build path embedded in bridge; rebuild with remap-path-prefix');
  if (target === 'linux-ia32') {
    if (bytes.length < 52 || bytes.subarray(0, 4).toString('hex') !== '7f454c46' ||
        bytes[4] !== 1 || bytes[5] !== 1 || bytes.readUInt16LE(18) !== 3 ||
        ![2, 3].includes(bytes.readUInt16LE(16))) throw new Error('Expected Linux ELF32 i386 executable');
    const offset = bytes.readUInt32LE(28), size = bytes.readUInt16LE(42), count = bytes.readUInt16LE(44);
    if (size !== 32 || !count || offset < 52 || offset + size * count > bytes.length) throw new Error('Invalid ELF program headers');
    let interpreter = false;
    for (let i = 0; i < count; i++) {
      const ph = offset + i * size, type = bytes.readUInt32LE(ph), start = bytes.readUInt32LE(ph + 4), length = bytes.readUInt32LE(ph + 16);
      if (start + length > bytes.length) throw new Error('Truncated ELF segment');
      if (type === 3) {
        if (interpreter || bytes.subarray(start, start + length).toString() !== '/lib/ld-linux.so.2\0') throw new Error('Expected standard i686 glibc interpreter');
        interpreter = true;
      }
      if (type === 2) {
        if (length % 8) throw new Error('Invalid ELF dynamic segment');
        for (let entry = start; entry < start + length; entry += 8) {
          const tag = bytes.readInt32LE(entry);
          if (tag === 15 || tag === 29) throw new Error('Do not package a bridge with RPATH/RUNPATH');
          if (tag === 0) break;
        }
      }
    }
    if (!interpreter) throw new Error('Expected executable with PT_INTERP, not a shared library');
  } else if (target === 'win32-x64') {
    if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('Expected Windows PE x64 executable');
    const pe = bytes.readUInt32LE(60);
    if (pe > bytes.length - 26 || bytes.toString('hex', pe, pe + 4) !== '50450000' ||
        bytes.readUInt16LE(pe + 4) !== 0x8664 || bytes.readUInt16LE(pe + 24) !== 0x20b ||
        (!(bytes.readUInt16LE(pe + 22) & 2)) || (bytes.readUInt16LE(pe + 22) & 0x2000)) throw new Error('Expected Windows PE32+ x64 executable, not a DLL');
    const sections = bytes.readUInt16LE(pe + 6), optionalSize = bytes.readUInt16LE(pe + 20);
    const table = pe + 24 + optionalSize;
    if (!sections || optionalSize < 112 || table + 40 * sections > bytes.length) throw new Error('Invalid PE section table');
    for (let i = 0; i < sections; i++) {
      const section = table + i * 40;
      if (bytes.readUInt32LE(section + 20) + bytes.readUInt32LE(section + 16) > bytes.length) throw new Error('Truncated PE section');
    }
  } else throw new Error('Unknown bridge target');
}
export async function validateBridgePackage(target, directory = join(root, 'packages', 'bridge-' + target)) {
  const config = targets[target];
  if (!config) throw new Error('Unknown bridge target');
  const allowed = ['LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.txt', 'bin', 'index.cjs', 'package.json'];
  const entries = await readdir(directory);
  if (entries.some(name => !allowed.includes(name)) || allowed.some(name => !entries.includes(name))) throw new Error('Unexpected or missing bridge package file');
  for (const name of allowed) {
    const st = await lstat(join(directory, name));
    if (name === 'bin' ? !st.isDirectory() : !st.isFile()) throw new Error('Bridge package must contain regular files, no symlinks');
  }
  const bins = await readdir(join(directory, 'bin'));
  if (bins.length !== 1 || bins[0] !== config.file) throw new Error('Only the owned bridge executable may be packaged');
  const path = join(directory, 'bin', config.file);
  const st = await lstat(path);
  if (!st.isFile()) throw new Error('Bridge binary must be regular file');
  if (target.startsWith('linux') && process.platform !== 'win32' && !(st.mode & 0o111)) throw new Error('Linux bridge needs executable permission');
  validateBinary(await readFile(path), target);
  const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const parent = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (pkg.name !== '@cosmemilton/sitef-bridge-' + target || pkg.version !== parent.version ||
      JSON.stringify(pkg.os) !== JSON.stringify(config.os) || JSON.stringify(pkg.cpu) !== JSON.stringify(config.cpu) ||
      JSON.stringify(pkg.libc) !== JSON.stringify(config.libc) ||
      JSON.stringify(pkg.files) !== JSON.stringify(['bin', 'index.cjs', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.txt']) ||
      pkg.license !== 'MIT' || pkg.publishConfig?.access !== 'public' ||
      pkg.publishConfig?.registry !== 'https://registry.npmjs.org/') throw new Error('Invalid bridge package manifest');
  const notices = await readFile(join(directory, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
  const lock = await readFile(join(root, 'native/Cargo.lock'), 'utf8');
  for (const block of lock.split('[[package]]').slice(1)) {
    const name = block.match(/name = "([^"]+)"/)?.[1], version = block.match(/version = "([^"]+)"/)?.[1];
    if (name !== 'sitef-bridge' && !notices.includes(name + ' ' + version + '\n'))
      throw new Error('Missing locked dependency notice: ' + name);
  }
  if (!notices.includes('Rust standard library notices (rustc ')) throw new Error('Missing Rust standard library notices');
  validateReleaseLicense(await readFile(join(directory, 'LICENSE'), 'utf8'), await readFile(join(root, 'LICENSE'), 'utf8'));
}
export async function stageBridge(target) {
  const config = targets[target];
  if (!config) throw new Error('Use win32-x64 or linux-ia32');
  const source = join(root, 'native', 'target', config.rust, 'release', config.file);
  validateBinary(await readFile(source), target);
  const directory = join(root, 'packages', 'bridge-' + target);
  if (await realpath(directory) !== directory) throw new Error('Refuse symlinked package directory');
  const bin = join(directory, 'bin');
  await mkdir(bin, { recursive: true });
  if (await realpath(bin) !== bin) throw new Error('Refuse symlinked bin directory');
  const destination = join(bin, config.file);
  try { if (!(await lstat(destination)).isFile()) throw new Error('Refuse non-regular destination'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await copyFile(source, destination);
  if (process.platform !== 'win32') await chmod(destination, 0o755);
  await validateBridgePackage(target);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, target] = process.argv.slice(2);
  if (command === 'stage') await stageBridge(target);
  else if (command === 'validate') await validateBridgePackage(target);
  else throw new Error('Usage: bridge-package.mjs stage|validate win32-x64|linux-ia32');
}
