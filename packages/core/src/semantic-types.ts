import type {
  UiRequest,
  UiResponse,
  TransactionInput,
  PaymentRecord
} from './types.js';

export interface ExactDecimal {
  unscaled: string;
  scale: number;
}
export interface ProtocolOrigin {
  document: string;
  section: string;
  page: number;
}
export interface FieldDefinition {
  name: string;
  description: string;
  dataType: string;
  format?: string | Record<string, unknown>;
  choices?: Record<string, string>;
  sensitive?: boolean;
  resolverRequired?: boolean;
  action?:
    | {
        kind: string;
        requiredHook?: string;
        optionalHook?: string;
        phase?: string;
        [key: string]: unknown;
      }
    | string;
  contexts?: unknown;
  origin?: ProtocolOrigin;
  [key: string]: unknown;
}
export interface FunctionDefinition {
  name?: string;
  description?: string;
  domain?: string;
  origin?: ProtocolOrigin | string;
  finalizationPolicy: 'financial' | 'nonfinancial' | 'explicit';
  receiptPolicy: 'immediate' | 'deferred';
  [key: string]: unknown;
}
export interface FieldSemantic {
  known: boolean;
  definition?: FieldDefinition;
  format?: string;
  decimalPlaces: number;
  choices?: Record<string, string>;
  menuConfirmation: boolean;
  canCancelBill: boolean;
  sensitive: boolean;
  functionId: number;
  domain: string;
  billIndex?: string;
}
export interface TypedField {
  fieldType: number;
  raw: string;
  value: unknown;
  definition?: FieldDefinition;
  billIndex?: string;
  sensitive: boolean;
}
export interface Receipt {
  id: string;
  fieldType: number;
  buffer: string;
  bufferBase64?: string;
  type?: string;
  timing: 'immediate' | 'deferred';
  billIndex?: string;
  printed: boolean;
}
export interface ReceiptReference {
  id: string;
  fieldType: number;
  type?: string;
  timing: 'immediate' | 'deferred';
  billIndex?: string;
  hash: string;
  printed: boolean;
}
export interface FinalizationPayloadReference {
  id: string;
  hash: string;
}
export interface NfpagRequirements {
  maximum: number | undefined;
  types: Record<string, { fields: string[]; allowedNetworks?: string[] }>;
}
export interface NfpagMethod {
  type: string;
  amount: string;
  data?: Record<string, string>;
}
export interface ProductConstraint {
  kind: string;
  scope?: { medicineIndex?: string };
  fieldTypes: number[];
  raw: Record<string, string>;
  state: 'satisfied' | 'violated' | 'unresolved';
  reason: string;
}
export interface TransactionAssessment {
  issues: string[];
  accepted: boolean;
  approved?: ExactDecimal;
  balance?: ExactDecimal;
  received?: ExactDecimal;
  inputAmount?: ExactDecimal;
  change?: ExactDecimal;
  installmentFallback: boolean;
  pbmError?: string;
  /** Explicit product obligations and the original typed observations for application review. */
  fields?: TypedField[];
  productConstraints?: ProductConstraint[];
}
export interface FieldSnapshot {
  fields: TypedField[];
  receipts: Receipt[];
  bills: Record<string, TypedField[]>;
  nfpag: NfpagRequirements;
  diagnostics: Array<{ fieldType: number; value: string }>;
  paymentIndex?: string;
  network?: string;
  assessment?: TransactionAssessment;
  signatureRequired?: boolean;
  signatureCaptured?: boolean;
}
export interface FieldContext {
  functionId: number;
  paymentId: string;
  groupId: string;
  input: TransactionInput;
  signal: AbortSignal;
  recovery?: boolean;
  definition?: FunctionDefinition;
}
export type SideEffectHook = (
  value: unknown,
  context: FieldContext
) => boolean | Promise<boolean>;
export interface FieldHooks {
  /** Awaited before continuation; delivery does not attest physical printing. */
  onReceipt?: (
    receipt: Readonly<Receipt>,
    context: FieldContext
  ) => void | Promise<void>;
  printReceipt?: (
    receipt: Receipt,
    context: FieldContext
  ) => boolean | Promise<boolean>;
  storeReceipt?: (
    receipt: Receipt,
    context: FieldContext
  ) => boolean | Promise<boolean>;
  loadReceipt?: (
    reference: ReceiptReference,
    context: FieldContext
  ) => Receipt | Promise<Receipt>;
  lockResources?: SideEffectHook;
  unlockResources?: SideEffectHook;
  captureSignature?: SideEffectHook;
  onDiagnostic?: (
    value: unknown,
    context: FieldContext
  ) => void | Promise<void>;
  resolveField?: (
    request: UiRequest,
    context: FieldContext
  ) => unknown | Promise<unknown>;
  resolveApplicationData?: (
    request: UiRequest,
    context: FieldContext
  ) => UiResponse | Promise<UiResponse>;
  validateTransaction?: (
    assessment: TransactionAssessment,
    context: FieldContext
  ) => boolean | Promise<boolean>;
  acceptFallback?: (
    assessment: TransactionAssessment,
    context: FieldContext
  ) => boolean | Promise<boolean>;
  resolveConfirmationNetwork?: (
    snapshot: FieldSnapshot,
    context: FieldContext
  ) => string | Promise<string>;
  paymentData?: (
    requirements: NfpagRequirements,
    context: FieldContext
  ) => NfpagMethod[] | Promise<NfpagMethod[]>;
  storeFinalizationPayload?: (
    payload: FinalizationPayloadReference & { parameters: string },
    context: FieldContext
  ) => boolean | Promise<boolean>;
  loadFinalizationPayload?: (
    reference: FinalizationPayloadReference,
    context: FieldContext
  ) => string | Promise<string>;
  /** Certifica as obrigações externas que o formato V1 não conseguia registrar. */
  attestLegacyObligations?: (
    payment: Readonly<PaymentRecord>,
    context: FieldContext
  ) => boolean | Promise<boolean>;
}
export interface FieldOptions {
  hooks?: FieldHooks;
  /**
   * Defaults to sdk: review, deferred printing and required signature use hooks.
   * automation: finalize(true) is the application's explicit product decision
   * after it has fulfilled receipt printing/delivery and signature obligations.
   * The SDK exposes those obligations but does not perform or attest them, and
   * never marks receipts printed or signatures captured on the caller's behalf.
   * Immediate printing, objective violations and protocol safety still apply.
   * onReceipt observes delivery only and never satisfies a printing obligation.
   */
  finalizationResponsibility?: 'sdk' | 'automation';
  nativeEncoding?: 'windows-1252' | 'utf-8' | 'ascii';
  receiptStoragePolicy?: 'persist' | 'explicit-return';
  confirmationNetworkField?: 131 | 158;
  monetaryFormats?: Record<number, 'decimal-comma' | 'minor-units'>;
  yesNoValues?: { yes: string; no: string };
  context?: string;
}
