import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { SpineRoutePath } from '../../shared/spine.js';
import type {
  DriverPlanCommitResponse,
  DriverPlanPreviewResponse,
  RollingForecastResponse,
  ScenarioComparisonResponse,
  ScenarioSummary,
} from '../../shared/planning.js';
import {
  ApiClientError,
  createApiClient,
  type AccountDrilldownPayload,
  type ChartAccountPayload,
  type TrialBalancePayload,
  type TrialBalanceRowPayload,
} from '../api/client.js';
import {
  InlineEmptyState,
  InlineErrorState,
  LoadingState,
  PartialBanner,
} from '../components/StateFrame.js';
import type {
  AddCompanyMemberRequest,
  CreateApprovalTaskRequest,
  CreateWorkflowCommentRequest,
  TransitionApprovalTaskRequest,
  WorkflowOverviewResponse,
} from '../../shared/workflow.js';
import type {
  WorkforceCommitResponse,
  WorkforcePreviewResponse,
  WorkforceWorkspaceResponse,
} from '../../shared/workforce.js';
import {
  DriverAuthoringPanel,
  type DriverAuthoringFailure,
  RollingForecastTable,
  ScenarioComparisonTable,
  ScenarioInventory,
  WorkflowPanel,
  type WorkflowActionFailure,
} from '../components/PlanningWorkspace.js';
import { WorkforcePanel, type WorkforceActionFailure } from '../components/WorkforcePanel.js';
import {
  buildDriverDefinitions,
  buildWorkforcePositionsPayload,
  createInitialDriverPlanDraft,
  createInitialWorkforceDraft,
  periodCodes,
  resolvePlanningDefaults,
  workforceDraftFromRecords,
  type DriverPlanDraft,
  type PlanningDefaults,
  type WorkforcePlanDraft,
} from '../state/planningView.js';
import { useWorkspaceStore } from '../state/workspaceStore.js';
import type { SpinePageProps } from './SignInPage.js';

type GridView = 'actuals' | 'planning';
type GridAction = 'trial-balance' | 'drill';

interface GridFailure {
  readonly code: string;
  readonly message: string;
  readonly action: GridAction;
}

function toFailure(error: unknown, action: GridAction): GridFailure {
  if (error instanceof ApiClientError) {
    return { code: error.code, message: error.message, action };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : 'The report could not be loaded.',
    action,
  };
}

/**
 * Actuals view of the Model Grid: the server's trial balance for the active company, one row per
 * active account, with drill-to-source (`#DRILL`, §9.4). Money is rendered exactly as the server
 * serialized it and no amount is derived in the browser.
 */
