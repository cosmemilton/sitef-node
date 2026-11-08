import { SitefError } from '../../packages/core/dist/index.js';

const PINPAD_EVENTS = new Map([
  [5001, 'Aguardando senha. Use somente o pinpad, nunca o teclado do computador.'],
  [5018, 'Aguardando senha no pinpad. Use somente o teclado do pinpad.'],
  [5039, 'A coleta da senha no pinpad vai iniciar.'],
  [5042, 'Recursos do pinpad reservados para esta sessao da CLI.'],
  [5043, 'Reserva de recursos do pinpad liberada nesta sessao.'],
  [5051, 'O pinpad informou que a senha foi coletada.']
]);

// VRS-258/260 p.54 requires resource ownership, but specifies no OS API.
// This guard covers this isolated CLI only. It is not a global device mutex:
// no other PDV/app may use the same physical pinpad concurrently.
export function createPinpadResources({ journal, transport, io }) {
  let lease = false;
  let owner;
  const busy = () => new SitefError('CLI_PINPAD_BUSY', 'Recurso reservado ou sem exclusividade da sessao.');
  const identity = context => {
    if (!lease || typeof context?.paymentId !== 'string' || !context.paymentId) throw busy();
    return context.paymentId;
  };
  return {
    journal: journal && {
      async acquire() { await journal.acquire(); lease = true; },
      read: () => journal.read(),
      write: record => journal.write(record),
      async release() {
        if (owner !== undefined) throw busy();
        await journal.release();
        lease = false;
      }
    },
    transport: {
      async call(method, params) {
        // The active iterative cycle owns the device. Reject every auxiliary
        // call or second start, including callers bypassing SitefClient guards.
        if (owner !== undefined && method !== 'continue') throw busy();
        const result = await transport.call(method, params);
        if (!journal && method === 'configure' && result.status === 0) lease = true;
        return result;
      },
      async close() {
        if (owner !== undefined) throw busy();
        await transport.close();
        if (!journal) lease = false;
      }
    },
    hooks: {
      lockResources(_value, context) {
        const id = identity(context);
        if (owner !== undefined && owner !== id) throw busy();
        owner = id;
        return true;
      },
      unlockResources(_value, context) {
        const id = identity(context);
        if (owner !== undefined && owner !== id) throw busy();
        owner = undefined;
        return true;
      }
    },
    onExchange(request) {
      // Fixed event labels only: never read or output native buffer/response.
      if (request.command !== 0) return;
      const label = PINPAD_EVENTS.get(request.fieldType);
      if (label) io.write('[Pinpad ' + request.fieldType + '] ' + label);
    }
  };
}
