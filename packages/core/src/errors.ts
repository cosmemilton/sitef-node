export const INTERACTION_FAILURE_STAGES = Object.freeze([
  'process-field', 'on-exchange', 'interaction', 'validate-response', 'cleanup', 'finish'
] as const);
export type InteractionFailureStage = typeof INTERACTION_FAILURE_STAGES[number];
export interface InteractionFailure {
  readonly stage: InteractionFailureStage;
  readonly command?: number;
  readonly fieldType?: number;
  readonly reasonCode: string;
}

// Never accept arbitrary error codes/messages as diagnostic text. These codes
// contain only fixed SDK/CLI classifications, not fields or callback content.
const INTERACTION_REASON_CODES = new Set([
  'UNCLASSIFIED_INTERACTION_ERROR',
  'MISSING_FIELD_HANDLER', 'MISSING_INTERACTION_HANDLER', 'FIELD_ACTION_FAILED', 'UNKNOWN_FORMAT',
  'INVALID_PRECISION', 'INVALID_PAYMENT_INDEX', 'NFPAG_METADATA',
  'INVALID_YESNO_VALUES', 'PRECISION_REQUIRED', 'AMBIGUOUS_FORMAT',
  'INVALID_PAYMENT_MODE', 'INVALID_DATETIME', 'INVALID_DATE',
  'INVALID_CHEQUE', 'INVALID_BARCODE', 'PIX_FIELDS_LIMIT', 'PIX_FIELD_INVALID',
  'INVALID_PRODUCT_LIST', 'INVALID_INPUT', 'ENCODING_ERROR', 'INVALID_DECIMAL',
  'INVALID_BASE64', 'RESPONSE_BYTES_MISMATCH', 'INVALID_MENU',
  'INVALID_RESPONSE', 'CONFIRMATION_REQUIRED', 'INVALID_PARTIAL_CANCEL',
  'INVALID_CONFIRMATION', 'INVALID_COLLECTION', 'INVALID_LENGTH',
  'INVALID_FORMAT', 'INVALID_CHOICE', 'INVALID_MENU_SELECTION',
  'TRANSACTION_DECISION_REQUIRED', 'TRANSACTION_POLICY_FAILED',
  'CLI_UNSUPPORTED_COMMAND', 'CLI_NATIVE_DECODING_FAILED',
  'CLI_AMBIGUOUS_CHOICES', 'CLI_PINPAD_BUSY', 'CLI_QR_RENDERER_REQUIRED'
]);
function ownValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}
/** Small, log-safe envelope. Does not inspect getters, messages, causes or buffers. */
export function sanitizeInteractionFailure(value: unknown): Readonly<InteractionFailure> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  try {
    const stage = ownValue(value, 'stage');
    if (!INTERACTION_FAILURE_STAGES.includes(stage as InteractionFailureStage)) return undefined;
    const code = ownValue(value, 'reasonCode');
    const result: { stage: InteractionFailureStage; command?: number; fieldType?: number; reasonCode: string } = {
      stage: stage as InteractionFailureStage,
      reasonCode: typeof code === 'string' && INTERACTION_REASON_CODES.has(code)
        ? code : 'UNCLASSIFIED_INTERACTION_ERROR'
    };
    for (const key of ['command', 'fieldType'] as const) {
      const number = ownValue(value, key);
      if (typeof number === 'number' && Number.isInteger(number) &&
          number >= -2147483648 && number <= 2147483647) result[key] = number;
    }
    return Object.freeze(result);
  } catch {
    return undefined;
  }
}

export class SitefError extends Error {
  readonly code: string;
  readonly nativeStatus?: number;
  readonly uncertain: boolean;
  /** Initialization failed and releasing its resources also failed. */
  readonly cleanupFailed?: boolean;
  readonly interactionFailure?: Readonly<InteractionFailure>;
  constructor(code: string, message: string, options: {nativeStatus?: number; uncertain?: boolean; cleanupFailed?: boolean; cause?: unknown; interactionFailure?: InteractionFailure} = {}) {
    super(message, {cause: options.cause});
    this.name = 'SitefError';
    this.code = code;
    this.nativeStatus = options.nativeStatus;
    this.uncertain = options.uncertain ?? false;
    this.cleanupFailed = options.cleanupFailed;
    this.interactionFailure = sanitizeInteractionFailure(options.interactionFailure);
  }
}
