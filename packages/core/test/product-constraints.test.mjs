import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FieldProcessor,
  buildNfpag,
  functionDefinition,
  validateFieldResponse
} from '../dist/fields.js';

const input = {
  functionId: 0,
  amount: '10,00',
  fiscalDocument: '123',
  fiscalDate: '20261030',
  fiscalTime: '120000',
  operator: 'test'
};
const context = (patch = {}) => ({
  functionId: 0,
  paymentId: 'payment',
  groupId: 'group',
  input,
  signal: new AbortController().signal,
  definition: functionDefinition(0),
  ...patch
});
const exchange = (id, buffer, command = 0, semantic) => ({
  status: 10000,
  command,
  fieldType: id,
  minLength: 1,
  maxLength: 80,
  buffer,
  kind: 'field',
  semantic
});
const add = async (processor, rows) => {
  for (const [id, value] of rows) await processor.process(exchange(id, value));
};
const prices = {
  1043: 'decimal-comma',
  1044: 'decimal-comma',
  1014: 'decimal-comma',
  1016: 'decimal-comma'
};

test('PBM fixed-price rule is grouped by medicine and an attestation cannot override a known violation', async () => {
  let reviewed;
  const processor = new FieldProcessor(
    {
      monetaryFormats: prices,
      hooks: {
        validateTransaction: (assessment) => {
          reviewed = assessment;
          return true;
        }
      }
    },
    context()
  );
  await add(processor, [
    [1011, '1'],
    [1042, '0'],
    [1043, '10,00'],
    [1044, '10,00'],
    [1011, '2'],
    [1042, '0'],
    [1043, '20,00'],
    [1044, '19,00']
  ]);
  const snapshot = await processor.finish(0);
  assert.equal(snapshot.assessment.accepted, false);
  assert.deepEqual(
    snapshot.assessment.productConstraints.map((item) => [
      item.scope.medicineIndex,
      item.state
    ]),
    [
      ['1', 'satisfied'],
      ['2', 'violated']
    ]
  );
  assert.equal(
    reviewed.fields.filter((field) => field.fieldType === 1044).length,
    2
  );
});

test('PBM ambiguous scale or missing medicine context requires an explicit application review', async () => {
  const absent = new FieldProcessor({}, context());
  await add(absent, [
    [1011, '1'],
    [1042, '0'],
    [1043, '1000'],
    [1044, '1000']
  ]);
  assert.equal((await absent.finish(0)).assessment.accepted, false);
  const reviewed = new FieldProcessor(
    {
      hooks: {
        validateTransaction: (assessment) => {
          assert.equal(assessment.productConstraints[0].state, 'unresolved');
          assert.equal(
            assessment.fields.find((field) => field.fieldType === 1043).raw,
            '1000'
          );
          return true;
        }
      }
    },
    context()
  );
  await add(reviewed, [
    [1042, '0'],
    [1043, '1000'],
    [1044, '1000']
  ]);
  assert.equal((await reviewed.finish(0)).assessment.accepted, true);
});

test('PBM lower-price permission and consumer ceiling use exact resolved values', async () => {
  const processor = new FieldProcessor({ monetaryFormats: prices }, context());
  await add(processor, [
    [1011, '1'],
    [1042, '1'],
    [1043, '10,00'],
    [1044, '9,50'],
    [1014, '12,00'],
    [1016, '9,50']
  ]);
  const assessment = (await processor.finish(0)).assessment;
  assert.equal(assessment.accepted, true);
  assert.equal(
    assessment.productConstraints.every((item) => item.state === 'satisfied'),
    true
  );
});

test('fuel product counts and code lengths enforce only documented, unambiguous comparisons', async () => {
  const valid = new FieldProcessor({}, context());
  await add(valid, [
    [1122, '2'],
    [1123, '3'],
    [1115, '123,A,1,10;456,B,1,20;']
  ]);
  assert.equal((await valid.finish(0)).assessment.accepted, true);
  const excess = new FieldProcessor(
    { hooks: { validateTransaction: () => true } },
    context()
  );
  await add(excess, [
    [1122, '1'],
    [1123, '3'],
    [1115, '123,A,1,10;4567,B,1,20;']
  ]);
  const assessment = (await excess.finish(0)).assessment;
  assert.equal(assessment.accepted, false);
  assert.equal(
    assessment.productConstraints.filter((item) => item.state === 'violated')
      .length,
    2
  );
  const ambiguous = new FieldProcessor({}, context());
  await add(ambiguous, [
    [1123, '3'],
    [1115, '12,A,1,10;']
  ]);
  assert.equal((await ambiguous.finish(0)).assessment.accepted, false);
});

