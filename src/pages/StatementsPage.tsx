import { useEffect, useState, type ReactElement } from 'react';
import type { SpineRoutePath } from '../../shared/spine.js';
import {
  ApiClientError,
  createApiClient,
  type BvaReportPayload,
  type FinancialStatementsPayload,
} from '../api/client.js';
import type { FluxAnalysisResponse, PvmBridgeResponse } from '../../shared/variance.js';
import type { DashboardReportTemplateId, DashboardSummaryResponse } from '../../shared/dashboards.js';
import { DashboardsPanel } from '../components/DashboardsPanel.js';
import { ConsolidationPanel } from '../components/ConsolidationPanel.js';
import { FluxPvmPanel } from '../components/FluxPvmPanel.js';
import { EmptyState, ErrorState, LoadingState, PartialBanner } from '../components/StateFrame.js';
import {
  buildPvmBridgeItemsPayload,
  createEmptyPvmItemDraft,
  type PvmItemDraft,
} from '../state/planningView.js';
import { useWorkspaceStore } from '../state/workspaceStore.js';
import type { SpinePageProps } from './SignInPage.js';

type StatementTab = 'pl' | 'bs' | 'cf' | 'bva' | 'flux' | 'dashboards' | 'consolidation';

interface StatementLine {
  readonly label: string;
  readonly value: string;
  readonly emphasis?: boolean;
}

function pnlLines(payload: FinancialStatementsPayload): readonly StatementLine[] {
  return [
    { label: 'Revenue', value: payload.pnl.revenue },
    { label: 'Cost of goods sold', value: payload.pnl.cogs },
    { label: 'Gross profit', value: payload.pnl.grossProfit, emphasis: true },
    { label: 'Operating expenses', value: payload.pnl.opex },
    { label: 'EBITDA', value: payload.pnl.ebitda, emphasis: true },
    { label: 'Depreciation & amortization', value: payload.pnl.depreciation },
    { label: 'EBIT', value: payload.pnl.ebit, emphasis: true },
    { label: 'Non-operating, net', value: payload.pnl.nonOperatingNet },
    { label: 'Pre-tax income', value: payload.pnl.ebt },
    { label: 'Income tax', value: payload.pnl.tax },
    { label: 'Net income', value: payload.pnl.netIncome, emphasis: true },
  ];
}

function balanceSheetLines(payload: FinancialStatementsPayload): readonly StatementLine[] {
  return [
    { label: 'Total assets', value: payload.balanceSheet.totalAssets, emphasis: true },
    { label: 'Total liabilities', value: payload.balanceSheet.totalLiabilities },
    { label: 'Total equity', value: payload.balanceSheet.totalEquity },
    { label: 'Cash balance', value: payload.balanceSheet.cashBalance },
  ];
}

function cashFlowLines(payload: FinancialStatementsPayload): readonly StatementLine[] {
  return [
    { label: 'Net income', value: payload.cashFlow.netIncome },
    { label: 'Non-cash addbacks', value: payload.cashFlow.nonCashAddbacks },
    { label: 'Working-capital impact', value: payload.cashFlow.deltaWorkingCapitalCashImpact },
    { label: 'Operating cash flow', value: payload.cashFlow.operatingCashFlow, emphasis: true },
    { label: 'Investing cash flow', value: payload.cashFlow.investingCashFlow },
    { label: 'Free cash flow', value: payload.cashFlow.freeCashFlow },
    { label: 'Financing cash flow', value: payload.cashFlow.financingCashFlow },
    { label: 'Beginning cash', value: payload.cashFlow.beginningCash },
    { label: 'Ending cash', value: payload.cashFlow.endingCash, emphasis: true },
  ];
}

