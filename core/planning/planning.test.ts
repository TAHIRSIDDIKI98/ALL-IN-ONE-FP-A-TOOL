import { describe, expect, it } from 'vitest';
import {
  buildRollingForecast,
  compareScenarios,
  computeDriverPlan,
  type DriverDefinition,
} from './index.js';

describe('M2 Planning Engine — Driver-Based Plan (/core/planning)', () => {
  it('computes fixed, growth_rate, price_times_volume, and topologically ordered percent_of_account drivers against hand-computed oracles', () => {
    // Hand-computed oracle for P01, P02, P03:
    // 4000 Revenue (price_times_volume):
    //   P01: 100.00 * 50 = 5000.00
    //   P02: 100.00 * 60 = 6000.00
    //   P03: 105.00 * 60 = 6300.00
    //   Total 4000 = 17300.00
    // 5000 COGS (percent_of_account: 35% of 4000 — listed BEFORE 4000 to prove topological sort):
    //   P01: 5000.00 * 0.35 = 1750.00
    //   P02: 6000.00 * 0.35 = 2100.00
    //   P03: 6300.00 * 0.35 = 2205.00
    //   Total 5000 = 6055.00
    // 6100 Hosting (growth_rate: base 1000.00, +10% per period):
    //   P01: 1000.00
    //   P02: 1100.00
    //   P03: 1210.00
    //   Total 6100 = 3310.00
    // 6200 Rent (fixed: 2500.00, with P03 override 2750.00):
    //   P01: 2500.00, P02: 2500.00, P03: 2750.00
    //   Total 6200 = 7750.00
    // Period totals:
    //   P01: 5000 + 1750 + 1000 + 2500 = 10250.00
    //   P02: 6000 + 2100 + 1100 + 2500 = 11700.00
    //   P03: 6300 + 2205 + 1210 + 2750 = 12465.00
    // Grand total: 10250 + 11700 + 12465 = 34415.00
    const drivers: DriverDefinition[] = [
      {
        kind: 'percent_of_account',
        driverKey: 'drv_cogs_pct',
        accountCode: '5000',
        assumptionLabel: 'COGS at 35% of Revenue (assumption)',
        sourceAccountCode: '4000',
        ratio: '0.35',
      },
      {
        kind: 'price_times_volume',
        driverKey: 'drv_rev_pv',
        accountCode: '4000',
        assumptionLabel: 'Widget price x units (assumption)',
        unitPriceByPeriod: { P01: '100.00', P02: '100.00', P03: '105.00' },
        volumeByPeriod: { P01: '50', P02: '60', P03: '60' },
      },
      {
        kind: 'growth_rate',
        driverKey: 'drv_hosting_growth',
        accountCode: '6100',
        assumptionLabel: 'Hosting +10% MoM (assumption)',
        baseAmount: '1000.00',
        ratePerPeriod: '0.10',
      },
      {
        kind: 'fixed',
        driverKey: 'drv_rent_fixed',
        accountCode: '6200',
        assumptionLabel: 'Office lease (assumption)',
        amount: '2500.00',
        periodOverrides: { P03: '2750.00' },
      },
    ];

    const result = computeDriverPlan({
      periods: ['P01', 'P02', 'P03'],
      drivers,
      currencyScale: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.totalsByAccount).toEqual({
      '4000': '17300.00',
      '5000': '6055.00',
      '6100': '3310.00',
      '6200': '7750.00',
    });
    expect(result.totalsByPeriod).toEqual({
      P01: '10250.00',
      P02: '11700.00',
      P03: '12465.00',
    });
    expect(result.grandTotal).toBe('34415.00');

    const p03Rent = result.lines.find((l) => l.accountCode === '6200' && l.periodCode === 'P03');
    expect(p03Rent).toEqual({
      accountCode: '6200',
      periodCode: 'P03',
      amount: '2750.00',
      source: 'override',
      driverKey: 'drv_rent_fixed',
      assumptionLabel: 'Office lease (assumption)',
    });

    const p03Cogs = result.lines.find((l) => l.accountCode === '5000' && l.periodCode === 'P03');
    expect(p03Cogs?.amount).toBe('2205.00');
    expect(p03Cogs?.source).toBe('driver');
  });

  it('rejects cycles, self-references, unknown sources, duplicate accounts, and bad periods', () => {
    const cycleRes = computeDriverPlan({
      periods: ['P01'],
      drivers: [
        {
          kind: 'percent_of_account',
          driverKey: 'd1',
          accountCode: '5000',
          assumptionLabel: 'A',
          sourceAccountCode: '6000',
          ratio: '0.5',
        },
        {
          kind: 'percent_of_account',
          driverKey: 'd2',
          accountCode: '6000',
          assumptionLabel: 'B',
          sourceAccountCode: '5000',
          ratio: '0.5',
        },
      ],
    });
    expect(cycleRes.ok).toBe(false);
    if (!cycleRes.ok) {
      expect(cycleRes.issues).toEqual(['CYCLE_DETECTED:5000,6000']);
    }

    const selfRes = computeDriverPlan({
      periods: ['P01'],
      drivers: [
        {
          kind: 'percent_of_account',
          driverKey: 'd_self',
          accountCode: '4000',
          assumptionLabel: 'Self',
          sourceAccountCode: '4000',
          ratio: '0.1',
        },
      ],
    });
    expect(selfRes.ok).toBe(false);
    if (!selfRes.ok) {
      expect(selfRes.issues).toEqual(['SELF_REFERENCE_DRIVER:4000']);
    }

    const unknownSrc = computeDriverPlan({
      periods: ['P01'],
      drivers: [
        {
          kind: 'percent_of_account',
          driverKey: 'd_missing',
          accountCode: '5000',
          assumptionLabel: 'Missing',
          sourceAccountCode: '9999',
          ratio: '0.2',
        },
      ],
    });
    expect(unknownSrc.ok).toBe(false);
    if (!unknownSrc.ok) {
      expect(unknownSrc.issues).toEqual(['UNKNOWN_DRIVER_SOURCE:d_missing->9999']);
    }

    const emptyPeriods = computeDriverPlan({ periods: [], drivers: [] });
    expect(emptyPeriods).toEqual({ ok: false, issues: ['EMPTY_PERIODS'] });

    const dupPeriods = computeDriverPlan({ periods: ['P01', 'P01'], drivers: [] });
    expect(dupPeriods).toEqual({ ok: false, issues: ['DUPLICATE_PERIOD:P01'] });
  });
});

describe('M2 Planning Engine — Rolling Forecast (/core/planning)', () => {
  it('stitches locked actuals through cutoff with forecast for open periods and preserves nulls', () => {
    const res = buildRollingForecast({
      periods: ['P01', 'P02', 'P03', 'P04'],
      cutoffPeriod: 'P02',
      actuals: [
        { accountCode: '4000', periodCode: 'P01', amount: '1000.00' },
        { accountCode: '4000', periodCode: 'P02', amount: '1200.00' },
        // P03 actual should be IGNORED because cutoff is P02 (open period uses forecast)
        { accountCode: '4000', periodCode: 'P03', amount: '9999.00' },
        { accountCode: '6000', periodCode: 'P01', amount: '400.00' },
        // 6000 has NO P02 actual -> must remain null, never coerced to 0
      ],
      forecast: [
        { accountCode: '4000', periodCode: 'P01', amount: '900.00' }, // ignored (closed)
        { accountCode: '4000', periodCode: 'P03', amount: '1300.00' },
        { accountCode: '4000', periodCode: 'P04', amount: '1400.00' },
        { accountCode: '6000', periodCode: 'P03', amount: '450.00' },
        { accountCode: '6000', periodCode: 'P04', amount: '450.00' },
      ],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.actualPeriods).toEqual(['P01', 'P02']);
    expect(res.forecastPeriods).toEqual(['P03', 'P04']);
    expect(res.totalActual).toBe('2600.00');
    expect(res.totalForecast).toBe('3600.00');
    expect(res.totalFullHorizon).toBe('6200.00');
    expect(res.totalMissingCells).toBe(1);

    const rev = res.rows.find((r) => r.accountCode === '4000');
    expect(rev?.actualSubtotal).toBe('2200.00');
    expect(rev?.forecastSubtotal).toBe('2700.00');
    expect(rev?.fullHorizonTotal).toBe('4900.00');
    expect(rev?.missingCellCount).toBe(0);

    const opex = res.rows.find((r) => r.accountCode === '6000');
    expect(opex?.cells[1]).toEqual({ periodCode: 'P02', basis: 'actual', amount: null });
    expect(opex?.actualSubtotal).toBe('400.00');
    expect(opex?.forecastSubtotal).toBe('900.00');
    expect(opex?.fullHorizonTotal).toBe('1300.00');
    expect(opex?.missingCellCount).toBe(1);
  });

  it('rejects unknown cutoff period and supports null cutoff for pure forecast', () => {
    const bad = buildRollingForecast({
      periods: ['P01', 'P02'],
      cutoffPeriod: 'P99',
      actuals: [],
      forecast: [],
    });
    expect(bad).toEqual({ ok: false, issues: ['UNKNOWN_CUTOFF_PERIOD:P99'] });

    const pureForecast = buildRollingForecast({
      periods: ['P01', 'P02'],
      cutoffPeriod: null,
      actuals: [{ accountCode: '4000', periodCode: 'P01', amount: '500.00' }],
      forecast: [
        { accountCode: '4000', periodCode: 'P01', amount: '800.00' },
        { accountCode: '4000', periodCode: 'P02', amount: '900.00' },
      ],
    });
    expect(pureForecast.ok).toBe(true);
    if (!pureForecast.ok) return;
    expect(pureForecast.actualPeriods).toEqual([]);
    expect(pureForecast.forecastPeriods).toEqual(['P01', 'P02']);
    expect(pureForecast.totalActual).toBe('0.00');
    expect(pureForecast.totalForecast).toBe('1700.00');
    expect(pureForecast.totalFullHorizon).toBe('1700.00');
  });
});

describe('M2 Planning Engine — Scenario Comparison (/core/planning)', () => {
  it('computes exact deltas and §3.5 zero-base percentages without fabricating missing accounts', () => {
    const report = compareScenarios({
      baseScenarioName: 'Base FY2026',
      targetScenarioName: 'Upside FY2026',
      baseLines: [
        { accountCode: '4000', periodCode: 'P01', amount: '1000.00' },
        { accountCode: '4000', periodCode: 'P02', amount: '1000.00' },
        { accountCode: '5000', periodCode: 'P01', amount: '0.00' },
        { accountCode: '6000', periodCode: 'P01', amount: '0.00' },
        { accountCode: '7000', periodCode: 'P01', amount: '500.00' },
      ],
      targetLines: [
        { accountCode: '4000', periodCode: 'P01', amount: '1250.00' },
        { accountCode: '4000', periodCode: 'P02', amount: '1250.00' },
        { accountCode: '5000', periodCode: 'P01', amount: '0.00' },
        { accountCode: '6000', periodCode: 'P01', amount: '150.00' },
        // 7000 absent in target -> null delta, never fabricated zero
      ],
    });

    expect(report.totalBase).toBe('2500.00');
    expect(report.totalTarget).toBe('2650.00');
    expect(report.totalDelta).toBe('150.00');

    expect(report.rows).toEqual([
      {
        accountCode: '4000',
        baseTotal: '2000.00',
        targetTotal: '2500.00',
        deltaAmount: '500.00',
        deltaPct: '25.00%',
        deltaPctStatus: 'computed',
      },
      {
        accountCode: '5000',
        baseTotal: '0.00',
        targetTotal: '0.00',
        deltaAmount: '0.00',
        deltaPct: '0.00%',
        deltaPctStatus: 'zero',
      },
      {
        accountCode: '6000',
        baseTotal: '0.00',
        targetTotal: '150.00',
        deltaAmount: '150.00',
        deltaPct: 'n/m',
        deltaPctStatus: 'nm',
      },
      {
        accountCode: '7000',
        baseTotal: '500.00',
        targetTotal: null,
        deltaAmount: null,
        deltaPct: null,
        deltaPctStatus: 'null',
      },
    ]);
  });
});
