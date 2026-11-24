// Ported from fp-A-betterversion/src/utils/moneySerialize.ts @ 86d785ca696c. Class B.
// Changes: Removed in-memory float hydration concession (`$d:`->number); money crosses all JSON/API boundaries exclusively as canonical decimal strings with strict numeric-payload detection (MASTER_PROMPT §5.2 E11). Oracle: core/money/money.test.ts.

import Decimal from 'decimal.js';

export function serialize(value: Decimal, scale?: number): string {
  if (!(value instanceof Decimal) || !value.isFinite() || value.isNaN()) {
    throw new Error('INVALID_MONEY_SERIALIZE: expected finite Decimal instance');
  }
  if (scale !== undefined) {
    if (!Number.isInteger(scale) || scale < 0 || scale > 12) {
      throw new Error(`INVALID_MONEY_SCALE: ${String(scale)}`);
    }
    const rounded = value.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
    if (rounded.isZero()) {
      return new Decimal('0').toFixed(scale);
    }
    return rounded.toFixed(scale);
  }
  if (value.isZero()) {
    return '0';
  }
  return value.toFixed();
}

const MONEY_FIELD_NAMES = new Set([
  'amount',
  'debit',
  'credit',
  'totaldebit',
  'totalcredit',
  'balance',
  'openingbalance',
  'closingbalance',
  'revenue',
  'expense',
  'cogs',
  'opex',
  'capex',
  'ebitda',
  'netincome',
  'variance',
  'varianceamount',
  'actual',
  'plan',
  'budget',
  'cash',
  'assets',
  'liabilities',
  'equity',
]);

export function findNumericMoneyViolations(payload: unknown, path = '$'): string[] {
  const violations: string[] = [];
  if (Array.isArray(payload)) {
    payload.forEach((item, idx) => {
      violations.push(...findNumericMoneyViolations(item, `${path}[${idx}]`));
    });
    return violations;
  }
  if (typeof payload === 'object' && payload !== null) {
    for (const [key, val] of Object.entries(payload)) {
      const normalizedKey = key.replace(/[_-]/g, '').toLowerCase();
      const childPath = `${path}.${key}`;
      if (typeof val === 'number' && MONEY_FIELD_NAMES.has(normalizedKey)) {
        violations.push(`${childPath}: money crossed boundary as JS number (${String(val)})`);
      } else {
        violations.push(...findNumericMoneyViolations(val, childPath));
      }
    }
  }
  return violations;
}
