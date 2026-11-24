import type { ReactElement } from 'react';
import { EmptyState, ErrorState, LoadingState } from '../components/StateFrame.js';
import { useWorkspaceStore } from '../state/workspaceStore.js';
import type { SpinePageProps } from './SignInPage.js';

export default function BoardPackPage({ onNavigate, forcedState }: SpinePageProps): ReactElement {
  const { company, lastImport } = useWorkspaceStore();

  if (forcedState === 'loading') {
    return <LoadingState label="Preparing Board Pack preview..." />;
  }

  if (forcedState === 'error') {
    return (
      <ErrorState
        title="Board Pack Export"
        code="STATEMENT_TIE_OUT_FAILED"
        message="Export synthesis aborted because statement articulation did not tie cleanly."
        onRetry={() => onNavigate('/board-pack')}
      />
    );
  }

  if (forcedState === 'empty' || !company || !lastImport) {
    return (
      <EmptyState
        title="Board Pack Export"
        disclosure="Configure a company and commit at least one GL import batch before previewing or exporting Board Pack XLSX/PDF artifacts."
        ctaLabel={company ? 'Import Ledger Data' : 'Configure Company'}
        ctaPath={company ? '/import' : '/setup'}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Board Pack Preview &amp; Export</h1>
      <p className="text-sm text-slate-600">
        Company: <span className="font-semibold text-slate-900">{company.name}</span> ({company.currency}) · Cross-artifact
        tie-out (`UI == XLSX == PDF`) enforced by <span className="font-mono">/core/statements</span>.
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => onNavigate('/statements')}
          className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Inspect Statements First
        </button>
      </div>
    </section>
  );
}
