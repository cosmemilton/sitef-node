import type {
  InteractionHandler,
  UiRequest,
  UiResponse
} from '@cosmemilton/sitef';
import { validateFieldResponse } from '@cosmemilton/sitef/fields';

export interface MenuOption {
  id: string;
  label: string;
  code?: string;
  type?: string;
  menuClass?: string;
}
export interface PendingInteraction {
  id: number;
  request: UiRequest;
  options?: ReadonlyArray<MenuOption>;
  validating?: boolean;
  confirming?: boolean;
  selection?: MenuOption;
}
export interface ModalSnapshot {
  open: boolean;
  title: string;
  header: string;
  operatorMessage: string;
  customerMessage: string;
  qrCode: string;
  qrFooter: string;
  cancelling: boolean;
  /** Precision announced by command 0 / field 2470; two until configured. */
  decimalPlaces: number;
  unitPriceDecimalPlaces?: number;
  quantityDecimalPlaces?: number;
  pending?: PendingInteraction;
  notice?: {
    id: number;
    message: string;
    tone: 'danger' | 'warning' | 'success' | 'info';
  };
}
export interface ModalOptions {
  /** Abort the SDK transaction signal. Must not close the modal or kill the native process. */
  onCancel: () => void;
  /** Command 29 must be supplied by application data, never by an operator form. */
  systemData?: InteractionHandler;
  /** Future commands may be handled explicitly by the integrator. */
  onUnsupported?: InteractionHandler;
  /** Call client.validateBarcode(data) in Node, or an allowlisted session-bound IPC method. */
  validateBarcode?: (
    data: string
  ) => Promise<{ status: number; documentType?: number }>;
  /** Match the native bridge encoding. Defaults to strict Windows-1252. */
  byteLength?: (value: string) => number;
  nativeEncoding?: 'windows-1252' | 'utf-8' | 'ascii';
}
export interface SitefModalController {
  handler: InteractionHandler;
  /** Pass to core onExchange: command 0 is not forwarded to interaction handlers. */
  onExchange: (request: Readonly<UiRequest>) => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ModalSnapshot;
  respond: (response: UiResponse, requestId: number) => void | Promise<void>;
  /** Return from the second menu confirmation to its option list, without native navigation. */
  reviseSelection: (requestId: number) => void;
  cancel: () => void;
  /** Call only after SDK run settles; this does not finalize a financial transaction. */
  complete: () => void;
  reportError: (message: string) => void;
  notify: (
    message: string,
    tone?: NonNullable<ModalSnapshot['notice']>['tone']
  ) => void;
}

export class SitefModalError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'SitefModalError';
  }
}

const cp1252Extra = new Set([
  0x20ac, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160,
  0x2039, 0x152, 0x17d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x17e, 0x178
]);
export function windows1252ByteLength(value: string): number {
  let length = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (
      point === 0 ||
      !(
        point <= 0x7f ||
        (point >= 0xa0 && point <= 0xff) ||
        cp1252Extra.has(point)
      )
    ) {
      throw new SitefModalError(
        'UNENCODABLE_INPUT',
        'A entrada contém caractere incompatível com Windows-1252.'
      );
    }
    length++;
  }
  return length;
}

export function parseMenu(
  request: Pick<UiRequest, 'command' | 'buffer'>
): MenuOption[] {
  let body = request.buffer;
  let menuClass: string | undefined;
  if (request.command === 42) {
    const pipe = body.indexOf('|');
    if (pipe < 0)
      throw new SitefModalError(
        'INVALID_MENU',
        'Menu identificado sem classe.'
      );
    menuClass = body.slice(0, pipe);
    body = body.slice(pipe + 1);
  }
  const seen = new Set<string>();
  const result = body
    .split(';')
    .filter(Boolean)
    .map((row) => {
      const first = row.indexOf(':');
      if (first < 1)
        throw new SitefModalError(
          'INVALID_MENU',
          'Opção do menu sem identificador.'
        );
      const id = row.slice(0, first);
      if (seen.has(id))
        throw new SitefModalError(
          'INVALID_MENU',
          'Menu com identificador duplicado.'
        );
      seen.add(id);
      if (request.command !== 42) return { id, label: row.slice(first + 1) };
      const last = row.lastIndexOf(':');
      const beforeLast = row.lastIndexOf(':', last - 1);
      if (beforeLast <= first)
        throw new SitefModalError(
          'INVALID_MENU',
          'Opção de menu identificado incompleta.'
        );
      return {
        id,
        label: row.slice(first + 1, beforeLast),
        code: row.slice(beforeLast + 1, last),
        type: row.slice(last + 1),
        menuClass
      };
    });
  if (!result.length)
    throw new SitefModalError(
      'INVALID_MENU',
      'A CliSiTef enviou um menu vazio.'
    );
  return result;
}

