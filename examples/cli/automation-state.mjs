import { randomUUID } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { FileJournal } from '../../packages/core/dist/index.js';
import { journalPath, preflightTerminal } from './runtime.mjs';

// Persistence belongs to this automation, not the native connection. Each run
// owns a new file and its writer lock, never a global terminal/pinpad mutex.
export async function createAutomationState(root) {
  if (!isAbsolute(root)) throw new Error('Diretorio de estado precisa ser absoluto.');
  const path = join(root, 'state', 'automation', randomUUID() + '.journal.json');
  const journal = new FileJournal(path);
  await journal.acquire();
  try {
    try {
      await lstat(path);
      throw Object.assign(new Error('Registro ja existe; nao sera sobrescrito.'), { code: 'CLI_STATE_EXISTS' });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  } catch (error) { await journal.release(); throw error; }
  let closed = false, writing = false, failure, snapshot;
  return {
    path,
    get snapshot() { return snapshot && structuredClone(snapshot); },
    async onStateChange(value) {
      if (failure) throw failure; // No automatic persistence or financial retry.
      if (closed || writing)
        throw Object.assign(new Error('Escritor da automacao indisponivel.'), { code: 'CLI_STATE_BUSY' });
      snapshot = structuredClone(value);
      writing = true;
      try { await journal.write(snapshot); }
      catch (error) { failure = error; throw error; }
      finally { writing = false; }
    },
    async close() {
      if (closed) return;
      if (writing) throw Object.assign(new Error('Persistencia em andamento.'), { code: 'CLI_STATE_BUSY' });
      await journal.release();
      closed = true;
    }
  };
}

// Historical files are inspected only. They never initialize a new client's
// state, block another payment, or get removed/archived by this reminder.
export async function warnPreviousState(root, configuration, io) {
  const warnings = await preflightTerminal(journalPath(root, configuration));
  const directory = join(root, 'state', 'automation');
  let entries = [];
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid state directory');
    entries = await readdir(directory);
  } catch (error) {
    if (error.code !== 'ENOENT') warnings.push({ code: 'STATE_DIRECTORY_UNREADABLE', path: directory });
  }
  const files = new Set(entries.filter(name => /\.journal\.json(?:\.lock)?$/.test(name))
    .map(name => name.replace(/\.lock$/, '')));
  for (const name of [...files].sort()) warnings.push(...await preflightTerminal(join(directory, name)));
  for (const warning of warnings) {
    const label = {
      RECORD_LOCK_PRESENT: 'Lock de registro anterior presente; nao comprova bloqueio do terminal.',
      RECORD_PENDING: 'Registro anterior possui pendencia para revisao.',
      RECORD_INVALID: 'Registro anterior invalido ou inacessivel; revise sem apagar.',
      RECORD_LOCK_UNREADABLE: 'Lock de registro anterior nao pode ser inspecionado.',
      STATE_DIRECTORY_UNREADABLE: 'Pasta de registros anteriores nao pode ser inspecionada.'
    }[warning.code];
    io.write('Aviso: ' + label + ' Registro: ' + warning.path);
  }
  if (warnings.length) io.write('Inspecao somente leitura. Registros preservados; a nova execucao usa outro arquivo.');
  return warnings;
}
