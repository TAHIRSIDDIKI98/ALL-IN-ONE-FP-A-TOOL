import { useState, type ReactElement } from 'react';
import { format } from '../../core/money/index.js';
import { EmptyState, ErrorState, LoadingState, PartialBanner } from '../components/StateFrame.js';
import { useWorkspaceStore } from '../state/workspaceStore.js';
import type { SpinePageProps } from './SignInPage.js';

export default function ModelGridPage({ onNavigate, forcedState }: SpinePageProps): ReactElement {
  const { lastImport, company } = useWorkspaceStore();
  const [selectedRowNo, setSelectedRowNo] = useState<number | null>(null);

  if (forcedState === 'loading') {
    return <LoadingState label="Loading Model Grid rows and period basis..." />;
  }

  if (forcedState === 'error') {
    return (
      <ErrorState
        title="Model Grid"
        code="MODEL_VERSION_LOCKED"
        message="Unable to load draft plan grid for the current period."
        onRetry={() => onNavigate('/model-grid')}
      />
    );
  }

  if (forcedState === 'empty' || !lastImport) {
    return (
      <EmptyState
        title="Model Grid"
        disclosure="Actual ledger postings or a budget plan version are required before rendering period grid cells."
        ctaLabel="Import Actuals in Import Wizard"
        ctaPath="/import"
        onNavigate={onNavigate}
      />
    );
  }

  const currency = company?.currency ?? 'USD';
  const selectedRow = lastImport.imported.find((r) => r.rowNo === selectedRowNo) ?? null;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-slate-900">Model Grid</h1>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onNavigate('/statements')}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700"
          >
            View Statements
          </button>
          <button
            type="button"
            disabled
            onClick={() => setSelectedRowNo(null)}
            className="rounded border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-500"
          >
            Iterative Calc (M2)
          </button>
        </div>
      </div>

      <PartialBanner detail="Actuals loaded from staged import; no draft plan version has been saved yet." />

      <div className="overflow-x-auto rounded border border-slate-200">
        <table role="grid" className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left font-medium text-slate-700">
            <tr>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2">Posting Date</th>
              <th className="px-3 py-2">Entry Ref</th>
              <th className="px-3 py-2 text-right">Debit ({currency})</th>
              <th className="px-3 py-2 text-right">Credit ({currency})</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {lastImport.imported.map((row) => (
              <tr key={`${row.rowNo}-${row.entryRef}`}>
                <td className="px-3 py-2 font-mono">{row.accountCode}</td>
                <td className="px-3 py-2 font-mono">{row.postingDate}</td>
                <td className="px-3 py-2">{row.entryRef}</td>
                <td className="px-3 py-2 text-right font-mono">
                  <button
                    type="button"
                    onClick={() => setSelectedRowNo(row.rowNo)}
                    className="underline decoration-dotted hover:text-slate-950"
                  >
                    {format(row.debit, { currency })}
                  </button>
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  <button
                    type="button"
                    onClick={() => setSelectedRowNo(row.rowNo)}
                    className="underline decoration-dotted hover:text-slate-950"
                  >
                    {format(row.credit, { currency })}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedRow && (
        <aside className="rounded border border-slate-300 bg-slate-50 p-4 text-xs font-mono">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Drill-to-Source · Row #{selectedRow.rowNo}</span>
            <button
              type="button"
              onClick={() => setSelectedRowNo(null)}
              className="rounded border border-slate-300 bg-white px-2 py-0.5 text-slate-700"
            >
              Close
            </button>
          </div>
          <div className="mt-2">
            Entry={selectedRow.entryRef} · Account={selectedRow.accountCode} · Date={selectedRow.postingDate} · Desc=
            {selectedRow.description}
          </div>
        </aside>
      )}
    </section>
  );
}