function ActualsGrid(props: {
  readonly companyId: string | null;
  readonly authToken: string | null;
  readonly currency: string;
  readonly periodCount: number;
  readonly onNavigate: (path: SpineRoutePath) => void;
  readonly forcedState?: 'loading' | 'empty' | 'error';
}): ReactElement {
  const { companyId, authToken, onNavigate, forcedState } = props;

  const [period, setPeriod] = useState('P12');
  const [report, setReport] = useState<TrialBalancePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<GridFailure | null>(null);

  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [drill, setDrill] = useState<AccountDrilldownPayload | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const loadReport = useCallback(async (): Promise<void> => {
    if (companyId === null || authToken === null) return;
    setLoading(true);
    setFailure(null);
    try {
      const result = await createApiClient({ getToken: () => authToken }).getTrialBalance(companyId, {
        period,
      });
      setReport(result);
    } catch (error) {
      setReport(null);
      setFailure(toFailure(error, 'trial-balance'));
    } finally {
      setLoading(false);
    }
  }, [authToken, companyId, period]);

  useEffect(() => {
    if (companyId === null || authToken === null) return;
    void loadReport();
  }, [authToken, companyId, loadReport]);

  const openDrilldown = useCallback(
    async (accountCode: string): Promise<void> => {
      if (companyId === null || authToken === null) return;
      setSelectedCode(accountCode);
      setDrill(null);
      setDrillLoading(true);
      setFailure(null);
      try {
        const result = await createApiClient({ getToken: () => authToken }).getAccountDrilldown(
          companyId,
          accountCode,
          { period },
        );
        setDrill(result);
      } catch (error) {
        setDrill(null);
        setFailure(toFailure(error, 'drill'));
      } finally {
        setDrillLoading(false);
      }
    },
    [authToken, companyId, period],
  );

  const retryFailedAction = (): void => {
    if (failure?.action === 'drill' && selectedCode !== null) {
      void openDrilldown(selectedCode);
      return;
    }
    void loadReport();
  };

  if (forcedState === 'loading' || loading || drillLoading) {
    return (
      <LoadingState
        label={
          drillLoading
            ? 'Loading the contributing source rows for this account...'
            : 'Loading the trial balance and period basis from the server...'
        }
      />
    );
  }

  if (forcedState === 'error' || failure !== null) {
    return (
      <InlineErrorState
        code={failure?.code ?? 'MODEL_VERSION_LOCKED'}
        message={failure?.message ?? 'The trial balance could not be loaded for this period.'}
        onRetry={retryFailedAction}
      />
    );
  }

  if (companyId === null || authToken === null) {
    return (
      <InlineEmptyState
        disclosure="Sign in and create a company workspace before reading the trial balance; every cell is a server-computed decimal string."
        ctaLabel="Go to Sign In"
        onAction={() => onNavigate('/sign-in')}
      />
    );
  }

  if (forcedState === 'empty' || report === null) {
    return (
      <InlineEmptyState
        disclosure="No trial balance has been read for this company yet. Import a ledger export to post actuals, then return here."
        ctaLabel="Import Actuals in Import Wizard"
        onAction={() => onNavigate('/import')}
      />
    );
  }

  if (report.sources.length === 0) {
    return (
      <InlineEmptyState
        disclosure="This company has no committed ledger postings yet, so there is no actual grid to render. Import a ledger export first."
        ctaLabel="Import Actuals in Import Wizard"
        onAction={() => onNavigate('/import')}
      />
    );
  }

  const currency = props.currency;
  const selectedRow: TrialBalanceRowPayload | null =
    report.rows.find((row) => row.code === selectedCode) ?? null;
  const drillTies =
    selectedRow === null ||
    drill === null ||
    (drill.totalDebit === selectedRow.totalDebit && drill.totalCredit === selectedRow.totalCredit);

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          Actuals only — year-to-date through {report.throughPeriodCode ?? 'the full calendar'} ·{' '}
          {report.sources.length} committed source file(s) · amounts in {currency}.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="grid-period" className="block text-xs font-medium text-slate-600">
              Through period
            </label>
            <select
              id="grid-period"
              value={period}
              onChange={(event) => {
                setPeriod(event.target.value);
                setSelectedCode(null);
                setDrill(null);
              }}
              className="mt-1 rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              {periodCodes(props.periodCount).map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/statements')}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            View Statements
          </button>
          <button
            type="button"
            onClick={() => void loadReport()}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Recalc
          </button>
        </div>
      </div>

      {report.rows.length === 0 && (
        <PartialBanner detail="This company has no active chart of accounts, so no grid rows can be rendered. Seed or map accounts before importing." />
      )}

      {!report.isBalanced && (
        <PartialBanner
          detail={`The trial balance does not tie: ${String(report.unbalancedEntryIds.length)} unbalanced journal(s) are in scope. Treat every figure below as provisional.`}
        />
      )}

      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <caption className="sr-only">
            Trial balance through {report.throughPeriodCode ?? 'the full calendar'}, one row per active account
          </caption>
          <thead className="bg-slate-50 text-left font-medium text-slate-700">
            <tr>
              <th scope="col" className="px-3 py-2">Code</th>
              <th scope="col" className="px-3 py-2">Account</th>
              <th scope="col" className="px-3 py-2">Type</th>
              <th scope="col" className="px-3 py-2 text-right">Debit</th>
              <th scope="col" className="px-3 py-2 text-right">Credit</th>
              <th scope="col" className="px-3 py-2 text-right">Natural activity</th>
              <th scope="col" className="px-3 py-2 text-right">Source rows</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {report.rows.map((row) => (
              <tr key={row.accountId} className={selectedCode === row.code ? 'bg-slate-50' : undefined}>
                <td className="px-3 py-2 font-mono">{row.code}</td>
                <td className="px-3 py-2">{row.name}</td>
                <td className="px-3 py-2 text-slate-600">
                  {row.type} · {row.normalSide}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{row.totalDebit}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{row.totalCredit}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{row.naturalActivity}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => void openDrilldown(row.code)}
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Drill
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 font-semibold text-slate-900">
            <tr>
              <th scope="row" colSpan={3} className="px-3 py-2 text-left">
                Total ({report.isBalanced ? 'balanced' : 'NOT balanced'})
              </th>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{report.totalDebit}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{report.totalCredit}</td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2" />
            </tr>
          </tfoot>
        </table>
      </div>

      {selectedRow !== null && (
        <aside className="rounded border border-slate-300 bg-slate-50 p-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-900">
              Drill-to-source · {selectedRow.code} {selectedRow.name}
            </h2>
            <button
              type="button"
              onClick={() => {
                setSelectedCode(null);
                setDrill(null);
              }}
              className="rounded border border-slate-300 bg-white px-2 py-0.5 text-slate-700"
            >
              Close
            </button>
          </div>
          {drill === null ? (
            <p className="mt-2 text-slate-600">No posting rows were returned for this account.</p>
          ) : (
            <>
              <p className={`mt-2 font-mono ${drillTies ? 'text-slate-700' : 'text-red-700'}`}>
                {drillTies
                  ? `Server totals tie to the grid row: debit ${selectedRow.totalDebit}, credit ${selectedRow.totalCredit}.`
                  : '#DRILL — the contributing rows do not tie back to the grid row; do not use these figures.'}
              </p>
              <div className="mt-2 max-h-64 overflow-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <caption className="sr-only">Contributing source rows for account {selectedRow.code}</caption>
                  <thead className="text-left text-slate-600">
                    <tr>
                      <th className="px-2 py-1">Date</th>
                      <th className="px-2 py-1">Period</th>
                      <th className="px-2 py-1">Ref</th>
                      <th className="px-2 py-1 text-right">Debit</th>
                      <th className="px-2 py-1 text-right">Credit</th>
                      <th className="px-2 py-1">Source</th>
                      <th className="px-2 py-1">Row</th>
                      <th className="px-2 py-1">Raw cells</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {drill.rows.map((row) => (
                      <tr key={`${row.entryId}-${row.rowNo}`}>
                        <td className="px-2 py-1 font-mono">{row.entryDate}</td>
                        <td className="px-2 py-1 font-mono">{row.periodCode}</td>
                        <td className="px-2 py-1 font-mono">{row.sourceRef ?? '—'}</td>
                        <td className="px-2 py-1 text-right font-mono">{row.debit}</td>
                        <td className="px-2 py-1 text-right font-mono">{row.credit}</td>
                        <td className="px-2 py-1">
                          {row.sourceFilename}
                          <span className="text-slate-500"> · {row.sourceHash.slice(0, 8)}…</span>
                        </td>
                        <td className="px-2 py-1 font-mono">{row.rowNo}</td>
                        <td className="px-2 py-1 font-mono text-slate-600">{row.rawCells.join(' | ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </aside>
      )}
    </div>
  );
}

type PlanningAction = 'scenarios' | 'forecast' | 'comparison';

interface PlanningFailure {
  readonly code: string;
  readonly message: string;
  readonly action: PlanningAction;
}

function toPlanningFailure(error: unknown, action: PlanningAction): PlanningFailure {
  if (error instanceof ApiClientError) {
    return { code: error.code, message: error.message, action };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : 'The planning report could not be loaded.',
    action,
  };
}

function toDriverFailure(error: unknown, action: 'preview' | 'commit'): DriverAuthoringFailure {
  if (error instanceof ApiClientError) {
    const rawIssues = error.details['issues'];
    const issues = Array.isArray(rawIssues)
      ? rawIssues.map((item) => String(item))
      : [];
    return { code: error.code, message: error.message, issues, action };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : 'Driver plan request failed.',
    issues: [],
    action,
  };
}

/**
 * Planning view of the Model Grid (MASTER_PROMPT §2.5 M2, §9.3.5 sheet tabs, §11.4).
 *
 * Independent server reads (scenarios, rolling forecast, scenario comparison, and chart of
 * accounts) plus driver authoring (preview -> named scenario commit) — every figure is a server
 * decimal string and every retry re-runs only the failed action.
 */
export function PlanningView(props: {
  readonly companyId: string | null;
  readonly authToken: string | null;
  readonly fiscalYear: number;
  readonly periodCount: number;
  readonly currency: string;
  readonly onNavigate: (path: SpineRoutePath) => void;
  readonly forcedState?: 'loading' | 'empty' | 'error';
}): ReactElement {
  const { companyId, authToken, onNavigate, forcedState } = props;
  const periods = periodCodes(props.periodCount);

  const [scenarios, setScenarios] = useState<readonly ScenarioSummary[] | null>(null);
  const [scenarioState, setScenarioState] = useState<'loading' | 'idle' | 'error'>('loading');
  const [scenarioFailure, setScenarioFailure] = useState<PlanningFailure | null>(null);
  const [scenarioReload, setScenarioReload] = useState(0);

  const [accounts, setAccounts] = useState<readonly ChartAccountPayload[]>([]);
  const [chartState, setChartState] = useState<'loading' | 'idle' | 'error'>('loading');
  const [chartFailure, setChartFailure] = useState<{
    readonly code: string;
    readonly message: string;
  } | null>(null);
  const [chartReload, setChartReload] = useState(0);

  const [driverDraft, setDriverDraft] = useState<DriverPlanDraft>(() =>
    createInitialDriverPlanDraft(''),
  );
  const [previewResult, setPreviewResult] = useState<DriverPlanPreviewResponse | null>(null);
  const [commitResult, setCommitResult] = useState<DriverPlanCommitResponse | null>(null);
  const [actionBusy, setActionBusy] = useState<'preview' | 'commit' | null>(null);
  const [actionFailure, setActionFailure] = useState<DriverAuthoringFailure | null>(null);

  const [selection, setSelection] = useState<PlanningDefaults>({
    selectedScenario: null,
    baseScenario: null,
    targetScenario: null,
  });
  const { selectedScenario, baseScenario, targetScenario } = selection;
  // Empty string = automatic: the server resolves the cutoff to the last period that actually has
  // an active-batch posting, so the opening view is a real rolling forecast and never a guess.
  const [cutoff, setCutoff] = useState<string>('');
  const [forecast, setForecast] = useState<RollingForecastResponse | null>(null);
  const [forecastState, setForecastState] = useState<'loading' | 'idle' | 'error'>('loading');
  const [forecastFailure, setForecastFailure] = useState<PlanningFailure | null>(null);
  const [forecastReload, setForecastReload] = useState(0);

  const [comparison, setComparison] = useState<ScenarioComparisonResponse | null>(null);
  const [comparisonState, setComparisonState] = useState<'loading' | 'idle' | 'error'>('loading');
  const [comparisonFailure, setComparisonFailure] = useState<PlanningFailure | null>(null);
  const [comparisonReload, setComparisonReload] = useState(0);

  const [workflow, setWorkflow] = useState<WorkflowOverviewResponse | null>(null);
  const [workflowState, setWorkflowState] = useState<'loading' | 'idle' | 'error'>('loading');
  const [workflowFailure, setWorkflowFailure] = useState<{
    readonly code: string;
    readonly message: string;
  } | null>(null);
  const [workflowReload, setWorkflowReload] = useState(0);
  const [workflowBusy, setWorkflowBusy] = useState<string | null>(null);
  const [workflowActionFailure, setWorkflowActionFailure] = useState<WorkflowActionFailure | null>(
    null,
  );
  const [workflowNotice, setWorkflowNotice] = useState<string | null>(null);

  const [workforceWorkspace, setWorkforceWorkspace] = useState<WorkforceWorkspaceResponse | null>(
    null,
  );
  const [workforceState, setWorkforceState] = useState<'loading' | 'idle' | 'error'>('loading');
  const [workforceLoadFailure, setWorkforceLoadFailure] = useState<{
    readonly code: string;
    readonly message: string;
  } | null>(null);
  const [workforceReload, setWorkforceReload] = useState(0);
  const [workforceDraft, setWorkforceDraft] = useState<WorkforcePlanDraft>(() =>
    createInitialWorkforceDraft(props.fiscalYear, '', periods[0] ?? 'P01'),
  );
  const [workforcePreviewResult, setWorkforcePreviewResult] =
    useState<WorkforcePreviewResponse | null>(null);
  const [workforceCommitResult, setWorkforceCommitResult] =
    useState<WorkforceCommitResponse | null>(null);
  const [workforceBusy, setWorkforceBusy] = useState<'save' | 'preview' | 'commit' | null>(null);
  const [workforceActionFailure, setWorkforceActionFailure] =
    useState<WorkforceActionFailure | null>(null);
  const [workforceNotice, setWorkforceNotice] = useState<string | null>(null);

  useEffect(() => {
    if (companyId === null || authToken === null) return;
    let cancelled = false;
    setChartState('loading');
    setChartFailure(null);
    createApiClient({ getToken: () => authToken })
      .getChart(companyId)
      .then((result) => {
        if (cancelled) return;
        setAccounts(result.accounts);
        setChartState('idle');
        const firstPostable =
          result.accounts.find((account) => account.active && account.isPostable)?.code ?? '';
        if (firstPostable.length > 0) {
          setDriverDraft((previous) => ({
            ...previous,
            drivers: previous.drivers.map((row) =>
              row.accountCode.length === 0 ? { ...row, accountCode: firstPostable } : row,
            ),
          }));
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setAccounts([]);
        setChartState('error');
        const failure = toPlanningFailure(error, 'scenarios');
        setChartFailure({ code: failure.code, message: failure.message });
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, authToken, chartReload]);

  useEffect(() => {
    if (companyId === null || authToken === null) return;
    let cancelled = false;
    setScenarioState('loading');
    setScenarioFailure(null);
    createApiClient({ getToken: () => authToken })
      .listPlanningScenarios(companyId)
      .then((result) => {
        if (cancelled) return;
        setScenarios(result.scenarios);
        setScenarioState('idle');
        setSelection((previous) => resolvePlanningDefaults(result.scenarios, previous));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setScenarios(null);
        setScenarioState('error');
        setScenarioFailure(toPlanningFailure(error, 'scenarios'));
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, authToken, scenarioReload]);

  useEffect(() => {
    if (companyId === null || authToken === null || selectedScenario === null) return;
    let cancelled = false;
    setForecastState('loading');
    setForecastFailure(null);
    createApiClient({ getToken: () => authToken })
      .getRollingForecast(companyId, {
        year: props.fiscalYear,
        scenario: selectedScenario,
        cutoffPeriod: cutoff === '' ? null : cutoff,
      })
      .then((result) => {
        if (cancelled) return;
        setForecast(result);
        setForecastState('idle');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setForecast(null);
        setForecastState('error');
        setForecastFailure(toPlanningFailure(error, 'forecast'));
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, authToken, selectedScenario, cutoff, props.fiscalYear, forecastReload]);

  useEffect(() => {
    if (
      companyId === null ||
      authToken === null ||
      baseScenario === null ||
      targetScenario === null ||
      baseScenario === targetScenario
    ) {
      setComparison(null);
      setComparisonState('idle');
      setComparisonFailure(null);
      return;
    }
    let cancelled = false;
    setComparisonState('loading');
    setComparisonFailure(null);
    createApiClient({ getToken: () => authToken })
      .compareScenarios(companyId, {
        year: props.fiscalYear,
        base: baseScenario,
        target: targetScenario,
      })
      .then((result) => {
        if (cancelled) return;
        setComparison(result);
        setComparisonState('idle');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setComparison(null);
        setComparisonState('error');
        setComparisonFailure(toPlanningFailure(error, 'comparison'));
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, authToken, baseScenario, targetScenario, props.fiscalYear, comparisonReload]);

  useEffect(() => {
    if (companyId === null || authToken === null) return;
    let cancelled = false;
    setWorkflowState('loading');
    setWorkflowFailure(null);
    createApiClient({ getToken: () => authToken })
      .getWorkflowOverview(companyId)
      .then((result) => {
        if (cancelled) return;
        setWorkflow(result);
        setWorkflowState('idle');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setWorkflow(null);
        setWorkflowState('error');
        const failure = toPlanningFailure(error, 'scenarios');
        setWorkflowFailure({ code: failure.code, message: failure.message });
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, authToken, workflowReload]);

  useEffect(() => {
    if (companyId === null || authToken === null) return;
    let cancelled = false;
    setWorkforceState('loading');
    setWorkforceLoadFailure(null);
    createApiClient({ getToken: () => authToken })
      .getWorkforceWorkspace(companyId, { year: props.fiscalYear })
      .then((result) => {
        if (cancelled) return;
        setWorkforceWorkspace(result);
        setWorkforceState('idle');
        const defaultAcct =
          result.accounts.find((account) => account.type === 'expense')?.code ??
          result.accounts[0]?.code ??
          '';
        const defaultPer = result.periods[0] ?? periods[0] ?? 'P01';
        setWorkforceDraft((previous) =>
          workforceDraftFromRecords(
            result.positions,
            result.fiscalYear,
            defaultAcct,
            defaultPer,
            previous,
          ),
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setWorkforceWorkspace(null);
        setWorkforceState('error');
        const failure = toPlanningFailure(error, 'scenarios');
        setWorkforceLoadFailure({ code: failure.code, message: failure.message });
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, authToken, props.fiscalYear, workforceReload]);

  if (forcedState === 'loading') {
    return <LoadingState label="Loading planning scenarios and the current plan versions from the server..." />;
  }

  if (forcedState === 'error') {
    return (
      <InlineErrorState
        code="PLANNING_UNAVAILABLE"
        message="The planning workspace could not be read for this company."
        onRetry={() => setScenarioReload((key) => key + 1)}
      />
    );
  }

  if (forcedState === 'empty') {
    return (
      <InlineEmptyState
        disclosure="No planning scenario exists for this company yet. A rolling forecast needs a scenario with plan lines, so import a budget or commit a driver plan first."
        ctaLabel="Import a Budget in Import Wizard"
        onAction={() => onNavigate('/import')}
      />
    );
  }

  if (companyId === null || authToken === null) {
    return (
      <InlineEmptyState
        disclosure="Sign in and create a company workspace before reading planning scenarios; every forecast and comparison figure is computed by the server."
        ctaLabel="Go to Sign In"
        onAction={() => onNavigate('/sign-in')}
      />
    );
  }

  if (scenarioState === 'loading') {
    return <LoadingState label="Loading planning scenarios and the current plan versions from the server..." />;
  }

  if (scenarioState === 'error') {
    return (
      <InlineErrorState
        code={scenarioFailure?.code ?? 'INTERNAL_ERROR'}
        message={scenarioFailure?.message ?? 'The scenario inventory could not be read for this company.'}
        onRetry={() => setScenarioReload((key) => key + 1)}
      />
    );
  }

  const runPreviewDriverPlan = async (): Promise<void> => {
    if (companyId === null || authToken === null) return;
    const built = buildDriverDefinitions(driverDraft, periods, { requireScenarioName: false });
    if (!built.ok) {
      setActionFailure({
        code: 'VALIDATION_FAILED',
        message: 'Driver plan validation failed; check the highlighted issues below.',
        issues: built.issues,
        action: 'preview',
      });
      return;
    }
    setActionBusy('preview');
    setActionFailure(null);
    setCommitResult(null);
    try {
      const result = await createApiClient({ getToken: () => authToken }).previewDriverPlan(
        companyId,
        {
          fiscalYear: props.fiscalYear,
          periods: [...periods],
          drivers: [...built.drivers],
        },
      );
      setPreviewResult(result);
    } catch (error: unknown) {
      setActionFailure(toDriverFailure(error, 'preview'));
    } finally {
      setActionBusy(null);
    }
  };

  const runCommitDriverPlan = async (): Promise<void> => {
    if (companyId === null || authToken === null) return;
    const built = buildDriverDefinitions(driverDraft, periods, { requireScenarioName: true });
    if (!built.ok) {
      setActionFailure({
        code: 'VALIDATION_FAILED',
        message: 'Driver plan validation failed; nothing was written.',
        issues: built.issues,
        action: 'commit',
      });
      return;
    }
    setActionBusy('commit');
    setActionFailure(null);
    try {
      const result = await createApiClient({ getToken: () => authToken }).commitDriverPlan(
        companyId,
        {
          fiscalYear: props.fiscalYear,
          scenarioName: built.scenarioName,
          scenarioKind: built.scenarioKind,
          periods: [...periods],
          drivers: [...built.drivers],
        },
      );
      setCommitResult(result);
      setSelection((previous) => ({ ...previous, selectedScenario: result.scenarioName }));
      setScenarioReload((key) => key + 1);
      setForecastReload((key) => key + 1);
      setComparisonReload((key) => key + 1);
      setWorkflowReload((key) => key + 1);
    } catch (error: unknown) {
      setActionFailure(toDriverFailure(error, 'commit'));
    } finally {
      setActionBusy(null);
    }
  };

  const toWorkflowActionFailure = (error: unknown): WorkflowActionFailure => {
    if (error instanceof ApiClientError) {
      const rawIssues = error.details['issues'];
      const issues = Array.isArray(rawIssues) ? rawIssues.map((item) => String(item)) : [];
      return { code: error.code, message: error.message, issues };
    }
    return {
      code: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Workflow request failed.',
      issues: [],
    };
  };

  const runCreateApprovalTask = async (requestBody: CreateApprovalTaskRequest): Promise<void> => {
    if (companyId === null || authToken === null) return;
    setWorkflowBusy('create-task');
    setWorkflowActionFailure(null);
    setWorkflowNotice(null);
    try {
      const created = await createApiClient({ getToken: () => authToken }).createApprovalTask(
        companyId,
        requestBody,
      );
      setWorkflowNotice(
        `Created draft approval task "${created.title}" for ${created.scenarioName} v${String(created.versionNo)}.`,
      );
      setWorkflowReload((key) => key + 1);
    } catch (error: unknown) {
      setWorkflowActionFailure(toWorkflowActionFailure(error));
    } finally {
      setWorkflowBusy(null);
    }
  };

  const runTransitionApprovalTask = async (
    taskId: string,
    requestBody: TransitionApprovalTaskRequest,
  ): Promise<void> => {
    if (companyId === null || authToken === null) return;
    setWorkflowBusy('transition-task');
    setWorkflowActionFailure(null);
    setWorkflowNotice(null);
    try {
      const updated = await createApiClient({ getToken: () => authToken }).transitionApprovalTask(
        companyId,
        taskId,
        requestBody,
      );
      setWorkflowNotice(`Approval task "${updated.title}" transitioned to ${updated.status}.`);
      setWorkflowReload((key) => key + 1);
    } catch (error: unknown) {
      setWorkflowActionFailure(toWorkflowActionFailure(error));
    } finally {
      setWorkflowBusy(null);
    }
  };

  const runCreateWorkflowComment = async (
    requestBody: CreateWorkflowCommentRequest,
  ): Promise<void> => {
    if (companyId === null || authToken === null) return;
    setWorkflowBusy('create-comment');
    setWorkflowActionFailure(null);
    setWorkflowNotice(null);
    try {
      const created = await createApiClient({ getToken: () => authToken }).createWorkflowComment(
        companyId,
        requestBody,
      );
      setWorkflowNotice(`Posted comment on ${created.anchorKey} (${created.scenarioName} v${String(created.versionNo)}).`);
      setWorkflowReload((key) => key + 1);
    } catch (error: unknown) {
      setWorkflowActionFailure(toWorkflowActionFailure(error));
    } finally {
      setWorkflowBusy(null);
    }
  };

  const runMarkNotificationRead = async (notificationId: string): Promise<void> => {
    if (companyId === null || authToken === null) return;
    setWorkflowBusy('mark-read');
    setWorkflowActionFailure(null);
    setWorkflowNotice(null);
    try {
      await createApiClient({ getToken: () => authToken }).markNotificationRead(
        companyId,
        notificationId,
      );
      setWorkflowReload((key) => key + 1);
    } catch (error: unknown) {
      setWorkflowActionFailure(toWorkflowActionFailure(error));
    } finally {
      setWorkflowBusy(null);
    }
  };

  const runAddCompanyMember = async (requestBody: AddCompanyMemberRequest): Promise<void> => {
    if (companyId === null || authToken === null) return;
    setWorkflowBusy('add-member');
    setWorkflowActionFailure(null);
    setWorkflowNotice(null);
    try {
      const member = await createApiClient({ getToken: () => authToken }).addCompanyMember(
        companyId,
        requestBody,
      );
      setWorkflowNotice(`Granted ${member.role} access to ${member.displayName} (${member.email}).`);
      setWorkflowReload((key) => key + 1);
    } catch (error: unknown) {
      setWorkflowActionFailure(toWorkflowActionFailure(error));
    } finally {
      setWorkflowBusy(null);
    }
  };

  const retryDriverAction = (): void => {
    if (actionFailure?.action === 'commit') {
      void runCommitDriverPlan();
      return;
    }
    void runPreviewDriverPlan();
  };

  const toWorkforceFailure = (
    error: unknown,
    action: 'save' | 'preview' | 'commit',
  ): WorkforceActionFailure => {
    if (error instanceof ApiClientError) {
      const rawIssues = error.details['issues'];
      const issues = Array.isArray(rawIssues) ? rawIssues.map((item) => String(item)) : [];
      return { code: error.code, message: error.message, issues, action };
    }
    return {
      code: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Workforce request failed.',
      issues: [],
      action,
    };
  };

  const workforcePeriods = workforceWorkspace?.periods ?? periods;

  const runSaveWorkforceRoster = async (): Promise<void> => {
    if (companyId === null || authToken === null) return;
    const built = buildWorkforcePositionsPayload(workforceDraft, workforcePeriods, {
      requireScenarioName: false,
      allowEmpty: true,
    });
    if (!built.ok) {
      setWorkforceActionFailure({
        code: 'VALIDATION_FAILED',
        message: 'Workforce roster validation failed; no positions were saved.',
        issues: built.issues,
        action: 'save',
      });
      return;
    }
    setWorkforceBusy('save');
    setWorkforceActionFailure(null);
    setWorkforceNotice(null);
    try {
      const updated = await createApiClient({ getToken: () => authToken }).saveWorkforcePositions(
        companyId,
        {
          fiscalYear: props.fiscalYear,
          positions: [...built.positions],
        },
      );
      setWorkforceWorkspace(updated);
      setWorkforceNotice(`Saved ${String(updated.positions.length)} Workforce position(s) to database.`);
      setWorkforceDraft((prev) =>
        workforceDraftFromRecords(
          updated.positions,
          updated.fiscalYear,
          updated.accounts.find((account) => account.type === 'expense')?.code ??
            updated.accounts[0]?.code ??
            '',
          updated.periods[0] ?? 'P01',
          prev,
        ),
      );
    } catch (error: unknown) {
      setWorkforceActionFailure(toWorkforceFailure(error, 'save'));
    } finally {
      setWorkforceBusy(null);
    }
  };

  const runPreviewWorkforcePlan = async (): Promise<void> => {
    if (companyId === null || authToken === null) return;
    const built = buildWorkforcePositionsPayload(workforceDraft, workforcePeriods, {
      requireScenarioName: false,
    });
    if (!built.ok) {
      setWorkforceActionFailure({
        code: 'VALIDATION_FAILED',
        message: 'Workforce preview validation failed; check highlighted issues below.',
        issues: built.issues,
        action: 'preview',
      });
      return;
    }
    setWorkforceBusy('preview');
    setWorkforceActionFailure(null);
    setWorkforceNotice(null);
    setWorkforceCommitResult(null);
    try {
      const result = await createApiClient({ getToken: () => authToken }).previewWorkforcePlan(
        companyId,
        {
          fiscalYear: props.fiscalYear,
          periods: [...workforcePeriods],
          positions: [...built.positions],
        },
      );
      setWorkforcePreviewResult(result);
    } catch (error: unknown) {
      setWorkforceActionFailure(toWorkforceFailure(error, 'preview'));
    } finally {
      setWorkforceBusy(null);
    }
  };

  const runCommitWorkforcePlan = async (): Promise<void> => {
    if (companyId === null || authToken === null) return;
    const built = buildWorkforcePositionsPayload(workforceDraft, workforcePeriods, {
      requireScenarioName: true,
    });
    if (!built.ok) {
      setWorkforceActionFailure({
        code: 'VALIDATION_FAILED',
        message: 'Workforce commit validation failed; nothing was written.',
        issues: built.issues,
        action: 'commit',
      });
      return;
    }
    setWorkforceBusy('commit');
    setWorkforceActionFailure(null);
    setWorkforceNotice(null);
    try {
      const result = await createApiClient({ getToken: () => authToken }).commitWorkforcePlan(
        companyId,
        {
          fiscalYear: props.fiscalYear,
          scenarioName: built.scenarioName,
          scenarioKind: built.scenarioKind,
          periods: [...workforcePeriods],
          positions: [...built.positions],
          saveRoster: true,
        },
      );
      setWorkforcePreviewResult(result.preview);
      setWorkforceCommitResult(result);
      setWorkforceNotice(
        `Committed ${result.commit.scenarioName} v${String(result.commit.versionNo)} from Workforce module.`,
      );
      setSelection((previous) => ({ ...previous, selectedScenario: result.commit.scenarioName }));
      setScenarioReload((key) => key + 1);
      setForecastReload((key) => key + 1);
      setComparisonReload((key) => key + 1);
      setWorkflowReload((key) => key + 1);
      setWorkforceReload((key) => key + 1);
    } catch (error: unknown) {
      setWorkforceActionFailure(toWorkforceFailure(error, 'commit'));
    } finally {
      setWorkforceBusy(null);
    }
  };

  const retryWorkforceAction = (): void => {
    if (workforceActionFailure?.action === 'save') {
      void runSaveWorkforceRoster();
      return;
    }
    if (workforceActionFailure?.action === 'commit') {
      void runCommitWorkforcePlan();
      return;
    }
    void runPreviewWorkforcePlan();
  };

  const authoringPanel = (
    <DriverAuthoringPanel
      fiscalYear={props.fiscalYear}
      periods={periods}
      currency={props.currency}
      accounts={accounts}
      chartState={chartState}
      chartFailure={chartFailure}
      onRetryChart={() => setChartReload((key) => key + 1)}
      onOpenCoaMapper={() => onNavigate('/coa-mapper')}
      draft={driverDraft}
      onChangeDraft={setDriverDraft}
      previewResult={previewResult}
      commitResult={commitResult}
      actionBusy={actionBusy}
      actionFailure={actionFailure}
      onPreview={() => void runPreviewDriverPlan()}
      onCommit={() => void runCommitDriverPlan()}
      onRetryAction={retryDriverAction}
    />
  );

  const workforcePanel = (
    <WorkforcePanel
      workspace={workforceWorkspace}
      loadState={workforceState}
      loadFailure={workforceLoadFailure}
      onRetryLoad={() => setWorkforceReload((key) => key + 1)}
      onOpenCoaMapper={() => onNavigate('/coa-mapper')}
      draft={workforceDraft}
      onChangeDraft={setWorkforceDraft}
      previewResult={workforcePreviewResult}
      commitResult={workforceCommitResult}
      actionBusy={workforceBusy}
      actionFailure={workforceActionFailure}
      actionNotice={workforceNotice}
      onSaveRoster={() => void runSaveWorkforceRoster()}
      onPreview={() => void runPreviewWorkforcePlan()}
      onCommit={() => void runCommitWorkforcePlan()}
      onRetryAction={retryWorkforceAction}
    />
  );

  const workflowPanel = (
    <WorkflowPanel
      workflow={workflow}
      workflowState={workflowState}
      workflowFailure={workflowFailure}
      onRetryLoad={() => setWorkflowReload((key) => key + 1)}
      actionBusy={workflowBusy}
      actionFailure={workflowActionFailure}
      actionNotice={workflowNotice}
      accounts={accounts}
      periods={periods}
      onCreateTask={(req) => void runCreateApprovalTask(req)}
      onTransitionTask={(id, req) => void runTransitionApprovalTask(id, req)}
      onCreateComment={(req) => void runCreateWorkflowComment(req)}
      onMarkNotificationRead={(id) => void runMarkNotificationRead(id)}
      onAddMember={(req) => void runAddCompanyMember(req)}
    />
  );

  if (scenarios === null || scenarios.length === 0) {
    return (
      <div className="space-y-6">
        <InlineEmptyState
          disclosure="This company has no planning scenario yet. Import a budget, save a Workforce roster, or commit a driver plan below; until then there is no plan to forecast or compare, and nothing here is invented."
          ctaLabel="Import a Budget in Import Wizard"
          onAction={() => onNavigate('/import')}
        />
        {authoringPanel}
        {workforcePanel}
        {workflowPanel}
      </div>
    );
  }

  const forecastReady = forecast !== null && forecastState === 'idle';
  const comparisonReady =
    comparison !== null &&
    comparisonState === 'idle' &&
    baseScenario !== null &&
    targetScenario !== null &&
    baseScenario !== targetScenario;

  return (
    <div className="space-y-6">
      {authoringPanel}

      <ScenarioInventory
        scenarios={scenarios}
        selectedScenario={selectedScenario}
        onSelect={(scenarioName) =>
          setSelection((previous) => ({ ...previous, selectedScenario: scenarioName }))
        }
      />

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="planning-scenario" className="block text-xs font-medium text-slate-600">
              Forecast scenario
            </label>
            <select
              id="planning-scenario"
              value={selectedScenario ?? ''}
              onChange={(event) =>
                setSelection((previous) => ({ ...previous, selectedScenario: event.target.value }))
              }
              className="mt-1 rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              {scenarios.map((scenario) => (
                <option key={scenario.scenarioId} value={scenario.name}>
                  {scenario.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="planning-cutoff" className="block text-xs font-medium text-slate-600">
              Last closed actual period
            </label>
            <select
              id="planning-cutoff"
              value={cutoff}
              onChange={(event) => setCutoff(event.target.value)}
              className="mt-1 rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              <option value="">Automatic — last period with actual postings</option>
              {periods.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => setForecastReload((key) => key + 1)}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Recalculate forecast
          </button>
        </div>

        <p className="text-xs text-slate-600">
          The cutoff decides which periods are read as closed actuals and which are forecast. Automatic
          uses the server&apos;s last period that actually has an active-batch posting; the table below
          names the resolved cutoff and both period sets, so the basis is never implied.
        </p>

        {forecastState === 'loading' && (
          <LoadingState label="Loading the rolling forecast for the selected scenario and cutoff..." />
        )}
        {forecastState === 'error' && forecastFailure !== null && (
          <InlineErrorState
            code={forecastFailure.code}
            message={forecastFailure.message}
            onRetry={() => setForecastReload((key) => key + 1)}
          />
        )}
        {forecastReady && <RollingForecastTable report={forecast} currency={props.currency} />}
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="planning-base" className="block text-xs font-medium text-slate-600">
              Base scenario
            </label>
            <select
              id="planning-base"
              value={baseScenario ?? ''}
              onChange={(event) =>
                setSelection((previous) => ({ ...previous, baseScenario: event.target.value }))
              }
              className="mt-1 rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              {scenarios.map((scenario) => (
                <option key={scenario.scenarioId} value={scenario.name}>
                  {scenario.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="planning-target" className="block text-xs font-medium text-slate-600">
              Target scenario
            </label>
            <select
              id="planning-target"
              value={targetScenario ?? ''}
              onChange={(event) =>
                setSelection((previous) => ({ ...previous, targetScenario: event.target.value }))
              }
              className="mt-1 rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              {scenarios.map((scenario) => (
                <option key={scenario.scenarioId} value={scenario.name}>
                  {scenario.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => setComparisonReload((key) => key + 1)}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Compare scenarios
          </button>
        </div>

        {scenarios.length < 2 && (
          <PartialBanner detail="Scenario comparison needs two scenarios and this company has one. No comparison is shown and no second scenario was invented." />
        )}
        {scenarios.length >= 2 && baseScenario !== null && baseScenario === targetScenario && (
          <PartialBanner detail="Base and target are the same scenario. Pick two different scenarios to see a real comparison." />
        )}
        {comparisonState === 'loading' && (
          <LoadingState label="Loading the scenario comparison from the server..." />
        )}
        {comparisonState === 'error' && comparisonFailure !== null && (
          <InlineErrorState
            code={comparisonFailure.code}
            message={comparisonFailure.message}
            onRetry={() => setComparisonReload((key) => key + 1)}
          />
        )}
        {comparisonReady && <ScenarioComparisonTable report={comparison} currency={props.currency} />}
      </section>

      {workforcePanel}

      {workflowPanel}
    </div>
  );
}

export interface ModelGridPageProps extends SpinePageProps {
  /** Test/deep-link entry point for one of the screen's views (`?tab=` mirrors it in the browser). */
  readonly initialView?: GridView;
}

/**
 * Model Grid (MASTER_PROMPT §9.3.5; Spine Gates G2/G6).
 *
 * One of the seven spine screens, with two views inside it: the actuals trial balance with
 * drill-to-source, and the M2 planning workspace (scenario inventory, rolling forecast, scenario
 * comparison). Keeping planning inside this screen preserves the §9.1 seven-screen inventory.
 */
export default function ModelGridPage({
  onNavigate,
  forcedState,
  initialView,
}: ModelGridPageProps): ReactElement {
  const { company, authToken } = useWorkspaceStore();

  const [view, setView] = useState<GridView>(() => {
    if (initialView !== undefined) return initialView;
    if (typeof window === 'undefined') return 'actuals';
    return new URLSearchParams(window.location.search).get('tab') === 'planning' ? 'planning' : 'actuals';
  });

  const selectView = (next: GridView): void => {
    setView(next);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', next);
      window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    }
  };

  const companyId = company?.id ?? null;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Model Grid</h1>
          <p className="mt-1 text-sm text-slate-600">
            Actuals and planning in one workspace. Every figure is a server-issued decimal string; no
            amount on this screen is computed in the browser.
          </p>
        </div>
        <div role="tablist" aria-label="Model Grid Views" className="flex flex-wrap gap-2">
          {(
            [
              { id: 'actuals', label: 'Actuals' },
              { id: 'planning', label: 'Planning' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={view === tab.id}
              onClick={() => selectView(tab.id)}
              className={`rounded px-3 py-1.5 text-sm font-medium ${
                view === tab.id
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel" aria-label={view === 'actuals' ? 'Actuals view' : 'Planning view'}>
        {view === 'actuals' ? (
          <ActualsGrid
            companyId={companyId}
            authToken={authToken}
            currency={company?.currency ?? 'USD'}
            periodCount={company?.periodCount ?? 12}
            onNavigate={onNavigate}
            {...(forcedState !== undefined ? { forcedState } : {})}
          />
        ) : (
          <PlanningView
            companyId={companyId}
            authToken={authToken}
            fiscalYear={company?.fiscalYear ?? new Date().getFullYear()}
            periodCount={company?.periodCount ?? 12}
            currency={company?.currency ?? 'USD'}
            onNavigate={onNavigate}
            {...(forcedState !== undefined ? { forcedState } : {})}
          />
        )}
      </div>
    </section>
  );
}
