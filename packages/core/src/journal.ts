import { mkdir, open, readFile, rename, unlink, stat } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Journal, JournalRecord } from './types.js';
import { SitefError } from './errors.js';
import { normalizeJournal } from './journal-record.js';

export class FileJournal implements Journal {
  private file: string;
  private lease?: Awaited<ReturnType<typeof open>>;
  constructor(absoluteFile: string) {
    if (!isAbsolute(absoluteFile))
      throw new SitefError(
        'INVALID_PATH',
        'Journal precisa de caminho absoluto em disco local persistente.'
      );
    this.file = absoluteFile;
  }
  async acquire(): Promise<void> {
    if (this.lease)
      throw new SitefError('TERMINAL_LOCKED', 'Journal já está em uso.');
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    try {
      this.lease = await open(this.file + '.lock', 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new SitefError(
          'TERMINAL_LOCKED',
          'Journal bloqueado por lock existente, que pode estar ativo ou órfão. Verifique a sessão e reconcilie o estado antes de liberar o terminal; não remova o lock automaticamente.',
          { cause: error }
        );
      throw error;
    }
    try {
      await this.lease.writeFile(
        JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString()
        })
      );
      await this.lease.sync();
    } catch (error) {
      await this.lease.close();
      this.lease = undefined;
      await unlink(this.file + '.lock').catch(() => undefined);
      throw error;
    }
  }
  async read(): Promise<JournalRecord | undefined> {
    try {
      if ((await stat(this.file)).size > 1048576)
        throw new Error('Journal excede limite.');
      return normalizeJournal(JSON.parse(await readFile(this.file, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new SitefError(
        'JOURNAL_INVALID',
        'Journal não pode ser lido; reconciliação necessária.',
        { cause: error }
      );
    }
  }
  async write(record: JournalRecord): Promise<void> {
    if (!this.lease)
      throw new SitefError('JOURNAL_UNLOCKED', 'Journal sem exclusividade.');
    const normalized = normalizeJournal(record);
    if (
      normalized.payments.some((p) =>
        /\{NFPAG=/i.test(p.finalizationParameters ?? '')
      )
    )
      throw new SitefError(
        'SENSITIVE_JOURNAL_PAYLOAD',
        'Persistir NFPAG no armazenamento externo configurado.'
      );
    const serialized = JSON.stringify(normalized);
    if (Buffer.byteLength(serialized) > 1048576)
      throw new SitefError('JOURNAL_TOO_LARGE', 'Journal excede o limite.');
    const temporary = this.file + '.' + randomUUID() + '.lock.tmp';
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(serialized);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, this.file);
      if (process.platform !== 'win32') {
        const directory = await open(dirname(this.file), 'r');
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
  async release(): Promise<void> {
    if (!this.lease) return;
    await this.lease.close();
    this.lease = undefined;
    await unlink(this.file + '.lock');
  }
}
