'use client';

// Renderer example only. No DLL, filesystem, server configuration or generic RPC methods.
// The Electron preload (or authenticated local-agent client) must implement this allowlist.
import { useEffect, useMemo, useRef } from 'react';
import { CmThemeProvider, CmToastProvider } from 'cosmemilton-ui/client';
import type { UiRequest, UiResponse } from '@cosmemilton/sitef';
import { createSitefModal, SitefModal } from '@cosmemilton/sitef-ui';
import 'cosmemilton-ui/styles.css';

type Event =
  | { type: 'started'; transactionId: string }
  | { type: 'interaction'; transactionId: string; requestId: string; request: UiRequest }
  | { type: 'exchange'; transactionId: string; request: UiRequest }
  | { type: 'ended'; transactionId: string }
  | { type: 'error'; transactionId: string; publicMessage: string };

export interface RestrictedSitefBridge {
  subscribe(listener: (event: Event) => void): () => void;
  respond(value: { transactionId: string; requestId: string; response: UiResponse }): Promise<void>;
  cancel(value: { transactionId: string }): void;
  validateBarcode(value: { transactionId: string; requestId: string; data: string }): Promise<{ status: number; documentType?: number }>;
}

export function ModalRenderer({ bridge }: { bridge: RestrictedSitefBridge }) {
  const current = useRef<{ transactionId: string; signal: AbortController; requestId?: string } | undefined>(undefined);
  const controller = useMemo(() => createSitefModal({
    onCancel() {
      if (current.current) bridge.cancel({ transactionId: current.current.transactionId });
    },
    validateBarcode(data) {
      const session = current.current;
      if (!session?.requestId) return Promise.reject(new Error('Nenhuma coleta ativa.'));
      return bridge.validateBarcode({ transactionId: session.transactionId, requestId: session.requestId, data });
    },
  }), [bridge]);

  useEffect(() => {
    const unsubscribe = bridge.subscribe((event) => {
      if (event.type === 'started') {
        if (current.current) { controller.reportError('Já existe uma transação em andamento.'); return; }
        current.current = { transactionId: event.transactionId, signal: new AbortController() };
        return;
      }
      const session = current.current;
      if (!session || session.transactionId !== event.transactionId) return;
      if (event.type === 'ended') {
        current.current = undefined;
        session.signal.abort();
        controller.complete();
        return;
      }
      if (event.type === 'error') { controller.reportError(event.publicMessage); return; }
      if (event.type === 'exchange') {
        // Main forwards this allowlisted metadata from its onExchange observer only.
        if (event.request.command === 0 && [2470,1121,1126,2355].includes(event.request.fieldType)) {
          try { controller.onExchange(event.request); }
          catch { controller.reportError('A CliSiTef informou metadados de coleta inválidos.'); bridge.cancel({ transactionId: session.transactionId }); }
        }
        return;
      }
      // Commands 0,23 and system-data29 belong in Node. The main process must filter these.
      if ([0, 23, 29].includes(event.request.command)) {
        controller.reportError('O host enviou uma solicitação que deve ser tratada no processo Node.');
        bridge.cancel({ transactionId: session.transactionId });
        return;
      }
      if (session.requestId) {
        controller.reportError('O host enviou duas coletas ao mesmo tempo.');
        bridge.cancel({ transactionId: session.transactionId });
        return;
      }
      session.requestId = event.requestId;
      void controller.handler(event.request, { signal: session.signal.signal }).then(async (response) => {
        if (current.current !== session || session.requestId !== event.requestId) return;
        // Release locally before IPC: the host may emit the next collection before its ack settles.
        session.requestId = undefined;
        await bridge.respond({ transactionId: session.transactionId, requestId: event.requestId, response });
      }).catch(() => {
        if (current.current !== session) return;
        controller.reportError('A interação não pôde ser concluída. O cancelamento foi solicitado ao host.');
        bridge.cancel({ transactionId: session.transactionId });
      }).finally(() => {
        if (session.requestId === event.requestId) session.requestId = undefined;
      });
    });
    return () => {
      unsubscribe();
      const session = current.current;
      current.current = undefined;
      if (session) { bridge.cancel({ transactionId: session.transactionId }); session.signal.abort(); }
    };
  }, [bridge, controller]);

  return <CmThemeProvider><CmToastProvider><SitefModal controller={controller} /></CmToastProvider></CmThemeProvider>;
}

// The host must validate origin/sender, runtime DTO shape, active transaction/request IDs,
// and one reply per request. Command35 alone may call validateBarcode for its own active
// request. A renderer reload/disconnect must request cooperative SDK cancellation and
// preserve the transaction journal; never report success or retry a financial transaction.
