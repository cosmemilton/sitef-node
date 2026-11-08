import { classifyReturn } from '../../packages/core/dist/index.js';
import { collectFunctionInput } from './functions.mjs';
import { createCallbacks, displayResultReceipts, clearReceiptPresentation } from './interaction.mjs';
import { decideFinalization, interactiveFinalizationDecision } from './finalization.mjs';

// Uma sessao da aplicacao pode conter varias transacoes, inclusive pendentes.
// Nenhum resultado, cancelamento ou fechamento autoriza finalizacao automatica.
export async function runSession({ client, transport, closeTransport, input, io,
  diagnostic = false, repeat = false }) {
  const cancellation = new AbortController();
  let active;
  const stop = () => {
    if (cancellation.signal.aborted) return;
    io.write('Cancelamento solicitado. Aguardando encerramento da CliSiTef.');
    cancellation.abort();
    if (active) active.cancel();
  };
  process.on('SIGINT', stop);
  let failure;
  try {
    if (diagnostic) {
      const present = await (client.advanced ?? client).callNative('pinpadPresent');
      io.write('Pinpad: ' + classifyReturn(present.status, 'pinpad-presence').message + ' (' + present.status + ')');
    } else {
      const documents = new Set();
      while (input && !cancellation.signal.aborted) {
        documents.add(input.fiscalDocument);
        const tx = transactionFor(client, input, cancellation.signal);
        active = tx;
        try {
          await usingTransaction(tx, async () => {
            const result = await processTransaction(tx, input, io);
            await decideFinalization(tx, input, result, io, {
              signal: cancellation.signal,
              decide: interactiveFinalizationDecision(io, cancellation.signal)
            });
          });
        } finally {
          active = undefined;
        }
        if (!repeat || cancellation.signal.aborted) break;
        const selection = await collectFunctionInput(io, undefined, { signal: cancellation.signal });
        if (!selection) break;
        input = fiscalInput(selection.amount, selection.functionId);
        // Dois menus muito rapidos nao podem reutilizar o cupom anterior.
        while (documents.has(input.fiscalDocument))
          input.fiscalDocument = String((BigInt(input.fiscalDocument) + 1n) % 10000000000n).padStart(10, '0');
      }
    }
  } catch (error) { failure = error; }

  try {
    await client.close();
  } catch (error) {
    failure ??= error;
    io.write('Sessao nao encerrada normalmente. Preserve o registro e revise o estado; nao repita automaticamente.');
    try { await (closeTransport ? closeTransport() : transport?.close()); } catch {}
  } finally {
    process.removeListener('SIGINT', stop);
  }
  if (failure) throw failure;
}

// Cupom, data e hora deste exemplo. Uma automacao real usa seus dados fiscais.
export function fiscalInput(amount, functionId = 0, now = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return {
    functionId, amount,
    fiscalDocument: String(now.getTime()).slice(-10),
    fiscalDate: String(now.getFullYear()) + pad(now.getMonth() + 1) + pad(now.getDate()),
    fiscalTime: pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()),
    operator: 'DEV', additionalParameters: ''
  };
}

// Nome legado: nao ativa nem comprova ambiente simulado; nao toma decisao financeira.
export async function runSimulation(client, input, io, signal) {
  if (signal?.aborted) return;
  const tx = transactionFor(client, input, signal);
  return usingTransaction(tx, () => processTransaction(tx, input, io));
}

async function processTransaction(tx, input, io) {
  try {
    const result = await tx.process(createCallbacks(io));
    io.write('Retorno ' + result.status + ': ' + classifyReturn(result.status).message);
    const ids = [...new Set((result.fields ?? []).map(field => field.fieldType).filter(Number.isInteger))];
    io.write('Campos retornados: ' + (result.fields?.length ?? 0) + '; IDs: ' + (ids.join(', ') || 'nenhum') + '. Demais valores ficam disponiveis ao chamador.');
    displayResultReceipts(result, io, { skipPresented: true });
    if (result.requiresFinalization && input.functionId === 110)
      io.write('Resultado gerencial com comprovante/recibo exige classificacao local. Isso nao comprova pendencia no SiTef; nenhuma finalizacao enviada.');
    else if (result.requiresFinalization)
      io.write('Resultado requer finalizacao. Dados disponiveis ao chamador; nenhuma decisao enviada.');
    return result;
  } finally { clearReceiptPresentation(io); }
}

function transactionFor(client, input, signal) {
  const options = { signal, ...(input.functionId === 110 ? { requiresFinalization: 'review-receipts' } : {}) };
  if (typeof client.createTransaction === 'function') return client.createTransaction(input, options);
  // Adaptador apenas para imports antigos que fornecem o SitefClient de baixo nivel.
  let transactionId;
  return {
    async process() {
      const result = await client.transact(input, options);
      transactionId = result.transactionId;
      return result;
    },
    confirm: () => client.finalizeTransaction(true, transactionId),
    undo: () => client.finalizeTransaction(false, transactionId),
    cancel: () => client.cancel(),
    dispose() {}
  };
}

// Dispose libera apenas referencias locais e nunca substitui a falha original.
async function usingTransaction(tx, action) {
  let result, failure;
  try { result = await action(); } catch (error) { failure = error; }
  try { tx.dispose(); } catch (error) { failure ??= error; }
  if (failure) throw failure;
  return result;
}
