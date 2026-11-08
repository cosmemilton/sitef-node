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

/** Friendly aliases, not a whitelist: operation/functionId still accept any int32. */
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
/** Explicit protocol controls, also accepted by menu/collect/confirm callbacks. */
export const TransactionControl = Object.freeze({
  CANCEL: Object.freeze({ continueFlag: -1 } as const satisfies UiResponse),
  BACK: Object.freeze({ continueFlag: 1 } as const satisfies UiResponse)
});
export interface TransactionCallbacks {
  display?: Callback<DisplayRequest, void | UiResponse>;
  /** Return the native option ID, never its visual position or label. */
  menu?: Callback<UiRequest, string | UiResponse>;
  collect?: Callback<CollectionRequest, string | UiResponse>;
  /** Native question only: true -> buffer 0, false -> buffer 1. Not fiscal finalization. */
  confirm?: Callback<UiRequest, boolean | UiResponse>;
  /** Command 0 output and command 23 polling. Return values never become native input.
   * Poll observers are asynchronous and must not block the native continuation loop. */
  event?: Callback<UiRequest, void>;
  /** Awaited for each receipt before native continuation, without marking it printed.
   * An existing fields.hooks.onReceipt takes precedence. */
  receipt?: Callback<Receipt, void>;
  /** Command 29; an existing fields.hooks.resolveApplicationData takes precedence. */
  application?: Callback<UiRequest, string | UiResponse>;
  acknowledge?: Callback<UiRequest, void | UiResponse>;
  /** Commands 50/51/52. Showing a QR must return without awaiting the payment. */
  qr?: Callback<UiRequest, void | UiResponse>;
  /** Explicit escape hatch for unknown commands and custom interaction UIs. */
  raw?: Callback<UiRequest, UiResponse>;
}
export interface ClientSitefOptions extends Omit<CreateSitefOptions, 'interaction'> {
  /** Default callbacks, also used by explicit advanced query/recovery operations. */
  callbacks?: TransactionCallbacks;
  /** Optional EscreveMensagemPermanentePinPad call after configuration; status must be 0. */
  initialPinpadMessage?: string;
}

function response(value: unknown, allowVoid = false): UiResponse {
  if (typeof value === 'string') return { buffer: value };
  if (value === undefined && allowVoid) return {};
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as UiResponse;
  throw new SitefError('INVALID_RESPONSE', 'Callback must return the documented response type.');
}
function missing(request: UiRequest): never {
  throw new SitefError('MISSING_INTERACTION_HANDLER', `No callback for native command ${request.command}.`);
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

/** One native connection per application, with transaction-local callbacks and cancellation. */
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
      throw new SitefError('INVALID_ARGUMENT', 'initialPinpadMessage must be text without NUL.');
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
        const result = await core.callNative<{ status: number }>('pinpadPermanentMessage', {
          message: options.initialPinpadMessage
        });
        if (!Number.isInteger(result.status))
          throw new SitefError('INVALID_NATIVE_RESULT', 'Invalid pinpad message status.');
        if (result.status !== 0)
          throw new SitefError('PINPAD_MESSAGE_FAILED', 'Initial pinpad message was not accepted.', { nativeStatus: result.status });
      }
      return client;
    } catch (error) {
      try { await core.close(); } catch { throw initializationCleanupFailure(error); }
      throw error;
    }
  }
  /** Full existing API: explicit pending queries, scoped finalization, recovery and extensions. */
  get advanced(): SitefClient { return this.#core; }
  get state(): SessionState { return this.#core.state; }
  get recovery(): Readonly<GroupJournalRecord> | undefined { return this.#core.recovery; }
  createTransaction(input: ClientTransactionInput, options: TransactionOptions = {}): Transaction {
    if (this.#core.state === 'closed') throw new SitefError('SESSION_CLOSED', 'Client is closed.');
    return new Transaction(this, input, options);
  }
  capabilities(): ReturnType<SitefClient['capabilities']> { return this.#core.capabilities(); }
  callNative<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.#core.callNative<T>(method, params);
  }
  validateBarcode(data: string): ReturnType<SitefClient['validateBarcode']> { return this.#core.validateBarcode(data); }
  close(): Promise<void> { return this.#core.close(); }
  async [execute](transaction: Transaction, input: TransactionInput, options: TransactionOptions,
    callbacks: TransactionCallbacks, signal: AbortSignal): Promise<TransactionResult> {
    if (this.#active || this.#core.isBusy) throw new SitefError('SESSION_BUSY', 'Another transaction is active.');
    this.#active = { transaction, callbacks: Object.freeze({ ...this.#defaults, ...callbacks }), signal };
    try {
      return await this.#core.transact(input, { ...options, signal });
    } finally {
      this.#active = undefined;
    }
  }
}

/** A single attempt. Create a new object for a new operation; process never retries. */
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
      throw new SitefError('INVALID_ARGUMENT', 'Use operation or functionId, never both.');
    const { operation, ...native } = input;
    this.#input = Object.freeze({ ...native, functionId: operation ?? native.functionId! });
    this.#options = { ...options, ...(options.nativeStart ? {
      nativeStart: { ...options.nativeStart, params: { ...options.nativeStart.params } }
    } : {}) };
    this.#client = client;
  }
  get status(): number | undefined { return this.#status; }
  get result(): TransactionResult | undefined { return this.#result; }
  /** Same snapshot as getPartialTransaction(error); never fabricate a complete result on failure. */
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
      throw new SitefError('TRANSACTION_ALREADY_PROCESSED', 'A transaction is a single attempt. Create a new transaction.');
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
  /** Cooperative cancellation of this object's active cycle, never an undo or another transaction's cancel. */
  cancel(): void { this.#controller?.abort(); }
  confirm(additionalParameters?: string): Promise<FinalizationResult> { return this.#finalize(true, additionalParameters); }
  undo(additionalParameters?: string): Promise<FinalizationResult> { return this.#finalize(false, additionalParameters); }
  async #finalize(confirm: boolean, additionalParameters?: string): Promise<FinalizationResult> {
    if (!this.#client || !this.#id || ['running', 'finalizing', 'disposed'].includes(this.#state))
      throw new SitefError('INVALID_STATE', 'Transaction is not available for finalization.');
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
  /** Release this object's references only. Pending decisions and journal records remain intact. */
  dispose(): void {
    if (['running', 'finalizing'].includes(this.#state))
      throw new SitefError('TRANSACTION_ACTIVE', 'Cancel and await the active cycle before disposing.');
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
