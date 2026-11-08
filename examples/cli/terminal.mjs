import { emitKeypressEvents } from 'node:readline';
import { terminalText, amountInputView } from './interaction.mjs';

export function terminalIO(input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY)
    throw new Error('Use um terminal interativo Windows. Redirecionamento de entrada/saida nao e permitido.');
  emitKeypressEvents(input);
  let active = false;
  return {
    write(text) { output.write(terminalText(text) + '\n'); },
    // Receipts attest completion only after the stream's write callback succeeds.
    // Keep the existing synchronous write contract for prompts and other output.
    writeReceipt(text) {
      return new Promise((resolve, reject) => {
        const cleanup = () => output.removeListener?.('error', onError);
        const onError = error => { cleanup(); reject(error); };
        output.once?.('error', onError);
        try {
          output.write(terminalText(text) + '\n', error => {
            if (error) {
              reject(error);
              // Writable emits 'error' after a failed write callback. Observe it
              // too, without leaving a listener behind on custom stream doubles.
              setImmediate(cleanup);
            } else { cleanup(); resolve(); }
          });
        } catch (error) { cleanup(); reject(error); }
      });
    },
    ask(prompt, { signal, decimalPlaces } = {}) {
      if (active) return Promise.reject(new Error('Ja existe uma coleta ativa.'));
      if (signal?.aborted) return Promise.resolve(null);
      // Keyboard input is always visible in this CLI; no hidden-input mode exists.
      const money = Number.isInteger(decimalPlaces) && decimalPlaces >= 0 && decimalPlaces <= 100;
      const safePrompt = terminalText(prompt);
      active = true;
      if (!money) output.write(safePrompt);
      return new Promise(resolve => {
        let value = '';
        const previousRaw = input.isRaw;
        let settled = false;
        // Keep the decimal separator and zero padding visible while editing. The
        // returned value is still the operator's input; protocol validation owns
        // normalization and byte limits, never this display function.
        const redrawMoney = (complete = false) => {
          const view = amountInputView(value, decimalPlaces);
          // One physical line, including narrow terminals and long exact values.
          // '<' / '>' indicate offscreen text; they never enter the returned data.
          const ascii = /^[\x20-\x7e]*$/.test(view.text);
          // Invalid non-ASCII input is still visible; protocol validation rejects it on submit.
          if (!ascii) { output.write('\r\x1b[2K' + safePrompt + terminalText(view.text)); return; }
          const text = view.text;
          const cursor = safePrompt.length + (!complete ? view.cursor : text.length);
          const line = safePrompt + text;
          const columns = Number.isInteger(output.columns) && output.columns > 1 ? output.columns : 80;
          const width = columns - 1; // Avoid the terminal's right-edge auto-wrap.
          const start = Math.max(0, cursor - width + 1);
          let shown = line.slice(start, start + width);
          if (start > 0 && shown.length) shown = '<' + shown.slice(1);
          if (start + width < line.length && shown.length) shown = shown.slice(0, -1) + '>';
          output.write('\r\x1b[2K' + shown);
          const tail = shown.length - (cursor - start);
          if (tail > 0) output.write('\x1b[' + tail + 'D');
        };
        if (money) redrawMoney();
        const done = result => {
          if (settled) return;
          settled = true;
          input.removeListener('keypress', keypress);
          input.removeListener('end', aborted);
          input.removeListener('close', aborted);
          signal?.removeEventListener('abort', aborted);
          input.setRawMode(previousRaw ?? false);
          input.pause();
          active = false;
          if (money) redrawMoney(true);
          output.write('\n');
          resolve(result);
        };
        const aborted = () => done(null);
        const keypress = (text, key = {}) => {
          if ((key.ctrl && ['c', 'd', 'z'].includes(key.name)) || key.name === 'escape') return done(null);
          if (key.name === 'return' || key.name === 'enter') return done(value);
          if (key.name === 'backspace') {
            if (value) {
              value = Array.from(value).slice(0, -1).join('');
              if (money) redrawMoney(); else output.write('\b \b');
            }
            return;
          }
          if (key.ctrl || key.meta || !text || /[\x00-\x1f\x7f-\x9f]/.test(text)) return;
          if (value.length + text.length > 20000) return;
          value += text;
          if (money) redrawMoney();
          else output.write(text);
        };
        input.on('keypress', keypress);
        input.once('end', aborted);
        input.once('close', aborted);
        signal?.addEventListener('abort', aborted, { once: true });
        input.setRawMode(true);
        input.resume();
      });
    }
  };
}
