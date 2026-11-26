import { describe, expect, it } from 'vitest';
import oracleData from '../../fixtures/oracles/metrics/dashboard_kpis_oracle.json' with { type: 'json' };
import { money } from '../money/index.js';
import { STATEMENT_LINE_MAP } from '../statements/index.js';
import {
  buildKpiTrendSeries,
  buildReportBlocks,
  evaluateKpiLibrary,
  METRIC_CATALOG_BY_KEY,
  METRIC_DEFINITIONS,
  REPORT_TEMPLATES,
  type CurrencyScale,
  type MetricKey,
  type ReportTemplateId,
} from './index.js';

describe('/core/metrics KPI Library & Report Builder (§11.5)', () => {
  it('matches hand-computed golden oracle cases across USD, zero-revenue/unplanned, and JPY 0-scale negative EBITDA', () => {
    for (const c of oracleData.cases) {
      const result = evaluateKpiLibrary({
        currencyScale: c.currencyScale as CurrencyScale,
        hasPlan: c.hasPlan,
        pnl: c.pnl,
        balanceSheet: c.balanceSheet,
        cashFlow: c.cashFlow,
        plan: {
          revenue: c.plan.revenue,
          ebitda: c.plan.ebitda,
        },
      });

      expect(result.kpis.length).toBe(METRIC_DEFINITIONS.length);
      for (const [metricKey, expected] of Object.entries(c.expectedKpis)) {
        const actual = result.byKey[metricKey];
        expect(actual, `${c.name}:${metricKey}`).toBeDefined();
        expect(actual?.value, `${c.name}:${metricKey}:value`).toBe(expected.value);
        expect(actual?.formattedValue, `${c.name}:${metricKey}:formatted`).toBe(expected.formattedValue);
        expect(actual?.status, `${c.name}:${metricKey}:status`).toBe(expected.status);
      }
    }
  });

  it('supports 3-decimal currency scales (BHD/KWD/JOD) and keeps catalog keys unique with valid statement_line sources (RPT1)', () => {
    const keys = new Set<MetricKey>();
    for (const def of METRIC_DEFINITIONS) {
      expect(keys.has(def.key)).toBe(false);
      keys.add(def.key);
      expect(def.phase).toBe('M2');
      expect(def.formula.length).toBeGreaterThan(3);
      expect(def.sourceKeys.length).toBeGreaterThan(0);
      for (const sourceKey of def.sourceKeys) {
        expect(STATEMENT_LINE_MAP.has(sourceKey), `Unknown statement_line ${sourceKey}`).toBe(true);
      }
    }
    expect(METRIC_CATALOG_BY_KEY.size).toBe(METRIC_DEFINITIONS.length);

    const kwd = evaluateKpiLibrary({
      currencyScale: 3,
      hasPlan: true,
      pnl: {
        revenue: '100.500',
        cogs: '40.200',
        grossProfit: '60.300',
        opex: '20.100',
        ebitda: '40.200',
        netIncome: '35.175',
      },
      balanceSheet: {
        totalAssets: '500.250',
        totalLiabilities: '100.050',
        totalEquity: '400.200',
        cashBalance: '250.125',
      },
      cashFlow: {
        operatingCashFlow: '38.000',
        freeCashFlow: '30.000',
        endingCash: '250.125',
      },
      plan: { revenue: '100.500', ebitda: '40.200' },
    });
    expect(kwd.byKey['pnl.revenue']?.formattedValue).toBe('100.500');
    expect(kwd.byKey['bs.total_assets']?.formattedValue).toBe('500.250');
    expect(kwd.byKey['pnl.gross_margin']?.formattedValue).toBe('60.00%');
    expect(kwd.byKey['plan.revenue_attainment']?.formattedValue).toBe('100.00%');
  });

  it('computes pure Decimal trend bar heights for healthy, negative, and all-zero series without float coercion', () => {
    const healthySeries = buildKpiTrendSeries(
      [
        {
          periodCode: 'P01',
          periodNo: 1,
          fiscalYear: 2026,
          revenue: money('500.00'),
          ebitda: money('125.00'),
          netIncome: money('100.00'),
          operatingCashFlow: money('90.00'),
          endingCash: money('1000.00'),
        },
        {
          periodCode: 'P02',
          periodNo: 2,
          fiscalYear: 2026,
          revenue: money('1000.00'),
          ebitda: money('-250.00'),
          netIncome: money('-300.00'),
          operatingCashFlow: money('-100.00'),
          endingCash: money('750.00'),
        },
      ],
      2,
    );
    expect(healthySeries).toHaveLength(2);
    expect(healthySeries[0]).toMatchObject({
      periodCode: 'P01',
      revenue: '500.00',
      ebitda: '125.00',
      endingCash: '1000.00',
      revenueBarPct: 50,
      ebitdaBarPct: 13,
      cashBarPct: 100,
      ebitdaPositive: true,
      cashPositive: true,
    });
    expect(healthySeries[1]).toMatchObject({
      periodCode: 'P02',
      revenueBarPct: 100,
      ebitdaBarPct: 25,
      cashBarPct: 75,
      ebitdaPositive: false,
      cashPositive: true,
    });

    const zeroSeries = buildKpiTrendSeries(
      [
        {
          periodCode: 'P01',
          periodNo: 1,
          fiscalYear: 2026,
          revenue: money('0'),
          ebitda: money('0'),
          netIncome: money('0'),
          operatingCashFlow: money('0'),
          endingCash: money('0'),
        },
      ],
      2,
    );
    expect(zeroSeries[0]?.revenueBarPct).toBe(0);
    expect(zeroSeries[0]?.ebitdaBarPct).toBe(0);
    expect(zeroSeries[0]?.cashBarPct).toBe(0);
  });

  it('builds Report Builder blocks with 100.00% citation coverage across all templates and rejects unknown keys (RPT4)', () => {
    const sampleCase = oracleData.cases[0]!;
    const lib = evaluateKpiLibrary({
      currencyScale: 2,
      hasPlan: true,
      pnl: sampleCase.pnl,
      balanceSheet: sampleCase.balanceSheet,
      cashFlow: sampleCase.cashFlow,
      plan: sampleCase.plan,
    });
    const statementLines = new Map<string, ReturnType<typeof money>>([
      ['pl.revenue.product', money('900.00')],
      ['bs.asset.cash', money('1500.00')],
      ['bs.asset.ar', money('300.00')],
      ['bs.liability.ap', money('200.00')],
      ['pl.opex.payroll', money('240.00')],
      ['pl.opex.ga', money('120.00')],
    ]);

    for (const templateId of Object.keys(REPORT_TEMPLATES) as ReportTemplateId[]) {
      const report = buildReportBlocks({
        templateId,
        kpiLibrary: lib,
        statementLinesByKey: statementLines,
      });
      expect(report.blockCount).toBeGreaterThan(0);
      expect(report.citedBlockCount).toBe(report.blockCount);
      expect(report.unlinkedBlockCount).toBe(0);
      expect(report.citationCoveragePct).toBe('100.00%');
      expect(report.blocks.every((block) => block.cited)).toBe(true);
    }

    expect(() =>
      buildReportBlocks({
        templateId: 'executive_summary',
        kpiLibrary: lib,
        statementLinesByKey: statementLines,
        customBlocks: [{ id: 'bad-1', kind: 'metric', title: 'Bogus', citationKey: 'pnl.invented' }],
      }),
    ).toThrow(/UNKNOWN_REPORT_CITATION:metric:pnl\.invented/);

    expect(() =>
      buildReportBlocks({
        templateId: 'executive_summary',
        kpiLibrary: lib,
        statementLinesByKey: statementLines,
        customBlocks: [{ id: 'bad-2', kind: 'statement_line', title: 'Bogus Line', citationKey: 'pl.fake' }],
      }),
    ).toThrow(/UNKNOWN_REPORT_CITATION:statement_line:pl\.fake/);
  });
});
