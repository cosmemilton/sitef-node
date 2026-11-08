import { createRequire } from 'node:module';
import { accessSync, constants } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { SitefError } from './errors.js';

const require = createRequire(import.meta.url);

/** Package architecture describes the native helper, not necessarily Node. */
export function bridgePackageFor(platform: string, architecture: string): string {
  if (platform === 'win32' && architecture === 'x64')
    return '@cosmemilton/sitef-bridge-win32-x64';
  if (platform === 'linux' && (architecture === 'x64' || architecture === 'ia32'))
    return '@cosmemilton/sitef-bridge-linux-ia32';
  throw new SitefError('UNSUPPORTED_PLATFORM',
    'Bridge automático disponível para Windows x64 e Linux x64/ia32 com biblioteca i686.');
}

/** Explicit paths override optional packages. No download or shell execution. */
export function resolveBridge(options: {
  bridgeExecutable?: string;
  bridgeDirectory?: string;
} = {}): { executable: string; cwd: string } {
  let executable = options.bridgeExecutable;
  if (executable === undefined) {
    const packageName = bridgePackageFor(process.platform, process.arch);
    try {
      const installed: unknown = require(packageName);
      if (!installed || typeof installed !== 'object' ||
          !('executable' in installed) || typeof installed.executable !== 'string')
        throw new Error('Invalid bridge package');
      executable = installed.executable;
      if (!isAbsolute(executable)) throw new Error('Invalid executable path');
      accessSync(executable, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    } catch (cause) {
      throw new SitefError('BRIDGE_NOT_INSTALLED',
        'Instale ' + packageName + ' com dependências opcionais habilitadas ou informe bridgeExecutable absoluto. No Linux, confira também o runtime i686.', { cause });
    }
  }
  const cwd = options.bridgeDirectory ?? dirname(executable);
  if (!isAbsolute(executable) || !isAbsolute(cwd))
    throw new SitefError('INVALID_PATH', 'bridgeExecutable e bridgeDirectory precisam ser absolutos.');
  return { executable, cwd };
}
