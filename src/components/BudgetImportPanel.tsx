import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { SpineRoutePath } from '../../shared/spine.js';
import {
  ApiClientError,
  createApiClient,
  type BudgetImportPayload,
  type BudgetReportPayload,
} from '../api/client.js';

/**
 * Budget (plan) import + current-version panel (MASTER_PROMPT §5.7, §9.3.3; Spine Gate G4).
 *
 * Every figure comes from `GET /api/companies/:id/budget` or from the import response; the browser
 * never parses money and never shows a planned number as if it were an actual. A missing budget is
 * an honest empty state — not an all-zero plan.
 */

type PanelState = 'loading' | 'populated' | 'empty' | 'error';

interface PanelFailure {
  readonly code: string;
  readonly message: string;
  readonly action: 'load' | 'import';
}

function toFailure(error: unknown, action: 'load' | 'import'): PanelFailure {
  if (error instanceof ApiClientError) {
    const issues = error.details['issues'];
    const detail =
      Array.isArray(issues) && issues.length > 0
        ? `${error.message} ${issues.map((issue) => String(issue)).join(' · ')}`
        : error.message;
    return { code: error.code, message: detail, action };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : 'The budget action could not be completed.',
    action,
  };
}

export function BudgetImportPanel(props: {
  readonly companyId: string;
  readonly fiscalYear: number;
  readonly authToken: string;
  readonly onNavigate: (path: SpineRoutePath) => void;
}): ReactElement {
  const [state, setState] = useState<PanelState>('loading');
  const [report, setReport] = useState<BudgetReportPayload | null>(null);
  const [failure, setFailure] = useState<PanelFailure | null>(null);
  const [csvDraft, setCsvDraft] = useState('');
  const [sourceFilename, setSourceFilename] = useState('fy-budget.csv');
  const [busy, setBusy] = useState(false);
  const [lastImport, setLastImport] = useState<BudgetImportPayload | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setState('loading');
    setFailure(null);
    try {
      const loaded = await createApiClient({
        getToken: () => props.authToken,
      }).getBudget(props.companyId, { fiscalYear: props.fiscalYear });
      setReport(loaded);
      setState(loaded.lineCount === 0 ? 'empty' : 'populated');
    } catch (error) {
      setFailure(toFailure(error, 'load'));
      setState('error');
    }
  }, [props.authToken, props.companyId, props.fiscalYear]);

  useEffect(() => {
    void load();
  }, [load]);

  const runImport = useCallback(async (): Promise<void> => {
    if (csvDraft.trim().length === 0) {
      setFailure({
        code: 'IMPORT_FILE_UNREADABLE',
        message: 'Paste a non-empty budget CSV before importing a plan version.',
        action: 'import',
      });
      setState('error');
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const imported = await createApiClient({
        getToken: () => props.authToken,
      }).importBudget(props.companyId, {
        csvText: csvDraft,
        fiscalYear: props.fiscalYear,
        sourceFilename: sourceFilename.trim().length === 0 ? 'fy-budget.csv' : sourceFilename.trim(),
      });
      setLastImport(imported);
      setReport(imported);
      setState(imported.lineCount === 0 ? 'empty' : 'populated');
    } catch (error) {
      setFailure(toFailure(error, 'import'));
      setState('error');
    } finally {
      setBusy(false);
    }
  }, [csvDraft, props.authToken, props.companyId, props.fiscalYear, sourceFilename]);

  const retry = (): void => {
    if (failure?.action === 'import') void runImport();
    else void load();
  };

  return (
    <section
      aria-labelledby="budget-panel-heading"
      className="space-y-4 rounded border border-slate-200 bg-slate-50 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="budget-panel-heading" className="text-base font-semibold text-slate-900">
            Budget (plan) · FY{props.fiscalYear}
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            Plan rows are stored as a scenario version and never posted to the general ledger. Paste
            <span className="font-mono"> account_code,period,amount</span> with period codes like
            <span className="font-mono"> P01</span>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => props.onNavigate('/statements')}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          View Statements
        </button>
      </div>

      {state === 'loading' && (
        <div role="status" aria-live="polite" className="text-sm font-medium text-slate-700">
          Loading the server’s current budget version…
        </div>
      )}

      {state === 'error' && failure !== null && (
        <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <p>
            <span className="font-mono font-semibold">[{failure.code}]</span> {failure.message}
          </p>
          <button
            type="button"
            onClick={retry}
            className="mt-2 rounded bg-red-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800"
          >
            {failure.action === 'import' ? 'Retry budget import' : 'Retry budget load'}
          </button>
        </div>
      )}

      {state === 'empty' && (
        <div role="status" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          No budget has been imported for FY{props.fiscalYear} yet. Until a plan version exists there
          is nothing to compare actuals against, so no variance is shown.
        </div>
      )}

      {state === 'populated' && report !== null && report.lineCount > 0 && (
        <div className="space-y-2">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-slate-500">Scenario</dt>
              <dd className="font-mono text-xs font-semibold text-slate-900">
                {report.scenarioName ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Version</dt>
              <dd className="font-mono font-semibold text-slate-900">v{report.versionNo ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Plan lines</dt>
              <dd className="font-mono font-semibold text-slate-900">{report.lineCount}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Planned total</dt>
              <dd className="font-mono font-semibold text-slate-900">{report.totalAmount}</dd>
            </div>
          </dl>
          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <caption className="sr-only">
                Planned amount per account for FY{props.fiscalYear}, summed across periods
              </caption>
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th scope="col" className="px-3 py-2">Account</th>
                  <th scope="col" className="px-3 py-2">Type</th>
                  <th scope="col" className="px-3 py-2 text-right">Planned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.accounts.map((account) => (
                  <tr key={account.accountCode}>
                    <td className="px-3 py-1.5">
                      <span className="font-mono">{account.accountCode}</span>{' '}
                      <span className="text-slate-600">{account.accountName}</span>
                    </td>
                    <td className="px-3 py-1.5 text-slate-600">{account.accountType}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{account.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="space-y-2 border-t border-slate-200 pt-3">
        <label htmlFor="budget-file" className="block text-sm font-medium text-slate-700">
          Budget CSV file
        </label>
        <input
          id="budget-file"
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setSourceFilename(file.name);
            void file.text().then((text) => setCsvDraft(text));
          }}
          className="block w-full text-sm text-slate-700 file:mr-4 file:rounded file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
        />
        <label htmlFor="budget-source" className="block text-sm font-medium text-slate-700">
          Source filename (recorded on the audit trail)
        </label>
        <input
          id="budget-source"
          type="text"
          value={sourceFilename}
          onChange={(event) => setSourceFilename(event.target.value)}
          className="w-full rounded border border-slate-300 px-3 py-1.5 font-mono text-xs"
        />
        <label htmlFor="budget-csv" className="block text-sm font-medium text-slate-700">
          Budget CSV payload
        </label>
        <textarea
          id="budget-csv"
          rows={4}
          value={csvDraft}
          onChange={(event) => setCsvDraft(event.target.value)}
          placeholder="account_code,period,amount"
          className="w-full rounded border border-slate-300 p-3 font-mono text-xs"
        />
        <button
          type="button"
          onClick={() => void runImport()}
          disabled={busy}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {busy ? 'Importing the budget version…' : 'Import budget version'}
        </button>
        <p className="text-xs text-slate-500">
          Each import creates a new plan version for FY{props.fiscalYear} and keeps the previous one
          as history. A file with any rejected row writes nothing.
        </p>
      </div>

      {lastImport !== null && (
        <div className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950">
          <p className="font-semibold">
            Imported plan version v{lastImport.versionNo ?? '—'} · {lastImport.lineCount} line(s) ·{' '}
            {lastImport.totalAmount}
          </p>
          <p className="mt-1 text-xs">
            {lastImport.rowCount} row(s) read, {lastImport.lineCount} planned across{' '}
            {lastImport.accounts.length} account(s). No amount was posted to the general ledger.
          </p>
        </div>
      )}
    </section>
  );
}
