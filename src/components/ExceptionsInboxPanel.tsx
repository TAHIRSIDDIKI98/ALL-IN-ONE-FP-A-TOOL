import { useCallback, useEffect, useState, type ReactElement } from 'react';
import {
  ApiClientError,
  createApiClient,
  type ExceptionWorkspaceResponse,
} from '../api/client.js';
import type { SpineRoutePath } from '../../shared/spine.js';
import {
  InlineEmptyState,
  InlineErrorState,
  LoadingState,
  PartialBanner,
} from './StateFrame.js';

export interface ExceptionsInboxPanelProps {
  readonly companyId: string | null;
  readonly authToken: string | null;
  readonly fiscalYear: number;
  readonly onNavigate: (path: SpineRoutePath) => void;
  readonly forcedState?: 'loading' | 'empty' | 'error';
}

interface InboxFailure {
  readonly code: string;
  readonly message: string;
}

const SEVERITY_BADGE: Record<'high' | 'medium' | 'low', string> = {
  high: 'bg-rose-100 text-rose-800 border-rose-200',
  medium: 'bg-amber-100 text-amber-800 border-amber-200',
  low: 'bg-slate-100 text-slate-700 border-slate-200',
};

const STATUS_BADGE: Record<string, string> = {
  new: 'bg-sky-100 text-sky-800',
  acknowledged: 'bg-indigo-100 text-indigo-800',
  explained: 'bg-violet-100 text-violet-800',
  corrected: 'bg-emerald-100 text-emerald-800',
  verified: 'bg-teal-100 text-teal-800',
  closed: 'bg-slate-200 text-slate-800',
  waived: 'bg-amber-100 text-amber-800',
};

