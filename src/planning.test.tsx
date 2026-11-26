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
import type { WorkflowOverviewResponse } from '../shared/workflow.js';
import type { WorkforcePreviewResponse, WorkforceWorkspaceResponse } from '../shared/workforce.js';
import type { FluxAnalysisResponse, PvmBridgeResponse } from '../shared/variance.js';
import type { DashboardSummaryResponse } from '../shared/dashboards.js';
import type { ChartAccountPayload } from './api/client.js';
import { DashboardsPanel } from './components/DashboardsPanel.js';
import { FluxPvmPanel } from './components/FluxPvmPanel.js';
import {
  DriverAuthoringPanel,
  DriverPlanPreviewTable,
  RollingForecastTable,
  ScenarioComparisonTable,
  ScenarioInventory,
  WorkflowPanel,
} from './components/PlanningWorkspace.js';
import { WorkforcePanel } from './components/WorkforcePanel.js';
import ModelGridPage from './pages/ModelGridPage.js';
import {
  availableTaskActions,
  buildCommentRequestPayload,
  buildDriverDefinitions,
  buildPvmBridgeItemsPayload,
  buildWorkforcePositionsPayload,
  createEmptyDriverRow,
  createEmptyPvmItemDraft,
  createInitialCommentDraft,
  createInitialDriverPlanDraft,
  createInitialWorkforceDraft,
  periodCodes,
  resolvePlanningDefaults,
  unreadNotificationCount,
  workforceDraftFromRecords,
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

const sampleWorkflow: WorkflowOverviewResponse = {
  companyId: COMPANY_ID,
  actorRole: 'owner',
  members: [
    {
      userId: '66666666-6666-4666-8666-666666666666',
      email: 'owner@onefpa.test',
      displayName: 'Owner',
      role: 'owner',
    },
    {
      userId: '77777777-7777-4777-8777-777777777777',
      email: 'reviewer@onefpa.test',
      displayName: 'Reviewer',
      role: 'reviewer',
    },
  ],
  planVersions: [
    {
      planVersionId: '55555555-5555-4555-8555-555555555555',
      scenarioId: '44444444-4444-4444-8444-444444444444',
      scenarioName: 'Q2 Rolling Forecast',
      scenarioKind: 'forecast',
      versionNo: 2,
      label: 'Q2 Rolling Forecast v2',
      isCurrent: true,
      lockedAt: null,
    },
  ],
  tasks: [
    {
      id: '88888888-8888-4888-8888-888888888888',
      companyId: COMPANY_ID,
      scenarioId: '44444444-4444-4444-8444-444444444444',
      scenarioName: 'Q2 Rolling Forecast',
      planVersionId: '55555555-5555-4555-8555-555555555555',
      versionNo: 2,
      versionLabel: 'Q2 Rolling Forecast v2',
      title: 'Review Q2 Rolling Forecast',
      status: 'submitted',
      version: 2,
      createdBy: '66666666-6666-4666-8666-666666666666',
      createdByName: 'Owner',
      assigneeId: '77777777-7777-4777-8777-777777777777',
      assigneeName: 'Reviewer',
      submittedBy: '66666666-6666-4666-8666-666666666666',
      submittedAt: '2026-11-25T12:00:00.000Z',
      decidedBy: null,
      decidedByName: null,
      decidedAt: null,
      decisionReason: null,
      createdAt: '2026-11-25T11:55:00.000Z',
      updatedAt: '2026-11-25T12:00:00.000Z',
    },
  ],
  comments: [
    {
      id: '99999999-9999-4999-8999-999999999999',
      companyId: COMPANY_ID,
      planVersionId: '55555555-5555-4555-8555-555555555555',
      versionNo: 2,
      scenarioName: 'Q2 Rolling Forecast',
      anchorKind: 'cell',
      anchorKey: 'cell:4000:P01',
      accountCode: '4000',
      periodCode: 'P01',
      statementLineKey: null,
      authorId: '66666666-6666-4666-8666-666666666666',
      authorName: 'Owner',
      authorEmail: 'owner@onefpa.test',
      body: 'Verify seasonality with @reviewer@onefpa.test',
      mentionedUserIds: ['77777777-7777-4777-8777-777777777777'],
      createdAt: '2026-11-25T12:00:00.000Z',
    },
  ],
  notifications: [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      companyId: COMPANY_ID,
      recipientId: '66666666-6666-4666-8666-666666666666',
      jobId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      eventKind: 'mention',
      planVersionId: '55555555-5555-4555-8555-555555555555',
      taskId: null,
      commentId: '99999999-9999-4999-8999-999999999999',
      title: 'Mentioned on cell:4000:P01',
      body: 'Verify seasonality with @reviewer@onefpa.test',
      readAt: null,
      createdAt: '2026-11-25T12:00:00.000Z',
    },
  ],
};

