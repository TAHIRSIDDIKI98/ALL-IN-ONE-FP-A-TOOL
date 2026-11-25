import { useEffect, useState, type ReactElement } from 'react';
import type { SpineRoutePath } from '../../shared/spine.js';
import { ApiClientError, createApiClient, type FinancialStatementsPayload } from '../api/client.js';
import { EmptyState, ErrorState, LoadingState, PartialBanner } from '../components/StateFrame.js';
import { useWorkspaceStore } from '../state/workspaceStore.js';
import type { SpinePageProps } from './SignInPage.js';

type StatementTab = 'pl' | 'bs' | 'cf' | 'bva';

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
    if (param === 'bs' || param === 'cf' || param === 'bva') return param;
    return 'pl' as StatementTab;
  })();

  const [activeTab, setActiveTab] = useState<StatementTab>(initialTab);
  const [period, setPeriod] = useState('P12');
  const [payload, setPayload] = useState<FinancialStatementsPayload | null>(null);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [loadError, setLoadError] = useState<{ code: string; message: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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

  const selectTab = (tab: StatementTab): void => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    }
  };

  const navigate = (path: SpineRoutePath): void => onNavigate(path);

  if (forcedState === 'loading' || loadState === 'loading') {
    return <LoadingState label="Loading articulating statements from the server..." />;
  }

  if (forcedState === 'error' || loadState === 'error') {
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

  if (payload === null) {
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
    activeTab === 'pl'
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

      <p className="text-sm text-slate-600">
        {payload.range.fromPeriodCode}–{payload.range.throughPeriodCode} of FY{payload.range.fiscalYear} ·{' '}
        {payload.sources.length} committed source file(s) · every figure is a canonical decimal string from the
        server.
      </p>

      {!payload.articulation.valid && (
        <PartialBanner detail="Statement articulation (A1–A5) did not tie; treat these figures as provisional." />
      )}

      {activeTab === 'bva' ? (
        <EmptyState
          title="Budget vs Actual"
          disclosure="No budget plan version has been imported for this company yet, so there is nothing honest to compare against actuals."
          ctaLabel="Open Import Wizard"
          ctaPath="/import"
          onNavigate={navigate}
        />
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
    </section>
  );
}
