import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  FieldProcessor,
  fieldDefinition,
  functionDefinition,
  validateFieldResponse,
  buildNfpag,
  exactDecimal,
  decimalSum,
  decimalText,
  SitefClient
} from '../dist/index.js';

const input = {
  functionId: 2,
  amount: '50,00',
  fiscalDocument: '100',
  fiscalDate: '20261030',
  fiscalTime: '120000',
  operator: 'Caixa'
};
const config = {
  server: '127.0.0.1',
  storeId: '00000000',
  terminalId: 'AA123456'
};
const step = (
  fieldType,
  buffer,
  command = 0,
  minLength = 0,
  maxLength = 100
) => ({
  status: 10000,
  fieldType,
  buffer,
  command,
  minLength,
  maxLength,
  kind: command === 0 ? 'field' : 'input'
});
const context = (functionId = 2) => ({
  functionId,
  paymentId: 'payment',
  groupId: 'group',
  input: { ...input, functionId },
  signal: new AbortController().signal,
  definition: functionDefinition(functionId)
});
const hooks = {
  storeReceipt: async () => true,
  printReceipt: async () => true
};
class MemoryJournal {
  record;
  writes = [];
  locked = false;
  async acquire() {
    assert.equal(this.locked, false);
    this.locked = true;
  }
  async release() {
    this.locked = false;
  }
  async read() {
    return this.record && structuredClone(this.record);
  }
  async write(record) {
    this.record = structuredClone(record);
    this.writes.push(this.record);
  }
}
class Native {
  scripts = [];
  query = [];
  active = [];
  calls = [];
  finishCount = 0;
  failFinish;
  constructor(scripts = []) {
    this.scripts = scripts;
  }
  async call(method, params = {}) {
    this.calls.push({ method, params: structuredClone(params) });
    if (method === 'configure') return { status: 0 };
    if (method === 'start') {
      this.active = [
        ...(params.functionId === 130 || params.functionId === 131
          ? this.query
          : (this.scripts.shift() ?? []))
      ];
      return { status: 10000 };
    }
    if (method === 'continue') {
      if (params.continueFlag === -1) return { status: -2 };
      return this.active.shift() ?? { status: 0 };
    }
    if (method === 'finish') {
      if (++this.finishCount === this.failFinish)
        throw new Error('process lost');
      return { returned: true };
    }
    return {};
  }
  async close() {}
}
async function client(scripts, options = {}) {
  const transport = new Native(scripts),
    journal = new MemoryJournal();
  const sdk = await SitefClient.connect({
    transport,
    journal,
    configuration: config,
    interaction: async () => ({ buffer: '123' }),
    fields: { hooks },
    ...options
  });
  return { sdk, transport, journal };
}

