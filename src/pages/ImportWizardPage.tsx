import { useCallback, useState, type ReactElement } from 'react';
import type { SpineRoutePath } from '../../shared/spine.js';
import {
  ApiClientError,
  createApiClient,
  type ImportCommitPayload,
  type ImportPreviewPayload,
} from '../api/client.js';
import { BudgetImportPanel } from '../components/BudgetImportPanel.js';
import { ConnectorsPanel } from '../components/ConnectorsPanel.js';
import { OnboardingPipelinePanel } from '../components/OnboardingPipelinePanel.js';
import { EmptyState, ErrorState, LoadingState, PartialBanner } from '../components/StateFrame.js';
import { useWorkspaceStore, type WorkspaceCompany } from '../state/workspaceStore.js';
import type { SpinePageProps } from './SignInPage.js';

type ImportAction = 'preview' | 'commit';

interface ImportFailure {
  readonly code: string;
  readonly message: string;
  readonly action: ImportAction;
}

function toFailure(error: unknown, action: ImportAction): ImportFailure {
  if (error instanceof ApiClientError) {
    return { code: error.code, message: error.message, action };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : 'The action could not be completed.',
    action,
  };
}

export interface ImportWizardContentProps {
  readonly company: WorkspaceCompany | null;
  readonly authToken: string | null;
  readonly onNavigate: (path: SpineRoutePath) => void;
  readonly forcedState?: SpinePageProps['forcedState'];
  readonly initialDataset?: 'actuals' | 'budget' | 'connectors' | 'onboarding';
}

/**
 * GL Import Wizard (MASTER_PROMPT §9.3.3; Spine Gates G1/G2).
 *
 * Every number on this screen is produced by the server: the chart of accounts comes from the
 * company's own trial-balance read model, the preview comes from `POST /api/import/preview`, and
 * the committed row accounting comes from `POST /api/companies/:id/import/commit`. The browser
 * never parses money, never invents an account code, and never presents a staged preview as
 * committed data.
 */
export default function ImportWizardPage({ onNavigate, forcedState }: SpinePageProps): ReactElement {
  const { company, authToken } = useWorkspaceStore();
  return (
    <ImportWizardContent
      company={company}
      authToken={authToken}
      onNavigate={onNavigate}
      forcedState={forcedState}
    />
  );
}

