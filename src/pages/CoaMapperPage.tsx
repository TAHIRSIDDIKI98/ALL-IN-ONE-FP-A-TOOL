import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { SpineRoutePath } from '../../shared/spine.js';
import type {
  ApplyIndustryPackResponse,
  IndustryPackDetail,
  IndustryPackKey,
} from '../../shared/packs.js';
import {
  ApiClientError,
  createApiClient,
  type ChartAccountPayload,
  type ChartImportPayload,
  type ChartOfAccountsPayload,
  type CoaMappingEditPayload,
  type CoaMappingEntryPayload,
  type CoaMappingQuarantineReason,
  type CoaMappingReportPayload,
} from '../api/client.js';
import { EmptyState, ErrorState, LoadingState, PartialBanner } from '../components/StateFrame.js';
import { useWorkspaceStore } from '../state/workspaceStore.js';
import type { SpinePageProps } from './SignInPage.js';

type MapperAction = 'load' | 'import' | 'loadMapping' | 'commitMapping' | 'applyPack';
type DraftStatus = 'mapped' | 'quarantined' | 'unmapped';
type QuarantineReason = CoaMappingQuarantineReason;

interface MapperFailure {
  readonly code: string;
  readonly message: string;
  readonly action: MapperAction;
}

interface MappingDraft {
  readonly status: DraftStatus;
  readonly accountCode: string | null;
  readonly reason: QuarantineReason | null;
}

const REASONS: readonly QuarantineReason[] = [
  'MANUAL_QUARANTINE',
  'NO_TARGET_ACCOUNT',
  'AMBIGUOUS_TARGET',
];

const CHART_TEMPLATE = [
  'code,name,type,normal_side,statement_line_key,parent_code,is_postable',
  '1000,Operating bank account,asset,debit,bs.asset.cash,,true',
  '1100,Accounts receivable,asset,debit,bs.asset.ar,,true',
  '2000,Accounts payable,liability,credit,bs.liability.ap,,true',
  '3000,Common stock,equity,credit,bs.equity.common_stock,,true',
  '4000,Service revenue,revenue,credit,pl.revenue.service,,true',
  '5000,Cost of goods sold,expense,debit,pl.cogs.direct,,true',
  '6000,Payroll expense,expense,debit,pl.opex.payroll,,true',
].join('\n');

function toFailure(error: unknown, action: MapperAction): MapperFailure {
  if (error instanceof ApiClientError) {
    const issues = error.details['issues'];
    const issueText = Array.isArray(issues)
      ? ` ${issues.filter((issue): issue is string => typeof issue === 'string').join('; ')}`
      : '';
    return { code: error.code, message: `${error.message}${issueText}`, action };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : 'The chart of accounts could not be read.',
    action,
  };
}

function createDrafts(entries: readonly CoaMappingEntryPayload[]): Readonly<Record<string, MappingDraft>> {
  const drafts: Record<string, MappingDraft> = {};
  for (const entry of entries) {
    drafts[entry.sourceCode] =
      entry.status === 'mapped'
        ? { status: 'mapped', accountCode: entry.accountCode, reason: null }
        : entry.status === 'quarantined'
          ? { status: 'quarantined', accountCode: null, reason: entry.quarantineReason ?? 'MANUAL_QUARANTINE' }
          : { status: 'unmapped', accountCode: null, reason: null };
  }
  return drafts;
}