test('every independently audited base field/function is addressable and classifications are contextual', async () => {
  const audit = JSON.parse(
    await readFile(
      new URL('../../../protocol/coverage-audit.json', import.meta.url),
      'utf8'
    )
  );
  assert.equal(audit.baseFields, 444);
  assert.equal(audit.missingSourceIds.length, 0);
  const fields = JSON.parse(
    await readFile(
      new URL('../../../protocol/fields.json', import.meta.url),
      'utf8'
    )
  );
  const base = Object.entries(fields.entries).filter(
    ([, x]) => x.origin.section === '5.3.2'
  );
  assert.equal(base.length, 444);
  for (const [id, entry] of base) {
    assert.equal(fieldDefinition(Number(id)).name, entry.name);
    assert.ok(entry.dataType);
    assert.ok(entry.action.kind);
  }
  assert.notEqual(
    fieldDefinition(2053).name,
    fieldDefinition(2053, 'secure-card-read').name
  );
  assert.equal(fieldDefinition(2053, 'secure-card-read').sensitive, true);
  assert.equal(functionDefinition(111).finalizationPolicy, 'nonfinancial');
  assert.equal(functionDefinition(2).finalizationPolicy, 'financial');
});
test('decimal amounts remain exact beyond floating point safe integers', () => {
  assert.equal(
    decimalText(
      decimalSum([exactDecimal('900719925474099312,34'), exactDecimal('0,01')])
    ),
    '900719925474099312,35'
  );
  assert.throws(() => exactDecimal('1,234', 2), { code: 'INVALID_DECIMAL' });
});
test('format hints apply once; dates are validated without guessing a missing century', async () => {
  const processor = new FieldProcessor({}, context());
  await processor.process(step(2355, 'LN'));
  const request = await processor.process(step(99999, 'Descrição', 30, 1, 20));
  assert.equal(request.semantic.format, 'LN');
  assert.throws(() => validateFieldResponse(request, { buffer: 'á' }, {}), {
    code: 'INVALID_FORMAT'
  });
  validateFieldResponse(request, { buffer: 'ABC123' }, {});
  assert.equal(
    (await processor.process(step(99999, 'Next', 30))).semantic.format,
    undefined
  );
  const date = {
    ...request,
    semantic: { ...request.semantic, format: 'DDMMAAAA' }
  };
  assert.throws(() => validateFieldResponse(date, { buffer: '31022026' }), {
    code: 'INVALID_DATE'
  });
  validateFieldResponse(date, { buffer: '29022024' });
});
test('Mc requires operator confirmation and partial cancellation is limited to bill collections', async () => {
  const processor = new FieldProcessor({}, context(310));
  await processor.process(step(2355, 'Mc'));
  const menu = await processor.process(step(999, '1:Débito;2:Crédito', 30));
  assert.throws(() => validateFieldResponse(menu, { buffer: '1' }), {
    code: 'CONFIRMATION_REQUIRED'
  });
  validateFieldResponse(menu, { buffer: '1', confirmed: true });
  const bill = await processor.process(step(601, 'Valor', 34));
  validateFieldResponse(bill, { continueFlag: 2 });
  assert.throws(
    () =>
      validateFieldResponse(
        { ...bill, semantic: { ...bill.semantic, canCancelBill: false } },
        { continueFlag: 2 }
      ),
    { code: 'INVALID_PARTIAL_CANCEL' }
  );
});
test('receipt handlers are mandatory, and deferred paper signature follows printing', async () => {
  const immediate = new FieldProcessor({}, context(112));
  await assert.rejects(immediate.process(step(121, 'recibo')), {
    code: 'MISSING_FIELD_HANDLER'
  });
  const order = [];
  const p = new FieldProcessor(
    {
      hooks: {
        storeReceipt: async () => {
          order.push('stored');
          return true;
        },
        printReceipt: async () => {
          order.push('printed');
          return true;
        },
        captureSignature: async () => {
          order.push('signed');
          return true;
        }
      }
    },
    context()
  );
  await p.process(step(121, 'Recibo'));
  await p.process(step(5074, ''));
  assert.deepEqual(order, ['stored']);
  await p.printDeferred();
  assert.deepEqual(order, ['stored', 'printed', 'signed']);
});
test('device resources release during cancellation cleanup even when event5043 is absent', async () => {
  const order = [];
  const p = new FieldProcessor(
    {
      hooks: {
        lockResources: async () => {
          order.push('lock');
          return true;
        },
        unlockResources: async () => {
          order.push('unlock');
          return true;
        }
      }
    },
    context()
  );
  await p.process(step(5042, ''));
  await p.cleanup();
  await p.cleanup();
  assert.deepEqual(order, ['lock', 'unlock']);
});
test('monetary scales cannot be guessed and PBM/carnê require explicit application decisions', async () => {
  const p = new FieldProcessor({}, context());
  await p.process(step(137, '1000'));
  const result = await p.finish(0);
  assert.equal(result.assessment.accepted, false);
  assert.ok(result.assessment.issues.includes('MONETARY_FORMAT_REQUIRED:137'));
  const fallback = new FieldProcessor({}, context(16));
  await assert.rejects(fallback.finish(0), { code: 'MISSING_FIELD_HANDLER' });
  const pbm = new FieldProcessor(
    { hooks: { validateTransaction: async () => false } },
    context()
  );
  await pbm.process(step(4039, '17'));
  assert.equal((await pbm.finish(0)).assessment.pbmError, '17');
});
test('NFPAG validates enabled methods, sums, cheque origin and destination restriction', () => {
  const requirements = {
    maximum: 2,
    types: {
      '00': { fields: [] },
      '02': { fields: ['03', '07'], allowedNetworks: ['5'] }
    }
  };
  assert.equal(
    buildNfpag(
      requirements,
      [
        { type: '00', amount: '30,00' },
        { type: '02', amount: '20,00', data: { '03': '5', '07': '123' } }
      ],
      '50,00'
    ),
    '00:3000;02:2000:03:5-07:123;'
  );
  assert.throws(
    () => buildNfpag(requirements, [{ type: '00', amount: '49,99' }], '50,00'),
    { code: 'NFPAG_TOTAL' }
  );
  assert.throws(
    () =>
      buildNfpag(
        requirements,
        [{ type: '02', amount: '50,00', data: { '03': '7', '07': '123' } }],
        '50,00'
      ),
    { code: 'NFPAG_NETWORK' }
  );
});
test('appending a declined payment retains the previously approved pending payment', async () => {
  const { sdk, journal } = await client([[step(161, '0')], [{ status: 57 }]]);
  await sdk.transact(input);
  const second = await sdk.transact(input);
  assert.equal(second.status, 57);
  assert.equal(sdk.state, 'awaiting-finalization');
  assert.equal(journal.record.payments[0].state, 'awaiting-finalization');
  assert.equal(journal.record.payments[1].state, 'ended');
  await sdk.finalize(false);
  await sdk.close();
});
test('different fiscal scopes require explicit decisions and reconnect before recovery', async () => {
  const { sdk, transport, journal } = await client([[step(161,'0')],[step(161,'0')]]);
  const first = await sdk.transact(input);
  const second = await sdk.transact({...input,fiscalDocument:'101',fiscalDate:'20261031',fiscalTime:'000010'});
  await assert.rejects(sdk.finalize(true),{code:'FINALIZATION_SCOPE_REQUIRED'});
  assert.equal(transport.finishCount,0);
  await sdk.finalizeTransaction(true,first.transactionId);
  transport.failFinish=2;
  await assert.rejects(sdk.finalizeTransaction(true,second.transactionId),{code:'FINALIZATION_UNCERTAIN'});
  assert.ok(journal.writes.some(r=>r.payments[0].state==='finalized-local'&&r.payments[1].state==='finalizing'));
  assert.equal(journal.record.payments[0].state,'finalized-local');
  assert.equal(journal.record.payments[1].state,'uncertain');
  await assert.rejects(sdk.finalizeRecovery(true,sdk.recovery.id),{code:'RECONNECT_REQUIRED'});
  await sdk.close();
  const native=new Native();
  const recovered=await SitefClient.connect({transport:native,journal,configuration:config,interaction:async()=>({}),fields:{hooks}});
  await recovered.finalizeRecovery(true,recovered.recovery.id,undefined,{transactionId:second.transactionId});
  assert.equal(transport.finishCount,2);assert.equal(native.finishCount,1);
  assert.equal(native.calls.at(-1).params.fiscalDate,'20261031');
  assert.equal(recovered.state,'idle');await recovered.close();
});
test('selective finalization never widens scope to a sibling payment', async () => {
  const { sdk, transport } = await client([[step(161, '0')], [step(161, '1')]]);
  const first = await sdk.transact(input);
  await sdk.transact(input, { appendPayment: true });
  await assert.rejects(sdk.finalize(true, '{NumeroPagamentoCupom=0}'), {
    code: 'RESERVED_FINALIZATION_SCOPE'
  });
  await sdk.finalizePayment(true, first.transactionId);
  assert.equal(
    transport.calls.at(-1).params.additionalParameters,
    '{NumeroPagamentoCupom=0}'
  );
  assert.equal(sdk.state, 'awaiting-finalization');
  await sdk.finalize(false);
  await sdk.close();
});
test('pending details remain available during uncertain state without mutating the financial journal', async () => {
  const { sdk, transport, journal } = await client([[step(161, '0')]]);
  await sdk.transact(input);
  transport.failFinish = 1;
  await assert.rejects(sdk.finalize(false), { code: 'FINALIZATION_UNCERTAIN' });
  await assert.rejects(sdk.queryPendingTransactions(),{code:'RECONNECT_REQUIRED'});
  await sdk.close();
  const nextTransport=new Native();
  const recovered=await SitefClient.connect({transport:nextTransport,journal,configuration:config,interaction:async()=>({}),fields:{hooks}});
  nextTransport.query = [
    step(210, '1'),
    step(160, '100'),
    step(161, '0'),
    step(163, '20261030'),
    step(164, '120000'),
    step(211, '2'),
    step(1319, '50,00')
  ];
  const before = structuredClone(journal.record),
    count = journal.writes.length;
  const result = await recovered.queryPendingTransactions();
  assert.equal(result.transactions[0].paymentIndex, '0');
  assert.equal(result.transactions[0].amount, '50,00');
  assert.deepEqual(journal.record, before);
  assert.equal(journal.writes.length, count);
  await recovered.close();
});
test('nonfinancial functions use an ephemeral cycle and cannot accidentally request financial finalization', async () => {
  const { sdk, journal, transport } = await client([[]]);
  const result = await sdk.runFunction(111);
  assert.equal(result.requiresFinalization, false);
  assert.equal(journal.writes.length, 0);
  assert.equal(transport.calls[1].params.fiscalDocument, '');
  await assert.rejects(
    sdk.runFunction(111, {}, { requiresFinalization: true }),
    { code: 'FINALIZATION_POLICY_MISMATCH' }
  );
  await sdk.close();
});

