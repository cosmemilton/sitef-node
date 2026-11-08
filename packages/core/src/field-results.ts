import { inspect } from 'node:util';
import fieldDocument from './data/fields.json' with { type: 'json' };
import type { ExplicitFieldId, KnownFieldId } from './field-ids.generated.js';
import type { FieldDefinition } from './semantic-types.js';

export type { ExplicitFieldId, KnownFieldId } from './field-ids.generated.js';

export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

export type FieldCatalogDefinition<K extends number = number> =
  DeepReadonly<FieldDefinition & { code: K }>;

export interface FieldCatalogRange {
  readonly from: number;
  readonly to: number;
  readonly name: string;
  readonly description: string;
  readonly dataType: string;
  readonly contexts?: readonly string[];
  readonly [key: string]: unknown;
}

/** Individual definitions. Source revision is retained verbatim, not upgraded by inference. */
export const FIELD_CATALOG = deepFreeze(Object.fromEntries(
  Object.entries(fieldDocument.entries).map(([code, definition]) =>
    [code, { ...structuredClone(definition), code: Number(code) }])
)) as { readonly [K in ExplicitFieldId]: FieldCatalogDefinition<K> };

export const FIELD_CATALOG_RANGES = deepFreeze(structuredClone(fieldDocument.ranges)) as
  readonly FieldCatalogRange[];

/** Ranges are context-dependent; individual transaction definitions take precedence. */
export function lookupFieldCatalog<K extends KnownFieldId>(code: K, context?: string): FieldCatalogDefinition<K> | undefined;
export function lookupFieldCatalog(code: number, context?: string): FieldCatalogDefinition | undefined;
export function lookupFieldCatalog(code: number, context = 'transaction'): FieldCatalogDefinition | undefined {
  const entries = FIELD_CATALOG as Readonly<Partial<Record<number, FieldCatalogDefinition>>>;
  let definition = entries[code];
  const range = FIELD_CATALOG_RANGES.find((candidate) =>
    Number.isInteger(code) && code >= candidate.from && code <= candidate.to &&
    (!candidate.contexts || candidate.contexts.includes(context)));
  if (range && (!definition || context !== 'transaction')) {
    definition = deepFreeze({ ...range, code }) as FieldCatalogDefinition;
  }
  const contexts = definition?.contexts;
  if (contexts && !Array.isArray(contexts) && typeof contexts === 'object') {
    const specific = (contexts as Record<string, unknown>)[context];
    if (specific && typeof specific === 'object') {
      definition = deepFreeze({ ...definition, ...specific, code }) as FieldCatalogDefinition;
    }
  }
  return definition;
}

/** Raw text and original bytes are explicit-access data, not a logging payload. */
export interface FieldOccurrence<K extends number = number> {
  readonly sequence: number;
  readonly fieldType: K;
  readonly command: number;
  readonly direction: 'output' | 'input';
  readonly raw: string;
  readonly bufferBase64?: string;
  readonly decodingError?: boolean;
  readonly sensitive: boolean | 'unknown';
  readonly submission?: 'not-submitted' | 'attempted' | 'returned';
  readonly validation?: 'accepted' | 'rejected';
  readonly continueFlag?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
}

export interface CatalogFieldOccurrence<K extends number = number> extends FieldOccurrence<K> {
  readonly known: boolean;
  readonly definition?: FieldCatalogDefinition<K>;
  readonly context?: string;
}

/** Immutable ordered snapshot. Catalog recognition never filters the supplied data. */
export class TransactionFields {
  readonly #occurrences: readonly CatalogFieldOccurrence[];

  constructor(occurrences: readonly FieldOccurrence[], context?: string) {
    this.#occurrences = Object.freeze(occurrences.map((entry) => {
      const definition = lookupFieldCatalog(entry.fieldType, context);
      // Copy only the public primitive fields; no caller-owned object is retained.
      return Object.freeze({
        sequence: entry.sequence,
        fieldType: entry.fieldType,
        command: entry.command,
        direction: entry.direction,
        raw: entry.raw,
        sensitive: entry.sensitive,
        ...(entry.bufferBase64 === undefined ? {} : { bufferBase64: entry.bufferBase64 }),
        ...(entry.decodingError === undefined ? {} : { decodingError: entry.decodingError }),
        ...(entry.submission === undefined ? {} : { submission: entry.submission }),
        ...(entry.validation === undefined ? {} : { validation: entry.validation }),
        ...(entry.continueFlag === undefined ? {} : { continueFlag: entry.continueFlag }),
        ...(entry.minLength === undefined ? {} : { minLength: entry.minLength }),
        ...(entry.maxLength === undefined ? {} : { maxLength: entry.maxLength }),
        known: definition !== undefined,
        ...(definition === undefined ? {} : { definition }),
        ...(context === undefined ? {} : { context }),
      });
    }));
    Object.freeze(this);
  }

  get occurrences(): readonly CatalogFieldOccurrence[] { return this.#occurrences; }

  getAll<K extends KnownFieldId>(code: K): readonly CatalogFieldOccurrence<K>[];
  getAll(code: number): readonly CatalogFieldOccurrence[];
  getAll(code: number): readonly CatalogFieldOccurrence[] {
    return Object.freeze(this.#occurrences.filter((entry) => entry.fieldType === code));
  }

  getLast<K extends KnownFieldId>(code: K): CatalogFieldOccurrence<K> | undefined;
  getLast(code: number): CatalogFieldOccurrence | undefined;
  getLast(code: number): CatalogFieldOccurrence | undefined {
    for (let index = this.#occurrences.length - 1; index >= 0; index--) {
      if (this.#occurrences[index].fieldType === code) return this.#occurrences[index];
    }
    return undefined;
  }

  toJSON(): { type: 'TransactionFields'; count: number } {
    return { type: 'TransactionFields', count: this.#occurrences.length };
  }

  [inspect.custom](): { type: 'TransactionFields'; count: number } { return this.toJSON(); }
}