export function ExceptionsInboxPanel({
  companyId,
  authToken,
  fiscalYear,
  onNavigate,
  forcedState,
}: ExceptionsInboxPanelProps): ReactElement {
  const [workspace, setWorkspace] = useState<ExceptionWorkspaceResponse | null>(null);
  const [selectedPeriodCode, setSelectedPeriodCode] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [showCatalog, setShowCatalog] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<InboxFailure | null>(null);
  const [noteByFinding, setNoteByFinding] = useState<Record<string, string>>({});
  const [waiverDaysByFinding, setWaiverDaysByFinding] = useState<Record<string, string>>({});
  const [exportedCsvPreview, setExportedCsvPreview] = useState<string | null>(null);

  const loadWorkspace = useCallback(
    async (periodOverride?: string | null) => {
      if (companyId === null || authToken === null) return;
      setLoading(true);
      setError(null);
      try {
        const api = createApiClient({ getToken: () => authToken });
        const periodToLoad = periodOverride ?? selectedPeriodCode;
        const data = await api.getExceptionsWorkspace(companyId, {
          year: fiscalYear,
          ...(periodToLoad !== null ? { period: periodToLoad } : {}),
        });
        setWorkspace(data);
        setSelectedPeriodCode(data.selectedPeriodCode);
      } catch (err) {
        if (err instanceof ApiClientError) {
          setError({ code: err.code, message: err.message });
        } else {
          setError({
            code: 'INTERNAL_ERROR',
            message: err instanceof Error ? err.message : 'Unable to load exception inbox.',
          });
        }
      } finally {
        setLoading(false);
      }
    },
    [companyId, authToken, fiscalYear, selectedPeriodCode],
  );

  useEffect(() => {
    if (forcedState !== undefined) return;
    void loadWorkspace();
  }, [forcedState, loadWorkspace]);

  const handleScan = async (): Promise<void> => {
    if (companyId === null || authToken === null) return;
    setBusy(true);
    setError(null);
    try {
      const api = createApiClient({ getToken: () => authToken });
      const updated = await api.scanCompanyExceptions(companyId, {
        fiscalYear,
        ...(selectedPeriodCode !== null ? { periodCode: selectedPeriodCode } : {}),
      });
      setWorkspace(updated);
      setSelectedPeriodCode(updated.selectedPeriodCode);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({ code: 'INTERNAL_ERROR', message: 'Exception scan failed.' });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleTransition = async (
    findingId: string,
    expectedVersion: number,
    action: 'assign' | 'acknowledge' | 'explain' | 'verify' | 'close' | 'waive',
    extra?: { readonly ownerUserId?: string | null },
  ): Promise<void> => {
    if (companyId === null || authToken === null) return;
    setBusy(true);
    setError(null);
    try {
      const api = createApiClient({ getToken: () => authToken });
      const note = (noteByFinding[findingId] ?? '').trim();
      const waiverDaysRaw = (waiverDaysByFinding[findingId] ?? '30').trim();
      const waiverDays = Number.parseInt(waiverDaysRaw, 10);
      const updated = await api.transitionExceptionFinding(companyId, findingId, {
        action,
        expectedVersion,
        ...(note.length > 0 ? { note } : {}),
        ...(extra?.ownerUserId !== undefined ? { ownerUserId: extra.ownerUserId } : {}),
        ...(action === 'waive'
          ? {
              waiverReason: note,
              waiverExpiryDays: Number.isFinite(waiverDays) ? waiverDays : 30,
            }
          : {}),
      });
      setWorkspace(updated);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({ code: 'INTERNAL_ERROR', message: 'Transition failed.' });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRectify = async (
    findingId: string,
    expectedVersion: number,
    mode: 'post_reversal' | 'export_csv' | 'dismiss',
  ): Promise<void> => {
    if (companyId === null || authToken === null) return;
    setBusy(true);
    setError(null);
    try {
      const api = createApiClient({ getToken: () => authToken });
      const note = (noteByFinding[findingId] ?? '').trim();
      const updated = await api.rectifyExceptionFinding(companyId, findingId, {
        mode,
        expectedVersion,
        ...(note.length > 0 ? { note } : {}),
      });
      setWorkspace(updated);
      const rect = updated.findings.find((f) => f.id === findingId)?.rectification;
      if (mode === 'export_csv' && rect?.csvPayload) {
        setExportedCsvPreview(rect.csvPayload);
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({ code: 'INTERNAL_ERROR', message: 'Rectification action failed.' });
      }
    } finally {
      setBusy(false);
    }
  };

  if (forcedState === 'loading' || loading) {
    return <LoadingState label="Loading exception rules & owner inbox…" />;
  }
  if (forcedState === 'empty' || companyId === null || authToken === null) {
    return (
      <InlineEmptyState
        disclosure="Select or create a company workspace before scanning GL exceptions."
        ctaLabel="Go to Import Wizard"
        onAction={() => onNavigate('/import')}
      />
    );
  }
  if (forcedState === 'error' || (error !== null && workspace === null)) {
    return (
      <InlineErrorState
        code={error?.code ?? 'INTERNAL_ERROR'}
        message={error?.message ?? 'Unable to load exception inbox.'}
        onRetry={() => void loadWorkspace()}
      />
    );
  }
  if (workspace === null) {
    return <LoadingState label="Preparing exception workspace…" />;
  }

  const canWrite = workspace.actorRole !== 'viewer';
  const canPostGl = workspace.actorRole === 'owner' || workspace.actorRole === 'editor';
  const canApprove = workspace.actorRole === 'owner' || workspace.actorRole === 'reviewer';

  const visibleFindings = workspace.findings.filter((f) => {
    if (statusFilter !== 'all' && f.status !== statusFilter) return false;
    if (severityFilter !== 'all' && f.severity !== severityFilter) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {error !== null ? (
        <InlineErrorState
          code={error.code}
          message={error.message}
          onRetry={() => setError(null)}
        />
      ) : null}

      {workspace.periodAdvisories && workspace.periodAdvisories.length > 0 ? (
        <PartialBanner
          detail={`Soft-close advisory (${workspace.periodAdvisories[0]!.code}): ${workspace.periodAdvisories[0]!.message}`}
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-slate-700">
            <span className="mr-2 font-medium">Period</span>
            <select
              aria-label="Exception period"
              value={workspace.selectedPeriodCode}
              onChange={(e) => {
                const next = e.target.value;
                setSelectedPeriodCode(next);
                void loadWorkspace(next);
              }}
              className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
            >
              {workspace.periods.map((p) => (
                <option key={p.periodId} value={p.periodCode}>
                  {p.periodCode} — {p.label} ({p.lockStatus})
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">
            <span className="mr-2 font-medium">Status</span>
            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
            >
              <option value="all">All statuses</option>
              <option value="new">New</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="explained">Explained</option>
              <option value="corrected">Corrected</option>
              <option value="verified">Verified</option>
              <option value="closed">Closed</option>
              <option value="waived">Waived</option>
            </select>
          </label>

          <label className="text-sm text-slate-700">
            <span className="mr-2 font-medium">Severity</span>
            <select
              aria-label="Filter by severity"
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
            >
              <option value="all">All severities</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCatalog((prev) => !prev)}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {showCatalog ? 'Hide 28-Rule Catalog' : `View 28-Rule Catalog (${workspace.catalog.length})`}
          </button>
          <button
            type="button"
            disabled={!canWrite || busy}
            onClick={() => void handleScan()}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? 'Scanning…' : 'Run Exception Scan'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: 'Total', value: workspace.metrics.totalFindings },
          { label: 'Open', value: workspace.metrics.openCount },
          { label: 'High Open', value: workspace.metrics.highSeverityOpenCount },
          { label: 'Unassigned', value: workspace.metrics.unassignedOpenCount },
          { label: 'Pending Verify', value: workspace.metrics.correctedPendingVerifyCount },
          { label: 'Waived', value: workspace.metrics.waivedCount },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs font-medium text-slate-500">{kpi.label}</p>
            <p className="mt-1 text-lg font-semibold text-slate-900 tabular-nums">{kpi.value}</p>
          </div>
        ))}
      </div>

      {workspace.lastScan !== null ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          <p className="font-medium text-slate-900">
            Last scan: evaluated {workspace.lastScan.evaluatedRuleCount} rules —{' '}
            {workspace.lastScan.newFindingsCount} new, {workspace.lastScan.existingFindingsCount}{' '}
            existing, {workspace.lastScan.resurfacedWaiversCount} expired waivers resurfaced.
          </p>
          {workspace.lastScan.notRunRules.length > 0 ? (
            <p className="mt-1 text-slate-600">
              Not-run rules ({workspace.lastScan.notRunRules.length}):{' '}
              {workspace.lastScan.notRunRules
                .slice(0, 6)
                .map((r) => `${r.ruleId} (${r.reason})`)
                .join('; ')}
              {workspace.lastScan.notRunRules.length > 6 ? '…' : ''}
            </p>
          ) : null}
        </div>
      ) : null}

      {showCatalog ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Exception-Rule Catalog ({workspace.catalog.length} rules)
          </h2>
          <div className="mt-3 max-h-64 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-1.5 pr-3">Rule</th>
                  <th className="py-1.5 pr-3">Category</th>
                  <th className="py-1.5 pr-3">Severity</th>
                  <th className="py-1.5 pr-3">Rectification</th>
                  <th className="py-1.5">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {workspace.catalog.map((rule) => (
                  <tr key={rule.ruleId}>
                    <td className="py-1.5 pr-3 font-mono font-medium text-slate-900">
                      {rule.ruleId}
                    </td>
                    <td className="py-1.5 pr-3 text-slate-600">{rule.category}</td>
                    <td className="py-1.5 pr-3">{rule.defaultSeverity}</td>
                    <td className="py-1.5 pr-3 font-mono text-slate-600">
                      {rule.suggestionKind}
                    </td>
                    <td className="py-1.5 text-slate-700">{rule.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {exportedCsvPreview !== null ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-emerald-900">
              Exported Rectification GL CSV (canonical balanced payload)
            </span>
            <button
              type="button"
              onClick={() => setExportedCsvPreview(null)}
              className="text-emerald-800 underline"
            >
              Close
            </button>
          </div>
          <pre className="mt-2 overflow-x-auto rounded bg-white p-2 font-mono text-slate-800">
            {exportedCsvPreview}
          </pre>
        </div>
      ) : null}

      {visibleFindings.length === 0 ? (
        <InlineEmptyState
          disclosure="No exception findings match the selected period and filters. Run an exception scan to evaluate all active GL postings, quarantined rows, and BvA variances."
          ctaLabel="Run Exception Scan"
          onAction={() => void handleScan()}
        />
      ) : (
        <div className="space-y-3">
          {visibleFindings.map((finding) => {
            const noteVal = noteByFinding[finding.id] ?? '';
            const waiverDaysVal = waiverDaysByFinding[finding.id] ?? '30';
            const canRectifyLines =
              finding.suggestion.lines.length > 0 && finding.rectification === null;

            return (
              <article
                key={finding.id}
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-900">
                        {finding.ruleId}
                      </span>
                      <span
                        className={`rounded border px-2 py-0.5 text-xs font-medium ${SEVERITY_BADGE[finding.severity]}`}
                      >
                        {finding.severity}
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[finding.status] ?? 'bg-slate-100 text-slate-700'}`}
                      >
                        {finding.status}
                      </span>
                      <span className="text-xs text-slate-500">
                        Account {finding.accountCode ?? '—'} · Grain {finding.grainKey} · Due{' '}
                        {finding.dueDate}
                      </span>
                    </div>
                    <h3 className="mt-1 text-sm font-semibold text-slate-900">{finding.title}</h3>
                  </div>

                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-900 tabular-nums">
                      {finding.amount}
                    </p>
                    <p className="font-mono text-[11px] text-slate-400">
                      v{finding.version} · {finding.findingIdHash.slice(0, 10)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 rounded bg-slate-50 p-3 text-xs text-slate-700">
                  <p>
                    <span className="font-semibold text-slate-900">Suggestion:</span>{' '}
                    <span className="font-mono">{finding.suggestion.kind}</span> → Target{' '}
                    <span className="font-mono">{finding.suggestion.targetPeriodCode}</span> ·{' '}
                    {finding.suggestion.basis}
                  </p>
                  <p className="mt-1 text-slate-600">{finding.suggestion.erpHint}</p>

                  {finding.suggestion.lines.length > 0 ? (
                    <table className="mt-2 w-full text-left font-mono text-[11px]">
                      <thead className="border-b border-slate-200 text-slate-500">
                        <tr>
                          <th className="py-1 pr-2">Account</th>
                          <th className="py-1 pr-2 text-right">Debit</th>
                          <th className="py-1 pr-2 text-right">Credit</th>
                          <th className="py-1">Memo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {finding.suggestion.lines.map((line, idx) => (
                          <tr key={`${finding.id}-line-${idx}`}>
                            <td className="py-1 pr-2">{line.accountCode}</td>
                            <td className="py-1 pr-2 text-right tabular-nums">{line.debit}</td>
                            <td className="py-1 pr-2 text-right tabular-nums">{line.credit}</td>
                            <td className="py-1 text-slate-600">{line.memo}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}

                  {finding.rectification !== null ? (
                    <p className="mt-2 font-medium text-emerald-800">
                      Rectification recorded ({finding.rectification.mode}) into{' '}
                      {finding.rectification.targetPeriodCode}
                      {finding.rectification.postedBatchId !== null
                        ? ` · GL Batch ${finding.rectification.postedBatchId.slice(0, 8)}`
                        : ''}
                    </p>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <label className="text-xs text-slate-600">
                    <span className="mr-1 font-medium">Owner</span>
                    <select
                      aria-label={`Owner for ${finding.findingIdHash.slice(0, 8)}`}
                      disabled={!canWrite || busy}
                      value={finding.ownerUserId ?? ''}
                      onChange={(e) =>
                        void handleTransition(finding.id, finding.version, 'assign', {
                          ownerUserId: e.target.value === '' ? null : e.target.value,
                        })
                      }
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                    >
                      <option value="">Unassigned</option>
                      {workspace.members.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.displayName} ({m.role})
                        </option>
                      ))}
                    </select>
                  </label>

                  <input
                    type="text"
                    placeholder="Explanation or waiver note…"
                    value={noteVal}
                    onChange={(e) =>
                      setNoteByFinding((prev) => ({ ...prev, [finding.id]: e.target.value }))
                    }
                    className="min-w-[200px] flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
                  />

                  <input
                    type="number"
                    min={1}
                    max={90}
                    aria-label="Waiver expiry days"
                    value={waiverDaysVal}
                    onChange={(e) =>
                      setWaiverDaysByFinding((prev) => ({ ...prev, [finding.id]: e.target.value }))
                    }
                    className="w-16 rounded border border-slate-300 px-2 py-1 text-xs"
                    title="Waiver expiry days (1–90)"
                  />

                  {canWrite && finding.status === 'new' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleTransition(finding.id, finding.version, 'acknowledge')}
                      className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Acknowledge
                    </button>
                  ) : null}

                  {canWrite &&
                  (finding.status === 'new' || finding.status === 'acknowledged') ? (
                    <button
                      type="button"
                      disabled={busy || noteVal.trim().length === 0}
                      onClick={() => void handleTransition(finding.id, finding.version, 'explain')}
                      className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Explain
                    </button>
                  ) : null}

                  {canPostGl && canRectifyLines ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void handleRectify(finding.id, finding.version, 'post_reversal')
                      }
                      className="rounded bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      Post Reversal to GL
                    </button>
                  ) : null}

                  {canWrite && canRectifyLines ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleRectify(finding.id, finding.version, 'export_csv')}
                      className="rounded border border-emerald-700 bg-white px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                    >
                      Export CSV
                    </button>
                  ) : null}

                  {canWrite && finding.rectification === null ? (
                    <button
                      type="button"
                      disabled={busy || noteVal.trim().length === 0}
                      onClick={() => void handleRectify(finding.id, finding.version, 'dismiss')}
                      className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Dismiss Suggestion
                    </button>
                  ) : null}

                  {canApprove &&
                  (finding.status === 'explained' || finding.status === 'corrected') ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleTransition(finding.id, finding.version, 'verify')}
                      className="rounded bg-teal-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                    >
                      Verify
                    </button>
                  ) : null}

                  {canApprove && finding.status === 'verified' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleTransition(finding.id, finding.version, 'close')}
                      className="rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-50"
                    >
                      Close
                    </button>
                  ) : null}

                  {canApprove &&
                  finding.status !== 'closed' &&
                  finding.status !== 'waived' ? (
                    <button
                      type="button"
                      disabled={busy || noteVal.trim().length === 0}
                      onClick={() => void handleTransition(finding.id, finding.version, 'waive')}
                      className="rounded border border-amber-400 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                    >
                      Waive (≤90d)
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {workspace.recentEvents.length > 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Recent Exception Events</h2>
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {workspace.recentEvents.slice(0, 8).map((ev) => (
              <li key={ev.id}>
                <span className="font-mono text-slate-800">{ev.action}</span>{' '}
                {ev.fromStatus ? `${ev.fromStatus} → ${ev.toStatus}` : `→ ${ev.toStatus}`}
                {ev.actorEmail ? ` by ${ev.actorEmail}` : ''}
                {ev.note ? ` — ${ev.note}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
