import {
  add,
  div,
  money,
  mul,
  negate,
  round,
  serialize,
  STORAGE_SCALE,
  sub,
  type Money,
} from '../money/index.js';

function roundToStorage(value: Money): Money {
  return round(value, STORAGE_SCALE, 'HALF_UP');
}

function formatMoney(value: Money, scale: number): string {
  return serialize(round(value, scale, 'HALF_UP'), scale);
}

export type DriverKind = 'fixed' | 'growth_rate' | 'percent_of_account' | 'price_times_volume';

export interface FixedDriverDefinition {
  readonly kind: 'fixed';
  readonly driverKey: string;
  readonly accountCode: string;
  readonly assumptionLabel: string;
  /** Default constant amount per period (canonical decimal string). */
  readonly amount: string;
  /** Optional per-period explicit overrides (periodCode -> canonical decimal string). */
  readonly periodOverrides?: Readonly<Record<string, string>>;
}

export interface GrowthRateDriverDefinition {
  readonly kind: 'growth_rate';
  readonly driverKey: string;
  readonly accountCode: string;
  readonly assumptionLabel: string;
  /** Starting amount in the first period (canonical decimal string). */
  readonly baseAmount: string;
  /** Per-period compounding rate, e.g. "0.05" for +5% per period. */
  readonly ratePerPeriod: string;
  /** Optional per-period explicit overrides (periodCode -> canonical decimal string). */
  readonly periodOverrides?: Readonly<Record<string, string>>;
}

export interface PercentOfAccountDriverDefinition {
  readonly kind: 'percent_of_account';
  readonly driverKey: string;
  readonly accountCode: string;
  readonly assumptionLabel: string;
  /** Target account code whose computed value in the same period is multiplied by ratio. */
  readonly sourceAccountCode: string;
  /** Ratio applied to source account, e.g. "0.35" for 35%. */
  readonly ratio: string;
  /** Optional per-period explicit overrides (periodCode -> canonical decimal string). */
  readonly periodOverrides?: Readonly<Record<string, string>>;
}

export interface PriceTimesVolumeDriverDefinition {
  readonly kind: 'price_times_volume';
  readonly driverKey: string;
  readonly accountCode: string;
  readonly assumptionLabel: string;
  /** Unit price per period (periodCode -> canonical decimal string). */
  readonly unitPriceByPeriod: Readonly<Record<string, string>>;
  /** Volume per period (periodCode -> canonical decimal string). */
  readonly volumeByPeriod: Readonly<Record<string, string>>;
  /** Optional per-period explicit overrides (periodCode -> canonical decimal string). */
  readonly periodOverrides?: Readonly<Record<string, string>>;
}

export type DriverDefinition =
  | FixedDriverDefinition
  | GrowthRateDriverDefinition
  | PercentOfAccountDriverDefinition
  | PriceTimesVolumeDriverDefinition;

export interface ComputedPlanLine {
  readonly accountCode: string;
  readonly periodCode: string;
  readonly amount: string;
  readonly source: 'driver' | 'override';
  readonly driverKey: string;
  readonly assumptionLabel: string;
}

export interface DriverPlanResult {
  readonly ok: true;
  readonly currencyScale: 0 | 2 | 3;
  readonly periods: readonly string[];
  readonly lines: readonly ComputedPlanLine[];
  readonly totalsByAccount: Readonly<Record<string, string>>;
  readonly totalsByPeriod: Readonly<Record<string, string>>;
  readonly grandTotal: string;
}

export interface DriverPlanError {
  readonly ok: false;
  readonly issues: readonly string[];
}

export type ComputeDriverPlanOutcome = DriverPlanResult | DriverPlanError;

