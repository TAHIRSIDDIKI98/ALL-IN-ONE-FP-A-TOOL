import type { ReactElement } from 'react';
import { EmptyState, ErrorState, LoadingState, PartialBanner } from '../components/StateFrame.js';
import { useWorkspaceStore } from '../state/workspaceStore.js';
import type { SpinePageProps } from './SignInPage.js';

export default function CoaMapperPage({ onNavigate, forcedState }: SpinePageProps): ReactElement {
  const { lastImport, quarantinedMappings, mapAccountCode } = useWorkspaceStore();

  if (forcedState === 'loading') {
    return <LoadingState label="Loading Chart of Accounts mappings..." />;
  }

  if (forcedState === 'error') {
    return (
      <ErrorState
        title="Chart of Accounts Mapper"
        code="MAP_TARGET_INVALID"
        message="Unable to load CoA mapping table for the active import batch."
        onRetry={() => onNavigate('/coa-mapper')}
      />
    );
  }

  if (forcedState === 'empty' || !lastImport) {
    return (
      <EmptyState
        title="Chart of Accounts Mapper"
        disclosure="No GL import batch is available to map. Stage an import batch first to inspect source codes and quarantine conflicts."
        ctaLabel="Open Import Wizard"
        ctaPath="/import"
        onNavigate={onNavigate}
      />
    );
  }

  const unmappedRows = lastImport.quarantined.filter((q) => q.reason.startsWith('UNMAPPED_ACCOUNT:'));

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Chart of Accounts Mapper</h1>
      {unmappedRows.length > 0 && (
        <PartialBanner detail={`${unmappedRows.length} source account code(s) require explicit mapping or quarantine confirmation.`} />
      )}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => mapAccountCode('9999', '6500')}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Map Unmapped to Other OpEx (6500)
        </button>
        <button
          type="button"
          onClick={() => onNavigate('/model-grid')}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          Proceed to Model Grid
        </button>
      </div>
      <div className="text-xs text-slate-600 font-mono">
        Quarantined exceptions recorded: {Object.keys(quarantinedMappings).length + lastImport.quarantined.length}
      </div>
    </section>
  );
}
