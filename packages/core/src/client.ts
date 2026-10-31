import {randomUUID} from 'node:crypto';
import {SitefError} from './errors.js';
import {getCommandInfo} from './catalog.js';
import type {Configuration, InteractionHandler, Journal, JournalRecord, NativeExchange, SessionState, TransactionInput, TransactionResult, Transport, UiRequest, UiResponse} from './types.js';

export interface ClientOptions {
  transport: Transport;
  configuration: Configuration;
  journal: Journal;
  interaction: InteractionHandler;
  /** Observador recebe também comandos de dados e polling. Não registrar buffers sensíveis. */
  onExchange?: (exchange: Readonly<UiRequest>) => void | Promise<void>;
  bufferSize?: number;
  maxSteps?: number;
}
function text(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.includes('\0')) throw new SitefError('INVALID_ARGUMENT', `${name} deve ser texto sem NUL.`);
}
function nativeStatus(value: unknown): number {
  const status = (value as {status?: unknown})?.status;
  if (!Number.isInteger(status)) throw new SitefError('INVALID_NATIVE_RESULT', 'Retorno nativo sem status inteiro.', {uncertain: true});
  return status as number;
}
function validateInput(input: TransactionInput): void {
  if (!Number.isInteger(input.functionId) || input.functionId < -2147483648 || input.functionId > 2147483647) throw new SitefError('INVALID_ARGUMENT', 'functionId deve ser int32.');
  for (const key of ['amount', 'fiscalDocument', 'fiscalDate', 'fiscalTime', 'operator'] as const) text(input[key], key);
  text(input.additionalParameters ?? '', 'additionalParameters');
  if (input.amount !== '' && !/^\d+,\d{2}$/.test(input.amount)) throw new SitefError('INVALID_AMOUNT', 'amount deve usar duas casas (10,00) ou vazio quando o valor será coletado.');
  if (!/^\d{8}$/.test(input.fiscalDate) || !/^\d{6}$/.test(input.fiscalTime) || !input.fiscalDocument || input.fiscalDocument.length > 20 || input.operator.length > 20) throw new SitefError('INVALID_FISCAL_ID', 'Cupom e operador têm até 20 caracteres; data AAAAMMDD e hora HHMMSS. Limites nativos em bytes também são verificados pela ponte.');
  const y = Number(input.fiscalDate.slice(0, 4)), m = Number(input.fiscalDate.slice(4, 6)), d = Number(input.fiscalDate.slice(6));
  const calendar = new Date(Date.UTC(y, m - 1, d));
  if (calendar.getUTCFullYear() !== y || calendar.getUTCMonth() + 1 !== m || calendar.getUTCDate() !== d || Number(input.fiscalTime.slice(0, 2)) > 23 || Number(input.fiscalTime.slice(2, 4)) > 59 || Number(input.fiscalTime.slice(4)) > 59) throw new SitefError('INVALID_FISCAL_ID', 'Data/hora fiscal inválida.');
}

