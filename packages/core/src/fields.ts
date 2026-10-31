import fieldDocument from './data/fields.json' with { type: 'json' };
import functionDocument from './data/functions.json' with { type: 'json' };
import { SitefError } from './errors.js';
import {
  exactDecimal,
  decimalCompare,
  decimalSubtract,
  decimalSum
} from './decimal.js';
import type { UiRequest, UiResponse } from './types.js';
import type {
  ExactDecimal,
  FieldContext,
  FieldDefinition,
  FieldOptions,
  FieldSemantic,
  FieldSnapshot,
  FunctionDefinition,
  NfpagMethod,
  NfpagRequirements,
  ProductConstraint,
  Receipt,
  TransactionAssessment,
  TypedField
} from './semantic-types.js';

const fields = fieldDocument as unknown as {
  entries: Record<string, FieldDefinition>;
  ranges: Array<{ from: number; to: number; [key: string]: unknown }>;
};
const functions = functionDocument as unknown as {
  entries: Record<string, FunctionDefinition>;
};
export function functionDefinition(
  code: number
): FunctionDefinition | undefined {
  return functions.entries[String(code)];
}
export function fieldDefinition(
  code: number,
  context?: string
): FieldDefinition | undefined {
  let definition = fields.entries[String(code)];
  const contextual = fields.ranges.find(
    (x) =>
      code >= x.from &&
      code <= x.to &&
      context !== undefined &&
      context !== 'transaction' &&
      Array.isArray(x.contexts) &&
      x.contexts.includes(context)
  );
  if (contextual)
    definition = {
      name: String(contextual.name),
      description: String(contextual.description),
      dataType: String(contextual.dataType ?? 'text'),
      ...contextual
    };
  if (!definition) {
    const range = fields.ranges.find(
      (x) =>
        code >= x.from &&
        code <= x.to &&
        (!Array.isArray(x.contexts) ||
          x.contexts.includes(context ?? 'transaction'))
    );
    if (range)
      definition = {
        name: String(range.name ?? range.kind ?? 'reserved'),
        description: String(range.description ?? 'Faixa de campos documentada'),
        dataType: 'text',
        ...range
      };
  }
  const contexts = definition?.contexts;
  if (
    context &&
    contexts &&
    !Array.isArray(contexts) &&
    typeof contexts === 'object'
  ) {
    const specific = (contexts as Record<string, unknown>)[context];
    if (specific && typeof specific === 'object')
      definition = { ...definition!, ...specific };
  }
  return definition ? structuredClone(definition) : undefined;
}
function formatString(
  definition: FieldDefinition | undefined
): string | undefined {
  const format = definition?.format;
  if (typeof format === 'string') return format;
  if (!format) return undefined;
  if (format.kind === 'date-time-pattern')
    return String(format.pattern).toUpperCase().replaceAll('Y', 'A');
  if (
    format.kind === 'digits' ||
    format.kind === 'integer' ||
    format.kind === 'nonnegative-integer'
  )
    return 'N';
  if (format.kind === 'minor-units') return 'N';
  if (format.kind === 'decimal-comma' && typeof format.scale === 'number')
    return `V${format.scale}`;
  return undefined;
}
function structuredValue(
  value: string,
  definition: FieldDefinition | undefined,
  options: FieldOptions
): unknown {
  const format = definition?.format;
  if (!format || typeof format === 'string') return value;
  const kind = format.kind;
  if (kind === 'confirmation-data') {
    const [serviceZ, sitefIndex, sitefAddress] = value.split(';');
    return { serviceZ, sitefIndex, sitefAddress };
  }
  if (kind === 'payment-mode') {
    if (!/^\d{4}$/.test(value))
      throw new SitefError(
        'INVALID_PAYMENT_MODE',
        'Modalidade deve conter grupo e variante.'
      );
    return { group: value.slice(0, 2), variant: value.slice(2) };
  }
  if (kind === 'minor-units')
    return exactDecimal(value, Number(format.scale ?? 2), 'minor-units');
  if (kind === 'decimal-comma' && format.scale !== undefined)
    return exactDecimal(value, Number(format.scale));
  if (kind === 'date-time-pattern') {
    const pattern = String(format.pattern).toUpperCase().replaceAll('Y', 'A');
    if (pattern === 'AAAAMMDDHHMMSS') {
      if (
        !/^\d{14}$/.test(value) ||
        Number(value.slice(8, 10)) > 23 ||
        Number(value.slice(10, 12)) > 59 ||
        Number(value.slice(12)) > 59
      )
        throw new SitefError(
          'INVALID_DATETIME',
          'Data/hora retornada inválida.'
        );
      return {
        date: dateParts(value.slice(0, 8), 'AAAAMMDD'),
        time: value.slice(8)
      };
    }
    return dateParts(value, pattern) ?? { raw: value, format: pattern };
  }
  if (kind === 'cheque-without-check-digits') {
    if (!/^\d{26}$/.test(value))
      throw new SitefError(
        'INVALID_CHEQUE',
        'Cheque sem verificadores exige 26 dígitos.'
      );
    return {
      compensation: value.slice(0, 3),
      bank: value.slice(3, 6),
      agency: value.slice(6, 10),
      account: value.slice(10, 20),
      cheque: value.slice(20)
    };
  }
  if (kind === 'barcode-origin') {
    const match = /^([01]):(.+)$/.exec(value);
    if (!match)
      throw new SitefError('INVALID_BARCODE', 'Código pago sem origem válida.');
    return { origin: match[1], code: match[2] };
  }
  if (kind === 'pix-additional-fields') {
    const rows = value.split(String(format.recordSeparator)).filter(Boolean);
    if (rows.length > Number(format.maxRecords))
      throw new SitefError(
        'PIX_FIELDS_LIMIT',
        'Quantidade de campos Pix excedida.'
      );
    return rows.map((row) => {
      const parts = row.split(String(format.pairSeparator));
      if (
        parts.length !== 2 ||
        nativeByteLength(parts[0], options.nativeEncoding) >
          Number(format.maxNameBytes) ||
        nativeByteLength(parts[1], options.nativeEncoding) >
          Number(format.maxValueBytes)
      )
        throw new SitefError(
          'PIX_FIELD_INVALID',
          'Campo adicional Pix inválido.'
        );
      return { name: parts[0], value: parts[1] };
    });
  }
  if (kind === 'fuel-product-list') {
    const rows = value
      .split(';')
      .filter(Boolean)
      .map((row) => row.split(','));
    // The abbreviated manual gives no escaping/decimal grammar for this
    // comma-delimited product format. Preserve ambiguous content for the
    // explicit product resolver instead of rejecting it before the hook.
    if (rows.some((parts) => parts.length !== 4))
      return {
        raw: value,
        unresolved: true,
        reason: 'FUEL_PRODUCT_GRAMMAR_REQUIRES_APPLICATION'
      };
    return rows.map((parts) => ({
      code: parts[0],
      description: parts[1],
      quantity: parts[2],
      total: parts[3]
    }));
  }
  if (kind === 'nonfuel-product-list') {
    if (value && !value.endsWith('<#>'))
      throw new SitefError(
        'INVALID_PRODUCT_LIST',
        'Lista de produtos sem terminador.'
      );
    const seen = new Set<string>();
    return value
      .split('<#>')
      .filter(Boolean)
      .map((row) => {
        const record: Record<string, string> = {};
        for (const pair of row.split(',')) {
          const match = /^([A-Za-z]+)=(.*)$/u.exec(pair);
          if (!match || Object.hasOwn(record, match[1]))
            throw new SitefError(
              'INVALID_PRODUCT_LIST',
              'Produto com chave inválida ou repetida.'
            );
          record[match[1]] = match[2];
        }
        if (
          !['Id', 'd', 'Q', 'VU', 'T', 'TQ'].every((k) =>
            Object.hasOwn(record, k)
          ) ||
          seen.has(record.Id) ||
          !['E', 'S'].includes(record.T) ||
          !['1', '2', '3'].includes(record.TQ) ||
          !/^\d+$/.test(record.VU)
        )
          throw new SitefError(
            'INVALID_PRODUCT_LIST',
            'Produto incompleto, duplicado ou com unidade inválida.'
          );
        const limits = format.maxBytes as Record<string, number>;
        for (const [k, max] of Object.entries(limits))
          if (nativeByteLength(record[k], options.nativeEncoding) > max)
            throw new SitefError(
              'INVALID_PRODUCT_LIST',
              'Campo de produto excede tamanho documentado.'
            );
        seen.add(record.Id);
        return {
          ...record,
          unitPrice: exactDecimal(record.VU, 2, 'minor-units')
        };
      });
  }
  if (kind === 'native-communication-diagnostic') {
    const match = /^\[([^:\]]+):([^:\]]+):(\d+)(?::([^\]]+))?\]/.exec(value);
    return match
      ? {
          transport: match[1],
          phase: match[2],
          code: match[3],
          qualifier: match[4],
          raw: value
        }
      : { raw: value };
  }
  return value;
}

