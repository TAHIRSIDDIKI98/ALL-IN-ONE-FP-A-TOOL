import { useState, type ReactElement } from 'react';
import { EmptyState, ErrorState, LoadingState } from '../components/StateFrame.js';
import { useWorkspaceStore } from '../state/workspaceStore.js';
import type { SpinePageProps } from './SignInPage.js';

type StatementTab = 'pl' | 'bs' | 'cf' | 'bva';

export default function StatementsPage({ onNavigate, forcedState }: SpinePageProps): ReactElement {
  const { lastImport } = useWorkspaceStore();
  const initialTab = (() => {
    if (typeof window === 'undefined') return 'pl' as StatementTab;
    const param = new URLSearchParams(window.location.search).get('tab');
    if (param === 'bs' || param === 'cf' || param === 'bva') return param;
    return 'pl' as StatementTab;
  })();

  const [activeTab, setActiveTab] = useState<StatementTab>(initialTab);

  const selectTab = (tab: StatementTab): void => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    }
  };

  if (forcedState === 'loading') {
    return <LoadingState label="Computing articulating P&L, Balance Sheet, and Cash Flow..." />;
  }

  if (forcedState === 'error') {
    return (
      <ErrorState
        title="Financial Statements"
        code="STATEMENT_TIE_OUT_FAILED"
        message="Unable to reconcile financial statement tie-out against ledger entries."
        onRetry={() => onNavigate('/statements')}
      />
    );
  }

  if (forcedState === 'empty' || !lastImport) {
    return (
      <EmptyState
        title="Financial Statements"
        disclosure="Committed GL ledger postings are required to compute articulating Income Statement, Balance Sheet, Cash Flow, and BvA views."
        ctaLabel="Import Ledger Data"
        ctaPath="/import"
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-slate-900">Financial Statements</h1>
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

      <p className="text-sm text-slate-600">
        Active tab: <span className="font-mono font-semibold">{activeTab.toUpperCase()}</span> · {lastImport.imported.length}{' '}
        staged ledger row(s) ready for Chart of Accounts mapping &amp; statement synthesis.
      </p>
    </section>
  );
}