export default function StatementsPage({ onNavigate, forcedState }: SpinePageProps): ReactElement {
  const { company, authToken } = useWorkspaceStore();
  const initialTab = (() => {
    if (typeof window === 'undefined') return 'pl' as StatementTab;
    const param = new URLSearchParams(window.location.search).get('tab');
    if (
      param === 'bs' ||
      param === 'cf' ||
      param === 'bva' ||
      param === 'flux' ||
      param === 'dashboards' ||
      param === 'consolidation'
    ) {
      return param;
    }
    return 'pl' as StatementTab;
  })();

  const [activeTab, setActiveTab] = useState<StatementTab>(initialTab);
  const [period, setPeriod] = useState('P12');
  const [payload, setPayload] = useState<FinancialStatementsPayload | null>(null);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [loadError, setLoadError] = useState<{ code: string; message: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [bva, setBva] = useState<BvaReportPayload | null>(null);
  const [bvaState, setBvaState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [bvaError, setBvaError] = useState<{ code: string; message: string } | null>(null);

  const [flux, setFlux] = useState<FluxAnalysisResponse | null>(null);
  const [fluxState, setFluxState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [fluxError, setFluxError] = useState<{ code: string; message: string } | null>(null);
  const [minAbsInput, setMinAbsInput] = useState('0.00');
  const [appliedMinAbs, setAppliedMinAbs] = useState('0.00');
  const [topNInput, setTopNInput] = useState(10);
  const [appliedTopN, setAppliedTopN] = useState(10);
  const [filterError, setFilterError] = useState<string | null>(null);

  const [pvmItems, setPvmItems] = useState<readonly PvmItemDraft[]>(() => [
    createEmptyPvmItemDraft('pvm-1'),
    createEmptyPvmItemDraft('pvm-2'),
  ]);
  const [pvmResult, setPvmResult] = useState<PvmBridgeResponse | null>(null);
  const [pvmState, setPvmState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [pvmIssues, setPvmIssues] = useState<readonly string[]>([]);
  const [pvmError, setPvmError] = useState<{ code: string; message: string } | null>(null);

  const [dashboard, setDashboard] = useState<DashboardSummaryResponse | null>(null);
  const [dashboardState, setDashboardState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [dashboardError, setDashboardError] = useState<{ code: string; message: string } | null>(null);
  const [dashboardTemplate, setDashboardTemplate] = useState<DashboardReportTemplateId>('executive_summary');

  const companyId = company?.id ?? null;

  useEffect(() => {
    if (companyId === null || authToken === null) return;
    let cancelled = false;
    setLoadState('loading');
    setLoadError(null);
    const client = createApiClient({ getToken: () => authToken });
    client
      .getStatements(companyId, { period })
      .then((result) => {
        if (cancelled) return;
        setPayload(result);
        setLoadState('idle');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPayload(null);
        setLoadState('error');
        setLoadError(
          error instanceof ApiClientError
            ? { code: error.code, message: error.message }
            : {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : 'Unable to load statements.',
              },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, authToken, period, reloadKey]);

  useEffect(() => {
    if (activeTab !== 'bva' || companyId === null || authToken === null) return;
    let cancelled = false;
    setBvaState('loading');
    setBvaError(null);
    createApiClient({ getToken: () => authToken })
      .getBva(companyId, { period })
      .then((result) => {
        if (cancelled) return;
        setBva(result);
        setBvaState('idle');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setBva(null);
        setBvaState('error');
        setBvaError(
          error instanceof ApiClientError
            ? { code: error.code, message: error.message }
            : {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : 'Unable to load Budget vs Actual.',
              },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, companyId, authToken, period, reloadKey]);

  useEffect(() => {
    if (activeTab !== 'flux' || companyId === null || authToken === null) return;
    let cancelled = false;
    setFluxState('loading');
    setFluxError(null);
    createApiClient({ getToken: () => authToken })
      .getFluxAnalysis(companyId, {
        period,
        minAbs: appliedMinAbs,
        topN: appliedTopN,
      })
      .then((result) => {
        if (cancelled) return;
        setFlux(result);
        setFluxState('idle');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFlux(null);
        setFluxState('error');
        setFluxError(
          error instanceof ApiClientError
            ? { code: error.code, message: error.message }
            : {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : 'Unable to load Flux Analysis.',
              },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, companyId, authToken, period, appliedMinAbs, appliedTopN, reloadKey]);

  useEffect(() => {
    if (activeTab !== 'dashboards' || companyId === null || authToken === null) return;
    let cancelled = false;
    setDashboardState('loading');
    setDashboardError(null);
    createApiClient({ getToken: () => authToken })
      .getDashboardSummary(companyId, {
        period,
        template: dashboardTemplate,
      })
      .then((result) => {
        if (cancelled) return;
        setDashboard(result);
        setDashboardState('idle');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDashboard(null);
        setDashboardState('error');
        setDashboardError(
          error instanceof ApiClientError
            ? { code: error.code, message: error.message }
            : {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : 'Unable to load Dashboards v1.',
              },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, companyId, authToken, period, dashboardTemplate, reloadKey]);

  const handleApplyFluxFilter = (): void => {
    const trimmed = minAbsInput.trim();
    const candidate = trimmed.length === 0 ? '0.00' : trimmed;
    if (!/^\d+(?:\.\d{1,6})?$/.test(candidate)) {
      setFilterError('Minimum variance magnitude must be a non-negative decimal string (e.g. 100.00).');
      return;
    }
    setFilterError(null);
    setMinAbsInput(candidate);
    setAppliedMinAbs(candidate);
    setAppliedTopN(topNInput);
  };

  const handleComputePvm = async (): Promise<void> => {
    if (companyId === null || authToken === null) return;
    const built = buildPvmBridgeItemsPayload(pvmItems);
    if (!built.ok) {
      setPvmIssues(built.issues);
      setPvmError(null);
      return;
    }
    setPvmIssues([]);
    setPvmError(null);
    setPvmState('loading');
    try {
      const result = await createApiClient({ getToken: () => authToken }).computePvmBridge(companyId, {
        periodCode: period,
        items: [...built.items],
      });
      setPvmResult(result);
      setPvmState('idle');
    } catch (error: unknown) {
      setPvmResult(null);
      setPvmState('error');
      setPvmError(
        error instanceof ApiClientError
          ? { code: error.code, message: error.message }
          : {
              code: 'INTERNAL_ERROR',
              message: error instanceof Error ? error.message : 'Unable to compute PVM bridge.',
            },
      );
    }
  };

  const handleResetPvm = (): void => {
    setPvmItems([createEmptyPvmItemDraft('pvm-1'), createEmptyPvmItemDraft('pvm-2')]);
    setPvmResult(null);
    setPvmIssues([]);
    setPvmError(null);
    setPvmState('idle');
  };

  const selectTab = (tab: StatementTab): void => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    }
  };

  const navigate = (path: SpineRoutePath): void => onNavigate(path);

  if (forcedState === 'loading' || (activeTab !== 'consolidation' && loadState === 'loading')) {
    return <LoadingState label="Loading articulating statements from the server..." />;
  }

  if (forcedState === 'error' || (activeTab !== 'consolidation' && loadState === 'error')) {
    return (
      <ErrorState
        title="Financial Statements"
        code={loadError?.code ?? 'STATEMENT_TIE_OUT_FAILED'}
        message={loadError?.message ?? 'Unable to reconcile financial statements against the ledger.'}
        onRetry={() => setReloadKey((key) => key + 1)}
      />
    );
  }

  if (companyId === null || authToken === null) {
    return (
      <EmptyState
        title="Financial Statements"
        disclosure="Sign in and create a company workspace before reading statements; every figure is computed by the server from committed ledger postings."
        ctaLabel="Go to Sign In"
        ctaPath="/sign-in"
        onNavigate={navigate}
      />
    );
  }

  if (activeTab !== 'consolidation' && payload === null) {
    return (
      <EmptyState
        title="Financial Statements"
        disclosure="Committed GL ledger postings are required to compute articulating Income Statement, Balance Sheet, and Cash Flow views."
        ctaLabel="Import Ledger Data"
        ctaPath="/import"
        onNavigate={navigate}
      />
    );
  }

  const lines =
    payload === null
      ? []
      : activeTab === 'pl'
        ? pnlLines(payload)
        : activeTab === 'bs'
          ? balanceSheetLines(payload)
          : activeTab === 'cf'
            ? cashFlowLines(payload)
            : [];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-slate-900">Financial Statements</h1>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="statement-period" className="block text-xs font-medium text-slate-600">
              Year-to-date through
            </label>
            <select
              id="statement-period"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="mt-1 rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              {Array.from({ length: Math.max(company?.periodCount ?? 12, 1) }, (_, index) => {
                const code = `P${String(index + 1).padStart(2, '0')}`;
                return (
                  <option key={code} value={code}>
                    {code}
                  </option>
                );
              })}
            </select>
          </div>
          <div role="tablist" aria-label="Statement Views" className="flex flex-wrap gap-2">
            {(
              [
                { id: 'pl', label: 'P&L' },
                { id: 'bs', label: 'Balance Sheet' },
                { id: 'cf', label: 'Cash Flow' },
                { id: 'bva', label: 'BvA View' },
                { id: 'flux', label: 'Flux & PVM' },
                { id: 'dashboards', label: 'Dashboards & KPIs' },
                { id: 'consolidation', label: 'Consolidation' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                onClick={() => selectTab(t.id)}
                className={`rounded px-3 py-1.5 text-sm font-medium ${
                  activeTab === t.id
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {payload !== null && (
        <p className="text-sm text-slate-600">
          {payload.range.fromPeriodCode}–{payload.range.throughPeriodCode} of FY{payload.range.fiscalYear} ·{' '}
          {payload.sources.length} committed source file(s) · every figure is a canonical decimal string from the
          server.
        </p>
      )}

      {payload !== null && !payload.articulation.valid && (
        <PartialBanner detail="Statement articulation (A1–A5) did not tie; treat these figures as provisional." />
      )}

      {activeTab === 'consolidation' ? (
        <ConsolidationPanel
          companyId={companyId}
          authToken={authToken}
          periodCode={period}
          fiscalYear={payload?.range.fiscalYear ?? 2026}
        />
      ) : activeTab === 'dashboards' ? (
        <DashboardsPanel
          dashboard={dashboard}
          loadState={dashboardState}
          loadError={dashboardError}
          templateId={dashboardTemplate}
          onChangeTemplate={setDashboardTemplate}
          onRetry={() => setReloadKey((key) => key + 1)}
          onOpenImport={() => navigate('/import')}
        />
      ) : activeTab === 'flux' ? (
        <FluxPvmPanel
          period={period}
          flux={flux}
          fluxState={fluxState}
          fluxError={fluxError}
          minAbsInput={minAbsInput}
          topNInput={topNInput}
          filterError={filterError}
          onChangeMinAbs={setMinAbsInput}
          onChangeTopN={setTopNInput}
          onApplyFilter={handleApplyFluxFilter}
          onRetryFlux={() => setReloadKey((key) => key + 1)}
          onOpenImport={() => navigate('/import')}
          pvmItems={pvmItems}
          onChangePvmItems={setPvmItems}
          pvmResult={pvmResult}
          pvmState={pvmState}
          pvmIssues={pvmIssues}
          pvmError={pvmError}
          onComputePvm={() => {
            void handleComputePvm();
          }}
          onResetPvm={handleResetPvm}
        />
      ) : activeTab === 'bva' ? (
        bvaState === 'loading' ? (
          <div role="status" aria-live="polite" className="text-sm font-medium text-slate-700">
            Loading the current plan version and joining it to the ledger…
          </div>
        ) : bvaState === 'error' ? (
          <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            <p>
              <span className="font-mono font-semibold">[{bvaError?.code ?? 'INTERNAL_ERROR'}]</span>{' '}
              {bvaError?.message ?? 'Unable to load Budget vs Actual.'}
            </p>
            <button
              type="button"
              onClick={() => setReloadKey((key) => key + 1)}
              className="mt-2 rounded bg-red-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800"
            >
              Retry Budget vs Actual
            </button>
          </div>
        ) : bva === null || !bva.hasPlan ? (
          <EmptyState
            title="Budget vs Actual"
            disclosure="No budget plan version has been imported for this company yet, so there is nothing honest to compare against actuals."
            ctaLabel="Open Import Wizard"
            ctaPath="/import"
            onNavigate={navigate}
          />
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-600">
              <span className="font-mono">{bva.scenarioName ?? 'Budget'}</span> v{bva.versionNo ?? '—'} ·
              year-to-date through {bva.throughPeriodCode} of FY{bva.fiscalYear} · variance = actual − plan,
              favorable/unfavorable derived from the account type.
            </p>
            {bva.totals.unplannedRows > 0 && (
              <PartialBanner
                detail={`${bva.totals.unplannedRows} account(s) with ${bva.totals.unplannedActual} of actual activity have no plan line, so no variance is shown for them.`}
              />
            )}
            <div className="overflow-x-auto rounded border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <caption className="sr-only">
                  Budget versus actual by account, through {bva.throughPeriodCode}
                </caption>
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th scope="col" className="px-4 py-2">Account</th>
                    <th scope="col" className="px-4 py-2 text-right">Actual</th>
                    <th scope="col" className="px-4 py-2 text-right">Plan</th>
                    <th scope="col" className="px-4 py-2 text-right">Variance</th>
                    <th scope="col" className="px-4 py-2 text-right">Var %</th>
                    <th scope="col" className="px-4 py-2">Favorability</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {bva.rows.map((row) => (
                    <tr key={row.accountCode}>
                      <th scope="row" className="px-4 py-2 text-left font-normal">
                        <span className="font-mono">{row.accountCode}</span>{' '}
                        <span className="text-slate-600">{row.accountName}</span>
                      </th>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">
                        {row.actual ?? '—'}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">
                        {row.plan ?? <span className="text-slate-500">not planned</span>}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">
                        {row.varianceAmount ?? '—'}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">
                        {row.variancePctFormatted ?? '—'}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${
                            row.favorability === 'favorable'
                              ? 'bg-emerald-100 text-emerald-900'
                              : row.favorability === 'unfavorable'
                                ? 'bg-red-100 text-red-900'
                                : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {row.favorability}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 text-sm font-semibold text-slate-900">
                  <tr>
                    <th scope="row" className="px-4 py-2 text-left">
                      Totals ({bva.totals.plannedRows} planned / {bva.totals.unplannedRows} unplanned)
                    </th>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{bva.totals.actual}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{bva.totals.plan}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {bva.totals.varianceAmount}
                    </td>
                    <td className="px-4 py-2" />
                    <td className="px-4 py-2 font-normal text-xs text-slate-600">
                      {bva.totals.favorable} favorable · {bva.totals.unfavorable} unfavorable ·{' '}
                      {bva.totals.neutral} neutral · {bva.totals.na} not planned
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <dl className="grid grid-cols-2 gap-3 rounded border border-slate-200 bg-slate-50 p-3 text-xs sm:grid-cols-5">
              {bva.byType.map((total) => (
                <div key={total.accountType}>
                  <dt className="uppercase tracking-wide text-slate-500">{total.accountType}</dt>
                  <dd className="font-mono text-slate-900">
                    actual {total.actual} · plan {total.plan}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <caption className="sr-only">
              {activeTab === 'pl' ? 'Income statement' : activeTab === 'bs' ? 'Balance sheet' : 'Cash flow statement'}
            </caption>
            <tbody className="divide-y divide-slate-100 bg-white">
              {lines.map((line) => (
                <tr key={line.label}>
                  <th scope="row" className="px-4 py-2 text-left font-medium text-slate-700">
                    {line.label}
                  </th>
                  <td
                    className={`px-4 py-2 text-right font-mono tabular-nums ${
                      line.emphasis === true ? 'font-semibold text-slate-900' : 'text-slate-800'
                    }`}
                  >
                    {line.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {payload !== null && activeTab !== 'consolidation' && (
        <div className="rounded border border-slate-200 bg-slate-50 p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Articulation checks (A1–A5)
          </h2>
          <ul className="mt-2 space-y-1 text-xs">
            {payload.articulation.checks.map((check) => (
              <li key={check.id} className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${
                    check.passed ? 'bg-emerald-100 text-emerald-900' : 'bg-red-100 text-red-900'
                  }`}
                >
                  {check.id} {check.passed ? 'pass' : 'fail'}
                </span>
                <span className="text-slate-700">{check.name}</span>
                <span className="font-mono text-slate-500">{check.detail}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-600">
            Retained earnings: opening {payload.retainedEarnings.opening} + net income{' '}
            {payload.retainedEarnings.netIncome} − distributions {payload.retainedEarnings.distributions} ={' '}
            {payload.retainedEarnings.closingTotal}{' '}
            {payload.retainedEarnings.rollForwardValid ? '(roll-forward holds)' : '(roll-forward broken)'}
          </p>
        </div>
      )}
    </section>
  );
}
