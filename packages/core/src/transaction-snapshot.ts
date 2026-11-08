import type { SessionState } from './types.js';
import { TransactionFields } from './field-results.js';

/** Explicit in-memory access after rejection. Never attached as an Error property. */
export interface PartialTransaction {
  readonly transactionId: string;
  readonly groupId?: string;
  readonly started: boolean;
  /** Terminal native status only. Undefined when the native outcome is unknown. */
  readonly status?: number;
  readonly lastNativeStatus?: number;
  readonly terminalKnown: boolean;
  readonly state: SessionState;
  readonly requiresFinalization: boolean;
  readonly requiresRecovery: boolean;
  readonly data: TransactionFields;
}

const snapshots = new WeakMap<object, PartialTransaction>();

/** Returns data received/collected before this error, without serializing it in logs. */
export function getPartialTransaction(error: unknown): PartialTransaction | undefined {
  if ((typeof error !== 'object' || error === null) && typeof error !== 'function') return undefined;
  return snapshots.get(error as object);
}

/** Internal lifecycle hook; public consumers use getPartialTransaction. */
export function retainPartialTransaction(error: unknown, snapshot: PartialTransaction): void {
  if ((typeof error === 'object' && error !== null) || typeof error === 'function')
    snapshots.set(error as object, Object.freeze(snapshot));
}