export class SitefError extends Error {
  readonly code: string;
  readonly nativeStatus?: number;
  readonly uncertain: boolean;
  constructor(code: string, message: string, options: {nativeStatus?: number; uncertain?: boolean; cause?: unknown} = {}) {
    super(message, {cause: options.cause});
    this.name = 'SitefError';
    this.code = code;
    this.nativeStatus = options.nativeStatus;
    this.uncertain = options.uncertain ?? false;
  }
}
