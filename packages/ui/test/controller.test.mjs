import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSitefModal,
  parseMenu,
  windows1252ByteLength
} from '../dist/controller.js';

const request = (command, buffer = '', extra = {}) => ({
  status: 10000,
  command,
  buffer,
  fieldType: 500,
  minLength: 1,
  maxLength: 40,
  kind: 'interaction',
  ...extra
});
const context = () => ({ signal: new AbortController().signal });

test('preserves operator/client/header separately and clears exactly the requested target', async () => {
  const ui = createSitefModal({ onCancel() {} });
  await ui.handler(request(1, 'Operador'), context());
  await ui.handler(request(2, 'Cliente'), context());
  await ui.handler(request(4, 'Menu'), context());
  await ui.handler(request(15, 'Cabeçalho'), context());
  await ui.handler(request(11), context());
  assert.equal(ui.getSnapshot().operatorMessage, '');
  assert.equal(ui.getSnapshot().customerMessage, 'Cliente');
  assert.equal(ui.getSnapshot().title, 'Menu');
  assert.equal(ui.getSnapshot().header, 'Cabeçalho');
  await ui.handler(request(14), context());
  await ui.handler(request(16), context());
  assert.equal(ui.getSnapshot().title, '');
  assert.equal(ui.getSnapshot().header, '');
});

test('does not choose or acknowledge prompts without operator action', async () => {
  const ui = createSitefModal({ onCancel() {} });
  let settled = false;
  const waiting = ui
    .handler(request(20, 'Confirma?'), context())
    .then((response) => {
      settled = true;
      return response;
    });
  await Promise.resolve();
  assert.equal(settled, false);
  const id = ui.getSnapshot().pending.id;
  assert.throws(() => ui.respond({ buffer: '' }, id), {
    code: 'INVALID_CONFIRMATION'
  });
  assert.equal(settled, false);
  ui.respond({ buffer: '1' }, id);
  assert.deepEqual(await waiting, { buffer: '1', continueFlag: 0 });
  assert.throws(() => ui.respond({ buffer: '0' }, id), {
    code: 'STALE_RESPONSE'
  });
});

test('identified menus preserve IDs and metadata, including colon inside label', async () => {
  const menu = parseMenu(
    request(42, '1|8:Crédito: loja:123:4;2:Débito:456:3;')
  );
  assert.deepEqual(menu[0], {
    id: '8',
    label: 'Crédito: loja',
    code: '123',
    type: '4',
    menuClass: '1'
  });
  const ui = createSitefModal({ onCancel() {} });
  const waiting = ui.handler(
    request(42, '1|8:Crédito:123:4;2:Débito:456:3;'),
    context()
  );
  const id = ui.getSnapshot().pending.id;
  assert.throws(() => ui.respond({ buffer: '1' }, id), {
    code: 'INVALID_MENU_SELECTION'
  });
  ui.respond({ buffer: '8' }, id);
  assert.equal((await waiting).buffer, '8');
  assert.throws(() => parseMenu(request(21, '1:A;1:B;')), {
    code: 'INVALID_MENU'
  });
});

test('QR commands immediately return while keeping QR in the same modal', async () => {
  const ui = createSitefModal({ onCancel() {} });
  assert.deepEqual(
    await ui.handler(request(50, '000201PAYLOAD'), context()),
    {}
  );
  await ui.handler(request(52, 'Aguardando'), context());
  assert.equal(ui.getSnapshot().qrCode, '000201PAYLOAD');
  assert.equal(ui.getSnapshot().qrFooter, 'Aguardando');
  assert.equal(ui.getSnapshot().pending, undefined);
  await ui.handler(request(51), context());
  assert.equal(ui.getSnapshot().qrCode, '');
});

test('cancel requests SDK abort, resolves collection -1, and keeps modal open until completion', async () => {
  const abort = new AbortController();
  let cancellations = 0;
  const ui = createSitefModal({
    onCancel() {
      cancellations++;
      abort.abort();
    }
  });
  const waiting = ui.handler(request(41, 'Dado protegido'), {
    signal: abort.signal
  });
  ui.cancel();
  ui.cancel();
  assert.deepEqual(await waiting, { continueFlag: -1 });
  assert.equal(cancellations, 1);
  assert.equal(ui.getSnapshot().open, true);
  assert.equal(ui.getSnapshot().cancelling, true);
  ui.complete();
  assert.equal(ui.getSnapshot().open, false);
});

