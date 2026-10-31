import { randomUUID, createHash } from 'node:crypto';
import { SitefError } from './errors.js';
import { getCommandInfo } from './catalog.js';
import {
  FieldProcessor,
  functionDefinition,
  validateFieldResponse,
  buildNfpag,
  nativeByteLength
} from './fields.js';
import { normalizeJournal, groupState } from './journal-record.js';
import type {
  FieldOptions,
  FieldContext,
  FieldSnapshot,
  Receipt,
  ReceiptReference,
  NfpagMethod,
  FinalizationPayloadReference
} from './semantic-types.js';
import type {
  Configuration,
  InteractionHandler,
  Journal,
  GroupJournalRecord,
  PaymentRecord,
  NativeExchange,
  SessionState,
  TransactionInput,
  TransactionResult,
  Transport,
  UiRequest,
  UiResponse,
  PendingTransaction,
  PendingTransactionsResult
} from './types.js';

export interface ClientOptions {
  transport: Transport;
  configuration: Configuration;
  journal: Journal;
  interaction: InteractionHandler;
  onExchange?: (exchange: Readonly<UiRequest>) => void | Promise<void>;
  fields?: FieldOptions;
  bufferSize?: number;
  maxSteps?: number;
}
export interface TransactionOptions {
  signal?: AbortSignal;
  appendPayment?: boolean;
  requiresFinalization?: boolean;
  nativeStart?: {
    method:
      | 'startBanking'
      | 'readSecureCard'
      | 'readTrack3'
      | 'readPassword'
      | 'readChip';
    params: Record<string, unknown>;
  };
}
type CycleResult = {
  status: number;
  details: FieldSnapshot;
  fields: TransactionResult['fields'];
  failure?: unknown;
  processor: FieldProcessor;
};
type FinishPart = {
  payments: PaymentRecord[];
  parameters: string;
  payload?: FinalizationPayloadReference;
};
const pending = (payment: PaymentRecord) =>
  !['ended', 'finalized-local'].includes(payment.state);
const key = (payment: PaymentRecord) =>
  payment.fiscalDocument + '\0' + payment.fiscalDate;
const reserved =
  /\{(?:NumeroPagamentoCupom|RedeConfirmacao|NumeroPagamentoNFPAG|NFPAG)=/i;
function text(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.includes('\0'))
    throw new SitefError('INVALID_ARGUMENT', `${name} deve ser texto sem NUL.`);
}
function status(value: unknown): number {
  const code = (value as { status?: unknown })?.status;
  if (!Number.isInteger(code))
    throw new SitefError('INVALID_NATIVE_RESULT', 'Status nativo inválido.', {
      uncertain: true
    });
  return code as number;
}
function validateInput(
  input: TransactionInput,
  financial: boolean,
  encoding: FieldOptions['nativeEncoding']
): void {
  if (
    !Number.isInteger(input.functionId) ||
    input.functionId < -2147483648 ||
    input.functionId > 2147483647
  )
    throw new SitefError('INVALID_ARGUMENT', 'functionId deve ser int32.');
  for (const field of [
    'amount',
    'fiscalDocument',
    'fiscalDate',
    'fiscalTime',
    'operator'
  ] as const)
    text(input[field], field);
  text(input.additionalParameters ?? '', 'additionalParameters');
  if (input.amount !== '' && !/^\d+,\d{2}$/.test(input.amount))
    throw new SitefError(
      'INVALID_AMOUNT',
      'Valor deve ser decimal com duas casas ou vazio.'
    );
  if (
    nativeByteLength(input.fiscalDocument, encoding) > 20 ||
    nativeByteLength(input.operator, encoding) > 20
  )
    throw new SitefError(
      'INVALID_FISCAL_ID',
      'Cupom e operador têm limite de 20 bytes nativos.'
    );
  if (
    !financial &&
    !input.fiscalDocument &&
    !input.fiscalDate &&
    !input.fiscalTime
  )
    return;
  if (
    !input.fiscalDocument ||
    !/^\d{8}$/.test(input.fiscalDate) ||
    !/^\d{6}$/.test(input.fiscalTime)
  )
    throw new SitefError('INVALID_FISCAL_ID', 'Identidade fiscal incompleta.');
  const y = Number(input.fiscalDate.slice(0, 4)),
    m = Number(input.fiscalDate.slice(4, 6)),
    d = Number(input.fiscalDate.slice(6)),
    date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() + 1 !== m ||
    date.getUTCDate() !== d ||
    Number(input.fiscalTime.slice(0, 2)) > 23 ||
    Number(input.fiscalTime.slice(2, 4)) > 59 ||
    Number(input.fiscalTime.slice(4)) > 59
  )
    throw new SitefError('INVALID_FISCAL_ID', 'Data/hora fiscal inválida.');
}
function receiptHash(
  receipt: Pick<Receipt, 'buffer' | 'bufferBase64'>
): string {
  return createHash('sha256')
    .update(
      receipt.bufferBase64 === undefined
        ? Buffer.from(receipt.buffer, 'utf8')
        : Buffer.from(receipt.bufferBase64, 'base64')
    )
    .digest('hex');
}
function receiptReferences(details: FieldSnapshot): ReceiptReference[] {
  return details.receipts.map(
    ({ id, fieldType, type, timing, billIndex, printed, ...body }) => ({
      id,
      fieldType,
      type,
      timing,
      billIndex,
      printed,
      hash: receiptHash(body)
    })
  );
}
function payloadHash(parameters: string): string {
  return createHash('sha256').update(parameters, 'utf8').digest('hex');
}
function safePayloadScope(parameters: string): string {
  return /\{NumeroPagamentoNFPAG=\d+\}/i.exec(parameters)?.[0] ?? '';
}
function partition(
  payments: PaymentRecord[],
  parameters: string
): FinishPart[] {
  const groups = new Map<string, PaymentRecord[]>();
  for (const payment of payments) {
    const k = key(payment);
    groups.set(k, [...(groups.get(k) ?? []), payment]);
  }
  return [...groups.values()].map((group) => ({ payments: group, parameters }));
}