export class SitefClient {
  private options: ClientOptions;
  private currentState: SessionState = 'idle';
  private record?: JournalRecord;
  private cancellation?: AbortController;
  private operation = false;
  private constructor(options: ClientOptions) { this.options = options; }
  get state(): SessionState { return this.currentState; }
  get recovery(): Readonly<JournalRecord> | undefined { return this.record ? {...this.record} : undefined; }
  static async connect(options: ClientOptions): Promise<SitefClient> {
    const client = new SitefClient(options);
    const config = options.configuration;
    text(config.server, 'server'); text(config.storeId, 'storeId'); text(config.terminalId, 'terminalId');
    text(config.additionalParameters ?? '', 'additionalParameters');
    if (!config.server || !/^\d{8}$/.test(config.storeId) || !/^[A-Za-z0-9]{8}$/.test(config.terminalId) || (config.reserved ?? 0) !== 0) throw new SitefError('INVALID_CONFIGURATION', 'Servidor obrigatório, loja com 8 dígitos, terminal com 8 caracteres alfanuméricos e reservado 0.');
    if (!Number.isInteger(options.bufferSize ?? 20000) || (options.bufferSize ?? 20000) < 20000 || (options.bufferSize ?? 20000) > 1048576) throw new SitefError('INVALID_BUFFER', 'bufferSize deve estar entre 20000 e 1048576 bytes.');
    if (!Number.isSafeInteger(options.maxSteps ?? 100000) || (options.maxSteps ?? 100000) < 1) throw new SitefError('INVALID_OPTIONS', 'maxSteps inválido.');
    await options.journal.acquire();
    try {
      client.record = await options.journal.read();
      if (client.record && (client.record.storeId !== config.storeId || client.record.terminalId !== config.terminalId)) throw new SitefError('JOURNAL_TERMINAL_MISMATCH', 'Journal pertence a outro terminal.');
      const result = await options.transport.call('configure', {...config, reserved: 0, additionalParameters: config.additionalParameters ?? ''});
      const status = nativeStatus(result);
      if (status !== 0) throw new SitefError('CONFIGURATION_FAILED', `CliSiTef recusou a configuração (${status}).`, {nativeStatus: status});
      if (client.record && !['ended', 'finalized-local'].includes(client.record.state)) client.currentState = 'uncertain';
      return client;
    } catch (error) { await options.journal.release(); await options.transport.close(); throw error; }
  }
  /** Só consulta o estado; nunca reenvia venda automaticamente. */
  async capabilities(): Promise<Record<string, unknown>> { return this.options.transport.call('capabilities'); }
  cancel(): void { this.cancellation?.abort(); }
  async transact(input: TransactionInput, options: {signal?: AbortSignal; nativeStart?: {method: 'startBanking' | 'readSecureCard' | 'readTrack3' | 'readPassword' | 'readChip'; params: Record<string, unknown>}; requiresFinalization?: boolean} = {}): Promise<TransactionResult> {
    if (this.currentState !== 'idle' || this.operation) throw new SitefError('SESSION_BUSY', `Sessão em ${this.currentState}.`);
    validateInput(input);
    if (options.signal?.aborted) throw new SitefError('ABORTED', 'Operação cancelada antes do início.');
    this.operation = true;
    this.cancellation = new AbortController();
    const abort = () => this.cancellation?.abort();
    options.signal?.addEventListener('abort', abort, {once: true});
    this.record = {version: 1, id: randomUUID(), storeId: this.options.configuration.storeId, terminalId: this.options.configuration.terminalId, functionId: input.functionId, entryPoint: options.nativeStart?.method ?? 'start', fiscalDocument: input.fiscalDocument, fiscalDate: input.fiscalDate, fiscalTime: input.fiscalTime, state: 'started', updatedAt: new Date().toISOString()};
    const fields: Array<{fieldType: number; buffer: string; bufferBase64?: string; decodingError?: boolean}> = [];
    let started = false;
    let interactionFailure: unknown;
    try {
      await this.save('started'); // Persistir ANTES de entrar na biblioteca financeira.
      this.currentState = 'running';
      started = true;
      let parameters = options.nativeStart?.params ?? {...input, additionalParameters: input.additionalParameters ?? ''};
      if (options.nativeStart?.method === 'startBanking') parameters = {...parameters, fiscalDocument: input.fiscalDocument, fiscalDate: input.fiscalDate, fiscalTime: input.fiscalTime, operator: input.operator};
      let status = nativeStatus(await this.options.transport.call(options.nativeStart?.method ?? 'start', parameters));
      let response: UiResponse = {};
      let steps = 0;
      while (status === 10000) {
        if (++steps > (this.options.maxSteps ?? 100000)) throw new SitefError('LOOP_LIMIT', 'Limite de passos atingido; estado requer reconciliação.', {uncertain: true});
        const cancelled = this.cancellation.signal.aborted || interactionFailure !== undefined;
        const exchange = await this.options.transport.call<NativeExchange>('continue', {buffer: cancelled ? '' : response.buffer ?? '', ...(!cancelled && response.bufferBase64 !== undefined ? {bufferBase64: response.bufferBase64} : {}), continueFlag: cancelled ? -1 : response.continueFlag ?? 0, bufferSize: this.options.bufferSize ?? 20000});
        status = nativeStatus(exchange);
        // Comando só é válido quando o retorno exige continuidade.
        if (status !== 10000) break;
        if (![exchange.command, exchange.fieldType, exchange.minLength, exchange.maxLength].every(Number.isInteger) || typeof exchange.buffer !== 'string') throw new SitefError('INVALID_NATIVE_RESULT', 'Continuação nativa malformada.', {uncertain: true});
        const request: UiRequest = {...exchange, kind: getCommandInfo(exchange.command).kind};
        if (exchange.command === 0) {
          fields.push({fieldType: exchange.fieldType, buffer: exchange.buffer, bufferBase64: exchange.bufferBase64, decodingError: exchange.decodingError});
        }
        response = {}; // Nunca reutilizar a resposta do ciclo anterior.
        if (exchange.command === 0) response = {buffer: exchange.buffer, bufferBase64: exchange.bufferBase64}; // Eco obrigatório, preservando bytes.
        if (cancelled) continue;
        try {
          if (exchange.command === 23) {
            // Polling não pode esperar lógica de tela ou observadores lentos.
            const cancellation = this.cancellation;
            void Promise.resolve().then(() => this.options.onExchange?.(Object.freeze({...request}))).catch(error => { interactionFailure = error; cancellation.abort(); });
          } else {
            await this.untilAbort(async () => { await this.options.onExchange?.(Object.freeze({...request})); }, undefined);
          }
          if (exchange.command !== 0 && exchange.command !== 23) response = await this.interact(request);
          if (!response || (response.continueFlag !== undefined && ![-1, 0, 1, 2, 10000].includes(response.continueFlag))) throw new SitefError('INVALID_RESPONSE', 'Callback retornou controle inválido.');
          text(response.buffer ?? '', 'buffer');
          if (response.continueFlag === -1) this.cancellation.abort();
        } catch (error) { interactionFailure = error; this.cancellation.abort(); }
      }
      const requiresFinalization = status === 0 && (options.requiresFinalization ?? (!options.nativeStart || options.nativeStart.method === 'startBanking'));
      this.currentState = requiresFinalization ? 'awaiting-finalization' : 'idle';
      await this.save(requiresFinalization ? 'awaiting-finalization' : 'ended', {status});
      if (interactionFailure !== undefined) throw new SitefError('INTERACTION_FAILED', `Interação falhou; ciclo terminou com retorno ${status}. Consulte state antes de finalizar.`, {nativeStatus: status, cause: interactionFailure});
      return {status, transactionId: this.record.id, requiresFinalization, fields};
    } catch (error) {
      if (started && !(error instanceof SitefError && error.code === 'INTERACTION_FAILED')) {
        this.currentState = 'uncertain';
        await this.save('uncertain').catch(() => undefined);
        throw new SitefError('TRANSACTION_UNCERTAIN', 'Não é possível determinar o resultado. Não repetir a operação; reconciliar pendências.', {uncertain: true, cause: error});
      }
      throw error;
    } finally {
      options.signal?.removeEventListener('abort', abort);
      this.cancellation = undefined;
      this.operation = false;
    }
  }
  private async interact(request: UiRequest): Promise<UiResponse> {
    const signal = this.cancellation!.signal;
    return this.untilAbort(() => this.options.interaction(request, {signal}), {continueFlag: -1});
  }
  private async untilAbort<T>(operation: () => Promise<T>, abortedValue: T): Promise<T> {
    const signal = this.cancellation!.signal;
    if (signal.aborted) return abortedValue;
    let listener: () => void;
    const aborted = new Promise<T>(resolve => { listener = () => resolve(abortedValue); signal.addEventListener('abort', listener, {once: true}); });
    try { return await Promise.race([Promise.resolve().then(operation), aborted]); }
    finally { signal.removeEventListener('abort', listener!); }
  }
  async finalize(confirm: boolean, additionalParameters?: string): Promise<{returned: true; remoteConfirmation: 'not-reported'}> {
    if (this.currentState !== 'awaiting-finalization' || this.operation) throw new SitefError('INVALID_STATE', 'Não há transação aguardando decisão.');
    return this.finish(confirm, additionalParameters);
  }
  /** Usar somente após consultar/reconciliar pendências nativas e conferir o id. */
  async finalizeRecovery(confirm: boolean, expectedTransactionId: string, additionalParameters?: string): Promise<{returned: true; remoteConfirmation: 'not-reported'}> {
    if (this.currentState !== 'uncertain' || this.operation || this.record?.id !== expectedTransactionId) throw new SitefError('INVALID_RECOVERY', 'Reconciliação exige estado incerto e id do journal correspondente.');
    if (this.record.decision !== undefined && this.record.decision !== (confirm ? 1 : 0)) throw new SitefError('RECOVERY_DECISION_MISMATCH', 'A decisão persistida diverge. Reconcilie externamente antes de alterar a decisão.');
    if (additionalParameters !== undefined && this.record.finalizationParameters !== undefined && additionalParameters !== this.record.finalizationParameters) throw new SitefError('RECOVERY_SCOPE_MISMATCH', 'O escopo persistido da finalização não pode ser alterado na retomada.');
    return this.finish(confirm, additionalParameters ?? this.record.finalizationParameters);
  }
  private async finish(confirm: boolean, additionalParameters?: string): Promise<{returned: true; remoteConfirmation: 'not-reported'}> {
    if (typeof confirm !== 'boolean') throw new SitefError('INVALID_ARGUMENT', 'confirm deve ser boolean.');
    text(additionalParameters ?? '', 'additionalParameters');
    this.operation = true;
    try {
      await this.save('finalizing', {decision: confirm ? 1 : 0, finalizationParameters: additionalParameters ?? ''});
      const record = this.record!;
      const result = await this.options.transport.call<{returned: boolean}>('finish', {confirm: confirm ? 1 : 0, fiscalDocument: record.fiscalDocument, fiscalDate: record.fiscalDate, fiscalTime: record.fiscalTime, ...(additionalParameters === undefined ? {} : {additionalParameters})});
      if (result.returned !== true) throw new SitefError('INVALID_NATIVE_RESULT', 'Finalização sem confirmação de retorno local.', {uncertain: true});
      await this.save('finalized-local');
      this.currentState = 'idle';
      return {returned: true, remoteConfirmation: 'not-reported'};
    } catch (error) {
      this.currentState = 'uncertain';
      await this.save('uncertain').catch(() => undefined);
      throw new SitefError('FINALIZATION_UNCERTAIN', 'Falha na finalização; consultar pendências. Não repetir automaticamente.', {uncertain: true, cause: error});
    } finally { this.operation = false; }
  }
  /** Escape hatch para rotinas TIPADAS conhecidas pela ponte. Nunca aceita nome de símbolo arbitrário. */
  async callNative<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.operation || !['idle', 'uncertain'].includes(this.currentState)) throw new SitefError('SESSION_BUSY', 'Rotinas auxiliares indisponíveis durante ciclo/decisão.');
    const reads = ['pendingCount', 'version', 'capabilities'];
    if (this.currentState === 'uncertain' && !reads.includes(method)) throw new SitefError('RECOVERY_REQUIRED', 'Somente consultas de recuperação são permitidas em estado incerto.');
    if (['load', 'configure', 'configureEx', 'start', 'continue', 'finish', 'startBanking', 'readSecureCard', 'readTrack3', 'readPassword', 'readChip', 'readChipEx'].includes(method)) throw new SitefError('RESERVED_METHOD', 'Use as operações de sessão para esta rotina.');
    this.operation = true;
    try { return await this.options.transport.call<T>(method, params); }
    finally { this.operation = false; }
  }
  /** Auxiliar permitida durante a coleta dos comandos 31/35, serializada pela ponte. */
  async validateBarcode(data: string): Promise<{status: number; documentType: number}> {
    text(data, 'data');
    if (!['idle', 'running'].includes(this.currentState)) throw new SitefError('INVALID_STATE', 'Validação indisponível neste estado.');
    return this.options.transport.call('validateBarcode', {data});
  }
  private async save(state: JournalRecord['state'], patch: Partial<JournalRecord> = {}): Promise<void> {
    this.record = {...this.record!, ...patch, state, updatedAt: new Date().toISOString()};
    await this.options.journal.write(this.record);
  }
  async close(): Promise<void> {
    if (this.operation || this.currentState === 'running') throw new SitefError('SESSION_BUSY', 'Cancele cooperativamente e aguarde o ciclo antes de fechar.');
    if (this.currentState === 'awaiting-finalization') throw new SitefError('FINALIZATION_REQUIRED', 'Decida confirmar/desfazer antes de fechar.');
    await this.options.transport.close();
    await this.options.journal.release();
    this.currentState = 'closed';
  }
}
