import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  generateFiscalYears,
  resolvePeriodForDate,
  selectMonthlyViewPeriods,
  selectQtdPeriods,
  selectTtmPeriods,
  selectYtdPeriods,
} from './index.js';

const ORACLE_DIR = join(process.cwd(), 'fixtures/oracles/calendar');

function daysInclusive(startIso: string, endIso: string): number {
  const s = Date.parse(`${startIso}T00:00:00Z`);
  const e = Date.parse(`${endIso}T00:00:00Z`);
  return Math.round((e - s) / 86_400_000) + 1;
}

describe('WI-0005 Fiscal Calendar Kernel & Q2 Class A Oracles (Ports P09, P10 — E9, S5)', () => {
  it('verifies Class A calendar oracle fixtures are byte-unmodified via SHA-256 checksums (P2)', () => {
    const manifest = JSON.parse(readFileSync(join(ORACLE_DIR, 'CHECKSUMS.json'), 'utf8')) as {
      files: Record<string, string>;
    };
    expect(Object.keys(manifest.files).length).toBe(4);
    for (const [filename, expectedSha] of Object.entries(manifest.files)) {
      const bytes = readFileSync(join(ORACLE_DIR, filename));
      const actualSha = createHash('sha256').update(bytes).digest('hex');
      expect(actualSha, `Checksum mismatch on Class A fixture ${filename}`).toBe(expectedSha);
    }
  });

  it('matches NRF 4-5-4 2024–2028 oracle exactly, including FY2028 53-week nrf4day & fullweek variants', () => {
    const oracle = JSON.parse(readFileSync(join(ORACLE_DIR, 'nrf-454-2024-2028.json'), 'utf8')) as {
      years: Array<{
        fy_label: string;
        start_date: string;
        end_date: string;
        week_count: number;
        period_count: number;
        fifty_third_period: null | { period_no: number; code: string };
      }>;
      full_week_variant_2028: {
        week_count: number;
        period_count: number;
        w53: { code: string; start_date: string; end_date: string };
      };
      retail_2026_spot_checks: Array<{
        period_no: number;
        code: string;
        start_date: string;
        end_date: string;
      }>;
    };

    const generated = generateFiscalYears({
      kind: '454',
      startYear: 2024,
      yearCount: 5,
      startMonth: 2,
      week53Rule: 'nrf4day',
    });

    expect(generated.length).toBe(oracle.years.length);

    for (let i = 0; i < oracle.years.length; i++) {
      const exp = oracle.years[i]!;
      const act = generated[i]!;
      expect(act.fyLabel).toBe(exp.fy_label);
      expect(act.startDate).toBe(exp.start_date);
      expect(act.endDate).toBe(exp.end_date);
      expect(act.weekCount).toBe(exp.week_count);
      expect(act.periods.length).toBe(exp.period_count);

      const flagged = act.periods.filter((p) => p.is53rdWeek);
      if (exp.fifty_third_period === null) {
        expect(flagged.length).toBe(0);
      } else {
        expect(flagged.length).toBe(1);
        expect(flagged[0]!.periodNo).toBe(exp.fifty_third_period.period_no);
        expect(flagged[0]!.code).toBe(exp.fifty_third_period.code);
      }
    }

    // Spot check FY2026 P06
    const fy2026 = generated.find((y) => y.fyLabel === 'FY2026')!;
    for (const spot of oracle.retail_2026_spot_checks) {
      const p = fy2026.periods.find((x) => x.periodNo === spot.period_no)!;
      expect(p.code).toBe(spot.code);
      expect(p.startDate).toBe(spot.start_date);
      expect(p.endDate).toBe(spot.end_date);
    }

    // Full-week variant on FY2028
    const fw2028 = generateFiscalYears({
      kind: '52_53',
      startYear: 2028,
      yearCount: 1,
      startMonth: 2,
      week53Rule: 'fullweek',
    })[0]!;
    expect(fw2028.weekCount).toBe(oracle.full_week_variant_2028.week_count);
    expect(fw2028.periods.length).toBe(oracle.full_week_variant_2028.period_count);
    const w53 = fw2028.periods[fw2028.periods.length - 1]!;
    expect(w53.code).toBe(oracle.full_week_variant_2028.w53.code);
    expect(w53.startDate).toBe(oracle.full_week_variant_2028.w53.start_date);
    expect(w53.endDate).toBe(oracle.full_week_variant_2028.w53.end_date);
    expect(w53.is53rdWeek).toBe(true);
  });

  it('satisfies Class A structural invariants for 5-4-4, 4-4-5, and 13x4 (nrf-3334) across 2024–2028', () => {
    const nrf544 = JSON.parse(readFileSync(join(ORACLE_DIR, 'nrf-544-expected.json'), 'utf8')) as {
      invariants: {
        periods_52_week_year: number;
        period_codes_52: string[];
        fifty_third_week: { w53_code: string };
      };
    };
    const nrf3334 = JSON.parse(readFileSync(join(ORACLE_DIR, 'nrf-3334-expected.json'), 'utf8')) as {
      invariants: {
        periods_total: number;
        period_codes: string[];
        fifty_third_week: { flagged_period: string };
      };
    };

    for (const kind of ['544', '445'] as const) {
      const yrs = generateFiscalYears({ kind, startYear: 2024, yearCount: 5 });
      for (const y of yrs) {
        let daySum = 0;
        for (let idx = 0; idx < y.periods.length; idx++) {
          const p = y.periods[idx]!;
          daySum += daysInclusive(p.startDate, p.endDate);
          if (idx > 0) {
            const prevEnd = Date.parse(`${y.periods[idx - 1]!.endDate}T00:00:00Z`);
            const curStart = Date.parse(`${p.startDate}T00:00:00Z`);
            expect(curStart - prevEnd).toBe(86_400_000);
          }
        }
        expect(daySum).toBe(y.weekCount * 7);
        if (y.weekCount === 52) {
          expect(y.periods.length).toBe(nrf544.invariants.periods_52_week_year);
          expect(y.periods.map((p) => p.code)).toEqual(nrf544.invariants.period_codes_52);
        } else {
          expect(y.periods.length).toBe(13);
          expect(y.periods[12]!.code).toBe(nrf544.invariants.fifty_third_week.w53_code);
          expect(y.periods[12]!.is53rdWeek).toBe(true);
        }
      }
    }

    const yrs13x4 = generateFiscalYears({ kind: '13x4', startYear: 2024, yearCount: 5 });
    for (const y of yrs13x4) {
      expect(y.periods.length).toBe(nrf3334.invariants.periods_total);
      expect(y.periods.map((p) => p.code)).toEqual(nrf3334.invariants.period_codes);
      const daySum = y.periods.reduce((acc, p) => acc + daysInclusive(p.startDate, p.endDate), 0);
      expect(daySum).toBe(y.weekCount * 7);
      if (y.weekCount === 53) {
        const p13 = y.periods[12]!;
        expect(p13.code).toBe(nrf3334.invariants.fifty_third_week.flagged_period);
        expect(p13.is53rdWeek).toBe(true);
        expect(daysInclusive(p13.startDate, p13.endDate)).toBe(35);
      }
    }
  });

  it('handles 12-month leap years, adjustment period exclusion, YTD/QTD, and partial TTM disclosure (§5.8)', () => {
    const leapYear = generateFiscalYears({
      kind: '12month',
      startYear: 2024,
      yearCount: 1,
      startMonth: 1,
      includeAdjustmentPeriod: true,
    })[0]!;

    expect(leapYear.periods.length).toBe(13);
    expect(leapYear.periods[1]!.endDate).toBe('2024-02-29'); // leap year Feb
    expect(selectMonthlyViewPeriods(leapYear.periods).length).toBe(12);

    const febHit = resolvePeriodForDate(leapYear.periods, '2024-02-29');
    expect(febHit?.code).toBe('P02');

    const ytdP09 = selectYtdPeriods(leapYear.periods, 'P09');
    expect(ytdP09.periods.length).toBe(9);
    expect(ytdP09.basisLabel).toBe('YTD P01–P09, excl. adjustment');

    const ytdP13 = selectYtdPeriods(leapYear.periods, 'P13');
    expect(ytdP13.periods.length).toBe(13);
    expect(ytdP13.basisLabel).toBe('YTD P01–P13, incl. adjustment');

    const qtdQ3 = selectQtdPeriods(leapYear.periods, 'P08');
    expect(qtdQ3.periods.map((p) => p.code)).toEqual(['P07', 'P08']);

    const ttmPartial = selectTtmPeriods(leapYear.periods, 'FY2024', 'P05');
    expect(ttmPartial.isPartial).toBe(true);
    expect(ttmPartial.periods.length).toBe(5);
    expect(ttmPartial.basisLabel).toContain('Partial TTM (5/12 periods populated');
  });
});