export class SitefClient {
  private options: ClientOptions;
  private currentState: SessionState = 'idle';
  private record?: GroupJournalRecord;
  private cancellation?: AbortController;
  private operation = false;
  private collecting?: number;
  private processors = new Map<string, FieldProcessor>();
  private constructor(options: ClientOptions) {
    this.options = options;
  }
  get state(): SessionState {
    return this.currentState;
  }
  get recovery(): Readonly<GroupJournalRecord> | undefined {
    return this.record ? structuredClone(this.record) : undefined;
  }
  static async connect(options: ClientOptions): Promise<SitefClient> {
    const config = options.configuration;
    for (const field of ['server', 'storeId', 'terminalId'] as const)
      text(config[field], field);
    text(config.additionalParameters ?? '', 'additionalParameters');
    if (
      !config.server ||
      !/^\d{8}$/.test(config.storeId) ||
      !/^[A-Za-z0-9]{8}$/.test(config.terminalId) ||
      (config.reserved ?? 0) !== 0
    )
      throw new SitefError(
        'INVALID_CONFIGURATION',
        'Configuração de loja/terminal inválida.'
      );
    if (
      !Number.isInteger(options.bufferSize ?? 20000) ||
      (options.bufferSize ?? 20000) < 20000 ||
      (options.bufferSize ?? 20000) > 1048576
    )
      throw new SitefError('INVALID_BUFFER', 'Buffer nativo fora dos limites.');
    if (
      !Number.isSafeInteger(options.maxSteps ?? 100000) ||
      (options.maxSteps ?? 100000) < 1
    )
      throw new SitefError('INVALID_OPTIONS', 'Limite de passos inválido.');
    const self = new SitefClient(options);
    await options.journal.acquire();
    try {
      const saved = await options.journal.read();
      if (saved) self.record = normalizeJournal(saved);
      if (
        self.record &&
        (self.record.storeId !== config.storeId ||
          self.record.terminalId !== config.terminalId)
      )
        throw new SitefError(
          'JOURNAL_TERMINAL_MISMATCH',
          'Journal pertence a outro terminal.'
        );
      let migrated = false;
      for (const payment of self.record?.payments ?? []) {
        if (!/\{NFPAG=/i.test(payment.finalizationParameters ?? '')) continue;
        if (!options.fields?.hooks?.storeFinalizationPayload)
          throw new SitefError(
            'LEGACY_PAYLOAD_MIGRATION_REQUIRED',
            'Configure storeFinalizationPayload para migrar o payload legado sem descartá-lo.'
          );
        const parameters = payment.finalizationParameters!,
          reference = { id: randomUUID(), hash: payloadHash(parameters) };
        if (
          (await options.fields.hooks.storeFinalizationPayload(
            { ...reference, parameters },
            self.context(payment, true)
          )) !== true
        )
          throw new SitefError(
            'LEGACY_PAYLOAD_MIGRATION_REQUIRED',
            'Armazenamento do payload legado não confirmado.'
          );
        payment.finalizationPayload = reference;
        payment.finalizationParameters = safePayloadScope(parameters);
        migrated = true;
      }
      if (migrated) await self.save();
      const result = status(
        await options.transport.call('configure', {
          ...config,
          reserved: 0,
          additionalParameters: config.additionalParameters ?? ''
        })
      );
      if (result !== 0)
        throw new SitefError(
          'CONFIGURATION_FAILED',
          `Configuração recusada (${result}).`,
          { nativeStatus: result }
        );
      if (self.record?.payments.some(pending)) self.currentState = 'uncertain';
      return self;
    } catch (error) {
      try {
        await options.transport.close();
      } finally {
        await options.journal.release();
      }
      throw error;
    }
  }
  async capabilities(): Promise<Record<string, unknown>> {
    if (this.currentState === 'closed')
      throw new SitefError('SESSION_CLOSED', 'Sessão encerrada.');
    return this.options.transport.call('capabilities');
  }
  cancel(): void {
    this.cancellation?.abort();
  }
  private financial(
    input: TransactionInput,
    options: TransactionOptions
  ): boolean {
    const native = options.nativeStart?.method;
    const policy = native
      ? native === 'startBanking'
        ? 'financial'
        : 'nonfinancial'
      : (functionDefinition(input.functionId)?.finalizationPolicy ??
        'explicit');
    if (policy === 'explicit') {
      if (typeof options.requiresFinalization !== 'boolean')
        throw new SitefError(
          'FINALIZATION_POLICY_REQUIRED',
          'Esta função exige política explícita de finalização.'
        );
      return options.requiresFinalization;
    }
    const required = policy === 'financial';
    if (
      options.requiresFinalization !== undefined &&
      options.requiresFinalization !== required
    )
      throw new SitefError(
        'FINALIZATION_POLICY_MISMATCH',
        'Política de finalização diverge da função documentada.'
      );
    return required;
  }
  async runFunction(
    functionId: number,
    input: Partial<Omit<TransactionInput, 'functionId'>> = {},
    options: TransactionOptions = {}
  ): Promise<TransactionResult> {
    return this.transact(
      {
        functionId,
        amount: '',
        fiscalDocument: '',
        fiscalDate: '',
        fiscalTime: '',
        operator: '',
        ...input
      },
      options
    );
  }
  async transact(
    input: TransactionInput,
    options: TransactionOptions = {}
  ): Promise<TransactionResult> {
    if (
      this.operation ||
      !['idle', 'awaiting-finalization'].includes(this.currentState)
    )
      throw new SitefError('SESSION_BUSY', `Sessão em ${this.currentState}.`);
    const financial = this.financial(input, options);
    validateInput(input, financial, this.options.fields?.nativeEncoding);
    if (options.signal?.aborted)
      throw new SitefError('ABORTED', 'Cancelado antes do início.');
    if (this.currentState === 'awaiting-finalization') {
      if (options.appendPayment !== true || !financial)
        throw new SitefError(
          'SESSION_BUSY',
          'Use appendPayment para adicionar um pagamento ao grupo pendente.'
        );
      if (
        this.record!.payments.filter(pending).some(
          (p) =>
            p.fiscalDate === input.fiscalDate &&
            p.fiscalDocument !== input.fiscalDocument
        )
      )
        throw new SitefError(
          'FISCAL_GROUP_MISMATCH',
          'Um novo cupom no mesmo dia exige concluir o grupo anterior.'
        );
    }
    this.operation = true;
    const id = randomUUID();
    let payment: PaymentRecord | undefined;
    if (financial) {
      payment = {
        id,
        functionId: input.functionId,
        entryPoint: options.nativeStart?.method ?? 'start',
        fiscalDocument: input.fiscalDocument,
        fiscalDate: input.fiscalDate,
        fiscalTime: input.fiscalTime,
        state: 'started',
        confirmationAllowed: false
      };
      if (this.currentState === 'idle')
        this.record = {
          version: 2,
          id,
          storeId: this.options.configuration.storeId,
          terminalId: this.options.configuration.terminalId,
          functionId: input.functionId,
          fiscalDocument: input.fiscalDocument,
          fiscalDate: input.fiscalDate,
          fiscalTime: input.fiscalTime,
          state: 'started',
          updatedAt: new Date().toISOString(),
          payments: [payment]
        };
      else this.record!.payments.push(payment);
    }
    let entered = false,
      terminalKnown = false;
    const previousState = this.currentState;
    try {
      if (financial) await this.save();
      this.currentState = 'running';
      entered = true;
      const result = await this.cycle(input, options, id);
      terminalKnown = true;
      if (payment) {
        payment.status = result.status;
        payment.state = result.status === 0 ? 'awaiting-finalization' : 'ended';
        payment.paymentIndex = result.details.paymentIndex;
        payment.network = result.details.network;
        payment.receipts = receiptReferences(result.details);
        payment.signatureRequired = result.details.signatureRequired;
        payment.signatureCaptured = result.details.signatureCaptured;
        payment.confirmationAllowed =
          result.status === 0 &&
          result.details.assessment?.accepted !== false &&
          !result.failure &&
          !options.signal?.aborted;
        payment.assessmentIssues = [
          ...(result.details.assessment?.issues ?? []),
          ...(result.failure ? ['INTERACTION_FAILED'] : [])
        ];
        if (result.status === 0) this.processors.set(id, result.processor);
        await this.save();
        this.deriveState();
      } else this.currentState = previousState;
      if (result.failure)
        throw new SitefError(
          'INTERACTION_FAILED',
          `Interação falhou; retorno terminal ${result.status}. Consulte state antes da decisão.`,
          { nativeStatus: result.status, cause: result.failure }
        );
      return {
        status: result.status,
        transactionId: id,
        groupId: financial ? this.record!.id : undefined,
        requiresFinalization: financial && result.status === 0,
        fields: result.fields,
        details: result.details
      };
    } catch (error) {
      if (payment && entered && !terminalKnown) {
        payment.state = 'uncertain';
        this.currentState = 'uncertain';
        await this.save().catch(() => undefined);
        throw new SitefError(
          'TRANSACTION_UNCERTAIN',
          'Resultado indeterminado; não repetir. Consulte pendências.',
          { uncertain: true, cause: error }
        );
      }
      if (
        payment &&
        terminalKnown &&
        !(error instanceof SitefError && error.code === 'INTERACTION_FAILED')
      ) {
        payment.state = 'uncertain';
        this.currentState = 'uncertain';
        await this.save().catch(() => undefined);
        throw new SitefError(
          'JOURNAL_UNCERTAIN',
          'Resultado conhecido mas persistência incompleta; reconciliar.',
          { uncertain: true, cause: error }
        );
      }
      if (!entered) {
        if (payment)
          this.record!.payments = this.record!.payments.filter(
            (p) => p.id !== id
          );
        this.currentState = previousState;
      } else if (!payment) this.currentState = previousState;
      throw error;
    } finally {
      this.operation = false;
      this.cancellation = undefined;
      this.collecting = undefined;
    }
  }
  private async cycle(
    input: TransactionInput,
    options: TransactionOptions,
    id: string
  ): Promise<CycleResult> {
    const cancellation = new AbortController();
    this.cancellation = cancellation;
    const cancel = () => cancellation.abort();
    options.signal?.addEventListener('abort', cancel, { once: true });
    const definition = options.nativeStart
      ? functionDefinition(
          options.nativeStart.method === 'startBanking' ? 310 : 430
        )
      : functionDefinition(input.functionId);
    const context: FieldContext = {
      functionId: input.functionId,
      paymentId: id,
      groupId: this.record?.id ?? id,
      input,
      signal: cancellation.signal,
      definition
    };
    const processor = new FieldProcessor(
      {
        ...this.options.fields,
        context:
          this.options.fields?.context ??
          ((options.nativeStart &&
            options.nativeStart.method !== 'startBanking') ||
          [430, 431].includes(input.functionId)
            ? 'secure-card-read'
            : 'transaction')
      },
      context
    );
    const fields: NativeExchange[] = [];
    let failure: unknown;
    try {
      let parameters = options.nativeStart?.params ?? {
        ...input,
        additionalParameters: input.additionalParameters ?? ''
      };
      if (options.nativeStart?.method === 'startBanking')
        parameters = {
          ...parameters,
          fiscalDocument: input.fiscalDocument,
          fiscalDate: input.fiscalDate,
          fiscalTime: input.fiscalTime,
          operator: input.operator
        };
      let code = status(
        await this.options.transport.call(
          options.nativeStart?.method ?? 'start',
          parameters
        )
      );
      let response: UiResponse = {};
      let steps = 0;
      while (code === 10000) {
        if (++steps > (this.options.maxSteps ?? 100000))
          throw new SitefError('LOOP_LIMIT', 'Limite de passos excedido.', {
            uncertain: true
          });
        const cancelled = cancellation.signal.aborted || failure !== undefined;
        const raw = await this.options.transport.call<NativeExchange>(
          'continue',
          {
            buffer: cancelled ? '' : (response.buffer ?? ''),
            ...(!cancelled && response.bufferBase64 !== undefined
              ? { bufferBase64: response.bufferBase64 }
              : {}),
            continueFlag: cancelled ? -1 : (response.continueFlag ?? 0),
            bufferSize: this.options.bufferSize ?? 20000
          }
        );
        code = status(raw);
        if (code !== 10000) break;
        if (
          ![raw.command, raw.fieldType, raw.minLength, raw.maxLength].every(
            Number.isInteger
          ) ||
          typeof raw.buffer !== 'string'
        )
          throw new SitefError(
            'INVALID_NATIVE_RESULT',
            'Continuação malformada.',
            { uncertain: true }
          );
        if (raw.command === 0) fields.push({ ...raw });
        response =
          raw.command === 0
            ? { buffer: raw.buffer, bufferBase64: raw.bufferBase64 }
            : {};
        if (cancelled) continue;
        try {
          const request = await processor.process({
            ...raw,
            kind: getCommandInfo(raw.command).kind
          });
          if (raw.command === 23) {
            void Promise.resolve(
              this.options.onExchange?.(Object.freeze(request))
            ).catch((error) => {
              failure = error;
              cancellation.abort();
            });
            continue;
          }
          await this.untilAbort(
            async () => {
              await this.options.onExchange?.(Object.freeze(request));
            },
            undefined,
            cancellation.signal
          );
          if (raw.command !== 0) {
            this.collecting = raw.command;
            response = await this.untilAbort(
              () =>
                raw.command === 29 &&
                this.options.fields?.hooks?.resolveApplicationData
                  ? processor.applicationData(request)
                  : this.options.interaction(request, {
                      signal: cancellation.signal
                    }),
              { continueFlag: -1 },
              cancellation.signal
            );
            if (!response)
              throw new SitefError(
                'INVALID_RESPONSE',
                'Callback sem resposta.'
              );
            validateFieldResponse(request, response, this.options.fields);
            this.collecting = undefined;
            if (response.continueFlag === -1) cancellation.abort();
          }
        } catch (error) {
          failure = error;
          cancellation.abort();
          this.collecting = undefined;
        }
      }
      try {
        await processor.cleanup();
      } catch (error) {
        failure ??= error;
      }
      try {
        await processor.finish(code);
      } catch (error) {
        failure ??= error;
        processor.snapshot.assessment ??= {
          issues: [],
          accepted: false,
          installmentFallback: false
        };
        processor.snapshot.assessment.accepted = false;
        processor.snapshot.assessment.issues.push(
          error instanceof SitefError ? error.code : 'TRANSACTION_POLICY_FAILED'
        );
      }
      return {
        status: code,
        details: processor.snapshot,
        fields,
        failure,
        processor
      };
    } finally {
      options.signal?.removeEventListener('abort', cancel);
      await processor.cleanup();
    }
  }
  private async untilAbort<T>(
    operation: () => Promise<T>,
    abortedValue: T,
    signal: AbortSignal
  ): Promise<T> {
    if (signal.aborted) return abortedValue;
    let listener: () => void;
    const abort = new Promise<T>((resolve) => {
      listener = () => resolve(abortedValue);
      signal.addEventListener('abort', listener, { once: true });
    });
    try {
      return await Promise.race([Promise.resolve().then(operation), abort]);
    } finally {
      signal.removeEventListener('abort', listener!);
    }
  }
  private deriveState(): void {
    this.currentState = this.record?.payments.some((p) =>
      ['started', 'finalizing', 'uncertain'].includes(p.state)
    )
      ? 'uncertain'
      : this.record?.payments.some((p) => p.state === 'awaiting-finalization')
        ? 'awaiting-finalization'
        : 'idle';
  }
  private async save(): Promise<void> {
    if (!this.record) return;
    this.record.state = groupState(this.record);
    this.record.updatedAt = new Date().toISOString();
    await this.options.journal.write(this.record);
  }
  private pendingPayments(): PaymentRecord[] {
    return this.record?.payments.filter(pending) ?? [];
  }
  private readyToFinalize(): void {
    if (this.operation || this.currentState !== 'awaiting-finalization')
      throw new SitefError('INVALID_STATE', 'Grupo não aguarda decisão.');
  }
  private extra(value: string | undefined): string {
    text(value ?? '', 'additionalParameters');
    if (reserved.test(value ?? ''))
      throw new SitefError(
        'RESERVED_FINALIZATION_SCOPE',
        'Use finalizePayment, finalizeNetwork ou finalizeWithPayments para escopos reservados.'
      );
    return value ?? '';
  }
  async finalize(
    confirm: boolean,
    additionalParameters?: string
  ): Promise<{
    returned: true;
    remoteConfirmation: 'not-reported';
    payments: string[];
  }> {
    this.readyToFinalize();
    return this.finishParts(
      confirm,
      partition(this.pendingPayments(), this.extra(additionalParameters))
    );
  }
  async finalizePayment(
    confirm: boolean,
    paymentId: string,
    additionalParameters?: string
  ): Promise<{
    returned: true;
    remoteConfirmation: 'not-reported';
    payments: string[];
  }> {
    this.readyToFinalize();
    const payment = this.pendingPayments().find((p) => p.id === paymentId);
    if (!payment)
      throw new SitefError(
        'PAYMENT_NOT_FOUND',
        'Pagamento pendente não encontrado.'
      );
    if (payment.paymentIndex === undefined)
      throw new SitefError(
        'PAYMENT_INDEX_REQUIRED',
        'Pagamento sem índice 161 confirmado.'
      );
    if (
      this.pendingPayments().filter(
        (p) =>
          key(p) === key(payment) && p.paymentIndex === payment.paymentIndex
      ).length !== 1
    )
      throw new SitefError(
        'AMBIGUOUS_PAYMENT_INDEX',
        'Índice de pagamento ambíguo.'
      );
    return this.finishParts(confirm, [
      {
        payments: [payment],
        parameters:
          `{NumeroPagamentoCupom=${payment.paymentIndex}}` +
          this.extra(additionalParameters)
      }
    ]);
  }
  async finalizeNetwork(
    confirm: boolean,
    network: string,
    additionalParameters?: string
  ): Promise<{
    returned: true;
    remoteConfirmation: 'not-reported';
    payments: string[];
  }> {
    this.readyToFinalize();
    if (!/^\d+$/.test(network))
      throw new SitefError('INVALID_NETWORK', 'Rede inválida.');
    const all = this.pendingPayments();
    if (all.some((p) => p.network === undefined))
      throw new SitefError(
        'NETWORK_UNRESOLVED',
        'Resolva a rede de todos os pagamentos antes da seleção.'
      );
    const selected = all.filter((p) => p.network === network);
    if (!selected.length)
      throw new SitefError(
        'PAYMENT_NOT_FOUND',
        'Rede sem pagamentos pendentes.'
      );
    return this.finishParts(
      confirm,
      partition(
        selected,
        `{RedeConfirmacao=${network}}` + this.extra(additionalParameters)
      )
    );
  }
  async finalizeWithPayments(
    confirm: boolean,
    paymentId: string,
    methods: NfpagMethod[] | undefined,
    expectedTotal: string,
    additionalParameters?: string
  ): Promise<{
    returned: true;
    remoteConfirmation: 'not-reported';
    payments: string[];
  }> {
    this.readyToFinalize();
    const payment = this.pendingPayments().find((p) => p.id === paymentId),
      processor = this.processors.get(paymentId);
    if (!payment || payment.paymentIndex === undefined)
      throw new SitefError(
        'PAYMENT_INDEX_REQUIRED',
        'NFPAG exige pagamento e índice 161.'
      );
    if (!processor)
      throw new SitefError(
        'PAYMENT_DATA_REQUIRED',
        'Recarregue os dados de pagamento pela aplicação antes de anexar NFPAG.'
      );
    if (
      this.pendingPayments().filter(
        (p) =>
          key(p) === key(payment) && p.paymentIndex === payment.paymentIndex
      ).length !== 1
    )
      throw new SitefError(
        'AMBIGUOUS_PAYMENT_INDEX',
        'NFPAG exige índice de pagamento único na partição.'
      );
    if (methods === undefined) {
      if (!this.options.fields?.hooks?.paymentData)
        throw new SitefError(
          'PAYMENT_DATA_REQUIRED',
          'Forneça métodos ou o hook paymentData.'
        );
      this.operation = true;
      try {
        methods = await this.options.fields.hooks.paymentData(
          processor.snapshot.nfpag,
          processor.context
        );
      } finally {
        this.operation = false;
      }
    }
    const nfpag = buildNfpag(processor.snapshot.nfpag, methods, expectedTotal);
    return this.finishParts(confirm, [
      {
        payments: this.pendingPayments().filter((p) => key(p) === key(payment)),
        parameters:
          `{NumeroPagamentoNFPAG=${payment.paymentIndex}}{NFPAG=${nfpag}}` +
          this.extra(additionalParameters)
      }
    ]);
  }
  async finalizeRecovery(
    confirm: boolean,
    expectedTransactionId: string,
    additionalParameters?: string
  ): Promise<{
    returned: true;
    remoteConfirmation: 'not-reported';
    payments: string[];
  }> {
    if (
      this.currentState !== 'uncertain' ||
      this.operation ||
      this.record?.id !== expectedTransactionId
    )
      throw new SitefError(
        'INVALID_RECOVERY',
        'Reconciliação exige estado incerto e id do grupo correspondente.'
      );
    const all = this.pendingPayments(),
      planned = all.filter(
        (p) =>
          p.decision !== undefined &&
          ['uncertain', 'finalizing'].includes(p.state)
      );
    if (planned.length) {
      if (planned.some((p) => p.decision !== (confirm ? 1 : 0)))
        throw new SitefError(
          'RECOVERY_DECISION_MISMATCH',
          'Decisão diverge do plano persistido.'
        );
      if (
        additionalParameters !== undefined &&
        planned.some(
          (p) => (p.finalizationParameters ?? '') !== additionalParameters
        )
      )
        throw new SitefError(
          'RECOVERY_SCOPE_MISMATCH',
          'Escopo diverge do persistido.'
        );
      const groups = new Map<string, FinishPart>();
      for (const payment of planned) {
        const parameters = payment.finalizationParameters ?? '',
          k =
            key(payment) +
            '\0' +
            parameters +
            '\0' +
            (payment.finalizationPayload?.id ?? ''),
          part = groups.get(k) ?? {
            payments: [],
            parameters,
            payload: payment.finalizationPayload
          };
        part.payments.push(payment);
        groups.set(k, part);
      }
      return this.finishParts(confirm, [...groups.values()], true);
    }
    return this.finishParts(
      confirm,
      partition(all, this.extra(additionalParameters)),
      true
    );
  }
  private context(payment: PaymentRecord, recovery: boolean): FieldContext {
    return {
      functionId: payment.functionId,
      paymentId: payment.id,
      groupId: this.record!.id,
      input: {
        functionId: payment.functionId,
        amount: '',
        fiscalDocument: payment.fiscalDocument,
        fiscalDate: payment.fiscalDate,
        fiscalTime: payment.fiscalTime,
        operator: ''
      },
      signal: new AbortController().signal,
      recovery,
      definition: functionDefinition(payment.functionId)
    };
  }
  private async prepareReceipts(
    payment: PaymentRecord,
    recovery: boolean
  ): Promise<void> {
    const processor = this.processors.get(payment.id);
    if (processor) {
      await processor.printDeferred();
      payment.receipts = receiptReferences(processor.snapshot);
      payment.signatureCaptured = processor.snapshot.signatureCaptured;
      await this.save();
      return;
    }
    for (const reference of payment.receipts ?? []) {
      if (reference.printed) continue;
      if (
        !this.options.fields?.hooks?.loadReceipt ||
        !this.options.fields.hooks.printReceipt
      )
        throw new SitefError(
          'RECEIPT_RECOVERY_REQUIRED',
          'Forneça loadReceipt e printReceipt antes de confirmar recuperação.'
        );
      const receipt = await this.options.fields.hooks.loadReceipt(
        reference,
        this.context(payment, recovery)
      );
      if (
        receipt.id !== reference.id ||
        receipt.fieldType !== reference.fieldType ||
        receiptHash(receipt) !== reference.hash
      )
        throw new SitefError(
          'RECEIPT_HASH_MISMATCH',
          'Comprovante restaurado não corresponde ao original.'
        );
      if (
        (await this.options.fields.hooks.printReceipt(
          receipt,
          this.context(payment, recovery)
        )) !== true
      )
        throw new SitefError(
          'RECEIPT_PRINT_FAILED',
          'Impressão não confirmada.'
        );
      reference.printed = true;
      await this.save();
    }
    if (payment.signatureRequired && !payment.signatureCaptured) {
      if (!this.options.fields?.hooks?.captureSignature)
        throw new SitefError(
          'SIGNATURE_REQUIRED',
          'Forneça captureSignature antes de confirmar.'
        );
      if (
        (await this.options.fields.hooks.captureSignature(
          { paperRequired: true, paymentId: payment.id },
          this.context(payment, recovery)
        )) !== true
      )
        throw new SitefError(
          'SIGNATURE_REQUIRED',
          'Assinatura não confirmada.'
        );
      payment.signatureCaptured = true;
      await this.save();
    }
  }
  private async finishParts(
    confirm: boolean,
    parts: FinishPart[],
    recovery = false
  ): Promise<{
    returned: true;
    remoteConfirmation: 'not-reported';
    payments: string[];
  }> {
    if (typeof confirm !== 'boolean' || !parts.length)
      throw new SitefError('INVALID_ARGUMENT', 'Decisão ou seleção inválida.');
    const selected = parts.flatMap((p) => p.payments);
    this.operation = true;
    let entered = false;
    try {
      // Restore and verify every external payload while holding the operation lock,
      // before printing or entering any native finalization partition.
      if (recovery)
        for (const part of parts)
          if (part.payload) {
            if (!this.options.fields?.hooks?.loadFinalizationPayload)
              throw new SitefError(
                'FINALIZATION_PAYLOAD_REQUIRED',
                'Configure loadFinalizationPayload para retomar o plano NFPAG.'
              );
            const parameters =
              await this.options.fields.hooks.loadFinalizationPayload(
                part.payload,
                this.context(part.payments[0], true)
              );
            if (
              typeof parameters !== 'string' ||
              payloadHash(parameters) !== part.payload.hash
            )
              throw new SitefError(
                'FINALIZATION_PAYLOAD_MISMATCH',
                'Payload restaurado diverge do plano persistido.'
              );
            if (safePayloadScope(parameters) !== part.parameters)
              throw new SitefError(
                'FINALIZATION_PAYLOAD_SCOPE_MISMATCH',
                'O seletor do payload restaurado diverge do plano persistido.'
              );
            part.parameters = parameters;
          }
      if (confirm)
        for (const payment of selected)
          if (payment.legacyReceiptStateUnknown) {
            if (
              !this.options.fields?.hooks?.attestLegacyObligations ||
              (await this.options.fields.hooks.attestLegacyObligations(
                structuredClone(payment),
                this.context(payment, true)
              )) !== true
            )
              throw new SitefError(
                'LEGACY_OBLIGATIONS_REQUIRED',
                'Ateste as obrigações externas de comprovantes, assinatura e produto antes de confirmar o journal V1.'
              );
            payment.legacyReceiptStateUnknown = false;
            payment.confirmationAllowed = true;
            await this.save();
          }
      if (confirm && selected.some((p) => p.confirmationAllowed === false))
        throw new SitefError(
          'TRANSACTION_DECISION_REQUIRED',
          'Uma regra de produto ou interação ainda impede a confirmação.'
        );
      if (confirm)
        for (const payment of selected)
          await this.prepareReceipts(payment, recovery);
      for (const part of parts)
        if (/\{NFPAG=/i.test(part.parameters) && !part.payload) {
          if (!this.options.fields?.hooks?.storeFinalizationPayload)
            throw new SitefError(
              'FINALIZATION_PAYLOAD_STORE_REQUIRED',
              'Configure storeFinalizationPayload para NFPAG.'
            );
          const reference = {
            id: randomUUID(),
            hash: payloadHash(part.parameters)
          };
          if (
            (await this.options.fields.hooks.storeFinalizationPayload(
              { ...reference, parameters: part.parameters },
              this.context(part.payments[0], recovery)
            )) !== true
          )
            throw new SitefError(
              'FINALIZATION_PAYLOAD_STORE_FAILED',
              'Armazenamento do plano não confirmado.'
            );
          part.payload = reference;
        }
      for (const part of parts)
        for (const payment of part.payments) {
          payment.state = 'finalizing';
          payment.decision = confirm ? 1 : 0;
          payment.finalizationParameters = part.payload
            ? safePayloadScope(part.parameters)
            : part.parameters;
          payment.finalizationPayload = part.payload;
        }
      await this.save();
      for (const part of parts) {
        const payment = part.payments[0];
        entered = true;
        const result = await this.options.transport.call<{ returned: boolean }>(
          'finish',
          {
            confirm: confirm ? 1 : 0,
            fiscalDocument: payment.fiscalDocument,
            fiscalDate: payment.fiscalDate,
            fiscalTime: payment.fiscalTime,
            additionalParameters: part.parameters
          }
        );
        if (result.returned !== true)
          throw new SitefError(
            'INVALID_NATIVE_RESULT',
            'Finalização sem retorno local válido.',
            { uncertain: true }
          );
        for (const p of part.payments) {
          p.state = 'finalized-local';
          this.processors.delete(p.id);
        }
        try {
          await this.save();
        } catch (error) {
          // A locally returned void call cannot be treated as durably completed
          // when recording its outcome failed. Preserve the original decision.
          for (const p of part.payments) p.state = 'uncertain';
          throw error;
        }
      }
      this.deriveState();
      return {
        returned: true,
        remoteConfirmation: 'not-reported',
        payments: selected.map((p) => p.id)
      };
    } catch (error) {
      if (entered) {
        for (const payment of selected)
          if (payment.state === 'finalizing') payment.state = 'uncertain';
        this.currentState = 'uncertain';
        await this.save().catch(() => undefined);
        throw new SitefError(
          'FINALIZATION_UNCERTAIN',
          'Finalização parcial ou incerta; consulte pendências e preserve o plano.',
          { uncertain: true, cause: error }
        );
      }
      if (recovery) this.currentState = 'uncertain';
      else this.deriveState();
      throw error;
    } finally {
      this.operation = false;
    }
  }
  async queryPendingTransactions(
    options: {
      fiscalDocument?: string;
      fiscalDate?: string;
      signal?: AbortSignal;
    } = {}
  ): Promise<PendingTransactionsResult> {
    if (
      this.operation ||
      this.currentState === 'closed' ||
      this.currentState === 'running'
    )
      throw new SitefError('SESSION_BUSY', 'Sessão ocupada.');
    const specific =
        options.fiscalDocument !== undefined ||
        options.fiscalDate !== undefined,
      input: TransactionInput = {
        functionId: specific ? 131 : 130,
        amount: '',
        fiscalDocument: options.fiscalDocument ?? '',
        fiscalDate: options.fiscalDate ?? '',
        fiscalTime: specific ? '000000' : '',
        operator: ''
      };
    if (specific)
      validateInput(input, true, this.options.fields?.nativeEncoding);
    this.operation = true;
    try {
      const result = await this.cycle(
        input,
        { signal: options.signal, requiresFinalization: false },
        randomUUID()
      );
      if (result.failure)
        throw new SitefError(
          'PENDING_QUERY_FAILED',
          'Falha ao tratar consulta de pendências.',
          { nativeStatus: result.status, cause: result.failure }
        );
      if (result.status !== 0)
        return {
          status: result.status,
          transactions: [],
          fields: result.fields as NativeExchange[]
        };
      const transactions: PendingTransaction[] = [];
      let current: Partial<PendingTransaction> | undefined,
        count: number | undefined;
      for (const field of result.fields as NativeExchange[]) {
        if (field.fieldType === 210) {
          if (!/^\d+$/.test(field.buffer))
            throw new SitefError(
              'PENDING_DATA_INVALID',
              'Quantidade de pendências inválida.'
            );
          count = Number(field.buffer);
          if (!Number.isSafeInteger(count))
            throw new SitefError(
              'PENDING_DATA_INVALID',
              'Quantidade de pendências excede o intervalo seguro.'
            );
          continue;
        }
        if (field.fieldType === 160) {
          if (current) transactions.push(this.pendingRecord(current));
          current = { fiscalDocument: field.buffer, fields: [] };
        }
        if (!current) continue;
        current.fields!.push(field);
        if (field.fieldType === 161) current.paymentIndex = field.buffer;
        if (field.fieldType === 163) current.fiscalDate = field.buffer;
        if (field.fieldType === 164) current.fiscalTime = field.buffer;
        if (field.fieldType === 211) current.functionId = Number(field.buffer);
        if (field.fieldType === 1319) current.amount = field.buffer;
      }
      if (current) transactions.push(this.pendingRecord(current));
      if (
        result.status === 0 &&
        count !== undefined &&
        count !== transactions.length
      )
        throw new SitefError(
          'PENDING_COUNT_MISMATCH',
          'Quantidade e detalhes das pendências divergem.'
        );
      return {
        status: result.status,
        count,
        transactions,
        fields: result.fields as NativeExchange[]
      };
    } finally {
      this.operation = false;
      this.cancellation = undefined;
      this.collecting = undefined;
    }
  }
  private pendingRecord(
    value: Partial<PendingTransaction>
  ): PendingTransaction {
    if (
      !value.fiscalDocument ||
      !/^\d+$/.test(value.paymentIndex ?? '') ||
      !/^\d{8}$/.test(value.fiscalDate ?? '')
    )
      throw new SitefError(
        'PENDING_DATA_INCOMPLETE',
        'Registro sem identidade completa.'
      );
    return {
      fiscalDocument: value.fiscalDocument,
      paymentIndex: value.paymentIndex!,
      fiscalDate: value.fiscalDate!,
      fiscalTime: value.fiscalTime ?? '',
      functionId: value.functionId,
      amount: value.amount,
      fields: value.fields ?? []
    };
  }
  async callNative<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    if (this.operation || !['idle', 'uncertain'].includes(this.currentState))
      throw new SitefError('SESSION_BUSY', 'Rotina auxiliar indisponível.');
    if (
      this.currentState === 'uncertain' &&
      !['pendingCount', 'version', 'capabilities'].includes(method)
    )
      throw new SitefError(
        'RECOVERY_REQUIRED',
        'Somente consultas de recuperação permitidas.'
      );
    if (
      [
        'load',
        'configure',
        'configureEx',
        'start',
        'continue',
        'finish',
        'startBanking',
        'readSecureCard',
        'readTrack3',
        'readPassword',
        'readChip',
        'readChipEx'
      ].includes(method)
    )
      throw new SitefError('RESERVED_METHOD', 'Use as operações de sessão.');
    this.operation = true;
    try {
      return await this.options.transport.call<T>(method, params);
    } finally {
      this.operation = false;
    }
  }
  async validateBarcode(
    data: string
  ): Promise<{ status: number; documentType: number }> {
    text(data, 'data');
    if (
      this.currentState === 'running' &&
      ![31, 35].includes(this.collecting ?? -1)
    )
      throw new SitefError(
        'INVALID_STATE',
        'Validação iterativa exige coleta de cheque ou barras.'
      );
    if (!['idle', 'running'].includes(this.currentState))
      throw new SitefError('INVALID_STATE', 'Validação indisponível.');
    return this.options.transport.call('validateBarcode', { data });
  }
  async close(): Promise<void> {
    if (this.operation || this.currentState === 'running')
      throw new SitefError('SESSION_BUSY', 'Cancele e aguarde o ciclo.');
    if (this.currentState === 'awaiting-finalization')
      throw new SitefError(
        'FINALIZATION_REQUIRED',
        'Decida o grupo financeiro antes de fechar.'
      );
    if (this.currentState === 'closed') return;
    await this.options.transport.close();
    await this.options.journal.release();
    this.processors.clear();
    this.currentState = 'closed';
  }
}
