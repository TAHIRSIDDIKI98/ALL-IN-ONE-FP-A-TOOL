import { useState, type ReactElement } from 'react';
import type {
  DriverPlanCommitResponse,
  DriverPlanPreviewResponse,
  RollingForecastResponse,
  ScenarioComparisonResponse,
  ScenarioKind,
  ScenarioSummary,
} from '../../shared/planning.js';
import type { ChartAccountPayload } from '../api/client.js';
import {
  createEmptyDriverRow,
  type DriverKind,
  type DriverPlanDraft,
  type DriverRowDraft,
} from '../state/planningView.js';
import { InlineErrorState, LoadingState, PartialBanner } from './StateFrame.js';

type ScenarioComparisonRow = ScenarioComparisonResponse['rows'][number];

/**
 * M2 Planning views (MASTER_PROMPT §2.5, §9.3.5, §11.4).
 *
 * These are VIEWS inside the Model Grid screen, not a new screen: §9.1 fixes the spine at seven
 * screens, and the Model Grid is the workspace that owns plan/actual/variance sheets.
 *
 * Every number here is a server-issued canonical decimal string. This module performs NO arithmetic
 * and invents no value: an absent actual prints `not posted`, an absent plan prints `not planned`,
 * and a comparison row that exists in only one scenario says so instead of showing a fabricated
 * zero or an undefined percentage (§3.1 Null Law, §9.2 empty-state rules).
 */

const NOT_PLANNED = 'not planned';
const NOT_POSTED = 'not posted';
const NOT_MEANINGFUL = 'n/m';

function basisForPeriod(report: RollingForecastResponse, periodCode: string): 'actual' | 'forecast' {
  return report.forecastPeriods.includes(periodCode) ? 'forecast' : 'actual';
}

function cellText(amount: string | null, basis: 'actual' | 'forecast'): string {
  if (amount !== null) return amount;
  return basis === 'actual' ? NOT_POSTED : NOT_PLANNED;
}

function deltaPctText(row: ScenarioComparisonRow): string {
  if (row.deltaPctStatus === 'null') return NOT_PLANNED;
  return row.deltaPct ?? NOT_MEANINGFUL;
}

function comparabilityText(row: ScenarioComparisonRow): string {
  if (row.baseTotal === null && row.targetTotal === null) return 'not planned in either scenario';
  if (row.baseTotal === null) return 'not planned in base';
  if (row.targetTotal === null) return 'not planned in target';
  return 'both scenarios';
}

