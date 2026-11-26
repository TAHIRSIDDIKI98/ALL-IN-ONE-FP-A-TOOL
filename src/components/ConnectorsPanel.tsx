import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { SpineRoutePath } from '../../shared/spine.js';
import {
  ApiClientError,
  createApiClient,
  type ConnectorConfigSummary,
  type ConnectorSourceSystem,
  type ConnectorsOverviewResponse,
  type SyncConnectorRequest,
  type SyncConnectorResponse,
  type SyncMode,
} from '../api/client.js';
import { InlineEmptyState, InlineErrorState, PartialBanner } from './StateFrame.js';

type PanelState = 'loading' | 'empty' | 'error' | 'populated';
type ConnectorAction = 'load' | 'create' | 'sync';

interface PanelFailure {
  readonly code: string;
  readonly message: string;
  readonly action: ConnectorAction;
}

function toFailure(error: unknown, action: ConnectorAction): PanelFailure {
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
    message: error instanceof Error ? error.message : 'The connector operation could not be completed.',
    action,
  };
}

function sourceSystemLabel(sourceSystem: ConnectorSourceSystem): string {
  switch (sourceSystem) {
    case 'google_sheets':
      return 'Google Sheets';
    case 'quickbooks_online':
      return 'QuickBooks Online';
    case 'xero':
      return 'Xero';
  }
}

function placeholderPayloadHint(sourceSystem: ConnectorSourceSystem): string {
  if (sourceSystem === 'google_sheets') {
    return '{"sourceSystem":"google_sheets","expectedRowCount":2,"rows":[...]}';
  }
  if (sourceSystem === 'quickbooks_online') {
    return '{"sourceSystem":"quickbooks_online","expectedRowCount":2,"journalEntries":[...]}';
  }
  return '{"sourceSystem":"xero","expectedRowCount":2,"manualJournals":[...]}';
}

/**
 * Connectors Framework & Adapters Panel (MASTER_PROMPT §11.1, CON1–CON5, WI-0040).
 *
 * - Supports Google Sheets, QuickBooks Online, and Xero within the /import screen (DEC-015).
 * - Credentials are write-only; never read back or logged client-side (CON4).
 * - Zero monetary arithmetic in the browser; server normalizes, reconciles, and commits through
 *   the single GL import pipeline (CON1–CON3).
 */
