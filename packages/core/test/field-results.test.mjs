import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { FIELD_CATALOG, FIELD_CATALOG_RANGES, lookupFieldCatalog, TransactionFields, fieldDefinition } from '../dist/index.js';

const canonical = JSON.parse(readFileSync(new URL('../../../protocol/fields.json', import.meta.url), 'utf8'));
const occurrence = (fieldType, raw, sequence, extra = {}) => ({ sequence, fieldType, command: 0, direction: 'output', raw, sensitive: 'unknown', ...extra });

test('catalog exposes every canonical entry and all 444 section 5.3.2 IDs', () => {
  assert.equal(Object.keys(canonical.entries).length, 536);
  assert.equal(Object.keys(FIELD_CATALOG).length, 536);
  assert.equal(canonical.coverage.baseFieldIds.length, 444);
  for (const code of canonical.coverage.baseFieldIds) {
    assert.ok(FIELD_CATALOG[code]);
    assert.equal(FIELD_CATALOG[code].origin.section, '5.3.2');
  }
  for (const [key, definition] of Object.entries(canonical.entries)) {
    const code = Number(key);
    assert.deepEqual(FIELD_CATALOG[code], { ...definition, code });
    assert.deepEqual(lookupFieldCatalog(code), { ...fieldDefinition(code), code });
    assert.equal(FIELD_CATALOG[code].origin.document, definition.origin.document);
  }
});

test('every documented range and contextual override is accessible without inventing a value type', () => {
  assert.deepEqual(FIELD_CATALOG_RANGES, canonical.ranges);
  for (const range of canonical.ranges) {
    for (const context of range.contexts ?? ['transaction']) {
      for (let code = range.from; code <= range.to; code++) {
        assert.deepEqual(lookupFieldCatalog(code, context), { ...fieldDefinition(code, context), code });
      }
    }
  }
  assert.equal(lookupFieldCatalog(10, 'gerpdv'), undefined);
  assert.equal(lookupFieldCatalog(849), undefined);
  assert.equal(lookupFieldCatalog(849, 'gerpdv').name, 'retorno_gerpdv');
  assert.equal(lookupFieldCatalog(999999), undefined);
  assert.equal(lookupFieldCatalog(10.5), undefined);
  assert.equal(lookupFieldCatalog(NaN), undefined);
  assert.equal(lookupFieldCatalog(170).choices, undefined);
});

test('all canonical fields and all base ranges reach the caller without a whitelist', () => {
  const codes = Object.keys(canonical.entries).map(Number);
  for (const [from, to] of [[10, 99], [3000, 3999], [800, 849]]) {
    for (let code = from; code <= to; code++) codes.push(code);
  }
  codes.push(999999, -999999);
  const entries = codes.map((code, index) => occurrence(code, `synthetic-${index}`, index));
  const fields = new TransactionFields(entries);
  assert.equal(fields.occurrences.length, entries.length);
  entries.forEach((entry, index) => {
    assert.equal(fields.occurrences[index].fieldType, entry.fieldType);
    assert.equal(fields.occurrences[index].raw, entry.raw);
    assert.ok(fields.getAll(entry.fieldType).some((found) => found.sequence === entry.sequence));
  });
});

test('order, repetitions, empty strings, string identifiers and exact bytes survive snapshots', () => {
  const bytes = Buffer.from([0, 0xff, 0xc3, 0x28, 10, 0]);
  const input = [
    occurrence(134, '000001234567890123456789', 8),
    occurrence(999999, '\ufffd(\n', 9, { bufferBase64: bytes.toString('base64'), decodingError: true }),
    occurrence(134, '', 10),
    occurrence(170, 'opaque-non-enum', 11),
    occurrence(10, '1', 12, { command: 21, direction: 'input', submission: 'attempted', continueFlag: 10000, minLength: 1, maxLength: 5 }),
  ];
  const fields = new TransactionFields(input);
  assert.deepEqual(fields.occurrences.map((entry) => entry.sequence), [8, 9, 10, 11, 12]);
  assert.deepEqual(fields.getAll(134).map((entry) => entry.raw), [input[0].raw, '']);
  assert.equal(fields.getLast(134).raw, '');
  assert.equal(fields.getLast(999998), undefined);
  assert.deepEqual(fields.getAll(999998), []);
  assert.equal(fields.getLast(999999).known, false);
  assert.equal(fields.getLast(999999).definition, undefined);
  assert.deepEqual(Buffer.from(fields.getLast(999999).bufferBase64, 'base64'), bytes);
  assert.equal(fields.getLast(999999).decodingError, true);
  assert.equal(fields.getLast(170).raw, 'opaque-non-enum');
  assert.equal('value' in fields.getLast(170), false);
  const entered = fields.getLast(10);
  for (const key of ['submission', 'continueFlag', 'minLength', 'maxLength', 'direction', 'command'])
    assert.equal(entered[key], input[4][key]);
  input[0].raw = 'changed';
  input.push(occurrence(134, 'later', 13));
  assert.equal(fields.occurrences.length, 5);
  assert.equal(fields.occurrences[0].raw, '000001234567890123456789');
});

