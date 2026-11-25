import { useEffect, useState, type ReactElement } from 'react';
import {
  ApiClientError,
  createApiClient,
  type BoardPackReportPayload,
  type BoardPackRowPayload,
} from '../api/client.js';
import { EmptyState, ErrorState, LoadingState, PartialBanner } from '../components/StateFrame.js';
import { useWorkspaceStore } from '../state/workspaceStore.js';
import type { SpinePageProps } from './SignInPage.js';

type ExportFormat = 'xlsx' | 'pdf';

const SECTIONS: readonly { readonly id: BoardPackRowPayload['section']; readonly title: string }[] = [
  { id: 'cover', title: 'Cover KPIs' },
  { id: 'pl', title: 'Income Statement (P&L)' },
  { id: 'bs', title: 'Balance Sheet' },
  { id: 'cf', title: 'Cash Flow (indirect)' },
  { id: 'bva', title: 'Budget vs Actual' },
];

function describeError(error: unknown): { code: string; message: string } {
  return error instanceof ApiClientError
    ? { code: error.code, message: error.message }
    : {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Unable to prepare the board pack.',
      };
}

/**
 * Board Pack (MASTER_PROMPT §9.3.7, A6/U5/G7). The preview renders the SERVER's canonical rows;
 * XLSX and PDF downloads are generated from those same rows. The browser never computes a value.
 */
