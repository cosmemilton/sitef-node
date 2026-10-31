import {join, isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {BridgeTransport} from './transport.js';
import {FileJournal} from './journal.js';
import {SitefClient, type ClientOptions} from './client.js';
import {SitefError} from './errors.js';

export interface CreateSitefOptions extends Omit<ClientOptions, 'transport' | 'journal'> {
  bridgeExecutable: string;
  bridgeDirectory: string;
  libraryPath: string;
  workingDirectory?: string;
  stateDirectory: string;
  nativeEncoding?: 'windows-1252' | 'utf-8' | 'ascii';
  timeoutMs?: number;
  maxFrameBytes?: number;
  /** Exclusivo para bibliotecas sintéticas; não habilita suporte/homologação Linux. */
  testMode?: boolean;
}

/** Entrada simples: bridge externo, biblioteca do integrador e journal fixo por terminal. */
export async function createSitef(options: CreateSitefOptions): Promise<SitefClient> {
  if (process.platform === 'win32' && process.arch !== 'x64') throw new SitefError('UNSUPPORTED_ARCHITECTURE', 'Este SDK requer Node Windows x64.');
  if (!isAbsolute(options.stateDirectory)) throw new SitefError('INVALID_PATH', 'stateDirectory precisa ser absoluto e persistente.');
  const transport = new BridgeTransport({executable: options.bridgeExecutable, cwd: options.bridgeDirectory, timeoutMs: options.timeoutMs, maxFrameBytes: options.maxFrameBytes});
  try {
    const capabilities = await transport.call<{protocolVersion: number; platform: string; architecture: string}>('load', {
      libraryPath: options.libraryPath,
      ...(options.workingDirectory === undefined ? {} : {workingDirectory: options.workingDirectory}),
      nativeEncoding: options.nativeEncoding ?? 'windows-1252',
      testMode: options.testMode ?? false,
    });
    if (capabilities.protocolVersion !== 1) throw new SitefError('PROTOCOL_MISMATCH', 'Versão incompatível da ponte nativa.');
    if (capabilities.platform === 'windows' && capabilities.architecture !== 'x86_64') throw new SitefError('UNSUPPORTED_ARCHITECTURE', 'A ponte Windows precisa ser x64.');
    if (capabilities.platform !== 'windows' && !options.testMode) throw new SitefError('UNSUPPORTED_PLATFORM', 'Runtime de produção disponível somente para Windows x64.');
    const terminalKey = createHash('sha256').update(options.configuration.storeId + '\0' + options.configuration.terminalId).digest('hex');
    return await SitefClient.connect({
      transport,
      journal: new FileJournal(join(options.stateDirectory, terminalKey + '.journal.json')),
      configuration: options.configuration,
      interaction: options.interaction,
      onExchange: options.onExchange,
      bufferSize: options.bufferSize,
      maxSteps: options.maxSteps,
    });
  } catch (error) { await transport.close(); throw error; }
}