test('catalog and snapshots are deeply immutable including contextual metadata', () => {
  const fields = new TransactionFields([occurrence(2021, 'synthetic', 0)], 'secure-card-read');
  assert.equal(fields.getLast(2021).definition.name, 'masked_card_data');
  assert.equal(fields.getLast(2021).context, 'secure-card-read');
  for (const mutate of [
    () => { fields.occurrences.push(occurrence(1, 'no', 1)); },
    () => { fields.occurrences[0].raw = 'no'; },
    () => { fields.getAll(2021).pop(); },
    () => { fields.getLast(2021).definition.origin.page = 999; },
    () => { fields.getLast(2021).definition.suffixMeaning['1'] = 'no'; },
    () => { FIELD_CATALOG[1].format.parts.push('no'); },
    () => { FIELD_CATALOG_RANGES[0].contexts.push('no'); },
    () => { fields.toJSON = () => 'no'; },
  ]) assert.throws(mutate, TypeError);
});

test('JSON and inspect reveal only counts, even with hidden properties or nested error attachment', () => {
  const marker = 'SYNTHETIC_SECRET_DO_NOT_LOG';
  const fields = new TransactionFields([occurrence(999999, marker, 0, { bufferBase64: Buffer.from(marker).toString('base64') })], marker);
  const safe = { type: 'TransactionFields', count: 1 };
  assert.deepEqual(fields.toJSON(), safe);
  assert.equal(JSON.stringify(fields), JSON.stringify(safe));
  assert.deepEqual(Object.keys(fields), []);
  const error = new Error('Synthetic failure');
  error.data = fields;
  for (const output of [
    inspect(fields), inspect(fields, { showHidden: true, depth: null }),
    inspect(fields, { showHidden: true, customInspect: false, depth: null }),
    JSON.stringify({ data: fields }), inspect(error, { depth: null }),
  ]) {
    assert.equal(output.includes(marker), false);
    assert.equal(output.includes(Buffer.from(marker).toString('base64')), false);
  }
  assert.equal(fields.occurrences[0].raw, marker);
  assert.equal(fields.getAll(999999)[0].raw, marker);
});

test('public TypeScript declarations preserve literal IDs and reject unsafe writes/value promises', () => {
  const fixture = fileURLToPath(new URL('./types/field-results.mts', import.meta.url));
  const applicationFixture = fileURLToPath(new URL('./types/application-state.mts', import.meta.url));
  const program = ts.createProgram([fixture, applicationFixture], {
    strict: true, noEmit: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (name) => name, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n',
  }));
});

test('generated literal unions match every canonical individual and range ID', () => {
  const source = readFileSync(new URL('../src/field-ids.generated.ts', import.meta.url), 'utf8');
  const readUnion = (name) => new Set(source.match(new RegExp(`export type ${name} = ([^;]+);`))[1].split('|').map((code) => Number(code.trim())));
  const explicit = new Set(Object.keys(canonical.entries).map(Number));
  const known = new Set(explicit);
  for (const range of canonical.ranges) for (let code = range.from; code <= range.to; code++) known.add(code);
  assert.deepEqual(readUnion('ExplicitFieldId'), explicit);
  assert.deepEqual(readUnion('KnownFieldId'), known);
});
