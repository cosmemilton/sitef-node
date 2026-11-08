import { SitefError, validateFieldResponse } from '../../packages/core/dist/index.js';

// Protocol text can contain terminal escapes. Preserve it in the SDK, not terminal control.
export const terminalText = value => String(value).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');

// Attempted/completed IDs only, scoped to a transaction; no receipt text is retained.
// Remember cancelled/failed attempts too: returned partial results must not retry them.
const presentedReceipts = new WeakMap();
export const clearReceiptPresentation = io => presentedReceipts.delete(io);

const receiptLabels = new Map([
  [120, 'autenticacao no verso do cheque'], [121, 'via do cliente'],
  [122, 'via da loja'], [625, 'beneficiario/cedente para impressao em cheque']
]);
function receiptLines(receipt, index) {
  const label = receiptLabels.get(receipt?.fieldType);
  if (!label) return null;
  if (typeof receipt.buffer !== 'string')
    throw new SitefError('CLI_INVALID_RECEIPT_TEXT', 'Comprovante retornado sem texto valido.');
  // Preserve LF, spaces, empty copies, backslashes and original SDK bytes.
  // Terminal controls alone are removed from this local presentation.
  return ['[Comprovante ' + index + ': ' + label + ', campo ' + receipt.fieldType + ']',
    terminalText(receipt.buffer)];
}

// Local, interactive presentation only, never logging or receipt persistence.
// terminalIO refuses redirected streams. Do not reuse this with a logger/file IO.
// Deferred sale presentation does not attest printing or finalize the transaction.
export function displayResultReceipts(result, io, { skipPresented = false } = {}) {
  let displayed = 0;
  for (const receipt of result?.details?.receipts ?? []) {
    if (![121, 122].includes(receipt?.fieldType)) continue;
    if (skipPresented && presentedReceipts.get(io)?.has(receipt.id)) continue;
    for (const line of receiptLines(receipt, ++displayed)) io.write(line);
  }
  return displayed;
}

