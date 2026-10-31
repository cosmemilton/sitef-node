// Owned TypeScript catalog -> deterministic, language-neutral data snapshot.
// Node >=22.18 strips the erasable TypeScript in the source module directly.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as catalog from '../packages/core/src/catalog.ts';

const source = new URL('../packages/core/src/catalog.ts', import.meta.url);
const output = new URL('../protocol/catalog.json', import.meta.url);
const snapshot = {
  schemaVersion: 1,
  source: {
    package: '@cosmemilton/sitef',
    file: 'packages/core/src/catalog.ts',
    sha256: createHash('sha256').update((await readFile(source, 'utf8')).replace(/\r\n/g, '\n')).digest('hex'),
  },
  metadata: catalog.PROTOCOL_REFERENCE,
  configurationReturns: catalog.CONFIGURATION_RETURNS,
  transactionReturns: catalog.TRANSACTION_RETURNS,
  secureReadReturns: catalog.SECURE_READ_RETURNS,
  continuation: catalog.CONTINUATION,
  commands: catalog.COMMANDS,
  fieldIds: catalog.FIELD_IDS,
  fieldRanges: catalog.FIELD_RANGES,
  events: catalog.EVENTS,
  functionIds: catalog.FUNCTION_CODES,
  documentedAdditionalParameters: catalog.DOCUMENTED_ADDITIONAL_PARAMETERS,
  documentedIniKeys: catalog.DOCUMENTED_INI_KEYS,
  coverage: {
    fieldIdsAreAliasesOnly: true,
    completeFieldSemantics: false,
    completePerFunctionWorkflows: false,
    completeVendorParameterCatalog: false,
    financialTransactionsValidatedAgainstVendor: false,
    unknownNumericCodesMustBePreserved: true,
    note: 'Current aliases and ranges only. TODO: complete the field-by-field semantics identified by the VRS-258 audit (444 field entries), product workflows and vendor homologation. A listed ID is not proof of implementation or validation.',
  },
};
const serialized = JSON.stringify(snapshot, null, 2) + '\n';
if (process.argv.includes('--check')) {
  let current;
  try { current = await readFile(output, 'utf8'); } catch {}
  if (current !== serialized) {
    console.error('protocol/catalog.json differs from the owned TypeScript catalog; run node scripts/export-catalog.mjs');
    process.exitCode = 1;
  } else console.log('Shared catalog matches TypeScript source');
} else {
  await mkdir(new URL('../protocol/', import.meta.url), {recursive: true});
  await writeFile(output, serialized, 'utf8');
  console.log(JSON.stringify({fieldAliases: Object.keys(snapshot.fieldIds).length, functions: Object.keys(snapshot.functionIds).length, commands: Object.keys(snapshot.commands).length}));
}
