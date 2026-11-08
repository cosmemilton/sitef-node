import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { BridgeTransport, ClientSitef, classifyReturn } from '../packages/core/dist/index.js';
import { terminalIO } from './cli/terminal.mjs';
import { collectFunctionInput } from './cli/functions.mjs';
import { createPinpadResources } from './cli/pinpad.mjs';
import { createCallbacks, createSimulatedReceiptPrinter, clearReceiptPresentation } from './cli/interaction.mjs';
import { interactiveFinalizationDecision } from './cli/finalization.mjs';
import { requireWindows, developmentRoot } from './cli/runtime.mjs';
import { createAutomationState } from './cli/automation-state.mjs';
import { cliErrorLines } from './cli/diagnostics.mjs';

const PINPAD_MESSAGE = 'CAIXA DISPONIVEL';

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

  const pinpadMessage = env.SITEF_PINPAD_MESSAGE ?? PINPAD_MESSAGE;
  const callbacks = createCallbacks(io);
  const displayReceipt = createSimulatedReceiptPrinter(io);
  const cancellation = new AbortController(), signal = cancellation.signal;
  const documents = new Set();
  let client, rawTransport, resources, state, transaction, result, failure;
  const stop = () => { cancellation.abort(); transaction?.cancel(); };
  process.on('SIGINT', stop);

  try {
    // A automacao guarda apenas metadados; nao altera registros anteriores.
    state = await createAutomationState(root);
    io.write('Registro desta execucao: ' + state.path);
    // O componente encontra e inicia a bridge do pacote da plataforma.
    // A automacao informa apenas seu kit CliSiTef e a configuracao do terminal.
    client = await ClientSitef.create({
      libraryPath: join(directory, 'CliSiTef64I.dll'),
      workingDirectory: directory,
      configuration,
      callbacks,
      onStateChange: state.onStateChange,
      initialPinpadMessage: pinpadMessage,
      // Preserva a exclusividade do pinpad e permite transporte sintetico nos testes.
      async transportFactory(options) {
        rawTransport = createTransport ? await createTransport(options) : new BridgeTransport(options);
        resources = createPinpadResources({ transport: rawTransport, io });
        return resources.transport;
      },
      onExchange: request => resources.onExchange(request),
      fields: {
        finalizationResponsibility: 'automation',
        receiptStoragePolicy: 'explicit-return',
        hooks: {
          printReceipt: displayReceipt,
          lockResources: (value, context) => resources.hooks.lockResources(value, context),
          unlockResources: (value, context) => resources.hooks.unlockResources(value, context)
        }
      }
    });

    while (!signal.aborted) {
      const selection = await collectFunctionInput(io, undefined, { signal });
      if (!selection) break;
      const input = transactionInput(selection, env, documents);
      transaction = client.createTransaction(input, { signal,
        ...(input.functionId === 110 ? { requiresFinalization: 'review-receipts' } : {}) });
      let transactionFailed = false;
      try {
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
      } catch (error) {
        transactionFailed = true;
        throw error;
      } finally {
        // Somente depois do ciclo/decisao, nunca em sessao ativa ou incerta.
        if (['idle', 'awaiting-finalization'].includes(client.state)) {
          try {
            const { status } = await client.escreverMensagemPinpad(pinpadMessage);
            if (status !== 0)
              io.write('Mensagem do pinpad nao restaurada. Retorno nativo: ' + status);
          } catch (error) {
            // Nao substituir a falha original da transacao por uma falha auxiliar.
            if (!transactionFailed) throw error;
            try { io.write('Falha ao restaurar mensagem do pinpad; erro original da transacao preservado.'); } catch {}
          }
        } else {
          try { io.write('Mensagem do pinpad nao restaurada: sessao indisponivel ou incerta.'); } catch {}
        }
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
      else if (failure?.cleanupFailed) await rawTransport?.close();
    }
    catch (error) {
      failure ??= error;
      try { io.write('Falha ao encerrar; preserve o registro e nao repita automaticamente.'); } catch {}
      if (client) try { await rawTransport?.close(); } catch {}
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