const cp1252Extra = new Set([
  0x20ac, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160,
  0x2039, 0x152, 0x17d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x17e, 0x178
]);
export function nativeByteLength(
  value: string,
  encoding: FieldOptions['nativeEncoding'] = 'windows-1252'
): number {
  if (typeof value !== 'string' || value.includes('\0'))
    throw new SitefError('INVALID_INPUT', 'Texto inválido ou com NUL.');
  if (encoding === 'utf-8') return new TextEncoder().encode(value).length;
  let length = 0;
  for (const char of value) {
    const point = char.codePointAt(0)!;
    if (
      encoding === 'ascii'
        ? point > 127
        : !(
            point <= 127 ||
            (point >= 160 && point <= 255) ||
            cp1252Extra.has(point)
          )
    )
      throw new SitefError(
        'ENCODING_ERROR',
        'Texto não representável na codificação nativa.'
      );
    length++;
  }
  return length;
}
function dateParts(value: string, format: string): unknown {
  const f = format
    .toUpperCase()
    .replace(/[^ADMY]/g, '')
    .replaceAll('Y', 'A');
  let day: number | undefined,
    month: number | undefined,
    year: number | undefined,
    yearTwoDigits: number | undefined;
  if (f === 'DDMMAAAA' && /^\d{8}$/.test(value)) {
    day = Number(value.slice(0, 2));
    month = Number(value.slice(2, 4));
    year = Number(value.slice(4));
  } else if (f === 'AAAAMMDD' && /^\d{8}$/.test(value)) {
    year = Number(value.slice(0, 4));
    month = Number(value.slice(4, 6));
    day = Number(value.slice(6));
  } else if (f === 'DDMMAA' && /^\d{6}$/.test(value)) {
    day = Number(value.slice(0, 2));
    month = Number(value.slice(2, 4));
    yearTwoDigits = Number(value.slice(4));
  } else if (f === 'DDMM' && /^\d{4}$/.test(value)) {
    day = Number(value.slice(0, 2));
    month = Number(value.slice(2));
  } else if (f === 'AAMM' && /^\d{4}$/.test(value)) {
    month = Number(value.slice(2));
  } else if (f === 'MMAA' && /^\d{4}$/.test(value)) {
    month = Number(value.slice(0, 2));
    yearTwoDigits = Number(value.slice(2));
  } else if (f === 'MMAAAA' && /^\d{6}$/.test(value)) {
    month = Number(value.slice(0, 2));
    year = Number(value.slice(2));
  } else return undefined;
  const leap =
    year === undefined
      ? yearTwoDigits === undefined || yearTwoDigits % 4 === 0
      : year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  if (
    !month ||
    month > 12 ||
    (day !== undefined &&
      (day < 1 ||
        day >
          [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
            month - 1
          ]))
  )
    throw new SitefError(
      'INVALID_DATE',
      'Data fora do calendário ou formato informado.'
    );
  return {
    raw: value,
    format,
    ...(day === undefined ? {} : { day }),
    month,
    ...(year === undefined ? {} : { year }),
    ...(yearTwoDigits === undefined ? {} : { yearTwoDigits })
  };
}
function responseBytes(
  text: string,
  encoding: FieldOptions['nativeEncoding']
): Uint8Array {
  nativeByteLength(text, encoding);
  if (encoding === 'utf-8') return new TextEncoder().encode(text);
  const positions = [
    0x80, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b, 0x8c,
    0x8e, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0x9b,
    0x9c, 0x9e, 0x9f
  ];
  const special = new Map(
    [...cp1252Extra].map((point, index) => [point, positions[index]])
  );
  return Uint8Array.from([...text], (char) => {
    const point = char.codePointAt(0)!;
    return special.get(point) ?? point;
  });
}
function checkResponseBytes(response: UiResponse, options: FieldOptions): void {
  if (response.bufferBase64 === undefined) return;
  const encoded = response.bufferBase64;
  if (
    typeof encoded !== 'string' ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded
    )
  )
    throw new SitefError(
      'INVALID_BASE64',
      'Bytes da resposta não usam Base64 válido.'
    );
  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    throw new SitefError(
      'INVALID_BASE64',
      'Bytes da resposta não usam Base64 válido.'
    );
  }
  if (btoa(decoded) !== encoded)
    throw new SitefError(
      'INVALID_BASE64',
      'Os bytes da resposta exigem Base64 canônico.'
    );
  const expected = responseBytes(response.buffer ?? '', options.nativeEncoding);
  if (
    decoded.length !== expected.length ||
    expected.some((value, index) => value !== decoded.charCodeAt(index))
  )
    throw new SitefError(
      'RESPONSE_BYTES_MISMATCH',
      'O buffer textual e os bytes da resposta precisam corresponder exatamente.'
    );
}
function menuIds(buffer: string, identified: boolean): Set<string> {
  const pipe = buffer.indexOf('|');
  if (identified && pipe < 0)
    throw new SitefError('INVALID_MENU', 'Menu identificado sem classe.');
  const rows = (identified ? buffer.slice(pipe + 1) : buffer)
      .split(';')
      .filter(Boolean),
    ids = new Set<string>();
  if (!rows.length) throw new SitefError('INVALID_MENU', 'Menu sem opções.');
  for (const row of rows) {
    const colon = row.indexOf(':');
    if (colon < 1 || ids.has(row.slice(0, colon)))
      throw new SitefError(
        'INVALID_MENU',
        'Menu sem índice válido ou com índice repetido.'
      );
    ids.add(row.slice(0, colon));
  }
  return ids;
}
export function validateFieldResponse(
  request: UiRequest,
  response: UiResponse,
  options: FieldOptions = {}
): void {
  const control = response.continueFlag ?? 0,
    semantic = request.semantic;
  if (![-1, 0, 1, 2, 10000].includes(control))
    throw new SitefError(
      'INVALID_RESPONSE',
      'Controle de continuidade inválido.'
    );
  if (control === 10000 && response.confirmed !== true)
    throw new SitefError(
      'CONFIRMATION_REQUIRED',
      'O dado pré-coletado precisa ter sido confirmado pelo operador.'
    );
  if (request.command !== 0) checkResponseBytes(response, options);
  if (control === 2 && !semantic?.canCancelBill)
    throw new SitefError(
      'INVALID_PARTIAL_CANCEL',
      'Cancelamento parcial não permitido nesta coleta.'
    );
  if ([-1, 1, 2].includes(control)) return;
  const buffer = response.buffer ?? '';
  if (request.command === 0) return;
  if (request.command === 20 && !['0', '1'].includes(buffer))
    throw new SitefError(
      'INVALID_CONFIRMATION',
      'A confirmação nativa exige 0 ou 1.'
    );
  if (![29, 30, 31, 34, 35, 41, 21, 42].includes(request.command)) return;
  let value = buffer;
  if ([31, 35].includes(request.command)) {
    const match = /^(0|1|2):(.*)$/su.exec(buffer);
    if (!match)
      throw new SitefError('INVALID_COLLECTION', 'Coleta sem prefixo válido.');
    if (request.command === 35 && buffer === '2:') return;
    if (request.command === 35 && match[1] === '2')
      throw new SitefError(
        'INVALID_COLLECTION',
        'Cancelamento da coleta de barras deve ser 2:.'
      );
    value = match[2];
    if (request.command === 31 && match[1] === '0' && !/^\d{29}$/.test(value))
      throw new SitefError(
        'INVALID_CHEQUE',
        'Primeira linha do cheque exige 29 dígitos.'
      );
  }
  if ([29, 30, 31, 34, 35, 41].includes(request.command)) {
    const size = nativeByteLength(value, options.nativeEncoding);
    if (size < request.minLength || size > request.maxLength)
      throw new SitefError(
        'INVALID_LENGTH',
        'Tamanho fora dos limites nativos da coleta.'
      );
  }
  const format = semantic?.format;
  if (format === 'A' && !/^[\p{L} ]*$/u.test(value))
    throw new SitefError('INVALID_FORMAT', 'Campo alfabético exige letras.');
  if (format === 'LN' && !/^[A-Za-z0-9 ]*$/.test(value))
    throw new SitefError(
      'INVALID_FORMAT',
      'Campo exige letras sem acentos e números.'
    );
  if (format === 'N' && !/^\d*$/.test(value))
    throw new SitefError('INVALID_FORMAT', 'Campo exige dígitos.');
  if (format?.startsWith('V') || request.command === 34)
    exactDecimal(value.replace('.', ','), semantic?.decimalPlaces ?? 2);
  if (
    format === 'S' &&
    request.command !== 20 &&
    Object.keys(semantic?.choices ?? {}).length !== 2
  )
    throw new SitefError(
      'AMBIGUOUS_FORMAT',
      'Informe dois valores distintos SIM/NÃO do produto no resolver do campo.'
    );
  const menu =
    request.command === 21 ||
    request.command === 42 ||
    format === 'M' ||
    format === 'Mc';
  if (menu && !menuIds(request.buffer, request.command === 42).has(value))
    throw new SitefError(
      'INVALID_MENU_SELECTION',
      'A resposta deve usar um índice do menu nativo.'
    );
  if (
    request.command !== 20 &&
    !menu &&
    semantic?.choices &&
    !Object.hasOwn(semantic.choices, value)
  )
    throw new SitefError(
      'INVALID_CHOICE',
      'Valor não pertence às opções permitidas.'
    );
  if (semantic?.menuConfirmation && response.confirmed !== true)
    throw new SitefError(
      'CONFIRMATION_REQUIRED',
      'A opção escolhida deve ser confirmada pelo operador.'
    );
  if (
    format &&
    /^(DDMM(?:AA(?:AA)?)?|AAAAMMDD|AAMM|MMAA|MMAAAA)$/.test(format)
  ) {
    if (!dateParts(value, format))
      throw new SitefError('INVALID_DATE', 'Formato de data inválido.');
  }
  if (
    format === 'HHMMSS' &&
    (!/^\d{6}$/.test(value) ||
      Number(value.slice(0, 2)) > 23 ||
      Number(value.slice(2, 4)) > 59 ||
      Number(value.slice(4)) > 59)
  )
    throw new SitefError('INVALID_TIME', 'Hora inválida.');
}

