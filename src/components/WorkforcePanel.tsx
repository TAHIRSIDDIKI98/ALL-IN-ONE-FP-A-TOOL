import type { ReactElement } from 'react';
import type { ScenarioKind } from '../../shared/planning.js';
import type {
  WorkforceCommitResponse,
  WorkforcePreviewResponse,
  WorkforceWorkspaceResponse,
} from '../../shared/workforce.js';
import {
  createEmptyWorkforcePositionDraft,
  type WorkforcePlanDraft,
  type WorkforcePositionDraft,
} from '../state/planningView.js';
import { InlineErrorState, LoadingState, PartialBanner } from './StateFrame.js';

export interface WorkforceActionFailure {
  readonly code: string;
  readonly message: string;
  readonly issues: readonly string[];
  readonly action: 'save' | 'preview' | 'commit';
}

export function WorkforcePanel(props: {
  readonly workspace: WorkforceWorkspaceResponse | null;
  readonly loadState: 'loading' | 'idle' | 'error';
  readonly loadFailure: { readonly code: string; readonly message: string } | null;
  readonly onRetryLoad: () => void;
  readonly onOpenCoaMapper: () => void;
  readonly draft: WorkforcePlanDraft;
  readonly onChangeDraft: (next: WorkforcePlanDraft) => void;
  readonly previewResult: WorkforcePreviewResponse | null;
  readonly commitResult: WorkforceCommitResponse | null;
  readonly actionBusy: 'save' | 'preview' | 'commit' | null;
  readonly actionFailure: WorkforceActionFailure | null;
  readonly actionNotice: string | null;
  readonly onSaveRoster: () => void;
  readonly onPreview: () => void;
  readonly onCommit: () => void;
  readonly onRetryAction: () => void;
}): ReactElement {
  const { workspace, loadState, loadFailure, draft, actionBusy } = props;

  if (loadState === 'loading') {
    return (
      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
        <LoadingState label="Loading Workforce roster and module schema from the server..." />
      </section>
    );
  }

  if (loadState === 'error' || workspace === null) {
    return (
      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
        <InlineErrorState
          code={loadFailure?.code ?? 'WORKFORCE_UNAVAILABLE'}
          message={loadFailure?.message ?? 'The Workforce module workspace could not be loaded.'}
          onRetry={props.onRetryLoad}
        />
      </section>
    );
  }

  const canEdit = workspace.actorRole === 'owner' || workspace.actorRole === 'editor';
  const periods = workspace.periods;
  const accounts = workspace.accounts;
  const defaultAccount =
    accounts.find((account) => account.type === 'expense')?.code ?? accounts[0]?.code ?? '';
  const defaultPeriod = periods[0] ?? 'P01';
  const busy = actionBusy !== null;

  const updatePosition = (rowId: string, patch: Partial<WorkforcePositionDraft>): void => {
    props.onChangeDraft({
      ...draft,
      positions: draft.positions.map((pos) => (pos.id === rowId ? { ...pos, ...patch } : pos)),
    });
  };

  const addPosition = (): void => {
    const uniqueId = `wf-pos-${String(draft.positions.length + 1)}-${String(Date.now())}`;
    props.onChangeDraft({
      ...draft,
      positions: [
        ...draft.positions,
        createEmptyWorkforcePositionDraft(uniqueId, defaultAccount, defaultPeriod),
      ],
    });
  };

  const removePosition = (rowId: string): void => {
    props.onChangeDraft({
      ...draft,
      positions: draft.positions.filter((pos) => pos.id !== rowId),
    });
  };

  return (
    <section
      id="workforce-module-panel"
      aria-labelledby="workforce-panel-heading"
      className="space-y-5 rounded-lg border border-slate-200 bg-white p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 id="workforce-panel-heading" className="text-sm font-semibold text-slate-900">
            Workforce &amp; headcount module
          </h3>
          <p className="mt-1 text-xs text-slate-600">
            Schema-driven module ({workspace.moduleSpec.dimensions.join(' · ')}) compiling directly into{' '}
            <span className="font-mono">plan_line</span> via the single planning engine. Zero separate ledger.
          </p>
        </div>
        <p className="text-xs text-slate-600 font-mono tabular-nums">
          FY{String(workspace.fiscalYear)} · {workspace.currency} · Role: {workspace.actorRole} ·{' '}
          {String(workspace.positions.length)} saved position(s)
        </p>
      </div>

      {!canEdit && (
        <PartialBanner detail={`Signed in with "${workspace.actorRole}" role (read-only). Owner or editor access is required to save roster positions or commit plans.`} />
      )}

      {accounts.length === 0 && (
        <div className="space-y-2">
          <PartialBanner detail="No active postable accounts exist for this company yet. Import a Chart of Accounts before saving or committing Workforce positions." />
          <button
            type="button"
            onClick={props.onOpenCoaMapper}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            Open CoA Mapper
          </button>
        </div>
      )}

      {props.actionNotice !== null && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-xs text-emerald-950"
        >
          {props.actionNotice}
        </div>
      )}

      {props.actionFailure !== null && (
        <div className="space-y-2">
          <InlineErrorState
            code={props.actionFailure.code}
            message={props.actionFailure.message}
            onRetry={props.onRetryAction}
          />
          {props.actionFailure.issues.length > 0 && (
            <ul
              aria-label="Workforce validation issues"
              className="list-disc space-y-1 rounded border border-red-200 bg-red-50 px-6 py-2 font-mono text-xs text-red-900"
            >
              {props.actionFailure.issues.map((issue, idx) => (
                <li key={`${String(idx)}-${issue}`}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="wf-scenario-name" className="block text-xs font-medium text-slate-600">
            Target scenario name
          </label>
          <input
            id="wf-scenario-name"
            type="text"
            value={draft.scenarioName}
            disabled={busy || !canEdit}
            onChange={(event) => props.onChangeDraft({ ...draft, scenarioName: event.target.value })}
            placeholder={`Workforce Plan FY${String(workspace.fiscalYear)}`}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label htmlFor="wf-scenario-kind" className="block text-xs font-medium text-slate-600">
            Target scenario kind
          </label>
          <select
            id="wf-scenario-kind"
            value={draft.scenarioKind}
            disabled={busy || !canEdit}
            onChange={(event) =>
              props.onChangeDraft({ ...draft, scenarioKind: event.target.value as ScenarioKind })
            }
            className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
          >
            <option value="forecast">forecast</option>
            <option value="budget">budget</option>
          </select>
        </div>
      </div>

      {draft.positions.length === 0 ? (
        <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
          <p>
            No Workforce positions are currently in the draft roster. Add a position row to model headcount,
            employer burden, bonus, onboarding ramp, and merit adjustments.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {draft.positions.map((pos, index) => {
            const prefix = `wf-row-${pos.id}`;
            return (
              <article key={pos.id} className="space-y-3 rounded border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold text-slate-800">
                    Position {String(index + 1)}
                    {pos.positionCode.trim().length > 0 ? ` · ${pos.positionCode.trim()}` : ''}
                  </h4>
                  {canEdit && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => removePosition(pos.id)}
                      className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      Remove position
                    </button>
                  )}
                </div>

                <div className="grid gap-3 md:grid-cols-5">
                  <div>
                    <label htmlFor={`${prefix}-code`} className="block text-xs font-medium text-slate-600">
                      Position code
                    </label>
                    <input
                      id={`${prefix}-code`}
                      type="text"
                      value={pos.positionCode}
                      disabled={busy || !canEdit}
                      onChange={(event) => updatePosition(pos.id, { positionCode: event.target.value })}
                      placeholder="ENG-001"
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor={`${prefix}-title`} className="block text-xs font-medium text-slate-600">
                      Role title
                    </label>
                    <input
                      id={`${prefix}-title`}
                      type="text"
                      value={pos.title}
                      disabled={busy || !canEdit}
                      onChange={(event) => updatePosition(pos.id, { title: event.target.value })}
                      placeholder="Senior Engineer"
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor={`${prefix}-dept`} className="block text-xs font-medium text-slate-600">
                      Department
                    </label>
                    <input
                      id={`${prefix}-dept`}
                      type="text"
                      value={pos.departmentName}
                      disabled={busy || !canEdit}
                      onChange={(event) => updatePosition(pos.id, { departmentName: event.target.value })}
                      placeholder="Engineering"
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor={`${prefix}-account`} className="block text-xs font-medium text-slate-600">
                      GL expense account
                    </label>
                    {accounts.length > 0 ? (
                      <select
                        id={`${prefix}-account`}
                        value={pos.accountCode}
                        disabled={busy || !canEdit}
                        onChange={(event) => updatePosition(pos.id, { accountCode: event.target.value })}
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs"
                      >
                        <option value="">Select account</option>
                        {accounts.map((account) => (
                          <option key={account.code} value={account.code}>
                            {account.code} — {account.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`${prefix}-account`}
                        type="text"
                        value={pos.accountCode}
                        disabled={busy || !canEdit}
                        onChange={(event) => updatePosition(pos.id, { accountCode: event.target.value })}
                        placeholder="5100"
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs"
                      />
                    )}
                  </div>
                  <div>
                    <label htmlFor={`${prefix}-status`} className="block text-xs font-medium text-slate-600">
                      Status
                    </label>
                    <select
                      id={`${prefix}-status`}
                      value={pos.status}
                      disabled={busy || !canEdit}
                      onChange={(event) =>
                        updatePosition(pos.id, {
                          status: event.target.value as WorkforcePositionDraft['status'],
                        })
                      }
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    >
                      <option value="active">active</option>
                      <option value="inactive">inactive</option>
                    </select>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <div>
                    <label htmlFor={`${prefix}-fte`} className="block text-xs font-medium text-slate-600">
                      FTE
                    </label>
                    <input
                      id={`${prefix}-fte`}
                      type="text"
                      value={pos.fte}
                      disabled={busy || !canEdit}
                      onChange={(event) => updatePosition(pos.id, { fte: event.target.value })}
                      placeholder="1.00"
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums"
                    />
                  </div>
                  <div>
                    <label htmlFor={`${prefix}-salary`} className="block text-xs font-medium text-slate-600">
                      Annual salary ({workspace.currency})
                    </label>
                    <input
                      id={`${prefix}-salary`}
                      type="text"
                      value={pos.annualSalary}
                      disabled={busy || !canEdit}
                      onChange={(event) => updatePosition(pos.id, { annualSalary: event.target.value })}
                      placeholder="120000.00"
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums"
                    />
                  </div>
                  <div>
                    <label htmlFor={`${prefix}-burden`} className="block text-xs font-medium text-slate-600">
                      Burden ratio
                    </label>
                    <input
                      id={`${prefix}-burden`}
                      type="text"
                      value={pos.burdenRate}
                      disabled={busy || !canEdit}
                      onChange={(event) => updatePosition(pos.id, { burdenRate: event.target.value })}
                      placeholder="0.20"
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums"
                    />
                  </div>
                  <div>
                    <label htmlFor={`${prefix}-bonus`} className="block text-xs font-medium text-slate-600">
                      Bonus ratio
                    </label>
                    <input
                      id={`${prefix}-bonus`}
                      type="text"
                      value={pos.bonusRate}
                      disabled={busy || !canEdit}
                      onChange={(event) => updatePosition(pos.id, { bonusRate: event.target.value })}
                      placeholder="0.10"
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums"
                    />
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-5">
                  <div>
                    <label htmlFor={`${prefix}-start`} className="block text-xs font-medium text-slate-600">
                      Start period
                    </label>
                    <select
                      id={`${prefix}-start`}
                      value={pos.startPeriodCode}
                      disabled={busy || !canEdit}
                      onChange={(event) => updatePosition(pos.id, { startPeriodCode: event.target.value })}
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs"
                    >
                      {periods.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`${prefix}-end`} className="block text-xs font-medium text-slate-600">
                      End period (optional)
                    </label>
                    <select
                      id={`${prefix}-end`}
                      value={pos.endPeriodCode}
                      disabled={busy || !canEdit}
                      onChange={(event) => updatePosition(pos.id, { endPeriodCode: event.target.value })}
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs"
                    >
                      <option value="">End of year ({periods[periods.length - 1] ?? 'P12'})</option>
                      {periods.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`${prefix}-ramp`} className="block text-xs font-medium text-slate-600">
                      First-period ramp
                    </label>
                    <input
                      id={`${prefix}-ramp`}
                      type="text"
                      value={pos.rampFirstPeriodPct}
                      disabled={busy || !canEdit}
                      onChange={(event) =>
                        updatePosition(pos.id, { rampFirstPeriodPct: event.target.value })
                      }
                      placeholder="1.00"
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums"
                    />
                  </div>
                  <div>
                    <label htmlFor={`${prefix}-merit-period`} className="block text-xs font-medium text-slate-600">
                      Merit period (optional)
                    </label>
                    <select
                      id={`${prefix}-merit-period`}
                      value={pos.meritPeriodCode}
                      disabled={busy || !canEdit}
                      onChange={(event) => updatePosition(pos.id, { meritPeriodCode: event.target.value })}
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs"
                    >
                      <option value="">No merit adjustment</option>
                      {periods.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`${prefix}-merit-pct`} className="block text-xs font-medium text-slate-600">
                      Merit increase ratio
                    </label>
                    <input
                      id={`${prefix}-merit-pct`}
                      type="text"
                      value={pos.meritIncreasePct}
                      disabled={busy || !canEdit}
                      onChange={(event) => updatePosition(pos.id, { meritIncreasePct: event.target.value })}
                      placeholder="0.00"
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums"
                    />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
        {canEdit ? (
          <button
            type="button"
            disabled={busy}
            onClick={addPosition}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            + Add position
          </button>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <button
              type="button"
              disabled={busy}
              onClick={props.onSaveRoster}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {actionBusy === 'save' ? 'Saving roster...' : 'Save roster'}
            </button>
          )}
          <button
            type="button"
            disabled={busy || draft.positions.length === 0}
            onClick={props.onPreview}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {actionBusy === 'preview' ? 'Computing payroll...' : 'Preview payroll'}
          </button>
          {canEdit && (
            <button
              type="button"
              disabled={busy || draft.positions.length === 0}
              onClick={props.onCommit}
              className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {actionBusy === 'commit' ? 'Committing to scenario...' : 'Commit to scenario'}
            </button>
          )}
        </div>
      </div>

      {props.commitResult !== null && (
        <div
          role="status"
          aria-live="polite"
          className="rounded border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-950"
        >
          Committed Workforce module to scenario{' '}
          <span className="font-mono font-semibold">{props.commitResult.commit.scenarioName}</span> (v
          {String(props.commitResult.commit.versionNo)} ·{' '}
          {String(props.commitResult.commit.lineCount)} plan lines · total{' '}
          <span className="font-mono tabular-nums">{props.commitResult.commit.grandTotal}</span>{' '}
          {props.commitResult.preview.currency}). Rolling forecast &amp; BvA read these plan lines directly.
        </div>
      )}

      {props.previewResult !== null && (
        <div className="space-y-4 border-t border-slate-200 pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
              Workforce compilation preview
            </h4>
            <p className="font-mono text-xs text-slate-700 tabular-nums">
              Total payroll: {props.previewResult.grandTotalCost} {props.previewResult.currency} · FTE-months:{' '}
              {props.previewResult.grandTotalFteMonths}
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded border border-slate-200 bg-slate-50 p-3">
              <h5 className="text-xs font-semibold text-slate-700">Department summary</h5>
              <dl className="mt-2 space-y-1 text-xs font-mono">
                {props.previewResult.departmentSummaries.map((dept) => (
                  <div key={dept.departmentName} className="flex items-center justify-between gap-2">
                    <dt className="text-slate-700">
                      {dept.departmentName} ({dept.fteMonths} FTE-mo)
                    </dt>
                    <dd className="tabular-nums text-slate-900">{dept.totalCost}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 p-3">
              <h5 className="text-xs font-semibold text-slate-700">Compiled planning drivers (by GL account)</h5>
              <dl className="mt-2 space-y-1 text-xs font-mono">
                {Object.entries(props.previewResult.driverPlan.totalsByAccount).map(([acct, total]) => (
                  <div key={acct} className="flex items-center justify-between gap-2">
                    <dt className="text-slate-700">{acct}</dt>
                    <dd className="tabular-nums text-slate-900">{total}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <caption className="sr-only">
                Workforce annual compensation summary by position with FTE-months, base pay, benefits, bonus, and total cost
              </caption>
              <thead className="bg-slate-50 text-left font-medium text-slate-700">
                <tr>
                  <th scope="col" className="px-3 py-2">Code</th>
                  <th scope="col" className="px-3 py-2">Role</th>
                  <th scope="col" className="px-3 py-2">Department</th>
                  <th scope="col" className="px-3 py-2">Account</th>
                  <th scope="col" className="px-3 py-2 text-right">FTE-mo</th>
                  <th scope="col" className="px-3 py-2 text-right">Base pay</th>
                  <th scope="col" className="px-3 py-2 text-right">Benefits</th>
                  <th scope="col" className="px-3 py-2 text-right">Bonus</th>
                  <th scope="col" className="px-3 py-2 text-right">Total cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {props.previewResult.positionSummaries.map((row) => (
                  <tr key={row.positionCode}>
                    <th scope="row" className="px-3 py-2 text-left font-mono text-slate-800">
                      {row.positionCode}
                    </th>
                    <td className="px-3 py-2 text-slate-800">{row.title}</td>
                    <td className="px-3 py-2 text-slate-600">{row.departmentName}</td>
                    <td className="px-3 py-2 font-mono text-slate-700">{row.accountCode}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{row.fteMonths}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{row.totalBasePay}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{row.totalBenefits}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{row.totalBonus}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                      {row.totalCost}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 font-semibold text-slate-900">
                <tr>
                  <th scope="row" colSpan={4} className="px-3 py-2 text-left">
                    Total ({String(props.previewResult.positionSummaries.length)} active position(s))
                  </th>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {props.previewResult.grandTotalFteMonths}
                  </td>
                  <td className="px-3 py-2" colSpan={3} />
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {props.previewResult.grandTotalCost}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