test('system fields and unknown commands require explicit implementation', async () => {
  const ui = createSitefModal({ onCancel() {} });
  await assert.rejects(ui.handler(request(29), context()), {
    code: 'SYSTEM_DATA_REQUIRED'
  });
  await assert.rejects(ui.handler(request(9876), context()), {
    code: 'UNSUPPORTED_COMMAND'
  });
  const custom = createSitefModal({
    onCancel() {},
    systemData: async () => ({ buffer: 'SYSTEM' }),
    onUnsupported: async () => ({ continueFlag: -1 })
  });
  assert.equal((await custom.handler(request(29), context())).buffer, 'SYSTEM');
  assert.deepEqual(await custom.handler(request(9876), context()), {
    continueFlag: -1
  });
});

test('money remains decimal text; length and encoding are validated without truncation', async () => {
  const ui = createSitefModal({ onCancel() {} });
  const waiting = ui.handler(
    request(34, 'Valor', { minLength: 4, maxLength: 8 }),
    context()
  );
  const id = ui.getSnapshot().pending.id;
  assert.throws(() => ui.respond({ buffer: '1,234' }, id), {
    code: 'INVALID_AMOUNT'
  });
  assert.throws(() => ui.respond({ buffer: '1' }, id), {
    code: 'INVALID_LENGTH'
  });
  ui.respond({ buffer: '10,05' }, id);
  assert.equal((await waiting).buffer, '10,05');
  assert.equal(windows1252ByteLength('Ação €'), 6);
  assert.throws(() => windows1252ByteLength('🔒'), {
    code: 'UNENCODABLE_INPUT'
  });
  const utf8 = createSitefModal({
    onCancel() {},
    byteLength: (value) => new TextEncoder().encode(value).length
  });
  const utf8Wait = utf8.handler(
    request(30, '', { minLength: 1, maxLength: 3 }),
    context()
  );
  const utf8id = utf8.getSnapshot().pending.id;
  assert.throws(() => utf8.respond({ buffer: 'éé' }, utf8id), {
    code: 'INVALID_LENGTH'
  });
  utf8.respond({ buffer: 'é' }, utf8id);
  await utf8Wait;
});

test('cheque and barcode use protocol prefixes; barcode partial cancellation preserves prior documents', async () => {
  const ui = createSitefModal({ onCancel() {} });
  const cheque = ui.handler(
    request(31, 'Cheque', { minLength: 29, maxLength: 29 }),
    context()
  );
  const id = ui.getSnapshot().pending.id;
  assert.throws(() => ui.respond({ buffer: '0:123' }, id), {
    code: 'INVALID_CHEQUE'
  });
  ui.respond({ buffer: '0:' + '1'.repeat(29) }, id);
  assert.equal((await cheque).buffer, '0:' + '1'.repeat(29));
  const barcode = ui.handler(
    request(35, 'Código', { minLength: 44, maxLength: 48 }),
    context()
  );
  ui.respond({ buffer: '2:' }, ui.getSnapshot().pending.id);
  assert.deepEqual(await barcode, { buffer: '2:', continueFlag: 0 });
});

test('concurrent prompts and premature closure are rejected; listener unsubscribes', async () => {
  const ui = createSitefModal({ onCancel() {} });
  let updates = 0;
  const unsubscribe = ui.subscribe(() => updates++);
  const waiting = ui.handler(request(22, 'Aviso'), context());
  assert.throws(() => ui.complete(), { code: 'INTERACTION_PENDING' });
  await assert.rejects(ui.handler(request(30), context()), {
    code: 'CONCURRENT_INTERACTION'
  });
  const id = ui.getSnapshot().pending.id;
  ui.respond({ buffer: '' }, id);
  await waiting;
  unsubscribe();
  const previous = updates;
  ui.complete();
  assert.equal(updates, previous);
});

