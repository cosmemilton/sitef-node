import { initializationCleanupFailure } from './initialization.js';
import { createSitef, type CreateSitefOptions } from './create.js';
import { SitefClient, type TransactionOptions } from './client.js';
import { SitefError } from './errors.js';
import type { Receipt } from './semantic-types.js';
import { getPartialTransaction, type PartialTransaction } from './transaction-snapshot.js';
import type {
  TransactionInput, TransactionResult, UiRequest, UiResponse,
  FinalizationResult, SessionState, GroupJournalRecord
} from './types.js';

/** Aliases legíveis, não uma lista de permissão: operation/functionId continuam aceitando qualquer int32. */
export const Operations = Object.freeze({
  Payment: 0, Debit: 2, Credit: 3, Administrative: 110,
  CommunicationTest: 111, WalletPayment: 122, WalletCancellation: 123
} as const);

export type ClientTransactionInput = TransactionInput & { operation?: never } |
  Omit<TransactionInput, 'functionId'> & { operation: number; functionId?: never };
export type TransactionState = 'created' | 'running' | 'completed' |
  'awaiting-finalization' | 'finalizing' | 'finalized-local' | 'failed' | 'uncertain' | 'disposed';
export type CallbackContext = { signal: AbortSignal };
export interface DisplayRequest extends UiRequest {
  target: 'operator' | 'customer' | 'both' | 'menu-title' | 'header';
  action: 'show' | 'clear';
}
export interface CollectionRequest extends UiRequest { secret: boolean; }
type MaybePromise<T> = T | Promise<T>;
type Callback<Request, Response> = (request: Readonly<Request>, context: CallbackContext) => MaybePromise<Response>;
/** Controles explícitos do protocolo, também aceitos pelos callbacks menu/collect/confirm. */
export const TransactionControl = Object.freeze({
  CANCEL: Object.freeze({ continueFlag: -1 } as const satisfies UiResponse),
  BACK: Object.freeze({ continueFlag: 1 } as const satisfies UiResponse)
});
export interface TransactionCallbacks {
  display?: Callback<DisplayRequest, void | UiResponse>;
  /** Retorne o ID nativo da opção, nunca sua posição visual ou rótulo. */
  menu?: Callback<UiRequest, string | UiResponse>;
  collect?: Callback<CollectionRequest, string | UiResponse>;
  /** Apenas pergunta nativa: true -> buffer 0, false -> buffer 1. Não é finalização fiscal. */
  confirm?: Callback<UiRequest, boolean | UiResponse>;
  /** Saída do comando 0 e consulta periódica do comando 23. Valores retornados nunca viram entrada nativa.
   * Observadores de consulta são assíncronos e não devem bloquear o laço nativo de continuação. */
  event?: Callback<UiRequest, void>;
  /** Aguardado para cada comprovante antes da continuação nativa, sem marcá-lo como impresso.
   * Um fields.hooks.onReceipt existente tem precedência. */
  receipt?: Callback<Receipt, void>;
  /** Comando 29; um fields.hooks.resolveApplicationData existente tem precedência. */
  application?: Callback<UiRequest, string | UiResponse>;
  acknowledge?: Callback<UiRequest, void | UiResponse>;
  /** Comandos 50/51/52. A exibição de QR deve retornar sem aguardar o pagamento. */
  qr?: Callback<UiRequest, void | UiResponse>;
  /** Alternativa explícita para comandos desconhecidos e interfaces de interação personalizadas. */
  raw?: Callback<UiRequest, UiResponse>;
}
export interface ClientSitefOptions extends Omit<CreateSitefOptions, 'interaction'> {
  /** Callbacks padrão, também usados por operações avançadas explícitas de consulta/recuperação. */
  callbacks?: TransactionCallbacks;
  /** Chamada opcional de EscreveMensagemPermanentePinPad após a configuração; o status deve ser 0. */
  initialPinpadMessage?: string;
}

