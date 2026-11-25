import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { SpineRoutePath } from '../../shared/spine.js';
import {
  ApiClientError,
  createApiClient,
  type ChartAccountPayload,
  type ChartImportPayload,
  type ChartOfAccountsPayload,
} from '../api/client.js';
import { EmptyState, ErrorState, LoadingState, PartialBanner } from '../components/StateFrame.js';
import { useWorkspaceStore } from '../state/workspaceStore.js';
import type { SpinePageProps } from './SignInPage.js';

type ChartAction = 'load' | 'import';

interface ChartFailure {
  readonly code: string;
  readonly message: string;
  readonly action: ChartAction;
}

const CHART_TEMPLATE = [
  'code,name,type,normal_side,statement_line_key,parent_code,is_postable',
  '1000,Operating bank account,asset,debit,bs.asset.cash,,true',
  '1100,Accounts receivable,asset,debit,bs.asset.ar,,true',
  '2000,Accounts payable,liability,credit,bs.liability.ap,,true',
  '3000,Common stock,equity,credit,bs.equity.common_stock,,true',
  '4000,Service revenue,revenue,credit,pl.revenue.service,,true',
  '5000,Cost of goods sold,expense,debit,pl.cogs.direct,,true',
  '6000,Payroll expense,expense,debit,pl.opex.payroll,,true',
].join('\n');

function toFailure(error: unknown, action: ChartAction): ChartFailure {
  if (error instanceof ApiClientError) {
    const issues = error.details['issues'];
    const issueText = Array.isArray(issues)
      ? ` ${issues.filter((issue): issue is string => typeof issue === 'string').join('; ')}`
      : '';
    return { code: error.code, message: `${error.message}${issueText}`, action };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : 'The chart of accounts could not be read.',
    action,
  };
}

/**
 * Chart-of-Accounts screen (MASTER_PROMPT §9.3.4; Spine Gates G1/G10).
 *
 * This is the TARGET chart every import maps onto: a source code can only post when an account row
 * exists for it, and everything else is quarantined with a named reason by the import commit. The
 * chart CSV is validated in full by the server's pure parser and imported atomically, so a file with
 * one bad row writes nothing.
 */