test('barcode vendor validation rejects every nonzero status and blocks duplicate submission', async () => {
  let finish;
  let calls = 0;
  const ui = createSitefModal({
    onCancel() {},
    validateBarcode: async (data) => {
      calls++;
      assert.equal(data, '1234');
      return new Promise((resolve) => {
        finish = resolve;
      });
    }
  });
  const waiting = ui.handler(request(35, 'Código'), context());
  const id = ui.getSnapshot().pending.id;
  const validation = ui.respond({ buffer: '0:1234' }, id);
  assert.equal(ui.getSnapshot().pending.validating, true);
  assert.throws(() => ui.respond({ buffer: '0:1234' }, id), {
    code: 'VALIDATION_PENDING'
  });
  await Promise.resolve();
  finish({ status: -3 });
  await assert.rejects(validation, { code: 'INVALID_BARCODE' });
  assert.equal(ui.getSnapshot().pending.validating, false);
  assert.equal(ui.getSnapshot().pending.id, id);
  const valid = ui.respond({ buffer: '0:1234' }, id);
  await Promise.resolve();
  finish({ status: 0, documentType: 2 });
  await valid;
  assert.equal((await waiting).buffer, '0:1234');
  assert.equal(calls, 2);
});

test('synchronous barcode validation failure unlocks the prompt; cancellation discards late results', async () => {
  const ui = createSitefModal({
    onCancel() {},
    validateBarcode() {
      throw new Error('private transport details');
    }
  });
  const waiting = ui.handler(request(35, 'Código'), context());
  const id = ui.getSnapshot().pending.id;
  await assert.rejects(ui.respond({ buffer: '0:1234' }, id), {
    code: 'BARCODE_VALIDATION_FAILED'
  });
  assert.equal(ui.getSnapshot().pending.validating, false);
  ui.cancel();
  await waiting;

  let finish;
  const late = createSitefModal({
    onCancel() {},
    validateBarcode: () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  });
  const pending = late.handler(request(35), context());
  const validation = late.respond(
    { buffer: '1:1234' },
    late.getSnapshot().pending.id
  );
  await Promise.resolve();
  late.cancel();
  finish({ status: -1 });
  await validation;
  assert.deepEqual(await pending, { continueFlag: -1 });
  assert.equal(late.getSnapshot().pending, undefined);
});

test('field2470 configures three/four decimal places without float conversion and completion resets precision', async () => {
  const ui = createSitefModal({ onCancel() {} });
  assert.equal(ui.getSnapshot().decimalPlaces, 2);
  ui.onExchange(request(0, '3', { fieldType: 2470 }));
  const three = ui.handler(request(34, 'Valor'), context());
  const threeId = ui.getSnapshot().pending.id;
  assert.throws(() => ui.respond({ buffer: '10,1234' }, threeId), {
    code: 'INVALID_AMOUNT'
  });
  ui.respond({ buffer: '10,123' }, threeId);
  assert.equal((await three).buffer, '10,123');
  ui.onExchange(request(0, '4', { fieldType: 2470 }));
  const four = ui.handler(request(34, 'Valor'), context());
  ui.respond({ buffer: '00010.1234' }, ui.getSnapshot().pending.id);
  assert.equal((await four).buffer, '00010.1234');
  ui.complete();
  assert.equal(ui.getSnapshot().decimalPlaces, 2);
  const reset = ui.handler(request(34, 'Valor'), context());
  const resetId = ui.getSnapshot().pending.id;
  assert.throws(() => ui.respond({ buffer: '10,123' }, resetId), {
    code: 'INVALID_AMOUNT'
  });
  ui.respond({ buffer: '10,12' }, resetId);
  await reset;
});

