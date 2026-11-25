// Implements MASTER_PROMPT §5.7 Variance & PVM contracts inside /core/variance.
// Pure Decimal arithmetic with explicit division scale/mode, zero Math.abs, locked zero-base rules, account-type favorability, and exact PVM decomposition. Oracle: core/statements/statements.test.ts.

import Decimal from 'decimal.js';
import { verifyPvmInvariant } from '../invariants.js';
import { add, allocate, div, money, mul, negate, serialize, sub, sum } from '../money/index.js';
import type { AccountType } from '../statements/index.js';

export type VariancePctKind = 'computed' | 'zero' | 'nm' | 'null';
export type Favorability = 'favorable' | 'unfavorable' | 'neutral' | 'na';

export interface VarianceBasis {
  readonly scenarioId: string;
  readonly planVersionId: string;
  readonly periodCode: string;
}

export interface VarianceResult {
  readonly accountType: AccountType;
  readonly actual: Decimal | null;
  readonly plan: Decimal | null;
  readonly varianceAmount: Decimal | null;
  readonly variancePctKind: VariancePctKind;
  readonly varianceRatio: Decimal | null;
  readonly variancePctFormatted: string | null;
  readonly favorability: Favorability;
  readonly basis: VarianceBasis;
}

function magnitudeWithoutAbs(value: Decimal): Decimal {
  return value.isNegative() ? negate(value) : value;
}

export function deriveFavorability(accountType: AccountType, varianceAmount: Decimal | null): Favorability {
  if (varianceAmount === null) {
    return 'na';
  }
  if (varianceAmount.isZero()) {
    return 'neutral';
  }
  const actualGreaterThanPlan = varianceAmount.isPositive();
  if (accountType === 'revenue' || accountType === 'asset') {
    return actualGreaterThanPlan ? 'favorable' : 'unfavorable';
  }
  // expense, liability, equity: lower actual expense/liability vs plan is favorable
  return actualGreaterThanPlan ? 'unfavorable' : 'favorable';
}

/**
 * Variance contract (§5.7):
 *   variance$ = actual - plan (always this direction)
 *   variance% = variance$ / |plan|
 *   plan == 0 && actual == 0 -> 0.00%
 *   plan == 0 && actual != 0 -> "n/m" (never Infinity, never 100%)
 */
export function computeVariance(params: {
  readonly accountType: AccountType;
  readonly actual: Decimal | null;
  readonly plan: Decimal | null;
  readonly basis: VarianceBasis;
}): VarianceResult {
  const { accountType, actual, plan, basis } = params;

  if (actual === null || plan === null) {
    return {
      accountType,
      actual,
      plan,
      varianceAmount: null,
      variancePctKind: 'null',
      varianceRatio: null,
      variancePctFormatted: null,
      favorability: 'na',
      basis,
    };
  }

  const varianceAmount = sub(actual, plan);
  const favorability = deriveFavorability(accountType, varianceAmount);

  if (plan.isZero()) {
    if (actual.isZero()) {
      return {
        accountType,
        actual,
        plan,
        varianceAmount,
        variancePctKind: 'zero',
        varianceRatio: money('0'),
        variancePctFormatted: '0.00%',
        favorability,
        basis,
      };
    }
    return {
      accountType,
      actual,
      plan,
      varianceAmount,
      variancePctKind: 'nm',
      varianceRatio: null,
      variancePctFormatted: 'n/m',
      favorability,
      basis,
    };
  }

  const planMag = magnitudeWithoutAbs(plan);
  const ratio = div(varianceAmount, planMag, 6, 'HALF_UP');
  if (ratio === null) {
    return {
      accountType,
      actual,
      plan,
      varianceAmount,
      variancePctKind: 'nm',
      varianceRatio: null,
      variancePctFormatted: 'n/m',
      favorability,
      basis,
    };
  }

  const pct = mul(ratio, '100').toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return {
    accountType,
    actual,
    plan,
    varianceAmount,
    variancePctKind: 'computed',
    varianceRatio: ratio,
    variancePctFormatted: `${pct.toFixed(2)}%`,
    favorability,
    basis,
  };
}