test('deferred receipts restore by hash, print before signature and never enter the journal as text', async () => {
  const stored = new Map(),
    order = [];
  const fields = {
    hooks: {
      storeReceipt: async (r) => {
        stored.set(r.id, structuredClone(r));
        return true;
      },
      printReceipt: async () => {
        order.push('print');
        return true;
      },
      captureSignature: async () => {
        order.push('signature');
        return true;
      }
    }
  };
  const { sdk, journal } = await client(
    [[step(121, 'PRIVATE RECEIPT'), step(5074, '')]],
    { fields }
  );
  await sdk.transact(input);
  assert.equal(
    JSON.stringify(journal.record).includes('PRIVATE RECEIPT'),
    false
  );
  // Simulate process death by reconnecting only the durable record.
  await journal.release();
  const transport = new Native();
  let wrong = true;
  const recovered = await SitefClient.connect({
    transport,
    journal,
    configuration: config,
    interaction: async () => ({}),
    fields: {
      hooks: {
        ...fields.hooks,
        loadReceipt: async (ref) => ({
          ...stored.get(ref.id),
          buffer: wrong ? 'different' : stored.get(ref.id).buffer
        })
      }
    }
  });
  await assert.rejects(
    recovered.finalizeRecovery(true, recovered.recovery.id),
    { code: 'RECEIPT_HASH_MISMATCH' }
  );
  assert.equal(transport.finishCount, 0);
  wrong = false;
  await recovered.finalizeRecovery(true, recovered.recovery.id);
  assert.deepEqual(order, ['print', 'signature']);
  assert.equal(transport.finishCount, 1);
  await recovered.close();
});