test('all declared beforeFinalize product-review obligations reach the callback with typed observations', async () => {
  const processor = new FieldProcessor(
    {
      hooks: {
        validateTransaction: (assessment) => {
          assert.equal(
            assessment.productConstraints.at(-1).kind,
            'documented-product-review'
          );
          assert.equal(
            assessment.fields.find((field) => field.fieldType === 171).raw,
            '2'
          );
          return true;
        }
      }
    },
    context()
  );
  await add(processor, [
    [171, '2'],
    [172, '6']
  ]);
  assert.equal((await processor.finish(0)).assessment.accepted, true);
  const missing = new FieldProcessor({}, context());
  await add(missing, [[175, '2']]);
  assert.equal((await missing.finish(0)).assessment.accepted, false);
});

test('response Base64 cannot replace the validated value, encoded length, enum or NUL checks', () => {
  const request = exchange(500, 'Digits', 30, {
    known: true,
    format: 'N',
    decimalPlaces: 2,
    menuConfirmation: false,
    canCancelBill: false,
    sensitive: false,
    functionId: 0,
    domain: 'payment'
  });
  assert.throws(
    () =>
      validateFieldResponse(request, {
        buffer: '123',
        bufferBase64: btoa('ABC')
      }),
    { code: 'RESPONSE_BYTES_MISMATCH' }
  );
  assert.throws(
    () =>
      validateFieldResponse(request, {
        buffer: '123',
        bufferBase64: btoa('123\0')
      }),
    { code: 'RESPONSE_BYTES_MISMATCH' }
  );
  assert.throws(
    () =>
      validateFieldResponse(request, { buffer: '123', bufferBase64: '%%%' }),
    { code: 'INVALID_BASE64' }
  );
  assert.throws(
    () => validateFieldResponse(request, { buffer: 'a', bufferBase64: 'YR==' }),
    { code: 'INVALID_BASE64' }
  );
  validateFieldResponse(exchange(500, 'Text', 30), {
    buffer: 'Ação €',
    bufferBase64: Buffer.from([65, 231, 227, 111, 32, 128]).toString('base64')
  });
  validateFieldResponse(
    exchange(500, 'Text', 30),
    { buffer: '🔒', bufferBase64: Buffer.from('🔒').toString('base64') },
    { nativeEncoding: 'utf-8' }
  );
});

test('unknown2355 format needs a real mapping and a supplied hook cannot bypass missing product precision', async () => {
  const missing = new FieldProcessor(
    { hooks: { resolveField: () => undefined } },
    context()
  );
  await assert.rejects(missing.process(exchange(2355, 'FUTURE')), {
    code: 'UNKNOWN_FORMAT'
  });
  const mapped = new FieldProcessor(
    {
      hooks: {
        resolveField: (request) =>
          request.fieldType === 2355 ? { format: 'N' } : undefined
      }
    },
    context()
  );
  await mapped.process(exchange(2355, 'FUTURE'));
  const typed = await mapped.process(exchange(500, 'Número', 30));
  assert.equal(typed.semantic.format, 'N');
  assert.throws(() => validateFieldResponse(typed, { buffer: 'abc' }), {
    code: 'INVALID_FORMAT'
  });
  const precision = new FieldProcessor(
    { hooks: { resolveField: () => undefined } },
    context()
  );
  await assert.rejects(precision.process(exchange(1027, 'Quantidade', 30)), {
    code: 'PRECISION_REQUIRED'
  });
  const resolved = new FieldProcessor(
    { hooks: { resolveField: () => ({ decimalPlaces: 3 }) } },
    context()
  );
  const quantity = await resolved.process(exchange(1027, 'Quantidade', 30));
  assert.throws(() => validateFieldResponse(quantity, { buffer: '1,2345' }));
  validateFieldResponse(quantity, { buffer: '1,234' });
});