export function buildNfpag(
  requirements: NfpagRequirements,
  methods: NfpagMethod[],
  expectedTotal: string
): string {
  const maximum = requirements.maximum;
  if (maximum === undefined || !Number.isSafeInteger(maximum) || maximum < 0)
    throw new SitefError(
      'NFPAG_METADATA',
      'O campo 730 precisa informar um limite válido antes de montar NFPAG.'
    );
  if (!methods.length || (maximum > 0 && methods.length > maximum))
    throw new SitefError(
      'NFPAG_LIMIT',
      'Quantidade de formas de pagamento inválida.'
    );
  const values = methods.map((method) => exactDecimal(method.amount, 2));
  if (
    values.some((x) => BigInt(x.unscaled) < 0n) ||
    decimalCompare(decimalSum(values), exactDecimal(expectedTotal, 2)) !== 0
  )
    throw new SitefError(
      'NFPAG_TOTAL',
      'A soma das formas de pagamento difere do total.'
    );
  return methods
    .map((method, index) => {
      const allowed = requirements.types[method.type];
      if (!allowed)
        throw new SitefError(
          'NFPAG_TYPE',
          'Forma de pagamento não habilitada pelo produto.'
        );
      const data = { ...method.data };
      for (const value of Object.values(data))
        if (typeof value !== 'string' || value.includes('\0'))
          throw new SitefError(
            'NFPAG_DATA',
            'Dados NFPAG precisam ser texto sem NUL.'
          );
      if (data['10'] !== undefined) data['10'] = data['10'].split(';')[0];
      for (const key of allowed.fields.filter(
        (x) => !['00', '05', '13'].includes(x)
      ))
        if (!Object.hasOwn(data, key))
          throw new SitefError(
            'NFPAG_REQUIRED_DATA',
            `Dado ${key} não fornecido para NFPAG.`
          );
      for (const [key, value] of Object.entries(data)) {
        if (
          !allowed.fields.includes(key) ||
          key === '13' ||
          /[:;{}\-]/u.test(value)
        )
          throw new SitefError(
            'NFPAG_DATA',
            'Dado NFPAG não permitido ou com delimitador reservado.'
          );
        if (key === '01' && !['0', '1', '2'].includes(value))
          throw new SitefError(
            'NFPAG_CHEQUE_ORIGIN',
            'Origem do cheque NFPAG inválida.'
          );
        if (key === '02' && data['01'] === '1' && !/^\d{29}$/.test(value))
          throw new SitefError(
            'NFPAG_CHEQUE',
            'Primeira linha NFPAG deve incluir os dígitos verificadores.'
          );
        if (
          key === '03' &&
          allowed.allowedNetworks &&
          !(
            /^\d+$/.test(value) &&
            allowed.allowedNetworks.some(
              (network) =>
                /^\d+$/.test(network) && BigInt(network) === BigInt(value)
            )
          )
        )
          throw new SitefError(
            'NFPAG_NETWORK',
            'Rede não aceita pelo produto.'
          );
      }
      const extra = Object.entries(data)
        .map(([key, value]) => `${key}:${value}`)
        .join('-');
      return `${method.type}:${values[index].unscaled}${extra ? ':' + extra : ''};`;
    })
    .join('');
}