export default function BoardPackPage({ onNavigate, forcedState }: SpinePageProps): ReactElement {
  const { company, authToken } = useWorkspaceStore();
  const [period, setPeriod] = useState('P12');
  const [pack, setPack] = useState<BoardPackReportPayload | null>(null);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [loadError, setLoadError] = useState<{ code: string; message: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [exportState, setExportState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [exportError, setExportError] = useState<{ code: string; message: string } | null>(null);
  const [retryFormat, setRetryFormat] = useState<ExportFormat>('xlsx');

  const companyId = company?.id ?? null;
  const fiscalYear = company?.fiscalYear ?? null;

  useEffect(() => {
    if (companyId === null || authToken === null) return;
    let cancelled = false;
    setLoadState('loading');
    setLoadError(null);
    createApiClient({ getToken: () => authToken })
      .getBoardPack(companyId, { period, fiscalYear })
      .then((result) => {
        if (cancelled) return;
        setPack(result);
        setLoadState('idle');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPack(null);
        setLoadState('error');
        setLoadError(describeError(error));
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, authToken, period, fiscalYear, reloadKey]);

  const exportPack = (format: ExportFormat): void => {
    if (companyId === null || authToken === null) return;
    setRetryFormat(format);
    setExportState('loading');
    setExportError(null);
    createApiClient({ getToken: () => authToken })
      .downloadBoardPack(companyId, { period, fiscalYear, format })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `board-pack-${period}.${format}`;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        setExportState('idle');
      })
      .catch((error: unknown) => {
        setExportState('error');
        setExportError(describeError(error));
      });
  };

  if (forcedState === 'loading' || loadState === 'loading' || exportState === 'loading') {
    return <LoadingState label="Preparing the board pack from committed ledger figures..." />;
  }

  if (forcedState === 'error' || loadState === 'error') {
    return (
      <ErrorState
        title="Board Pack Export"
        code={loadError?.code ?? 'STATEMENT_TIE_OUT_FAILED'}
        message={loadError?.message ?? 'Unable to reconcile the board pack against the ledger.'}
        onRetry={() => setReloadKey((key) => key + 1)}
      />
    );
  }

  if (companyId === null || authToken === null) {
    return (
      <EmptyState
        title="Board Pack Export"
        disclosure="Sign in and create a company workspace before exporting a pack; every figure is produced by the server from committed postings."
        ctaLabel="Go to Sign In"
        ctaPath="/sign-in"
        onNavigate={onNavigate}
      />
    );
  }

  if (pack === null) {
    return (
      <EmptyState
        title="Board Pack Export"
        disclosure="Committed GL postings are required before a board pack can be assembled."
        ctaLabel="Import Ledger Data"
        ctaPath="/import"
        onNavigate={onNavigate}
      />
    );
  }

  if (exportState === 'error') {
    return (
      <ErrorState
        title="Board Pack Export"
        code={exportError?.code ?? 'EXPORT_FAILED'}
        message={exportError?.message ?? 'The export could not be generated.'}
        onRetry={() => exportPack(retryFormat)}
      />
    );
  }

  if (pack.sources.length === 0) {
    return (
      <EmptyState
        title="Board Pack Export"
        disclosure="No committed source file exists for this company, so there is no board-pack figure to display or export."
        ctaLabel="Import Ledger Data"
        ctaPath="/import"
        onNavigate={onNavigate}
      />
    );
  }

  const periods =
    company?.calendarYears
      .find((year) => year.fiscalYear === fiscalYear)
      ?.periods.filter((item) => !item.isAdjustment)
      .map((item) => ({ code: item.code, label: item.label })) ?? [];
  const unplannedActuals = pack.bva.rows.some((row) => row.plan === null);
  const partial = !pack.articulation.valid || unplannedActuals;

  return (
    <BoardPackPreview
      pack={pack}
      periods={periods}
      period={period}
      partial={partial}
      onPeriodChange={setPeriod}
      onExport={exportPack}
    />
  );
}

export interface BoardPackPreviewProps {
  readonly pack: BoardPackReportPayload;
  readonly periods: readonly { readonly code: string; readonly label: string }[];
  readonly period: string;
  readonly partial: boolean;
  readonly onPeriodChange: (period: string) => void;
  readonly onExport: (format: ExportFormat) => void;
}

/** Pure preview of the server-issued rows; exported so the populated state can be tested without a DOM. */
export function BoardPackPreview(props: BoardPackPreviewProps): ReactElement {
  const { pack, periods, period, partial, onPeriodChange, onExport } = props;
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Board Pack Export</h1>
      <p className="text-sm text-slate-600">
        {pack.companyName} · {pack.baseCurrency} · {pack.basis}
      </p>
      <p className="text-sm text-slate-600">{pack.disclosure}</p>

      {partial ? (
        <PartialBanner
          detail={
            !pack.articulation.valid
              ? 'Statement articulation did not tie; the failing checks are listed below.'
              : 'Some actuals have no matching plan line and are reported as not planned.'
          }
        />
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-slate-700" htmlFor="board-period">
          Period
          <select
            id="board-period"
            className="ml-2 rounded border border-slate-300 px-2 py-1"
            value={period}
            onChange={(event) => onPeriodChange(event.target.value)}
          >
            {periods.length === 0 ? (
              <option value={period}>{period}</option>
            ) : (
              periods.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))
            )}
          </select>
        </label>
        <button
          type="button"
          className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white"
          onClick={() => onExport('xlsx')}
        >
          Export XLSX
        </button>
        <button
          type="button"
          className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white"
          onClick={() => onExport('pdf')}
        >
          Export PDF
        </button>
      </div>

      {SECTIONS.map((section) => {
        const rows = pack.rows.filter((row) => row.section === section.id);
        return (
          <table key={section.id} className="w-full border-collapse text-sm">
            <caption className="text-left font-semibold text-slate-900">{section.title}</caption>
            <thead>
              <tr className="border-b border-slate-300 text-left">
                <th scope="col">Line</th>
                <th scope="col">Value</th>
                <th scope="col">Basis</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-slate-100">
                  <th scope="row" className="py-1 pr-4 text-left font-normal">
                    {row.label}
                  </th>
                  <td className="py-1 pr-4 font-mono">{row.value}</td>
                  <td className="py-1 text-slate-600">{row.detail ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      })}

      <div className="text-sm text-slate-700">
        {pack.articulation.checks.map((check) => (
          <p key={check.id}>
            {check.id} {check.passed ? 'pass' : 'fail'} {check.delta} {check.detail}
          </p>
        ))}
      </div>
      <p className="text-xs text-slate-600">
        Sources: {pack.sources.map((source) => source.sourceFilename).join(', ')}
      </p>
    </section>
  );
}
