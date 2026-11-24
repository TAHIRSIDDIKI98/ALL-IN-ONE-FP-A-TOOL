// Ported from fp-A-betterversion/src/utils/money.ts @ 86d785ca696c, merged with decimalUtils.ts (P06), cross-checked with fpa/src-tauri/src/core/money.rs @ 6f6f72f5b681 and FPA-modular/app/core/money.py @ 641d3d830573. Class B.
// Changes: Banned JS float inputs completely (construct only from string, Decimal, or integer minor units); eliminated epsilon `areClose` from decimalUtils.ts; enforced explicit scale + mode on `div` returning `null` on division by zero; implemented null-preserving `sumWithDisclosure` per MASTER_PROMPT §5.2–§5.4. Oracle: core/money/money.test.ts + fixtures/oracles/allocation/allocation_oracles.json.

import Decimal from 'decimal.js';
import { allocate, ZeroAllocationWeightsError, type AllocatedShare, type AllocationBucket } from './allocate.js';
import { parse, type ParsedAmount, type ParseLocale } from './parse.js';
import { findNumericMoneyViolations, serialize } from './serialize.js';

Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -40,
  toExpPos: 40,
});

export type Money = Decimal;

export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'DOWN' | 'UP' | 'FLOOR' | 'CEIL';

const ROUNDING_MAP: Record<RoundingMode, Decimal.Rounding> = {
  HALF_UP: Decimal.ROUND_HALF_UP,
  HALF_EVEN: Decimal.ROUND_HALF_EVEN,
  DOWN: Decimal.ROUND_DOWN,
  UP: Decimal.ROUND_UP,
  FLOOR: Decimal.ROUND_FLOOR,
  CEIL: Decimal.ROUND_CEIL,
};

export const STORAGE_SCALE = 6;

export const CURRENCY_SCALES: Readonly<Record<string, 0 | 2 | 3>> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  USD: 2,
  EUR: 2,
  GBP: 2,
  INR: 2,
  AUD: 2,
  CAD: 2,
  SGD: 2,
  CHF: 2,
  AED: 2,
  SAR: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  PLN: 2,
  BRL: 2,
  MXN: 2,
  NZD: 2,
  HKD: 2,
  ZAR: 2,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  JOD: 3,
  TND: 3,
};

export function scaleForCurrency(isoCode: string): 0 | 2 | 3 {
  const normalized = isoCode.trim().toUpperCase();
  const scale = CURRENCY_SCALES[normalized];
  if (scale === undefined) {
    throw new Error(`UNSUPPORTED_CURRENCY_ISO: "${isoCode}"`);
  }
  return scale;
}

/**
 * Construct a Decimal strictly from a canonical numeric string or existing Decimal.
 * Constructing from a JS `number` float is rejected (§5.2).
 */
export function money(input: string | Decimal): Decimal {
  if (input instanceof Decimal) {
    if (!input.isFinite() || input.isNaN()) {
      throw new Error('INVALID_MONEY: non-finite Decimal');
    }
    return input.isZero() ? new Decimal(0) : input;
  }
  if (typeof input !== 'string') {
    throw new Error(`BANNED_FLOAT_MONEY_CONSTRUCT: expected string or Decimal, got ${typeof input}`);
  }
  const trimmed = input.trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new Error(`INVALID_MONEY_STRING: "${input}" (use parse() for formatted user input)`);
  }
  const d = new Decimal(trimmed);
  if (!d.isFinite() || d.isNaN()) {
    throw new Error(`INVALID_MONEY_NON_FINITE: "${input}"`);
  }
  return d.isZero() ? new Decimal(0) : d;
}

/**
 * Construct a Decimal from integer minor units (e.g., 123456 at scale 2 -> 1234.56).
 */
export function fromMinorUnits(minor: bigint | number, scale: number): Decimal {
  if (!Number.isInteger(scale) || scale < 0 || scale > 12) {
    throw new Error(`INVALID_SCALE: ${String(scale)}`);
  }
  if (typeof minor === 'number') {
    if (!Number.isSafeInteger(minor)) {
      throw new Error(`BANNED_FLOAT_MINOR_UNITS: ${String(minor)} is not a safe integer`);
    }
    return new Decimal(minor.toString()).times(new Decimal(10).pow(-scale));
  }
  if (typeof minor === 'bigint') {
    return new Decimal(minor.toString()).times(new Decimal(10).pow(-scale));
  }
  throw new Error('INVALID_MINOR_UNITS_TYPE');
}

export function toMinorUnits(value: Decimal, scale: number): bigint {
  const rounded = round(value, scale, 'HALF_UP');
  const shifted = rounded.times(new Decimal(10).pow(scale)).toFixed(0);
  return BigInt(shifted);
}

