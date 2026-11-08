import { createHash } from 'node:crypto';
import { lstat, readFile, mkdir, open } from 'node:fs/promises';
import { join, isAbsolute, resolve } from 'node:path';
import { SitefClient } from '../../packages/core/dist/index.js';
// Internal parser reused deliberately: hash and validated metadata must originate
// from the exact same byte snapshot. No second read via FileJournal.read().
import { normalizeJournal } from '../../packages/core/dist/journal-record.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function recoveryError(code, message) {
  return Object.assign(new Error(message), { code });
}
export function journalPath(root, configuration) {
  const key = digest(configuration.storeId + '\0' + configuration.terminalId);
  return join(root, 'state', key + '.journal.json');
}
async function fileBytes(path, optional = false, limit = 1048576) {
  let info;
  try { info = await lstat(path); }
  catch (error) { if (optional && error.code === 'ENOENT') return undefined; throw error; }
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit)
    throw recoveryError('RECOVERY_FILE_INVALID', 'Arquivo de evidencia invalido, link ou acima do limite.');
  const bytes = await readFile(path);
  if (bytes.length > limit) throw recoveryError('RECOVERY_FILE_INVALID', 'Arquivo acima do limite.');
  return bytes;
}
export async function inspectJournal(path, configuration) {
  const directory = await lstat(resolve(path, '..'));
  if (!directory.isDirectory() || directory.isSymbolicLink())
    throw recoveryError('RECOVERY_DIRECTORY_INVALID', 'Diretorio de estado deve ser local e direto.');
  const before = await fileBytes(path);
  const lock = await fileBytes(path + '.lock', true, 4096);
  // Reuse the core validator, without acquiring a lock, loading a DLL or writing.
  const record = normalizeJournal(JSON.parse(before.toString('utf8')));
  const after = await fileBytes(path);
  const lockAfter = await fileBytes(path + '.lock', true, 4096);
  if (!before.equals(after) || !sameOptional(lock, lockAfter))
    throw recoveryError('RECOVERY_CHANGED', 'Estado mudou durante a leitura. Inspecione novamente.');
  if (!record || record.storeId !== configuration.storeId || record.terminalId !== configuration.terminalId)
    throw recoveryError('RECOVERY_TERMINAL_MISMATCH', 'Journal nao corresponde a loja/terminal deste exemplo.');
  return { path, bytes: before, hash: digest(before), lock, lockHash: lock && digest(lock), record };
}
function sameOptional(a, b) {
  return a === undefined ? b === undefined : b !== undefined && a.equals(b);
}
export async function assertSnapshot(snapshot, includeLock = true) {
  if (!(await fileBytes(snapshot.path)).equals(snapshot.bytes) ||
      (includeLock && !sameOptional(await fileBytes(snapshot.path + '.lock', true, 4096), snapshot.lock)))
    throw recoveryError('RECOVERY_CHANGED', 'Journal ou lock mudou. Nenhuma decisao de recuperacao foi aplicada.');
}
export function requireIdentity(snapshot, expected) {
  if (!expected?.id || !/^[a-f0-9]{64}$/.test(expected?.hash ?? '') ||
      snapshot.record.id !== expected.id || snapshot.hash !== expected.hash)
    throw recoveryError('RECOVERY_IDENTITY_MISMATCH', 'Informe o grupo e o SHA-256 exatos da inspecao atual.');
}
export function inspectionReport(snapshot) {
  const { record } = snapshot;
  let lockOwner;
  try {
    const parsed = JSON.parse(snapshot.lock?.toString('utf8') ?? 'null');
    if (Number.isSafeInteger(parsed?.pid) && parsed.pid > 0)
      lockOwner = { pid: parsed.pid, createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : undefined };
  } catch {}
  return {
    groupId: record.id, state: record.state, journalSha256: snapshot.hash,
    lockPresent: snapshot.lock !== undefined, lockSha256: snapshot.lockHash, lockOwner,
    payments: record.payments.map(p => ({
      id: p.id, state: p.state, fiscalDocument: p.fiscalDocument,
      fiscalDate: p.fiscalDate, fiscalTime: p.fiscalTime, paymentIndex: p.paymentIndex
    })),
    nextStep: snapshot.lock ? 'LOCK_REVIEW_REQUIRED' : 'EXPLICIT_QUERY_AVAILABLE',
    financialDecision: 'none', nativeCalls: 0
  };
}
async function writeNew(path, bytes) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
}
export async function preserveEvidence(snapshot, destination, expected) {
  requireIdentity(snapshot, expected);
  if (!destination || !isAbsolute(destination))
    throw recoveryError('EVIDENCE_PATH_REQUIRED', 'Informe uma pasta absoluta nova para as evidencias.');
  await assertSnapshot(snapshot);
  // No recursive mkdir or overwrite: an existing path is never reused.
  await mkdir(destination, { mode: 0o700 });
  await writeNew(join(destination, 'journal.json'), snapshot.bytes);
  if (snapshot.lock) await writeNew(join(destination, 'journal.lock'), snapshot.lock);
  if (!(await fileBytes(join(destination, 'journal.json'))).equals(snapshot.bytes) ||
      (snapshot.lock && !(await fileBytes(join(destination, 'journal.lock'))).equals(snapshot.lock)))
    throw recoveryError('EVIDENCE_VERIFY_FAILED', 'Copia nao verificada. Originais preservados.');
  await assertSnapshot(snapshot);
  const manifest = {
    version: 1, complete: true, capturedAt: new Date().toISOString(),
    groupId: snapshot.record.id, journalSha256: snapshot.hash,
    lockSha256: snapshot.lockHash ?? null, originalPath: snapshot.path,
    action: 'evidence-copy-only'
  };
  await writeNew(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
export function recoveryScope(snapshot) {
  const pending = snapshot.record.payments.filter(p => !['ended','finalized-local'].includes(p.state));
  // Narrow initial implementation: do not silently widen to a group or migration.
  if (snapshot.record.version !== 2 || JSON.parse(snapshot.bytes).version !== 2 || pending.length !== 1)
    throw recoveryError('RECOVERY_SCOPE_UNSUPPORTED', 'Consulta exige journal V2 com um unico pagamento pendente.');
  const payment = pending[0];
  if (payment.finalizationParameters || payment.finalizationPayload || payment.decision !== undefined)
    throw recoveryError('RECOVERY_PLAN_REVIEW_REQUIRED', 'Existe plano de finalizacao. Revisao especifica necessaria.');
  return { fiscalDocument: payment.fiscalDocument, fiscalDate: payment.fiscalDate };
}
// Defense in depth: not even a caller bug can use this adapter to sell, finish,
// flush queued messages, read cards, or query another fiscal document.
export function queryTransport(transport, configuration, scope) {
  let configured = false, counted = false, started = false, active = false;
  const exact = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
  return {
    async call(method, params = {}) {
      if (method === 'configure' && !configured && exact(params, { ...configuration, reserved: 0, additionalParameters: '' })) {
        configured = true;
      } else if (method === 'pendingCount' && configured && !counted && exact(params, scope)) {
        counted = true;
      } else if (method === 'start' && configured && counted && !started &&
                 exact(params, { ...scope, functionId: 131, amount: '', fiscalTime: '000000', operator: '', additionalParameters: '' })) {
        started = true;
      } else if (method === 'continue' && active) {
        const keys = Object.keys(params);
        if (keys.some(k => !['buffer','bufferBase64','continueFlag','bufferSize'].includes(k)) ||
            ![0,-1].includes(params.continueFlag) || params.bufferSize !== 20000)
          throw recoveryError('RECOVERY_NATIVE_FORBIDDEN', 'Continuacao de consulta fora do contrato.');
      } else {
        throw recoveryError('RECOVERY_NATIVE_FORBIDDEN', 'Somente configure, pendingCount e consulta 131 sao permitidos.');
      }
      const result = await transport.call(method, params);
      if (method === 'start' || method === 'continue') active = result.status === 10000;
      return result;
    },
    close: () => transport.close()
  };
}
// A separate capability for function 130: it cannot query a document, count it,
// start a sale, finalize, flush messages or read cards, even on caller mistakes.
export function terminalQueryTransport(transport, configuration) {
  let configured = false, started = false, active = false;
  const exact = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
  return {
    async call(method, params = {}) {
      if (method === 'configure' && !configured && exact(params, { ...configuration, reserved: 0, additionalParameters: '' })) {
        configured = true;
      } else if (method === 'start' && configured && !started && exact(params, {
        functionId: 130, amount: '', fiscalDocument: '', fiscalDate: '',
        fiscalTime: '', operator: '', additionalParameters: ''
      })) {
        started = true;
      } else if (method === 'continue' && active) {
        if (Object.keys(params).some(k => !['buffer','bufferBase64','continueFlag','bufferSize'].includes(k)) ||
            ![0,-1].includes(params.continueFlag) || params.bufferSize !== 20000)
          throw recoveryError('RECOVERY_NATIVE_FORBIDDEN', 'Continuacao de consulta fora do contrato.');
      } else {
        throw recoveryError('RECOVERY_NATIVE_FORBIDDEN', 'Somente configure e consulta 130 sao permitidos.');
      }
      const result = await transport.call(method, params);
      if (method === 'start' || method === 'continue') active = result.status === 10000;
      return result;
    },
    close: () => transport.close()
  };
}
export function summarizeTerminalQuery(result) {
  if (!Number.isSafeInteger(result?.status) || !Array.isArray(result.transactions))
    throw recoveryError('RECOVERY_QUERY_INVALID', 'Resposta de consulta invalida.');
  if (result.status !== 0) return {
    queryStatus: result.status, outcome: 'query-inconclusive',
    financialDecision: 'none', journalDisposition: 'preserved'
  };
  // A successful native return alone is insufficient evidence of an empty list.
  // Require one explicit field 210 and agreement with the SDK and parsed list.
  const counts = result.fields?.filter(f => f.command === 0 && f.fieldType === 210) ?? [];
  if (!counts.length)
    throw recoveryError('RECOVERY_COUNT_MISSING', 'Consulta do terminal nao retornou o campo 210.');
  if (counts.length !== 1 || !/^\d+$/.test(counts[0].buffer) ||
      !Number.isSafeInteger(result.count) || result.count < 0 ||
      Number(counts[0].buffer) !== result.count || result.count !== result.transactions.length)
    throw recoveryError('RECOVERY_COUNT_MISMATCH', 'Contagem e detalhes do terminal divergem. Estado preservado.');
  const identities = new Set();
  for (const p of result.transactions) {
    if (typeof p.fiscalDocument !== 'string' || !p.fiscalDocument.length || p.fiscalDocument.length > 20 ||
        /[\x00-\x1f\x7f]/.test(p.fiscalDocument) || typeof p.fiscalDate !== 'string' || !/^\d{8}$/.test(p.fiscalDate) ||
        typeof p.paymentIndex !== 'string' || !/^\d+$/.test(p.paymentIndex) ||
        (p.functionId !== undefined && (!Number.isInteger(p.functionId) || p.functionId < 0 || p.functionId > 2147483647)))
      throw recoveryError('RECOVERY_SCOPE_MISMATCH', 'Pendencia do terminal sem identidade valida.');
    const identity = JSON.stringify([p.fiscalDocument, p.fiscalDate, p.paymentIndex]);
    if (identities.has(identity))
      throw recoveryError('RECOVERY_SCOPE_MISMATCH', 'Consulta do terminal possui pagamento duplicado.');
    identities.add(identity);
  }
  return {
    queryStatus: result.status, pendingCount: result.count, listedCount: result.transactions.length,
    payments: result.transactions.map(p => ({
      fiscalDocument: p.fiscalDocument, fiscalDate: p.fiscalDate,
      paymentIndex: p.paymentIndex, ...(p.functionId === undefined ? {} : { functionId: p.functionId })
    })),
    outcome: result.count ? 'pending-review-required' : 'no-local-pending-found',
    financialDecision: 'none', journalDisposition: 'preserved'
  };
}
export function summarizeQuery(count, result, scope) {
  if (!Number.isSafeInteger(count) || (count < 0 && count !== -13))
    throw recoveryError('RECOVERY_COUNT_FAILED', 'Contagem nativa invalida ou falhou.');
  if (!Number.isSafeInteger(result?.status) || !Array.isArray(result.transactions))
    throw recoveryError('RECOVERY_QUERY_INVALID', 'Resposta de consulta invalida.');
  if (result.status !== 0) return {
    pendingCount: count, queryStatus: result.status, outcome: 'query-inconclusive',
    financialDecision: 'none', journalDisposition: 'preserved'
  };
  const payments = result.transactions;
  const indices = new Set();
  for (const p of payments) {
    if (p.fiscalDocument !== scope.fiscalDocument || p.fiscalDate !== scope.fiscalDate ||
        !/^\d+$/.test(p.paymentIndex) || indices.has(p.paymentIndex))
      throw recoveryError('RECOVERY_SCOPE_MISMATCH', 'Consulta diverge do cupom/data ou possui indice duplicado.');
    indices.add(p.paymentIndex);
  }
  if ((count >= 0 && count !== payments.length) || (count === -13 && payments.length) ||
      (result.count !== undefined && result.count !== payments.length))
    throw recoveryError('RECOVERY_COUNT_MISMATCH', 'Contagem e detalhes divergem. Estado preservado.');
  return {
    pendingCount: count, queryStatus: result.status, listedCount: payments.length,
    payments: payments.map(p => ({ fiscalDocument: p.fiscalDocument, fiscalDate: p.fiscalDate, paymentIndex: p.paymentIndex })),
    outcome: payments.length > 1 ? 'additional-payments-review-required'
      : payments.length ? 'pending-review-required' : count === -13 ? 'document-not-found' : 'no-local-pending-found',
    financialDecision: 'none', journalDisposition: 'preserved'
  };
}
export async function consultPending(options) {
  return consultRecoveryQuery(options, false);
}
export async function consultTerminalPending(options) {
  return consultRecoveryQuery(options, true);
}
async function consultRecoveryQuery({ snapshot, expected, configuration, directory,
  evidenceDirectory, createTransport, signal }, terminal) {
  requireIdentity(snapshot, expected);
  const scope = recoveryScope(snapshot);
  await assertSnapshot(snapshot);
  if (snapshot.lock) throw recoveryError('RECOVERY_LOCK_PRESENT',
    'Lock existente: consulta bloqueada antes de criar ponte ou carregar DLL. Nao remova automaticamente.');
  if (signal?.aborted) throw recoveryError('RECOVERY_ABORTED', 'Consulta cancelada antes do inicio.');
  await preserveEvidence(snapshot, evidenceDirectory, expected);
  // Same exclusive wx contract as FileJournal, with explicit close-without-unlink
  // on query failure. FileJournal intentionally has no stale-lock recovery API.
  let lease;
  try { lease = await open(snapshot.path + '.lock', 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw recoveryError('RECOVERY_LOCK_PRESENT', 'Outro processo adquiriu o lock. Nenhuma DLL carregada.');
    throw error;
  }
  const ownedLock = Buffer.from(JSON.stringify({
    pid: process.pid, createdAt: new Date().toISOString(), purpose: 'read-only-recovery-query'
  }));
  try { await lease.writeFile(ownedLock); await lease.sync(); }
  catch (error) { await lease.close(); throw error; }
  let raw, client, output, failure, nativeCount, nativeQueryStatus;
  let phase = 'load';
  const readOnlyJournal = {
    acquire: async () => {},
    read: async () => { await assertSnapshot(snapshot, false); return structuredClone(snapshot.record); },
    write: async () => { throw recoveryError('RECOVERY_WRITE_FORBIDDEN', 'Modo consulta nao altera o journal.'); },
    release: async () => {}
  };
  try {
    await assertSnapshot(snapshot, false);
    if (signal?.aborted) throw recoveryError('RECOVERY_ABORTED', 'Consulta cancelada antes do inicio.');
    raw = createTransport();
    const caps = await raw.call('load', {
      libraryPath: join(directory, 'CliSiTef64I.dll'), workingDirectory: directory,
      nativeEncoding: 'windows-1252', testMode: false
    });
    if (caps.protocolVersion !== 1 || caps.platform !== 'windows' || caps.architecture !== 'x86_64' || caps.fieldTypeBytes !== 4)
      throw recoveryError('RECOVERY_BRIDGE_INVALID', 'Ponte incompativel com o exemplo Windows x64.');
    phase = 'configure';
    client = await SitefClient.connect({
      transport: terminal ? terminalQueryTransport(raw, configuration) : queryTransport(raw, configuration, scope), configuration,
      journal: readOnlyJournal, maxSteps: 10000,
      // Queries should not require operator input. Fail closed and drain cancellation.
      interaction: async () => { throw recoveryError('RECOVERY_INTERACTION_UNEXPECTED', 'Consulta solicitou interacao. Nenhum dado fornecido.'); },
      fields: { receiptStoragePolicy: 'explicit-return', nativeEncoding: 'windows-1252' }
    });
    if (client.state !== 'uncertain' || client.recovery?.id !== expected.id)
      throw recoveryError('RECOVERY_STATE_MISMATCH', 'Sessao nao corresponde ao grupo incerto esperado.');
    if (terminal) {
      if (signal?.aborted) throw recoveryError('RECOVERY_ABORTED', 'Consulta cancelada antes dos detalhes.');
      phase = 'query130';
      const result = await client.queryPendingTransactions({ signal });
      if (Number.isSafeInteger(result.status)) nativeQueryStatus = result.status;
      if (Number.isSafeInteger(result.count)) nativeCount = result.count;
      output = summarizeTerminalQuery(result);
    } else {
      if (signal?.aborted) throw recoveryError('RECOVERY_ABORTED', 'Consulta cancelada antes da contagem.');
      phase = 'pendingCount';
      const response = await client.callNative('pendingCount', scope);
      if (Number.isSafeInteger(response.count)) nativeCount = response.count;
      if (!Number.isSafeInteger(response.count) || (response.count < 0 && response.count !== -13))
        throw recoveryError('RECOVERY_COUNT_FAILED', 'Consulta de quantidade falhou. Nenhuma outra chamada sera tentada.');
      if (signal?.aborted) throw recoveryError('RECOVERY_ABORTED', 'Consulta cancelada antes dos detalhes.');
      phase = 'query131';
      const result = await client.queryPendingTransactions({ ...scope, signal });
      if (Number.isSafeInteger(result.status)) nativeQueryStatus = result.status;
      output = summarizeQuery(response.count, result, scope);
    }
  } catch (error) { failure = error; }
  try {
    if (client) await client.close();
    else if (raw) await raw.close();
  } catch (error) { failure ??= error; }
  try {
    await assertSnapshot(snapshot, false);
    if (!(await fileBytes(snapshot.path + '.lock')).equals(ownedLock))
      throw recoveryError('RECOVERY_LOCK_CHANGED', 'Lock mudou durante a consulta. Nao removido.');
    // Never unlink a pathname after a check: another process could replace it
    // between the check and unlink. Even successful queries retain their lock.
    if (output?.queryStatus !== 0 && !failure)
      throw recoveryError('RECOVERY_QUERY_INCONCLUSIVE', 'Consulta inconclusiva. Lock de consulta preservado.');
  } catch (error) { failure ??= error; }
  finally { try { await lease.close(); } catch (error) { failure ??= error; } }
  const report = {
    version: 1, observedAt: new Date().toISOString(), groupId: snapshot.record.id,
    journalSha256: snapshot.hash, phase, pendingCount: nativeCount, queryStatus: nativeQueryStatus,
    journalDisposition: 'preserved', ...output, financialDecision: 'none', lockDisposition: 'preserved-for-review'
  };
  if (failure) {
    report.errorCode = /^[A-Z0-9_]+$/.test(failure.code ?? '') ? failure.code : 'RECOVERY_ERROR';
    if (Number.isSafeInteger(failure.nativeStatus)) report.nativeStatus = failure.nativeStatus;
  }
  try {
    await writeNew(join(evidenceDirectory, 'query-result.json'), JSON.stringify(report, null, 2) + '\n');
    report.reportPersisted = true;
  } catch (error) { failure ??= error; report.reportPersisted = false; }
  if (failure) {
    failure.recoveryReport = report;
    throw failure;
  }
  return report;
}