export interface PvmItemInput {
  readonly key: string;
  readonly planUnits: Decimal;
  readonly planPrice: Decimal;
  readonly actualUnits: Decimal;
  readonly actualPrice: Decimal;
}

export interface PvmDecompositionResult {
  readonly totalVariance: Decimal;
  readonly priceVariance: Decimal;
  readonly volumeVariance: Decimal;
  readonly mixVariance: Decimal;
  readonly invariantPassed: boolean;
}

/**
 * Price-Volume-Mix (PVM) decomposition (§5.7):
 *   Total Revenue Variance = Σ(actualUnits*actualPrice - planUnits*planPrice)
 *   Price Variance  = Σ(actualUnits * (actualPrice - planPrice))
 *   Volume Variance = (totalActualUnits - totalPlanUnits) * weightedAvgPlanPrice
 *   Mix Variance    = Σ((actualShare - planShare) * totalActualUnits * (planPrice - weightedAvgPlanPrice))
 *   Exact sum invariant: price + volume + mix == totalVariance (residuals allocated deterministically if rounded).
 */
export function computePvmDecomposition(
  items: readonly PvmItemInput[],
  scale = 2,
): PvmDecompositionResult {
  if (items.length === 0) {
    return {
      totalVariance: money('0'),
      priceVariance: money('0'),
      volumeVariance: money('0'),
      mixVariance: money('0'),
      invariantPassed: true,
    };
  }

  const totalPlanUnits = sum(items.map((i) => i.planUnits));
  const totalActualUnits = sum(items.map((i) => i.actualUnits));
  const totalPlanRev = sum(items.map((i) => mul(i.planUnits, i.planPrice)));
  const totalActualRev = sum(items.map((i) => mul(i.actualUnits, i.actualPrice)));
  const totalVarianceExact = sub(totalActualRev, totalPlanRev);

  const avgPlanPrice = totalPlanUnits.isZero()
    ? money('0')
    : totalPlanRev.dividedBy(totalPlanUnits);

  const rawPrice = sum(items.map((i) => mul(i.actualUnits, sub(i.actualPrice, i.planPrice))));
  const rawVolume = mul(sub(totalActualUnits, totalPlanUnits), avgPlanPrice);

  // Mix captures unit-share shift across items priced differently from portfolio average
  const rawMixParts: Decimal[] = [];
  for (const item of items) {
    const planShare = totalPlanUnits.isZero() ? money('0') : item.planUnits.dividedBy(totalPlanUnits);
    const actualShare = totalActualUnits.isZero() ? money('0') : item.actualUnits.dividedBy(totalActualUnits);
    const shareDelta = sub(actualShare, planShare);
    const expectedAtMixNeutral = mul(planShare, totalActualUnits);
    const mixUnitDelta = sub(item.actualUnits, expectedAtMixNeutral);
    void shareDelta;
    rawMixParts.push(mul(mixUnitDelta, sub(item.planPrice, avgPlanPrice)));
  }
  const rawMix = sum(rawMixParts);

  const exactSum = add(rawPrice, add(rawVolume, rawMix));
  const totalVariance = totalVarianceExact.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);

  // Use largest-remainder allocation over component magnitudes if rounding to presentation scale
  const priceMag = magnitudeWithoutAbs(rawPrice);
  const volumeMag = magnitudeWithoutAbs(rawVolume);
  const mixMag = magnitudeWithoutAbs(rawMix);
  const weightSum = add(priceMag, add(volumeMag, mixMag));

  let priceVariance: Decimal;
  let volumeVariance: Decimal;
  let mixVariance: Decimal;

  if (weightSum.isZero() || exactSum.isZero()) {
    priceVariance = rawPrice.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
    volumeVariance = rawVolume.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
    mixVariance = sub(totalVariance, add(priceVariance, volumeVariance));
  } else {
    const pRounded = rawPrice.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
    const vRounded = rawVolume.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
    const mRounded = rawMix.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
    const roundedSum = add(pRounded, add(vRounded, mRounded));
    const residual = sub(totalVariance, roundedSum);

    if (residual.isZero()) {
      priceVariance = pRounded;
      volumeVariance = vRounded;
      mixVariance = mRounded;
    } else {
      const residualSplits = allocate(
        residual,
        [
          { key: '1_price', weight: priceMag },
          { key: '2_volume', weight: volumeMag },
          { key: '3_mix', weight: mixMag },
        ],
        scale,
      );
      priceVariance = add(pRounded, residualSplits[0]!.amount);
      volumeVariance = add(vRounded, residualSplits[1]!.amount);
      mixVariance = add(mRounded, residualSplits[2]!.amount);
    }
  }

  const check = verifyPvmInvariant(totalVariance, priceVariance, volumeVariance, mixVariance);
  return {
    totalVariance,
    priceVariance,
    volumeVariance,
    mixVariance,
    invariantPassed: check.passed,
  };
}

