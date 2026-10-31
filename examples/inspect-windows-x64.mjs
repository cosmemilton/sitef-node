import { dirname, isAbsolute } from 'node:path';
import { BridgeTransport } from '../packages/core/dist/index.js';

// Smoke test only: loads the integrator's DLL and inspects bridge capabilities.
// Does not configure a terminal, start a transaction, collect input or finalize payments.
// Usage on Windows x64:
// node examples/inspect-windows-x64.mjs C:\trusted\sitef-bridge.exe C:\trusted\CliSiTef64I.dll
if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Este teste requer Node.js Windows x64.');
}
const [bridgeExecutable, libraryPath] = process.argv.slice(2);
if (!bridgeExecutable || !libraryPath || !isAbsolute(bridgeExecutable) || !isAbsolute(libraryPath)) {
  throw new Error('Informe caminhos absolutos da ponte Windows x64 e da DLL fornecida pelo integrador.');
}
const transport = new BridgeTransport({ executable: bridgeExecutable, cwd: dirname(bridgeExecutable), timeoutMs: 120_000 });
try {
  const loaded = await transport.call('load', {
    libraryPath,
    workingDirectory: dirname(libraryPath),
    nativeEncoding: 'windows-1252',
    testMode: false,
  });
  const capabilities = await transport.call('capabilities');
  for (const value of [loaded, capabilities]) {
    if (value.protocolVersion !== 1 || value.platform !== 'windows' || value.architecture !== 'x86_64' || value.fieldTypeBytes !== 4) {
      throw new Error('Ponte incompatível: esperado Windows x86_64, protocolo1 e long de32bits.');
    }
  }
  console.log(JSON.stringify({
    protocolVersion: capabilities.protocolVersion,
    platform: capabilities.platform,
    architecture: capabilities.architecture,
    fieldTypeBytes: capabilities.fieldTypeBytes,
    nativeEncoding: capabilities.nativeEncoding,
    functions: capabilities.functions,
  }, null, 2));
} finally {
  await transport.close();
}
