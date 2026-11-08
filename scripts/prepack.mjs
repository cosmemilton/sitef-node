import { readdir, readFile, realpath, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function validateReleaseFile(name, content) {
  if (!/\.(?:js|d\.ts|json)$/.test(name)) throw new Error(`Unexpected release file: ${name}`);
  if (/sourceMappingURL\s*=/.test(content)) throw new Error(`Sourcemap reference in ${name}`);
  if (/(?:\/home\/|\/Users\/|[A-Z]:[\\/]Users[\\/])[^\s"'<>]+/i.test(content)) {
    throw new Error(`Personal absolute path in ${name}`);
  }
}

async function validateDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await validateDirectory(path);
    else if (entry.isFile()) validateReleaseFile(entry.name, await readFile(path, 'utf8'));
    else throw new Error(`Non-regular release file: ${path}`);
  }
}

function run(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Release build failed: ${script} (${result.status})`);
}

async function buildPackage(name) {
  const directory = join(root, 'packages', name);
  // Refuse symlinked package/dist paths before removing generated output.
  if (await realpath(directory) !== directory) throw new Error('Package directory must not be a symlink');
  const dist = join(directory, 'dist');
  try {
    if (await realpath(dist) !== dist) throw new Error('dist must not be a symlink');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await rm(dist, { recursive: true, force: true });
  run(join(root, 'node_modules/typescript/bin/tsc'), [
    '-p', join(directory, 'tsconfig.json'), '--sourceMap', 'false',
    '--inlineSourceMap', 'false', '--inlineSources', 'false', '--declarationMap', 'false',
  ]);
  await validateDirectory(dist);
}

export function validateReleaseLicense(packageLicense, rootLicense) {
  if (packageLicense !== rootLicense || !rootLicense.startsWith('MIT License\n') ||
      !rootLicense.includes('Permission is hereby granted, free of charge') ||
      !rootLicense.includes('THE SOFTWARE IS PROVIDED "AS IS"')) {
    throw new Error('Package LICENSE must contain the canonical MIT license');
  }
}

export async function preparePackage(directory = process.cwd()) {
  const current = await realpath(directory);
  const core = await realpath(join(root, 'packages/core'));
  const ui = await realpath(join(root, 'packages/ui'));
  if (current !== core && current !== ui) throw new Error('Run prepack from a publishable workspace');
  const readme = await readFile(join(current, 'README.md'), 'utf8');
  if (!readme.trim()) throw new Error('Package README is required');
  validateReleaseLicense(await readFile(join(current, 'LICENSE'), 'utf8'),
    await readFile(join(root, 'LICENSE'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(current, 'package.json'), 'utf8'));
  if (manifest.license !== 'MIT' || manifest.publishConfig?.access !== 'public' ||
      manifest.publishConfig?.registry !== 'https://registry.npmjs.org/') {
    throw new Error('Package must declare MIT and the authorized public npm registry');
  }
  run(join(root, 'scripts/sync-semantic-data.mjs'));
  await buildPackage('core');
  if (current === ui) await buildPackage('ui');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await preparePackage();
}