function productConstraints(
  observations: TypedField[],
  options: FieldOptions,
  context: FieldContext
): ProductConstraint[] {
  const result: ProductConstraint[] = [];
  const covered = new Set<number>();
  const exact = (field: TypedField | undefined): ExactDecimal | undefined => {
    const value = field?.value;
    if (!value || typeof value !== 'object') return undefined;
    return 'unscaled' in value &&
      'scale' in value &&
      typeof value.unscaled === 'string' &&
      /^-?\d+$/.test(value.unscaled) &&
      Number.isInteger(value.scale) &&
      Number(value.scale) >= 0 &&
      Number(value.scale) <= 100
      ? (value as ExactDecimal)
      : undefined;
  };
  const raw = (rows: TypedField[]) =>
    Object.fromEntries(
      rows.map((field) => [String(field.fieldType), field.raw])
    );
  const groups = new Map<string, TypedField[]>();
  let current = 'unscoped';
  groups.set(current, []);
  for (const field of observations) {
    if (field.fieldType === 1011) {
      current = /^\d+$/.test(field.raw)
        ? BigInt(field.raw).toString()
        : field.raw;
      groups.set(current, groups.get(current) ?? []);
    }
    if ([1011, 1012, 1014, 1016, 1042, 1043, 1044].includes(field.fieldType))
      groups.get(current)!.push(field);
  }
  for (const [index, rows] of groups) {
    if (
      !rows.some((field) => [1014, 1042, 1043, 1044].includes(field.fieldType))
    )
      continue;
    const latest = (id: number) =>
      rows.filter((field) => field.fieldType === id).at(-1);
    const scope = index === 'unscoped' ? {} : { medicineIndex: index };
    if (rows.some((field) => [1042, 1043, 1044].includes(field.fieldType))) {
      for (const id of [1042, 1043, 1044]) covered.add(id);
      const rule = latest(1042)?.raw,
        reference = exact(latest(1043)),
        practiced = exact(latest(1044));
      const constraint: ProductConstraint = {
        kind: 'pbm-price',
        scope,
        fieldTypes: [1042, 1043, 1044],
        raw: raw(rows),
        state: 'unresolved',
        reason: 'PBM_PRICE_CONTEXT_OR_SCALE_REQUIRED'
      };
      if (
        index !== 'unscoped' &&
        context.definition?.domain !== 'cancellation' &&
        reference &&
        practiced
      ) {
        const compared = decimalCompare(practiced, reference);
        if (rule === '0') {
          constraint.state = compared === 0 ? 'satisfied' : 'violated';
          constraint.reason =
            compared === 0
              ? 'PBM_FIXED_PRICE_MATCH'
              : 'PBM_FIXED_PRICE_MISMATCH';
        } else if (rule === '1' && compared <= 0) {
          constraint.state = 'satisfied';
          constraint.reason = 'PBM_LOWER_OR_EQUAL_PRICE_ALLOWED';
        } else if (rule === '1')
          constraint.reason = 'PBM_ABOVE_REFERENCE_REQUIRES_PRODUCT_DECISION';
      }
      result.push(constraint);
    }
    if (latest(1014)) {
      covered.add(1014);
      const ceiling = exact(latest(1014)),
        price = exact(latest(1016));
      const constraint: ProductConstraint = {
        kind: 'pbm-consumer-ceiling',
        scope,
        fieldTypes: [1014, 1016],
        raw: raw(rows),
        state: 'unresolved',
        reason: 'PBM_CEILING_CONTEXT_OR_SCALE_REQUIRED'
      };
      if (
        index !== 'unscoped' &&
        context.definition?.domain !== 'cancellation' &&
        ceiling &&
        price
      ) {
        constraint.state =
          decimalCompare(price, ceiling) <= 0 ? 'satisfied' : 'violated';
        constraint.reason =
          constraint.state === 'satisfied'
            ? 'PBM_CEILING_RESPECTED'
            : 'PBM_CONSUMER_CEILING_EXCEEDED';
      }
      result.push(constraint);
    }
  }
  const lists = observations.filter((field) =>
    [1115, 1323].includes(field.fieldType)
  );
  for (const id of [1122, 1123]) {
    const limit = observations.filter((field) => field.fieldType === id).at(-1);
    if (!limit) continue;
    covered.add(id);
    const constraint: ProductConstraint = {
      kind: id === 1122 ? 'product-count' : 'product-code-length',
      fieldTypes: [id, ...lists.map((field) => field.fieldType)],
      raw: raw([limit, ...lists]),
      state: 'unresolved',
      reason: 'PRODUCT_LIST_OR_LIMIT_CONTEXT_REQUIRED'
    };
    const count = /^\d+$/.test(limit.raw) ? BigInt(limit.raw) : undefined;
    if (
      count !== undefined &&
      count > 0n &&
      lists.length === 1 &&
      Array.isArray(lists[0].value)
    ) {
      const products = lists[0].value as Array<unknown>;
      if (id === 1122) {
        constraint.state =
          BigInt(products.length) <= count ? 'satisfied' : 'violated';
        constraint.reason =
          constraint.state === 'satisfied'
            ? 'PRODUCT_COUNT_WITHIN_LIMIT'
            : 'PRODUCT_COUNT_LIMIT_EXCEEDED';
      } else {
        const lengths = products.map((item) => {
          if (!item || typeof item !== 'object') return undefined;
          const code =
            'code' in item ? item.code : 'Id' in item ? item.Id : undefined;
          return typeof code === 'string'
            ? BigInt(nativeByteLength(code, options.nativeEncoding))
            : undefined;
        });
        if (lengths.every((length) => length !== undefined)) {
          if (
            lengths.some((length) => length !== undefined && length > count)
          ) {
            constraint.state = 'violated';
            constraint.reason = 'PRODUCT_CODE_LENGTH_EXCEEDED';
          } else if (lengths.every((length) => length === count)) {
            constraint.state = 'satisfied';
            constraint.reason = 'PRODUCT_CODE_LENGTH_MATCH';
          } else
            constraint.reason = 'PRODUCT_CODE_LENGTH_EXACT_OR_MAX_UNSPECIFIED';
        }
      }
    } else if (count === 0n)
      constraint.reason = 'ZERO_PRODUCT_LIMIT_MEANING_UNSPECIFIED';
    result.push(constraint);
  }
  const pending = new Map<number, TypedField>();
  for (const field of observations) {
    const action = field.definition?.action;
    if (
      !covered.has(field.fieldType) &&
      typeof action === 'object' &&
      action.requiredHook === 'validateTransaction' &&
      action.phase === 'beforeFinalize'
    )
      pending.set(field.fieldType, field);
  }
  if (pending.size)
    result.push({
      kind: 'documented-product-review',
      fieldTypes: [...pending.keys()],
      raw: raw([...pending.values()]),
      state: 'unresolved',
      reason: 'APPLICATION_MUST_REVIEW_DOCUMENTED_PRODUCT_CONSTRAINTS'
    });
  return result;
}

