import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  DriverPlanCommitResponse,
  DriverPlanPreviewResponse,
  RollingForecastResponse,
  ScenarioComparisonResponse,
  ScenarioSummary,
} from '../shared/planning.js';
import type { ChartAccountPayload } from './api/client.js';
import {
  DriverAuthoringPanel,
  DriverPlanPreviewTable,
  RollingForecastTable,
  ScenarioComparisonTable,
  ScenarioInventory,
} from './components/PlanningWorkspace.js';
import ModelGridPage from './pages/ModelGridPage.js';
import {
  buildDriverDefinitions,
  createEmptyDriverRow,
  createInitialDriverPlanDraft,
  periodCodes,
  resolvePlanningDefaults,
  type DriverPlanDraft,
} from './state/planningView.js';

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

const sampleChartAccounts: readonly ChartAccountPayload[] = [
  {
    code: '4000',
    name: 'Subscription Revenue',
    type: 'revenue',
    normalSide: 'credit',
    isContra: false,
    isPostable: true,
    statementLineKey: 'pl.revenue.service',
    parentCode: null,
    active: true,
    version: 1,
  },
  {
    code: '5000',
    name: 'Direct Hosting',
    type: 'expense',
    normalSide: 'debit',
    isContra: false,
    isPostable: true,
    statementLineKey: 'pl.cogs.direct',
    parentCode: null,
    active: true,
    version: 1,
  },
  {
    code: '4999',
    name: 'Summary Header',
    type: 'revenue',
    normalSide: 'credit',
    isContra: false,
    isPostable: false,
    statementLineKey: 'pl.revenue.service',
    parentCode: null,
    active: true,
    version: 1,
  },
  {
    code: '9000',
    name: 'Retired Account',
    type: 'expense',
    normalSide: 'debit',
    isContra: false,
    isPostable: true,
    statementLineKey: 'pl.opex.ga',
    parentCode: null,
    active: false,
    version: 1,
  },
];

const samplePreview: DriverPlanPreviewResponse = {
  fiscalYear: 2026,
  currencyScale: 2,
  periods: ['P01', 'P02', 'P03'],
  lines: [
    {
      accountCode: '4000',
      periodCode: 'P01',
      amount: '1000.00',
      source: 'driver',
      driverKey: 'rev_growth',
      assumptionLabel: 'Core revenue assumption',
    },
    {
      accountCode: '4000',
      periodCode: 'P02',
      amount: '1250.00',
      source: 'override',
      driverKey: 'rev_growth',
      assumptionLabel: 'Core revenue assumption',
    },
    {
      accountCode: '5000',
      periodCode: 'P01',
      amount: '300.00',
      source: 'driver',
      driverKey: 'cogs_ratio',
      assumptionLabel: 'Hosting ratio assumption',
    },
  ],
  totalsByAccount: { '4000': '2250.00', '5000': '300.00' },
  totalsByPeriod: { P01: '1300.00', P02: '1250.00', P03: '0.00' },
  grandTotal: '2550.00',
};

const sampleCommit: DriverPlanCommitResponse = {
  scenarioId: '44444444-4444-4444-8444-444444444444',
  scenarioName: 'Q2 Rolling Forecast',
  scenarioKind: 'forecast',
  planVersionId: '55555555-5555-4555-8555-555555555555',
  versionNo: 2,
  lineCount: 36,
  grandTotal: '14400.00',
  totalsByAccount: { '4000': '14400.00' },
};

