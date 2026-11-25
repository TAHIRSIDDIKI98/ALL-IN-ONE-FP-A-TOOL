import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { SpineRoutePath } from '../../shared/spine.js';
import {
  ApiClientError,
  createApiClient,
  type AccountDrilldownPayload,
  type TrialBalancePayload,
  type TrialBalanceRowPayload,
} from '../api/client.js';
import { EmptyState, ErrorState, LoadingState, PartialBanner } from '../components/StateFrame.js';
import { useWorkspaceStore } from '../state/workspaceStore.js';
import type { SpinePageProps } from './SignInPage.js';

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
 * Model Grid (MASTER_PROMPT §9.3.5; Spine Gates G2/G6).
 *
 * The grid renders the server's trial-balance read model: one row per active account, money as
 * canonical decimal strings, totals straight from `/core`. Clicking a row loads its postings from
 * `GET …/accounts/:code/drill`, and the panel refuses to present a number whose contributing rows
 * do not tie back to the grid row (`#DRILL`, §9.4).
 */
export default function ModelGridPage({ onNavigate, forcedState }: SpinePageProps): ReactElement {
  const { company, authToken } = useWorkspaceStore();
  const companyId = company?.id ?? null;

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

  const navigate = (path: SpineRoutePath): void => onNavigate(path);

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
      <ErrorState
        title="Model Grid"
        code={failure?.code ?? 'MODEL_VERSION_LOCKED'}
        message={failure?.message ?? 'The trial balance could not be loaded for this period.'}
        onRetry={retryFailedAction}
      />
    );
  }

  if (companyId === null || authToken === null) {
    return (
      <EmptyState
        title="Model Grid"
        disclosure="Sign in and create a company workspace before reading the trial balance; every cell is a server-computed decimal string."
        ctaLabel="Go to Sign In"
        ctaPath="/sign-in"
        onNavigate={navigate}
      />
    );
  }

  if (forcedState === 'empty' || report === null) {
    return (
      <EmptyState
        title="Model Grid"
        disclosure="No trial balance has been read for this company yet. Import a ledger export to post actuals, then return here."
        ctaLabel="Import Actuals in Import Wizard"
        ctaPath="/import"
        onNavigate={navigate}
      />
    );
  }

  if (report.sources.length === 0) {
    return (
      <EmptyState
        title="Model Grid"
        disclosure="This company has no committed ledger postings yet, so there is no actual grid to render. Import a ledger export first."
        ctaLabel="Import Actuals in Import Wizard"
        ctaPath="/import"
        onNavigate={navigate}
      />
    );
  }

  const currency = company?.currency ?? 'USD';
  const selectedRow: TrialBalanceRowPayload | null =
    report.rows.find((row) => row.code === selectedCode) ?? null;
  const drillTies =
    selectedRow === null ||
    drill === null ||
    (drill.totalDebit === selectedRow.totalDebit && drill.totalCredit === selectedRow.totalCredit);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Model Grid</h1>
          <p className="mt-1 text-sm text-slate-600">
            Actuals only — year-to-date through {report.throughPeriodCode ?? 'the full calendar'} ·{' '}
            {report.sources.length} committed source file(s) · amounts in {currency}.
          </p>
        </div>
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
          <button
            type="button"
            onClick={() => navigate('/statements')}
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
          detail={`The trial balance does not tie: ${report.unbalancedEntryIds.length} unbalanced journal(s) are in scope. Treat every figure below as provisional.`}
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
    </section>
  );
}
