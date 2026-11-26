import type { FormEvent, ReactElement } from 'react';
import type {
  FluxAnalysisResponse,
  PvmBridgeResponse,
} from '../../shared/variance.js';
import {
  createEmptyPvmItemDraft,
  type PvmItemDraft,
} from '../state/planningView.js';
import {
  InlineEmptyState,
  InlineErrorState,
  LoadingState,
  PartialBanner,
} from './StateFrame.js';

function favorabilityTextClass(favorability: 'favorable' | 'unfavorable' | 'neutral' | 'na'): string {
  if (favorability === 'favorable') return 'text-emerald-800 font-semibold';
  if (favorability === 'unfavorable') return 'text-red-800 font-semibold';
  return 'text-slate-600';
}

export function FluxPvmPanel(props: {
  readonly period: string;
  readonly flux: FluxAnalysisResponse | null;
  readonly fluxState: 'loading' | 'idle' | 'error';
  readonly fluxError: { readonly code: string; readonly message: string } | null;
  readonly minAbsInput: string;
  readonly topNInput: number;
  readonly filterError: string | null;
  readonly onChangeMinAbs: (next: string) => void;
  readonly onChangeTopN: (next: number) => void;
  readonly onApplyFilter: () => void;
  readonly onRetryFlux: () => void;
  readonly onOpenImport: () => void;
  readonly pvmItems: readonly PvmItemDraft[];
  readonly onChangePvmItems: (next: readonly PvmItemDraft[]) => void;
  readonly pvmResult: PvmBridgeResponse | null;
  readonly pvmState: 'idle' | 'loading' | 'error';
  readonly pvmIssues: readonly string[];
  readonly pvmError: { readonly code: string; readonly message: string } | null;
  readonly onComputePvm: () => void;
  readonly onResetPvm: () => void;
}): ReactElement {
  const { flux, fluxState, fluxError, pvmItems, pvmResult, pvmState } = props;

  const handleFilterSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    props.onApplyFilter();
  };

  const handlePvmSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    props.onComputePvm();
  };

  const updatePvmRow = (rowId: string, patch: Partial<PvmItemDraft>): void => {
    props.onChangePvmItems(
      pvmItems.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    );
  };

  const addPvmRow = (): void => {
    const nextId = `pvm-${String(pvmItems.length + 1)}-${String(Date.now())}`;
    props.onChangePvmItems([...pvmItems, createEmptyPvmItemDraft(nextId)]);
  };

  const removePvmRow = (rowId: string): void => {
    props.onChangePvmItems(pvmItems.filter((row) => row.id !== rowId));
  };

  return (
    <div id="flux-pvm-panel" className="space-y-6">
      <section aria-labelledby="flux-heading" className="space-y-4 rounded border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <h2 id="flux-heading" className="text-sm font-semibold text-slate-900">
              Material Flux Waterfall Bridge
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Ranks planned accounts by absolute variance magnitude and reconciles top drivers plus remaining planned
              variance directly to BvA and GL actuals.
            </p>
          </div>
          {flux !== null && flux.hasPlan && (
            <p className="font-mono text-xs text-slate-600 tabular-nums">
              {flux.scenarioName ?? 'Budget'} v{flux.versionNo ?? '—'} · YTD through {flux.throughPeriodCode} FY
              {String(flux.fiscalYear)}
            </p>
          )}
        </div>

        <form onSubmit={handleFilterSubmit} className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="flux-min-abs" className="block text-xs font-medium text-slate-600">
              Min |variance|
            </label>
            <input
              id="flux-min-abs"
              type="text"
              inputMode="decimal"
              value={props.minAbsInput}
              onChange={(event) => props.onChangeMinAbs(event.target.value)}
              placeholder="0.00"
              className="mt-1 w-32 rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums"
            />
          </div>
          <div>
            <label htmlFor="flux-top-n" className="block text-xs font-medium text-slate-600">
              Top drivers
            </label>
            <select
              id="flux-top-n"
              value={String(props.topNInput)}
              onChange={(event) => props.onChangeTopN(Number.parseInt(event.target.value, 10))}
              className="mt-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
            >
              <option value="3">Top 3</option>
              <option value="5">Top 5</option>
              <option value="10">Top 10</option>
              <option value="25">Top 25</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={fluxState === 'loading'}
            className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            Apply filter
          </button>
        </form>

        {props.filterError !== null && (
          <div role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
            {props.filterError}
          </div>
        )}

        {fluxState === 'loading' ? (
          <LoadingState label="Computing Flux waterfall and materiality ranking on the server..." />
        ) : fluxState === 'error' ? (
          <InlineErrorState
            code={fluxError?.code ?? 'INTERNAL_ERROR'}
            message={fluxError?.message ?? 'Unable to compute material flux analysis.'}
            onRetry={props.onRetryFlux}
          />
        ) : flux === null || !flux.hasPlan ? (
          <InlineEmptyState
            disclosure="No budget plan version has been committed for this company yet, so Flux Analysis has no baseline to bridge against actuals."
            ctaLabel="Open Import Wizard"
            onAction={props.onOpenImport}
          />
        ) : (
          <div className="space-y-4">
            {flux.unplannedAccounts.length > 0 && (
              <PartialBanner
                detail={`${String(flux.unplannedAccounts.length)} unplanned account(s) totaling ${flux.bridge.unplannedActualTotal} have no budget line and are disclosed separately below without altering planned variances.`}
              />
            )}

            {!flux.bridge.tieOutValid && (
              <PartialBanner detail="Flux waterfall bridge sum does not tie to BvA totals; treat these variance figures as provisional." />
            )}

            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Plan baseline ({String(flux.totalPlannedAccounts)})
                </dt>
                <dd className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                  {flux.bridge.planTotal}
                </dd>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Top {String(flux.drivers.length)} drivers var
                </dt>
                <dd className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                  {flux.bridge.topDriversVariance}
                </dd>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Other planned ({String(flux.otherPlannedCount)})
                </dt>
                <dd className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                  {flux.bridge.otherPlannedVariance}
                </dd>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Planned actuals
                </dt>
                <dd className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                  {flux.bridge.plannedActualTotal}
                </dd>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Unplanned actuals
                </dt>
                <dd className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                  {flux.bridge.unplannedActualTotal}
                </dd>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Net operating var
                </dt>
                <dd className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                  {flux.bridge.netOperatingVariance}
                </dd>
              </div>
            </dl>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <span className="font-mono tabular-nums">
                Bridge check: Plan {flux.bridge.planTotal} + Top Drivers {flux.bridge.topDriversVariance} + Other{' '}
                {flux.bridge.otherPlannedVariance} = Planned Actual {flux.bridge.plannedActualTotal} (Ledger total{' '}
                {flux.bridge.actualTotal})
              </span>
              <span
                className={`font-mono font-semibold ${
                  flux.bridge.tieOutValid ? 'text-emerald-800' : 'text-red-800'
                }`}
              >
                {flux.bridge.tieOutValid ? 'Tie-out valid' : 'Tie-out failed'}
              </span>
            </div>

            {flux.drivers.length === 0 ? (
              <p className="rounded border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
                No planned accounts met the minimum variance magnitude threshold of{' '}
                <span className="font-mono font-medium">{flux.minAbsVariance}</span>. Lower the threshold to inspect
                smaller variances.
              </p>
            ) : (
              <div className="overflow-x-auto rounded border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-xs">
                  <caption className="sr-only">
                    Material flux drivers ranked by variance magnitude through {flux.throughPeriodCode}
                  </caption>
                  <thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-600">
                    <tr>
                      <th scope="col" className="px-3 py-2">Rank</th>
                      <th scope="col" className="px-3 py-2">Account</th>
                      <th scope="col" className="px-3 py-2">Type</th>
                      <th scope="col" className="px-3 py-2 text-right">Plan</th>
                      <th scope="col" className="px-3 py-2 text-right">Actual</th>
                      <th scope="col" className="px-3 py-2 text-right">Variance</th>
                      <th scope="col" className="px-3 py-2 text-right">Var %</th>
                      <th scope="col" className="px-3 py-2 text-right">Share |Var|</th>
                      <th scope="col" className="px-3 py-2">Direction</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {flux.drivers.map((row) => (
                      <tr key={row.accountCode}>
                        <td className="px-3 py-2 font-mono text-slate-500 tabular-nums">{String(row.rank)}</td>
                        <th scope="row" className="px-3 py-2 text-left font-normal text-slate-900">
                          <span className="font-mono font-medium">{row.accountCode}</span>{' '}
                          <span className="text-slate-600">{row.accountName}</span>
                        </th>
                        <td className="px-3 py-2 uppercase text-slate-600">{row.accountType}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{row.plan}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{row.actual}</td>
                        <td className="px-3 py-2 text-right font-mono font-medium tabular-nums">
                          {row.varianceAmount}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {row.variancePctFormatted ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {row.shareOfAbsVariancePct}
                        </td>
                        <td className={`px-3 py-2 font-mono uppercase ${favorabilityTextClass(row.favorability)}`}>
                          {row.favorability}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {flux.unplannedAccounts.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                  Unplanned accounts with actual activity (excluded from planned variance)
                </h3>
                <div className="overflow-x-auto rounded border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-xs">
                    <thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-600">
                      <tr>
                        <th scope="col" className="px-3 py-2">Account</th>
                        <th scope="col" className="px-3 py-2">Type</th>
                        <th scope="col" className="px-3 py-2 text-right">Actual</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {flux.unplannedAccounts.map((acct) => (
                        <tr key={acct.accountCode}>
                          <th scope="row" className="px-3 py-2 text-left font-normal text-slate-900">
                            <span className="font-mono font-medium">{acct.accountCode}</span>{' '}
                            <span className="text-slate-600">{acct.accountName}</span>
                          </th>
                          <td className="px-3 py-2 uppercase text-slate-600">{acct.accountType}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{acct.actual}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="pvm-heading" className="space-y-4 rounded border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <h2 id="pvm-heading" className="text-sm font-semibold text-slate-900">
              Price-Volume-Mix (PVM) Decomposition Bridge
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Decomposes segment or SKU revenue variance through {props.period} into Price Effect, Volume Effect, and
              Mix Effect with exact cent tie-out.
            </p>
          </div>
          {pvmResult !== null && (
            <p className="font-mono text-xs text-slate-600 tabular-nums">
              {pvmResult.baseCurrency} · {pvmResult.periodCode} FY{String(pvmResult.fiscalYear)}
              {pvmResult.scenarioName !== null ? ` · ${pvmResult.scenarioName}` : ''}
            </p>
          )}
        </div>

        <form onSubmit={handlePvmSubmit} className="space-y-3">
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <caption className="sr-only">Editable Price-Volume-Mix SKU segment inputs</caption>
              <thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-600">
                <tr>
                  <th scope="col" className="px-2.5 py-2">Segment Key</th>
                  <th scope="col" className="px-2.5 py-2">Label</th>
                  <th scope="col" className="px-2.5 py-2 text-right">Plan Units</th>
                  <th scope="col" className="px-2.5 py-2 text-right">Plan Price</th>
                  <th scope="col" className="px-2.5 py-2 text-right">Actual Units</th>
                  <th scope="col" className="px-2.5 py-2 text-right">Actual Price</th>
                  <th scope="col" className="px-2.5 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {pvmItems.map((row, index) => (
                  <tr key={row.id}>
                    <td className="px-2.5 py-1.5">
                      <input
                        aria-label={`Segment ${String(index + 1)} key`}
                        type="text"
                        value={row.key}
                        onChange={(event) => updatePvmRow(row.id, { key: event.target.value })}
                        placeholder="SKU_A"
                        className="w-28 rounded border border-slate-300 px-2 py-1 font-mono text-xs"
                      />
                    </td>
                    <td className="px-2.5 py-1.5">
                      <input
                        aria-label={`Segment ${String(index + 1)} label`}
                        type="text"
                        value={row.label}
                        onChange={(event) => updatePvmRow(row.id, { label: event.target.value })}
                        placeholder="Enterprise Seat"
                        className="w-40 rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="px-2.5 py-1.5 text-right">
                      <input
                        aria-label={`Segment ${String(index + 1)} plan units`}
                        type="text"
                        inputMode="decimal"
                        value={row.planUnits}
                        onChange={(event) => updatePvmRow(row.id, { planUnits: event.target.value })}
                        placeholder="100"
                        className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-mono text-xs tabular-nums"
                      />
                    </td>
                    <td className="px-2.5 py-1.5 text-right">
                      <input
                        aria-label={`Segment ${String(index + 1)} plan price`}
                        type="text"
                        inputMode="decimal"
                        value={row.planPrice}
                        onChange={(event) => updatePvmRow(row.id, { planPrice: event.target.value })}
                        placeholder="10.00"
                        className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-mono text-xs tabular-nums"
                      />
                    </td>
                    <td className="px-2.5 py-1.5 text-right">
                      <input
                        aria-label={`Segment ${String(index + 1)} actual units`}
                        type="text"
                        inputMode="decimal"
                        value={row.actualUnits}
                        onChange={(event) => updatePvmRow(row.id, { actualUnits: event.target.value })}
                        placeholder="120"
                        className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-mono text-xs tabular-nums"
                      />
                    </td>
                    <td className="px-2.5 py-1.5 text-right">
                      <input
                        aria-label={`Segment ${String(index + 1)} actual price`}
                        type="text"
                        inputMode="decimal"
                        value={row.actualPrice}
                        onChange={(event) => updatePvmRow(row.id, { actualPrice: event.target.value })}
                        placeholder="11.00"
                        className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-mono text-xs tabular-nums"
                      />
                    </td>
                    <td className="px-2.5 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => removePvmRow(row.id)}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={addPvmRow}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              Add segment line
            </button>
            <button
              type="button"
              onClick={props.onResetPvm}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              Clear lines
            </button>
            <button
              type="submit"
              disabled={pvmState === 'loading'}
              className="rounded bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {pvmState === 'loading' ? 'Computing PVM...' : 'Compute PVM Bridge'}
            </button>
          </div>
        </form>

        {props.pvmIssues.length > 0 && (
          <ul
            role="alert"
            aria-label="PVM validation issues"
            className="list-disc space-y-1 rounded border border-red-300 bg-red-50 px-6 py-2.5 font-mono text-xs text-red-900"
          >
            {props.pvmIssues.map((issue, idx) => (
              <li key={`${String(idx)}-${issue}`}>{issue}</li>
            ))}
          </ul>
        )}

        {pvmState === 'error' && props.pvmError !== null && (
          <InlineErrorState
            code={props.pvmError.code}
            message={props.pvmError.message}
            onRetry={props.onComputePvm}
          />
        )}

        {pvmResult !== null && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Plan revenue</dt>
                <dd className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                  {pvmResult.totalPlanRevenue}
                </dd>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Actual revenue</dt>
                <dd className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                  {pvmResult.totalActualRevenue}
                </dd>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Total var ({pvmResult.variancePct ?? '—'})
                </dt>
                <dd className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                  {pvmResult.totalVariance}
                </dd>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Price effect</dt>
                <dd className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                  {pvmResult.priceVariance}
                </dd>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Volume effect</dt>
                <dd className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                  {pvmResult.volumeVariance}
                </dd>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Mix effect</dt>
                <dd className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                  {pvmResult.mixVariance}
                </dd>
              </div>
            </dl>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <span className="font-mono tabular-nums">
                PVM Invariant: Price {pvmResult.priceVariance} + Volume {pvmResult.volumeVariance} + Mix{' '}
                {pvmResult.mixVariance} = {pvmResult.totalVariance} (Delta: {pvmResult.invariantDelta})
              </span>
              <span
                className={`font-mono font-semibold ${
                  pvmResult.invariantPassed ? 'text-emerald-800' : 'text-red-800'
                }`}
              >
                {pvmResult.invariantPassed ? 'Invariant holds' : 'Invariant mismatch'}
              </span>
            </div>

            <div className="overflow-x-auto rounded border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <caption className="sr-only">Itemized Price-Volume-Mix contribution by segment</caption>
                <thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-600">
                  <tr>
                    <th scope="col" className="px-3 py-2">Segment</th>
                    <th scope="col" className="px-3 py-2 text-right">Plan Rev</th>
                    <th scope="col" className="px-3 py-2 text-right">Actual Rev</th>
                    <th scope="col" className="px-3 py-2 text-right">Total Var</th>
                    <th scope="col" className="px-3 py-2 text-right">Price Effect</th>
                    <th scope="col" className="px-3 py-2 text-right">Vol @ Plan Price</th>
                    <th scope="col" className="px-3 py-2 text-right">Mix Contrib</th>
                    <th scope="col" className="px-3 py-2">Direction</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {pvmResult.items.map((item) => (
                    <tr key={item.key}>
                      <th scope="row" className="px-3 py-2 text-left font-normal text-slate-900">
                        <span className="font-mono font-medium">{item.key}</span>{' '}
                        <span className="text-slate-600">{item.label}</span>
                      </th>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{item.planRevenue}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{item.actualRevenue}</td>
                      <td className="px-3 py-2 text-right font-mono font-medium tabular-nums">
                        {item.totalVariance}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{item.priceEffect}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{item.volumeAtPlanPrice}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{item.mixContribution}</td>
                      <td className={`px-3 py-2 font-mono uppercase ${favorabilityTextClass(item.favorability)}`}>
                        {item.favorability}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
