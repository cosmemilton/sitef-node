import { SitefError } from './errors.js';
import type {
  GroupJournalRecord,
  JournalRecord,
  PaymentRecord
} from './types.js';

const states = new Set([
  'started',
  'awaiting-finalization',
  'finalizing',
  'finalized-local',
  'ended',
  'uncertain'
]);
const paymentKeys = new Set([
  'id',
  'functionId',
  'entryPoint',
  'fiscalDocument',
  'fiscalDate',
  'fiscalTime',
  'state',
  'decision',
  'status',
  'paymentIndex',
  'network',
  'finalizationParameters',
  'confirmationAllowed',
  'assessmentIssues',
  'receipts',
  'signatureRequired',
  'signatureCaptured',
  'finalizationPayload',
  'legacyReceiptStateUnknown'
]);
function validText(value: unknown): value is string {
  return typeof value === 'string' && !value.includes('\0');
}
export function normalizeJournal(value: unknown): GroupJournalRecord {
  if (!value || typeof value !== 'object')
    throw new SitefError('JOURNAL_INVALID', 'Registro inválido.');
  const source = value as JournalRecord;
  if (
    ![1, 2].includes(source.version) ||
    !validText(source.id) ||
    !source.id ||
    !validText(source.storeId) ||
    !validText(source.terminalId) ||
    !states.has(source.state)
  )
    throw new SitefError(
      'JOURNAL_INVALID',
      'Identidade, versão ou estado inválido.'
    );
  const legacy = source.version === 1;
  const payments: PaymentRecord[] = legacy
    ? [
        {
          id: source.id,
          functionId: source.functionId,
          entryPoint: source.entryPoint ?? 'start',
          fiscalDocument: source.fiscalDocument,
          fiscalDate: source.fiscalDate,
          fiscalTime: source.fiscalTime,
          state: source.state,
          legacyReceiptStateUnknown: true,
          confirmationAllowed: false,
          ...(source.decision === undefined
            ? {}
            : { decision: source.decision }),
          ...(source.status === undefined ? {} : { status: source.status }),
          ...(source.finalizationParameters === undefined
            ? {}
            : { finalizationParameters: source.finalizationParameters })
        }
      ]
    : source.payments;
  if (!Array.isArray(payments) || !payments.length || payments.length > 10000)
    throw new SitefError('JOURNAL_INVALID', 'Lista de pagamentos inválida.');
  const seen = new Set<string>();
  for (const payment of payments) {
    if (
      !validText(payment.id) ||
      !payment.id ||
      seen.has(payment.id) ||
      !Number.isInteger(payment.functionId) ||
      !validText(payment.entryPoint) ||
      !validText(payment.fiscalDocument) ||
      !payment.fiscalDocument ||
      !/^\d{8}$/.test(payment.fiscalDate) ||
      !/^\d{6}$/.test(payment.fiscalTime) ||
      !states.has(payment.state)
    )
      throw new SitefError('JOURNAL_INVALID', 'Pagamento persistido inválido.');
    seen.add(payment.id);
    if (Object.keys(payment).some((key) => !paymentKeys.has(key)))
      throw new SitefError(
        'JOURNAL_INVALID',
        'Journal contém dados fora dos metadados permitidos.'
      );
    if (payment.decision !== undefined && ![0, 1].includes(payment.decision))
      throw new SitefError('JOURNAL_INVALID', 'Decisão persistida inválida.');
    if (
      payment.finalizationParameters !== undefined &&
      !validText(payment.finalizationParameters)
    )
      throw new SitefError('JOURNAL_INVALID', 'Escopo persistido inválido.');
    for (const flag of [
      'confirmationAllowed',
      'signatureRequired',
      'signatureCaptured',
      'legacyReceiptStateUnknown'
    ] as const)
      if (payment[flag] !== undefined && typeof payment[flag] !== 'boolean')
        throw new SitefError('JOURNAL_INVALID', 'Flag persistida inválida.');
    if (
      payment.finalizationPayload &&
      (!validText(payment.finalizationPayload.id) ||
        !/^[a-f0-9]{64}$/.test(payment.finalizationPayload.hash))
    )
      throw new SitefError(
        'JOURNAL_INVALID',
        'Referência de payload inválida.'
      );
    if (
      (payment.paymentIndex !== undefined &&
        !/^\d+$/.test(payment.paymentIndex)) ||
      (payment.network !== undefined && !/^\d+$/.test(payment.network))
    )
      throw new SitefError(
        'JOURNAL_INVALID',
        'Índice ou rede persistido inválido.'
      );
    if (
      payment.receipts !== undefined &&
      (!Array.isArray(payment.receipts) ||
        payment.receipts.some(
          (r) =>
            !validText(r.id) ||
            !Number.isInteger(r.fieldType) ||
            !['immediate', 'deferred'].includes(r.timing) ||
            !/^[a-f0-9]{64}$/.test(r.hash) ||
            typeof r.printed !== 'boolean' ||
            Object.keys(r).some(
              (k) =>
                ![
                  'id',
                  'fieldType',
                  'type',
                  'timing',
                  'billIndex',
                  'hash',
                  'printed'
                ].includes(k)
            )
        ))
    )
      throw new SitefError(
        'JOURNAL_INVALID',
        'Referência de comprovante inválida.'
      );
  }
  return {
    version: 2,
    id: source.id,
    storeId: source.storeId,
    terminalId: source.terminalId,
    functionId: source.functionId,
    fiscalDocument: source.fiscalDocument,
    fiscalDate: source.fiscalDate,
    fiscalTime: source.fiscalTime,
    state: source.state,
    updatedAt: source.updatedAt,
    payments: structuredClone(payments)
  };
}
export function groupState(
  record: GroupJournalRecord
): GroupJournalRecord['state'] {
  if (record.payments.some((p) => p.state === 'uncertain')) return 'uncertain';
  if (record.payments.some((p) => p.state === 'finalizing'))
    return 'finalizing';
  if (record.payments.some((p) => p.state === 'started')) return 'started';
  if (record.payments.some((p) => p.state === 'awaiting-finalization'))
    return 'awaiting-finalization';
  return record.payments.some((p) => p.state === 'finalized-local')
    ? 'finalized-local'
    : 'ended';
}
