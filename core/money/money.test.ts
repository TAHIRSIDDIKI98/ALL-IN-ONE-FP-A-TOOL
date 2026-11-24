import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  add,
  allocate,
  compare,
  div,
  eq,
  findNumericMoneyViolations,
  format,
  fromMinorUnits,
  isZero,
  money,
  mul,
  negate,
  parse,
  round,
  scaleForCurrency,
  serialize,
  sub,
  sum,
  sumNullable,
  toMinorUnits,
  ZeroAllocationWeightsError,
} from './index.js';

interface OracleCase {
  id: string;
  amount: string;
  scale: number;
  buckets: { key: string; weight: string }[];
  expected: Record<string, string>;
}

// Deterministic xorshift32 PRNG for reproducible 10,000-case invariant suite (§5.4)
function createSeededRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

describe('WI-0004 Money Kernel Contracts (Ports P05, P06, P07, P08, P20 — E1..E4, E11)', () => {
  it('enforces currency scales 0 (JPY/KRW), 2 (USD/EUR/GBP/INR), 3 (KWD/BHD/OMR) and rejects float construction', () => {
    expect(scaleForCurrency('JPY')).toBe(0);
    expect(scaleForCurrency('KRW')).toBe(0);
    expect(scaleForCurrency('USD')).toBe(2);
    expect(scaleForCurrency('INR')).toBe(2);
    expect(scaleForCurrency('KWD')).toBe(3);
    expect(scaleForCurrency('OMR')).toBe(3);
    expect(() => scaleForCurrency('ZZZ')).toThrow(/UNSUPPORTED_CURRENCY_ISO/);

    // Exact decimal arithmetic: 0.1 + 0.2 == 0.3
    expect(eq(add(money('0.1'), money('0.2')), money('0.3'))).toBe(true);
    expect(serialize(fromMinorUnits(123456, 2), 2)).toBe('1234.56');
    expect(toMinorUnits(money('1234.56'), 2)).toBe(123456n);

    // Reject float inputs
    expect(() => money(12.34 as unknown as string)).toThrow(/BANNED_FLOAT_MONEY_CONSTRUCT/);
    expect(() => fromMinorUnits(12.5, 2)).toThrow(/BANNED_FLOAT_MINOR_UNITS/);
  });

  it('parses all §5.2 formats, maps blanks/em-dash/n-a to null, and quarantines ambiguity (E2)', () => {
    const cases: Array<[string, string]> = [
      ['1,234.56', '1234.56'],
      ['(1,234.56)', '-1234.56'],
      ['1.234,56', '1234.56'],
      ['1234.56-', '-1234.56'],
      ['$ 1,234.56', '1234.56'],
      ['1 234,56', '1234.56'],
      ['(€ 2.500,75)', '-2500.75'],
      ['0.00', '0'],
    ];
    for (const [raw, expected] of cases) {
      const res = parse(raw);
      expect(res.kind, `Failed on "${raw}"`).toBe('value');
      if (res.kind === 'value') {
        expect(res.canonical).toBe(expected);
      }
    }

    // Null law: never 0
    for (const emptyToken of ['', '   ', '—', '-', 'n/a', 'N/A', null, undefined]) {
      expect(parse(emptyToken)).toEqual({ kind: 'null' });
    }

    // Ambiguous single-separator 3-digit input with unknown locale -> quarantine with reason
    const amb = parse('1,234', 'unknown');
    expect(amb.kind).toBe('quarantine');
    if (amb.kind === 'quarantine') {
      expect(amb.reason).toContain('AMBIGUOUS_SINGLE_SEPARATOR_3DP');
    }

    // Explicit locale resolves unambiguously
    const usResolved = parse('1,234', 'us');
    expect(usResolved.kind === 'value' && usResolved.canonical).toBe('1234');
  });

  it('rounds HALF_UP at boundaries, preserves full intermediate precision, and returns null on div-by-zero (E3)', () => {
    // Classic float traps: 1.005 and 2.675
    expect(serialize(round(money('1.005'), 2, 'HALF_UP'), 2)).toBe('1.01');
    expect(serialize(round(money('2.675'), 2, 'HALF_UP'), 2)).toBe('2.68');
    expect(serialize(round(money('-1.005'), 2, 'HALF_UP'), 2)).toBe('-1.01');

    // Full intermediate precision: (100 / 3 implied via mul/div at end)
    const unitPrice = div(money('100'), money('3'), 12, 'HALF_UP');
    expect(unitPrice).not.toBeNull();
    if (unitPrice) {
      const recovered = round(mul(unitPrice, 3), 2, 'HALF_UP');
      expect(serialize(recovered, 2)).toBe('100.00');
    }

    // Division by zero returns null (never Infinity, never 0)
    expect(div(money('500.00'), money('0'), 4, 'HALF_UP')).toBeNull();

    // Null law on aggregations
    const agg = sumNullable([money('10.50'), null, money('4.25'), null]);
    expect(agg.missingCount).toBe(2);
    expect(agg.populatedCount).toBe(2);
    expect(agg.total && serialize(agg.total, 2)).toBe('14.75');

    const allNull = sumNullable([null, null]);
    expect(allNull.total).toBeNull();
    expect(allNull.missingCount).toBe(2);
  });

  it('satisfies hand-computed allocation oracle fixtures and 10,000 seeded random cases (E4)', () => {
    const rawJson = readFileSync(
      join(process.cwd(), 'fixtures/oracles/allocation/allocation_oracles.json'),
      'utf8',
    );
    const oracleFile = JSON.parse(rawJson) as { cases: OracleCase[] };

    for (const c of oracleFile.cases) {
      const allocated = allocate(money(c.amount), c.buckets, c.scale);
      const actualMap: Record<string, string> = {};
      for (const share of allocated) {
        actualMap[share.key] = serialize(share.amount, c.scale);
      }
      expect(actualMap, `Oracle mismatch on ${c.id}`).toEqual(c.expected);
      expect(eq(sum(allocated.map((s) => s.amount)), money(c.amount))).toBe(true);
    }

    // All-zero weights -> explicit typed error
    expect(() =>
      allocate(
        money('100.00'),
        [
          { key: 'a', weight: 0 },
          { key: 'b', weight: 0 },
        ],
        2,
      ),
    ).toThrow(ZeroAllocationWeightsError);

    // 10,000 seeded randomized cases: assert exact sum in both Decimal AND independent BigInt minor units
    const nextRand = createSeededRng(20261124);
    const scales = [0, 2, 3] as const;

    for (let i = 0; i < 10_000; i++) {
      const scale = scales[nextRand() % scales.length] ?? 2;
      const rawMinor = BigInt((nextRand() % 2_000_000) - 1_000_000);
      const parent = fromMinorUnits(rawMinor, scale);
      const bucketCount = (nextRand() % 7) + 1;
      const buckets: { key: string; weight: number }[] = [];
      let nonZeroCount = 0;
      for (let b = 0; b < bucketCount; b++) {
        const w = nextRand() % 25;
        if (w > 0) nonZeroCount += 1;
        buckets.push({ key: `b_${String((b * 7 + i) % 19).padStart(2, '0')}_${b}`, weight: w });
      }
      if (nonZeroCount === 0) {
        buckets[0] = { key: buckets[0]!.key, weight: 1 };
      }

      const shares = allocate(parent, buckets, scale);
      // Independent BigInt minor-unit sum check (no reliance on Decimal.plus)
      let minorSum = 0n;
      for (let idx = 0; idx < shares.length; idx++) {
        const sh = shares[idx]!;
        minorSum += toMinorUnits(sh.amount, scale);
        if (buckets[idx]!.weight === 0) {
          expect(isZero(sh.amount)).toBe(true);
        }
      }
      expect(minorSum).toBe(rawMinor);
    }
  });

  it('enforces string serialization across boundaries (E11) and sums 10,000 values in < 50ms (§5.10)', () => {
    expect(serialize(sub(money('50.25'), money('10.25')), 2)).toBe('40.00');
    expect(serialize(negate(money('12.34')), 2)).toBe('-12.34');
    expect(compare(money('10.01'), money('10.00'))).toBe(1);
    expect(format(money('-1234.5'), { currency: 'USD', accountingParens: true, includeCurrencyCode: true })).toBe(
      'USD (1,234.50)',
    );
    expect(format(null, { currency: 'USD' })).toBeNull();

    expect(
      findNumericMoneyViolations({
        companyId: 'abc',
        lines: [{ account: '1000', debit: '100.00', credit: 0 }],
      }),
    ).toEqual(['$.lines[0].credit: money crossed boundary as JS number (0)']);

    expect(
      findNumericMoneyViolations({
        companyId: 'abc',
        lines: [{ account: '1000', debit: '100.00', credit: '0.000000' }],
      }),
    ).toEqual([]);

    const tenThousand = Array.from({ length: 10_000 }, () => money('123.45'));
    const t0 = performance.now();
    const total = sum(tenThousand);
    const elapsedMs = performance.now() - t0;
    expect(serialize(total, 2)).toBe('1234500.00');
    expect(elapsedMs).toBeLessThan(50);
  });

  it('satisfies algebraic property laws (associativity, commutativity, additive identity, inverse — §11.14 TST1)', () => {
    const nextRand = createSeededRng(1114001);
    const zero = money('0');

    for (let i = 0; i < 1_000; i++) {
      const aMinor = BigInt((nextRand() % 2_000_000) - 1_000_000);
      const bMinor = BigInt((nextRand() % 2_000_000) - 1_000_000);
      const cMinor = BigInt((nextRand() % 2_000_000) - 1_000_000);
      const a = fromMinorUnits(aMinor, 2);
      const b = fromMinorUnits(bMinor, 2);
      const c = fromMinorUnits(cMinor, 2);

      // Commutativity: a + b == b + a
      expect(eq(add(a, b), add(b, a))).toBe(true);
      // Associativity: (a + b) + c == a + (b + c)
      expect(eq(add(add(a, b), c), add(a, add(b, c)))).toBe(true);
      // Identity: a + 0 == a
      expect(eq(add(a, zero), a)).toBe(true);
      // Inverse: a + (-a) == 0 and a - b == a + (-b)
      expect(isZero(add(a, negate(a)))).toBe(true);
      expect(eq(sub(a, b), add(a, negate(b)))).toBe(true);
      // Exact agreement with independent BigInt minor-unit sum
      expect(toMinorUnits(add(add(a, b), c), 2)).toBe(aMinor + bMinor + cMinor);
    }
  });
});