export function ImportWizardContent({
  company,
  authToken,
  onNavigate,
  forcedState,
  initialDataset = 'actuals',
}: ImportWizardContentProps): ReactElement {
  const companyId = company?.id ?? null;

  const [dataset, setDataset] = useState<'actuals' | 'budget' | 'connectors' | 'onboarding'>(
    initialDataset,
  );
  const [csvDraft, setCsvDraft] = useState('');
  const [sourceFilename, setSourceFilename] = useState('gl-export.csv');
  const [preview, setPreview] = useState<ImportPreviewPayload | null>(null);
  const [committed, setCommitted] = useState<ImportCommitPayload | null>(null);
  const [busy, setBusy] = useState<ImportAction | null>(null);
  const [failure, setFailure] = useState<ImportFailure | null>(null);

  const client = useCallback(
    () => createApiClient({ getToken: () => authToken }),
    [authToken],
  );

  const runPreview = useCallback(async (): Promise<void> => {
    if (companyId === null || authToken === null) return;
    if (csvDraft.trim().length === 0) {
      setFailure({
        code: 'IMPORT_FILE_UNREADABLE',
        message: 'Paste or choose a non-empty CSV ledger export before staging an import.',
        action: 'preview',
      });
      return;
    }
    setBusy('preview');
    setFailure(null);
    setCommitted(null);
    try {
      const result = await client().previewImport(companyId, { csvText: csvDraft });
      setPreview(result);
    } catch (error) {
      setPreview(null);
      setFailure(toFailure(error, 'preview'));
    } finally {
      setBusy(null);
    }
  }, [authToken, client, companyId, csvDraft]);

  const runCommit = useCallback(async (): Promise<void> => {
    if (companyId === null || authToken === null || preview === null) return;
    setBusy('commit');
    setFailure(null);
    try {
      const result = await client().commitImport(companyId, {
        kind: 'actuals',
        sourceFilename: sourceFilename.trim().length === 0 ? 'gl-export.csv' : sourceFilename.trim(),
        csvText: csvDraft,
      });
      setCommitted(result);
    } catch (error) {
      setFailure(toFailure(error, 'commit'));
    } finally {
      setBusy(null);
    }
  }, [authToken, client, companyId, csvDraft, preview, sourceFilename]);

  const retryFailedAction = useCallback((): void => {
    const action = failure?.action ?? 'preview';
    setFailure(null);
    if (action === 'commit') void runCommit();
    else void runPreview();
  }, [failure, runCommit, runPreview]);

  const navigate = (path: SpineRoutePath): void => onNavigate(path);

  if (forcedState === 'loading' || busy !== null) {
    return (
      <LoadingState
        label={
          busy === 'commit'
            ? 'Committing the import batch in one atomic transaction...'
            : 'Validating the CSV rows against the server’s chart of accounts...'
        }
      />
    );
  }

  if (forcedState === 'error' || failure !== null) {
    return (
      <ErrorState
        title="GL Import Wizard"
        code={failure?.code ?? 'IMPORT_FILE_UNREADABLE'}
        message={failure?.message ?? 'The import batch could not be staged.'}
        onRetry={retryFailedAction}
      />
    );
  }

  if (companyId === null || authToken === null || company === null) {
    return (
      <EmptyState
        title="GL Import Wizard"
        disclosure="Sign in and create a company workspace before importing ledger data; every parsed row, quarantine reason and total is computed by the server."
        ctaLabel="Go to Sign In"
        ctaPath="/sign-in"
        onNavigate={navigate}
      />
    );
  }

  if (forcedState === 'empty') {
    return (
      <EmptyState
        title="GL Import Wizard"
        disclosure="No CSV/XLSX ledger export has been chosen yet. Upload an export to preview row accounting before committing."
        ctaLabel="Open CoA Mapper"
        ctaPath="/coa-mapper"
        onNavigate={navigate}
      />
    );
  }

  const accounted =
    preview !== null && preview.importedCount + preview.quarantinedCount === preview.rowsIn;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">GL Import Wizard</h1>
          <p className="mt-1 text-sm text-slate-600">
            Upload a CSV ledger export. Ambiguous numbers/dates, unmapped account codes and unbalanced
            journals are quarantined with a reason — never silently dropped.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            The preview is classified by the server against this company’s own chart of accounts and
            journal-balance rule, so it reports exactly what a commit would post.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => navigate('/coa-mapper')}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Open CoA Mapper
          </button>
          <button
            type="button"
            onClick={() => navigate('/model-grid')}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Go to Model Grid
          </button>
        </div>
      </div>

      <fieldset className="rounded border border-slate-200 bg-slate-50 px-4 py-3">
        <legend className="px-1 text-sm font-semibold text-slate-900">Import dataset</legend>
        <div className="mt-1 flex flex-wrap gap-4 text-sm text-slate-700">
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="import-dataset"
              value="actuals"
              checked={dataset === 'actuals'}
              onChange={() => setDataset('actuals')}
              className="h-4 w-4"
            />
            Actuals — GL journal CSV
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="import-dataset"
              value="budget"
              checked={dataset === 'budget'}
              onChange={() => setDataset('budget')}
              className="h-4 w-4"
            />
            Budget — account × period plan CSV
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="import-dataset"
              value="connectors"
              checked={dataset === 'connectors'}
              onChange={() => setDataset('connectors')}
              className="h-4 w-4"
            />
            Connectors — Google Sheets, QBO &amp; Xero sync
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="import-dataset"
              value="onboarding"
              checked={dataset === 'onboarding'}
              onChange={() => setDataset('onboarding')}
              className="h-4 w-4"
            />
            Onboarding — CoA match, validation &amp; cutover rehearsal
          </label>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Budgets never post to the general ledger; external connectors and onboarding cutovers
          normalize into the single GL import pipeline with exact row accounting and audit trails.
        </p>
      </fieldset>

      {dataset === 'budget' && (
        <BudgetImportPanel
          companyId={companyId}
          fiscalYear={company.fiscalYear}
          authToken={authToken}
          onNavigate={navigate}
        />
      )}

      {dataset === 'connectors' && (
        <ConnectorsPanel
          companyId={companyId}
          authToken={authToken}
          onNavigate={navigate}
        />
      )}

      {dataset === 'onboarding' && (
        <OnboardingPipelinePanel
          companyId={companyId}
          authToken={authToken}
          onNavigate={navigate}
        />
      )}

      <div className="space-y-3" hidden={dataset !== 'actuals'}>
        <label htmlFor="import-file" className="block text-sm font-medium text-slate-700">
          CSV file
        </label>
        <input
          id="import-file"
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setSourceFilename(file.name);
            void file.text().then((text) => {
              setCsvDraft(text);
              setPreview(null);
              setCommitted(null);
            });
          }}
          className="block w-full text-sm text-slate-700 file:mr-4 file:rounded file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
        />
        <label htmlFor="import-source" className="block text-sm font-medium text-slate-700">
          Source filename (recorded on the import batch)
        </label>
        <input
          id="import-source"
          type="text"
          value={sourceFilename}
          onChange={(event) => setSourceFilename(event.target.value)}
          className="w-full rounded border border-slate-300 px-3 py-1.5 font-mono text-xs"
        />
        <label htmlFor="import-csv" className="block text-sm font-medium text-slate-700">
          CSV ledger payload
        </label>
        <textarea
          id="import-csv"
          rows={6}
          value={csvDraft}
          onChange={(event) => {
            setCsvDraft(event.target.value);
            setPreview(null);
            setCommitted(null);
          }}
          placeholder="entry_ref,date,account_code,description,debit,credit"
          className="w-full rounded border border-slate-300 p-3 font-mono text-xs"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runPreview()}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Validate &amp; Preview
          </button>
          <button
            type="button"
            onClick={() => void runCommit()}
            disabled={preview === null}
            className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
          >
            Commit Import Batch
          </button>
        </div>
      </div>

      {dataset === 'actuals' && preview !== null && (
        <div
          className={`rounded border p-4 space-y-3 ${
            accounted ? 'border-slate-200 bg-slate-50' : 'border-red-300 bg-red-50'
          }`}
        >
          <h2 className="text-sm font-semibold text-slate-900">
            Server preview · {accounted ? 'every row accounted' : 'row accounting does not tie'}
          </h2>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-6">
            <div>
              <dt className="text-slate-500">Rows In</dt>
              <dd className="font-mono font-semibold">{preview.rowsIn}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Importable</dt>
              <dd className="font-mono font-semibold text-emerald-700">{preview.importedCount}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Quarantined</dt>
              <dd className="font-mono font-semibold text-amber-800">{preview.quarantinedCount}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Duplicate refs</dt>
              <dd className="font-mono font-semibold">{preview.duplicatesDetected}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Debits</dt>
              <dd className="font-mono font-semibold">{preview.totalDebits}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Credits</dt>
              <dd className="font-mono font-semibold">{preview.totalCredits}</dd>
            </div>
          </dl>

          {preview.quarantinedCount > 0 && (
            <div className="space-y-2">
              <PartialBanner
                detail={`${preview.quarantinedCount} row(s) are potential exceptions — review the reasons below before committing. Committing still posts the balanced rows.`}
              />
              <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
                {preview.quarantined.map((entry) => (
                  <li key={`${entry.rowNo}-${entry.reason}`} className="font-mono text-slate-700">
                    row {entry.rowNo}: {entry.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.imported.length > 0 && (
            <div className="overflow-x-auto rounded border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <caption className="sr-only">First previewed ledger rows</caption>
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">Ref</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Account</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2 text-right">Debit</th>
                    <th className="px-3 py-2 text-right">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.imported.slice(0, 20).map((row) => (
                    <tr key={`${row.rowNo}-${row.entryRef}-${row.accountCode}`}>
                      <td className="px-3 py-1.5 font-mono">{row.rowNo}</td>
                      <td className="px-3 py-1.5 font-mono">{row.entryRef}</td>
                      <td className="px-3 py-1.5 font-mono">{row.postingDate}</td>
                      <td className="px-3 py-1.5 font-mono">{row.accountCode}</td>
                      <td className="px-3 py-1.5">{row.description}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{row.debit}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{row.credit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {dataset === 'actuals' && committed !== null && (
        <div className="rounded border border-emerald-300 bg-emerald-50 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-emerald-950">Committed import batch</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-6">
            <div>
              <dt className="text-emerald-800">Rows In</dt>
              <dd className="font-mono font-semibold">{committed.rowsIn}</dd>
            </div>
            <div>
              <dt className="text-emerald-800">Imported</dt>
              <dd className="font-mono font-semibold">{committed.importedCount}</dd>
            </div>
            <div>
              <dt className="text-emerald-800">Quarantined</dt>
              <dd className="font-mono font-semibold">{committed.quarantinedCount}</dd>
            </div>
            <div>
              <dt className="text-emerald-800">Entries posted</dt>
              <dd className="font-mono font-semibold">{committed.entryCount}</dd>
            </div>
            <div>
              <dt className="text-emerald-800">Debits</dt>
              <dd className="font-mono font-semibold">{committed.totalDebits}</dd>
            </div>
            <div>
              <dt className="text-emerald-800">Credits</dt>
              <dd className="font-mono font-semibold">{committed.totalCredits}</dd>
            </div>
          </dl>
          <p className="font-mono text-xs text-emerald-900">
            batch {committed.batchId}
            {committed.replacedBatchId === null
              ? ' · new batch (this source had no active batch)'
              : ` · replaced batch ${committed.replacedBatchId}`}
            {' · '}source hash {committed.sourceHash.slice(0, 12)}…
          </p>
          <p className="text-xs text-emerald-900">
            {committed.importedCount + committed.quarantinedCount === committed.rowsIn
              ? 'Row accounting ties: imported + quarantined = rows in. Re-committing the same file replaces this batch atomically with zero duplicates.'
              : 'Row accounting DOES NOT tie — treat this batch as unsafe and report it.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => navigate('/model-grid')}
              className="rounded bg-emerald-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
            >
              Go to Model Grid
            </button>
            <button
              type="button"
              onClick={() => navigate('/statements')}
              className="rounded border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-900 hover:bg-emerald-100"
            >
              View Statements
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
