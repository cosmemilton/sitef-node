import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileJournal, SitefError } from '../dist/index.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'sitef-journal-lock-'));
  const file = join(directory, 'terminal.journal.json');
  const journals = [];
  t.after(async () => {
    try {
      for (const journal of journals) await journal.release();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  return {
    directory,
    file,
    lock: file + '.lock',
    journal(path = file) {
      const journal = new FileJournal(path);
      journals.push(journal);
      return journal;
    }
  };
}

function existingLockError(lock) {
  return (error) => {
    assert.ok(error instanceof SitefError);
    assert.equal(error.code, 'TERMINAL_LOCKED');
    assert.match(error.message, /ativo ou órfão/);
    assert.match(error.message, /reconcilie/);
    assert.ok(error.cause instanceof Error);
    assert.equal(error.cause.code, 'EEXIST');
    assert.equal(error.cause.syscall, 'open');
    assert.equal(error.cause.path, lock);
    return true;
  };
}

test('segundo FileJournal informa TERMINAL_LOCKED e preserva lock e journal ativos', async (t) => {
  const state = await fixture(t);
  const originalJournal = Buffer.from('synthetic journal bytes\n');
  await writeFile(state.file, originalJournal);
  const owner = state.journal();
  const contender = state.journal();
  await owner.acquire();
  const originalLock = await readFile(state.lock);

  await assert.rejects(contender.acquire(), existingLockError(state.lock));
  assert.deepEqual(await readFile(state.lock), originalLock);
  assert.deepEqual(await readFile(state.file), originalJournal);
  await contender.release();
  assert.deepEqual(await readFile(state.lock), originalLock);
  assert.deepEqual(await readFile(state.file), originalJournal);
});

test('FileJournal que perdeu a disputa pode adquirir depois que o titular libera', async (t) => {
  const state = await fixture(t);
  const owner = state.journal();
  const contender = state.journal();
  await owner.acquire();
  await assert.rejects(contender.acquire(), existingLockError(state.lock));
  await owner.release();
  await assert.rejects(readFile(state.lock), { code: 'ENOENT' });

  await contender.acquire();
  assert.equal(JSON.parse(await readFile(state.lock, 'utf8')).pid, process.pid);
  await assert.rejects(owner.acquire(), existingLockError(state.lock));
  await contender.release();
  await assert.rejects(readFile(state.lock), { code: 'ENOENT' });
});

test('lock órfão sintético permanece intacto, sem exclusão nem sobrescrita automática', async (t) => {
  const state = await fixture(t);
  const originalJournal = Buffer.from('synthetic pending journal bytes\n');
  const orphanLock = Buffer.from(
    '{"pid":2147483647,"createdAt":"2000-01-01T00:00:00.000Z"}\n'
  );
  await writeFile(state.file, originalJournal);
  await writeFile(state.lock, orphanLock);
  const journal = state.journal();

  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(journal.acquire(), existingLockError(state.lock));
    await journal.release();
    assert.deepEqual(await readFile(state.lock), orphanLock);
    assert.deepEqual(await readFile(state.file), originalJournal);
  }
});

test('erro diferente de EEXIST ao abrir o lock não vira TERMINAL_LOCKED', async (t) => {
  const state = await fixture(t);
  const journal = state.journal(join(state.directory, 'invalid\0journal.json'));
  await assert.rejects(journal.acquire(), (error) => {
    assert.ok(error instanceof TypeError);
    assert.equal(error.code, 'ERR_INVALID_ARG_VALUE');
    assert.equal(error instanceof SitefError, false);
    return true;
  });
  await assert.rejects(readFile(state.lock), { code: 'ENOENT' });
});

test('falha ao criar o diretório do journal não é confundida com lock existente', async (t) => {
  const state = await fixture(t);
  const parent = join(state.directory, 'not-a-directory');
  const originalBytes = Buffer.from('synthetic parent file');
  await writeFile(parent, originalBytes);
  const journal = state.journal(join(parent, 'terminal.journal.json'));
  await assert.rejects(journal.acquire(), (error) => {
    assert.equal(error instanceof SitefError, false);
    assert.ok(['EEXIST', 'ENOTDIR'].includes(error.code));
    assert.equal(error.syscall, 'mkdir');
    return true;
  });
  assert.deepEqual(await readFile(parent), originalBytes);
});