export interface BudgetVarianceAccountInput {
  readonly accountCode: string;
  readonly accountName: string;
  readonly accountType: AccountType;
  /** Natural-sign ACTUAL activity as a canonical decimal string; null when there is none. */
  readonly actual: string | null;
  /**
   * Planned amount as a canonical decimal string, or null when NO plan line exists for this
   * account. A missing plan is never coerced to `0` (§5.7 zero-base rule).
   */
  readonly plan: string | null;
}

export interface BudgetVarianceRow {
  readonly accountCode: string;
  readonly accountName: string;
  readonly accountType: AccountType;
  readonly actual: string | null;
  readonly plan: string | null;
  readonly varianceAmount: string | null;
  readonly variancePctKind: VariancePctKind;
  readonly variancePctFormatted: string | null;
  readonly favorability: Favorability;
}

export interface BudgetVarianceTypeTotal {
  readonly accountType: AccountType;
  readonly actual: string;
  readonly plan: string;
  readonly varianceAmount: string;
}

export interface BudgetVarianceTotals {
  readonly actual: string;
  readonly plan: string;
  /** ACTUAL on rows that have no plan line; keeps `actual = plannedActual + unplannedActual` honest. */
  readonly unplannedActual: string;
  readonly varianceAmount: string;
  readonly plannedRows: number;
  readonly unplannedRows: number;
  readonly favorable: number;
  readonly unfavorable: number;
  readonly neutral: number;
  readonly na: number;
}

export interface BudgetVarianceResult {
  readonly rows: readonly BudgetVarianceRow[];
  readonly totals: BudgetVarianceTotals;
  readonly byType: readonly BudgetVarianceTypeTotal[];
}

/**
 * Budget-vs-Actual row model (§3.5, §5.7; Spine Gate G5).
 *
 * - `variance = actual - plan` (the only direction `computeVariance` allows) and favorability is
 *   derived from the account type, so a revenue over-plan is favorable while an expense over-plan
 *   is not.
 * - A row is emitted only when there is something to say: an account with a plan line, or with
 *   non-zero actual activity. An account with neither is omitted rather than shown as `0 vs 0`.
 * - An account with actual activity but NO plan line keeps `plan = null`, `variance = null`,
 *   `variancePctKind = 'null'` and `favorability = 'na'` — the viewer sees "not planned", never an
 *   invented zero plan and never an `n/m` pretending the plan was `0`.
 * - A planned account with no GL activity is compared against the true `0` the trial balance
 *   reports for it; that zero is data, not a fabrication.
 * - Totals sum only what exists: `plan` covers planned rows, `varianceAmount` covers rows that have
 *   both sides, and `unplannedActual` is reported separately so the actual total can never silently
 *   absorb an unplanned amount.
 *
 * All arithmetic is Decimal through `/core/money`; there is no `Math.abs` and no float.
 */