describe('M2 collaboration & workflow view inside the Model Grid (WI-0034)', () => {
  it('enforces pure comment payload validation and role-based approval action rules', () => {
    const emptyDraft = createInitialCommentDraft('', '', '');
    const invalid = buildCommentRequestPayload(emptyDraft);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.issues.some((i) => i.includes('PLAN_VERSION_REQUIRED'))).toBe(true);
      expect(invalid.issues.some((i) => i.includes('COMMENT_BODY_REQUIRED'))).toBe(true);
    }

    const cellBuilt = buildCommentRequestPayload({
      planVersionId: '55555555-5555-4555-8555-555555555555',
      anchorKind: 'cell',
      accountCode: '4000',
      periodCode: 'P01',
      statementLineKey: '',
      body: 'Check @reviewer@onefpa.test',
    });
    expect(cellBuilt.ok).toBe(true);
    if (cellBuilt.ok) {
      expect(cellBuilt.payload.anchor).toEqual({
        kind: 'cell',
        accountCode: '4000',
        periodCode: 'P01',
      });
    }

    expect(availableTaskActions('editor', 'draft')).toEqual(['submit']);
    expect(availableTaskActions('editor', 'submitted')).toEqual([]);
    expect(availableTaskActions('reviewer', 'submitted')).toEqual(['approve', 'reject']);
    expect(availableTaskActions('viewer', 'submitted')).toEqual([]);
    expect(availableTaskActions('owner', 'approved')).toEqual([]);
    expect(unreadNotificationCount(sampleWorkflow.notifications)).toBe(1);
  });

  it('renders WorkflowPanel across loading, error, populated owner, and read-only viewer states without adding h1s', () => {
    const populatedHtml = renderToStaticMarkup(
      createElement(WorkflowPanel, {
        workflow: sampleWorkflow,
        workflowState: 'idle',
        workflowFailure: null,
        onRetryLoad: noop,
        actionBusy: null,
        actionFailure: null,
        actionNotice: 'Approved version v2.',
        accounts: sampleChartAccounts,
        periods: ['P01', 'P02', 'P03'],
        onCreateTask: noop,
        onTransitionTask: noop,
        onCreateComment: noop,
        onMarkNotificationRead: noop,
        onAddMember: noop,
      }),
    );

    expect(populatedHtml).toContain('Collaboration, approvals &amp; inbox');
    expect(populatedHtml).toContain('Review Q2 Rolling Forecast');
    expect(populatedHtml).toContain('cell:4000:P01');
    expect(populatedHtml).toContain('Mentioned on cell:4000:P01');
    expect(populatedHtml).toContain('1 unread notification(s)');
    expect(populatedHtml).toContain('Approve &amp; lock');
    expect(populatedHtml).toContain('Mark read');
    expect(populatedHtml).toContain('Add member');
    expect(populatedHtml).not.toContain('<h1');

    const viewerHtml = renderToStaticMarkup(
      createElement(WorkflowPanel, {
        workflow: { ...sampleWorkflow, actorRole: 'viewer' },
        workflowState: 'idle',
        workflowFailure: null,
        onRetryLoad: noop,
        actionBusy: null,
        actionFailure: null,
        actionNotice: null,
        accounts: sampleChartAccounts,
        periods: ['P01', 'P02', 'P03'],
        onCreateTask: noop,
        onTransitionTask: noop,
        onCreateComment: noop,
        onMarkNotificationRead: noop,
        onAddMember: noop,
      }),
    );
    expect(viewerHtml).toContain('No actions available');
    expect(viewerHtml).not.toContain('Post anchored comment');
    expect(viewerHtml).not.toContain('Add member');

    const loadingHtml = renderToStaticMarkup(
      createElement(WorkflowPanel, {
        workflow: null,
        workflowState: 'loading',
        workflowFailure: null,
        onRetryLoad: noop,
        actionBusy: null,
        actionFailure: null,
        actionNotice: null,
        accounts: [],
        periods: ['P01'],
        onCreateTask: noop,
        onTransitionTask: noop,
        onCreateComment: noop,
        onMarkNotificationRead: noop,
        onAddMember: noop,
      }),
    );
    expect(loadingHtml).toContain('role="status"');
    expect(loadingHtml).toContain('aria-busy="true"');

    const errorHtml = renderToStaticMarkup(
      createElement(WorkflowPanel, {
        workflow: null,
        workflowState: 'error',
        workflowFailure: { code: 'TENANT_FORBIDDEN', message: 'Forbidden' },
        onRetryLoad: noop,
        actionBusy: null,
        actionFailure: null,
        actionNotice: null,
        accounts: [],
        periods: ['P01'],
        onCreateTask: noop,
        onTransitionTask: noop,
        onCreateComment: noop,
        onMarkNotificationRead: noop,
        onAddMember: noop,
      }),
    );
    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain('TENANT_FORBIDDEN');
    expect(errorHtml).toContain('Retry failed action');
  });
});