export function createSitefModal(options: ModalOptions): SitefModalController {
  let state: ModalSnapshot = {
    open: false,
    title: '',
    header: '',
    operatorMessage: '',
    customerMessage: '',
    qrCode: '',
    qrFooter: '',
    cancelling: false,
    decimalPlaces: 2
  };
  let sequence = 0;
  let nextFormat: string | undefined;
  let pending:
    | {
        id: number;
        resolve: (response: UiResponse) => void;
        cleanup: () => void;
      }
    | undefined;
  const listeners = new Set<() => void>();
  const byteLength = options.byteLength ?? windows1252ByteLength;
  const update = (patch: Partial<ModalSnapshot>) => {
    state = Object.freeze({ ...state, ...patch });
    for (const listener of [...listeners]) listener();
  };
  const notify = (
    message: string,
    tone: NonNullable<ModalSnapshot['notice']>['tone'] = 'info'
  ) => update({ notice: { id: ++sequence, message, tone } });
  const resolve = (response: UiResponse) => {
    const current = pending;
    if (!current) return;
    pending = undefined;
    current.cleanup();
    update({ pending: undefined });
    current.resolve(response);
  };
  const onExchange = (request: Readonly<UiRequest>) => {
    if (request.command !== 0) return;
    if (request.fieldType === 2355) {
      if (!/^(A|AN|LN|N|S|M|Mc|V[0-9]+)$/u.test(request.buffer))
        throw new SitefModalError(
          'UNSUPPORTED_FIELD_FORMAT',
          'A coleta exige um formato que deve ser resolvido pela aplicação.'
        );
      nextFormat = request.buffer;
      return;
    }
    if (![2470, 1121, 1126].includes(request.fieldType)) return;
    const places = Number(request.buffer);
    if (
      !/^\d+$/u.test(request.buffer) ||
      !Number.isSafeInteger(places) ||
      places < 0
    ) {
      throw new SitefModalError(
        'INVALID_DECIMAL_PLACES',
        'A CliSiTef informou uma quantidade inválida de casas decimais.'
      );
    }
    update(
      request.fieldType === 1121
        ? { unitPriceDecimalPlaces: places }
        : request.fieldType === 1126
          ? { quantityDecimalPlaces: places }
          : { decimalPlaces: places }
    );
  };
  const handler: InteractionHandler = async (request, context) => {
    if (pending)
      throw new SitefModalError(
        'CONCURRENT_INTERACTION',
        'Este modal já está atendendo uma coleta. Use uma instância por sessão.'
      );
    if (context.signal.aborted || state.cancelling) return { continueFlag: -1 };
    update({ open: true });
    switch (request.command) {
      case 0:
        onExchange(request);
        return {};
      case 1:
        update({ operatorMessage: request.buffer });
        return {};
      case 2:
        update({ customerMessage: request.buffer });
        return {};
      case 3:
        update({
          operatorMessage: request.buffer,
          customerMessage: request.buffer
        });
        return {};
      case 4:
        update({ title: request.buffer });
        return {};
      case 11:
        update({ operatorMessage: '' });
        return {};
      case 12:
        update({ customerMessage: '' });
        return {};
      case 13:
        update({ operatorMessage: '', customerMessage: '' });
        return {};
      case 14:
        update({ title: '' });
        return {};
      case 15:
        update({ header: request.buffer });
        return {};
      case 16:
        update({ header: '' });
        return {};
      case 23:
        return {};
      case 29:
        if (!options.systemData)
          throw new SitefModalError(
            'SYSTEM_DATA_REQUIRED',
            `Forneça systemData para o campo de sistema ${request.fieldType}.`
          );
        return options.systemData(request, context);
      case 50:
        update({ qrCode: request.buffer });
        return {};
      case 51:
        update({ qrCode: '', qrFooter: '' });
        return {};
      case 52:
        update({ qrFooter: request.buffer });
        return {};
      case 20:
      case 21:
      case 22:
      case 30:
      case 31:
      case 34:
      case 35:
      case 41:
      case 42:
        break;
      default:
        if (options.onUnsupported)
          return options.onUnsupported(request, context);
        throw new SitefModalError(
          'UNSUPPORTED_COMMAND',
          `Comando CliSiTef ${request.command} requer um handler explícito.`
        );
    }
    // A semantic DTO from the core is authoritative. Raw metadata fallback is
    // only for an integrator mounting the controller without that processor.
    const isCollection = [20, 21, 30, 31, 34, 35, 41, 42].includes(
      request.command
    );
    const format =
      request.semantic?.format ?? (isCollection ? nextFormat : undefined);
    const places =
      request.semantic?.decimalPlaces ??
      (format?.startsWith('V')
        ? Number(format.slice(1))
        : [1027, 1113].includes(request.fieldType)
          ? (state.quantityDecimalPlaces ?? state.decimalPlaces)
          : state.decimalPlaces);
    const effective = request.semantic
      ? request
      : {
          ...request,
          semantic: {
            known: false,
            format,
            decimalPlaces: places,
            menuConfirmation: format === 'Mc',
            canCancelBill: false,
            sensitive: request.command === 41,
            functionId: -1,
            domain: 'unknown'
          }
        };
    if (request.command === 30 || request.command === 34)
      update({ decimalPlaces: 2 });
    if (isCollection) nextFormat = undefined;
    if (
      format === 'S' &&
      request.command !== 20 &&
      !effective.semantic?.choices
    )
      throw new SitefModalError(
        'AMBIGUOUS_FORMAT',
        'Os valores Sim/Não deste produto precisam ser fornecidos pela aplicação.'
      );
    const menu =
      request.command === 21 || request.command === 42
        ? parseMenu(request)
        : request.command === 30 && (format === 'M' || format === 'Mc')
          ? parseMenu({ ...request, command: 21 })
          : request.command === 30 && effective.semantic?.choices
            ? Object.entries(effective.semantic.choices).map(([id, label]) => ({
                id,
                label
              }))
            : undefined;
    if (effective.semantic?.menuConfirmation && !menu)
      throw new SitefModalError(
        'INVALID_MENU',
        'A confirmação exige uma lista explícita de opções.'
      );
    const id = ++sequence;
    return new Promise<UiResponse>((resolvePromise) => {
      const abort = () => {
        update({ cancelling: true });
        resolve({ continueFlag: -1 });
      };
      pending = {
        id,
        resolve: resolvePromise,
        cleanup: () => context.signal.removeEventListener('abort', abort)
      };
      update({ pending: { id, request: effective, options: menu } });
      context.signal.addEventListener('abort', abort, { once: true });
      if (context.signal.aborted) abort();
    });
  };
  return {
    handler,
    onExchange,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    notify,
    reportError: (message) => notify(message, 'danger'),
    reviseSelection(requestId) {
      if (!pending || pending.id !== requestId || !state.pending?.confirming)
        throw new SitefModalError(
          'STALE_RESPONSE',
          'Não há opção pendente de confirmação.'
        );
      update({
        pending: { ...state.pending, confirming: false, selection: undefined }
      });
    },
    respond(response, requestId) {
      if (!pending || pending.id !== requestId || !state.pending)
        throw new SitefModalError(
          'STALE_RESPONSE',
          'A coleta já foi respondida ou encerrada.'
        );
      if (state.pending.validating)
        throw new SitefModalError(
          'VALIDATION_PENDING',
          'Aguarde a validação da coleta.'
        );
      const request = state.pending.request;
      if (response.continueFlag === 10000)
        throw new SitefModalError(
          'INVALID_NAVIGATION',
          'A coleta prévia exige integração e confirmação próprias; use o callback da aplicação.'
        );
      if (response.continueFlag) {
        if (
          response.continueFlag === 2 &&
          !(
            request.semantic?.canCancelBill &&
            request.semantic.domain === 'corban' &&
            [600, 601].includes(request.fieldType) &&
            [30, 34].includes(request.command)
          )
        )
          throw new SitefModalError(
            'INVALID_NAVIGATION',
            'Esta coleta não permite cancelar somente a conta atual.'
          );
        validateFieldResponse(request, response, {
          nativeEncoding: options.nativeEncoding
        });
        resolve(response);
        return;
      }
      const buffer = response.buffer ?? '';
      if (request.command === 20 && buffer !== '0' && buffer !== '1')
        throw new SitefModalError(
          'INVALID_CONFIRMATION',
          'Escolha Sim ou Não.'
        );
      if (
        state.pending.options &&
        !state.pending.options.some((option) => option.id === buffer)
      )
        throw new SitefModalError(
          'INVALID_MENU_SELECTION',
          'Selecione uma opção do menu.'
        );
      if (request.semantic?.menuConfirmation) {
        if (!state.pending.confirming) {
          update({
            pending: {
              ...state.pending,
              confirming: true,
              selection: state.pending.options?.find(
                (option) => option.id === buffer
              )
            }
          });
          return;
        }
        if (
          response.confirmed !== true ||
          state.pending.selection?.id !== buffer
        )
          throw new SitefModalError(
            'CONFIRMATION_REQUIRED',
            'Confirme a opção apresentada antes de continuar.'
          );
      }
      if ([30, 31, 34, 35, 41].includes(request.command)) {
        let data = buffer;
        if (request.command === 31 || request.command === 35) {
          const match = /^(0|1|2):(.*)$/su.exec(buffer);
          if (
            !match ||
            (request.command === 35 && match[1] === '2' && match[2] !== '')
          )
            throw new SitefModalError(
              'INVALID_COLLECTION',
              'Formato de coleta inválido.'
            );
          if (request.command === 35 && buffer === '2:') {
            resolve({ buffer, continueFlag: 0 });
            return;
          }
          data = match[2]!;
          if (
            request.command === 31 &&
            match[1] === '0' &&
            !/^\d{29}$/u.test(data)
          )
            throw new SitefModalError(
              'INVALID_CHEQUE',
              'A primeira linha do cheque deve conter os 29 dígitos na ordem indicada.'
            );
        }
        if (request.command === 34) {
          const decimal = /^\d+(?:[,.](\d+))?$/u.exec(data);
          const places = request.semantic?.decimalPlaces ?? state.decimalPlaces;
          if (!decimal || (decimal[1]?.length ?? 0) > places)
            throw new SitefModalError(
              'INVALID_AMOUNT',
              `Informe um valor decimal com até ${places} casas decimais.`
            );
        }
        const length = byteLength(data);
        if (length < request.minLength || length > request.maxLength)
          throw new SitefModalError(
            'INVALID_LENGTH',
            `Informe de ${request.minLength} a ${request.maxLength} bytes.`
          );
        validateFieldResponse(request, response, {
          nativeEncoding: options.nativeEncoding
        });
        if (request.command === 35 && options.validateBarcode) {
          update({ pending: { ...state.pending, validating: true } });
          return Promise.resolve()
            .then(() => options.validateBarcode!(data))
            .then((result) => {
              if (pending?.id !== requestId) return;
              if (result.status !== 0)
                throw new SitefModalError(
                  'INVALID_BARCODE',
                  `Código de barras rejeitado pela CliSiTef (retorno ${result.status}).`
                );
              resolve({ buffer, continueFlag: 0 });
            })
            .catch((error: unknown) => {
              if (pending?.id !== requestId) return;
              if (error instanceof SitefModalError) throw error;
              throw new SitefModalError(
                'BARCODE_VALIDATION_FAILED',
                'Não foi possível validar o código de barras na CliSiTef. Tente novamente ou cancele a coleta.'
              );
            })
            .finally(() => {
              if (pending?.id === requestId && state.pending)
                update({ pending: { ...state.pending, validating: false } });
            });
        }
      }
      validateFieldResponse(request, response, {
        nativeEncoding: options.nativeEncoding
      });
      resolve({
        buffer,
        continueFlag: 0,
        ...(request.semantic?.menuConfirmation ? { confirmed: true } : {})
      });
    },
    cancel() {
      if (state.cancelling) return;
      update({ cancelling: true });
      try {
        options.onCancel();
      } catch {
        notify('Não foi possível solicitar o cancelamento à sessão.', 'danger');
      }
      resolve({ continueFlag: -1 });
    },
    complete() {
      if (pending)
        throw new SitefModalError(
          'INTERACTION_PENDING',
          'Encerre a coleta antes de fechar o modal.'
        );
      nextFormat = undefined;
      update({
        open: false,
        title: '',
        header: '',
        operatorMessage: '',
        customerMessage: '',
        qrCode: '',
        qrFooter: '',
        pending: undefined,
        cancelling: false,
        decimalPlaces: 2,
        unitPriceDecimalPlaces: undefined,
        quantityDecimalPlaces: undefined
      });
    }
  };
}