export function buildBudgetVariance(params: {
  readonly accounts: readonly BudgetVarianceAccountInput[];
  readonly basis: VarianceBasis;
  readonly scale?: number;
}): BudgetVarianceResult {
  const scale = params.scale ?? 2;
  const rows: BudgetVarianceRow[] = [];

  for (const account of params.accounts) {
    const actual = account.actual === null ? null : money(account.actual);
    const plan = account.plan === null ? null : money(account.plan);
    const actualIsSilent = actual === null || actual.isZero();
    if (plan === null && actualIsSilent) continue;

    const variance = computeVariance({
      accountType: account.accountType,
      // A planned account is compared against the true 0 the trial balance reports for it; an
      // unplanned account keeps whatever actual it has (so the row still shows the real money).
      actual: plan === null ? actual : (actual ?? money('0')),
      plan,
      basis: params.basis,
    });

    rows.push({
      accountCode: account.accountCode,
      accountName: account.accountName,
      accountType: account.accountType,
      actual: variance.actual === null ? null : serialize(variance.actual, scale),
      plan: variance.plan === null ? null : serialize(variance.plan, scale),
      varianceAmount:
        variance.varianceAmount === null ? null : serialize(variance.varianceAmount, scale),
      variancePctKind: variance.variancePctKind,
      variancePctFormatted: variance.variancePctFormatted,
      favorability: variance.favorability,
    });
  }

  rows.sort((a, b) => (a.accountCode < b.accountCode ? -1 : a.accountCode > b.accountCode ? 1 : 0));

  let actualTotal = money('0');
  let planTotal = money('0');
  let unplannedActual = money('0');
  let varianceTotal = money('0');
  let plannedRows = 0;
  let unplannedRows = 0;
  let favorable = 0;
  let unfavorable = 0;
  let neutral = 0;
  let na = 0;

  const typeActual = new Map<AccountType, Decimal>();
  const typePlan = new Map<AccountType, Decimal>();
  const typeVariance = new Map<AccountType, Decimal>();

  for (const row of rows) {
    const rowActual = row.actual === null ? money('0') : money(row.actual);
    actualTotal = add(actualTotal, rowActual);
    if (row.plan === null) {
      unplannedRows += 1;
      unplannedActual = add(unplannedActual, rowActual);
    } else {
      plannedRows += 1;
      planTotal = add(planTotal, money(row.plan));
    }
    if (row.varianceAmount !== null) {
      varianceTotal = add(varianceTotal, money(row.varianceAmount));
    }
    if (row.favorability === 'favorable') favorable += 1;
    else if (row.favorability === 'unfavorable') unfavorable += 1;
    else if (row.favorability === 'neutral') neutral += 1;
    else na += 1;

    typeActual.set(row.accountType, add(typeActual.get(row.accountType) ?? money('0'), rowActual));
    if (row.plan !== null) {
      typePlan.set(
        row.accountType,
        add(typePlan.get(row.accountType) ?? money('0'), money(row.plan)),
      );
    }
    if (row.varianceAmount !== null) {
      typeVariance.set(
        row.accountType,
        add(typeVariance.get(row.accountType) ?? money('0'), money(row.varianceAmount)),
      );
    }
  }

  const byType: BudgetVarianceTypeTotal[] = (
    ['asset', 'liability', 'equity', 'revenue', 'expense'] as const
  )
    .filter((accountType) => typeActual.has(accountType))
    .map((accountType) => ({
      accountType,
      actual: serialize(typeActual.get(accountType) ?? money('0'), scale),
      plan: serialize(typePlan.get(accountType) ?? money('0'), scale),
      varianceAmount: serialize(typeVariance.get(accountType) ?? money('0'), scale),
    }));

  return {
    rows,
    totals: {
      actual: serialize(actualTotal, scale),
      plan: serialize(planTotal, scale),
      unplannedActual: serialize(unplannedActual, scale),
      varianceAmount: serialize(varianceTotal, scale),
      plannedRows,
      unplannedRows,
      favorable,
      unfavorable,
      neutral,
      na,
    },
    byType,
  };
}