const sampleWorkforceWorkspace: WorkforceWorkspaceResponse = {
  companyId: COMPANY_ID,
  fiscalYear: 2026,
  currency: 'USD',
  currencyScale: 2,
  actorRole: 'owner',
  moduleSpec: {
    moduleKey: 'workforce',
    moduleName: 'Workforce & Headcount Compensation',
    version: '2.0.0',
    dimensions: ['department', 'position', 'account'],
    driverKinds: ['fixed'],
    recommendedStatementLineKeys: ['pl.opex.payroll', 'pl.cogs.direct'],
    inputColumns: [],
    reportPackSections: ['headcount_fte', 'compensation_breakdown'],
  },
  periods: ['P01', 'P02', 'P03'],
  accounts: [
    { code: '5100', name: 'Direct Engineering Payroll', type: 'expense' },
    { code: '6100', name: 'OpEx Payroll & Benefits', type: 'expense' },
  ],
  positions: [
    {
      id: '77777777-7777-4777-8777-777777777777',
      positionCode: 'ENG-001',
      title: 'Senior Platform Engineer',
      departmentName: 'Engineering',
      accountCode: '5100',
      accountName: 'Direct Engineering Payroll',
      startPeriodCode: 'P01',
      endPeriodCode: null,
      fte: '1.00',
      annualSalary: '120000.00',
      burdenRate: '0.20',
      bonusRate: '0.10',
      rampFirstPeriodPct: '1.00',
      meritPeriodCode: null,
      meritIncreasePct: '0.00',
      status: 'active',
      createdAt: '2026-11-25T12:00:00.000Z',
      updatedAt: '2026-11-25T12:00:00.000Z',
    },
  ],
};

const sampleWorkforcePreview: WorkforcePreviewResponse = {
  companyId: COMPANY_ID,
  fiscalYear: 2026,
  currency: 'USD',
  currencyScale: 2,
  periods: ['P01', 'P02', 'P03'],
  positionPeriodRows: [],
  positionSummaries: [
    {
      positionCode: 'ENG-001',
      title: 'Senior Platform Engineer',
      departmentName: 'Engineering',
      accountCode: '5100',
      status: 'active',
      fteMonths: '3.00',
      totalBasePay: '30000.00',
      totalBenefits: '6000.00',
      totalBonus: '3000.00',
      totalCost: '39000.00',
    },
  ],
  departmentSummaries: [{ departmentName: 'Engineering', fteMonths: '3.00', totalCost: '39000.00' }],
  fteByPeriod: { P01: '1.00', P02: '1.00', P03: '1.00' },
  costByPeriod: { P01: '13000.00', P02: '13000.00', P03: '13000.00' },
  grandTotalFteMonths: '3.00',
  grandTotalCost: '39000.00',
  compiledDrivers: [],
  driverPlan: {
    fiscalYear: 2026,
    currencyScale: 2,
    periods: ['P01', 'P02', 'P03'],
    lines: [],
    totalsByAccount: { '5100': '39000.00' },
    totalsByPeriod: { P01: '13000.00', P02: '13000.00', P03: '13000.00' },
    grandTotal: '39000.00',
  },
};