function response(value: unknown, allowVoid = false): UiResponse {
  if (typeof value === 'string') return { buffer: value };
  if (value === undefined && allowVoid) return {};
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as UiResponse;
  throw new SitefError('INVALID_RESPONSE', 'O callback deve retornar o tipo de resposta documentado.');
}
function missing(request: UiRequest): never {
  throw new SitefError('MISSING_INTERACTION_HANDLER', `Nenhum callback definido para o comando nativo ${request.command}.`);
}
async function interact(callbacks: TransactionCallbacks, request: UiRequest, context: CallbackContext): Promise<UiResponse> {
  const code = request.command;
  if ([1, 2, 3, 4, 11, 12, 13, 14, 15, 16].includes(code) && callbacks.display) {
    const target: DisplayRequest['target'] = [1, 11].includes(code) ? 'operator' :
      [2, 12].includes(code) ? 'customer' : [3, 13].includes(code) ? 'both' :
      [4, 14].includes(code) ? 'menu-title' : 'header';
    const action = [11, 12, 13, 14, 16].includes(code) ? 'clear' : 'show';
    return response(await callbacks.display(Object.freeze({ ...request, target, action }), context), true);
  }
  if ([21, 42].includes(code) && callbacks.menu)
    return response(await callbacks.menu(request, context));
  if ([30, 31, 34, 35, 41].includes(code) && callbacks.collect)
    return response(await callbacks.collect(Object.freeze({ ...request,
      secret: code === 41 || request.semantic?.sensitive === true }), context));
  if (code === 20 && callbacks.confirm) {
    const value = await callbacks.confirm(request, context);
    return typeof value === 'boolean' ? { buffer: value ? '0' : '1' } : response(value);
  }
  if (code === 29 && callbacks.application)
    return response(await callbacks.application(request, context));
  if (code === 22 && callbacks.acknowledge)
    return response(await callbacks.acknowledge(request, context), true);
  if ([50, 51, 52].includes(code) && callbacks.qr)
    return response(await callbacks.qr(request, context), true);
  if (callbacks.raw) return response(await callbacks.raw(request, context));
  return missing(request);
}

const execute = Symbol('execute');

