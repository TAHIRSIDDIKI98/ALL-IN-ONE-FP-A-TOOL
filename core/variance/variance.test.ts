import { describe, expect, it } from 'vitest';
import { verifyPvmInvariant } from '../invariants.js';
import { money } from '../money/index.js';
import {
  buildBudgetVariance,
  computePvmDecomposition,
  computeVariance,
  deriveFavorability,
  type BudgetVarianceAccountInput,
} from './index.js';

const BASIS = {
  scenarioId: 'actual_vs_budget',
  planVersionId: 'pv_fy2026_v1',
  periodCode: '2026-03',
} as const;

describe('Variance Engine (§5.7)', () => {
  it('handles plan=0/actual=0 as 0.00%, x/0 as n/m, negative plan denominator, and null preservation', () => {
    const zeroBoth = computeVariance({
      accountType: 'revenue',
      actual: money('0'),
      plan: money('0'),
      basis: BASIS,
    });
    expect(zeroBoth.varianceAmount?.toFixed(2)).toBe('0.00');
    expect(zeroBoth.variancePctKind).toBe('zero');
    expect(zeroBoth.variancePctFormatted).toBe('0.00%');
    expect(zeroBoth.favorability).toBe('neutral');

    const zeroPlanNonZeroActual = computeVariance({
      accountType: 'expense',
      actual: money('1250.00'),
      plan: money('0'),
      basis: BASIS,
    });
    expect(zeroPlanNonZeroActual.varianceAmount?.toFixed(2)).toBe('1250.00');
    expect(zeroPlanNonZeroActual.variancePctKind).toBe('nm');
    expect(zeroPlanNonZeroActual.varianceRatio).toBeNull();
    expect(zeroPlanNonZeroActual.variancePctFormatted).toBe('n/m');
    expect(zeroPlanNonZeroActual.favorability).toBe('unfavorable');

    // Negative plan (e.g. contra or net loss): variance% = (actual - plan) / |plan|
    const negPlan = computeVariance({
      accountType: 'revenue',
      actual: money('-50.00'),
      plan: money('-100.00'),
      basis: BASIS,
    });
    expect(negPlan.varianceAmount?.toFixed(2)).toBe('50.00');
    expect(negPlan.variancePctKind).toBe('computed');
    expect(negPlan.variancePctFormatted).toBe('50.00%');
    expect(negPlan.favorability).toBe('favorable');

    // Null Law: missing actual or missing plan stays null, never coerced to 0
    const missingActual = computeVariance({
      accountType: 'revenue',
      actual: null,
      plan: money('500.00'),
      basis: BASIS,
    });
    expect(missingActual.varianceAmount).toBeNull();
    expect(missingActual.variancePctKind).toBe('null');
    expect(missingActual.variancePctFormatted).toBeNull();
    expect(missingActual.favorability).toBe('na');
  });

  it('derives account-type favorability consistently across all 5 account types', () => {
    expect(deriveFavorability('revenue', money('10'))).toBe('favorable');
    expect(deriveFavorability('revenue', money('-10'))).toBe('unfavorable');
    expect(deriveFavorability('asset', money('10'))).toBe('favorable');
    expect(deriveFavorability('asset', money('-10'))).toBe('unfavorable');

    expect(deriveFavorability('expense', money('10'))).toBe('unfavorable');
    expect(deriveFavorability('expense', money('-10'))).toBe('favorable');
    expect(deriveFavorability('liability', money('10'))).toBe('unfavorable');
    expect(deriveFavorability('liability', money('-10'))).toBe('favorable');
    expect(deriveFavorability('equity', money('10'))).toBe('unfavorable');
    expect(deriveFavorability('equity', money('-10'))).toBe('favorable');

    expect(deriveFavorability('revenue', money('0'))).toBe('neutral');
    expect(deriveFavorability('expense', null)).toBe('na');
  });
});