describe('M2 Workforce module view inside Model Grid (WI-0035)', () => {
  it('validates Workforce draft positions strictly by string shape and builds wire payloads without client math', () => {
    const initial = createInitialWorkforceDraft(2026, '5100', 'P01');
    const missingSalary = buildWorkforcePositionsPayload(initial, ['P01', 'P02', 'P03'], {
      requireScenarioName: true,
    });
    expect(missingSalary.ok).toBe(false);
    if (!missingSalary.ok) {
      expect(missingSalary.issues.some((i) => i.includes('position code is required'))).toBe(true);
      expect(missingSalary.issues.some((i) => i.includes('annual salary'))).toBe(true);
    }

    const hydrated = workforceDraftFromRecords(
      sampleWorkforceWorkspace.positions,
      2026,
      '5100',
      'P01',
    );
    const built = buildWorkforcePositionsPayload(hydrated, ['P01', 'P02', 'P03'], {
      requireScenarioName: true,
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.scenarioName).toBe('Workforce Plan FY2026');
      expect(built.positions[0]?.positionCode).toBe('ENG-001');
      expect(built.positions[0]?.annualSalary).toBe('120000.00');
    }
  });

  it('renders WorkforcePanel across loading, error, read-only viewer, and populated preview states without h1s or pill clutter', () => {
    const draft = workforceDraftFromRecords(sampleWorkforceWorkspace.positions, 2026, '5100', 'P01');

    const populatedHtml = renderToStaticMarkup(
      createElement(WorkforcePanel, {
        workspace: sampleWorkforceWorkspace,
        loadState: 'idle',
        loadFailure: null,
        onRetryLoad: noop,
        onOpenCoaMapper: noop,
        draft,
        onChangeDraft: noop,
        previewResult: sampleWorkforcePreview,
        commitResult: null,
        actionBusy: null,
        actionFailure: null,
        actionNotice: 'Saved 1 Workforce position(s) to database.',
        onSaveRoster: noop,
        onPreview: noop,
        onCommit: noop,
        onRetryAction: noop,
      }),
    );

    expect(populatedHtml).toContain('Workforce &amp; headcount module');
    expect(populatedHtml).toContain('ENG-001');
    expect(populatedHtml).toContain('Senior Platform Engineer');
    expect(populatedHtml).toContain('39000.00');
    expect(populatedHtml).toContain('3.00');
    expect(populatedHtml).toContain('Commit to scenario');
    expect(populatedHtml).not.toContain('<h1');
    expect(populatedHtml).not.toContain('rounded-full');

    const viewerHtml = renderToStaticMarkup(
      createElement(WorkforcePanel, {
        workspace: { ...sampleWorkforceWorkspace, actorRole: 'viewer' },
        loadState: 'idle',
        loadFailure: null,
        onRetryLoad: noop,
        onOpenCoaMapper: noop,
        draft,
        onChangeDraft: noop,
        previewResult: null,
        commitResult: null,
        actionBusy: null,
        actionFailure: null,
        actionNotice: null,
        onSaveRoster: noop,
        onPreview: noop,
        onCommit: noop,
        onRetryAction: noop,
      }),
    );
    expect(viewerHtml).toContain('read-only');
    expect(viewerHtml).not.toContain('Save roster');
    expect(viewerHtml).not.toContain('Commit to scenario');

    const loadingHtml = renderToStaticMarkup(
      createElement(WorkforcePanel, {
        workspace: null,
        loadState: 'loading',
        loadFailure: null,
        onRetryLoad: noop,
        onOpenCoaMapper: noop,
        draft,
        onChangeDraft: noop,
        previewResult: null,
        commitResult: null,
        actionBusy: null,
        actionFailure: null,
        actionNotice: null,
        onSaveRoster: noop,
        onPreview: noop,
        onCommit: noop,
        onRetryAction: noop,
      }),
    );
    expect(loadingHtml).toContain('aria-busy="true"');

    const errorHtml = renderToStaticMarkup(
      createElement(WorkforcePanel, {
        workspace: null,
        loadState: 'error',
        loadFailure: { code: 'TENANT_FORBIDDEN', message: 'Forbidden' },
        onRetryLoad: noop,
        onOpenCoaMapper: noop,
        draft,
        onChangeDraft: noop,
        previewResult: null,
        commitResult: null,
        actionBusy: null,
        actionFailure: null,
        actionNotice: null,
        onSaveRoster: noop,
        onPreview: noop,
        onCommit: noop,
        onRetryAction: noop,
      }),
    );
    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain('TENANT_FORBIDDEN');
  });
});