/** Presentational mapping editor, exported so its five-state contract is directly testable. */
export function CoaMappingEditor(props: {
  readonly report: CoaMappingReportPayload | null;
  readonly accounts: readonly ChartAccountPayload[];
  readonly drafts: Readonly<Record<string, MappingDraft>>;
  readonly notice: string | null;
  readonly commitResult: { readonly written: number; readonly unchanged: number } | null;
  readonly onChange: (sourceCode: string, next: MappingDraft) => void;
  readonly onAcceptAuto: () => void;
  readonly onQuarantineUnmapped: () => void;
  readonly onSave: () => void;
  readonly onReload: () => void;
  readonly onNavigate: (path: SpineRoutePath) => void;
}): ReactElement {
  const { report, accounts, drafts, notice, commitResult } = props;
  const entries = report?.mappings ?? [];
  const onChange = props.onChange;
  const onAcceptAuto = props.onAcceptAuto;
  const onQuarantineUnmapped = props.onQuarantineUnmapped;
  const onSave = props.onSave;
  const onReload = props.onReload;
  const onNavigate = props.onNavigate;
  return (
  <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Source → account mapping</h2>
        <p className="text-sm text-slate-600">
          {report === null
            ? 'The mapping report could not be read.'
            : `${entries.length} source code(s) discovered · ${report.mappedCount} mapped · ${report.quarantinedCount} quarantined · ${report.unmappedCount} unmapped`}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onAcceptAuto}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Accept all auto (exact code matches)
        </button>
        <button
          type="button"
          onClick={onQuarantineUnmapped}
          className="rounded border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-50"
        >
          Quarantine unmapped
        </button>
      </div>
    </div>

    {notice !== null && (
      <p role="status" className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
        {notice}
      </p>
    )}

    {commitResult !== null && (
      <p role="status" className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950">
        Mapping versions written: {commitResult.written}; unchanged: {commitResult.unchanged}. Every
        real edit is chained into the company audit log.
      </p>
    )}

    {report === null ? (
      <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-900">
        <p>The mapping report could not be read. No mapping was changed or invented.</p>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => onNavigate('/import')}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Go to Import Wizard
          </button>
        </div>
      </div>
    ) : entries.length === 0 ? (
      <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <p>
          No source codes have been imported yet, so there is nothing to map. Import a ledger
          file first; its source codes are retained with exact row counts and reasons.
        </p>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => onNavigate('/import')}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Go to Import Wizard
          </button>
        </div>
      </div>
    ) : (
      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <caption className="sr-only">Discovered source codes and their versioned mappings</caption>
          <thead className="bg-slate-50 text-left font-medium text-slate-700">
            <tr>
              <th scope="col" className="px-3 py-2">Source code</th>
              <th scope="col" className="px-3 py-2 text-right">Rows</th>
              <th scope="col" className="px-3 py-2">Sample values</th>
              <th scope="col" className="px-3 py-2">Current state</th>
              <th scope="col" className="px-3 py-2">Target / reason</th>
              <th scope="col" className="px-3 py-2">Version</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {entries.map((entry) => {
              const draft = drafts[entry.sourceCode] ?? {
                status: 'unmapped' as const,
                accountCode: null,
                reason: null,
              };
              return (
                <tr key={entry.sourceCode}>
                  <td className="px-3 py-2 font-mono">
                    {entry.sourceCode}
                    {entry.targetConflict ? (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
                        shared target
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{entry.rowCount}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {entry.sampleValues.length > 0 ? entry.sampleValues.join('; ') : 'none in retained rows'}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        draft.status === 'quarantined'
                          ? 'rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-900'
                          : draft.status === 'mapped'
                            ? 'rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-900'
                            : 'rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-700'
                      }
                    >
                      {draft.status === 'unmapped' ? entry.status : draft.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <label className="sr-only" htmlFor={`target-${entry.sourceCode}`}>
                        Target account for {entry.sourceCode}
                      </label>
                      <select
                        id={`target-${entry.sourceCode}`}
                        value={draft.accountCode ?? ''}
                        onChange={(event) =>
                          onChange(entry.sourceCode, {
                            status: event.target.value === '' ? 'unmapped' : 'mapped',
                            accountCode: event.target.value === '' ? null : event.target.value,
                            reason: null,
                          })
                        }
                        className="rounded border border-slate-300 px-2 py-1 text-xs"
                      >
                        <option value="">Not mapped</option>
                        {accounts.map((account) => (
                          <option key={account.code} value={account.code}>
                            {account.code} — {account.name}
                          </option>
                        ))}
                      </select>
                      {draft.status !== 'mapped' ? (
                        <select
                          aria-label={`Quarantine reason for ${entry.sourceCode}`}
                          value={draft.reason ?? 'MANUAL_QUARANTINE'}
                          onChange={(event) =>
                            onChange(entry.sourceCode, {
                              status: 'quarantined',
                              accountCode: null,
                              reason: event.target.value as QuarantineReason,
                            })
                          }
                          className="rounded border border-slate-300 px-2 py-1 text-xs"
                        >
                          {REASONS.map((reason) => (
                            <option key={reason} value={reason}>
                              {reason}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {entry.mappingVersion === 0
                      ? 'none'
                      : `${entry.mappingVersion} (${entry.effectiveFrom})`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}

    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onSave}
        className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
      >
        Save mapping versions
      </button>
      <button
        type="button"
        onClick={onReload}
        className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        Reload mappings
      </button>
    </div>
  </div>
  );
}

/** Data-only industry pack catalog & applicator panel inside CoaMapperPage (§6.6, DEC-015). */
export function IndustryPackCatalogPanel(props: {
  readonly packs: readonly IndustryPackDetail[];
  readonly selectedKey: IndustryPackKey | null;
  readonly appliedResult: ApplyIndustryPackResponse | null;
  readonly onSelect: (key: IndustryPackKey) => void;
  readonly onApply: (key: IndustryPackKey) => void;
}): ReactElement {
  const { packs, selectedKey, appliedResult, onSelect, onApply } = props;
  const activePack = packs.find((p) => p.key === selectedKey) ?? packs[0] ?? null;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Data-only industry pack templates (M2)
          </h2>
          <p className="text-xs text-slate-600">
            Schema-validated metadata bundles (CoA, KPI benchmarks, driver templates). Zero executable scripts.
          </p>
        </div>
        {appliedResult !== null ? (
          <p
            role="status"
            className="rounded border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-950"
          >
            Applied {appliedResult.packKey} v{appliedResult.packVersion}: {appliedResult.inserted} created,{' '}
            {appliedResult.updated} updated.
          </p>
        ) : null}
      </div>

      {packs.length === 0 ? (
        <p className="text-xs text-slate-600">No verified industry packs were loaded for this workspace.</p>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            {packs.map((pack) => {
              const selected = activePack?.key === pack.key;
              return (
                <div
                  key={pack.key}
                  className={
                    selected
                      ? 'rounded border-2 border-slate-900 bg-white p-3 space-y-2'
                      : 'rounded border border-slate-200 bg-white p-3 space-y-2'
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{pack.name}</p>
                      <p className="font-mono text-[11px] text-slate-500">
                        {pack.key} v{pack.version} · {pack.defaultCalendar} · {pack.defaultCurrencyHint}
                      </p>
                    </div>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                      DATA-ONLY
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">{pack.description}</p>
                  <p className="font-mono text-[11px] text-slate-700">
                    {pack.accounts.length} accounts · {pack.kpis.length} KPIs · {pack.drivers.length} drivers
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => onSelect(pack.key)}
                      className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {selected ? 'Inspecting' : 'Inspect pack'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onApply(pack.key)}
                      className="rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800"
                    >
                      Apply {pack.name} chart
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {activePack !== null ? (
            <div className="rounded border border-slate-200 bg-white p-3 space-y-2">
              <p className="text-xs font-semibold text-slate-900">
                {activePack.name} preview ({activePack.accounts.length} compiled chart accounts &amp;{' '}
                {activePack.kpis.length} KPIs)
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <ul className="space-y-1 text-xs text-slate-700">
                  {activePack.accounts.map((acc) => (
                    <li key={acc.code} className="font-mono">
                      {acc.code} — {acc.name} ({acc.type} · {acc.statementLineKey})
                    </li>
                  ))}
                </ul>
                <ul className="space-y-1 text-xs text-slate-700">
                  {activePack.kpis.map((kpi) => (
                    <li key={kpi.key}>
                      <span className="font-medium text-slate-900">{kpi.name}</span> · target{' '}
                      <span className="font-mono">{kpi.targetValue}</span> ·{' '}
                      <span className="font-mono text-[11px] text-slate-600">{kpi.formula}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Chart-of-Accounts + source mapping screen (MASTER_PROMPT §9.3.4; Spine Gates G1/G10).
 *
 * The chart is the target side; `coa_mapping` is the versioned SOURCE side. Source codes come from
 * retained import rows, never from invented demo values. Every control writes a real versioned
 * mapping, an explicit typed quarantine, or navigates to the import wizard.
 */
export default function CoaMapperPage({ onNavigate, forcedState }: SpinePageProps): ReactElement {
  const { company, authToken } = useWorkspaceStore();
  const companyId = company?.id ?? null;

  const [chart, setChart] = useState<ChartOfAccountsPayload | null>(null);
  const [mapping, setMapping] = useState<CoaMappingReportPayload | null>(null);
  const [packs, setPacks] = useState<readonly IndustryPackDetail[]>([]);
  const [selectedPackKey, setSelectedPackKey] = useState<IndustryPackKey | null>('saas');
  const [appliedPack, setAppliedPack] = useState<ApplyIndustryPackResponse | null>(null);
  const [drafts, setDrafts] = useState<Readonly<Record<string, MappingDraft>>>({});
  const [csvDraft, setCsvDraft] = useState('');
  const [imported, setImported] = useState<ChartImportPayload | null>(null);
  const [commitResult, setCommitResult] = useState<{ written: number; unchanged: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<MapperAction | null>(null);
  const [failure, setFailure] = useState<MapperFailure | null>(null);

  const loadMapper = useCallback(async (): Promise<void> => {
    if (companyId === null || authToken === null) return;
    setBusy('load');
    setFailure(null);
    try {
      const client = createApiClient({ getToken: () => authToken });
      const [chartReport, mappingReport, packsCatalog] = await Promise.all([
        client.getChart(companyId),
        client.getCoaMappings(companyId),
        client.listIndustryPacks(companyId),
      ]);
      setChart(chartReport);
      setMapping(mappingReport);
      setPacks(packsCatalog.packs);
      setDrafts(createDrafts(mappingReport.mappings));
    } catch (error) {
      setFailure(toFailure(error, 'load'));
    } finally {
      setBusy(null);
    }
  }, [authToken, companyId]);

  const loadMapping = useCallback(async (): Promise<void> => {
    if (companyId === null || authToken === null) return;
    setBusy('loadMapping');
    setFailure(null);
    try {
      const report = await createApiClient({ getToken: () => authToken }).getCoaMappings(companyId);
      setMapping(report);
      setDrafts(createDrafts(report.mappings));
    } catch (error) {
      setFailure(toFailure(error, 'loadMapping'));
    } finally {
      setBusy(null);
    }
  }, [authToken, companyId]);

  useEffect(() => {
    if (companyId === null || authToken === null) return;
    void loadMapper();
  }, [authToken, companyId, loadMapper]);

  const runImport = useCallback(async (): Promise<void> => {
    if (companyId === null || authToken === null) return;
    if (csvDraft.trim().length === 0) {
      setFailure({
        code: 'IMPORT_FILE_UNREADABLE',
        message: 'Paste or choose a chart-of-accounts CSV before importing.',
        action: 'import',
      });
      return;
    }
    setBusy('import');
    setFailure(null);
    try {
      const result = await createApiClient({ getToken: () => authToken }).importChart(companyId, {
        csvText: csvDraft,
      });
      setChart({ companyId: result.companyId, accounts: result.accounts });
      setImported(result);
      await loadMapping();
    } catch (error) {
      setFailure(toFailure(error, 'import'));
    } finally {
      setBusy(null);
    }
  }, [authToken, companyId, csvDraft, loadMapping]);

  const applyPack = useCallback(
    async (packKey: IndustryPackKey): Promise<void> => {
      if (companyId === null || authToken === null) return;
      setBusy('applyPack');
      setFailure(null);
      try {
        const result = await createApiClient({ getToken: () => authToken }).applyIndustryPack(
          companyId,
          packKey,
        );
        setSelectedPackKey(packKey);
        setAppliedPack(result);
        setChart({ companyId: result.companyId, accounts: result.accounts });
        await loadMapping();
      } catch (error) {
        setFailure(toFailure(error, 'applyPack'));
      } finally {
        setBusy(null);
      }
    },
    [authToken, companyId, loadMapping],
  );

  const changeDraft = (sourceCode: string, next: MappingDraft): void => {
    setDrafts((current) => ({ ...current, [sourceCode]: next }));
    setNotice(null);
  };

  const acceptAutoMappings = (): void => {
    if (mapping === null) return;
    const accounts: readonly ChartAccountPayload[] = chart?.accounts ?? [];
    let matched = 0;
    const next: Record<string, MappingDraft> = { ...drafts };
    for (const entry of mapping.mappings) {
      const current = drafts[entry.sourceCode];
      if (current?.status !== 'unmapped') continue;
      const exact = accounts.find((account) => account.code.toUpperCase() === entry.sourceCode.trim().toUpperCase());
      if (exact === undefined) continue;
      next[entry.sourceCode] = { status: 'mapped', accountCode: exact.code, reason: null };
      matched += 1;
    }
    setDrafts(next);
    setNotice(
      matched === 0
        ? 'No unmapped source code has an exact chart-code match; choose a target or an explicit reason.'
        : `${matched} source code(s) matched a chart code exactly. Review the targets and save to version them.`,
    );
  };

  const quarantineUnmapped = (): void => {
    if (mapping === null) return;
    let marked = 0;
    const next: Record<string, MappingDraft> = { ...drafts };
    for (const entry of mapping.mappings) {
      if (drafts[entry.sourceCode]?.status !== 'unmapped') continue;
      next[entry.sourceCode] = { status: 'quarantined', accountCode: null, reason: 'MANUAL_QUARANTINE' };
      marked += 1;
    }
    setDrafts(next);
    setNotice(
      marked === 0
        ? 'There are no unmapped source codes to quarantine.'
        : `${marked} source code(s) are marked for explicit quarantine; save to version them.`,
    );
  };

  const saveMappings = useCallback(async (): Promise<void> => {
    if (companyId === null || authToken === null || mapping === null) return;
    const entries: CoaMappingEditPayload[] = mapping.mappings.flatMap((entry) => {
      const draft = drafts[entry.sourceCode];
      if (draft === undefined || draft.status === 'unmapped') return [];
      return [
        {
          sourceCode: entry.sourceCode,
          status: draft.status,
          accountCode: draft.status === 'mapped' ? draft.accountCode : null,
          quarantineReason: draft.status === 'quarantined' ? draft.reason : null,
        },
      ];
    });
    if (entries.length === 0) {
      setFailure({
        code: 'VALIDATION_FAILED',
        message: 'Choose a target account or an explicit quarantine reason for at least one source code.',
        action: 'commitMapping',
      });
      return;
    }
    setBusy('commitMapping');
    setFailure(null);
    try {
      const result = await createApiClient({ getToken: () => authToken }).commitCoaMappings(companyId, {
        entries,
      });
      setMapping(result.report);
      setDrafts(createDrafts(result.report.mappings));
      setCommitResult({ written: result.written, unchanged: result.unchanged });
      setNotice(null);
    } catch (error) {
      setFailure(toFailure(error, 'commitMapping'));
    } finally {
      setBusy(null);
    }
  }, [authToken, companyId, drafts, mapping]);

  const retryFailedAction = (): void => {
    if (failure?.action === 'import') void runImport();
    else if (failure?.action === 'commitMapping') void saveMappings();
    else if (failure?.action === 'loadMapping') void loadMapping();
    else if (failure?.action === 'applyPack' && selectedPackKey !== null) void applyPack(selectedPackKey);
    else void loadMapper();
  };

  const navigate = (path: SpineRoutePath): void => onNavigate(path);

  const busyLabel =
    busy === 'import'
      ? 'Validating and importing the chart of accounts in one transaction...'
      : busy === 'applyPack'
        ? 'Applying validated industry pack chart accounts in one transaction...'
        : busy === 'commitMapping'
          ? 'Writing mapping versions and their audit entry in one transaction...'
          : busy === 'loadMapping'
            ? 'Loading the discovered source codes and mapping versions...'
            : 'Loading the chart and versioned mappings...';

  if (forcedState === 'loading' || busy !== null) {
    return <LoadingState label={busyLabel} />;
  }

  if (forcedState === 'error' || failure !== null) {
    return (
      <ErrorState
        title="Chart of Accounts Mapper"
        code={failure?.code ?? 'MAP_TARGET_INVALID'}
        message={failure?.message ?? 'The chart of accounts could not be read.'}
        onRetry={retryFailedAction}
      />
    );
  }

  if (companyId === null || authToken === null) {
    return (
      <EmptyState
        title="Chart of Accounts Mapper"
        disclosure="Sign in and create a company workspace before loading a chart of accounts; only accounts in this chart can receive imported postings."
        ctaLabel="Go to Sign In"
        ctaPath="/sign-in"
        onNavigate={navigate}
      />
    );
  }

  if (forcedState === 'empty' || chart === null || chart.accounts.length === 0) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
        <h1 className="text-xl font-semibold text-slate-900">Chart of Accounts Mapper</h1>
        <p className="text-sm text-slate-600">
          This company has no chart of accounts yet, so every imported account code would be
          quarantined as unmapped. Import a chart CSV or apply one of the verified M2 industry pack
          baselines below so postings have canonical target accounts.
        </p>
        <IndustryPackCatalogPanel
          packs={packs}
          selectedKey={selectedPackKey}
          appliedResult={appliedPack}
          onSelect={(key) => setSelectedPackKey(key)}
          onApply={(key) => void applyPack(key)}
        />
        <div className="space-y-2">
          <label htmlFor="chart-file" className="block text-sm font-medium text-slate-700">
            Chart CSV file
          </label>
          <input
            id="chart-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void file.text().then((text) => setCsvDraft(text));
            }}
            className="block w-full text-sm text-slate-700 file:mr-4 file:rounded file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
          />
          <label htmlFor="chart-csv" className="block text-sm font-medium text-slate-700">
            Chart CSV payload
          </label>
          <textarea
            id="chart-csv"
            rows={7}
            value={csvDraft}
            onChange={(event) => setCsvDraft(event.target.value)}
            placeholder={CHART_TEMPLATE}
            className="w-full rounded border border-slate-300 p-3 font-mono text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void runImport()}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Import Chart of Accounts
            </button>
            <button
              type="button"
              onClick={() => setCsvDraft(CHART_TEMPLATE)}
              className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Fill with the documented header
            </button>
          </div>
        </div>
      </section>
    );
  }

  const accounts: readonly ChartAccountPayload[] = chart.accounts;
  const entries = mapping?.mappings ?? [];
  const showPartial =
    forcedState === 'partial' ||
    (mapping !== undefined &&
      mapping !== null &&
      (mapping.unmappedCount > 0 || mapping.conflictCount > 0));

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Chart of Accounts Mapper</h1>
          <p className="mt-1 text-sm text-slate-600">
            {accounts.length} account(s) · only these codes can receive postings. Source codes are
            discovered from real import rows and mapped to this chart with versioned, audited edits.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => navigate('/import')}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Import Ledger Data
          </button>
          <button
            type="button"
            onClick={() => void loadMapper()}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Reload Mapper
          </button>
        </div>
      </div>

      {imported !== null && (
        <div className="rounded border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950">
          <p className="font-semibold">
            Chart imported: {imported.inserted} created, {imported.updated} updated out of{' '}
            {imported.rowCount} row(s).
          </p>
          <p className="mt-1 text-xs">
            Re-importing the same file updates accounts in place (never duplicates) and every write
            is chained into the company audit log.
          </p>
        </div>
      )}

      {showPartial && (
        <PartialBanner
          detail={
            mapping === null || mapping === undefined
              ? 'The mapping report is not available yet. No mapping was changed.'
              : `${mapping.unmappedCount} source code(s) have no mapping; ${mapping.conflictCount} share a target account. Unmapped rows stay quarantined until you save an explicit mapping or reason.`
          }
        />
      )}

      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <caption className="sr-only">Chart of accounts, ordered by account code</caption>
          <thead className="bg-slate-50 text-left font-medium text-slate-700">
            <tr>
              <th scope="col" className="px-3 py-2">Code</th>
              <th scope="col" className="px-3 py-2">Name</th>
              <th scope="col" className="px-3 py-2">Type</th>
              <th scope="col" className="px-3 py-2">Normal side</th>
              <th scope="col" className="px-3 py-2">Statement line</th>
              <th scope="col" className="px-3 py-2">Parent</th>
              <th scope="col" className="px-3 py-2 text-right">Version</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {accounts.map((account) => (
              <tr key={account.code}>
                <td className="px-3 py-2 font-mono">{account.code}</td>
                <td className="px-3 py-2">
                  {account.name}
                  {account.isContra ? (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
                      contra
                    </span>
                  ) : null}
                  {!account.isPostable ? (
                    <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
                      non-postable
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-slate-600">{account.type}</td>
                <td className="px-3 py-2 text-slate-600">{account.normalSide}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600">
                  {account.statementLineKey}
                </td>
                <td className="px-3 py-2 font-mono">{account.parentCode ?? '—'}</td>
                <td className="px-3 py-2 text-right font-mono">{account.version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CoaMappingEditor
        report={mapping}
        accounts={accounts}
        drafts={drafts}
        notice={notice}
        commitResult={commitResult}
        onChange={changeDraft}
        onAcceptAuto={acceptAutoMappings}
        onQuarantineUnmapped={quarantineUnmapped}
        onSave={() => void saveMappings()}
        onReload={() => void loadMapping()}
        onNavigate={navigate}
      />
      <IndustryPackCatalogPanel
        packs={packs}
        selectedKey={selectedPackKey}
        appliedResult={appliedPack}
        onSelect={(key) => setSelectedPackKey(key)}
        onApply={(key) => void applyPack(key)}
      />
      <div className="space-y-2">
        <label htmlFor="chart-csv-more" className="block text-sm font-medium text-slate-700">
          Add or rename accounts (CSV import)
        </label>
        <textarea
          id="chart-csv-more"
          rows={5}
          value={csvDraft}
          onChange={(event) => setCsvDraft(event.target.value)}
          placeholder={CHART_TEMPLATE}
          className="w-full rounded border border-slate-300 p-3 font-mono text-xs"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runImport()}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Import Chart CSV
          </button>
          <button
            type="button"
            onClick={() => setCsvDraft(CHART_TEMPLATE)}
            className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Fill with the documented header
          </button>
        </div>
      </div>
    </section>
  );
}