function normalizeCode(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

function sortDriversTopologically(
  drivers: readonly DriverDefinition[],
): { readonly ordered: readonly DriverDefinition[]; readonly issues: readonly string[] } {
  const issues: string[] = [];
  const byAccount = new Map<string, DriverDefinition>();

  for (const d of drivers) {
    const code = normalizeCode(d.accountCode);
    if (!code) {
      issues.push(`EMPTY_ACCOUNT_CODE:${d.driverKey}`);
      continue;
    }
    if (byAccount.has(code)) {
      issues.push(`DUPLICATE_DRIVER_ACCOUNT:${code}`);
      continue;
    }
    byAccount.set(code, d);
  }

  if (issues.length > 0) {
    return { ordered: [], issues };
  }

  // Validate references for percent_of_account drivers
  for (const d of drivers) {
    if (d.kind === 'percent_of_account') {
      const target = normalizeCode(d.sourceAccountCode);
      const self = normalizeCode(d.accountCode);
      if (target === self) {
        issues.push(`SELF_REFERENCE_DRIVER:${self}`);
      } else if (!byAccount.has(target)) {
        issues.push(`UNKNOWN_DRIVER_SOURCE:${d.driverKey}->${target}`);
      }
    }
  }

  if (issues.length > 0) {
    return { ordered: [], issues };
  }

  // Kahn's topological sort
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const code of byAccount.keys()) {
    inDegree.set(code, 0);
    dependents.set(code, []);
  }

  for (const [code, d] of byAccount.entries()) {
    if (d.kind === 'percent_of_account') {
      const src = normalizeCode(d.sourceAccountCode);
      inDegree.set(code, (inDegree.get(code) ?? 0) + 1);
      dependents.get(src)?.push(code);
    }
  }

  const queue: string[] = [];
  for (const [code, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(code);
  }
  queue.sort();

  const ordered: DriverDefinition[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const def = byAccount.get(current);
    if (def) ordered.push(def);
    const deps = dependents.get(current) ?? [];
    for (const dep of deps) {
      const nextDeg = (inDegree.get(dep) ?? 1) - 1;
      inDegree.set(dep, nextDeg);
      if (nextDeg === 0) {
        queue.push(dep);
        queue.sort();
      }
    }
  }

  if (ordered.length !== byAccount.size) {
    const remaining = [...byAccount.keys()].filter(
      (c) => !ordered.some((d) => normalizeCode(d.accountCode) === c),
    );
    remaining.sort();
    issues.push(`CYCLE_DETECTED:${remaining.join(',')}`);
    return { ordered: [], issues };
  }

  return { ordered, issues: [] };
}

/**
 * Deterministically evaluates driver-based plan lines across an ordered list of periods.
 * All arithmetic uses decimal.js via /core/money; outputs are rounded to currencyScale at
 * presentation while retaining storage-scale precision during compounding.
 */
export function computeDriverPlan(params: {
  readonly periods: readonly string[];
  readonly drivers: readonly DriverDefinition[];
  readonly currencyScale?: 0 | 2 | 3;
}): ComputeDriverPlanOutcome {
  const currencyScale: 0 | 2 | 3 = params.currencyScale ?? 2;
  const periods = params.periods.map((p) => p.trim()).filter((p) => p.length > 0);

  if (periods.length === 0) {
    return { ok: false, issues: ['EMPTY_PERIODS'] };
  }

  const seenPeriods = new Set<string>();
  for (const p of periods) {
    if (seenPeriods.has(p)) {
      return { ok: false, issues: [`DUPLICATE_PERIOD:${p}`] };
    }
    seenPeriods.add(p);
  }

  const { ordered, issues } = sortDriversTopologically(params.drivers);
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const computedGrid = new Map<string, Map<string, Money>>();
  const lines: ComputedPlanLine[] = [];
  const runtimeIssues: string[] = [];

  for (const driver of ordered) {
    const accountCode = normalizeCode(driver.accountCode);
    const accountMap = new Map<string, Money>();
    computedGrid.set(accountCode, accountMap);

    let runningGrowthValue: Money | null = null;

    for (let i = 0; i < periods.length; i += 1) {
      const periodCode = periods[i]!;
      const overrideStr = driver.periodOverrides?.[periodCode];

      let rawValue: Money;
      let source: 'driver' | 'override' = 'driver';

      if (overrideStr !== undefined) {
        try {
          rawValue = roundToStorage(money(overrideStr));
          source = 'override';
        } catch {
          runtimeIssues.push(`INVALID_OVERRIDE_AMOUNT:${driver.driverKey}/${periodCode}`);
          continue;
        }
        if (driver.kind === 'growth_rate') {
          runningGrowthValue = rawValue;
        }
      } else if (driver.kind === 'fixed') {
        try {
          rawValue = roundToStorage(money(driver.amount));
        } catch {
          runtimeIssues.push(`INVALID_FIXED_AMOUNT:${driver.driverKey}`);
          continue;
        }
      } else if (driver.kind === 'growth_rate') {
        try {
          if (i === 0 || runningGrowthValue === null) {
            rawValue = roundToStorage(money(driver.baseAmount));
          } else {
            const factor = add(money('1'), money(driver.ratePerPeriod));
            rawValue = roundToStorage(mul(runningGrowthValue, factor));
          }
          runningGrowthValue = rawValue;
        } catch {
          runtimeIssues.push(`INVALID_GROWTH_PARAM:${driver.driverKey}`);
          continue;
        }
      } else if (driver.kind === 'percent_of_account') {
        const srcCode = normalizeCode(driver.sourceAccountCode);
        const srcVal = computedGrid.get(srcCode)?.get(periodCode);
        if (srcVal === undefined) {
          runtimeIssues.push(`MISSING_SOURCE_VALUE:${driver.driverKey}/${periodCode}`);
          continue;
        }
        try {
          rawValue = roundToStorage(mul(srcVal, money(driver.ratio)));
        } catch {
          runtimeIssues.push(`INVALID_RATIO:${driver.driverKey}`);
          continue;
        }
      } else {
        const priceStr = driver.unitPriceByPeriod[periodCode];
        const volStr = driver.volumeByPeriod[periodCode];
        if (priceStr === undefined || volStr === undefined) {
          runtimeIssues.push(`MISSING_PRICE_OR_VOLUME:${driver.driverKey}/${periodCode}`);
          continue;
        }
        try {
          rawValue = roundToStorage(mul(money(priceStr), money(volStr)));
        } catch {
          runtimeIssues.push(`INVALID_PRICE_OR_VOLUME:${driver.driverKey}/${periodCode}`);
          continue;
        }
      }

      const displayValue = money(formatMoney(rawValue, currencyScale));
      accountMap.set(periodCode, displayValue);
      lines.push({
        accountCode,
        periodCode,
        amount: formatMoney(displayValue, currencyScale),
        source,
        driverKey: driver.driverKey,
        assumptionLabel: driver.assumptionLabel,
      });
    }
  }

  if (runtimeIssues.length > 0) {
    return { ok: false, issues: runtimeIssues };
  }

  const totalsByAccount: Record<string, string> = {};
  const periodAccum = new Map<string, Money>();
  for (const p of periods) {
    periodAccum.set(p, money('0'));
  }

  let grandTotalMoney = money('0');
  for (const [accountCode, pMap] of computedGrid.entries()) {
    let accTotal = money('0');
    for (const p of periods) {
      const cell = pMap.get(p) ?? money('0');
      accTotal = add(accTotal, cell);
      periodAccum.set(p, add(periodAccum.get(p) ?? money('0'), cell));
      grandTotalMoney = add(grandTotalMoney, cell);
    }
    totalsByAccount[accountCode] = formatMoney(accTotal, currencyScale);
  }

  const totalsByPeriod: Record<string, string> = {};
  for (const p of periods) {
    totalsByPeriod[p] = formatMoney(periodAccum.get(p) ?? money('0'), currencyScale);
  }

  return {
    ok: true,
    currencyScale,
    periods,
    lines,
    totalsByAccount,
    totalsByPeriod,
    grandTotal: formatMoney(grandTotalMoney, currencyScale),
  };
}

// ============================================================================
// Rolling Forecast Engine (Actuals through cutoff + Forecast for open periods)
// ============================================================================

export interface PeriodAmountFact {
  readonly accountCode: string;
  readonly periodCode: string;
  readonly amount: string;
}

export interface RollingForecastCell {
  readonly periodCode: string;
  readonly basis: 'actual' | 'forecast';
  /** Canonical decimal string, or null when data is absent (Null Law §3.1). */
  readonly amount: string | null;
}

export interface RollingForecastAccountRow {
  readonly accountCode: string;
  readonly cells: readonly RollingForecastCell[];
  readonly actualSubtotal: string;
  readonly forecastSubtotal: string;
  readonly fullHorizonTotal: string;
  readonly missingCellCount: number;
}

export interface RollingForecastReport {
  readonly ok: true;
  readonly cutoffPeriod: string;
  readonly periods: readonly string[];
  readonly actualPeriods: readonly string[];
  readonly forecastPeriods: readonly string[];
  readonly rows: readonly RollingForecastAccountRow[];
  readonly totalActual: string;
  readonly totalForecast: string;
  readonly totalFullHorizon: string;
  readonly totalMissingCells: number;
}

export interface RollingForecastError {
  readonly ok: false;
  readonly issues: readonly string[];
}

export type BuildRollingForecastOutcome = RollingForecastReport | RollingForecastError;

/**
 * Combines closed actuals (periods <= cutoffPeriod) with forecast lines (periods > cutoffPeriod).
 * Absent cells remain null and are explicitly counted; actuals and forecast are never conflated.
 */
export function buildRollingForecast(params: {
  readonly periods: readonly string[];
  /** Last closed actual period (inclusive). Pass null for a pure forecast horizon. */
  readonly cutoffPeriod: string | null;
  readonly actuals: readonly PeriodAmountFact[];
  readonly forecast: readonly PeriodAmountFact[];
  readonly currencyScale?: 0 | 2 | 3;
}): BuildRollingForecastOutcome {
  const currencyScale: 0 | 2 | 3 = params.currencyScale ?? 2;
  const periods = params.periods.map((p) => p.trim()).filter((p) => p.length > 0);
  if (periods.length === 0) {
    return { ok: false, issues: ['EMPTY_PERIODS'] };
  }

  let cutoffIndex = -1;
  if (params.cutoffPeriod !== null) {
    cutoffIndex = periods.indexOf(params.cutoffPeriod.trim());
    if (cutoffIndex === -1) {
      return { ok: false, issues: [`UNKNOWN_CUTOFF_PERIOD:${params.cutoffPeriod}`] };
    }
  }

  const actualPeriods = periods.slice(0, cutoffIndex + 1);
  const forecastPeriods = periods.slice(cutoffIndex + 1);

  const actualMap = new Map<string, Money>();
  const forecastMap = new Map<string, Money>();
  const accountCodes = new Set<string>();

  for (const fact of params.actuals) {
    const code = normalizeCode(fact.accountCode);
    const key = `${code}::${fact.periodCode.trim()}`;
    accountCodes.add(code);
    actualMap.set(key, add(actualMap.get(key) ?? money('0'), money(fact.amount)));
  }

  for (const fact of params.forecast) {
    const code = normalizeCode(fact.accountCode);
    const key = `${code}::${fact.periodCode.trim()}`;
    accountCodes.add(code);
    forecastMap.set(key, add(forecastMap.get(key) ?? money('0'), money(fact.amount)));
  }

  const sortedAccounts = [...accountCodes].sort();
  const rows: RollingForecastAccountRow[] = [];

  let totalActual = money('0');
  let totalForecast = money('0');
  let missingCount = 0;

  for (const accountCode of sortedAccounts) {
    const cells: RollingForecastCell[] = [];
    let accActual = money('0');
    let accForecast = money('0');
    let missingCellCount = 0;

    for (let i = 0; i < periods.length; i += 1) {
      const periodCode = periods[i]!;
      const basis: 'actual' | 'forecast' = i <= cutoffIndex ? 'actual' : 'forecast';
      const key = `${accountCode}::${periodCode}`;
      const val = basis === 'actual' ? actualMap.get(key) : forecastMap.get(key);

      if (val === undefined) {
        missingCellCount += 1;
        cells.push({ periodCode, basis, amount: null });
      } else {
        const formatted = formatMoney(val, currencyScale);
        const rounded = money(formatted);
        if (basis === 'actual') {
          accActual = add(accActual, rounded);
        } else {
          accForecast = add(accForecast, rounded);
        }
        cells.push({ periodCode, basis, amount: formatted });
      }
    }

    const fullHorizon = add(accActual, accForecast);
    totalActual = add(totalActual, accActual);
    totalForecast = add(totalForecast, accForecast);
    missingCount = missingCount + missingCellCount;

    rows.push({
      accountCode,
      cells,
      actualSubtotal: formatMoney(accActual, currencyScale),
      forecastSubtotal: formatMoney(accForecast, currencyScale),
      fullHorizonTotal: formatMoney(fullHorizon, currencyScale),
      missingCellCount,
    });
  }

  return {
    ok: true,
    cutoffPeriod: params.cutoffPeriod ?? 'NONE',
    periods,
    actualPeriods,
    forecastPeriods,
    rows,
    totalActual: formatMoney(totalActual, currencyScale),
    totalForecast: formatMoney(totalForecast, currencyScale),
    totalFullHorizon: formatMoney(add(totalActual, totalForecast), currencyScale),
    totalMissingCells: missingCount,
  };
}

// ============================================================================
// Scenario Comparison (Base vs Target, §3.5 zero-base rules)
// ============================================================================

export interface ScenarioComparisonRow {
  readonly accountCode: string;
  readonly baseTotal: string | null;
  readonly targetTotal: string | null;
  readonly deltaAmount: string | null;
  readonly deltaPct: string | null;
  readonly deltaPctStatus: 'computed' | 'zero' | 'nm' | 'null';
}

export interface ScenarioComparisonReport {
  readonly baseScenarioName: string;
  readonly targetScenarioName: string;
  readonly rows: readonly ScenarioComparisonRow[];
  readonly totalBase: string;
  readonly totalTarget: string;
  readonly totalDelta: string;
}

function absMoney(value: Money): Money {
  return value.isNegative() ? negate(value) : value;
}

/**
 * Compares two scenarios account-by-account using §3.5 zero-base rules.
 * Accounts missing from one scenario keep null on that side (never fabricated as zero).
 */
export function compareScenarios(params: {
  readonly baseScenarioName: string;
  readonly targetScenarioName: string;
  readonly baseLines: readonly PeriodAmountFact[];
  readonly targetLines: readonly PeriodAmountFact[];
  readonly currencyScale?: 0 | 2 | 3;
}): ScenarioComparisonReport {
  const currencyScale: 0 | 2 | 3 = params.currencyScale ?? 2;
  const baseTotals = new Map<string, Money>();
  const targetTotals = new Map<string, Money>();
  const accounts = new Set<string>();

  for (const line of params.baseLines) {
    const code = normalizeCode(line.accountCode);
    accounts.add(code);
    baseTotals.set(code, add(baseTotals.get(code) ?? money('0'), money(line.amount)));
  }

  for (const line of params.targetLines) {
    const code = normalizeCode(line.accountCode);
    accounts.add(code);
    targetTotals.set(code, add(targetTotals.get(code) ?? money('0'), money(line.amount)));
  }

  const sortedAccounts = [...accounts].sort();
  const rows: ScenarioComparisonRow[] = [];
  let grandBase = money('0');
  let grandTarget = money('0');

  for (const accountCode of sortedAccounts) {
    const b = baseTotals.get(accountCode);
    const t = targetTotals.get(accountCode);

    if (b !== undefined) grandBase = add(grandBase, b);
    if (t !== undefined) grandTarget = add(grandTarget, t);

    if (b === undefined || t === undefined) {
      rows.push({
        accountCode,
        baseTotal: b === undefined ? null : formatMoney(b, currencyScale),
        targetTotal: t === undefined ? null : formatMoney(t, currencyScale),
        deltaAmount: null,
        deltaPct: null,
        deltaPctStatus: 'null',
      });
      continue;
    }

    const delta = sub(t, b);
    let deltaPct: string | null = null;
    let deltaPctStatus: 'computed' | 'zero' | 'nm' = 'computed';

    if (b.isZero() && t.isZero()) {
      deltaPct = '0.00%';
      deltaPctStatus = 'zero';
    } else if (b.isZero()) {
      deltaPct = 'n/m';
      deltaPctStatus = 'nm';
    } else {
      const ratio = div(delta, absMoney(b), 6, 'HALF_UP');
      if (ratio === null) {
        deltaPct = 'n/m';
        deltaPctStatus = 'nm';
      } else {
        const pct = mul(ratio, money('100'));
        deltaPct = `${formatMoney(pct, 2)}%`;
        deltaPctStatus = 'computed';
      }
    }

    rows.push({
      accountCode,
      baseTotal: formatMoney(b, currencyScale),
      targetTotal: formatMoney(t, currencyScale),
      deltaAmount: formatMoney(delta, currencyScale),
      deltaPct,
      deltaPctStatus,
    });
  }

  return {
    baseScenarioName: params.baseScenarioName,
    targetScenarioName: params.targetScenarioName,
    rows,
    totalBase: formatMoney(grandBase, currencyScale),
    totalTarget: formatMoney(grandTarget, currencyScale),
    totalDelta: formatMoney(sub(grandTarget, grandBase), currencyScale),
  };
}