const sampleFlux: FluxAnalysisResponse = {
  companyId: COMPANY_ID,
  fiscalYear: 2026,
  throughPeriodCode: 'P01',
  scenarioId: null,
  scenarioName: 'Budget FY2026',
  planVersionId: null,
  versionNo: 1,
  hasPlan: true,
  minAbsVariance: '100.00',
  topN: 2,
  totalPlannedAccounts: 4,
  materialCount: 3,
  otherPlannedCount: 2,
  drivers: [
    {
      rank: 1,
      accountCode: '4000',
      accountName: 'Service revenue',
      accountType: 'revenue',
      actual: '11850.00',
      plan: '10000.00',
      varianceAmount: '1850.00',
      absVarianceAmount: '1850.00',
      variancePctKind: 'computed',
      variancePctFormatted: '18.50%',
      shareOfAbsVariancePct: '52.86%',
      favorability: 'favorable',
      isMaterial: true,
    },
  ],
  unplannedAccounts: [
    {
      accountCode: '6300',
      accountName: 'Legal advisory',
      accountType: 'expense',
      actual: '300.00',
    },
  ],
  bridge: {
    planTotal: '18300.00',
    topDriversVariance: '3050.00',
    otherPlannedVariance: '-350.00',
    plannedVarianceTotal: '2700.00',
    plannedActualTotal: '21000.00',
    unplannedActualTotal: '300.00',
    actualTotal: '21300.00',
    totalAbsPlannedVariance: '3500.00',
    revenueVariance: '1850.00',
    expenseVariance: '850.00',
    netOperatingVariance: '1000.00',
    tieOutValid: true,
  },
};

const samplePvm: PvmBridgeResponse = {
  companyId: COMPANY_ID,
  fiscalYear: 2026,
  periodCode: 'P01',
  baseCurrency: 'USD',
  scenarioName: 'Budget FY2026',
  totalPlanUnits: '200.00',
  totalActualUnits: '230.00',
  totalPlanRevenue: '3000.00',
  totalActualRevenue: '3410.00',
  totalVariance: '410.00',
  variancePct: '13.67%',
  variancePctStatus: 'computed',
  priceVariance: '10.00',
  volumeVariance: '450.00',
  mixVariance: '-50.00',
  invariantPassed: true,
  invariantDelta: '0',
  items: [
    {
      key: 'SKU_A',
      label: 'Enterprise Seat',
      planUnits: '100.00',
      planPrice: '10.00',
      actualUnits: '120.00',
      actualPrice: '11.00',
      planRevenue: '1000.00',
      actualRevenue: '1320.00',
      totalVariance: '320.00',
      priceEffect: '120.00',
      volumeAtPlanPrice: '200.00',
      mixContribution: '-25.00',
      favorability: 'favorable',
    },
  ],
};

