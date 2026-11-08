import { initializationCleanupFailure } from './initialization.js';
import { join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { BridgeTransport, type BridgeOptions } from './transport.js';
import type { Transport } from './types.js';
import { FileJournal } from './journal.js';
import { SitefClient, type ClientOptions } from './client.js';
import { SitefError } from './errors.js';

export interface CreateSitefOptions extends Omit<
  ClientOptions,
  'transport'
> {
  /** Injectable transport; loading and configuration still run exactly once here. */
  transportFactory?: (options: BridgeOptions) => Transport | Promise<Transport>;
  bridgeExecutable: string;
  bridgeDirectory: string;
  libraryPath: string;
  workingDirectory?: string;
  /** Legacy explicit opt-in to FileJournal. Prefer a journal adapter or onStateChange. */
  stateDirectory?: string;
  nativeEncoding?: 'windows-1252' | 'utf-8' | 'ascii';
  timeoutMs?: number;
  maxFrameBytes?: number;
  /** Exclusivo para bibliotecas sintéticas; não habilita suporte/homologação Linux. */
  testMode?: boolean;
}

/** Bridge externo; persistência pertence à automação e é opcional. */
export async function createSitef(
  options: CreateSitefOptions
): Promise<SitefClient> {
  if (process.platform === 'win32' && process.arch !== 'x64')
    throw new SitefError(
      'UNSUPPORTED_ARCHITECTURE',
      'Este SDK requer Node Windows x64.'
    );
  if (options.stateDirectory !== undefined && !isAbsolute(options.stateDirectory))
    throw new SitefError(
      'INVALID_PATH',
      'stateDirectory precisa ser absoluto e persistente.'
    );
  if ((options.journal && options.stateDirectory !== undefined) ||
      (options.initialState && (options.journal || options.stateDirectory !== undefined)))
    throw new SitefError('INVALID_OPTIONS', 'Escolha apenas journal, stateDirectory ou initialState.');
  const supplied = await (options.transportFactory ?? ((bridgeOptions: BridgeOptions) => new BridgeTransport(bridgeOptions)))({
    executable: options.bridgeExecutable,
    cwd: options.bridgeDirectory,
    timeoutMs: options.timeoutMs,
    maxFrameBytes: options.maxFrameBytes
  });
  // connect() and load failure share cleanup without closing a resource twice.
  let closePromise: Promise<void> | undefined;
  const transport: Transport = {
    call: supplied.call.bind(supplied),
    close: () => closePromise ??= Promise.resolve().then(() => supplied.close())
  };
  try {
    const capabilities = await transport.call<{
      protocolVersion: number;
      platform: string;
      architecture: string;
    }>('load', {
      libraryPath: options.libraryPath,
      ...(options.workingDirectory === undefined
        ? {}
        : { workingDirectory: options.workingDirectory }),
      nativeEncoding: options.nativeEncoding ?? 'windows-1252',
      testMode: options.testMode ?? false
    });
    if (capabilities.protocolVersion !== 1)
      throw new SitefError(
        'PROTOCOL_MISMATCH',
        'Versão incompatível da ponte nativa.'
      );
    if (
      capabilities.platform === 'windows' &&
      capabilities.architecture !== 'x86_64'
    )
      throw new SitefError(
        'UNSUPPORTED_ARCHITECTURE',
        'A ponte Windows precisa ser x64.'
      );
    if (capabilities.platform !== 'windows' && !options.testMode)
      throw new SitefError(
        'UNSUPPORTED_PLATFORM',
        'Runtime de produção disponível somente para Windows x64.'
      );
    const terminalKey = createHash('sha256')
      .update(
        options.configuration.storeId + '\0' + options.configuration.terminalId
      )
      .digest('hex');
    return await SitefClient.connect({
      transport,
      journal: options.journal ?? (options.stateDirectory === undefined ? undefined : new FileJournal(
        join(options.stateDirectory, terminalKey + '.journal.json')
      )),
      initialState: options.initialState,
      onStateChange: options.onStateChange,
      configuration: options.configuration,
      interaction: options.interaction,
      onExchange: options.onExchange,
      bufferSize: options.bufferSize,
      maxSteps: options.maxSteps,
      fields: {
        ...options.fields,
        nativeEncoding: options.nativeEncoding ?? 'windows-1252'
      }
    });
  } catch (error) {
    try { await transport.close(); } catch { throw initializationCleanupFailure(error); }
    throw error;
  }
}