export function ConnectorsPanel(props: {
  readonly companyId: string;
  readonly authToken: string;
  readonly onNavigate: (path: SpineRoutePath) => void;
  readonly initialState?: PanelState;
  readonly initialOverview?: ConnectorsOverviewResponse | null;
  readonly initialLastSync?: SyncConnectorResponse | null;
  readonly initialFailure?: PanelFailure | null;
}): ReactElement {
  const [state, setState] = useState<PanelState>(props.initialState ?? 'loading');
  const [overview, setOverview] = useState<ConnectorsOverviewResponse | null>(
    props.initialOverview ?? null,
  );
  const [failure, setFailure] = useState<PanelFailure | null>(props.initialFailure ?? null);
  const [busy, setBusy] = useState<ConnectorAction | null>(null);

  const [sourceSystem, setSourceSystem] = useState<ConnectorSourceSystem>('google_sheets');
  const [name, setName] = useState('');
  const [externalRef, setExternalRef] = useState('');
  const [credentialSecret, setCredentialSecret] = useState('');

  const [selectedConnectorId, setSelectedConnectorId] = useState<string>(
    props.initialOverview?.connectors[0]?.id ?? '',
  );
  const [syncMode, setSyncMode] = useState<SyncMode>('incremental');
  const [cursorDraft, setCursorDraft] = useState('');
  const [payloadDraft, setPayloadDraft] = useState('');
  const [lastSync, setLastSync] = useState<SyncConnectorResponse | null>(
    props.initialLastSync ?? null,
  );

  const load = useCallback(async (): Promise<void> => {
    setState('loading');
    setFailure(null);
    try {
      const loaded = await createApiClient({
        getToken: () => props.authToken,
      }).listConnectors(props.companyId);
      setOverview(loaded);
      setSelectedConnectorId((prev) => {
        if (prev.length > 0 && loaded.connectors.some((c) => c.id === prev)) return prev;
        return loaded.connectors[0]?.id ?? '';
      });
      setState(loaded.connectors.length === 0 ? 'empty' : 'populated');
    } catch (error) {
      setFailure(toFailure(error, 'load'));
      setState('error');
    }
  }, [props.authToken, props.companyId]);

  useEffect(() => {
    if (props.initialState !== undefined) return;
    void load();
  }, [load, props.initialState]);

  const runCreateConnector = useCallback(async (): Promise<void> => {
    if (name.trim().length < 2 || externalRef.trim().length === 0 || credentialSecret.trim().length < 8) {
      setFailure({
        code: 'VALIDATION_FAILED',
        message: 'Provide a connector name, external workspace/sheet reference, and an 8+ char write-only token.',
        action: 'create',
      });
      setState('error');
      return;
    }

    setBusy('create');
    setFailure(null);
    try {
      const created = await createApiClient({
        getToken: () => props.authToken,
      }).createConnector(props.companyId, {
        sourceSystem,
        name: name.trim(),
        externalRef: externalRef.trim(),
        credentialSecret: credentialSecret.trim(),
      });
      setName('');
      setExternalRef('');
      setCredentialSecret('');
      const refreshed = await createApiClient({
        getToken: () => props.authToken,
      }).listConnectors(props.companyId);
      setOverview(refreshed);
      setSelectedConnectorId(created.id);
      setState(refreshed.connectors.length === 0 ? 'empty' : 'populated');
    } catch (error) {
      setFailure(toFailure(error, 'create'));
      setState('error');
    } finally {
      setBusy(null);
    }
  }, [credentialSecret, externalRef, name, props.authToken, props.companyId, sourceSystem]);

  const runSync = useCallback(async (): Promise<void> => {
    const connector = overview?.connectors.find((c) => c.id === selectedConnectorId);
    if (!connector) {
      setFailure({
        code: 'VALIDATION_FAILED',
        message: 'Select a configured connector before starting a sync run.',
        action: 'sync',
      });
      setState('error');
      return;
    }
    if (payloadDraft.trim().length === 0) {
      setFailure({
        code: 'VALIDATION_FAILED',
        message: 'Provide or upload a JSON adapter pull payload before executing sync.',
        action: 'sync',
      });
      setState('error');
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(payloadDraft) as unknown;
    } catch {
      setFailure({
        code: 'VALIDATION_FAILED',
        message: 'The adapter sync payload must be valid JSON.',
        action: 'sync',
      });
      setState('error');
      return;
    }

    setBusy('sync');
    setFailure(null);
    try {
      const result = await createApiClient({
        getToken: () => props.authToken,
      }).syncConnector(props.companyId, connector.id, {
        mode: syncMode,
        ...(cursorDraft.trim().length > 0 ? { cursor: cursorDraft.trim() } : {}),
        payload: parsedJson as SyncConnectorRequest['payload'],
      });
      setLastSync(result);
      const refreshed = await createApiClient({
        getToken: () => props.authToken,
      }).listConnectors(props.companyId);
      setOverview(refreshed);
      setState(refreshed.connectors.length === 0 ? 'empty' : 'populated');
    } catch (error) {
      setFailure(toFailure(error, 'sync'));
      setState('error');
    } finally {
      setBusy(null);
    }
  }, [cursorDraft, overview, payloadDraft, props.authToken, props.companyId, selectedConnectorId, syncMode]);

  const retry = (): void => {
    if (failure?.action === 'create') void runCreateConnector();
    else if (failure?.action === 'sync') void runSync();
    else void load();
  };

  const selectedConnector: ConnectorConfigSummary | undefined = overview?.connectors.find(
    (c) => c.id === selectedConnectorId,
  );
  const recentRuns = overview?.recentRuns ?? [];
  const hasQuarantinedRun =
    lastSync?.run.status === 'quarantined' ||
    (lastSync?.run.rowsQuarantined ?? 0) > 0 ||
    recentRuns.some((r) => r.status === 'quarantined');

  return (
    <section
      aria-labelledby="connectors-panel-heading"
      className="space-y-4 rounded border border-slate-200 bg-slate-50 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="connectors-panel-heading" className="text-base font-semibold text-slate-900">
            External Connectors (Google Sheets · QuickBooks Online · Xero)
          </h2>
          <p className="text-xs text-slate-600">
            Credentials remain write-only on the server. Matched syncs normalize into the single GL
            import pipeline; mismatched counts or unbalanced journals quarantine cleanly without
            posting.
          </p>
        </div>
        {overview !== null && (
          <p className="font-mono text-xs text-slate-700">
            base currency {overview.baseCurrency} · {overview.connectors.length} configured
          </p>
        )}
      </div>

      {state === 'loading' && (
        <div role="status" aria-live="polite" className="text-sm text-slate-600">
          Loading connectors and sync ledger...
        </div>
      )}

      {state === 'error' && failure !== null && (
        <InlineErrorState code={failure.code} message={failure.message} onRetry={retry} />
      )}

      {state === 'empty' && (
        <InlineEmptyState
          disclosure="No external connectors are configured for this company yet. Register a Google Sheets, QuickBooks Online, or Xero connection below or return to CSV actuals."
          ctaLabel="Reload Connectors"
          onAction={() => void load()}
        />
      )}

      {hasQuarantinedRun && state === 'populated' && (
        <PartialBanner detail="One or more sync runs were quarantined because of reconciliation mismatch or unmapped GL accounts. Review the run ledger before posting." />
      )}

      {state !== 'loading' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void runCreateConnector();
            }}
            className="space-y-3 rounded border border-slate-200 bg-white p-4"
          >
            <h3 className="text-sm font-semibold text-slate-900">Configure connector</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-xs font-medium text-slate-700">
                Source system
                <select
                  aria-label="Connector source system"
                  value={sourceSystem}
                  onChange={(event) => setSourceSystem(event.target.value as ConnectorSourceSystem)}
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                >
                  <option value="google_sheets">Google Sheets</option>
                  <option value="quickbooks_online">QuickBooks Online</option>
                  <option value="xero">Xero</option>
                </select>
              </label>
              <label className="block text-xs font-medium text-slate-700">
                Connection name
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Primary GL Feed"
                  className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              </label>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-xs font-medium text-slate-700">
                External workbook / realm / tenant ID
                <input
                  type="text"
                  value={externalRef}
                  onChange={(event) => setExternalRef(event.target.value)}
                  placeholder="sheet-id or realm-id"
                  className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
                />
              </label>
              <label className="block text-xs font-medium text-slate-700">
                OAuth / credential token (write-only)
                <input
                  type="password"
                  value={credentialSecret}
                  onChange={(event) => setCredentialSecret(event.target.value)}
                  placeholder="Stored hashed server-side"
                  className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={busy !== null}
              className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:bg-slate-400"
            >
              {busy === 'create' ? 'Saving connector...' : 'Save Connector'}
            </button>
          </form>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void runSync();
            }}
            className="space-y-3 rounded border border-slate-200 bg-white p-4"
          >
            <h3 className="text-sm font-semibold text-slate-900">Execute adapter sync run</h3>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="block text-xs font-medium text-slate-700">
                Configured connector
                <select
                  aria-label="Select configured connector"
                  value={selectedConnectorId}
                  onChange={(event) => setSelectedConnectorId(event.target.value)}
                  disabled={(overview?.connectors.length ?? 0) === 0}
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                >
                  {(overview?.connectors.length ?? 0) === 0 && <option value="">None configured</option>}
                  {(overview?.connectors ?? []).map((conn) => (
                    <option key={conn.id} value={conn.id}>
                      {conn.name} ({sourceSystemLabel(conn.sourceSystem)})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-slate-700">
                Sync mode
                <select
                  aria-label="Sync mode"
                  value={syncMode}
                  onChange={(event) => setSyncMode(event.target.value as SyncMode)}
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                >
                  <option value="incremental">Incremental</option>
                  <option value="full_repull">Full re-pull (atomic replace)</option>
                </select>
              </label>
              <label className="block text-xs font-medium text-slate-700">
                Sync cursor
                <input
                  type="text"
                  value={cursorDraft}
                  onChange={(event) => setCursorDraft(event.target.value)}
                  placeholder="2026-04-30"
                  className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
                />
              </label>
            </div>
            <div>
              <label htmlFor="connector-payload-file" className="block text-xs font-medium text-slate-700">
                Upload JSON adapter export (optional)
              </label>
              <input
                id="connector-payload-file"
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void file.text().then((text) => setPayloadDraft(text));
                }}
                className="mt-1 block w-full text-xs text-slate-700 file:mr-3 file:rounded file:border-0 file:bg-slate-900 file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-white"
              />
            </div>
            <label className="block text-xs font-medium text-slate-700">
              Adapter pull JSON payload
              <textarea
                rows={4}
                value={payloadDraft}
                onChange={(event) => setPayloadDraft(event.target.value)}
                placeholder={placeholderPayloadHint(selectedConnector?.sourceSystem ?? sourceSystem)}
                className="mt-1 w-full rounded border border-slate-300 p-2 font-mono text-xs"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={busy !== null || !selectedConnector}
                className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:bg-slate-400"
              >
                {busy === 'sync' ? 'Syncing...' : 'Run Sync & Reconcile'}
              </button>
              <button
                type="button"
                onClick={() => props.onNavigate('/model-grid')}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Open Model Grid
              </button>
            </div>
          </form>
        </div>
      )}

      {lastSync !== null && (
        <div
          className={`rounded border p-3 text-xs space-y-2 ${
            lastSync.run.status === 'quarantined'
              ? 'border-amber-300 bg-amber-50 text-amber-950'
              : 'border-emerald-300 bg-emerald-50 text-emerald-950'
          }`}
        >
          <p className="font-semibold">
            Last sync: {lastSync.connector.name} · {lastSync.run.status} ({lastSync.run.reconciliationStatus})
          </p>
          <p className="font-mono">
            pulled {lastSync.run.rowsPulled} · imported {lastSync.run.rowsImported} · quarantined{' '}
            {lastSync.run.rowsQuarantined} · debits {lastSync.run.totalDebits} · credits{' '}
            {lastSync.run.totalCredits}
            {lastSync.run.replacedRunId ? ` · replaced run ${lastSync.run.replacedRunId.slice(0, 8)}…` : ''}
          </p>
          {lastSync.run.reconciliationReason && (
            <p className="font-mono text-amber-900">reason: {lastSync.run.reconciliationReason}</p>
          )}
        </div>
      )}

      {recentRuns.length > 0 && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <caption className="sr-only">Connector sync run ledger</caption>
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2">Connector</th>
                <th className="px-3 py-2">Mode</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Reconciliation</th>
                <th className="px-3 py-2 text-right">Pulled / Imp / Quar</th>
                <th className="px-3 py-2 text-right">Debits</th>
                <th className="px-3 py-2 text-right">Credits</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentRuns.map((run) => (
                <tr key={run.id}>
                  <td className="px-3 py-1.5 font-medium text-slate-900">
                    {run.connectorName} ({sourceSystemLabel(run.sourceSystem)})
                  </td>
                  <td className="px-3 py-1.5 font-mono">{run.mode}</td>
                  <td className="px-3 py-1.5 font-mono">{run.status}</td>
                  <td className="px-3 py-1.5 font-mono">
                    {run.reconciliationStatus}
                    {run.reconciliationReason ? `: ${run.reconciliationReason}` : ''}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    {run.rowsPulled} / {run.rowsImported} / {run.rowsQuarantined}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">{run.totalDebits}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{run.totalCredits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