test('NFPAG persists only an external payload reference and recovery rejects a changed payload', async () => {
  let payload;
  const fields = {
    hooks: {
      ...hooks,
      storeFinalizationPayload: async (value) => {
        payload = value;
        return true;
      },
      loadFinalizationPayload: async () => payload.parameters
    }
  };
  const { sdk, transport, journal } = await client(
    [[step(161, '0'), step(730, '1'), step(731, '00')], [step(161, '1')]],
    { fields }
  );
  const sale = await sdk.transact(input);
  await sdk.transact(input, { appendPayment: true });
  transport.failFinish = 1;
  await assert.rejects(
    sdk.finalizeWithPayments(
      false,
      sale.transactionId,
      [{ type: '00', amount: '50,00' }],
      '50,00'
    ),
    { code: 'FINALIZATION_UNCERTAIN' }
  );
  assert.equal(
    journal.record.payments.every((p) => p.state === 'uncertain'),
    true
  );
  assert.equal(JSON.stringify(journal.record).includes('00:5000;'), false);
  assert.equal(
    journal.record.payments[0].finalizationParameters,
    '{NumeroPagamentoNFPAG=0}'
  );
  await assert.rejects(sdk.finalizeRecovery(false,sdk.recovery.id),{code:'RECONNECT_REQUIRED'});
  await sdk.close();
  const nextTransport=new Native();
  const recovered=await SitefClient.connect({transport:nextTransport,journal,configuration:config,interaction:async()=>({}),fields});
  const original = payload.parameters;
  payload.parameters += 'tampered';
  await assert.rejects(recovered.finalizeRecovery(false, recovered.recovery.id), {
    code: 'FINALIZATION_PAYLOAD_MISMATCH'
  });
  assert.equal(transport.finishCount, 1);
  payload.parameters = original;
  await recovered.finalizeRecovery(false, recovered.recovery.id);
  assert.equal(recovered.state, 'idle');
  assert.equal(nextTransport.finishCount,1);
  await recovered.close();
});