export default function CoaMapperPage({ onNavigate, forcedState }: SpinePageProps): ReactElement {
  const { company, authToken } = useWorkspaceStore();
  const companyId = company?.id ?? null;

  const [chart, setChart] = useState<ChartOfAccountsPayload | null>(null);
  const [csvDraft, setCsvDraft] = useState('');
  const [imported, setImported] = useState<ChartImportPayload | null>(null);
  const [busy, setBusy] = useState<ChartAction | null>(null);
  const [failure, setFailure] = useState<ChartFailure | null>(null);

  const loadChart = useCallback(async (): Promise<void> => {
    if (companyId === null || authToken === null) return;
    setBusy('load');
    setFailure(null);
    try {
      const result = await createApiClient({ getToken: () => authToken }).getChart(companyId);
      setChart(result);
    } catch (error) {
      setChart(null);
      setFailure(toFailure(error, 'load'));
    } finally {
      setBusy(null);
    }
  }, [authToken, companyId]);

  useEffect(() => {
    if (companyId === null || authToken === null) return;
    void loadChart();
  }, [authToken, companyId, loadChart]);

  const runImport = useCallback(async (): Promise<void> => {
    if (companyId === null || authToken === null) return;
    if (csvDraft.trim().length === 0) {
      setFailure({
        code: 'IMPORT_FILE_UNREADABLE',
        message: 'Paste or choose a chart-of-accounts CSV before importing.',
        action: 'import',
      });
      return;
    }
    setBusy('import');
    setFailure(null);
    try {
      const result = await createApiClient({ getToken: () => authToken }).importChart(companyId, {
        csvText: csvDraft,
      });
      setChart({ companyId: result.companyId, accounts: result.accounts });
      setImported(result);
    } catch (error) {
      setFailure(toFailure(error, 'import'));
    } finally {
      setBusy(null);
    }
  }, [authToken, companyId, csvDraft]);

  const retryFailedAction = (): void => {
    if (failure?.action === 'import') void runImport();
    else void loadChart();
  };

  const navigate = (path: SpineRoutePath): void => onNavigate(path);

  if (forcedState === 'loading' || busy !== null) {
    return (
      <LoadingState
        label={
          busy === 'import'
            ? 'Validating and importing the chart of accounts in one transaction...'
            : 'Loading the chart of accounts...'
        }
      />
    );
  }

  if (forcedState === 'error' || failure !== null) {
    return (
      <ErrorState
        title="Chart of Accounts Mapper"
        code={failure?.code ?? 'MAP_TARGET_INVALID'}
        message={failure?.message ?? 'The chart of accounts could not be read.'}
        onRetry={retryFailedAction}
      />
    );
  }

  if (companyId === null || authToken === null) {
    return (
      <EmptyState
        title="Chart of Accounts Mapper"
        disclosure="Sign in and create a company workspace before loading a chart of accounts; only accounts in this chart can receive imported postings."
        ctaLabel="Go to Sign In"
        ctaPath="/sign-in"
        onNavigate={navigate}
      />
    );
  }

  if (forcedState === 'empty' || chart === null || chart.accounts.length === 0) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
        <h1 className="text-xl font-semibold text-slate-900">Chart of Accounts Mapper</h1>
        <p className="text-sm text-slate-600">
          This company has no chart of accounts yet, so every imported account code would be
          quarantined as unmapped. Import a chart CSV first: a source code can only post when an
          account row exists for it.
        </p>
        <div className="space-y-2">
          <label htmlFor="chart-file" className="block text-sm font-medium text-slate-700">
            Chart CSV file
          </label>
          <input
            id="chart-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void file.text().then((text) => setCsvDraft(text));
            }}
            className="block w-full text-sm text-slate-700 file:mr-4 file:rounded file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
          />
          <label htmlFor="chart-csv" className="block text-sm font-medium text-slate-700">
            Chart CSV payload
          </label>
          <textarea
            id="chart-csv"
            rows={7}
            value={csvDraft}
            onChange={(event) => setCsvDraft(event.target.value)}
            placeholder={CHART_TEMPLATE}
            className="w-full rounded border border-slate-300 p-3 font-mono text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void runImport()}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Import Chart of Accounts
            </button>
            <button
              type="button"
              onClick={() => setCsvDraft(CHART_TEMPLATE)}
              className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Fill with the documented header
            </button>
          </div>
        </div>
      </section>
    );
  }

  const accounts: readonly ChartAccountPayload[] = chart.accounts;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Chart of Accounts Mapper</h1>
          <p className="mt-1 text-sm text-slate-600">
            {accounts.length} account(s) · only these codes can receive postings. Unmapped source
            codes are quarantined with a reason by the import commit, never guessed.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => navigate('/import')}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Import Ledger Data
          </button>
          <button
            type="button"
            onClick={() => void loadChart()}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Reload Chart
          </button>
        </div>
      </div>

      {imported !== null && (
        <div className="rounded border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950">
          <p className="font-semibold">
            Chart imported: {imported.inserted} created, {imported.updated} updated out of{' '}
            {imported.rowCount} row(s).
          </p>
          <p className="mt-1 text-xs">
            Re-importing the same file updates accounts in place (never duplicates) and every write
            is chained into the company audit log.
          </p>
        </div>
      )}

      {accounts.some((account) => !account.isPostable) && (
        <PartialBanner detail="Some accounts are marked non-postable (header/roll-up rows). Postings to them would be rejected by the chart, not silently accepted." />
      )}

      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <caption className="sr-only">Chart of accounts, ordered by account code</caption>
          <thead className="bg-slate-50 text-left font-medium text-slate-700">
            <tr>
              <th scope="col" className="px-3 py-2">Code</th>
              <th scope="col" className="px-3 py-2">Name</th>
              <th scope="col" className="px-3 py-2">Type</th>
              <th scope="col" className="px-3 py-2">Normal side</th>
              <th scope="col" className="px-3 py-2">Statement line</th>
              <th scope="col" className="px-3 py-2">Parent</th>
              <th scope="col" className="px-3 py-2 text-right">Version</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {accounts.map((account) => (
              <tr key={account.code}>
                <td className="px-3 py-2 font-mono">{account.code}</td>
                <td className="px-3 py-2">
                  {account.name}
                  {account.isContra ? (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
                      contra
                    </span>
                  ) : null}
                  {!account.isPostable ? (
                    <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
                      non-postable
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-slate-600">{account.type}</td>
                <td className="px-3 py-2 text-slate-600">{account.normalSide}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600">
                  {account.statementLineKey}
                </td>
                <td className="px-3 py-2 font-mono">{account.parentCode ?? '—'}</td>
                <td className="px-3 py-2 text-right font-mono">{account.version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        <label htmlFor="chart-csv-more" className="block text-sm font-medium text-slate-700">
          Add or rename accounts (CSV import)
        </label>
        <textarea
          id="chart-csv-more"
          rows={5}
          value={csvDraft}
          onChange={(event) => setCsvDraft(event.target.value)}
          placeholder={CHART_TEMPLATE}
          className="w-full rounded border border-slate-300 p-3 font-mono text-xs"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runImport()}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Import Chart CSV
          </button>
          <button
            type="button"
            onClick={() => setCsvDraft(CHART_TEMPLATE)}
            className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Fill with the documented header
          </button>
        </div>
      </div>
    </section>
  );
}