describe('M2 driver-plan authoring inside the Model Grid (WI-0033)', () => {
  it('builds typed wire definitions for all four driver kinds and enforces preview vs commit rules', () => {
    const draft: DriverPlanDraft = {
      scenarioName: '  ',
      scenarioKind: 'forecast',
      drivers: [
        {
          ...createEmptyDriverRow('d1', '4000'),
          kind: 'fixed',
          driverKey: 'sub_base',
          assumptionLabel: 'Flat monthly baseline',
          amount: '1000.00',
          overrides: [{ id: 'ov1', periodCode: 'P02', amount: '1250.00' }],
        },
        {
          ...createEmptyDriverRow('d2', '4100'),
          kind: 'growth_rate',
          driverKey: 'exp_rev',
          assumptionLabel: 'Expansion growth',
          baseAmount: '500.00',
          ratePerPeriod: '0.10',
        },
        {
          ...createEmptyDriverRow('d3', '5000'),
          kind: 'percent_of_account',
          driverKey: 'cogs_share',
          assumptionLabel: 'Direct share of 4000',
          sourceAccountCode: '4000',
          ratio: '0.30',
        },
        {
          ...createEmptyDriverRow('d4', '4200'),
          kind: 'price_times_volume',
          driverKey: 'seats_pv',
          assumptionLabel: 'Seats x unit price',
          unitPrice: '50.00',
          volume: '10',
          unitPriceByPeriod: { P02: '60.00' },
          volumeByPeriod: { P03: '15' },
        },
      ],
    };

    const previewBuilt = buildDriverDefinitions(draft, ['P01', 'P02', 'P03'], {
      requireScenarioName: false,
    });
    expect(previewBuilt.ok).toBe(true);
    if (previewBuilt.ok) {
      expect(previewBuilt.drivers).toHaveLength(4);
      expect(previewBuilt.drivers[0]).toEqual({
        kind: 'fixed',
        driverKey: 'sub_base',
        accountCode: '4000',
        assumptionLabel: 'Flat monthly baseline',
        amount: '1000.00',
        periodOverrides: { P02: '1250.00' },
      });
      expect(previewBuilt.drivers[3]).toEqual({
        kind: 'price_times_volume',
        driverKey: 'seats_pv',
        accountCode: '4200',
        assumptionLabel: 'Seats x unit price',
        unitPriceByPeriod: { P01: '50.00', P02: '60.00', P03: '50.00' },
        volumeByPeriod: { P01: '10', P02: '10', P03: '15' },
      });
    }

    const commitMissingName = buildDriverDefinitions(draft, ['P01', 'P02', 'P03'], {
      requireScenarioName: true,
    });
    expect(commitMissingName.ok).toBe(false);
    if (!commitMissingName.ok) {
      expect(commitMissingName.issues[0]).toContain('SCENARIO_NAME_REQUIRED');
    }
  });

  it('rejects non-canonical decimals, duplicate period overrides, and empty driver lists without calling the API', () => {
    const badDraft: DriverPlanDraft = {
      scenarioName: 'Bad Plan',
      scenarioKind: 'budget',
      drivers: [
        {
          ...createEmptyDriverRow('d1', '4000'),
          kind: 'fixed',
          driverKey: 'rev',
          assumptionLabel: 'Bad decimals',
          amount: '1,000.00',
          overrides: [
            { id: 'ov1', periodCode: 'P01', amount: '500.00' },
            { id: 'ov2', periodCode: 'P01', amount: '600.00' },
          ],
        },
      ],
    };

    const badResult = buildDriverDefinitions(badDraft, ['P01', 'P02'], { requireScenarioName: true });
    expect(badResult.ok).toBe(false);
    if (!badResult.ok) {
      expect(badResult.issues.some((msg) => msg.includes('duplicate override for period P01'))).toBe(true);
      expect(badResult.issues.some((msg) => msg.includes('canonical decimal string'))).toBe(true);
    }

    const emptyDrivers = buildDriverDefinitions(
      { scenarioName: 'Empty', scenarioKind: 'forecast', drivers: [] },
      ['P01'],
      { requireScenarioName: true },
    );
    expect(emptyDrivers.ok).toBe(false);
    if (!emptyDrivers.ok) {
      expect(emptyDrivers.issues[0]).toContain('NO_DRIVERS');
    }
  });

  it('renders DriverPlanPreviewTable strictly from server strings with totals and source tags', () => {
    const html = renderToStaticMarkup(
      createElement(DriverPlanPreviewTable, { report: samplePreview, currency: 'USD' }),
    );

    expect(html).toContain('Driver plan preview');
    expect(html).toContain('grand total 2550.00 USD');
    expect(html).toContain('2250.00');
    expect(html).toContain('1250.00');
    expect(html).toContain('override');
    expect(html).toContain('rev_growth');
    expect(html).toContain('Core revenue assumption');
  });

  it('renders real chart options, empty-chart CoA banner, busy/error/commit states, and all 4 driver kinds cleanly', () => {
    const multiKindDraft: DriverPlanDraft = {
      scenarioName: 'Q2 Rolling Forecast',
      scenarioKind: 'forecast',
      drivers: [
        { ...createEmptyDriverRow('d1', '4000'), kind: 'fixed', driverKey: 'k1' },
        { ...createEmptyDriverRow('d2', '4000'), kind: 'growth_rate', driverKey: 'k2' },
        { ...createEmptyDriverRow('d3', '5000'), kind: 'percent_of_account', driverKey: 'k3' },
        { ...createEmptyDriverRow('d4', '4000'), kind: 'price_times_volume', driverKey: 'k4' },
      ],
    };

    const populatedHtml = renderToStaticMarkup(
      createElement(DriverAuthoringPanel, {
        fiscalYear: 2026,
        periods: ['P01', 'P02', 'P03'],
        currency: 'USD',
        accounts: sampleChartAccounts,
        chartState: 'idle',
        chartFailure: null,
        onRetryChart: noop,
        onOpenCoaMapper: noop,
        draft: multiKindDraft,
        onChangeDraft: noop,
        previewResult: samplePreview,
        commitResult: sampleCommit,
        actionBusy: null,
        actionFailure: null,
        onPreview: noop,
        onCommit: noop,
        onRetryAction: noop,
      }),
    );

    expect(populatedHtml).toContain('4000 — Subscription Revenue');
    expect(populatedHtml).toContain('5000 — Direct Hosting');
    expect(populatedHtml).not.toContain('4999 — Summary Header');
    expect(populatedHtml).not.toContain('9000 — Retired Account');
    expect(populatedHtml).toContain('Growth rate per period (decimal ratio)');
    expect(populatedHtml).toContain('Ratio of source account (decimal)');
    expect(populatedHtml).toContain('Default unit price (USD)');
    expect(populatedHtml).toContain('Committed scenario &quot;Q2 Rolling Forecast&quot; (forecast) as plan version v2');
    expect(populatedHtml).toContain('grand total 14400.00 USD');
    expect(populatedHtml).not.toContain('—%');
    expect(populatedHtml).not.toContain('(0%)');
    expect(populatedHtml).not.toContain('<h1');

    const emptyChartHtml = renderToStaticMarkup(
      createElement(DriverAuthoringPanel, {
        fiscalYear: 2026,
        periods: ['P01', 'P02'],
        currency: 'USD',
        accounts: [],
        chartState: 'idle',
        chartFailure: null,
        onRetryChart: noop,
        onOpenCoaMapper: noop,
        draft: createInitialDriverPlanDraft(''),
        onChangeDraft: noop,
        previewResult: null,
        commitResult: null,
        actionBusy: null,
        actionFailure: {
          code: 'VALIDATION_FAILED',
          message: 'Driver plan validation failed; nothing was written.',
          issues: ['CYCLE_DETECTED:4000->5000'],
          action: 'commit',
        },
        onPreview: noop,
        onCommit: noop,
        onRetryAction: noop,
      }),
    );

    expect(emptyChartHtml).toContain('Open CoA Mapper');
    expect(emptyChartHtml).toContain('role="alert"');
    expect(emptyChartHtml).toContain('VALIDATION_FAILED');
    expect(emptyChartHtml).toContain('CYCLE_DETECTED:4000-&gt;5000');
    expect(emptyChartHtml).toContain('Retry failed action');

    const busyHtml = renderToStaticMarkup(
      createElement(DriverAuthoringPanel, {
        fiscalYear: 2026,
        periods: ['P01', 'P02'],
        currency: 'USD',
        accounts: sampleChartAccounts,
        chartState: 'loading',
        chartFailure: null,
        onRetryChart: noop,
        onOpenCoaMapper: noop,
        draft: createInitialDriverPlanDraft('4000'),
        onChangeDraft: noop,
        previewResult: null,
        commitResult: null,
        actionBusy: 'commit',
        actionFailure: null,
        onPreview: noop,
        onCommit: noop,
        onRetryAction: noop,
      }),
    );

    expect(busyHtml).toContain('Loading chart of accounts for driver target selection');
    expect(busyHtml).toContain('Validating accounts and committing versioned plan lines');
  });
});
