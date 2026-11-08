import { join } from 'node:path';
import { BridgeTransport, ClientSitef, SitefError } from '../../packages/core/dist/index.js';
import { createPinpadResources } from './pinpad.mjs';
import { createCallbacks, createSimulatedReceiptPrinter } from './interaction.mjs';

// A fabrica nativa e chamada uma vez por cliente, nunca uma vez por venda.
// Recursos usam exclusividade local; somente a impressao padrao e simulada em tela.
export function cliConnection({ root, directory, configuration, io, createTransport,
  transport, journal, initialState, onStateChange, printReceipt }) {
  let rawTransport;
  let resources;
  const options = {
    bridgeExecutable: join(root ?? directory, 'sitef-bridge.exe'),
    bridgeDirectory: root ?? directory,
    libraryPath: join(directory, 'CliSiTef64I.dll'),
    workingDirectory: directory,
    configuration, initialState, onStateChange, callbacks: createCallbacks(io),
    nativeEncoding: 'windows-1252', testMode: false, timeoutMs: 120000,
    async transportFactory(bridgeOptions) {
      rawTransport = transport ?? (createTransport ? await createTransport(bridgeOptions) : new BridgeTransport(bridgeOptions));
      resources = createPinpadResources({ transport: rawTransport, journal, io });
      return {
        async call(method, params) {
          const response = await resources.transport.call(method, params);
          if (method === 'load' && (response.protocolVersion !== 1 || response.platform !== 'windows' ||
              response.architecture !== 'x86_64' || response.fieldTypeBytes !== 4))
            throw new SitefError('CLI_INCOMPATIBLE_BRIDGE', 'Ponte nativa incompativel com Windows x64.');
          return response;
        },
        close: () => resources.transport.close()
      };
    },
    ...(journal ? { journal: {
      acquire: () => resources.journal.acquire(), read: () => resources.journal.read(),
      write: value => resources.journal.write(value), release: () => resources.journal.release()
    } } : {}),
    onExchange: request => resources.onExchange(request),
    fields: {
      receiptStoragePolicy: 'explicit-return',
      // A automacao decide apos receber o resultado, mantendo as evidencias reais.
      finalizationResponsibility: 'automation',
      hooks: {
        // In this PDV example, completed display is simulated printing; custom hooks win.
        printReceipt: printReceipt ?? createSimulatedReceiptPrinter(io),
        lockResources: (value, context) => resources.hooks.lockResources(value, context),
        unlockResources: (value, context) => resources.hooks.unlockResources(value, context)
      }
    }
  };
  return { options, closeTransport: async () => { await rawTransport?.close(); } };
}

// O helper legado continua retornando SitefClient (transact/finalizeTransaction).
// O main usa ClientSitef.create diretamente para a API orientada a transacoes.
export async function connectClient(options) {
  return (await ClientSitef.create(cliConnection(options).options)).advanced;
}
