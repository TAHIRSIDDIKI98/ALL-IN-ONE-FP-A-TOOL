import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { SpineRoutePath } from '../../shared/spine.js';
import type {
  RollingForecastResponse,
  ScenarioComparisonResponse,
  ScenarioSummary,
} from '../../shared/planning.js';
import {
  ApiClientError,
  createApiClient,
  type AccountDrilldownPayload,
  type TrialBalancePayload,
  type TrialBalanceRowPayload,
} from '../api/client.js';
import {
  InlineEmptyState,
  InlineErrorState,
  LoadingState,
  PartialBanner,
} from '../components/StateFrame.js';
import {
  RollingForecastTable,
  ScenarioComparisonTable,
  ScenarioInventory,
} from '../components/PlanningWorkspace.js';
import { periodCodes, resolvePlanningDefaults, type PlanningDefaults } from '../state/planningView.js';
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

/**
 * Planning view of the Model Grid (MASTER_PROMPT §2.5 M2, §9.3.5 sheet tabs, §11.4).
 *
 * Three server reads, each with its own state and its own retry: the scenario inventory (with the
 * current plan version of each scenario), the rolling forecast for the scenario and cutoff the user
 * selects, and the comparison of two selected scenarios. Every list is built in the server's order
 * and every amount stays the server's string.
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

  if (scenarios === null || scenarios.length === 0) {
    return (
      <InlineEmptyState
        disclosure="This company has no planning scenario yet. Import a budget or commit a driver plan; until then there is no plan to forecast or compare, and nothing here is invented."
        ctaLabel="Import a Budget in Import Wizard"
        onAction={() => onNavigate('/import')}
      />
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