export class FieldProcessor {
  private formatHint?: string;
  private hintedSemantic?: Partial<FieldSemantic>;
  private precision = 2;
  private pricePrecision?: number;
  private quantityPrecision?: number;
  private receiptType?: string;
  private billIndex?: string;
  private nfpagType?: string;
  private resourcesLocked = false;
  private values = new Map<number, string>();
  readonly snapshot: FieldSnapshot = {
    fields: [],
    receipts: [],
    bills: {},
    nfpag: { maximum: undefined, types: {} },
    diagnostics: []
  };
  constructor(
    readonly options: FieldOptions,
    readonly context: FieldContext
  ) {}
  async process(exchange: UiRequest): Promise<UiRequest> {
    const id = exchange.fieldType,
      definition = fieldDefinition(id, this.options.context);
    if (exchange.command === 0) {
      this.values.set(id, exchange.buffer);
      if ([2470, 1121, 1126].includes(id)) {
        if (!/^\d+$/.test(exchange.buffer) || Number(exchange.buffer) > 100)
          throw new SitefError(
            'INVALID_PRECISION',
            'Precisão informada pela biblioteca inválida.'
          );
        if (id === 2470) this.precision = Number(exchange.buffer);
        else if (id === 1121) this.pricePrecision = Number(exchange.buffer);
        else this.quantityPrecision = Number(exchange.buffer);
      }
      if (id === 2355) {
        this.hintedSemantic = undefined;
        if (!/^(A|AN|LN|N|V\d+|S|M|Mc)$/.test(exchange.buffer)) {
          const resolved = await this.options.hooks?.resolveField?.(
            exchange,
            this.context
          );
          if (
            !resolved ||
            typeof resolved !== 'object' ||
            !('format' in resolved) ||
            typeof resolved.format !== 'string' ||
            !/^(A|AN|LN|N|V\d+|S|M|Mc|DDMMAAAA|DDMMAA|DDMM|AAAAMMDD|MMAAAA|MMAA|AAMM|HHMMSS)$/.test(
              resolved.format
            )
          )
            throw new SitefError(
              'UNKNOWN_FORMAT',
              'Formato de coleta exige mapeamento explícito pelo resolver.'
            );
          this.hintedSemantic = resolved as Partial<FieldSemantic>;
          this.formatHint = resolved.format;
        } else this.formatHint = exchange.buffer;
      }
      if (id === 123) this.receiptType = exchange.buffer;
      if (id === 607) {
        this.billIndex = exchange.buffer;
        this.snapshot.bills[this.billIndex] ??= [];
      }
      if (id === 161) {
        if (!/^\d+$/.test(exchange.buffer))
          throw new SitefError(
            'INVALID_PAYMENT_INDEX',
            'Índice de pagamento inválido.'
          );
        this.snapshot.paymentIndex = exchange.buffer;
      }
      if (id === 730) {
        if (
          !/^\d+$/.test(exchange.buffer) ||
          !Number.isSafeInteger(Number(exchange.buffer))
        )
          throw new SitefError('NFPAG_METADATA', 'Limite NFPAG inválido.');
        this.snapshot.nfpag.maximum = Number(exchange.buffer);
      }
      if (id === 731) {
        this.nfpagType = exchange.buffer;
        this.snapshot.nfpag.types[this.nfpagType] ??= { fields: [] };
      }
      if (id === 732) {
        if (!this.nfpagType)
          throw new SitefError(
            'NFPAG_METADATA',
            'Requisito NFPAG sem tipo anterior.'
          );
        const restriction = /^13\((\d+(?:,\d+)*)\)$/.exec(exchange.buffer);
        if (restriction)
          this.snapshot.nfpag.types[this.nfpagType].allowedNetworks =
            restriction[1].split(',');
        else if (/^\d{2}$/.test(exchange.buffer))
          this.snapshot.nfpag.types[this.nfpagType].fields.push(
            exchange.buffer
          );
        else
          throw new SitefError(
            'NFPAG_METADATA',
            'Requisito NFPAG não reconhecido.'
          );
      }
    }
    const format = [29, 30, 31, 34, 35, 41, 21, 42].includes(exchange.command)
      ? (this.formatHint ?? formatString(definition))
      : formatString(definition);
    const spec =
      typeof definition?.format === 'object' ? definition.format : undefined;
    const specificPrecision =
      spec?.scaleFromField === 1121
        ? this.pricePrecision
        : spec?.scaleFromField === 1126
          ? this.quantityPrecision
          : typeof spec?.scale === 'number'
            ? spec.scale
            : undefined;
    const decimalPlaces = format?.startsWith('V')
      ? Number(format.slice(1))
      : (specificPrecision ?? this.precision);
    const semantic: FieldSemantic = {
      known: !!definition,
      definition,
      format,
      decimalPlaces,
      choices:
        format === 'S' || format === 'M' || format === 'Mc'
          ? undefined
          : definition?.choices,
      menuConfirmation: format === 'Mc',
      canCancelBill:
        this.context.definition?.domain === 'corban' && [600, 601].includes(id),
      sensitive: exchange.command === 41 || definition?.sensitive === true,
      functionId: this.context.functionId,
      domain: this.context.definition?.domain ?? 'unknown',
      billIndex: this.billIndex
    };
    if (exchange.command !== 0 && this.hintedSemantic)
      Object.assign(semantic, this.hintedSemantic, {
        sensitive: semantic.sensitive || this.hintedSemantic.sensitive === true
      });
    if (format === 'S' && exchange.command !== 20 && this.options.yesNoValues) {
      const { yes, no } = this.options.yesNoValues;
      if (
        typeof yes !== 'string' ||
        typeof no !== 'string' ||
        !yes ||
        !no ||
        yes === no ||
        yes.includes('\0') ||
        no.includes('\0')
      )
        throw new SitefError(
          'INVALID_YESNO_VALUES',
          'Informe valores SIM/NÃO distintos e não vazios.'
        );
      semantic.choices = { [yes]: 'Sim', [no]: 'Não' };
    }
    let resolvedPrecision =
      specificPrecision !== undefined ||
      format?.startsWith('V') === true ||
      this.hintedSemantic?.decimalPlaces !== undefined;
    let request: UiRequest = { ...exchange, semantic };
    if (exchange.command === 0) {
      let value: unknown = structuredValue(
        exchange.buffer,
        definition,
        this.options
      );
      if (definition?.dataType === 'integer' && /^-?\d+$/.test(exchange.buffer))
        value = { integer: BigInt(exchange.buffer).toString() };
      if (definition?.dataType === 'enum')
        value = {
          code: exchange.buffer,
          label: definition.choices?.[exchange.buffer]
        };
      if (
        definition?.dataType === 'date' &&
        typeof definition.format === 'string'
      )
        value = dateParts(exchange.buffer, definition.format) ?? {
          raw: exchange.buffer,
          format: definition.format
        };
      const monetaryFormat = this.options.monetaryFormats?.[id];
      if (monetaryFormat)
        value = exactDecimal(exchange.buffer, 2, monetaryFormat);
      if (definition?.resolverRequired && this.options.hooks?.resolveField) {
        const resolved = await this.options.hooks.resolveField(
          request,
          this.context
        );
        if (resolved !== undefined) value = resolved;
      } else if (
        definition?.resolverRequired &&
        typeof definition.action === 'object' &&
        definition.action.requiredHook === 'resolveField' &&
        definition.action.phase !== 'beforeArithmetic'
      )
        throw new SitefError(
          'MISSING_FIELD_HANDLER',
          `Campo ${id} exige resolveField no contexto do produto.`
        );
      const typed = {
        fieldType: id,
        raw: exchange.buffer,
        value,
        definition,
        billIndex: this.billIndex,
        sensitive: semantic.sensitive
      };
      this.snapshot.fields.push(typed);
      if (this.billIndex) this.snapshot.bills[this.billIndex].push(typed);
      if ([121, 122, 120, 625].includes(id)) {
        const timing =
          this.context.definition?.receiptPolicy === 'immediate' ||
          ['04', '05'].includes(this.receiptType ?? '')
            ? 'immediate'
            : 'deferred';
        const receipt: Receipt = {
          id: `${this.context.paymentId}:${id}:${this.snapshot.receipts.length}`,
          fieldType: id,
          buffer: exchange.buffer,
          bufferBase64: exchange.bufferBase64,
          type: this.receiptType,
          timing,
          billIndex: this.billIndex,
          printed: false
        };
        if (timing === 'immediate') {
          await this.required('printReceipt', receipt);
          receipt.printed = true;
        }
        if (this.options.receiptStoragePolicy !== 'explicit-return')
          await this.required('storeReceipt', receipt);
        this.snapshot.receipts.push(receipt);
      }
      if ([4100, 4039, 5049, 5084].includes(id)) {
        const diagnostic = { fieldType: id, value: exchange.buffer };
        this.snapshot.diagnostics.push(diagnostic);
        await this.options.hooks?.onDiagnostic?.(diagnostic, this.context);
      }
      if (id === 5042 && !this.resourcesLocked) {
        if (!this.options.hooks?.unlockResources)
          throw new SitefError(
            'MISSING_FIELD_HANDLER',
            'Forneça unlockResources junto a lockResources.'
          );
        await this.required('lockResources', request);
        this.resourcesLocked = true;
      }
      if (id === 5043) {
        await this.required('unlockResources', request);
        this.resourcesLocked = false;
      }
      if (id === 5074) this.snapshot.signatureRequired = true;
    } else if (
      (definition?.resolverRequired || (format === 'S' && !semantic.choices)) &&
      this.options.hooks?.resolveField
    ) {
      const resolved = await this.options.hooks.resolveField(
        request,
        this.context
      );
      if (resolved && typeof resolved === 'object') {
        const patch = resolved as Partial<FieldSemantic>;
        request = {
          ...request,
          semantic: {
            ...semantic,
            ...patch,
            sensitive: semantic.sensitive || patch.sensitive === true
          }
        };
        if (patch.decimalPlaces !== undefined) resolvedPrecision = true;
      }
    }
    if (exchange.command !== 0 && spec?.scaleFromField && !resolvedPrecision)
      throw new SitefError(
        'PRECISION_REQUIRED',
        'O produto não informou a precisão específica; o resolver precisa fornecer decimalPlaces.'
      );
    if (
      exchange.command !== 0 &&
      !request.semantic?.format &&
      spec?.kind === 'decimal-comma' &&
      request.semantic
    )
      request.semantic.format = `V${request.semantic.decimalPlaces}`;
    if (
      request.semantic &&
      (!Number.isInteger(request.semantic.decimalPlaces) ||
        request.semantic.decimalPlaces < 0 ||
        request.semantic.decimalPlaces > 100)
    )
      throw new SitefError('INVALID_PRECISION', 'Precisão semântica inválida.');
    if (
      exchange.command !== 0 &&
      format === 'S' &&
      exchange.command !== 20 &&
      Object.keys(request.semantic?.choices ?? {}).length !== 2
    )
      throw new SitefError(
        'AMBIGUOUS_FORMAT',
        'Os dois valores SIM/NÃO devem ser resolvidos explicitamente.'
      );
    if ([29, 30, 31, 34, 35, 41, 21, 42].includes(exchange.command)) {
      this.formatHint = undefined;
      this.hintedSemantic = undefined;
    }
    if (exchange.command === 30 || exchange.command === 34) this.precision = 2;
    return request;
  }
  async required(
    name: keyof NonNullable<FieldOptions['hooks']>,
    value: unknown
  ): Promise<void> {
    const hook = this.options.hooks?.[name] as
      | ((value: unknown, context: FieldContext) => unknown)
      | undefined;
    if (!hook)
      throw new SitefError(
        'MISSING_FIELD_HANDLER',
        `Forneça o handler obrigatório ${name}.`
      );
    if ((await hook(value, this.context)) !== true)
      throw new SitefError(
        'FIELD_ACTION_FAILED',
        `O handler ${name} não confirmou a execução.`
      );
  }
  async finish(status: number): Promise<FieldSnapshot> {
    if (this.options.confirmationNetworkField)
      this.snapshot.network = this.values.get(
        this.options.confirmationNetworkField
      );
    else if (
      this.values.has(131) &&
      this.values.get(131) === this.values.get(158)
    )
      this.snapshot.network = this.values.get(131);
    else if (this.options.hooks?.resolveConfirmationNetwork)
      this.snapshot.network =
        await this.options.hooks.resolveConfirmationNetwork(
          this.snapshot,
          this.context
        );
    if (status !== 0) return this.snapshot;
    const assessment: TransactionAssessment = {
      issues: [],
      accepted: true,
      installmentFallback: false
    };
    this.snapshot.assessment = assessment;
    assessment.fields = this.snapshot.fields.map((field) => ({ ...field }));
    assessment.productConstraints = productConstraints(
      this.snapshot.fields,
      this.options,
      this.context
    );
    for (const constraint of assessment.productConstraints)
      if (constraint.state !== 'satisfied')
        assessment.issues.push(
          `${constraint.state === 'violated' ? 'PRODUCT_CONSTRAINT_VIOLATED' : 'PRODUCT_CONSTRAINT_REVIEW_REQUIRED'}:${constraint.reason}`
        );
    if (this.context.input.amount)
      assessment.inputAmount = exactDecimal(this.context.input.amount, 2);
    for (const [id, name] of [
      [109, 'approved'],
      [137, 'balance'],
      [138, 'received']
    ] as const) {
      const value = this.snapshot.fields
        .filter((x) => x.fieldType === id)
        .at(-1)?.value;
      if (
        value &&
        typeof value === 'object' &&
        'unscaled' in value &&
        'scale' in value
      )
        assessment[name] = value as ExactDecimal;
      else if (this.values.has(id))
        assessment.issues.push(`MONETARY_FORMAT_REQUIRED:${id}`);
    }
    if (assessment.balance && BigInt(assessment.balance.unscaled) !== 0n)
      assessment.issues.push('OUTSTANDING_BALANCE');
    if (assessment.received && assessment.inputAmount) {
      const comparison = decimalCompare(
        assessment.received,
        assessment.inputAmount
      );
      if (comparison !== 0)
        assessment.issues.push(
          comparison < 0 ? 'PARTIAL_PAYMENT' : 'CHANGE_REQUIRED'
        );
      if (comparison > 0)
        assessment.change = decimalSubtract(
          assessment.received,
          assessment.inputAmount
        );
    }
    if (this.values.has(4039) && !/^0+$/.test(this.values.get(4039)!)) {
      assessment.pbmError = this.values.get(4039);
      assessment.issues.push('PBM_DECLINED');
    }
    if (
      [16, 17].includes(this.context.functionId) &&
      this.context.definition?.finalizationPolicy === 'financial' &&
      this.context.definition.domain !== 'secure-card-read'
    ) {
      const field = this.context.functionId === 16 ? 2361 : 2363;
      assessment.installmentFallback = this.values.get(field) !== '1';
      if (assessment.installmentFallback) {
        assessment.issues.push('INSTALLMENT_FALLBACK');
        await this.required('acceptFallback', assessment);
      }
    }
    if (assessment.issues.length) {
      if (!this.options.hooks?.validateTransaction) assessment.accepted = false;
      else
        assessment.accepted =
          (await this.options.hooks.validateTransaction(
            assessment,
            this.context
          )) === true;
    }
    if (
      assessment.productConstraints.some(
        (constraint) => constraint.state === 'violated'
      )
    )
      assessment.accepted = false;
    this.snapshot.assessment = assessment;
    return this.snapshot;
  }
  async printDeferred(): Promise<void> {
    for (const receipt of this.snapshot.receipts)
      if (!receipt.printed) {
        await this.required('printReceipt', receipt);
        receipt.printed = true;
      }
    if (this.snapshot.signatureRequired && !this.snapshot.signatureCaptured) {
      await this.required('captureSignature', {
        paperRequired: true,
        receipts: this.snapshot.receipts
      });
      this.snapshot.signatureCaptured = true;
    }
  }
  async cleanup(): Promise<void> {
    if (this.resourcesLocked) {
      this.resourcesLocked = false;
      await this.required('unlockResources', { cleanup: true });
    }
  }
  async applicationData(request: UiRequest): Promise<UiResponse> {
    if (!this.options.hooks?.resolveApplicationData)
      throw new SitefError(
        'MISSING_FIELD_HANDLER',
        'Forneça resolveApplicationData para coleta sem operador.'
      );
    return this.options.hooks.resolveApplicationData(request, this.context);
  }
}