/** Uma conexão nativa por aplicação, com callbacks e cancelamento locais à transação. */
export class ClientSitef {
  #core: SitefClient;
  #defaults: Readonly<TransactionCallbacks>;
  #active?: { transaction: Transaction; callbacks: Readonly<TransactionCallbacks>; signal: AbortSignal };
  #idleSignal = new AbortController().signal;
  private constructor(core: SitefClient, callbacks: TransactionCallbacks) {
    this.#core = core;
    this.#defaults = Object.freeze({ ...callbacks });
  }
  static async create(options: ClientSitefOptions): Promise<ClientSitef> {
    if (options.initialPinpadMessage !== undefined &&
        (typeof options.initialPinpadMessage !== 'string' || options.initialPinpadMessage.includes('\0')))
      throw new SitefError('INVALID_ARGUMENT', 'initialPinpadMessage deve ser texto sem NUL.');
    let client: ClientSitef | undefined;
    const defaults = Object.freeze({ ...options.callbacks });
    const finalizationResponsibility = options.fields?.finalizationResponsibility ?? 'automation';
    const fieldHooks = { ...options.fields?.hooks };
    const core = await createSitef({
      ...options,
      fields: {
        ...options.fields,
        finalizationResponsibility,
        receiptStoragePolicy: options.fields?.receiptStoragePolicy ?? 'explicit-return',
        hooks: {
          ...fieldHooks,
          onReceipt: fieldHooks.onReceipt ?? (async (receipt, context) => {
            const callbacks = (client ? client.#active?.callbacks : undefined) ?? defaults;
            await callbacks.receipt?.(receipt, { signal: context.signal });
          })
        }
      },
      interaction: (request, context) => interact((client ? client.#active?.callbacks : undefined) ?? defaults, request, context),
      onExchange: async (request) => {
        // Capture before awaiting: a late poll observer must not read the next transaction's callbacks.
        const active = client ? client.#active : undefined;
        const callbacks = active?.callbacks ?? defaults;
        const signal = active?.signal ?? (client ? client.#idleSignal : new AbortController().signal);
        await options.onExchange?.(request);
        if (request.command === 0 || request.command === 23)
          await callbacks.event?.(request, { signal });
      }
    });
    client = new ClientSitef(core, defaults);
    try {
      if (options.initialPinpadMessage !== undefined) {
        const result = await client.escreverMensagemPinpad(options.initialPinpadMessage);
        if (result.status !== 0)
          throw new SitefError('PINPAD_MESSAGE_FAILED', 'A mensagem inicial do pinpad não foi aceita.', { nativeStatus: result.status });
      }
      return client;
    } catch (error) {
      try { await core.close(); } catch { throw initializationCleanupFailure(error); }
      throw error;
    }
  }
  /** API existente completa: consultas explícitas de pendências, finalização com escopo definido, recuperação e extensões. */
  get advanced(): SitefClient { return this.#core; }
  get state(): SessionState { return this.#core.state; }
  get recovery(): Readonly<GroupJournalRecord> | undefined { return this.#core.recovery; }
  createTransaction(input: ClientTransactionInput, options: TransactionOptions = {}): Transaction {
    if (this.#core.state === 'closed') throw new SitefError('SESSION_CLOSED', 'O cliente está fechado.');
    return new Transaction(this, input, options);
  }
  /** Escreve a mensagem permanente do pinpad enquanto ocioso; preserva o status nativo, inclusive retornos não zero. */
  async escreverMensagemPinpad(message: string): Promise<{ status: number }> {
    if (typeof message !== 'string' || message.includes('\0'))
      throw new SitefError('INVALID_ARGUMENT', 'A mensagem do pinpad deve ser texto sem NUL.');
    if (this.#active)
      throw new SitefError('SESSION_BUSY', 'A mensagem do pinpad não pode ser alterada durante uma transação.');
    if (this.#core.state === 'uncertain')
      throw new SitefError('RECONNECT_REQUIRED',
        'A sessão está incerta. Preserve os dados de recuperação e reconcilie antes de escrever uma mensagem no pinpad.', { uncertain: true });
    const result = await this.#core.callNative<{ status: number }>('pinpadPermanentMessage', { message });
    if (!result || !Number.isInteger(result.status))
      throw new SitefError('INVALID_NATIVE_RESULT', 'Status inválido da mensagem do pinpad.');
    return result;
  }
  capabilities(): ReturnType<SitefClient['capabilities']> { return this.#core.capabilities(); }
  callNative<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.#core.callNative<T>(method, params);
  }
  validateBarcode(data: string): ReturnType<SitefClient['validateBarcode']> { return this.#core.validateBarcode(data); }
  close(): Promise<void> { return this.#core.close(); }
  async [execute](transaction: Transaction, input: TransactionInput, options: TransactionOptions,
    callbacks: TransactionCallbacks, signal: AbortSignal): Promise<TransactionResult> {
    if (this.#active || this.#core.isBusy) throw new SitefError('SESSION_BUSY', 'Outra transação está ativa.');
    this.#active = { transaction, callbacks: Object.freeze({ ...this.#defaults, ...callbacks }), signal };
    try {
      return await this.#core.transact(input, { ...options, signal });
    } finally {
      this.#active = undefined;
    }
  }
}

/** Uma única tentativa. Crie um novo objeto para uma nova operação; process nunca repete a tentativa. */
export class Transaction {
  #client?: ClientSitef;
  #input?: TransactionInput;
  #options?: TransactionOptions;
  #callbacks?: TransactionCallbacks;
  #controller?: AbortController;
  #state: TransactionState = 'created';
  #result?: TransactionResult;
  #partial?: PartialTransaction;
  #id?: string;
  #status?: number;
  constructor(client: ClientSitef, input: ClientTransactionInput, options: TransactionOptions = {}) {
    if ('operation' in input && 'functionId' in input)
      throw new SitefError('INVALID_ARGUMENT', 'Use operation ou functionId, nunca ambos.');
    const { operation, ...native } = input;
    this.#input = Object.freeze({ ...native, functionId: operation ?? native.functionId! });
    this.#options = { ...options, ...(options.nativeStart ? {
      nativeStart: { ...options.nativeStart, params: { ...options.nativeStart.params } }
    } : {}) };
    this.#client = client;
  }
  get status(): number | undefined { return this.#status; }
  get result(): TransactionResult | undefined { return this.#result; }
  /** Mesmo retrato de estado de getPartialTransaction(error); nunca fabrique um resultado completo em caso de falha. */
  get partialResult(): PartialTransaction | undefined { return this.#partial; }
  get state(): TransactionState {
    if (['disposed', 'created', 'running', 'finalizing'].includes(this.#state)) return this.#state;
    const payment = this.#client?.recovery?.payments.find(item => item.id === this.#id);
    if (payment?.state === 'finalized-local') return 'finalized-local';
    if (payment?.state === 'uncertain' || payment?.state === 'finalizing') return 'uncertain';
    if (payment?.state === 'awaiting-finalization') return 'awaiting-finalization';
    return this.#state;
  }
  async process(callbacks: TransactionCallbacks = {}): Promise<TransactionResult> {
    if (this.#state !== 'created')
      throw new SitefError('TRANSACTION_ALREADY_PROCESSED', 'Uma transação representa uma única tentativa. Crie uma nova transação.');
    this.#state = 'running';
    this.#controller = new AbortController();
    const signal = this.#options!.signal
      ? AbortSignal.any([this.#controller.signal, this.#options!.signal]) : this.#controller.signal;
    this.#callbacks = { ...callbacks };
    try {
      const result = await this.#client![execute](this, this.#input!, this.#options!, this.#callbacks, signal);
      // Internal identity/status never follow later edits of the public result object.
      this.#id = result.transactionId;
      this.#status = result.status;
      this.#result = result;
      this.#state = result.requiresFinalization ? 'awaiting-finalization' : 'completed';
      return result;
    } catch (error) {
      this.#partial = getPartialTransaction(error);
      this.#id = this.#partial?.transactionId;
      this.#status = this.#partial?.status;
      this.#state = this.#partial?.requiresRecovery ? 'uncertain' : 'failed';
      throw error;
    } finally {
      this.#controller = undefined;
      this.#callbacks = undefined;
    }
  }
  /** Cancelamento cooperativo do ciclo ativo deste objeto, nunca um desfazimento nem cancelamento de outra transação. */
  cancel(): void { this.#controller?.abort(); }
  confirm(additionalParameters?: string): Promise<FinalizationResult> { return this.#finalize(true, additionalParameters); }
  undo(additionalParameters?: string): Promise<FinalizationResult> { return this.#finalize(false, additionalParameters); }
  async #finalize(confirm: boolean, additionalParameters?: string): Promise<FinalizationResult> {
    if (!this.#client || !this.#id || ['running', 'finalizing', 'disposed'].includes(this.#state))
      throw new SitefError('INVALID_STATE', 'A transação não está disponível para finalização.');
    const previous = this.#state;
    this.#state = 'finalizing';
    try {
      const result = await this.#client.advanced.finalizeTransaction(confirm, this.#id, additionalParameters);
      this.#state = 'finalized-local';
      return result;
    } catch (error) {
      this.#state = previous;
      throw error;
    }
  }
  /** Libera apenas as referências deste objeto. Decisões pendentes e registros persistentes permanecem intactos. */
  dispose(): void {
    if (['running', 'finalizing'].includes(this.#state))
      throw new SitefError('TRANSACTION_ACTIVE', 'Cancele e aguarde o ciclo ativo antes de liberar a transação.');
    if (this.#state === 'disposed') return;
    this.#client = undefined;
    this.#input = undefined;
    this.#options = undefined;
    this.#callbacks = undefined;
    this.#controller = undefined;
    this.#result = undefined;
    this.#partial = undefined;
    this.#id = undefined;
    this.#status = undefined;
    this.#state = 'disposed';
  }
}
