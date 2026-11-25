import {
  money,
  scaleForCurrency,
  serialize,
  sum,
  STORAGE_SCALE,
} from '../../../core/money/index.js';
import {
  buildBudgetVariance,
  type BudgetVarianceAccountInput,
} from '../../../core/variance/index.js';
import type { BvaReport } from '../../../shared/bva.js';
import { AppError } from '../../../shared/errors.js';
import type { SqlExecutor } from '../migrate.js';
import { getBudget } from './budget.js';
import { getTrialBalance } from './reports.js';

/**
 * Budget-vs-Actual read model (MASTER_PROMPT §3.5, §5.7; Spine Gate G5).
 *
 * The plan side is the CURRENT plan version of the requested fiscal year truncated to the periods
 * at or before `throughPeriodCode`; the actual side is the trial-balance read model, which already
 * filters postings through `activeBatchPredicate` (active, kind = 'actuals'). Both sides are
 * therefore the numbers the Model Grid and Statements screens show — this module joins them and
 * hands them to `/core/variance`; it does no money arithmetic of its own.
 */

interface CompanyRow extends Record<string, unknown> {
  base_currency: string;
}

interface PeriodRow extends Record<string, unknown> {
  id: string;
  code: string;
  fiscal_year: number;
  period_no: number;
}

interface AccountRow extends Record<string, unknown> {
  code: string;
  name: string;
  type: string;
}

export interface BvaParams {
  readonly companyId: string;
  readonly throughPeriodCode: string;
  readonly fiscalYear?: number | null;
}

async function resolvePeriod(
  db: SqlExecutor,
  companyId: string,
  periodCode: string,
  fiscalYear: number | null | undefined,
): Promise<PeriodRow> {
  const scoped = fiscalYear !== undefined && fiscalYear !== null;
  const res = await db.query<PeriodRow>(
    `SELECT id, code, fiscal_year, period_no
       FROM fiscal_period
      WHERE company_id = $1 AND code = $2${scoped ? ' AND fiscal_year = $3' : ''}
      ORDER BY fiscal_year ASC`,
    scoped ? [companyId, periodCode, fiscalYear] : [companyId, periodCode],
  );
  const first = res.rows[0];
  if (first === undefined) {
    throw new AppError('PERIOD_NOT_FOUND', {
      userMessage: `Period ${periodCode} does not exist in this company calendar.`,
      details: { periodCode, fiscalYear: fiscalYear ?? null },
    });
  }
  if (res.rows.length > 1) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Period code ${periodCode} exists in more than one fiscal year; pass the fiscal year to disambiguate.`,
      details: { periodCode, fiscalYears: res.rows.map((row) => row.fiscal_year) },
    });
  }
  return first;
}

/** Adds canonical decimal strings exactly (no float) through the money kernel. */
function sumCanonical(values: readonly string[]): string {
  return serialize(
    sum(values.map((value) => money(value))),
    STORAGE_SCALE,
  );
}

export async function getBvaReport(db: SqlExecutor, params: BvaParams): Promise<BvaReport> {
  const companyRes = await db.query<CompanyRow>(
    'SELECT base_currency FROM company WHERE id = $1',
    [params.companyId],
  );
  const currency = companyRes.rows[0]?.base_currency;
  if (currency === undefined) {
    throw new AppError('NOT_FOUND', { userMessage: 'The company could not be found.' });
  }
  const scale = scaleForCurrency(currency);

  const period = await resolvePeriod(
    db,
    params.companyId,
    params.throughPeriodCode,
    params.fiscalYear,
  );

  const [budget, trialBalance, chartRes] = await Promise.all([
    getBudget(db, { companyId: params.companyId, fiscalYear: period.fiscal_year }),
    getTrialBalance(db, {
      companyId: params.companyId,
      throughPeriodCode: period.code,
      fiscalYear: period.fiscal_year,
    }),
    db.query<AccountRow>(
      'SELECT code, name, type FROM account WHERE company_id = $1 ORDER BY code ASC',
      [params.companyId],
    ),
  ]);
  const chartByCode = new Map(chartRes.rows.map((row) => [row.code, row]));

  // Plan year-to-date: only the periods at or before the requested one.
  const planByAccount = new Map<string, string[]>();
  for (const line of budget.lines) {
    if (line.periodNo > period.period_no) continue;
    const amounts = planByAccount.get(line.accountCode);
    if (amounts === undefined) planByAccount.set(line.accountCode, [line.amount]);
    else amounts.push(line.amount);
  }

  const accounts: BudgetVarianceAccountInput[] = trialBalance.rows.map((row) => {
    const planAmounts = planByAccount.get(row.code);
    return {
      accountCode: row.code,
      accountName: row.name,
      accountType: row.type,
      actual: row.naturalActivity,
      plan: planAmounts === undefined ? null : sumCanonical(planAmounts),
    };
  });

  // A plan line can point at an inactive account that the trial balance no longer lists. It is
  // still part of the plan, so it appears with a null actual (its real name and type from the
  // chart) instead of vanishing from the comparison.
  const knownCodes = new Set(accounts.map((account) => account.accountCode));
  for (const [code, amounts] of planByAccount) {
    if (knownCodes.has(code)) continue;
    const chartAccount = chartByCode.get(code);
    if (chartAccount === undefined) continue;
    accounts.push({
      accountCode: code,
      accountName: chartAccount.name,
      accountType: chartAccount.type as BudgetVarianceAccountInput['accountType'],
      actual: null,
      plan: sumCanonical(amounts),
    });
  }

  const variance = buildBudgetVariance({
    accounts,
    // `basis` is internal metadata for computeVariance and never serialized; when no plan version
    // exists the ids are reported as null on the wire.
    basis: {
      scenarioId: budget.scenarioId ?? 'none',
      planVersionId: budget.planVersionId ?? 'none',
      periodCode: period.code,
    },
    scale,
  });

  return {
    companyId: params.companyId,
    fiscalYear: period.fiscal_year,
    throughPeriodCode: period.code,
    scenarioId: budget.scenarioId,
    scenarioName: budget.scenarioName,
    planVersionId: budget.planVersionId,
    versionNo: budget.versionNo,
    hasPlan: budget.planVersionId !== null,
    rows: variance.rows.map((row) => ({ ...row })),
    totals: variance.totals,
    byType: variance.byType.map((total) => ({ ...total })),
  };
}
