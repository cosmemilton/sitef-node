import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Use Node directly: cmd.exe cannot retain a UNC working directory.
const root = fileURLToPath(new URL('../', import.meta.url));
const compiler = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
// The Windows CLI uses only core; the full workspace check builds and tests UI.
const steps = [
  [fileURLToPath(new URL('./sync-semantic-data.mjs', import.meta.url))],
  [compiler, '-p', 'packages/core/tsconfig.debug.json'],
  [fileURLToPath(new URL('./prepare-local-bridge.mjs', import.meta.url))],
];

for (const args of steps) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.error) {
    console.error(`Nao foi possivel iniciar a compilacao: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    if (result.signal) console.error(`Compilacao interrompida por ${result.signal}.`);
    process.exit(result.status ?? 1);
  }
}
