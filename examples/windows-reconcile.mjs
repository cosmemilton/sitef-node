import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BridgeTransport } from '../packages/core/dist/index.js';
import { developmentRoot, checkDevelopmentFiles } from './windows-cli.mjs';
import { journalPath, inspectJournal, inspectionReport, preserveEvidence, consultPending, consultTerminalPending, recoveryError } from './cli/reconciliation.mjs';

const configuration = { server: '127.0.0.1', storeId: '00000000', terminalId: 'SR000001', reserved: 0 };
export function parseRecoveryArgs(args) {
  const options = { mode: 'inspect' };
  const keys = { '--diretorio': 'root', '--runtime': 'runtime', '--registro': 'recordPath', '--grupo': 'id', '--hash': 'hash', '--evidencias': 'evidenceDirectory' };
  let modeSeen = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    if (['--inspecionar','--preservar-evidencias','--consultar','--consultar-terminal'].includes(arg)) {
      if (modeSeen) throw recoveryError('RECOVERY_ARGUMENTS', 'Escolha um unico modo.');
      modeSeen = true;
      options.mode = { '--inspecionar':'inspect', '--preservar-evidencias':'evidence', '--consultar':'query', '--consultar-terminal':'terminal-query' }[arg];
    } else if (keys[arg] && args[i+1] && !args[i+1].startsWith('--') && options[keys[arg]] === undefined) {
      options[keys[arg]] = args[++i];
    } else throw recoveryError('RECOVERY_ARGUMENTS', 'Argumento nao permitido. Use --help.');
  }
  if (!options.help && options.mode !== 'inspect' && (!options.id || !/^[a-f0-9]{64}$/.test(options.hash ?? '') || !options.evidenceDirectory))
    throw recoveryError('RECOVERY_ARGUMENTS', 'Modo explicito exige --grupo, --hash e --evidencias com pasta nova.');
  if (options.recordPath && !isAbsolute(options.recordPath))
    throw recoveryError('RECOVERY_ARGUMENTS', '--registro precisa ser um caminho absoluto.');
  return options;
}
export async function main(args = process.argv.slice(2)) {
  const options = parseRecoveryArgs(args);
  if (options.help) {
    console.log('Reconciliacao separada. Padrao: apenas ler journal/lock, sem DLL e sem escrita.\n' +
      'node examples/windows-reconcile.mjs [--inspecionar] [--diretorio CAMINHO] [--runtime CAMINHO] [--registro CAMINHO]\n' +
      '--registro escolhe explicitamente um registro de automacao; sem ele, apenas o journal legado.\n' +
      '--preservar-evidencias --grupo ID --hash SHA256 --evidencias PASTA_NOVA\n' +
      '--consultar --grupo ID --hash SHA256 --evidencias PASTA_NOVA\n' +
      '--consultar-terminal --grupo ID --hash SHA256 --evidencias PASTA_NOVA\n' +
      '--consultar usa cupom/data (131); --consultar-terminal lista o terminal (130).\n' +
      'Consulta requer ausencia de lock, cria seu proprio lock e sempre o preserva para revisao.\n' +
      'Nao remove locks antigos, nao finaliza, nao envia mensagens pendentes e nao repete venda.\n' +
      'A consulta executa a DLL escolhida e pode atualizar arquivos internos do fornecedor.\n' +
      'Nenhum resultado libera automaticamente o journal. Use sempre a mesma pasta do terminal.');
    return;
  }
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw recoveryError('RECOVERY_PLATFORM', 'Use Node Windows x64.');
  const root = developmentRoot(process.env.USERPROFILE, options.root);
  const snapshot = await inspectJournal(recoveryJournalPath(root, configuration, options.recordPath), configuration);
  const expected = { id: options.id, hash: options.hash };
  if (options.mode === 'inspect') {
    console.log(JSON.stringify(inspectionReport(snapshot), null, 2));
    console.log('Somente leitura local. PID no lock nao prova processo ativo nem cancelamento.');
    return;
  }
  if (options.mode === 'evidence') {
    const manifest = await preserveEvidence(snapshot, options.evidenceDirectory, expected);
    console.log('Evidencias preservadas e verificadas. Journal e lock originais inalterados.');
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }
  // Lock existente bloqueia antes de verificar arquivos ou criar o processo nativo.
  if (snapshot.lock) throw recoveryError('RECOVERY_LOCK_PRESENT',
    'Consulta bloqueada: lock existente. Nenhuma DLL carregada e nenhum estado alterado.');
  const directory = await checkDevelopmentFiles(root, options.runtime);
  const cancellation = new AbortController();
  const stop = () => cancellation.abort();
  process.on('SIGINT', stop);
  try {
    const query = options.mode === 'terminal-query' ? consultTerminalPending : consultPending;
    const result = await query({
      snapshot, expected, configuration, directory, evidenceDirectory: options.evidenceDirectory,
      signal: cancellation.signal,
      createTransport: () => new BridgeTransport({ executable: join(root, 'sitef-bridge.exe'), cwd: root, timeoutMs: 120000 })
    });
    console.log(JSON.stringify(result, null, 2));
    console.log('Nenhuma finalizacao. Ausencia de pendencia local nao comprova cancelamento remoto.');
  } finally { process.removeListener('SIGINT', stop); }
}
// Never guess the newest run or combine records from different executions.
export function recoveryJournalPath(root, configuration, recordPath) {
  if (recordPath !== undefined && !isAbsolute(recordPath))
    throw recoveryError('RECOVERY_ARGUMENTS', '--registro precisa ser um caminho absoluto.');
  return recordPath ?? journalPath(root, configuration);
}
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()) {
  main().catch(error => {
    // Only the internally constructed, allowlisted metadata report is printable.
    if (error.recoveryReport) console.error(JSON.stringify(error.recoveryReport, null, 2));
    // Do not print native buffers, provider messages, stack traces or receipts.
    console.error('Reconciliacao interrompida: ' + (/^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'RECOVERY_ERROR'));
    console.error('Nenhuma finalizacao ou venda foi solicitada. Preserve journal, lock e evidencias.');
    process.exitCode = 1;
  });
}
