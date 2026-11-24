// Ported from fp-A-betterversion/src/utils/invariants.ts @ 86d785ca696c. Class B.
// Changes: Removed Vite `import.meta.env.PROD` bypass so financial invariants are ALWAYS enforced in dev, test, and production (MASTER_PROMPT §5.6 A7); uses pure Decimal equality with zero float/epsilon tolerance. Oracle: core/statements/statements.test.ts.

import Decimal from 'decimal.js';
import { add, eq, serialize, sub } from './money/index.js';

export class InvariantViolationError extends Error {
  public readonly code: string;
  public readonly details: Readonly<Record<string, string>>;

  constructor(code: string, message: string, details: Readonly<Record<string, string>> = {}) {
    super(`[INVARIANT VIOLATION ${code}]: ${message}`);
    this.name = 'InvariantViolationError';
    this.code = code;
    this.details = details;
  }
}

export function assertInvariant(
  condition: boolean,
  code: string,
  message: string,
  details: Readonly<Record<string, string>> = {},
): asserts condition {
  if (!condition) {
    throw new InvariantViolationError(code, message, details);
  }
}

export interface InvariantCheckResult {
  readonly id: 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'PVM';
  readonly name: string;
  readonly passed: boolean;
  readonly delta: string;
  readonly detail: string;
}

export interface ArticulationCheckInput {
  readonly totalDebits: Decimal;
  readonly totalCredits: Decimal;
  readonly pnlRevenue: Decimal;
  readonly pnlExpense: Decimal;
  readonly pnlNetIncome: Decimal;
  readonly bsAssets: Decimal;
  readonly bsLiabilities: Decimal;
  readonly bsEquity: Decimal;
  readonly openingRetainedEarnings: Decimal;
  readonly distributions: Decimal;
  readonly closingRetainedEarnings: Decimal;
  readonly cfBeginningCash: Decimal;
  readonly cfOperating: Decimal;
  readonly cfInvesting: Decimal;
  readonly cfFinancing: Decimal;
  readonly cfEndingCash: Decimal;
  readonly bsCash: Decimal;
}

export interface ArticulationReport {
  readonly valid: boolean;
  readonly checks: readonly InvariantCheckResult[];
}

export function verifyArticulation(input: ArticulationCheckInput): ArticulationReport {
  const tbDelta = sub(input.totalDebits, input.totalCredits);
  const a1Passed = eq(input.totalDebits, input.totalCredits);

  const expectedNi = sub(input.pnlRevenue, input.pnlExpense);
  const pnlDelta = sub(input.pnlNetIncome, expectedNi);
  const a2Passed = eq(input.pnlNetIncome, expectedNi);

  const lPlusE = add(input.bsLiabilities, input.bsEquity);
  const bsDelta = sub(input.bsAssets, lPlusE);
  const a3Passed = eq(input.bsAssets, lPlusE);

  const expectedClosingRe = sub(add(input.openingRetainedEarnings, input.pnlNetIncome), input.distributions);
  const reDelta = sub(input.closingRetainedEarnings, expectedClosingRe);
  const a4Passed = eq(input.closingRetainedEarnings, expectedClosingRe);

  const computedEndingCash = add(
    input.cfBeginningCash,
    add(input.cfOperating, add(input.cfInvesting, input.cfFinancing)),
  );
  const cfInternalDelta = sub(input.cfEndingCash, computedEndingCash);
  const cfBsDelta = sub(input.cfEndingCash, input.bsCash);
  const a5Passed = eq(input.cfEndingCash, computedEndingCash) && eq(input.cfEndingCash, input.bsCash);

  const checks: InvariantCheckResult[] = [
    {
      id: 'A1',
      name: 'Trial Balance Debits == Credits',
      passed: a1Passed,
      delta: serialize(tbDelta),
      detail: `debits=${serialize(input.totalDebits)} credits=${serialize(input.totalCredits)}`,
    },
    {
      id: 'A2',
      name: 'P&L Net Income == Revenue - Expense',
      passed: a2Passed,
      delta: serialize(pnlDelta),
      detail: `netIncome=${serialize(input.pnlNetIncome)} expected=${serialize(expectedNi)}`,
    },
    {
      id: 'A3',
      name: 'Balance Sheet Assets == Liabilities + Equity',
      passed: a3Passed,
      delta: serialize(bsDelta),
      detail: `assets=${serialize(input.bsAssets)} L+E=${serialize(lPlusE)}`,
    },
    {
      id: 'A4',
      name: 'Retained Earnings Roll-Forward',
      passed: a4Passed,
      delta: serialize(reDelta),
      detail: `closingRE=${serialize(input.closingRetainedEarnings)} expected=${serialize(expectedClosingRe)}`,
    },
    {
      id: 'A5',
      name: 'Indirect Cash Flow Ending Cash == BS Cash',
      passed: a5Passed,
      delta: cfInternalDelta.isZero() ? serialize(cfBsDelta) : serialize(cfInternalDelta),
      detail: `cfEnding=${serialize(input.cfEndingCash)} computed=${serialize(computedEndingCash)} bsCash=${serialize(input.bsCash)}`,
    },
  ];

  return {
    valid: checks.every((c) => c.passed),
    checks,
  };
}

export function verifyPvmInvariant(
  totalVariance: Decimal,
  priceVariance: Decimal,
  volumeVariance: Decimal,
  mixVariance: Decimal,
): InvariantCheckResult {
  const sumComponents = add(priceVariance, add(volumeVariance, mixVariance));
  const delta = sub(totalVariance, sumComponents);
  const passed = eq(totalVariance, sumComponents);
  return {
    id: 'PVM',
    name: 'PVM Components Sum == Total Variance',
    passed,
    delta: serialize(delta),
    detail: `total=${serialize(totalVariance)} sum=${serialize(sumComponents)}`,
  };
}