test('field2470 rejects malformed precision explicitly and accepts zero decimal places', async () => {
  const ui = createSitefModal({ onCancel() {} });
  for (const value of [
    '',
    '-1',
    '3.5',
    'abc',
    '3 ',
    '999999999999999999999999'
  ]) {
    assert.throws(() => ui.onExchange(request(0, value, { fieldType: 2470 })), {
      code: 'INVALID_DECIMAL_PLACES'
    });
  }
  assert.equal(ui.getSnapshot().decimalPlaces, 2);
  ui.onExchange(request(0, '0', { fieldType: 2470 }));
  const zero = ui.handler(request(34, 'Quantidade'), context());
  const id = ui.getSnapshot().pending.id;
  assert.throws(() => ui.respond({ buffer: '1,1' }, id), {
    code: 'INVALID_AMOUNT'
  });
  ui.respond({ buffer: '12' }, id);
  assert.equal((await zero).buffer, '12');
});

const semantic = (patch = {}) => ({
  known: true,
  decimalPlaces: 2,
  menuConfirmation: false,
  canCancelBill: false,
  sensitive: false,
  functionId: 0,
  domain: 'payment',
  ...patch
});

test('Mc on command30 requires a second confirmation and permits revising the selected option', async () => {
  const ui = createSitefModal({ onCancel() {} });
  let resolved = false;
  const waiting = ui
    .handler(
      request(30, '8:Crédito;2:Débito;', {
        semantic: semantic({ format: 'Mc', menuConfirmation: true })
      }),
      context()
    )
    .then((response) => {
      resolved = true;
      return response;
    });
  const id = ui.getSnapshot().pending.id;
  ui.respond({ buffer: '8' }, id);
  await Promise.resolve();
  assert.equal(resolved, false);
  assert.equal(ui.getSnapshot().pending.confirming, true);
  assert.equal(ui.getSnapshot().pending.selection.label, 'Crédito');
  assert.throws(() => ui.respond({ buffer: '8' }, id), {
    code: 'CONFIRMATION_REQUIRED'
  });
  ui.reviseSelection(id);
  assert.equal(ui.getSnapshot().pending.confirming, false);
  ui.respond({ buffer: '2' }, id);
  assert.throws(() => ui.respond({ buffer: '8', confirmed: true }, id), {
    code: 'CONFIRMATION_REQUIRED'
  });
  ui.respond({ buffer: '2', confirmed: true }, id);
  assert.deepEqual(await waiting, {
    buffer: '2',
    continueFlag: 0,
    confirmed: true
  });
});

test('formatS on command30 uses explicit encoding; M preserves menu indices', async () => {
  const ui = createSitefModal({ onCancel() {} });
  await assert.rejects(
    ui.handler(
      request(30, 'Aceita?', { semantic: semantic({ format: 'S' }) }),
      context()
    ),
    { code: 'AMBIGUOUS_FORMAT' }
  );
  const waiting = ui.handler(
    request(30, 'Aceita?', {
      semantic: semantic({ format: 'S', choices: { Y: 'Sim', N: 'Não' } })
    }),
    context()
  );
  const id = ui.getSnapshot().pending.id;
  assert.deepEqual(
    ui.getSnapshot().pending.options.map((option) => option.id),
    ['Y', 'N']
  );
  assert.throws(() => ui.respond({ buffer: '0' }, id), {
    code: 'INVALID_MENU_SELECTION'
  });
  ui.respond({ buffer: 'Y' }, id);
  assert.equal((await waiting).buffer, 'Y');
  const menu = ui.handler(
    request(30, '10:Primeira;20:Segunda;', {
      semantic: semantic({ format: 'M' })
    }),
    context()
  );
  ui.respond({ buffer: '20' }, ui.getSnapshot().pending.id);
  assert.equal((await menu).buffer, '20');
});

test('Corban current-bill cancellation is scoped and distinct from barcode2:', async () => {
  const ui = createSitefModal({ onCancel() {} });
  const bill = ui.handler(
    request(30, 'Vencimento', {
      fieldType: 600,
      semantic: semantic({ domain: 'corban', canCancelBill: true })
    }),
    context()
  );
  ui.respond({ continueFlag: 2 }, ui.getSnapshot().pending.id);
  assert.deepEqual(await bill, { continueFlag: 2 });
  const other = ui.handler(
    request(30, 'Outro campo', {
      fieldType: 500,
      semantic: semantic({ domain: 'corban', canCancelBill: true })
    }),
    context()
  );
  assert.throws(
    () => ui.respond({ continueFlag: 2 }, ui.getSnapshot().pending.id),
    { code: 'INVALID_NAVIGATION' }
  );
  ui.respond({ buffer: '1234' }, ui.getSnapshot().pending.id);
  await other;
  const barcode = ui.handler(request(35, 'Barras'), context());
  ui.respond({ buffer: '2:' }, ui.getSnapshot().pending.id);
  assert.deepEqual(await barcode, { buffer: '2:', continueFlag: 0 });
});

