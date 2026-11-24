import { useState, type ReactElement } from 'react';
import { evaluateMessyGlCsv } from '../../core/import/index.js';
import { serialize } from '../../core/money/index.js';
import { EmptyState, ErrorState, LoadingState } from '../components/StateFrame.js';
import { useWorkspaceStore } from '../state/workspaceStore.js';
import type { SpinePageProps } from './SignInPage.js';

const DEFAULT_CORE_CODES = ['1000', '001200', '1200', '2000', '4000', '5000', '6000', '6100', '6200'];

export default function ImportWizardPage({ onNavigate, forcedState }: SpinePageProps): ReactElement {
  const { company, lastImport, saveImportResult } = useWorkspaceStore();
  const [csvDraft, setCsvDraft] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);

  const runPreview = (): void => {
    setIsParsing(true);
    setImportError(null);
    try {
      if (csvDraft.trim().length === 0) {
        setImportError('IMPORT_FILE_UNREADABLE: Paste or upload a non-empty CSV ledger export.');
        return;
      }
      const res = evaluateMessyGlCsv({
        csvText: csvDraft,
        knownAccountCodes: new Set(DEFAULT_CORE_CODES),
        locale: 'unknown',
      });
      saveImportResult(res);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Unable to parse CSV import batch.');
    } finally {
      setIsParsing(false);
    }
  };

  if (forcedState === 'loading' || isParsing) {
    return <LoadingState label="Analyzing CSV import batch and row accounting..." />;
  }

  if (forcedState === 'error' || importError !== null) {
    return (
      <ErrorState
        title="GL Import Wizard"
        code="IMPORT_FILE_UNREADABLE"
        message={importError ?? 'CSV batch failed validation.'}
        onRetry={runPreview}
      />
    );
  }

  if (forcedState === 'empty' || (!company && !lastImport && csvDraft.length === 0)) {
    return (
      <EmptyState
        title="GL Import Wizard"
        disclosure="Company setup and a CSV/XLSX ledger export are required before staging rows for Trial Balance reconciliation."
        ctaLabel={company ? 'Open CoA Mapper' : 'Complete Setup Wizard'}
        ctaPath={company ? '/coa-mapper' : '/setup'}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">GL Import Wizard</h1>
          <p className="mt-1 text-sm text-slate-600">
            Upload or paste CSV rows. Ambiguous numbers/dates and unmapped accounts are quarantined — never silently dropped.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onNavigate('/coa-mapper')}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Open CoA Mapper
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/model-grid')}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Go to Model Grid
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <label htmlFor="csv-upload" className="block text-sm font-medium text-slate-700">
          Upload CSV file
        </label>
        <input
          id="csv-upload"
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            void file.text().then((txt) => setCsvDraft(txt));
          }}
          className="block w-full text-sm text-slate-700 file:mr-4 file:rounded file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
        />
        <label htmlFor="csv-textarea" className="block text-sm font-medium text-slate-700">
          CSV ledger payload
        </label>
        <textarea
          id="csv-textarea"
          rows={5}
          value={csvDraft}
          onChange={(e) => setCsvDraft(e.target.value)}
          placeholder="entry_ref,date,account_code,description,debit,credit"
          className="w-full rounded border border-slate-300 p-3 font-mono text-xs"
        />
        <button
          type="button"
          onClick={runPreview}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Validate &amp; Stage Import
        </button>
      </div>

      {lastImport && (
        <div className="rounded border border-slate-200 bg-slate-50 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Row Accounting Summary (C6 / D5 Exact)</h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5 text-sm">
            <div>
              <dt className="text-slate-500">Rows In</dt>
              <dd className="font-mono font-semibold">{lastImport.rowsIn}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Imported</dt>
              <dd className="font-mono font-semibold text-emerald-700">{lastImport.imported.length}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Quarantined</dt>
              <dd className="font-mono font-semibold text-amber-800">{lastImport.quarantined.length}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Total Debits</dt>
              <dd className="font-mono font-semibold">{serialize(lastImport.totalDebits, 2)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Total Credits</dt>
              <dd className="font-mono font-semibold">{serialize(lastImport.totalCredits, 2)}</dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
