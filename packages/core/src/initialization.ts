import { SitefError } from './errors.js';

/** Keep the primary native failure; never expose arbitrary cleanup payloads. */
export function initializationCleanupFailure(error: unknown): SitefError {
  return new SitefError(
    error instanceof SitefError ? error.code : 'INITIALIZATION_FAILED',
    'Initialization failed and resource cleanup also failed. Verify the connection before reconnecting.',
    {
      nativeStatus: error instanceof SitefError ? error.nativeStatus : undefined,
      uncertain: true,
      cleanupFailed: true,
      cause: error
    }
  );
}