describe('M2 Flux Waterfall & PVM Bridge view inside StatementsPage (WI-0036)', () => {
  it('validates PVM segment drafts strictly by decimal string shape and builds wire items without float arithmetic', () => {
    const emptyBuilt = buildPvmBridgeItemsPayload([]);
    expect(emptyBuilt.ok).toBe(false);
    if (!emptyBuilt.ok) {
      expect(emptyBuilt.issues[0]).toContain('NO_PVM_ITEMS');
    }

    const badRows = [
      { ...createEmptyPvmItemDraft('1'), key: 'SKU_A', label: 'A', planUnits: '-5', planPrice: '10.00', actualUnits: '10', actualPrice: '11.00' },
      { ...createEmptyPvmItemDraft('2'), key: 'SKU_A', label: 'Duplicate', planUnits: '10', planPrice: '10.00', actualUnits: '12', actualPrice: 'bad' },
    ];
    const invalidBuilt = buildPvmBridgeItemsPayload(badRows);
    expect(invalidBuilt.ok).toBe(false);
    if (!invalidBuilt.ok) {
      expect(invalidBuilt.issues.some((i) => i.includes('DUPLICATE_ITEM_KEY:SKU_A'))).toBe(true);
      expect(invalidBuilt.issues.some((i) => i.includes('plan units must be a non-negative'))).toBe(true);
      expect(invalidBuilt.issues.some((i) => i.includes('actual price must be a canonical decimal'))).toBe(true);
    }

    const validBuilt = buildPvmBridgeItemsPayload([
      {
        id: '1',
        key: 'SKU_A',
        label: 'Enterprise Seat',
        planUnits: '100',
        planPrice: '10.00',
        actualUnits: '120',
        actualPrice: '11.00',
      },
    ]);
    expect(validBuilt.ok).toBe(true);
    if (validBuilt.ok) {
      expect(validBuilt.items[0]?.planPrice).toBe('10.00');
      expect(validBuilt.items[0]?.actualUnits).toBe('120');
    }
  });

  it('renders FluxPvmPanel across loading, empty, error, partial unplanned disclosure, and populated PVM invariant states cleanly', () => {
    const populatedHtml = renderToStaticMarkup(
      createElement(FluxPvmPanel, {
        period: 'P01',
        flux: sampleFlux,
        fluxState: 'idle',
        fluxError: null,
        minAbsInput: '100.00',
        topNInput: 2,
        filterError: null,
        onChangeMinAbs: noop,
        onChangeTopN: noop,
        onApplyFilter: noop,
        onRetryFlux: noop,
        onOpenImport: noop,
        pvmItems: [
          {
            id: '1',
            key: 'SKU_A',
            label: 'Enterprise Seat',
            planUnits: '100',
            planPrice: '10.00',
            actualUnits: '120',
            actualPrice: '11.00',
          },
        ],
        onChangePvmItems: noop,
        pvmResult: samplePvm,
        pvmState: 'idle',
        pvmIssues: [],
        pvmError: null,
        onComputePvm: noop,
        onResetPvm: noop,
      }),
    );

    expect(populatedHtml).toContain('Material Flux Waterfall Bridge');
    expect(populatedHtml).toContain('18300.00');
    expect(populatedHtml).toContain('52.86%');
    expect(populatedHtml).toContain('Tie-out valid');
    expect(populatedHtml).toContain('Partial workspace data:');
    expect(populatedHtml).toContain('6300');
    expect(populatedHtml).toContain('Legal advisory');
    expect(populatedHtml).toContain('Price-Volume-Mix (PVM) Decomposition Bridge');
    expect(populatedHtml).toContain('Invariant holds');
    expect(populatedHtml).toContain('410.00');
    expect(populatedHtml).toContain('-50.00');
    expect(populatedHtml).not.toContain('<h1');
    expect(populatedHtml).not.toContain('rounded-full');

    const emptyHtml = renderToStaticMarkup(
      createElement(FluxPvmPanel, {
        period: 'P01',
        flux: { ...sampleFlux, hasPlan: false, drivers: [], unplannedAccounts: [] },
        fluxState: 'idle',
        fluxError: null,
        minAbsInput: '0.00',
        topNInput: 10,
        filterError: null,
        onChangeMinAbs: noop,
        onChangeTopN: noop,
        onApplyFilter: noop,
        onRetryFlux: noop,
        onOpenImport: noop,
        pvmItems: [createEmptyPvmItemDraft('1')],
        onChangePvmItems: noop,
        pvmResult: null,
        pvmState: 'idle',
        pvmIssues: [],
        pvmError: null,
        onComputePvm: noop,
        onResetPvm: noop,
      }),
    );
    expect(emptyHtml).toContain('Open Import Wizard');

    const errorHtml = renderToStaticMarkup(
      createElement(FluxPvmPanel, {
        period: 'P01',
        flux: null,
        fluxState: 'error',
        fluxError: { code: 'PERIOD_NOT_FOUND', message: 'Missing period' },
        minAbsInput: '0.00',
        topNInput: 10,
        filterError: null,
        onChangeMinAbs: noop,
        onChangeTopN: noop,
        onApplyFilter: noop,
        onRetryFlux: noop,
        onOpenImport: noop,
        pvmItems: [createEmptyPvmItemDraft('1')],
        onChangePvmItems: noop,
        pvmResult: null,
        pvmState: 'error',
        pvmIssues: ['EMPTY_ITEM_KEY'],
        pvmError: { code: 'VALIDATION_FAILED', message: 'Invalid PVM' },
        onComputePvm: noop,
        onResetPvm: noop,
      }),
    );
    expect(errorHtml).toContain('PERIOD_NOT_FOUND');
    expect(errorHtml).toContain('VALIDATION_FAILED');
    expect(errorHtml).toContain('EMPTY_ITEM_KEY');
  });

  it('renders DashboardsPanel across populated, unplanned partial, empty, loading, and error states without h1 or pill badges', () => {
    const sampleDashboard: DashboardSummaryResponse = {
      companyId: COMPANY_ID,
      companyName: 'Aurora SaaS Corp',
      baseCurrency: 'USD',
      currencyScale: 2,
      range: { fromPeriodCode: 'P01', throughPeriodCode: 'P04', fiscalYear: 2026 },
      hasActuals: true,
      hasPlan: false,
      scenarioName: null,
      versionNo: null,
      articulation: { valid: true, checks: [] },
      kpis: [
        {
          key: 'pnl.revenue',
          label: 'Revenue (YTD)',
          category: 'profitability',
          formula: 'SUM(pl.revenue.*)',
          sourceKeys: ['pl.revenue.product'],
          boardPackKey: 'statement:pnl.revenue',
          unit: 'currency',
          format: 'currency',
          basis: 'ytd',
          phase: 'M2',
          value: '1200.00',
          formattedValue: '1200.00',
          status: 'computed',
        },
        {
          key: 'pnl.ebitda',
          label: 'EBITDA',
          category: 'profitability',
          formula: 'pnl.gross_profit - SUM(pl.opex.*)',
          sourceKeys: ['pl.opex.payroll'],
          boardPackKey: null,
          unit: 'currency',
          format: 'currency',
          basis: 'ytd',
          phase: 'M2',
          value: '360.00',
          formattedValue: '360.00',
          status: 'computed',
        },
        {
          key: 'pnl.net_income',
          label: 'Net Income (YTD)',
          category: 'profitability',
          formula: 'pnl.ebit + pl.nonop.* - pl.tax.income_tax',
          sourceKeys: ['pl.tax.income_tax'],
          boardPackKey: 'statement:pnl.netIncome',
          unit: 'currency',
          format: 'currency',
          basis: 'ytd',
          phase: 'M2',
          value: '252.00',
          formattedValue: '252.00',
          status: 'computed',
        },
        {
          key: 'cf.ending_cash',
          label: 'Ending Cash',
          category: 'cash',
          formula: 'bs.asset.cash',
          sourceKeys: ['bs.asset.cash'],
          boardPackKey: 'statement:cf.endingCash',
          unit: 'currency',
          format: 'currency',
          basis: 'point_in_time',
          phase: 'M2',
          value: '1500.00',
          formattedValue: '1500.00',
          status: 'computed',
        },
        {
          key: 'plan.revenue_attainment',
          label: 'Revenue Plan Attainment %',
          category: 'plan',
          formula: '(pnl.revenue / plan.revenue) * 100',
          sourceKeys: ['pl.revenue.product'],
          boardPackKey: null,
          unit: 'percent',
          format: 'percent',
          basis: 'ytd',
          phase: 'M2',
          value: null,
          formattedValue: 'not planned',
          status: 'not_planned',
        },
      ],
      trend: [
        {
          periodCode: 'P01',
          periodNo: 1,
          fiscalYear: 2026,
          revenue: '1200.00',
          ebitda: '360.00',
          netIncome: '252.00',
          operatingCashFlow: '300.00',
          endingCash: '1500.00',
          revenueBarPct: 80,
          ebitdaBarPct: 24,
          cashBarPct: 100,
          ebitdaPositive: true,
          cashPositive: true,
        },
      ],
      reportBuilder: {
        templateId: 'executive_summary',
        templateLabel: 'Executive Summary Pack',
        blockCount: 2,
        citedBlockCount: 2,
        unlinkedBlockCount: 0,
        citationCoveragePct: '100.00%',
        blocks: [
          {
            id: 'exec-rev',
            kind: 'metric',
            title: 'YTD Revenue',
            citationKey: 'pnl.revenue',
            unit: 'currency',
            value: '1200.00',
            formattedValue: '1200.00',
            status: 'computed',
            cited: true,
          },
          {
            id: 'exec-cash',
            kind: 'statement_line',
            title: 'Cash & Equivalents Line',
            citationKey: 'bs.asset.cash',
            unit: 'currency',
            value: '1500.00',
            formattedValue: '1500.00',
            status: 'computed',
            cited: true,
          },
        ],
      },
      sources: [],
    };

    const populatedHtml = renderToStaticMarkup(
      createElement(DashboardsPanel, {
        dashboard: sampleDashboard,
        loadState: 'idle',
        loadError: null,
        templateId: 'executive_summary',
        onChangeTemplate: noop,
        onRetry: noop,
        onOpenImport: noop,
      }),
    );

    expect(populatedHtml).toContain('Executive KPIs &amp; Report Builder');
    expect(populatedHtml).toContain('1200.00');
    expect(populatedHtml).toContain('360.00');
    expect(populatedHtml).toContain('1500.00');
    expect(populatedHtml).toContain('not planned');
    expect(populatedHtml).toContain('Partial workspace data:');
    expect(populatedHtml).toContain('100.00% cited');
    expect(populatedHtml).toContain('2/2 blocks cited (100.00%)');
    expect(populatedHtml).toContain('bs.asset.cash');
    expect(populatedHtml).not.toContain('<h1');
    expect(populatedHtml).not.toContain('rounded-full');

    const emptyHtml = renderToStaticMarkup(
      createElement(DashboardsPanel, {
        dashboard: { ...sampleDashboard, hasActuals: false },
        loadState: 'idle',
        loadError: null,
        templateId: 'executive_summary',
        onChangeTemplate: noop,
        onRetry: noop,
        onOpenImport: noop,
      }),
    );
    expect(emptyHtml).toContain('Open Import Wizard');

    const loadingHtml = renderToStaticMarkup(
      createElement(DashboardsPanel, {
        dashboard: null,
        loadState: 'loading',
        loadError: null,
        templateId: 'executive_summary',
        onChangeTemplate: noop,
        onRetry: noop,
        onOpenImport: noop,
      }),
    );
    expect(loadingHtml).toContain('Evaluating KPI catalog');

    const errorHtml = renderToStaticMarkup(
      createElement(DashboardsPanel, {
        dashboard: null,
        loadState: 'error',
        loadError: { code: 'PERIOD_NOT_FOUND', message: 'Period P99 does not exist.' },
        templateId: 'executive_summary',
        onChangeTemplate: noop,
        onRetry: noop,
        onOpenImport: noop,
      }),
    );
    expect(errorHtml).toContain('PERIOD_NOT_FOUND');
    expect(errorHtml).toContain('Period P99 does not exist.');
  });
});

