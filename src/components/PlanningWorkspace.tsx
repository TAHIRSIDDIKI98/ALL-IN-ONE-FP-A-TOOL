import type { ReactElement } from 'react';
import type {
  RollingForecastResponse,
  ScenarioComparisonResponse,
  ScenarioSummary,
} from '../../shared/planning.js';

type ScenarioComparisonRow = ScenarioComparisonResponse['rows'][number];
import { PartialBanner } from './StateFrame.js';

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
