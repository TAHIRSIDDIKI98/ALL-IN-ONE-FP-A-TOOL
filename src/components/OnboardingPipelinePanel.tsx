import { useCallback, useState, type ReactElement } from 'react';
import { buildSyntheticPartnerDataset } from '../../core/onboarding/index.js';
import type { CoaMappingEditPayload } from '../../shared/coaMapping.js';
import type { SpineRoutePath } from '../../shared/spine.js';
import {
  ApiClientError,
  createApiClient,
  type OnboardingRehearseMode,
  type OnboardingRehearseResponse,
  type OnboardingValidationReport,
} from '../api/client.js';
import { InlineEmptyState, InlineErrorState, PartialBanner } from './StateFrame.js';

type PanelState = 'empty' | 'loading' | 'error' | 'populated';
type OnboardingAction = 'validate' | 'approve' | 'rehearse';

interface PanelFailure {
  readonly code: string;
  readonly message: string;
  readonly action: OnboardingAction;
}

function toFailure(error: unknown, action: OnboardingAction): PanelFailure {
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
    message:
      error instanceof Error ? error.message : 'The onboarding pipeline action could not be completed.',
    action,
  };
}

function createSelectionDrafts(
  report: OnboardingValidationReport,
): Readonly<Record<string, string>> {
  const next: Record<string, string> = {};
  for (const sug of report.suggestions) {
    if (sug.currentStatus === 'mapped' && sug.currentAccountCode !== null) {
      next[sug.sourceCode] = sug.currentAccountCode;
    } else if (sug.suggestedAccountCode !== null) {
      next[sug.sourceCode] = sug.suggestedAccountCode;
    } else {
      next[sug.sourceCode] = '';
    }
  }
  return next;
}

function matchRuleLabel(rule: OnboardingValidationReport['suggestions'][number]['matchRule']): string {
  switch (rule) {
    case 'already_mapped':
      return 'Confirmed mapping';
    case 'already_quarantined':
      return 'Quarantined';
    case 'exact_code':
      return 'Exact code (100%)';
    case 'leading_zero_alias':
      return 'Leading-zero alias (85%)';
    case 'token_name_match':
      return 'Keyword match';
    case 'ambiguous_leading_zero':
      return 'Ambiguous leading zeros';
    case 'ambiguous_token_match':
      return 'Ambiguous keyword match';
    case 'unmatched':
      return 'No deterministic match';
  }
}

/**
 * M2 Customer Onboarding & Data Migration Pipeline Panel (§11.12, ONB1–ONB3).
 *
 * - Runs inside `/import` (DEC-015) using the single canonical server classifier.
 * - Assisted CoA matching is 100% deterministic at M2 and requires explicit human approval.
 * - Rehearsal runs both non-destructive dry-runs and repeatable atomic stage-commits.
 */