test('selective recovery retains an unrelated awaiting payment', async () => {
  const { sdk, transport, journal } = await client([[step(161, '0')], [step(161, '1')]]);
  const first = await sdk.transact(input);
  await sdk.transact(input, { appendPayment: true });
  transport.failFinish = 1;
  await assert.rejects(sdk.finalizePayment(false, first.transactionId), {
    code: 'FINALIZATION_UNCERTAIN'
  });
  await sdk.close();
  const nextTransport=new Native();
  const recovered=await SitefClient.connect({transport:nextTransport,journal,configuration:config,interaction:async()=>({}),fields:{hooks}});
  await recovered.finalizeRecovery(false,recovered.recovery.id);
  assert.equal(
    nextTransport.calls.filter((c) => c.method === 'finish').at(-1).params
      .additionalParameters,
    '{NumeroPagamentoCupom=0}'
  );
  assert.equal(recovered.state, 'awaiting-finalization');
  await recovered.finalize(false);
  await recovered.close();
});

test('V1 recovery requires explicit attestation of obligations before confirmation', async () => {
  const journal = new MemoryJournal();
  journal.record = {
    version: 1,
    id: 'legacy',
    storeId: config.storeId,
    terminalId: config.terminalId,
    functionId: 2,
    fiscalDocument: input.fiscalDocument,
    fiscalDate: input.fiscalDate,
    fiscalTime: input.fiscalTime,
    state: 'uncertain',
    updatedAt: new Date().toISOString()
  };
  const transport = new Native();
  let accepted = false;
  const sdk = await SitefClient.connect({
    transport,
    journal,
    configuration: config,
    interaction: async () => ({}),
    fields: { hooks: { attestLegacyObligations: async () => accepted } }
  });
  await assert.rejects(sdk.finalizeRecovery(true, 'legacy'), {
    code: 'LEGACY_OBLIGATIONS_REQUIRED'
  });
  assert.equal(transport.finishCount, 0);
  accepted = true;
  await sdk.finalizeRecovery(true, 'legacy');
  assert.equal(journal.record.payments[0].legacyReceiptStateUnknown, false);
  await sdk.close();
});

test('payload restoration holds the session lock across asynchronous application callbacks', async () => {
  let resume;
  let entered;
  const ready = new Promise((resolve) => (entered = resolve));
  let payload;
  const fields = {
    hooks: {
      ...hooks,
      storeFinalizationPayload: async (value) => {
        payload = value;
        return true;
      },
      loadFinalizationPayload: async () => {
        entered();
        await new Promise((resolve) => (resume = resolve));
        return payload.parameters;
      }
    }
  };
  const { sdk, transport, journal } = await client(
    [[step(161, '0'), step(730, '0'), step(731, '00')]],
    { fields }
  );
  const sale = await sdk.transact(input);
  transport.failFinish = 1;
  await assert.rejects(
    sdk.finalizeWithPayments(
      false,
      sale.transactionId,
      [{ type: '00', amount: '50,00' }],
      '50,00'
    ),
    { code: 'FINALIZATION_UNCERTAIN' }
  );
  await sdk.close();
  const nextTransport=new Native();
  const recovered=await SitefClient.connect({transport:nextTransport,journal,configuration:config,interaction:async()=>({}),fields});
  const recovery = recovered.finalizeRecovery(false,recovered.recovery.id);
  await ready;
  await assert.rejects(recovered.finalizeRecovery(false, recovered.recovery.id), {
    code: 'INVALID_RECOVERY'
  });
  resume();
  await recovery;
  await recovered.close();
});

test('NFPAG can collect payment methods from the provider without overwriting explicit methods', async () => {
  let count = 0;
  const fields = {
    hooks: {
      ...hooks,
      paymentData: async () => {
        count++;
        return [{ type: '00', amount: '50,00' }];
      },
      storeFinalizationPayload: async () => true
    }
  };
  const { sdk, transport } = await client(
    [
      [step(161, '0'), step(730, '0'), step(731, '00')],
      [step(161, '0'), step(730, '0'), step(731, '00')]
    ],
    { fields }
  );
  const sale = await sdk.transact(input);
  await sdk.finalizeWithPayments(false, sale.transactionId, undefined, '50,00');
  assert.equal(count, 1);
  assert.equal(
    transport.calls.at(-1).params.additionalParameters,
    '{NumeroPagamentoNFPAG=0}{NFPAG=00:5000;}'
  );
  const second = await sdk.transact(input);
  await sdk.finalizeWithPayments(
    false,
    second.transactionId,
    [{ type: '00', amount: '50,00' }],
    '50,00'
  );
  assert.equal(count, 1);
  await sdk.close();
});

