import {mkdir, open, readFile, rename, unlink} from 'node:fs/promises';
import {dirname, isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Journal, JournalRecord} from './types.js';
import {SitefError} from './errors.js';

export class FileJournal implements Journal {
  private file: string;
  private lease?: Awaited<ReturnType<typeof open>>;
  constructor(absoluteFile: string) {
    if (!isAbsolute(absoluteFile)) throw new SitefError('INVALID_PATH', 'Journal precisa de caminho absoluto em disco local persistente.');
    this.file = absoluteFile;
  }
  async acquire(): Promise<void> {
    if (this.lease) throw new SitefError('TERMINAL_LOCKED', 'Journal já está em uso.');
    await mkdir(dirname(this.file), {recursive: true, mode: 0o700});
    this.lease = await open(this.file + '.lock', 'wx', 0o600);
    try {
      await this.lease.writeFile(JSON.stringify({pid: process.pid, createdAt: new Date().toISOString()}));
      await this.lease.sync();
    } catch (error) {
      await this.lease.close(); this.lease = undefined;
      await unlink(this.file + '.lock').catch(() => undefined);
      throw error;
    }
  }
  async read(): Promise<JournalRecord | undefined> {
    try {
      const record = JSON.parse(await readFile(this.file, 'utf8')) as JournalRecord;
      if (record.version !== 1 || !record.id || !record.state || !record.fiscalDocument || !record.fiscalDate || !record.fiscalTime) throw new Error('Journal inválido.');
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new SitefError('JOURNAL_INVALID', 'Journal não pode ser lido; reconciliação necessária.', {cause: error});
    }
  }
  async write(record: JournalRecord): Promise<void> {
    if (!this.lease) throw new SitefError('JOURNAL_UNLOCKED', 'Journal sem exclusividade.');
    const temporary = this.file + '.' + randomUUID() + '.lock.tmp';
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); }
    finally { await handle.close(); }
    try {
      await rename(temporary, this.file);
      if (process.platform !== 'win32') {
        const directory = await open(dirname(this.file), 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      }
    } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
  }
  async release(): Promise<void> {
    if (!this.lease) return;
    await this.lease.close();
    this.lease = undefined;
    await unlink(this.file + '.lock');
  }
}