export function OnboardingPipelinePanel(props: {
  readonly companyId: string;
  readonly authToken: string;
  readonly onNavigate: (path: SpineRoutePath) => void;
  readonly initialState?: PanelState;
  readonly initialValidation?: OnboardingValidationReport | null;
  readonly initialRehearsals?: readonly OnboardingRehearseResponse[];
  readonly initialFailure?: PanelFailure | null;
}): ReactElement {
  const [state, setState] = useState<PanelState>(
    props.initialState ?? (props.initialValidation ? 'populated' : 'empty'),
  );
  const [csvDraft, setCsvDraft] = useState('');
  const [sourceFilename, setSourceFilename] = useState('partner-cutover.csv');
  const [validation, setValidation] = useState<OnboardingValidationReport | null>(
    props.initialValidation ?? null,
  );
  const [draftTargets, setDraftTargets] = useState<Readonly<Record<string, string>>>(() =>
    props.initialValidation ? createSelectionDrafts(props.initialValidation) : {},
  );
  const [rehearsals, setRehearsals] = useState<readonly OnboardingRehearseResponse[]>(
    props.initialRehearsals ?? [],
  );
  const [busy, setBusy] = useState<OnboardingAction | null>(null);
  const [failure, setFailure] = useState<PanelFailure | null>(props.initialFailure ?? null);
  const [approvalNotice, setApprovalNotice] = useState<string | null>(null);

  const client = useCallback(
    () => createApiClient({ getToken: () => props.authToken }),
    [props.authToken],
  );

  const loadSyntheticPartner = (): void => {
    const fixture = buildSyntheticPartnerDataset();
    setSourceFilename(fixture.sourceFilename);
    setCsvDraft(fixture.csvText);
    setValidation(null);
    setApprovalNotice(null);
    setFailure(null);
    setState('empty');
  };

  const runValidate = useCallback(async (): Promise<void> => {
    if (csvDraft.trim().length === 0) {
      setFailure({
        code: 'IMPORT_FILE_UNREADABLE',
        message: 'Paste a partner CSV export or load the synthetic partner dataset before validating.',
        action: 'validate',
      });
      setState('error');
      return;
    }
    setBusy('validate');
    setState('loading');
    setFailure(null);
    setApprovalNotice(null);
    try {
      const report = await client().validateOnboarding(props.companyId, { csvText: csvDraft });
      setValidation(report);
      setDraftTargets(createSelectionDrafts(report));
      setState('populated');
    } catch (error) {
      setFailure(toFailure(error, 'validate'));
      setState('error');
    } finally {
      setBusy(null);
    }
  }, [client, csvDraft, props.companyId]);

  const runApproveMappings = useCallback(async (): Promise<void> => {
    if (validation === null) return;
    const entries: CoaMappingEditPayload[] = [];
    for (const sug of validation.suggestions) {
      const chosen = draftTargets[sug.sourceCode] ?? '';
      if (chosen.trim().length === 0) continue;
      entries.push({
        sourceCode: sug.sourceCode,
        status: 'mapped',
        accountCode: chosen.trim(),
        quarantineReason: null,
      });
    }
    if (entries.length === 0) {
      setFailure({
        code: 'VALIDATION_FAILED',
        message: 'Select at least one target CoA account before approving mapping versions.',
        action: 'approve',
      });
      setState('error');
      return;
    }

    setBusy('approve');
    setState('loading');
    setFailure(null);
    try {
      const result = await client().approveOnboardingMappings(props.companyId, {
        csvText: csvDraft,
        entries,
      });
      setValidation(result.validation);
      setDraftTargets(createSelectionDrafts(result.validation));
      setApprovalNotice(
        `Approved CoA mappings: ${result.written} new version(s) committed, ${result.unchanged} unchanged.`,
      );
      setState('populated');
    } catch (error) {
      setFailure(toFailure(error, 'approve'));
      setState('error');
    } finally {
      setBusy(null);
    }
  }, [client, csvDraft, draftTargets, props.companyId, validation]);

  const runRehearsal = useCallback(
    async (mode: OnboardingRehearseMode): Promise<void> => {
      if (csvDraft.trim().length === 0) {
        setFailure({
          code: 'IMPORT_FILE_UNREADABLE',
          message: 'Provide a CSV migration payload before running a cutover rehearsal.',
          action: 'rehearse',
        });
        setState('error');
        return;
      }
      setBusy('rehearse');
      setState('loading');
      setFailure(null);
      try {
        const result = await client().rehearseOnboarding(props.companyId, {
          mode,
          sourceFilename:
            sourceFilename.trim().length === 0 ? 'partner-cutover.csv' : sourceFilename.trim(),
          csvText: csvDraft,
        });
        setValidation(result.validation);
        setDraftTargets(createSelectionDrafts(result.validation));
        setRehearsals((prev) => [result, ...prev]);
        setState('populated');
      } catch (error) {
        setFailure(toFailure(error, 'rehearse'));
        setState('error');
      } finally {
        setBusy(null);
      }
    },
    [client, csvDraft, props.companyId, sourceFilename],
  );

  const retry = (): void => {
    if (failure?.action === 'approve') void runApproveMappings();
    else if (failure?.action === 'rehearse') void runRehearsal('dry_run');
    else void runValidate();
  };

  const hasPartialDiagnostics =
    validation !== null &&
    (validation.quarantinedCount > 0 ||
      validation.goLiveStatus !== 'ready' ||
      validation.anomalies.length > 0);

  return (
    <section
      aria-labelledby="onboarding-pipeline-heading"
      className="space-y-4 rounded border border-slate-200 bg-slate-50 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="onboarding-pipeline-heading" className="text-base font-semibold text-slate-900">
            Customer Onboarding &amp; Data Migration Pipeline
          </h2>
          <p className="text-xs text-slate-600">
            Upload or load a partner ledger export, review deterministic CoA match suggestions with
            human approval, inspect row accounting and calendar gaps, and run repeatable cutover
            rehearsals before go-live.
          </p>
        </div>
        <button
          type="button"
          onClick={loadSyntheticPartner}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          Load Synthetic Partner Export
        </button>
      </div>

      {state === 'loading' && (
        <div role="status" aria-live="polite" className="text-sm text-slate-600">
          {busy === 'approve'
            ? 'Recording human-approved CoA mapping versions and re-validating migration...'
            : busy === 'rehearse'
              ? 'Executing repeatable cutover rehearsal and computing trial-balance fingerprint...'
              : 'Running deterministic CoA matching and row-accounting migration validation...'}
        </div>
      )}

      {state === 'error' && failure !== null && (
        <InlineErrorState code={failure.code} message={failure.message} onRetry={retry} />
      )}

      {state === 'empty' && validation === null && (
        <InlineEmptyState
          disclosure="No partner migration payload has been validated yet. Load the synthetic partner export or paste a CSV ledger file to verify exact row accounting before cutover."
          ctaLabel="Validate Partner Export"
          onAction={() => void runValidate()}
        />
      )}

      {state !== 'loading' && (
        <div className="space-y-3 rounded border border-slate-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="onboarding-file" className="block text-xs font-medium text-slate-700">
                Partner CSV file
              </label>
              <input
                id="onboarding-file"
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setSourceFilename(file.name);
                  void file.text().then((text) => {
                    setCsvDraft(text);
                    setValidation(null);
                    setApprovalNotice(null);
                    setState('empty');
                  });
                }}
                className="mt-1 block w-full text-xs text-slate-700 file:mr-3 file:rounded file:border-0 file:bg-slate-900 file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-white"
              />
            </div>
            <div>
              <label htmlFor="onboarding-source" className="block text-xs font-medium text-slate-700">
                Cutover batch filename
              </label>
              <input
                id="onboarding-source"
                type="text"
                value={sourceFilename}
                onChange={(event) => setSourceFilename(event.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
              />
            </div>
          </div>

          <div>
            <label htmlFor="onboarding-csv" className="block text-xs font-medium text-slate-700">
              Partner migration CSV payload
            </label>
            <textarea
              id="onboarding-csv"
              rows={5}
              value={csvDraft}
              onChange={(event) => {
                setCsvDraft(event.target.value);
                setValidation(null);
                setApprovalNotice(null);
              }}
              placeholder="entry_ref,date,account_code,description,debit,credit"
              className="mt-1 w-full rounded border border-slate-300 p-2 font-mono text-xs"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void runValidate()}
              className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:bg-slate-400"
            >
              Validate &amp; Suggest CoA Mappings
            </button>
            <button
              type="button"
              disabled={busy !== null || validation === null}
              onClick={() => void runRehearsal('dry_run')}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:text-slate-400"
            >
              Run Cutover Rehearsal (Dry-Run)
            </button>
            <button
              type="button"
              disabled={
                busy !== null || validation === null || validation.goLiveStatus === 'blocked'
              }
              onClick={() => void runRehearsal('stage_commit')}
              className="rounded border border-emerald-700 bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500"
            >
              Stage Atomic Cutover Rehearsal
            </button>
          </div>
        </div>
      )}

      {approvalNotice !== null && (
        <p
          role="status"
          className="rounded border border-emerald-300 bg-emerald-50 p-3 text-xs font-medium text-emerald-950"
        >
          {approvalNotice}
        </p>
      )}

      {hasPartialDiagnostics && (
        <PartialBanner
          detail={
            validation.goLiveStatus === 'blocked'
              ? `Migration go-live is blocked (${validation.blockers.length} blocker(s)): resolve unmapped CoA codes or unbalanced entries before staging commit.`
              : `Migration is ready with review items (${validation.quarantinedCount} quarantined row(s), ${validation.missingInteriorPeriods.length} period gap(s)). Review potential exceptions below.`
          }
        />
      )}

      {validation !== null && state !== 'loading' && (
        <div className="space-y-4">
          <div className="rounded border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">
                Validation report · Go-live status:{' '}
                <span className="font-mono uppercase">{validation.goLiveStatus}</span>
              </h3>
              <span className="font-mono text-xs text-slate-600">
                {validation.rowAccountingTies
                  ? 'Row accounting ties (importable + quarantined = rows in)'
                  : 'Row accounting MISMATCH'}
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-6">
              <div>
                <dt className="text-slate-500">Rows In</dt>
                <dd className="font-mono font-semibold">{validation.rowsIn}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Importable</dt>
                <dd className="font-mono font-semibold text-emerald-700">
                  {validation.importableCount}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Quarantined</dt>
                <dd className="font-mono font-semibold text-amber-800">
                  {validation.quarantinedCount}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Journal Entries</dt>
                <dd className="font-mono font-semibold">{validation.entryCount}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Posted Debits</dt>
                <dd className="font-mono font-semibold">{validation.totalDebits}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Posted Credits</dt>
                <dd className="font-mono font-semibold">{validation.totalCredits}</dd>
              </div>
            </dl>

            <div className="grid gap-3 text-xs sm:grid-cols-2">
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <p className="font-semibold text-slate-800">Period coverage &amp; gaps</p>
                <p className="mt-1 text-slate-600">
                  Covered:{' '}
                  <span className="font-mono">
                    {validation.coveredPeriods.length > 0
                      ? validation.coveredPeriods.join(', ')
                      : 'none'}
                  </span>
                </p>
                <p className="mt-1 text-slate-600">
                  Missing interior periods:{' '}
                  <span className="font-mono">
                    {validation.missingInteriorPeriods.length > 0
                      ? validation.missingInteriorPeriods.join(', ')
                      : 'none'}
                  </span>
                </p>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <p className="font-semibold text-slate-800">Anomalies &amp; blockers</p>
                {validation.anomalies.length === 0 ? (
                  <p className="mt-1 text-slate-600">No balance, gap, or outlier anomalies found.</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-slate-700">
                    {validation.anomalies.map((item) => (
                      <li key={`${item.kind}-${item.detail}`}>
                        <span className="font-mono font-semibold uppercase">[{item.severity}]</span>{' '}
                        {item.detail}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {validation.suggestions.length > 0 && (
            <div className="rounded border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Deterministic CoA mapping assistant (human approval required)
                  </h3>
                  <p className="text-xs text-slate-600">
                    Suggestions never auto-post. Review exact/alias/keyword targets and approve to
                    commit immutable versions in <span className="font-mono">coa_mapping</span>.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void runApproveMappings()}
                  className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:bg-slate-400"
                >
                  Approve Selected CoA Mappings
                </button>
              </div>

              <div className="overflow-x-auto rounded border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-xs">
                  <caption className="sr-only">
                    Deterministic onboarding CoA mapping suggestions
                  </caption>
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Source code</th>
                      <th className="px-3 py-2 text-right">Rows</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Match rule</th>
                      <th className="px-3 py-2">Target account (human confirm)</th>
                      <th className="px-3 py-2">Rationale</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {validation.suggestions.map((sug) => (
                      <tr key={sug.sourceCode}>
                        <td className="px-3 py-1.5 font-mono font-medium">{sug.sourceCode}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{sug.rowCount}</td>
                        <td className="px-3 py-1.5 font-mono">{sug.currentStatus}</td>
                        <td className="px-3 py-1.5">{matchRuleLabel(sug.matchRule)}</td>
                        <td className="px-3 py-1.5">
                          <select
                            aria-label={`Target account for ${sug.sourceCode}`}
                            value={draftTargets[sug.sourceCode] ?? ''}
                            onChange={(event) =>
                              setDraftTargets((prev) => ({
                                ...prev,
                                [sug.sourceCode]: event.target.value,
                              }))
                            }
                            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                          >
                            <option value="">Not mapped</option>
                            {validation.availableAccounts.map((acc) => (
                              <option key={acc.code} value={acc.code}>
                                {acc.code} — {acc.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-1.5 text-slate-600">{sug.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {rehearsals.length > 0 && (
        <div className="rounded border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">
              Cutover rehearsal ledger ({rehearsals.length} run(s))
            </h3>
            <button
              type="button"
              onClick={() => props.onNavigate('/statements')}
              className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Inspect Statements
            </button>
          </div>
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <caption className="sr-only">Repeatable cutover rehearsal verification log</caption>
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">Mode</th>
                  <th className="px-3 py-2">Rehearsal fingerprint</th>
                  <th className="px-3 py-2 text-right">Imported / Quar</th>
                  <th className="px-3 py-2 text-right">Post-TB Debit</th>
                  <th className="px-3 py-2 text-right">Post-TB Credit</th>
                  <th className="px-3 py-2">Batch</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rehearsals.map((run, idx) => (
                  <tr key={`${run.executedAt}-${idx}`}>
                    <td className="px-3 py-1.5 font-mono">{run.mode}</td>
                    <td className="px-3 py-1.5 font-mono">{run.rehearsalHash.slice(0, 16)}…</td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {run.validation.importableCount} / {run.validation.quarantinedCount}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {run.trialBalanceAfter.totalDebit}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {run.trialBalanceAfter.totalCredit}
                    </td>
                    <td className="px-3 py-1.5 font-mono">
                      {run.committed === null
                        ? 'dry-run (0 writes)'
                        : `${run.committed.batchId.slice(0, 8)}…${
                            run.committed.replacedBatchId
                              ? ` (replaced ${run.committed.replacedBatchId.slice(0, 8)}…)`
                              : ''
                          }`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
