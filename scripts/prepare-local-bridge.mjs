import { copyFile, mkdir, mkdtemp, lstat, realpath, rename, rm, chmod } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { targets, validateBridgePackage } from './bridge-package.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
async function directory(path) {
  await mkdir(path, { recursive: true });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(await realpath(path), resolve(path)))
    throw new Error('Recusado diretorio redirecionado: ' + path);
}
export function localBridgeTarget(platform = process.platform, architecture = process.arch) {
  if (platform === 'win32' && architecture === 'x64') return 'win32-x64';
  if (platform === 'linux' && ['x64', 'ia32'].includes(architecture)) return 'linux-ia32';
  throw new Error('Preparo local suporta Windows x64 ou Linux x64/ia32.');
}
/** Development only: copies the owned staged package, never downloads or runs native code. */
export async function prepareLocalBridge({ rootDirectory = root, platform = process.platform, architecture = process.arch } = {}) {
  const target = localBridgeTarget(platform, architecture);
  const config = targets[target];
  // Canonicalize the checkout first, including Windows short (8.3) path aliases.
  const checkout = await realpath(rootDirectory);
  const source = join(checkout, 'packages', 'bridge-' + target);
  const modules = join(checkout, 'node_modules');
  const scope = join(modules, '@cosmemilton');
  const destination = join(scope, 'sitef-bridge-' + target);
  await directory(modules);
  await directory(scope);
  let existing;
  try { existing = await lstat(destination); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('Pacote local redirecionado; nao foi alterado.');
    // Preserve any valid npm/local installation. Never overwrite a different package.
    await validateBridgePackage(target, destination);
    return destination;
  }
  try { await validateBridgePackage(target, source); }
  catch (cause) {
    throw new Error('Bridge local ainda nao preparada. Compile o alvo nativo e execute node scripts/bridge-package.mjs stage ' + target + '. Nenhum download ou execucao foi feito.', { cause });
  }
  const temporary = await mkdtemp(join(scope, '.sitef-bridge-'));
  try {
    await mkdir(join(temporary, 'bin'));
    for (const name of ['package.json', 'index.cjs', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.txt'])
      await copyFile(join(source, name), join(temporary, name), constants.COPYFILE_EXCL);
    await copyFile(join(source, 'bin', config.file), join(temporary, 'bin', config.file), constants.COPYFILE_EXCL);
    if (process.platform !== 'win32') await chmod(join(temporary, 'bin', config.file), 0o755);
    await validateBridgePackage(target, temporary);
    await rename(temporary, destination);
  } finally { await rm(temporary, { recursive: true, force: true }); }
  return destination;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const destination = await prepareLocalBridge();
    console.log('Bridge local pronta para selecao automatica: ' + destination);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
