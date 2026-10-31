'use client';

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent
} from 'react';
import {
  CmButton,
  CmDialog,
  CmInput,
  CmQrCode,
  CmToastNotice
} from 'cosmemilton-ui/client';
import type { UiResponse } from '@cosmemilton/sitef';
import type { SitefModalController } from './controller.js';

export interface SitefModalProps {
  controller: SitefModalController;
  title?: string;
}

/** Mount inside CmThemeProvider + CmToastProvider; import cosmemilton-ui/styles.css once. */
export function SitefModal({
  controller,
  title = 'Pagamento SiTef'
}: SitefModalProps) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  const [value, setValue] = useState('');
  const [collectionMode, setCollectionMode] = useState('0');
  const input = useRef<HTMLInputElement>(null);
  const primaryAction = useRef<HTMLButtonElement>(null);
  const pending = state.pending;
  const command = pending?.request.command;
  const semantic = pending?.request.semantic;
  const format = semantic?.format;
  const menu =
    command === 21 || command === 42 || format === 'M' || format === 'Mc';
  const protectedInput = command === 41 || semantic?.sensitive === true;
  const decimalPlaces = semantic?.decimalPlaces ?? state.decimalPlaces;
  useEffect(() => {
    setValue('');
    setCollectionMode('0');
    if (input.current) input.current.focus();
    else primaryAction.current?.focus();
  }, [pending?.id, pending?.confirming]);
  const respond = (response: UiResponse) => {
    if (!pending) return;
    try {
      void Promise.resolve(controller.respond(response, pending.id)).catch(
        (error: unknown) =>
          controller.reportError(
            error instanceof Error
              ? error.message
              : 'Não foi possível enviar a resposta.'
          )
      );
    } catch (error) {
      controller.reportError(
        error instanceof Error
          ? error.message
          : 'Não foi possível enviar a resposta.'
      );
    }
  };
  const sendInput = (event: FormEvent) => {
    event.preventDefault();
    const buffer =
      command === 31 || command === 35 ? `${collectionMode}:${value}` : value;
    respond({ buffer });
  };
  const isInput =
    command !== undefined &&
    [30, 31, 34, 35, 41].includes(command) &&
    !pending?.options;
  const collection = command === 31 || command === 35;
  return (
    <>
      {state.notice ? (
        <CmToastNotice
          key={state.notice.id}
          description={state.notice.message}
          tone={state.notice.tone}
        />
      ) : null}
      <CmDialog
        open={state.open}
        onClose={() => controller.cancel()}
        title={state.title || title}
        presentation="compact"
        size="md"
        portal
        dismissible={false}
        showClose={false}
        initialFocusRef={input}
        footer={
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              justifyContent: 'flex-end',
              flexWrap: 'wrap'
            }}
          >
            {pending && [30, 31, 34, 35, 41, 21, 42].includes(command!) ? (
              <CmButton
                variant="ghost"
                disabled={pending.validating}
                onClick={() => respond({ continueFlag: 1 })}
              >
                Voltar
              </CmButton>
            ) : null}
            {command === 35 ? (
              <CmButton
                variant="outline"
                disabled={pending?.validating}
                onClick={() => respond({ buffer: '2:' })}
              >
                Cancelar esta coleta
              </CmButton>
            ) : null}
            {semantic?.canCancelBill &&
            semantic.domain === 'corban' &&
            [600, 601].includes(pending!.request.fieldType) &&
            [30, 34].includes(command!) ? (
              <CmButton
                variant="outline"
                disabled={pending?.validating}
                onClick={() => respond({ continueFlag: 2 })}
              >
                Cancelar conta
              </CmButton>
            ) : null}
            <CmButton
              variant="outline"
              tone="danger"
              disabled={state.cancelling}
              onClick={() => controller.cancel()}
            >
              {state.cancelling ? 'Cancelando…' : 'Cancelar transação'}
            </CmButton>
          </div>
        }
      >
        <div
          style={{ display: 'grid', gap: '0.75rem', overflowWrap: 'anywhere' }}
        >
          {state.header ? (
            <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{state.header}</p>
          ) : null}
          {state.operatorMessage ? (
            <div aria-live="polite">
              <small>Operador</small>
              <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                {state.operatorMessage}
              </p>
            </div>
          ) : null}
          {state.customerMessage ? (
            <div aria-live="polite">
              <small>Cliente</small>
              <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                {state.customerMessage}
              </p>
            </div>
          ) : null}
          {state.qrCode ? (
            <div style={{ textAlign: 'center' }}>
              <CmQrCode
                value={state.qrCode}
                title="QR Code do pagamento"
                size={224}
              />
              {state.qrFooter ? (
                <p aria-live="polite">{state.qrFooter}</p>
              ) : null}
            </div>
          ) : null}
          {pending ? (
            <>
              {!menu && pending.request.buffer ? (
                <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                  {pending.request.buffer}
                </p>
              ) : null}
              {command === 20 ? (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <CmButton onClick={() => respond({ buffer: '0' })}>
                    Sim
                  </CmButton>
                  <CmButton
                    ref={primaryAction}
                    variant="outline"
                    onClick={() => respond({ buffer: '1' })}
                  >
                    Não
                  </CmButton>
                </div>
              ) : null}
              {command === 22 ? (
                <CmButton
                  ref={primaryAction}
                  onClick={() => respond({ buffer: '' })}
                >
                  Continuar
                </CmButton>
              ) : null}
              {pending.confirming ? (
                <div
                  style={{ display: 'grid', gap: '0.75rem' }}
                  aria-label="Confirmar opção escolhida"
                >
                  <p style={{ margin: 0 }}>
                    Confirmar a opção{' '}
                    <strong>{pending.selection?.label}</strong>?
                  </p>
                  <div
                    style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}
                  >
                    <CmButton
                      onClick={() =>
                        respond({
                          buffer: pending.selection!.id,
                          confirmed: true
                        })
                      }
                    >
                      Confirmar opção
                    </CmButton>
                    <CmButton
                      ref={primaryAction}
                      variant="outline"
                      onClick={() => controller.reviseSelection(pending.id)}
                    >
                      Alterar opção
                    </CmButton>
                  </div>
                </div>
              ) : pending.options ? (
                <div
                  style={{
                    display: 'grid',
                    gap: '0.5rem',
                    minWidth: 0,
                    maxHeight: '45vh',
                    overflowY: 'auto'
                  }}
                  aria-label={
                    format === 'S'
                      ? 'Respostas disponíveis'
                      : 'Opções do pagamento'
                  }
                >
                  {pending.options.map((option, index) => (
                    <CmButton
                      ref={index === 0 ? primaryAction : undefined}
                      key={option.id}
                      variant="outline"
                      fullWidth
                      style={{
                        minWidth: 0,
                        whiteSpace: 'normal',
                        height: 'auto',
                        minHeight: '2.5rem',
                        overflowWrap: 'anywhere'
                      }}
                      onClick={() => respond({ buffer: option.id })}
                    >
                      {option.label}
                    </CmButton>
                  ))}
                </div>
              ) : null}
              {isInput ? (
                <form
                  onSubmit={sendInput}
                  aria-busy={pending.validating}
                  style={{ display: 'grid', gap: '0.75rem' }}
                >
                  {collection ? (
                    <label>
                      Origem da coleta
                      <select
                        aria-label="Origem da coleta"
                        disabled={pending.validating}
                        value={collectionMode}
                        onChange={(event) =>
                          setCollectionMode(event.target.value)
                        }
                        style={{
                          display: 'block',
                          width: '100%',
                          background: 'var(--color-card)',
                          color: 'var(--color-foreground)',
                          border: '1px solid var(--color-border)',
                          padding: '0.5rem',
                          borderRadius: 'var(--radius-md)'
                        }}
                      >
                        <option value="0">
                          {command === 31
                            ? 'Primeira linha do cheque'
                            : 'Digitação manual'}
                        </option>
                        <option value="1">
                          Leitor{' '}
                          {command === 31 ? 'CMC-7' : 'de código de barras'}
                        </option>
                        {command === 31 ? (
                          <option value="2">Digitação do CMC-7</option>
                        ) : null}
                      </select>
                    </label>
                  ) : null}
                  {command === 31 && collectionMode === '0' ? (
                    <small>
                      Compensação (3), banco (3), agência (4), C1 (1), conta
                      (10), C2 (1), cheque (6), C3 (1), nesta ordem.
                    </small>
                  ) : null}
                  <CmInput
                    ref={input}
                    label={protectedInput ? 'Informação protegida' : 'Resposta'}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    type={protectedInput ? 'password' : 'text'}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={pending.validating}
                    inputMode={
                      command === 34 || format?.startsWith('V')
                        ? 'decimal'
                        : collection ||
                            format === 'N' ||
                            format?.includes('DD') ||
                            format === 'HHMMSS'
                          ? 'numeric'
                          : 'text'
                    }
                    helperText={`Tamanho permitido: ${pending.request.minLength} a ${pending.request.maxLength} bytes.${command === 34 || format?.startsWith('V') ? ` Até ${decimalPlaces} casas decimais.` : ''}${format && !['A', 'AN', 'LN', 'N'].includes(format) && !format.startsWith('V') ? ` Formato: ${format}.` : ''}`}
                  />
                  <CmButton
                    type="submit"
                    presentation="modalPrimaryAction"
                    loading={pending.validating}
                    loadingLabel="Validando…"
                  >
                    Continuar
                  </CmButton>
                </form>
              ) : null}
            </>
          ) : (
            <p role="status" style={{ margin: 0 }}>
              {state.cancelling
                ? 'Aguardando encerramento pela CliSiTef…'
                : 'Aguardando CliSiTef ou pinpad…'}
            </p>
          )}
        </div>
      </CmDialog>
    </>
  );
}
