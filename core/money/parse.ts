// Ported from fp-A-betterversion/src/utils/parseFinancialAmount.ts @ 86d785ca696c. Class B.
// Changes: Replaced NaN/float return with explicit discriminated union (`{ kind: 'value' | 'null' | 'quarantine' }`); blank/em-dash/n-a return null (never 0), and ambiguous single-separator 3-digit inputs like "1,234" without explicit locale quarantine with reason instead of guessing (MASTER_PROMPT §5.2 E2). Oracle: core/money/money.test.ts.

import Decimal from 'decimal.js';

export type ParseLocale = 'unknown' | 'us' | 'eu';

export type ParsedAmount =
  | { readonly kind: 'value'; readonly value: Decimal; readonly canonical: string }
  | { readonly kind: 'null' }
  | { readonly kind: 'quarantine'; readonly reason: string };

const NULL_TOKENS = new Set(['', '-', '—', '–', 'n/a', 'na', 'null', 'nil']);
const CURRENCY_STRIP = /[$€£¥₹¤]/g;
const SPACE_VARIANTS = /[\u00A0\u2007\u202F]/g;

function validateThreeDigitGroups(intPart: string, sep: string): string | null {
  const groups = intPart.split(sep);
  if (groups.length < 2) return null;
  if (!/^\d{1,3}$/.test(groups[0] ?? '')) return null;
  for (let i = 1; i < groups.length; i++) {
    if (!/^\d{3}$/.test(groups[i] ?? '')) return null;
  }
  return groups.join('');
}

export function parse(raw: string | null | undefined, locale: ParseLocale = 'unknown'): ParsedAmount {
  if (raw === null || raw === undefined) {
    return { kind: 'null' };
  }
  if (typeof raw !== 'string') {
    return { kind: 'quarantine', reason: 'AMOUNT_NOT_STRING' };
  }

  const trimmed = raw.replace(SPACE_VARIANTS, ' ').trim();
  if (NULL_TOKENS.has(trimmed.toLowerCase())) {
    return { kind: 'null' };
  }

  let s = trimmed.replace(CURRENCY_STRIP, '').trim();
  if (NULL_TOKENS.has(s.toLowerCase())) {
    return { kind: 'null' };
  }

  let negative = false;
  const parenMatch = /^\((.*)\)$/.exec(s);
  if (parenMatch) {
    negative = true;
    s = (parenMatch[1] ?? '').replace(CURRENCY_STRIP, '').trim();
  } else if (s.startsWith('-') || s.startsWith('+')) {
    negative = s.startsWith('-');
    s = s.slice(1).replace(CURRENCY_STRIP, '').trim();
  } else if (/\d-$/.test(s)) {
    negative = true;
    s = s.slice(0, -1).trim();
  }

  if (s.length === 0 || !/\d/.test(s)) {
    return { kind: 'quarantine', reason: 'AMOUNT_NO_DIGITS' };
  }

  if (!/^[0-9., ]+$/.test(s)) {
    return { kind: 'quarantine', reason: 'AMOUNT_INVALID_CHARACTERS' };
  }

  // Handle space-grouped thousands, e.g. "1 234,56" or "1 234.56" or "1 234 567"
  const hasSpaces = s.includes(' ');
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  let normalized = '';

  if (hasSpaces) {
    if (hasComma && hasDot) {
      return { kind: 'quarantine', reason: 'AMOUNT_MIXED_SPACE_AND_BOTH_SEPARATORS' };
    }
    const decSep = hasComma ? ',' : hasDot ? '.' : '';
    const parts = decSep ? s.split(decSep) : [s];
    if (parts.length > 2) {
      return { kind: 'quarantine', reason: 'AMOUNT_MULTIPLE_DECIMAL_SEPARATORS' };
    }
    const intGroups = validateThreeDigitGroups(parts[0] ?? '', ' ');
    if (intGroups === null) {
      return { kind: 'quarantine', reason: 'AMOUNT_INVALID_SPACE_GROUPING' };
    }
    const frac = parts[1];
    if (frac !== undefined && !/^\d+$/.test(frac)) {
      return { kind: 'quarantine', reason: 'AMOUNT_INVALID_FRACTION' };
    }
    normalized = frac !== undefined ? `${intGroups}.${frac}` : intGroups;
  } else if (hasComma && hasDot) {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    const decSep = lastComma > lastDot ? ',' : '.';
    const grpSep = decSep === ',' ? '.' : ',';
    const parts = s.split(decSep);
    if (parts.length !== 2) {
      return { kind: 'quarantine', reason: 'AMOUNT_MULTIPLE_DECIMAL_SEPARATORS' };
    }
    const intRaw = parts[0] ?? '';
    const fracRaw = parts[1] ?? '';
    if (!/^\d+$/.test(fracRaw)) {
      return { kind: 'quarantine', reason: 'AMOUNT_INVALID_FRACTION' };
    }
    const intClean = intRaw.includes(grpSep) ? validateThreeDigitGroups(intRaw, grpSep) : intRaw;
    if (intClean === null || !/^\d+$/.test(intClean)) {
      return { kind: 'quarantine', reason: 'AMOUNT_INVALID_THOUSANDS_GROUPING' };
    }
    normalized = `${intClean}.${fracRaw}`;
  } else if (hasComma || hasDot) {
    const sep = hasComma ? ',' : '.';
    const occurrences = s.split(sep).length - 1;
    if (occurrences > 1) {
      // Multiple identical separators, e.g. "1,234,567" or "1.234.567" -> unambiguous thousands grouping
      const grouped = validateThreeDigitGroups(s, sep);
      if (grouped === null) {
        return { kind: 'quarantine', reason: 'AMOUNT_INVALID_THOUSANDS_GROUPING' };
      }
      normalized = grouped;
    } else {
      // Single separator occurrence
      const [left = '', right = ''] = s.split(sep);
      if (!/^\d+$/.test(left) || !/^\d+$/.test(right)) {
        return { kind: 'quarantine', reason: 'AMOUNT_MALFORMED_SEPARATOR' };
      }

      if (right.length === 3 && /^\d{1,3}$/.test(left) && left !== '0') {
        // Classic ambiguity: "1,234" or "1.234" — is it 1234 or 1.234?
        if (locale === 'unknown') {
          return {
            kind: 'quarantine',
            reason: `AMBIGUOUS_SINGLE_SEPARATOR_3DP:${trimmed}`,
          };
        }
        if ((locale === 'us' && sep === ',') || (locale === 'eu' && sep === '.')) {
          normalized = `${left}${right}`;
        } else {
          normalized = `${left}.${right}`;
        }
      } else if (sep === ',' && right.length !== 1 && right.length !== 2 && locale === 'unknown') {
        return {
          kind: 'quarantine',
          reason: `AMBIGUOUS_COMMA_SCALE:${trimmed}`,
        };
      } else {
        normalized = `${left}.${right}`;
      }
    }
  } else {
    normalized = s;
  }

  let dec: Decimal;
  try {
    dec = new Decimal(negative ? `-${normalized}` : normalized);
  } catch {
    return { kind: 'quarantine', reason: 'AMOUNT_DECIMAL_CONSTRUCT_FAILED' };
  }

  if (!dec.isFinite() || dec.isNaN()) {
    return { kind: 'quarantine', reason: 'AMOUNT_NON_FINITE' };
  }

  // Normalize "-0" to "0"
  if (dec.isZero()) {
    const zero = new Decimal('0');
    return { kind: 'value', value: zero, canonical: '0' };
  }

  return { kind: 'value', value: dec, canonical: dec.toFixed() };
}
