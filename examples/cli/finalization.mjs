// The native cycle and the automation's financial decision are separate steps.
// Neither missing input nor a failed decision authorizes a negative finalization.
export function interactiveFinalizationDecision(io, signal) {
  return async (result) => {
    if (signal?.aborted) return 'pending';
    // This is the automation's decision, not an acknowledgement of a printer hook.
    // Displaying receipt text does not fulfill a product's physical obligations.
    io.write('A automacao/operador deve cumprir impressao/entrega e exigencias do produto antes de confirmar.');
    io.write('Exibir o comprovante no terminal nao comprova impressao nem assinatura.');
    if (result?.details?.signatureRequired)
      io.write('O SiTef solicitou assinatura em papel (campo 5074); colete-a antes de confirmar.');
    while (!signal?.aborted) {
      const answer = await io.ask('Finalizacao: 1 confirmar; 2 desfazer; 3 manter pendente [3]: ', { signal });
      if (answer === null || ['', '3', '/cancelar', '/voltar'].includes(answer.trim())) return 'pending';
      if (answer.trim() === '1') return 'confirm';
      if (answer.trim() === '2') return 'undo';
      io.write('Escolha 1, 2 ou 3. Nenhuma decisao foi enviada.');
    }
    return 'pending';
  };
}

export async function decideFinalization(client, input, result, io, { decide, signal } = {}) {
  if (!result || result.status !== 0 || input.functionId === 110 ||
      result.requiresFinalization !== true) return result;
  const transactionId = result.transactionId;
  const decision = !signal?.aborted && decide ? await decide(result) : 'pending';
  // A historical pending payment may keep the aggregate client state uncertain.
  // The decision belongs only to this result; the SDK guards an active native cycle.
  if (signal?.aborted) return result;
  if (decision === 'pending' || decision == null) {
    io.write('Mantida pendente no registro desta execucao. Revise a pendencia; nenhuma decisao foi enviada.');
    return result;
  }
  if (decision !== 'confirm' && decision !== 'undo')
    throw Object.assign(new Error('Decisao de finalizacao invalida; nenhuma finalizacao enviada.'), { code: 'CLI_INVALID_FINALIZATION_DECISION' });
  try {
    if (typeof transactionId !== 'string' || !transactionId)
      throw Object.assign(new Error('Resultado sem identificador da transacao; nenhuma finalizacao enviada.'), { code: 'CLI_TRANSACTION_ID_REQUIRED' });
    if (typeof client.confirm === 'function' && typeof client.undo === 'function')
      await (decision === 'confirm' ? client.confirm() : client.undo());
    else await client.finalizeTransaction(decision === 'confirm', transactionId);
  } catch (error) {
    // Fixed diagnostic text only. No payload, native error message or receipt logging.
    if (decision === 'confirm') {
      if (error.code === 'TRANSACTION_DECISION_REQUIRED')
        io.write('Confirmacao nao enviada: ha falha de interacao, regra objetiva ou politica SDK ainda nao resolvida. Consulte a avaliacao do resultado.');
      else if (error.code === 'MISSING_FIELD_HANDLER')
        io.write('Confirmacao bloqueada: falta handler obrigatorio. Esta CLI nao integra printReceipt nem captureSignature; nao simula impressao ou assinatura.');
      else if (['RECEIPT_RECOVERY_REQUIRED', 'RECEIPT_PRINT_FAILED', 'SIGNATURE_REQUIRED'].includes(error.code))
        io.write('Confirmacao bloqueada: impressao real de comprovante ou captura de assinatura obrigatoria nao concluida.');
      else io.write('Confirmacao nao concluida. Preserve o estado para revisao; nao repita automaticamente.');
    } else io.write('Desfazimento nao concluido. Preserve o estado para revisao; nao repita automaticamente.');
    throw error;
  }
  io.write('Finalizacao ' + (decision === 'confirm' ? 'positiva' : 'negativa') + ' retornou localmente. A API nao informa confirmacao remota.');
  return result;
}