describe('Price-Volume-Mix (PVM) Decomposition (§5.7)', () => {
  it('decomposes exact integer Price, Volume, and Mix summing identically to Total Revenue Variance', () => {
    // SKU A: Plan 100 @ 10 = 1000, Actual 120 @ 11 = 1320 (delta = +320)
    // SKU B: Plan 100 @ 20 = 2000, Actual 110 @ 19 = 2090 (delta = +90)
    // Total Plan = 3000 (200 units, avg price = 15), Total Actual = 3410 (230 units), Total Variance = +410
    // Price = 120*(+1) + 110*(-1) = +10
    // Volume = (230 - 200) * 15 = +450
    // Mix = (120 - 115)*(10 - 15) + (110 - 115)*(20 - 15) = -25 + -25 = -50
    // Check: 10 + 450 + (-50) = 410 exact
    const pvm = computePvmDecomposition([
      {
        key: 'SKU_A',
        planUnits: money('100'),
        planPrice: money('10.00'),
        actualUnits: money('120'),
        actualPrice: money('11.00'),
      },
      {
        key: 'SKU_B',
        planUnits: money('100'),
        planPrice: money('20.00'),
        actualUnits: money('110'),
        actualPrice: money('19.00'),
      },
    ]);

    expect(pvm.totalVariance.toFixed(2)).toBe('410.00');
    expect(pvm.priceVariance.toFixed(2)).toBe('10.00');
    expect(pvm.volumeVariance.toFixed(2)).toBe('450.00');
    expect(pvm.mixVariance.toFixed(2)).toBe('-50.00');
    expect(pvm.invariantPassed).toBe(true);
  });

  it('allocates rounding residuals deterministically so Price + Volume + Mix == Total Variance even with repeating fractions', () => {
    const pvm = computePvmDecomposition([
      {
        key: 'SKU_1',
        planUnits: money('13'),
        planPrice: money('17.33'),
        actualUnits: money('19'),
        actualPrice: money('18.11'),
      },
      {
        key: 'SKU_2',
        planUnits: money('27'),
        planPrice: money('9.47'),
        actualUnits: money('22'),
        actualPrice: money('10.05'),
      },
      {
        key: 'SKU_3',
        planUnits: money('7'),
        planPrice: money('31.19'),
        actualUnits: money('11'),
        actualPrice: money('29.99'),
      },
    ]);

    expect(pvm.invariantPassed).toBe(true);
    const check = verifyPvmInvariant(
      pvm.totalVariance,
      pvm.priceVariance,
      pvm.volumeVariance,
      pvm.mixVariance,
    );
    expect(check.passed).toBe(true);
    expect(check.delta).toBe('0');

    // Empty item list is neutral & valid
    const empty = computePvmDecomposition([]);
    expect(empty.totalVariance.toFixed(2)).toBe('0.00');
    expect(empty.invariantPassed).toBe(true);

    // Broken PVM check is detected
    const broken = verifyPvmInvariant(money('100.00'), money('50.00'), money('40.00'), money('5.00'));
    expect(broken.passed).toBe(false);
    expect(broken.delta).toBe('5');
  });

  it('builds Budget-vs-Actual rows with account-type favorability and the locked zero-base rules', () => {
    const accounts: BudgetVarianceAccountInput[] = [
      // revenue over plan -> favorable
      { accountCode: '4000', accountName: 'Service revenue', accountType: 'revenue', actual: '1200.00', plan: '1000.00' },
      // expense over plan -> unfavorable
      { accountCode: '5000', accountName: 'Salaries', accountType: 'expense', actual: '300.00', plan: '250.00' },
      // plan exists, no activity yet -> compared against the true 0.00
      { accountCode: '6000', accountName: 'Software', accountType: 'expense', actual: null, plan: '50.00' },
      // no plan line -> "not planned", never an invented zero plan
      { accountCode: '6100', accountName: 'Contractors', accountType: 'expense', actual: '75.00', plan: null },
      // neither plan nor activity -> omitted entirely (not shown as 0 vs 0)
      { accountCode: '7000', accountName: 'Idle account', accountType: 'expense', actual: '0.00', plan: null },
    ];

    const result = buildBudgetVariance({ accounts, basis: BASIS });

    expect(result.rows.map((row) => row.accountCode)).toEqual(['4000', '5000', '6000', '6100']);
    expect(result.rows[0]).toMatchObject({
      actual: '1200.00',
      plan: '1000.00',
      varianceAmount: '200.00',
      variancePctFormatted: '20.00%',
      favorability: 'favorable',
    });
    expect(result.rows[1]).toMatchObject({
      varianceAmount: '50.00',
      variancePctFormatted: '20.00%',
      favorability: 'unfavorable',
    });
    expect(result.rows[2]).toMatchObject({
      actual: '0.00',
      plan: '50.00',
      varianceAmount: '-50.00',
      variancePctFormatted: '-100.00%',
      favorability: 'favorable',
    });
    expect(result.rows[3]).toMatchObject({
      actual: '75.00',
      plan: null,
      varianceAmount: null,
      variancePctKind: 'null',
      variancePctFormatted: null,
      favorability: 'na',
    });

    // Totals only sum what exists, and the unplanned actual is reported separately.
    expect(result.totals).toEqual({
      actual: '1575.00',
      plan: '1300.00',
      unplannedActual: '75.00',
      varianceAmount: '200.00',
      plannedRows: 3,
      unplannedRows: 1,
      favorable: 2,
      unfavorable: 1,
      neutral: 0,
      na: 1,
    });
    expect(result.byType).toEqual([
      { accountType: 'revenue', actual: '1200.00', plan: '1000.00', varianceAmount: '200.00' },
      { accountType: 'expense', actual: '375.00', plan: '300.00', varianceAmount: '0.00' },
    ]);

    // Row sums tie to the totals exactly.
    const sumActual = result.rows.reduce((total, row) => total + Number(row.actual ?? '0'), 0);
    expect(sumActual.toFixed(2)).toBe(result.totals.actual);
    expect(result.totals.plan).toBe('1300.00');
  });

  it('keeps a zero-plan account out of n/m falsehoods and reports 0.00% for zero vs zero', () => {
    const result = buildBudgetVariance({
      accounts: [
        { accountCode: '4000', accountName: 'Revenue', accountType: 'revenue', actual: '0.00', plan: '0.00' },
        { accountCode: '5000', accountName: 'Salaries', accountType: 'expense', actual: '100.00', plan: '0.00' },
      ],
      basis: BASIS,
    });

    expect(result.rows[0]).toMatchObject({
      plan: '0.00',
      varianceAmount: '0.00',
      variancePctFormatted: '0.00%',
      favorability: 'neutral',
    });
    expect(result.rows[1]).toMatchObject({
      plan: '0.00',
      varianceAmount: '100.00',
      variancePctKind: 'nm',
      variancePctFormatted: 'n/m',
      favorability: 'unfavorable',
    });
    expect(result.totals.actual).toBe('100.00');
  });
});