test('core semantic precision overrides legacy metadata and product precision stays scoped', async () => {
  const ui = createSitefModal({ onCancel() {} });
  ui.onExchange(request(0, '3', { fieldType: 2470 }));
  ui.onExchange(request(0, '5', { fieldType: 1121 }));
  ui.onExchange(request(0, '4', { fieldType: 1126 }));
  assert.equal(ui.getSnapshot().decimalPlaces, 3);
  assert.equal(ui.getSnapshot().unitPriceDecimalPlaces, 5);
  assert.equal(ui.getSnapshot().quantityDecimalPlaces, 4);
  const value = ui.handler(
    request(34, 'Valor', { semantic: semantic({ decimalPlaces: 1 }) }),
    context()
  );
  const id = ui.getSnapshot().pending.id;
  assert.throws(() => ui.respond({ buffer: '1,23' }, id), {
    code: 'INVALID_AMOUNT'
  });
  ui.respond({ buffer: '1,2' }, id);
  await value;
  ui.complete();
  assert.equal(ui.getSnapshot().quantityDecimalPlaces, undefined);
  assert.equal(ui.getSnapshot().unitPriceDecimalPlaces, undefined);
});

test('field formats are validated through the shared browser-safe validator', async () => {
  const ui = createSitefModal({ onCancel() {} });
  for (const [format, invalid, valid] of [
    ['A', 'AB2', 'José'],
    ['LN', 'Ação1', 'Acao1'],
    ['N', '12A', '123'],
    ['V3', '1,2345', '1,234'],
    ['DDMMAAAA', '31022026', '28022026']
  ]) {
    const waiting = ui.handler(
      request(30, 'Coleta', {
        semantic: semantic({ format, decimalPlaces: format === 'V3' ? 3 : 2 })
      }),
      context()
    );
    const id = ui.getSnapshot().pending.id;
    assert.throws(() => ui.respond({ buffer: invalid }, id));
    ui.respond({ buffer: valid }, id);
    assert.equal((await waiting).buffer, valid);
  }
});

test('raw metadata fallback consumes2355 once and semantic sensitive requests remain marked', async () => {
  const ui = createSitefModal({ onCancel() {} });
  ui.onExchange(request(0, 'N', { fieldType: 2355 }));
  const first = ui.handler(request(30, 'Número'), context());
  const id = ui.getSnapshot().pending.id;
  assert.throws(() => ui.respond({ buffer: 'abc' }, id), {
    code: 'INVALID_FORMAT'
  });
  ui.respond({ buffer: '123' }, id);
  await first;
  const second = ui.handler(
    request(30, 'Dado protegido', { semantic: semantic({ sensitive: true }) }),
    context()
  );
  assert.equal(ui.getSnapshot().pending.request.semantic.sensitive, true);
  assert.equal(ui.getSnapshot().pending.request.semantic.format, undefined);
  ui.respond({ buffer: 'ABC' }, ui.getSnapshot().pending.id);
  await second;
});

test('2470 fallback precision is consumed once by a collection, not by display messages', async () => {
  const ui = createSitefModal({ onCancel() {} });
  ui.onExchange(request(0, '3', { fieldType: 2470 }));
  await ui.handler(request(1, 'Aguarde'), context());
  const first = ui.handler(request(34, 'Valor'), context());
  ui.respond({ buffer: '1,234' }, ui.getSnapshot().pending.id);
  await first;
  const next = ui.handler(request(34, 'Outro valor'), context());
  const id = ui.getSnapshot().pending.id;
  assert.throws(() => ui.respond({ buffer: '1,234' }, id), {
    code: 'INVALID_AMOUNT'
  });
  ui.respond({ buffer: '1,23' }, id);
  await next;
});
