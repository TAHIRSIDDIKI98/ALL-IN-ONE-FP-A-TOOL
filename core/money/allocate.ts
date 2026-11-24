// Ported from fpa/src-tauri/src/core/money.rs @ 6f6f72f5b681 and FPA-modular/app/core/money.py @ 641d3d830573. Class B.
// Changes: Implemented largest-remainder allocation in pure Decimal with deterministic ascending bucket-key tie-break, symmetric negative allocation, zero-weight preservation, and explicit error when all weights are zero (MASTER_PROMPT §5.4 E4). Oracle: fixtures/oracles/allocation/allocation_oracles.json.

import Decimal from 'decimal.js';

export interface AllocationBucket {
  readonly key: string;
  readonly weight: Decimal | string | number;
}

export interface AllocatedShare {
  readonly key: string;
  readonly amount: Decimal;
}

export class ZeroAllocationWeightsError extends Error {
  public readonly code = 'ALLOCATION_ZERO_WEIGHTS' as const;
  constructor() {
    super('Cannot allocate across buckets whose weights all equal zero.');
    this.name = 'ZeroAllocationWeightsError';
  }
}

function parseWeight(w: Decimal | string | number): Decimal {
  if (w instanceof Decimal) return w;
  if (typeof w === 'number') {
    if (!Number.isInteger(w)) {
      throw new Error('INVALID_WEIGHT: numeric weight must be an integer; pass string or Decimal for fractional weights');
    }
    return new Decimal(w.toString());
  }
  return new Decimal(w.trim());
}

/**
 * Largest-remainder allocation (MASTER_PROMPT §5.4):
 * 1. Exact proportional shares at full precision.
 * 2. Floor each magnitude share to `scale`.
 * 3. Distribute residual minor units one-by-one to largest fractional remainders.
 * 4. Deterministic tie-break by `bucket.key` ascending.
 * Invariant: sum(result) === amount (rounded to scale, or exact when amount already fits scale).
 */
export function allocate(
  amount: Decimal,
  buckets: readonly AllocationBucket[],
  scale: number,
): AllocatedShare[] {
  if (!Number.isInteger(scale) || scale < 0 || scale > 12) {
    throw new Error(`INVALID_ALLOCATION_SCALE: ${String(scale)}`);
  }
  if (buckets.length === 0) {
    if (!amount.isZero()) {
      throw new ZeroAllocationWeightsError();
    }
    return [];
  }

  // Verify amount already fits target scale (no hidden rounding loss)
  const unit = new Decimal(10).pow(-scale);
  const targetScaled = amount.div(unit);
  if (!targetScaled.isInteger()) {
    throw new Error(
      `ALLOCATION_AMOUNT_EXCEEDS_SCALE: amount ${amount.toFixed()} has more decimal places than scale ${String(scale)}`,
    );
  }

  const parsedWeights = buckets.map((b) => {
    const w = parseWeight(b.weight);
    if (!w.isFinite() || w.isNaN() || w.isNegative()) {
      throw new Error(`INVALID_WEIGHT for bucket "${b.key}": weights must be finite and >= 0`);
    }
    return { key: b.key, weight: w };
  });

  let weightSum = new Decimal(0);
  for (const b of parsedWeights) {
    weightSum = weightSum.plus(b.weight);
  }
  if (weightSum.isZero()) {
    throw new ZeroAllocationWeightsError();
  }

  if (amount.isZero()) {
    const zero = new Decimal(0);
    return parsedWeights.map((b) => ({ key: b.key, amount: zero }));
  }

  const isNeg = amount.isNegative();
  const mag = isNeg ? amount.negated() : amount;

  const work = parsedWeights.map((b, index) => {
    if (b.weight.isZero()) {
      return {
        index,
        key: b.key,
        zeroWeight: true,
        floored: new Decimal(0),
        remainder: new Decimal(0),
      };
    }
    const exact = mag.times(b.weight).div(weightSum);
    const flooredUnits = exact.div(unit).floor();
    const floored = flooredUnits.times(unit);
    const remainder = exact.minus(floored);
    return {
      index,
      key: b.key,
      zeroWeight: false,
      floored,
      remainder,
    };
  });

  let flooredSum = new Decimal(0);
  for (const item of work) {
    flooredSum = flooredSum.plus(item.floored);
  }

  const residualUnits = mag.minus(flooredSum).div(unit).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();

  // Rank non-zero-weight buckets by fractional remainder DESC, then key ASC (§5.4 step 4)
  const eligible = work
    .filter((item) => !item.zeroWeight)
    .sort((a, b) => {
      const cmp = b.remainder.cmp(a.remainder);
      if (cmp !== 0) return cmp;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index;
    });

  for (let r = 0; r < residualUnits; r++) {
    const winner = eligible[r];
    if (!winner) {
      throw new Error('ALLOCATION_RESIDUAL_OVERFLOW');
    }
    winner.floored = winner.floored.plus(unit);
  }

  // Restore caller's bucket array order and apply sign symmetrically
  return work.map((item) => {
    const signed = isNeg && !item.floored.isZero() ? item.floored.negated() : item.floored;
    return {
      key: item.key,
      amount: signed,
    };
  });
}
