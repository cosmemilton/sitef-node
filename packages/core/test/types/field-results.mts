import { FIELD_CATALOG, TransactionFields, lookupFieldCatalog } from '../../dist/index.js';
import type { KnownFieldId, CatalogFieldOccurrence, FieldOccurrence } from '../../dist/index.js';

const rangeIds: KnownFieldId[] = [10, 99, 800, 849, 3000, 3999];
const event: KnownFieldId = 5000;
// @ts-expect-error unknown codes are not known IDs (but remain accepted by collection).
const future: KnownFieldId = 999999;
const fields = new TransactionFields([]);
const rows: readonly CatalogFieldOccurrence<134>[] = fields.getAll(134);
const last: CatalogFieldOccurrence<134> | undefined = fields.getLast(134);
const code: 134 | undefined = last?.fieldType;
const raw: string | undefined = last?.raw;
const declaredCode: 134 = FIELD_CATALOG[134].code;
const contextualCode: 849 | undefined = lookupFieldCatalog(849, 'gerpdv')?.code;
// @ts-expect-error an ID in a documented range is not necessarily an individual catalog entry.
FIELD_CATALOG[849];
// @ts-expect-error no promise that textual NSU is a number.
const numericNsu: number | undefined = last?.raw;
// @ts-expect-error semantic metadata is not a validated/decoded enum.
const flag: '0' | '1' | undefined = fields.getLast(170)?.raw;
// @ts-expect-error raw results do not claim a decoded value.
fields.getLast(170)?.value;
// @ts-expect-error readonly occurrences.
fields.occurrences.push({});
// @ts-expect-error readonly individual occurrence.
if (last) last.raw = 'changed';
// @ts-expect-error nested definition is readonly too.
if (last?.definition?.origin) last.definition.origin.page = 100;
// @ts-expect-error read-only returned list.
rows.pop();
const unknownCode: number = 999999;
const unknownRows: readonly FieldOccurrence<number>[] = fields.getAll(unknownCode);
// @ts-expect-error unknown overload cannot pretend to return an unrelated known ID.
const misleadingRows: readonly FieldOccurrence<134>[] = fields.getAll(unknownCode);
const selected: 134 | 135 = Math.random() ? 134 : 135;
const selectedRows = fields.getAll(selected);
for (const row of selectedRows) {
  if (row.fieldType === 134) {
    const narrowed: 134 = row.fieldType;
    const stillText: string = row.raw;
  }
}
void [rangeIds, event, future, rows, code, raw, declaredCode, contextualCode, unknownRows];
