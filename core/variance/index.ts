// Implements MASTER_PROMPT §5.7 Variance & PVM contracts inside /core/variance.
// Pure Decimal arithmetic with explicit division scale/mode, zero Math.abs, locked zero-base rules, account-type favorability, and exact PVM decomposition. Oracle: core/statements/statements.test.ts.

import Decimal from 'decimal.js';
import { verifyPvmInvariant } from '../invariants.js';
import { add, allocate, div, money, mul, negate, sub, sum } from '../money/index.js';
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
