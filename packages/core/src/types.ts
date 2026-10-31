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
export interface UiRequest extends NativeExchange { kind: string }
export interface UiResponse { buffer?: string; bufferBase64?: string; continueFlag?: ContinueFlag }
export type InteractionHandler = (request: UiRequest, context: {signal: AbortSignal}) => Promise<UiResponse>;
export interface Transport {
  call<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
}
export type SessionState = 'idle' | 'running' | 'awaiting-finalization' | 'uncertain' | 'closed';
export interface JournalRecord {
  version: 1;
  id: string;
  storeId: string;
  terminalId: string;
  functionId: number;
  entryPoint?: string;
  fiscalDocument: string;
  fiscalDate: string;
  fiscalTime: string;
  state: 'started' | 'awaiting-finalization' | 'finalizing' | 'finalized-local' | 'ended' | 'uncertain';
  decision?: 0 | 1;
  /** Escopo exato da decisão; integrador não deve incluir segredos neste parâmetro. */
  finalizationParameters?: string;
  status?: number;
  updatedAt: string;
}
export interface Journal {
  /** Adquire exclusividade do terminal. Não remova locks após crash automaticamente. */
  acquire(): Promise<void>;
  read(): Promise<JournalRecord | undefined>;
  write(record: JournalRecord): Promise<void>;
  release(): Promise<void>;
}
export interface TransactionResult {
  status: number;
  transactionId: string;
  requiresFinalization: boolean;
  /** Dados potencialmente sensíveis: não registrar automaticamente. */
  fields: ReadonlyArray<{fieldType: number; buffer: string; bufferBase64?: string; decodingError?: boolean}>;
}
