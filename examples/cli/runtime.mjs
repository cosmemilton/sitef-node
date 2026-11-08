import { createHash } from 'node:crypto';
import { stat, lstat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { FileJournal } from '../../packages/core/dist/index.js';
import { testFunction } from './functions.mjs';

export const HELP = `CLI CliSiTef Windows x64.
node examples/windows-cli.mjs [--verificar | --diagnostico] [--funcao NUMERO]
  [--diretorio CAMINHO] [--runtime CAMINHO]
Padroes: 127.0.0.1 / 00000000 / SR000001. Pinpad configurado no INI do runtime.
Menu: 0, 2, 3, 110, 111, 122 e 123; retorna ao menu apos cada operacao.
--funcao pula o menu local, executa uma unica operacao e encerra.
O cliente carrega/configura uma vez e fecha ao sair, sem finalizar pendencias.
Valor e coletas interativos. /voltar, /cancelar, Esc ou Ctrl+C.
Apos sucesso pendente: confirmar, desfazer ou manter pendente.
--verificar confere arquivos sem carregar a DLL nem alterar o journal.
--diagnostico carrega a DLL e consulta a presenca do pinpad, sem venda.
--runtime escolhe a pasta das DLLs; registros novos ficam em --diretorio/state/automation.
Pendencias e locks anteriores geram avisos, sem bloquear uma nova operacao.
Sem hashes fixos: a CLI nao comprova origem da biblioteca nem ambiente simulado.
Use configuracao e bibliotecas autorizadas. Nao compartilhe o terminal com outro PDV.`;

export function parseArguments(args) {
  if (args.includes('--help') || args.includes('-h')) return { help: true };
  const options = { diagnostic: false, verifyOnly: false };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--diagnostico') options.diagnostic = true;
    else if (flag === '--verificar') options.verifyOnly = true;
    else if (['--diretorio', '--runtime', '--funcao'].includes(flag)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error('Falta valor para ' + flag + '. Use --help.');
      if (flag === '--diretorio') options.root = value;
      else if (flag === '--runtime') options.runtime = value;
      else {
        if (!/^\d+$/.test(value)) throw new Error('--funcao precisa ser um numero do menu.');
        options.functionId = Number(value);
        testFunction(options.functionId);
      }
    } else throw new Error('Argumento desconhecido. Use --help.');
  }
  return options;
}

export function requireWindows(platform = process.platform, architecture = process.arch) {
  if (platform !== 'win32' || architecture !== 'x64')
    throw new Error('Esta CLI requer Node Windows x64, nao Node WSL.');
}

// Identifica o terminal, nao a versao da DLL. Atualizar o runtime nao muda o journal.
export function journalPath(root, configuration) {
  const key = createHash('sha256').update(configuration.storeId + '\0' + configuration.terminalId).digest('hex');
  return join(root, 'state', key + '.journal.json');
}

// Apenas existencia/acesso dos dois arquivos principais. Dependencias e INI sao do integrador.
// Nenhum arquivo e executado aqui e nenhum hash, assinatura ou modo simulado e validado.
export async function checkDevelopmentFiles(root, runtimeDirectory) {
  const directory = runtimeDirectory ?? join(root, 'runtime', '7.0.117.123.r2-win64');
  if (!isAbsolute(directory)) throw new Error('--runtime precisa ser um caminho absoluto.');
  await requireFile(join(directory, 'CliSiTef64I.dll'), 'RUNTIME_FILE_MISSING', 'Biblioteca Windows');
  await requireFile(join(root, 'sitef-bridge.exe'), 'BRIDGE_FILE_MISSING', 'Ponte Windows');
  return directory;
}

async function requireFile(path, code, label) {
  try {
    if (!(await stat(path)).isFile()) throw new Error('Not a file');
  } catch {
    throw Object.assign(new Error(label + ' nao encontrada ou inacessivel: ' + path),
      { code, path, stage: 'preflight' });
  }
}
export function developmentRoot(profileDirectory = process.env.USERPROFILE, explicitRoot) {
  if (explicitRoot) {
    if (!isAbsolute(explicitRoot)) throw new Error('--diretorio precisa ser um caminho absoluto.');
    return explicitRoot;
  }
  if (!profileDirectory) throw new Error('USERPROFILE indisponivel. Informe --diretorio com a pasta preparada.');
  return join(profileDirectory, 'Documents', 'SiTefDevelopment');
}

// Compatibilidade de import: o preflight agora so retorna avisos de leitura.
// Nenhum lock ou registro pendente e removido, adquirido ou reescrito aqui.
export async function preflightTerminal(journalFile) {
  const warnings = [];
  try {
    await lstat(journalFile + '.lock');
    warnings.push({ code: 'RECORD_LOCK_PRESENT', path: journalFile });
  } catch (error) {
    if (error.code !== 'ENOENT') warnings.push({ code: 'RECORD_LOCK_UNREADABLE', path: journalFile });
  }
  let record;
  try {
    const info = await lstat(journalFile);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Invalid record file');
    record = await new FileJournal(journalFile).read();
  } catch (error) {
    if (error.code !== 'ENOENT') warnings.push({ code: 'RECORD_INVALID', path: journalFile });
  }
  if (record?.payments.some(payment => !['ended', 'finalized-local'].includes(payment.state)))
    warnings.push({ code: 'RECORD_PENDING', path: journalFile });
  return warnings;
}
