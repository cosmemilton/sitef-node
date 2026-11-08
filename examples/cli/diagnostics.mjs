import { classifyReturn, sanitizeInteractionFailure } from '../../packages/core/dist/index.js';

// Diagnosticos sem valores de campos, comprovantes ou stderr nativo.
export function cliErrorLines(error) {
  const lines = ['Falha na CLI: ' + (error.code ?? 'CLI_ERROR')];
  if (error.cleanupFailed === true)
    lines.push('O encerramento dos recursos nao foi comprovado. Revise a instancia anterior antes de abrir outra; nao repita automaticamente.');
  if (error.code === 'CLI_ADMIN_REVIEW_REQUIRED') {
    lines.push('O fluxo gerencial retornou comprovante/recibo, mas isso nao identifica novo pagamento.');
    lines.push('Registro local preservado para revisao. Nenhuma finalizacao automatica foi feita.');
    lines.push('Identifique a operacao e consulte pendencias antes de decidir sua finalizacao.');
  } else if (error.code === 'INTERACTION_FAILED') {
    lines.push('INTERACTION_FAILED identifica uma falha local da aplicacao, nao um codigo da DLL.');
    const detail = sanitizeInteractionFailure(error.interactionFailure);
    const stages = {
      'process-field': 'processamento do campo/evento',
      'on-exchange': 'notificacao de evento',
      'interaction': 'callback de interacao',
      'validate-response': 'validacao da resposta',
      'cleanup': 'liberacao de recursos',
      'finish': 'avaliacao do resultado'
    };
    if (detail) {
      lines.push('Etapa: ' + stages[detail.stage] + '; causa: ' + detail.reasonCode + '.');
      if (detail.reasonCode === 'CLI_QR_RENDERER_REQUIRED')
        lines.push('O SiTef pediu QR Code na tela. A CLI nao possui renderizador; o fluxo foi interrompido sem expor a string do QR.');
      if (detail.reasonCode === 'MISSING_FIELD_HANDLER' && detail.command === 0 && [120, 121, 122, 625].includes(detail.fieldType))
        lines.push('Este fluxo exige impressao imediata antes de continuar. A previa no console nao a confirma. Forneca printReceipt com o resultado real; sem ele, a CLI cancela o ciclo e preserva os dados recebidos.');
      const parts = [];
      if (detail.command !== undefined) parts.push('comando ' + detail.command);
      if (detail.fieldType !== undefined) parts.push('campo ' + detail.fieldType);
      if (parts.length) lines.push('Contexto seguro: ' + parts.join(', ') + '.');
    } else lines.push('O erro nao contem metadados suficientes para identificar a etapa.');
    if (Number.isInteger(error.nativeStatus) && error.nativeStatus >= -2147483648 && error.nativeStatus <= 2147483647) {
      const message = error.nativeStatus === -2 ? 'Operacao cancelada pelo operador.' : classifyReturn(error.nativeStatus).message;
      lines.push('Retorno nativo ' + error.nativeStatus + ': ' + message);
    }
    lines.push('Nao e possivel concluir falha na senha por este codigo. Senha do cartao somente no pinpad.');
    lines.push('Nao repita automaticamente. Inspecione o journal; reconcilie se houver estado pendente/incerto.');
  } else if (error.stage === 'terminal-preflight' || error.code === 'TERMINAL_LOCKED') {
    lines.push(error.code === 'TERMINAL_LOCKED'
      ? 'Registro bloqueado para escrita: seu lock pode estar ativo ou precisar de revisao. Isso nao e uma trava global do terminal.'
      : 'Registro invalido ou inacessivel: revise o arquivo selecionado.');
    lines.push('Nao apague o lock nem o journal. Este aviso nao comprova o estado remoto.');
    lines.push('Use examples/windows-reconcile.mjs --inspecionar para consultar o estado somente em leitura.');
  } else if (error.stage === 'preflight') {
    lines.push(error.message);
    lines.push('Falha na preparacao, antes de carregar a DLL. Nenhuma operacao foi iniciada por esta execucao.');
    lines.push('Confira --diretorio e execute --verificar para validar os arquivos sem acessar o pinpad.');
  } else {
    if (!error.code) lines.push(error.message ?? 'Erro nao identificado.');
    lines.push('Se houve operacao iniciada, nao a repita apos timeout/crash. Preserve o journal e reconcilie o estado.');
  }
  return lines;
}
