import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ClientSitef, classifyReturn } from '../packages/core/dist/index.js';
import { terminalIO } from './cli/terminal.mjs';
import { collectFunctionInput } from './cli/functions.mjs';
import { cliConnection } from './cli/connection.mjs';
import { createCallbacks, createSimulatedReceiptPrinter, clearReceiptPresentation } from './cli/interaction.mjs';
import { interactiveFinalizationDecision } from './cli/finalization.mjs';
import { requireWindows, developmentRoot } from './cli/runtime.mjs';
import { createAutomationState } from './cli/automation-state.mjs';
import { cliErrorLines } from './cli/diagnostics.mjs';

const configuration = {
  server:  '127.0.0.1',
  storeId:  '00000000',
  terminalId: 'SR000001',
  reserved: 0,
  additionalParameters:  ''
};

// Inicializar -> escolher operacao -> processar -> decidir -> encerrar.
export async function main({ env = process.env, createIO = terminalIO, createTransport } = {}) {
  requireWindows();
  const io = createIO();
  const root = developmentRoot(env.USERPROFILE, env.SITEF_ROOT);
  const directory = env.SITEF_RUNTIME ?? join(root, 'runtime', '7.0.117.123.r2-win64');

  const callbacks = createCallbacks(io);
  const displayReceipt = createSimulatedReceiptPrinter(io);
  const cancellation = new AbortController(), signal = cancellation.signal;
  const documents = new Set();
  let client, connection, state, transaction, result, failure;
  const stop = () => { cancellation.abort(); transaction?.cancel(); };
  process.on('SIGINT', stop);

  try {
    // A automacao guarda apenas metadados; nao altera registros anteriores.
    state = await createAutomationState(root);
    io.write('Registro desta execucao: ' + state.path);
    connection = cliConnection({ root, directory, configuration, io,
      createTransport, onStateChange: state.onStateChange });
    // A DLL e carregada/configurada aqui, uma vez, antes do primeiro menu.
    client = await ClientSitef.create({ ...connection.options,
      initialPinpadMessage: env.SITEF_PINPAD_MESSAGE });

    while (!signal.aborted) {
      const selection = await collectFunctionInput(io, undefined, { signal });
      if (!selection) break;
      const input = transactionInput(selection, env, documents);
      transaction = client.createTransaction(input, { signal,
        ...(input.functionId === 110 ? { requiresFinalization: 'review-receipts' } : {}) });
      result = await transaction.process(callbacks);
      io.write('Retorno ' + result.status + ': ' + classifyReturn(result.status).message);
      // Todos os campos e bytes ficam em result.data, sem despeja-los no console.
      // Exibir e impressao simulada neste exemplo; nao duplica as vias ja exibidas.
      for (const receipt of result.details.receipts) {
        if (!await displayReceipt(receipt, { signal }) && !signal.aborted)
          throw Object.assign(new Error('Exibicao do comprovante nao concluida.'), { code: 'CLI_RECEIPT_DISPLAY_FAILED' });
      }

      // A automacao decide. O menu gerencial 110 nao e finalizado genericamente.
      if (result.status === 0 && result.requiresFinalization && input.functionId !== 110 && !signal.aborted) {
        const decision = await interactiveFinalizationDecision(io, signal)(result);
        if (!signal.aborted && decision === 'confirm') {
          await transaction.confirm();
          io.write('Confirmacao retornou localmente.');
        } else if (!signal.aborted && decision === 'undo') {
          await transaction.undo();
          io.write('Desfazimento retornou localmente.');
        } else io.write('Mantida pendente; nenhuma finalizacao enviada.');
      }
      transaction.dispose(); // Libera referencias, sem decidir pendencias.
      transaction = undefined;
      clearReceiptPresentation(io);
    }
  } catch (error) { failure = error; }
  finally {
    // Encerrar tambem em erro/Ctrl+C. Nunca repetir, confirmar ou desfazer aqui.
    try { transaction?.dispose(); } catch (error) { failure ??= error; }
    clearReceiptPresentation(io);
    try {
      if (client) await client.close();
      else if (failure?.cleanupFailed) await connection?.closeTransport();
    }
    catch (error) {
      failure ??= error;
      try { io.write('Falha ao encerrar; preserve o registro e nao repita automaticamente.'); } catch {}
      if (client) try { await connection?.closeTransport(); } catch {}
    }
    try { await state?.close(); } catch (error) { failure ??= error; }
    process.removeListener('SIGINT', stop);
  }
  if (failure) throw failure;
  return result;
}

// Dados fiscais do exemplo. Em producao, use os dados da venda do PDV.
export function transactionInput(selection, env, documents, now = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  let fiscalDocument = String(now.getTime()).slice(-10);
  while (documents.has(fiscalDocument))
    fiscalDocument = String((BigInt(fiscalDocument) + 1n) % 10000000000n).padStart(10, '0');
  documents.add(fiscalDocument);
  return { ...selection, fiscalDocument,
    fiscalDate: String(now.getFullYear()) + pad(now.getMonth() + 1) + pad(now.getDate()),
    fiscalTime: pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()),
    operator: env.SITEF_OPERATOR ?? 'DEV', additionalParameters: env.SITEF_TRANSACTION_PARAMS ?? '' };
}

// Importar nao executa. Recusa flags antigas para nao carregar a DLL por engano.
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()) {
  const run = process.argv.length > 2
    ? Promise.reject(new Error('O exemplo simples nao aceita opcoes; a DLL e carregada na inicializacao.'))
    : main();
  run.catch(error => {
    for (const line of cliErrorLines(error)) console.error(line);
    process.exitCode = 1;
  });
}
