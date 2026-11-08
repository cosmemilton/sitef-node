import { fileURLToPath } from 'node:url';
import { ClientSitef } from '../packages/core/dist/index.js';
import { terminalIO } from './cli/terminal.mjs';
import { collectFunctionInput } from './cli/functions.mjs';
import { cliConnection, connectClient } from './cli/connection.mjs';
import { fiscalInput, runSession, runSimulation } from './cli/session.mjs';
import { HELP, parseArguments, requireWindows, developmentRoot, checkDevelopmentFiles, preflightTerminal } from './cli/runtime.mjs';
import { createAutomationState, warnPreviousState } from './cli/automation-state.mjs';
import { cliErrorLines } from './cli/diagnostics.mjs';

const configuration = {
  server: '127.0.0.1',
  storeId: '00000000',
  terminalId: 'SR000001',
  reserved: 0
};

// Fluxo principal: preparar, abrir um cliente, executar operacoes e fechar ao sair.
export async function main(args = process.argv.slice(2), { createTransport, createIO, printReceipt } = {}) {
  const options = parseArguments(args);
  if (options.help) return console.log(HELP);

  //Verifica se é Windows e se é x64
  requireWindows();

  //Define pasta do usuário
  const root = developmentRoot(process.env.USERPROFILE, options.root);
  const directory = await checkDevelopmentFiles(root, options.runtime);
  console.log('Diretorio da automacao: ' + root);
  console.log('Runtime: ' + directory);
  if (options.verifyOnly) {
    console.log('DLL e ponte encontradas. Origem, dependencias e ambiente simulado nao verificados.');
    console.log('DLL nao carregada; journal nao alterado.');
    return;
  }

  const io = createIO ? createIO() : options.diagnostic ? { write: text => console.log(text) } : terminalIO();
  await warnPreviousState(root, configuration, io);
  //io.write('Host ' + configuration.server + ' | Loja ' + configuration.storeId + ' | Terminal ' + configuration.terminalId);
  //io.write('A CLI nao identifica o ambiente; use configuracao e biblioteca autorizadas.');
  //io.write('Senha do cartao somente no pinpad. Comprovantes 121/122 aparecem apenas no terminal; seus textos nao sao gravados.');

  // O primeiro menu permite sair antes de carregar/configurar a biblioteca.
  let input;
  if (!options.diagnostic) {
    const selection = await collectFunctionInput(io, options.functionId);
    if (!selection) return;
    input = fiscalInput(selection.amount, selection.functionId);
  }

  const state = await createAutomationState(root);
  io.write('Registro desta execucao: ' + state.path);
  let failure;
  try {
    const connection = cliConnection({ root, directory, configuration, io,
      createTransport, printReceipt, onStateChange: state.onStateChange });
    const client = await ClientSitef.create(connection.options);
    // Mesmo cliente em todos os menus; runSession fecha somente ao sair/errar.
    // --funcao preserva a execucao unica; sem a flag, volta ao menu de funcoes.
    await runSession({ client, input, io, diagnostic: options.diagnostic,
      repeat: options.functionId === undefined, closeTransport: connection.closeTransport });
  } catch (error) { failure = error; }
  try { await state.close(); } catch (error) { failure ??= error; }
  if (failure) throw failure;
}

// Compatibilidade dos imports anteriores; os detalhes ficam em modulos pequenos.
export { connectClient, fiscalInput, runSession, runSimulation,
  developmentRoot, checkDevelopmentFiles, preflightTerminal, cliErrorLines };

// Importar este arquivo nao inicia o programa.
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()) {
  main().catch(error => {
    for (const line of cliErrorLines(error)) console.error(line);
    process.exitCode = 1;
  });
}