test('S mapping and native menu indices cannot be bypassed by unrelated enum choices or identical codes', async () => {
  const missing = new FieldProcessor({}, context());
  await missing.process(exchange(2355, 'S'));
  await assert.rejects(missing.process(exchange(501, 'Confirma?', 30)), {
    code: 'AMBIGUOUS_FORMAT'
  });
  const duplicate = new FieldProcessor(
    { yesNoValues: { yes: 'X', no: 'X' } },
    context()
  );
  await duplicate.process(exchange(2355, 'S'));
  await assert.rejects(duplicate.process(exchange(500, 'Confirma?', 30)), {
    code: 'INVALID_YESNO_VALUES'
  });
  const menu = new FieldProcessor({}, context());
  await menu.process(exchange(2355, 'M'));
  const request = await menu.process(exchange(501, '8:CPF;2:CNPJ;', 30));
  validateFieldResponse(request, { buffer: '8' });
  assert.throws(() => validateFieldResponse(request, { buffer: '0' }), {
    code: 'INVALID_MENU_SELECTION'
  });
});

test('NFPAG needs730, strips server suffix only from serviceZ and preserves exact totals', () => {
  assert.throws(
    () =>
      buildNfpag(
        { maximum: undefined, types: { '02': { fields: [] } } },
        [{ type: '02', amount: '10,00' }],
        '10,00'
      ),
    { code: 'NFPAG_METADATA' }
  );
  const result = buildNfpag(
    { maximum: 0, types: { '02': { fields: ['10'] } } },
    [{ type: '02', amount: '10,00', data: { 10: 'SERVICEZ;1;127.0.0.1' } }],
    '10,00'
  );
  assert.equal(result, '02:1000:10:SERVICEZ;');
  assert.equal(
    buildNfpag(
      {
        maximum: 0,
        types: { '02': { fields: ['03'], allowedNetworks: ['5'] } }
      },
      [{ type: '02', amount: '10,00', data: { '03': '005' } }],
      '10,00'
    ),
    '02:1000:03:005;'
  );
});

test('precollected values require operator confirmation even on an unknown command', () => {
  const request = exchange(99999, 'Future', 999);
  assert.throws(
    () =>
      validateFieldResponse(request, {
        buffer: 'precollected',
        continueFlag: 10000
      }),
    { code: 'CONFIRMATION_REQUIRED' }
  );
  validateFieldResponse(request, {
    buffer: 'precollected',
    continueFlag: 10000,
    confirmed: true
  });
});

test('a native secure reader using fiscal function16 does not inherit the carnet product obligation', async () => {
  const processor = new FieldProcessor(
    {},
    context({
      functionId: 16,
      definition: {
        domain: 'secure-card-read',
        finalizationPolicy: 'nonfinancial',
        receiptPolicy: 'immediate'
      }
    })
  );
  assert.equal(
    (await processor.finish(0)).assessment.installmentFallback,
    false
  );
});

test('ambiguous fuel comma grammar remains available to the application resolver', async () => {
  const raw = '123,A,1,5,10,00;';
  const processor = new FieldProcessor({}, context());
  await add(processor, [
    [1122, '1'],
    [1123, '3'],
    [1115, raw]
  ]);
  assert.equal(processor.snapshot.fields.at(-1).value.unresolved, true);
  assert.equal(processor.snapshot.fields.at(-1).raw, raw);
  assert.equal((await processor.finish(0)).assessment.accepted, false);
  const resolved = new FieldProcessor(
    {
      hooks: {
        resolveField: (request) =>
          request.fieldType === 1115
            ? [
                {
                  code: '123',
                  description: 'A',
                  quantity: '1,5',
                  total: '10,00'
                }
              ]
            : undefined
      }
    },
    context()
  );
  await add(resolved, [
    [1122, '1'],
    [1123, '3'],
    [1115, raw]
  ]);
  assert.equal((await resolved.finish(0)).assessment.accepted, true);
});

test('2470 precision applies once to the next30/34 collection and messages do not consume it', async () => {
  const processor = new FieldProcessor({}, context());
  await processor.process(exchange(2470, '3'));
  await processor.process(exchange(500, 'Aguarde', 1));
  const first = await processor.process(exchange(500, 'Valor', 34));
  assert.equal(first.semantic.decimalPlaces, 3);
  validateFieldResponse(first, { buffer: '1,234' });
  const next = await processor.process(exchange(500, 'Outro valor', 34));
  assert.equal(next.semantic.decimalPlaces, 2);
  assert.throws(() => validateFieldResponse(next, { buffer: '1,234' }));
});