export function ScenarioInventory(props: {
  readonly scenarios: readonly ScenarioSummary[];
  readonly selectedScenario: string | null;
  readonly onSelect: (scenarioName: string) => void;
}): ReactElement {
  return (
    <article className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-900">Planning scenarios</h3>
      <p className="text-xs text-slate-600">
        Read from the server: each scenario with the plan version that is current right now. A scenario
        with no current version has no plan lines to forecast from, and says so.
      </p>
      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <caption className="sr-only">Scenarios with their kind, current plan version, and forecast selection</caption>
          <thead className="bg-slate-50 text-left font-medium text-slate-700">
            <tr>
              <th scope="col" className="px-3 py-2">Scenario</th>
              <th scope="col" className="px-3 py-2">Kind</th>
              <th scope="col" className="px-3 py-2">Current plan version</th>
              <th scope="col" className="px-3 py-2">Rolling forecast</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {props.scenarios.map((scenario) => {
              const selected = props.selectedScenario === scenario.name;
              return (
                <tr key={scenario.scenarioId} className={selected ? 'bg-slate-50' : undefined}>
                  <th scope="row" className="px-3 py-2 text-left font-medium text-slate-800">
                    {scenario.name}
                  </th>
                  <td className="px-3 py-2 text-slate-600">{scenario.kind}</td>
                  <td className="px-3 py-2 font-mono text-slate-700">
                    {scenario.currentVersionNo === null
                      ? 'no current version'
                      : `v${String(scenario.currentVersionNo)}${scenario.currentVersionLabel === null ? '' : ` · ${scenario.currentVersionLabel}`}`}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => props.onSelect(scenario.name)}
                      className={`rounded border px-2 py-0.5 text-xs font-medium ${
                        selected
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {selected ? 'Selected for forecast' : 'Use for forecast'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </article>
  );
}

export function RollingForecastTable(props: {
  readonly report: RollingForecastResponse;
  readonly currency: string;
}): ReactElement {
  const { report } = props;
  const planBasis =
    report.planVersionNo === null
      ? 'no current plan version for this scenario'
      : `current plan version v${String(report.planVersionNo)}`;
  const cutoffBasis =
    report.cutoffPeriod === 'NONE'
      ? 'no actual period is closed, so the whole horizon is forecast'
      : `cutoff ${report.cutoffPeriod}`;

  return (
    <article className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Rolling forecast</h3>
        <p className="text-xs text-slate-600">
          Scenario &quot;{report.scenarioName}&quot; · FY{String(report.fiscalYear)} · {planBasis} · amounts in{' '}
          {props.currency}
        </p>
      </div>
      <p className="text-xs text-slate-600">
        Actual basis:{' '}
        {report.actualPeriods.length > 0 ? report.actualPeriods.join(', ') : 'none'} · Forecast basis:{' '}
        {report.forecastPeriods.length > 0 ? report.forecastPeriods.join(', ') : 'none'} · {cutoffBasis}.
        Every cell is tagged with its basis and every amount is a server-issued decimal string.
      </p>

      {report.planVersionNo === null && (
        <PartialBanner detail="This scenario has no current plan version, so every forecast cell is not planned. No planned amount was inferred and no zero was substituted." />
      )}
      {report.totalMissingCells > 0 && (
        <PartialBanner
          detail={`${String(report.totalMissingCells)} horizon cell(s) carry no value: ${NOT_POSTED} on the actual basis, ${NOT_PLANNED} on the forecast basis. They are never displayed as zero.`}
        />
      )}

      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <caption className="sr-only">
            Rolling forecast by account and period, with the basis of each cell and the server subtotals
          </caption>
          <thead className="bg-slate-50 text-left font-medium text-slate-700">
            <tr>
              <th scope="col" className="px-3 py-2">
                Account
              </th>
              {report.periods.map((periodCode) => {
                const basis = basisForPeriod(report, periodCode);
                return (
                  <th key={periodCode} scope="col" className="px-3 py-2 text-right">
                    <span className="block font-mono">{periodCode}</span>
                    <span className="block text-[10px] font-normal uppercase tracking-wide text-slate-500">
                      {basis}
                    </span>
                  </th>
                );
              })}
              <th scope="col" className="px-3 py-2 text-right">
                Actual subtotal
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Forecast subtotal
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Full horizon
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Cells not planned
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {report.rows.map((row) => (
              <tr key={row.accountCode}>
                <th scope="row" className="px-3 py-2 text-left font-mono text-slate-800">
                  {row.accountCode}
                </th>
                {row.cells.map((cell) => (
                  <td key={cell.periodCode} className="px-3 py-2 text-right font-mono tabular-nums">
                    {cellText(cell.amount, cell.basis)}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-mono tabular-nums">{row.actualSubtotal}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{row.forecastSubtotal}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                  {row.fullHorizonTotal}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{String(row.missingCellCount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 font-semibold text-slate-900">
            <tr>
              <th scope="row" colSpan={report.periods.length + 1} className="px-3 py-2 text-left">
                Total ({String(report.rows.length)} account(s), {String(report.totalMissingCells)} cell(s) not
                planned)
              </th>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{report.totalActual}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{report.totalForecast}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{report.totalFullHorizon}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">
                {String(report.totalMissingCells)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </article>
  );
}

export function ScenarioComparisonTable(props: {
  readonly report: ScenarioComparisonResponse;
  readonly currency: string;
}): ReactElement {
  const { report } = props;

  return (
    <article className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Scenario comparison</h3>
        <p className="text-xs text-slate-600">
          Base &quot;{report.baseScenarioName}&quot; vs target &quot;{report.targetScenarioName}&quot; · FY
          {String(report.fiscalYear)} · amounts in {props.currency}
        </p>
      </div>
      <p className="text-xs text-slate-600">
        Delta is target minus base on the natural sign. A zero base with a non-zero target is{' '}
        {NOT_MEANINGFUL}, an account present in only one scenario keeps that side {NOT_PLANNED}, and a
        true zero against a true zero is the server&apos;s own zero percent.
      </p>

      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <caption className="sr-only">
            Scenario comparison by account with base, target, delta, delta percent and comparability
          </caption>
          <thead className="bg-slate-50 text-left font-medium text-slate-700">
            <tr>
              <th scope="col" className="px-3 py-2">Account</th>
              <th scope="col" className="px-3 py-2 text-right">Base</th>
              <th scope="col" className="px-3 py-2 text-right">Target</th>
              <th scope="col" className="px-3 py-2 text-right">Delta</th>
              <th scope="col" className="px-3 py-2 text-right">Delta %</th>
              <th scope="col" className="px-3 py-2">Comparability</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {report.rows.map((row) => (
              <tr key={row.accountCode}>
                <th scope="row" className="px-3 py-2 text-left font-mono text-slate-800">
                  {row.accountCode}
                </th>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {row.baseTotal ?? NOT_PLANNED}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {row.targetTotal ?? NOT_PLANNED}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {row.deltaAmount ?? NOT_PLANNED}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{deltaPctText(row)}</td>
                <td className="px-3 py-2 text-xs text-slate-600">{comparabilityText(row)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 font-semibold text-slate-900">
            <tr>
              <th scope="row" className="px-3 py-2 text-left">
                Total ({String(report.rows.length)} account(s))
              </th>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{report.totalBase}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{report.totalTarget}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{report.totalDelta}</td>
              <td className="px-3 py-2" colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </article>
  );
}

export interface DriverAuthoringFailure {
  readonly code: string;
  readonly message: string;
  readonly issues: readonly string[];
  readonly action: 'preview' | 'commit';
}

export function DriverPlanPreviewTable(props: {
  readonly report: DriverPlanPreviewResponse;
  readonly currency: string;
}): ReactElement {
  const { report } = props;
  const accountEntries = Object.entries(report.totalsByAccount);

  return (
    <article className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Driver plan preview</h3>
        <p className="text-xs text-slate-600">
          FY{String(report.fiscalYear)} · grand total {report.grandTotal} {props.currency} · scale{' '}
          {String(report.currencyScale)} dp (dry-run; nothing written)
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded border border-slate-200 bg-white p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Totals by account</h4>
          <dl className="mt-2 space-y-1 text-xs">
            {accountEntries.map(([code, accountSum]) => (
              <div key={code} className="flex items-center justify-between gap-2 font-mono">
                <dt className="text-slate-700">{code}</dt>
                <dd className="tabular-nums text-slate-900">{accountSum}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="rounded border border-slate-200 bg-white p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Totals by period</h4>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
            {report.periods.map((periodCode) => (
              <div key={periodCode} className="flex items-center justify-between gap-1 font-mono">
                <dt className="text-slate-700">{periodCode}</dt>
                <dd className="tabular-nums text-slate-900">
                  {report.totalsByPeriod[periodCode] ?? '0'}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <caption className="sr-only">
            Computed driver plan lines by account and period with source tag and assumption label
          </caption>
          <thead className="bg-slate-50 text-left font-medium text-slate-700">
            <tr>
              <th scope="col" className="px-3 py-2">Account</th>
              <th scope="col" className="px-3 py-2">Period</th>
              <th scope="col" className="px-3 py-2 text-right">Amount</th>
              <th scope="col" className="px-3 py-2">Source</th>
              <th scope="col" className="px-3 py-2">Driver key</th>
              <th scope="col" className="px-3 py-2">Assumption</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {report.lines.map((line) => (
              <tr key={`${line.accountCode}-${line.periodCode}`}>
                <th scope="row" className="px-3 py-1.5 text-left font-mono text-slate-800">
                  {line.accountCode}
                </th>
                <td className="px-3 py-1.5 font-mono text-slate-700">{line.periodCode}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-900">
                  {line.amount}
                </td>
                <td className="px-3 py-1.5 font-mono text-xs text-slate-700">{line.source}</td>
                <td className="px-3 py-1.5 font-mono text-xs text-slate-600">{line.driverKey}</td>
                <td className="px-3 py-1.5 text-xs text-slate-700">{line.assumptionLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

const DRIVER_KIND_OPTIONS: readonly { readonly value: DriverKind; readonly label: string }[] = [
  { value: 'fixed', label: 'Fixed per period' },
  { value: 'growth_rate', label: 'Compound growth rate' },
  { value: 'percent_of_account', label: 'Percent of another account' },
  { value: 'price_times_volume', label: 'Price x volume' },
];

export function DriverAuthoringPanel(props: {
  readonly fiscalYear: number;
  readonly periods: readonly string[];
  readonly currency: string;
  readonly accounts: readonly ChartAccountPayload[];
  readonly chartState: 'loading' | 'idle' | 'error';
  readonly chartFailure: { readonly code: string; readonly message: string } | null;
  readonly onRetryChart: () => void;
  readonly onOpenCoaMapper: () => void;
  readonly draft: DriverPlanDraft;
  readonly onChangeDraft: (next: DriverPlanDraft) => void;
  readonly previewResult: DriverPlanPreviewResponse | null;
  readonly commitResult: DriverPlanCommitResponse | null;
  readonly actionBusy: 'preview' | 'commit' | null;
  readonly actionFailure: DriverAuthoringFailure | null;
  readonly onPreview: () => void;
  readonly onCommit: () => void;
  readonly onRetryAction: () => void;
}): ReactElement {
  const { draft, periods, onChangeDraft, actionBusy } = props;
  const [expandedPvIds, setExpandedPvIds] = useState<Readonly<Record<string, boolean>>>({});

  const postableAccounts = props.accounts.filter((account) => account.active && account.isPostable);
  const defaultAccount = postableAccounts[0]?.code ?? '';

  const updateRow = (rowId: string, patch: Partial<DriverRowDraft>): void => {
    onChangeDraft({
      ...draft,
      drivers: draft.drivers.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    });
  };

  const addDriverRow = (): void => {
    const nextOrdinal = draft.drivers.length + 1;
    const uniqueId = `driver-${String(nextOrdinal)}-${String(Date.now())}`;
    onChangeDraft({
      ...draft,
      drivers: [...draft.drivers, createEmptyDriverRow(uniqueId, defaultAccount)],
    });
  };

  const removeDriverRow = (rowId: string): void => {
    if (draft.drivers.length <= 1) return;
    onChangeDraft({
      ...draft,
      drivers: draft.drivers.filter((row) => row.id !== rowId),
    });
  };

  const addOverride = (row: DriverRowDraft): void => {
    const used = new Set(row.overrides.map((ov) => ov.periodCode));
    const nextPeriod = periods.find((code) => !used.has(code)) ?? periods[0] ?? 'P01';
    const overrideId = `ov-${row.id}-${String(row.overrides.length + 1)}-${String(Date.now())}`;
    updateRow(row.id, {
      overrides: [...row.overrides, { id: overrideId, periodCode: nextPeriod, amount: '' }],
    });
  };

  const togglePvGrid = (rowId: string): void => {
    setExpandedPvIds((prev) => ({ ...prev, [rowId]: !prev[rowId] }));
  };

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Author driver plan</h3>
          <p className="mt-1 text-xs text-slate-600">
            Define fixed, growth, ratio, or price-times-volume drivers with optional period overrides.
            Preview evaluates on the server without writing; commit saves an audited plan version and
            refreshes the rolling forecast and comparison tables.
          </p>
        </div>
        <p className="font-mono text-xs text-slate-600">
          FY{String(props.fiscalYear)} · {periods[0] ?? 'P01'}–{periods[periods.length - 1] ?? 'P12'} (
          {String(periods.length)} periods) · {props.currency}
        </p>
      </div>

      {props.chartState === 'loading' && (
        <LoadingState label="Loading chart of accounts for driver target selection..." />
      )}
      {props.chartState === 'error' && props.chartFailure !== null && (
        <InlineErrorState
          code={props.chartFailure.code}
          message={props.chartFailure.message}
          onRetry={props.onRetryChart}
        />
      )}
      {props.chartState === 'idle' && postableAccounts.length === 0 && (
        <div className="space-y-2">
          <PartialBanner detail="No active postable accounts exist for this company yet. Import a Chart of Accounts before committing a driver plan." />
          <button
            type="button"
            onClick={props.onOpenCoaMapper}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Open CoA Mapper
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="driver-scenario-name" className="block text-xs font-medium text-slate-600">
            Scenario name
          </label>
          <input
            id="driver-scenario-name"
            type="text"
            value={draft.scenarioName}
            disabled={actionBusy !== null}
            onChange={(event) => onChangeDraft({ ...draft, scenarioName: event.target.value })}
            placeholder="FY2026 Base Forecast"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label htmlFor="driver-scenario-kind" className="block text-xs font-medium text-slate-600">
            Scenario kind
          </label>
          <select
            id="driver-scenario-kind"
            value={draft.scenarioKind}
            disabled={actionBusy !== null}
            onChange={(event) =>
              onChangeDraft({ ...draft, scenarioKind: event.target.value as ScenarioKind })
            }
            className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
          >
            <option value="forecast">forecast</option>
            <option value="budget">budget</option>
          </select>
        </div>
      </div>

      <div className="space-y-3">
        {draft.drivers.map((row, rowIndex) => {
          const pvExpanded = Boolean(expandedPvIds[row.id]);
          const rowPrefix = `driver-${row.id}`;
          return (
            <article key={row.id} className="space-y-3 rounded border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                  Driver {String(rowIndex + 1)}
                </h4>
                <button
                  type="button"
                  disabled={draft.drivers.length <= 1 || actionBusy !== null}
                  onClick={() => removeDriverRow(row.id)}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Remove driver
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <div>
                  <label htmlFor={`${rowPrefix}-kind`} className="block text-xs font-medium text-slate-600">
                    Driver kind
                  </label>
                  <select
                    id={`${rowPrefix}-kind`}
                    value={row.kind}
                    disabled={actionBusy !== null}
                    onChange={(event) =>
                      updateRow(row.id, { kind: event.target.value as DriverKind })
                    }
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                  >
                    {DRIVER_KIND_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor={`${rowPrefix}-key`} className="block text-xs font-medium text-slate-600">
                    Driver key
                  </label>
                  <input
                    id={`${rowPrefix}-key`}
                    type="text"
                    value={row.driverKey}
                    disabled={actionBusy !== null}
                    onChange={(event) => updateRow(row.id, { driverKey: event.target.value })}
                    placeholder="rev_core"
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm"
                  />
                </div>

                <div>
                  <label
                    htmlFor={`${rowPrefix}-account`}
                    className="block text-xs font-medium text-slate-600"
                  >
                    Target account
                  </label>
                  {postableAccounts.length > 0 ? (
                    <select
                      id={`${rowPrefix}-account`}
                      value={row.accountCode}
                      disabled={actionBusy !== null}
                      onChange={(event) => updateRow(row.id, { accountCode: event.target.value })}
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm"
                    >
                      <option value="">Select account</option>
                      {postableAccounts.map((account) => (
                        <option key={account.code} value={account.code}>
                          {account.code} — {account.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`${rowPrefix}-account`}
                      type="text"
                      value={row.accountCode}
                      disabled={actionBusy !== null}
                      onChange={(event) => updateRow(row.id, { accountCode: event.target.value })}
                      placeholder="4000"
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm"
                    />
                  )}
                </div>

                <div>
                  <label
                    htmlFor={`${rowPrefix}-assumption`}
                    className="block text-xs font-medium text-slate-600"
                  >
                    Assumption label
                  </label>
                  <input
                    id={`${rowPrefix}-assumption`}
                    type="text"
                    value={row.assumptionLabel}
                    disabled={actionBusy !== null}
                    onChange={(event) => updateRow(row.id, { assumptionLabel: event.target.value })}
                    placeholder="Core subscription plan"
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                  />
                </div>
              </div>

              {row.kind === 'fixed' && (
                <div className="max-w-xs">
                  <label
                    htmlFor={`${rowPrefix}-amount`}
                    className="block text-xs font-medium text-slate-600"
                  >
                    Amount per period ({props.currency})
                  </label>
                  <input
                    id={`${rowPrefix}-amount`}
                    type="text"
                    value={row.amount}
                    disabled={actionBusy !== null}
                    onChange={(event) => updateRow(row.id, { amount: event.target.value })}
                    placeholder="1000.00"
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm"
                  />
                </div>
              )}

              {row.kind === 'growth_rate' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor={`${rowPrefix}-base-amount`}
                      className="block text-xs font-medium text-slate-600"
                    >
                      Base amount ({periods[0] ?? 'P01'})
                    </label>
                    <input
                      id={`${rowPrefix}-base-amount`}
                      type="text"
                      value={row.baseAmount}
                      disabled={actionBusy !== null}
                      onChange={(event) => updateRow(row.id, { baseAmount: event.target.value })}
                      placeholder="1000.00"
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`${rowPrefix}-rate`}
                      className="block text-xs font-medium text-slate-600"
                    >
                      Growth rate per period (decimal ratio)
                    </label>
                    <input
                      id={`${rowPrefix}-rate`}
                      type="text"
                      value={row.ratePerPeriod}
                      disabled={actionBusy !== null}
                      onChange={(event) => updateRow(row.id, { ratePerPeriod: event.target.value })}
                      placeholder="0.05"
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm"
                    />
                  </div>
                </div>
              )}

              {row.kind === 'percent_of_account' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor={`${rowPrefix}-source-account`}
                      className="block text-xs font-medium text-slate-600"
                    >
                      Source account
                    </label>
                    {postableAccounts.length > 0 ? (
                      <select
                        id={`${rowPrefix}-source-account`}
                        value={row.sourceAccountCode}
                        disabled={actionBusy !== null}
                        onChange={(event) =>
                          updateRow(row.id, { sourceAccountCode: event.target.value })
                        }
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm"
                      >
                        <option value="">Select source account</option>
                        {postableAccounts.map((account) => (
                          <option key={account.code} value={account.code}>
                            {account.code} — {account.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`${rowPrefix}-source-account`}
                        type="text"
                        value={row.sourceAccountCode}
                        disabled={actionBusy !== null}
                        onChange={(event) =>
                          updateRow(row.id, { sourceAccountCode: event.target.value })
                        }
                        placeholder="4000"
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm"
                      />
                    )}
                  </div>
                  <div>
                    <label
                      htmlFor={`${rowPrefix}-ratio`}
                      className="block text-xs font-medium text-slate-600"
                    >
                      Ratio of source account (decimal)
                    </label>
                    <input
                      id={`${rowPrefix}-ratio`}
                      type="text"
                      value={row.ratio}
                      disabled={actionBusy !== null}
                      onChange={(event) => updateRow(row.id, { ratio: event.target.value })}
                      placeholder="0.30"
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm"
                    />
                  </div>
                </div>
              )}

              {row.kind === 'price_times_volume' && (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor={`${rowPrefix}-unit-price`}
                        className="block text-xs font-medium text-slate-600"
                      >
                        Default unit price ({props.currency})
                      </label>
                      <input
                        id={`${rowPrefix}-unit-price`}
                        type="text"
                        value={row.unitPrice}
                        disabled={actionBusy !== null}
                        onChange={(event) => updateRow(row.id, { unitPrice: event.target.value })}
                        placeholder="50.00"
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`${rowPrefix}-volume`}
                        className="block text-xs font-medium text-slate-600"
                      >
                        Default volume
                      </label>
                      <input
                        id={`${rowPrefix}-volume`}
                        type="text"
                        value={row.volume}
                        disabled={actionBusy !== null}
                        onChange={(event) => updateRow(row.id, { volume: event.target.value })}
                        placeholder="20"
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={() => togglePvGrid(row.id)}
                      className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      {pvExpanded ? 'Hide per-period price & volume' : 'Customize per-period price & volume'}
                    </button>
                  </div>
                  {pvExpanded && (
                    <div className="overflow-x-auto rounded border border-slate-200 bg-white">
                      <table className="min-w-full divide-y divide-slate-200 text-xs">
                        <caption className="sr-only">Per-period unit price and volume overrides</caption>
                        <thead className="bg-slate-50 text-left font-medium text-slate-600">
                          <tr>
                            <th scope="col" className="px-2 py-1.5">Period</th>
                            <th scope="col" className="px-2 py-1.5">Unit price</th>
                            <th scope="col" className="px-2 py-1.5">Volume</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {periods.map((periodCode) => (
                            <tr key={periodCode}>
                              <th scope="row" className="px-2 py-1 font-mono text-slate-700">
                                {periodCode}
                              </th>
                              <td className="px-2 py-1">
                                <input
                                  type="text"
                                  aria-label={`${periodCode} unit price`}
                                  value={row.unitPriceByPeriod[periodCode] ?? ''}
                                  disabled={actionBusy !== null}
                                  onChange={(event) =>
                                    updateRow(row.id, {
                                      unitPriceByPeriod: {
                                        ...row.unitPriceByPeriod,
                                        [periodCode]: event.target.value,
                                      },
                                    })
                                  }
                                  placeholder={row.unitPrice || 'default'}
                                  className="w-full rounded border border-slate-300 px-2 py-1 font-mono"
                                />
                              </td>
                              <td className="px-2 py-1">
                                <input
                                  type="text"
                                  aria-label={`${periodCode} volume`}
                                  value={row.volumeByPeriod[periodCode] ?? ''}
                                  disabled={actionBusy !== null}
                                  onChange={(event) =>
                                    updateRow(row.id, {
                                      volumeByPeriod: {
                                        ...row.volumeByPeriod,
                                        [periodCode]: event.target.value,
                                      },
                                    })
                                  }
                                  placeholder={row.volume || 'default'}
                                  className="w-full rounded border border-slate-300 px-2 py-1 font-mono"
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2 border-t border-slate-200 pt-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-600">
                    Period overrides ({String(row.overrides.length)})
                  </span>
                  <button
                    type="button"
                    disabled={actionBusy !== null}
                    onClick={() => addOverride(row)}
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    + Add period override
                  </button>
                </div>
                {row.overrides.map((overrideRow) => (
                  <div key={overrideRow.id} className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label="Override period"
                      value={overrideRow.periodCode}
                      disabled={actionBusy !== null}
                      onChange={(event) =>
                        updateRow(row.id, {
                          overrides: row.overrides.map((item) =>
                            item.id === overrideRow.id
                              ? { ...item, periodCode: event.target.value }
                              : item,
                          ),
                        })
                      }
                      className="rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs"
                    >
                      {periods.map((periodCode) => (
                        <option key={periodCode} value={periodCode}>
                          {periodCode}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      aria-label={`Override amount for ${overrideRow.periodCode}`}
                      value={overrideRow.amount}
                      disabled={actionBusy !== null}
                      onChange={(event) =>
                        updateRow(row.id, {
                          overrides: row.overrides.map((item) =>
                            item.id === overrideRow.id
                              ? { ...item, amount: event.target.value }
                              : item,
                          ),
                        })
                      }
                      placeholder="1250.00"
                      className="rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs"
                    />
                    <button
                      type="button"
                      disabled={actionBusy !== null}
                      onClick={() =>
                        updateRow(row.id, {
                          overrides: row.overrides.filter((item) => item.id !== overrideRow.id),
                        })
                      }
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                    >
                      Remove override
                    </button>
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={actionBusy !== null}
          onClick={addDriverRow}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          + Add driver
        </button>
        <button
          type="button"
          disabled={actionBusy !== null}
          onClick={props.onPreview}
          className="rounded border border-slate-900 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Preview driver plan
        </button>
        <button
          type="button"
          disabled={actionBusy !== null}
          onClick={props.onCommit}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Commit plan version
        </button>
      </div>

      {actionBusy === 'preview' && (
        <LoadingState label="Evaluating driver formulas and dependencies on the server..." />
      )}
      {actionBusy === 'commit' && (
        <LoadingState label="Validating accounts and committing versioned plan lines..." />
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
              aria-label="Driver validation issues"
              className="list-disc space-y-1 rounded border border-red-200 bg-red-50 px-6 py-3 font-mono text-xs text-red-900"
            >
              {props.actionFailure.issues.map((issue, idx) => (
                <li key={`${String(idx)}-${issue}`}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {props.commitResult !== null && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-950"
        >
          Committed scenario &quot;{props.commitResult.scenarioName}&quot; ({props.commitResult.scenarioKind})
          {' '}as plan version v{String(props.commitResult.versionNo)} ·{' '}
          {String(props.commitResult.lineCount)} plan lines · grand total {props.commitResult.grandTotal}{' '}
          {props.currency} · audited.
        </div>
      )}

      {props.previewResult !== null && (
        <DriverPlanPreviewTable report={props.previewResult} currency={props.currency} />
      )}
    </section>
  );
}
