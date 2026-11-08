import type { TransactionFields } from './field-results.js';
import type {
  FieldSemantic,
  FieldSnapshot,
  ReceiptReference,
  FinalizationPayloadReference
} from './semantic-types.js';
export type ContinueFlag = -1 | 0 | 1 | 2 | 10000;
export interface Configuration {
  server: string;
  storeId: string;
  terminalId: string;
  reserved?: 0;
  /** Parâmetro nativo integral. Extensões do fornecedor não são descartadas. */
  additionalParameters?: string;
}
export interface TransactionInput {
  functionId: number;
  /** Decimal nativo, sem conversão por ponto flutuante. Ex.: "10,00". */
  amount: string;
  fiscalDocument: string;
  fiscalDate: string;
  fiscalTime: string;
  operator: string;
  additionalParameters?: string;
}
export interface NativeExchange {
  status: number;
  command: number;
  fieldType: number;
  minLength: number;
  maxLength: number;
  buffer: string;
  bufferBase64?: string;
  decodingError?: boolean;
}
export interface UiRequest extends NativeExchange {
  kind: string;
  semantic?: FieldSemantic;
}
export interface UiResponse {
  buffer?: string;
  bufferBase64?: string;
  continueFlag?: ContinueFlag;
  confirmed?: boolean;
}
export type InteractionHandler = (
  request: UiRequest,
  context: { signal: AbortSignal }
) => Promise<UiResponse>;
export interface Transport {
  call<T = Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>
  ): Promise<T>;
  close(): Promise<void>;
}
export type SessionState =
  | 'idle'
  | 'running'
  | 'awaiting-finalization'
  | 'uncertain'
  | 'closed';
export interface LegacyJournalRecord {
  version: 1;
  id: string;
  storeId: string;
  terminalId: string;
  functionId: number;
  entryPoint?: string;
  fiscalDocument: string;
  fiscalDate: string;
  fiscalTime: string;
  state:
    | 'started'
    | 'awaiting-finalization'
    | 'finalizing'
    | 'finalized-local'
    | 'ended'
    | 'uncertain';
  decision?: 0 | 1;
  /** Escopo exato da decisão; integrador não deve incluir segredos neste parâmetro. */
  finalizationParameters?: string;
  status?: number;
  updatedAt: string;
}
export type PaymentState = LegacyJournalRecord['state'];
export interface PaymentRecord {
  id: string;
  functionId: number;
  entryPoint: string;
  fiscalDocument: string;
  fiscalDate: string;
  fiscalTime: string;
  state: PaymentState;
  decision?: 0 | 1;
  status?: number;
  paymentIndex?: string;
  network?: string;
  finalizationParameters?: string;
  /** SDK assessment verdict; automation may explicitly resolve advisory review at finalization. */
  confirmationAllowed?: boolean;
  /** Owner of external obligations for the persisted finalization plan. */
  finalizationResponsibility?: 'sdk' | 'automation';
  assessmentIssues?: string[];
  receipts?: ReceiptReference[];
  signatureRequired?: boolean;
  signatureCaptured?: boolean;
  finalizationPayload?: FinalizationPayloadReference;
  /** O journal V1 não registrava obrigações de comprovantes e assinatura. */
  legacyReceiptStateUnknown?: boolean;
}
export interface GroupJournalRecord {
  version: 2;
  id: string;
  storeId: string;
  terminalId: string;
  functionId: number;
  fiscalDocument: string;
  fiscalDate: string;
  fiscalTime: string;
  state: PaymentState;
  updatedAt: string;
  payments: PaymentRecord[];
}
export type JournalRecord = LegacyJournalRecord | GroupJournalRecord;
export interface Journal {
  /** Adquire exclusividade do terminal. Não remova locks após crash automaticamente. */
  acquire(): Promise<void>;
  read(): Promise<JournalRecord | undefined>;
  write(record: JournalRecord): Promise<void>;
  release(): Promise<void>;
}
/** Native fiscal scope: all pending payments for this coupon and date. */
export interface FiscalScope {
  fiscalDocument: string;
  fiscalDate: string;
}
/** Exact transaction when possible; fiscal scope explicitly selects its whole coupon. */
export type FinalizationScope = FiscalScope | { transactionId: string };
export interface FinalizationResult {
  returned: true;
  remoteConfirmation: 'not-reported';
  payments: string[];
}
export interface TransactionResult {
  /** Ordered native outputs and validated application inputs; explicit access only. */
  data: TransactionFields;
  status: number;
  transactionId: string;
  groupId?: string;
  requiresFinalization: boolean;
  /** Dados potencialmente sensíveis: não registrar automaticamente. */
  fields: ReadonlyArray<{
    fieldType: number;
    buffer: string;
    bufferBase64?: string;
    decodingError?: boolean;
  }>;
  details?: FieldSnapshot;
}
export interface PendingTransaction {
  fiscalDocument: string;
  fiscalDate: string;
  fiscalTime: string;
  paymentIndex: string;
  functionId?: number;
  amount?: string;
  fields: NativeExchange[];
}
export interface PendingTransactionsResult {
  data: TransactionFields;
  status: number;
  count?: number;
  transactions: PendingTransaction[];
  fields: NativeExchange[];
}