test('pending query preserves native failure codes even after an incomplete detail record', async () => {
  const { sdk, transport, journal } = await client([]);
  transport.query = [step(160, 'incomplete'), { status: -40 }];
  const result = await sdk.queryPendingTransactions();
  assert.equal(result.status, -40);
  assert.deepEqual(result.transactions, []);
  assert.equal(result.fields[0].buffer, 'incomplete');
  assert.equal(journal.writes.length, 0);
  await sdk.close();
});

test('native secure readers derive semantics from the entry point rather than a nominal payment function', async () => {
  class Reader extends Native {
    async call(method, params) {
      if (method === 'readSecureCard') {
        this.calls.push({ method, params });
        this.active = [step(2053, 'hash')];
        return { status: 10000 };
      }
      return super.call(method, params);
    }
  }
  const transport = new Reader(),
    journal = new MemoryJournal();
  const sdk = await SitefClient.connect({
    transport,
    journal,
    configuration: config,
    interaction: async () => ({}),
    fields: {
      hooks: {
        resolveField: async (request) => {
          assert.equal(
            request.semantic.definition.name,
            fieldDefinition(2053, 'secure-card-read').name
          );
          return { opaqueProtectedData: request.buffer };
        }
      }
    }
  });
  const result = await sdk.transact(
    { ...input, functionId: 16 },
    {
      nativeStart: {
        method: 'readSecureCard',
        params: { message: 'Ler cartão' }
      }
    }
  );
  assert.equal(result.requiresFinalization, false);
  assert.equal(
    result.details.fields[0].definition.name,
    fieldDefinition(2053, 'secure-card-read').name
  );
  assert.equal(journal.writes.length, 0);
  await sdk.close();
});

test('a failed journal write after a returned finalization retains a recoverable decision', async () => {
  const { sdk, transport, journal } = await client([[step(161, '0')]]);
  await sdk.transact(input);
  const write = journal.write.bind(journal);
  let failed = false;
  journal.write = async (record) => {
    if (!failed && record.state === 'finalized-local') {
      failed = true;
      throw new Error('disk failed after FFI');
    }
    return write(record);
  };
  await assert.rejects(sdk.finalize(false), { code: 'FINALIZATION_UNCERTAIN' });
  assert.equal(sdk.recovery.payments[0].state, 'uncertain');
  assert.equal(sdk.recovery.payments[0].decision, 0);
  await sdk.finalizeRecovery(false, sdk.recovery.id);
  assert.equal(transport.finishCount, 2);
  assert.equal(sdk.state, 'idle');
  await sdk.close();
});

test('an external payload hash cannot conceal a mismatched persisted selector', async () => {
  let payload;
  const fields = {
    hooks: {
      ...hooks,
      storeFinalizationPayload: async (value) => {
        payload = value;
        return true;
      },
      loadFinalizationPayload: async () => payload.parameters
    }
  };
  const { sdk, transport, journal } = await client(
    [[step(161, '0'), step(730, '0'), step(731, '00')]],
    { fields }
  );
  const sale = await sdk.transact(input);
  transport.failFinish = 1;
  await assert.rejects(
    sdk.finalizeWithPayments(
      false,
      sale.transactionId,
      [{ type: '00', amount: '50,00' }],
      '50,00'
    ),
    { code: 'FINALIZATION_UNCERTAIN' }
  );
  await sdk.close();
  journal.record.payments[0].finalizationParameters =
    '{NumeroPagamentoNFPAG=9}';
  const restoredTransport = new Native();
  const restored = await SitefClient.connect({
    transport: restoredTransport,
    journal,
    configuration: config,
    interaction: async () => ({}),
    fields
  });
  await assert.rejects(restored.finalizeRecovery(false, restored.recovery.id), {
    code: 'FINALIZATION_PAYLOAD_SCOPE_MISMATCH'
  });
  assert.equal(restoredTransport.finishCount, 0);
  await restored.close();
});
