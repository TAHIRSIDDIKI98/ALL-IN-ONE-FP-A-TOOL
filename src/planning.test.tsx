import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RollingForecastResponse, ScenarioComparisonResponse, ScenarioSummary } from '../shared/planning.js';
import {
  RollingForecastTable,
  ScenarioComparisonTable,
  ScenarioInventory,
} from './components/PlanningWorkspace.js';
import ModelGridPage from './pages/ModelGridPage.js';
import { periodCodes, resolvePlanningDefaults } from './state/planningView.js';

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const noop = (): void => {};

const forecast: RollingForecastResponse = {
  companyId: COMPANY_ID,
  fiscalYear: 2026,
  scenarioName: 'Forecast FY2026',
  planVersionNo: 3,
  cutoffPeriod: 'P02',
  periods: ['P01', 'P02', 'P03'],
  actualPeriods: ['P01', 'P02'],
  forecastPeriods: ['P03'],
  rows: [
    {
      accountCode: '4000',
      cells: [
        { periodCode: 'P01', basis: 'actual', amount: '1000.00' },
        { periodCode: 'P02', basis: 'actual', amount: null },
        { periodCode: 'P03', basis: 'forecast', amount: '500.00' },
      ],
      actualSubtotal: '1000.00',
      forecastSubtotal: '500.00',
      fullHorizonTotal: '1500.00',
      missingCellCount: 1,
    },
    {
      accountCode: '5000',
      cells: [
        { periodCode: 'P01', basis: 'actual', amount: null },
        { periodCode: 'P02', basis: 'actual', amount: null },
        { periodCode: 'P03', basis: 'forecast', amount: null },
      ],
      actualSubtotal: '0.00',
      forecastSubtotal: '0.00',
      fullHorizonTotal: '0.00',
      missingCellCount: 3,
    },
  ],
  totalActual: '1000.00',
  totalForecast: '500.00',
  totalFullHorizon: '1500.00',
  totalMissingCells: 4,
};

const comparison: ScenarioComparisonResponse = {
  companyId: COMPANY_ID,
  fiscalYear: 2026,
  baseScenarioName: 'Budget FY2026',
  targetScenarioName: 'Forecast FY2026',
  rows: [
    {
      accountCode: '4000',
      baseTotal: '1000.00',
      targetTotal: '1125.00',
      deltaAmount: '125.00',
      deltaPct: '12.50%',
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
      targetTotal: '40.00',
      deltaAmount: '40.00',
      deltaPct: 'n/m',
      deltaPctStatus: 'nm',
    },
    {
      accountCode: '7000',
      baseTotal: null,
      targetTotal: '90.00',
      deltaAmount: null,
      deltaPct: null,
      deltaPctStatus: 'null',
    },
    {
      accountCode: '8000',
      baseTotal: '70.00',
      targetTotal: null,
      deltaAmount: null,
      deltaPct: null,
      deltaPctStatus: 'null',
    },
  ],
  totalBase: '1070.00',
  totalTarget: '1255.00',
  totalDelta: '185.00',
};

const scenarios: readonly ScenarioSummary[] = [
  {
    scenarioId: '22222222-2222-4222-8222-222222222222',
    name: 'Budget FY2026',
    kind: 'budget',
    currentVersionNo: 2,
    currentVersionLabel: 'FY2026 Budget v2',
  },
  {
    scenarioId: '33333333-3333-4333-8333-333333333333',
    name: 'Forecast FY2026',
    kind: 'forecast',
    currentVersionNo: null,
    currentVersionLabel: null,
  },
];