// Race only the presentation wait, never retry the write. Promise.race also
// observes a late write rejection when cancellation has already won.
async function writeReceiptLine(io, line, signal) {
  if (signal?.aborted) return false;
  let onAbort;
  const aborted = new Promise(resolve => {
    onAbort = () => resolve(false);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const written = Promise.resolve().then(async () => {
      if (signal?.aborted) return false;
      await (io.writeReceipt ?? io.write).call(io, line);
      return !signal?.aborted;
    });
    return await Promise.race([written, aborted]);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

async function presentReceipt(receipt, io, { signal } = {}) {
  if (signal?.aborted) return false;
  let attempts = presentedReceipts.get(io);
  if (!attempts) presentedReceipts.set(io, attempts = new Map());
  if (attempts.has(receipt.id)) return attempts.get(receipt.id).completed;
  const lines = receiptLines(receipt, 1);
  if (!lines) return false;
  const attempt = { completed: false };
  attempts.set(receipt.id, attempt);
  for (const line of [...lines,
    'PDV simulador: no modo padrao, esta exibicao vale como impressao simulada; nao e impressao fisica nem finalizacao.']) {
    if (!await writeReceiptLine(io, line, signal)) return false;
  }
  if (signal?.aborted) return false;
  // Do not repopulate the WeakMap after session cleanup on cancellation.
  attempt.completed = true;
  return true;
}

// Administrative/CB receipts must be presented before the printer/next Continua.
// A custom printer still receives this preview; the default reuses its completion.
export async function displayImmediateReceipt(receipt, io, context) {
  if (receipt.timing === 'immediate') await presentReceipt(receipt, io, context);
}

// CLI-only policy: successful terminal presentation satisfies simulated printing.
// It never changes receipt bytes/flags itself or substitutes for financial approval.
export const createSimulatedReceiptPrinter = io => (receipt, context) =>
  presentReceipt(receipt, io, context);

export function amountText(value, places = 2) {
  const match = /^(\d+)(?:[.,](\d*))?$/.exec(value.trim());
  if (!Number.isInteger(places) || places < 0 || places > 100 || !match ||
      (match[2]?.length ?? 0) > places) throw new Error('Valor decimal invalido, sem separador de milhares.');
  const whole = match[1].replace(/^0+(?=\d)/, '');
  return places ? whole + ',' + (match[2] ?? '').padEnd(places, '0') : whole;
}

// A display mask only: digits without a separator remain whole units (1 -> 1,00).
// Invalid/unfinished input is shown unchanged and rejected by amountText on submit.
export function amountInputView(value, places = 2) {
  if (value === '') return { text: amountText('0', places), cursor: 0 };
  try {
    const text = amountText(value, places);
    const match = /^(\d+)([.,](\d*))?$/.exec(value);
    if (!match) return { text: value, cursor: value.length };
    const wholeLength = text.split(',')[0].length;
    return { text, cursor: wholeLength + (match[2] && places ? 1 + match[3].length : 0) };
  } catch {
    return { text: value, cursor: value.length };
  }
}
export function parseOptions(request) {
  let body = request.buffer;
  if (request.command === 42) {
    const pipe = body.indexOf('|');
    if (pipe < 0) throw new Error('Menu 42 sem classe.');
    body = body.slice(pipe + 1);
  }
  const ids = new Set();
  const options = body.split(';').filter(Boolean).map(row => {
    const first = row.indexOf(':');
    const id = row.slice(0, first);
    if (first < 1 || ids.has(id)) throw new Error('Menu malformado ou com ID duplicado.');
    ids.add(id);
    if (request.command !== 42) return { id, label: row.slice(first + 1) };
    const last = row.lastIndexOf(':'), previous = row.lastIndexOf(':', last - 1);
    if (previous <= first) throw new Error('Menu 42 incompleto.');
    return { id, label: row.slice(first + 1, previous) };
  });
  if (!options.length) throw new Error('Menu vazio.');
  return options;
}

export function createInteraction(io) {
  const show = text => io.write(terminalText(text));
  return async (request, { signal }) => {
    const { command, fieldType, semantic } = request;
    if (signal.aborted) return { continueFlag: -1 };
    if (request.decodingError) throw new SitefError('CLI_NATIVE_DECODING_FAILED', 'Texto nativo com erro de decodificacao; coleta cancelada.');
    if (command === 50) throw new SitefError('CLI_QR_RENDERER_REQUIRED', 'Este fluxo exige exibir QR Code; a CLI nao tem renderizador.');
    if ([1, 2, 3, 4, 15, 52].includes(command)) {
      show('[CliSiTef ' + command + '] ' + request.buffer);
      return {};
    }
    if ([11, 12, 13, 14, 16, 51].includes(command)) {
      show('[CliSiTef ' + command + '] Mensagem anterior encerrada.');
      return {};
    }
    if (![20, 21, 22, 30, 31, 34, 35, 41, 42].includes(command)) {
      throw new SitefError('CLI_UNSUPPORTED_COMMAND', 'Interacao nao implementada: comando ' + command + ', campo ' + fieldType + '.');
    }
    if (semantic?.format === 'S' && command !== 20 &&
        Object.keys(semantic.choices ?? {}).length !== 2)
      throw new SitefError('CLI_AMBIGUOUS_CHOICES', 'Campo SIM/NAO sem mapeamento inequivoco do produto.');
    const menu = [21, 42].includes(command) || ['M', 'Mc'].includes(semantic?.format);
    const choices = menu ? parseOptions(request) : semantic?.choices
      ? Object.entries(semantic.choices).map(([id, label]) => ({ id, label })) : null;
    if (!menu) show('[Campo ' + fieldType + ', comando ' + command + '] ' + request.buffer);
    if (choices) for (const option of choices) show('  ' + option.id + ': ' + option.label);
    if (command === 31) show('Cheque: 0:primeira linha (29 digitos), 1:CMC7 lido, 2:CMC7 digitado.');
    if (command === 35) show('Barras: 0:digitado, 1:lido, 2: cancela esta coleta.');
    // This CLI intentionally shows every keyboard entry, including command 41.
    // SDK sensitivity metadata and protocol validation remain unchanged.
    const visibleMoney = command === 34 && !choices;
    const decimalPlaces = semantic?.decimalPlaces ?? 2;
    if ([30, 31, 34, 35, 41].includes(command))
      show('Limite: ' + request.minLength + '..' + request.maxLength + ' bytes. ' +
        'Entrada visivel.');
    if (visibleMoney) show('Valor decimal: use virgula ou ponto, sem milhares. ' +
      '1 significa ' + amountText('1', decimalPlaces) + '; Enter confirma.');
    for (;;) {
      if (signal.aborted) return { continueFlag: -1 };
      const raw = await io.ask(command === 20 ? 'Confirmar? [s/n]: ' :
        command === 22 ? 'Enter para continuar: ' : choices ? 'ID da opcao: ' : visibleMoney ? 'Valor: ' : 'Dado: ',
        { signal, secret: false, ...(visibleMoney ? { decimalPlaces } : {}) });
      if (raw === null || raw === '/cancelar') return { continueFlag: -1 };
      if (raw === '/voltar') return { continueFlag: 1 };
      let response;
      try {
        if (command === 20) {
          if (!/^(s|n)$/i.test(raw)) throw new Error('Responda s ou n.');
          response = { buffer: raw.toLowerCase() === 's' ? '0' : '1' };
        } else if (command === 22) {
          if (raw !== '') throw new Error('Pressione Enter, /voltar ou /cancelar.');
          response = {};
        } else {
          const buffer = command === 34 || semantic?.format?.startsWith('V')
            ? amountText(raw, semantic?.decimalPlaces ?? 2) : raw;
          response = { buffer };
          if (choices && !choices.some(option => option.id === buffer))
            throw new Error('Selecione um ID exibido no menu.');
          if (semantic?.menuConfirmation) {
            const decision = await io.ask('Confirmar a opcao selecionada? [s/n]: ', { signal });
            if (decision === null || decision === '/cancelar') return { continueFlag: -1 };
            if (decision === '/voltar') return { continueFlag: 1 };
            if (decision?.toLowerCase() !== 's') continue;
            response.confirmed = true;
          }
        }
        validateFieldResponse(request, response, { nativeEncoding: 'windows-1252' });
        return response;
      } catch (error) {
        // Validation messages are fixed protocol descriptions, never the submitted field.
        show('Entrada invalida: ' + error.message);
      }
    }
  };
}

// A apresentacao reutiliza a validacao nativa, mas a fachada distingue cada tipo
// de callback. Eventos internos ja chegam por onExchange, sem exibir seus valores.
export function createCallbacks(io) {
  const interact = createInteraction(io);
  return {
    display: interact,
    menu: interact,
    collect: interact,
    confirm: interact,
    acknowledge: interact,
    qr: interact,
    event() {},
    receipt: (receipt, context) => displayImmediateReceipt(receipt, io, context),
    raw: interact
  };
}