export function add(a: Decimal, b: Decimal): Decimal {
  const res = a.plus(b);
  return res.isZero() ? new Decimal(0) : res;
}

export function sub(a: Decimal, b: Decimal): Decimal {
  const res = a.minus(b);
  return res.isZero() ? new Decimal(0) : res;
}

export function mul(a: Decimal, b: Decimal | string | number): Decimal {
  let factor: Decimal;
  if (b instanceof Decimal) {
    factor = b;
  } else if (typeof b === 'number') {
    if (!Number.isSafeInteger(b)) {
      throw new Error('BANNED_FLOAT_MULTIPLIER: pass string or Decimal for non-integer factors');
    }
    factor = new Decimal(b.toString());
  } else {
    factor = money(b);
  }
  const res = a.times(factor);
  return res.isZero() ? new Decimal(0) : res;
}

/**
 * Division Law (§5.3): requires explicit `scale` and `mode`.
 * Division by zero returns `null` (never Infinity, never 0).
 */
export function div(
  numerator: Decimal,
  denominator: Decimal,
  scale: number,
  mode: RoundingMode,
): Decimal | null {
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) {
    throw new Error(`INVALID_DIV_SCALE: ${String(scale)}`);
  }
  const rm = ROUNDING_MAP[mode];
  if (rm === undefined) {
    throw new Error(`INVALID_ROUNDING_MODE: ${String(mode)}`);
  }
  if (denominator.isZero()) {
    return null;
  }
  const quotient = numerator.dividedBy(denominator).toDecimalPlaces(scale, rm);
  return quotient.isZero() ? new Decimal(0) : quotient;
}

export function sum(values: readonly Decimal[]): Decimal {
  if (values.length === 0) {
    return new Decimal(0);
  }
  let acc = new Decimal(0);
  for (const v of values) {
    acc = acc.plus(v);
  }
  return acc.isZero() ? new Decimal(0) : acc;
}

/**
 * Null Law (§5.2): aggregations skip `null` and disclose missing count;
 * if ALL inputs are null, total is `null` (never coerced to 0).
 */
export function sumNullable(values: readonly (Decimal | null)[]): {
  readonly total: Decimal | null;
  readonly missingCount: number;
  readonly populatedCount: number;
} {
  let missingCount = 0;
  const present: Decimal[] = [];
  for (const v of values) {
    if (v === null) {
      missingCount += 1;
    } else {
      present.push(v);
    }
  }
  if (present.length === 0) {
    return { total: null, missingCount, populatedCount: 0 };
  }
  return {
    total: sum(present),
    missingCount,
    populatedCount: present.length,
  };
}

export function negate(value: Decimal): Decimal {
  if (value.isZero()) return new Decimal(0);
  return value.negated();
}

export function round(value: Decimal, scale: number, mode: RoundingMode = 'HALF_UP'): Decimal {
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) {
    throw new Error(`INVALID_ROUND_SCALE: ${String(scale)}`);
  }
  const rm = ROUNDING_MAP[mode];
  const r = value.toDecimalPlaces(scale, rm);
  return r.isZero() ? new Decimal(0) : r;
}

export function compare(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const c = a.cmp(b);
  if (c < 0) return -1;
  if (c > 0) return 1;
  return 0;
}

export function eq(a: Decimal, b: Decimal): boolean {
  return a.eq(b);
}

export function isZero(value: Decimal): boolean {
  return value.isZero();
}

export interface FormatMoneyOptions {
  readonly currency?: string;
  readonly scale?: number;
  readonly accountingParens?: boolean;
  readonly includeCurrencyCode?: boolean;
}

/**
 * Presentation formatting (display boundary ONLY — §5.2, §9.5, §9.7).
 */
export function format(value: Decimal | null, options?: FormatMoneyOptions): string | null {
  if (value === null) {
    return null;
  }
  const scale =
    options?.scale ?? (options?.currency ? scaleForCurrency(options.currency) : 2);
  const rounded = round(value, scale, 'HALF_UP');
  const isNeg = rounded.isNegative();
  const mag = isNeg ? rounded.negated() : rounded;
  const fixed = mag.toFixed(scale);
  const [intPart = '0', fracPart] = fixed.split('.');
  const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const numText = fracPart !== undefined ? `${groupedInt}.${fracPart}` : groupedInt;

  let signedText: string;
  if (isNeg) {
    signedText = options?.accountingParens ? `(${numText})` : `-${numText}`;
  } else {
    signedText = numText;
  }

  if (options?.includeCurrencyCode && options.currency) {
    return `${options.currency.toUpperCase()} ${signedText}`;
  }
  return signedText;
}

export {
  allocate,
  ZeroAllocationWeightsError,
  type AllocatedShare,
  type AllocationBucket,
  parse,
  type ParsedAmount,
  type ParseLocale,
  serialize,
  findNumericMoneyViolations,
};