describe('M2 planning views inside the Model Grid (WI-0032)', () => {
  it('renders the rolling forecast exactly as the server issued it, tagging every period basis', () => {
    const html = renderToStaticMarkup(
      createElement(RollingForecastTable, { report: forecast, currency: 'USD' }),
    );

    for (const row of forecast.rows) {
      expect(html).toContain(row.accountCode);
      expect(html).toContain(row.actualSubtotal);
      expect(html).toContain(row.forecastSubtotal);
      expect(html).toContain(row.fullHorizonTotal);
      for (const cell of row.cells) {
        if (cell.amount !== null) expect(html).toContain(cell.amount);
      }
    }

    expect(html).toContain('1000.00');
    expect(html).toContain('500.00');
    expect(html).toContain('1500.00');
    expect(html).toContain('current plan version v3');
    expect(html).toContain('Actual basis: P01, P02');
    expect(html).toContain('Forecast basis: P03');
    expect(html).toContain('cutoff P02');
    expect(html).toContain('4 horizon cell(s) carry no value');
  });

  it('never substitutes zero for an absent actual or plan cell', () => {
    const html = renderToStaticMarkup(
      createElement(RollingForecastTable, { report: forecast, currency: 'USD' }),
    );

    expect(html).toContain('not posted');
    expect(html).toContain('not planned');
    expect(html).not.toContain('—%');
    expect(html).not.toContain('(0%)');
    // Row 5000 has no amounts at all: three cells not planned, and the row says so explicitly.
    expect(html).toContain('Cells not planned');
    expect(html).toContain('>3</td>');
    expect(html).toContain('4 horizon cell(s) carry no value');
  });

  it('states plainly when a scenario has no current plan version instead of showing planned zeros', () => {
    const html = renderToStaticMarkup(
      createElement(RollingForecastTable, {
        report: { ...forecast, planVersionNo: null },
        currency: 'USD',
      }),
    );

    expect(html).toContain('no current plan version for this scenario');
    expect(html).toContain('This scenario has no current plan version');
    expect(html).toContain('No planned amount was inferred');
  });

  it('applies the zero-base comparison rules from the server status, including n/m and not planned', () => {
    const html = renderToStaticMarkup(
      createElement(ScenarioComparisonTable, { report: comparison, currency: 'USD' }),
    );

    expect(html).toContain('12.50%');
    expect(html).toContain('0.00%');
    expect(html).toContain('n/m');
    expect(html).toContain('125.00');
    expect(html).toContain('40.00');
    expect(html).toContain('not planned in base');
    expect(html).toContain('not planned in target');
    expect(html).toContain('both scenarios');
    expect(html).toContain('Base &quot;Budget FY2026&quot; vs target &quot;Forecast FY2026&quot;');
    expect(html).not.toContain('—%');
  });

  it('lists scenarios with their real current plan version and marks the forecast selection', () => {
    const html = renderToStaticMarkup(
      createElement(ScenarioInventory, {
        scenarios,
        selectedScenario: 'Forecast FY2026',
        onSelect: noop,
      }),
    );

    expect(html).toContain('Budget FY2026');
    expect(html).toContain('v2 · FY2026 Budget v2');
    expect(html).toContain('no current version');
    expect(html).toContain('Selected for forecast');
    expect(html).toContain('Use for forecast');
    expect(html).toContain('Kind');
    expect(html).toContain('Current plan version');
  });

  it('opens on a forecast scenario, keeps only selections that still exist, and never invents one', () => {
    const fresh = resolvePlanningDefaults(scenarios, {
      selectedScenario: null,
      baseScenario: null,
      targetScenario: null,
    });
    expect(fresh).toEqual({
      selectedScenario: 'Forecast FY2026',
      baseScenario: 'Budget FY2026',
      targetScenario: 'Forecast FY2026',
    });

    const kept = resolvePlanningDefaults(scenarios, {
      selectedScenario: 'Budget FY2026',
      baseScenario: 'Forecast FY2026',
      targetScenario: 'Budget FY2026',
    });
    expect(kept.selectedScenario).toBe('Budget FY2026');
    expect(kept.baseScenario).toBe('Forecast FY2026');
    expect(kept.targetScenario).toBe('Budget FY2026');

    const vanished = resolvePlanningDefaults(scenarios, {
      selectedScenario: 'Scenario that no longer exists',
      baseScenario: 'Scenario that no longer exists',
      targetScenario: 'Scenario that no longer exists',
    });
    expect(vanished.selectedScenario).toBe('Forecast FY2026');
    expect(vanished.baseScenario).toBe('Budget FY2026');

    const single = resolvePlanningDefaults([scenarios[0]!], fresh);
    expect(single.selectedScenario).toBe('Budget FY2026');
    expect(single.targetScenario).toBeNull();

    const none = resolvePlanningDefaults([], fresh);
    expect(none).toEqual({ selectedScenario: null, baseScenario: null, targetScenario: null });
  });

  it('derives the horizon codes from the fiscal calendar, never a guess', () => {
    expect(periodCodes(12)).toEqual([
      'P01',
      'P02',
      'P03',
      'P04',
      'P05',
      'P06',
      'P07',
      'P08',
      'P09',
      'P10',
      'P11',
      'P12',
    ]);
    expect(periodCodes(13).at(-1)).toBe('P13');
    expect(periodCodes(0)).toEqual(['P01']);
  });

  it('keeps exactly one h1 and both views on the Model Grid, with planning states honest', () => {
    const actuals = renderToStaticMarkup(
      createElement(ModelGridPage, { onNavigate: noop, forcedState: 'empty' }),
    );
    expect((actuals.match(/<h1/g) ?? []).length).toBe(1);
    expect(actuals).toContain('Model Grid');
    expect(actuals).toContain('role="tablist"');
    expect(actuals).toContain('Sign in and create a company workspace before reading the trial balance');

    const planningEmpty = renderToStaticMarkup(
      createElement(ModelGridPage, {
        onNavigate: noop,
        forcedState: 'empty',
        initialView: 'planning',
      }),
    );
    expect((planningEmpty.match(/<h1/g) ?? []).length).toBe(1);
    expect(planningEmpty).toContain('aria-label="Planning view"');
    expect(planningEmpty).toContain('No planning scenario exists for this company yet');
    expect(planningEmpty).toContain('<button');

    const planningLoading = renderToStaticMarkup(
      createElement(ModelGridPage, {
        onNavigate: noop,
        forcedState: 'loading',
        initialView: 'planning',
      }),
    );
    expect(planningLoading).toContain('role="status"');
    expect(planningLoading).toContain('aria-busy="true"');

    const planningError = renderToStaticMarkup(
      createElement(ModelGridPage, {
        onNavigate: noop,
        forcedState: 'error',
        initialView: 'planning',
      }),
    );
    expect(planningError).toContain('role="alert"');
    expect(planningError).toContain('Retry failed action');
    expect(planningError).toContain('PLANNING_UNAVAILABLE');
  });
});
