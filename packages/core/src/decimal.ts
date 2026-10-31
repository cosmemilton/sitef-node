import { SitefError } from './errors.js';
import type { ExactDecimal } from './semantic-types.js';

export function exactDecimal(
  text: string,
  scale = 2,
  format: 'decimal-comma' | 'minor-units' = 'decimal-comma'
): ExactDecimal {
  if (!Number.isInteger(scale) || scale < 0 || scale > 100)
    throw new SitefError(
      'INVALID_PRECISION',
      'Precisão deve estar entre 0 e 100.'
    );
  if (format === 'minor-units') {
    if (!/^-?\d+$/.test(text))
      throw new SitefError(
        'INVALID_DECIMAL',
        'Esperado inteiro decimal sem separador.'
      );
    return { unscaled: BigInt(text).toString(), scale };
  }
  const parts = /^(-?)(\d+)(?:,(\d+))?$/.exec(text);
  if (!parts || (parts[3]?.length ?? 0) > scale)
    throw new SitefError(
      'INVALID_DECIMAL',
      'Valor decimal fora do formato ou precisão informados.'
    );
  return {
    unscaled: BigInt(
      parts[1] + parts[2] + (parts[3] ?? '').padEnd(scale, '0')
    ).toString(),
    scale
  };
}
export function decimalText(value: ExactDecimal): string {
  const raw = BigInt(value.unscaled),
    sign = raw < 0n ? '-' : '';
  const digits = (raw < 0n ? -raw : raw)
    .toString()
    .padStart(value.scale + 1, '0');
  return (
    sign +
    (value.scale === 0
      ? digits
      : digits.slice(0, -value.scale) + ',' + digits.slice(-value.scale))
  );
}
export function decimalCompare(a: ExactDecimal, b: ExactDecimal): number {
  const scale = Math.max(a.scale, b.scale);
  const x = BigInt(a.unscaled) * 10n ** BigInt(scale - a.scale),
    y = BigInt(b.unscaled) * 10n ** BigInt(scale - b.scale);
  return x < y ? -1 : x > y ? 1 : 0;
}
export function decimalSubtract(
  a: ExactDecimal,
  b: ExactDecimal
): ExactDecimal {
  const scale = Math.max(a.scale, b.scale);
  return {
    unscaled: (
      BigInt(a.unscaled) * 10n ** BigInt(scale - a.scale) -
      BigInt(b.unscaled) * 10n ** BigInt(scale - b.scale)
    ).toString(),
    scale
  };
}
export function decimalSum(values: ExactDecimal[]): ExactDecimal {
  const scale = Math.max(0, ...values.map((x) => x.scale));
  return {
    unscaled: values
      .reduce(
        (sum, x) => sum + BigInt(x.unscaled) * 10n ** BigInt(scale - x.scale),
        0n
      )
      .toString(),
    scale
  };
}
