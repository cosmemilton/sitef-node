import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {isAbsolute} from 'node:path';
import {SitefError} from './errors.js';
import type {Transport} from './types.js';

export interface BridgeOptions {
  executable: string;
  cwd: string;
  args?: string[];
  /** Overrides apply only to the child; the parent environment is unchanged. */
  env?: Record<string, string>;
  timeoutMs?: number;
  maxFrameBytes?: number;
}
/** IPC privado stdio: sem shell, portas de rede ou repetição automática. */
export class BridgeTransport implements Transport {
  private process: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private input = Buffer.alloc(0);
  private dead = false;
  private queue: Promise<unknown> = Promise.resolve();
  private pending?: {id: number; resolve: (value: unknown) => void; reject: (error: unknown) => void; timer: NodeJS.Timeout};
  private timeoutMs: number;
  private maxFrameBytes: number;
  private exited: Promise<void>;
  constructor(options: BridgeOptions) {
    if (!isAbsolute(options.executable) || !isAbsolute(options.cwd)) throw new SitefError('INVALID_PATH', 'executable e cwd precisam ser absolutos.');
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.maxFrameBytes = options.maxFrameBytes ?? 1_048_576;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0 || !Number.isSafeInteger(this.maxFrameBytes) || this.maxFrameBytes < 1024) throw new SitefError('INVALID_OPTIONS', 'Limites IPC inválidos.');
    this.process = spawn(options.executable, options.args ?? [], {cwd: options.cwd, env: { ...process.env, ...options.env }, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
    this.exited = new Promise(resolve => { this.process.once('exit', () => resolve()); this.process.once('error', () => resolve()); });
    this.process.stdout.on('data', (chunk: Buffer) => this.receive(chunk));
    // Mensagens externas podem conter dados financeiros; nunca as encaminhar a logs.
    this.process.stderr.resume();
    this.process.on('error', error => this.fail('BRIDGE_SPAWN', error));
    this.process.on('exit', () => this.fail('BRIDGE_EXIT'));
    this.process.stdin.on('error', error => this.fail('BRIDGE_PIPE', error));
    this.process.stdout.on('end', () => this.fail('BRIDGE_EOF'));
  }
  call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const operation = this.queue.then(() => this.send(method, params));
    this.queue = operation.catch(() => undefined);
    return operation as Promise<T>;
  }
  private send(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.dead) return Promise.reject(new SitefError('BRIDGE_CLOSED', 'Ponte encerrada; não repetir operação financeira.', {uncertain: true}));
    const id = this.nextId++;
    const frame = JSON.stringify({id, method, params}) + '\n';
    if (Buffer.byteLength(frame) > this.maxFrameBytes) return Promise.reject(new SitefError('FRAME_TOO_LARGE', 'Requisição excede limite IPC.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail('BRIDGE_TIMEOUT'), this.timeoutMs);
      this.pending = {id, resolve, reject, timer};
      this.process.stdin.write(frame);
    });
  }
  private receive(chunk: Buffer): void {
    if (this.dead) return;
    this.input = Buffer.concat([this.input, chunk]);
    let boundary: number;
    while ((boundary = this.input.indexOf(10)) !== -1) {
      if (boundary > this.maxFrameBytes) return this.fail('FRAME_TOO_LARGE');
      const frame = this.input.subarray(0, boundary).toString('utf8');
      this.input = this.input.subarray(boundary + 1);
      try {
        const reply = JSON.parse(frame);
        const pending = this.pending;
        if (!pending || reply.id !== pending.id || (('result' in reply) === ('error' in reply))) return this.fail('INVALID_FRAME');
        clearTimeout(pending.timer);
        this.pending = undefined;
        if (reply.error) pending.reject(new SitefError(String(reply.error.code), String(reply.error.message)));
        else pending.resolve(reply.result);
      } catch (cause) { return this.fail('INVALID_FRAME', cause); }
    }
    if (this.input.byteLength > this.maxFrameBytes) this.fail('FRAME_TOO_LARGE');
  }
  private fail(code: string, cause?: unknown): void {
    if (this.dead) return;
    this.dead = true;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new SitefError(code, 'Falha na ponte. Resultado da operação nativa pode ser incerto; reconciliar antes de prosseguir.', {uncertain: true, cause}));
      this.pending = undefined;
    }
    this.process.kill();
  }
  async close(): Promise<void> {
    if (!this.dead && !this.pending) {
      this.dead = true;
      // EOF permite à ponte descarregar a biblioteca e encerrar normalmente.
      this.process.stdin.end();
    } else if (!this.dead) {
      this.fail('BRIDGE_CLOSED');
    }
    const exited = await new Promise<boolean>(resolve => {
      const timer = setTimeout(() => resolve(false), 5000);
      void this.exited.then(() => { clearTimeout(timer); resolve(true); });
    });
    if (!exited) {
      this.process.kill();
      throw new SitefError('BRIDGE_CLOSE_TIMEOUT', 'A ponte não encerrou normalmente; mantenha o terminal bloqueado até verificar o processo.', {uncertain: true});
    }
  }
}
