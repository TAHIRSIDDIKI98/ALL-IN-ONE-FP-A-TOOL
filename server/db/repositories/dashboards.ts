import { canonicalJson, sha256Hex } from '../../../core/audit/index.js';
import {
  buildKpiTrendSeries,
  buildReportBlocks,
  evaluateKpiLibrary,
  type CurrencyScale,
  type PeriodTrendInput,
  type ReportTemplateId,
} from '../../../core/metrics/index.js';
import {
  add,
  money,
  scaleForCurrency,
  serialize,
  sub,
  sum,
} from '../../../core/money/index.js';
import {
  buildArticulatingStatements,
  computePnlStatement,
  computeSheetContribution,
  type AccountType,
  type GlLineFact,
  type NormalSide,
  type PnlLineInput,
  type StatementAccountDef,
} from '../../../core/statements/index.js';
import type { DashboardSummaryResponse } from '../../../shared/dashboards.js';
import { AppError } from '../../../shared/errors.js';
import type { TrialBalanceSource } from '../../../shared/reports.js';
import type { SqlExecutor } from '../migrate.js';
import { getBudget } from './budget.js';
import { activeBatchPredicate } from './import.js';

/**
 * M2 Dashboards v1 & KPI Library Repository (MASTER_PROMPT §11.5: RPT1, RPT2, RPT4).
 *
 * - Every metric, trend bar percentage, and Report Builder citation is evaluated strictly by
 *   `/core/metrics` + `/core/statements`.
 * - `MetricsAggregateCache` caches materialized summary payloads per `(db, companyId, year,
 *   period, templateId)` validated against a deterministic SHA-256 fingerprint of active batches,
 *   chart account versions, and current plan versions (`RPT2`). Stale cache entries are bypassed
 *   automatically and cached outputs always tie 100% identically to uncached engine computation.
 */

interface CompanyRow extends Record<string, unknown> {
  name: string;
  base_currency: string;
}

interface PeriodRow extends Record<string, unknown> {
  id: string;
  code: string;
  fiscal_year: number;
  period_no: number;
  is_adjustment: boolean;
}

interface AccountRow extends Record<string, unknown> {
  id: string;
  code: string;
  name: string;
  type: string;
  normal_side: string;
  is_contra: boolean;
  statement_line_key: string;
  version: number;
}

interface LineRow extends Record<string, unknown> {
  entry_id: string;
  account_id: string;
  period_id: string;
  debit: string;
  credit: string;
  in_range: boolean;
}

interface BatchFingerprintRow extends Record<string, unknown> {
  id: string;
  kind: string;
  status: string;
  source_hash: string;
}

interface AccountFingerprintRow extends Record<string, unknown> {
  cnt: string;
  ver_sum: string;
}

interface PlanFingerprintRow extends Record<string, unknown> {
  scenario_id: string;
  plan_version_id: string;
  version_no: number;
  line_cnt: string;
}

interface CachedDashboardEntry {
  readonly fingerprint: string;
  readonly report: DashboardSummaryResponse;
}

const dashboardCacheByDb = new WeakMap<object, Map<string, CachedDashboardEntry>>();

function getDbCache(db: SqlExecutor): Map<string, CachedDashboardEntry> {
  const key = db as unknown as object;
  let cache = dashboardCacheByDb.get(key);
  if (cache === undefined) {
    cache = new Map<string, CachedDashboardEntry>();
    dashboardCacheByDb.set(key, cache);
  }
  return cache;
}

export function invalidateDashboardCacheForTests(db: SqlExecutor): void {
  getDbCache(db).clear();
}

export interface DashboardSummaryParams {
  readonly companyId: string;
  readonly throughPeriodCode: string;
  readonly fiscalYear?: number | null;
  readonly templateId?: ReportTemplateId;
}

export async function computeCompanyDashboardFingerprint(
  db: SqlExecutor,
  companyId: string,
): Promise<string> {
  const [batchesRes, accountsRes, plansRes] = await Promise.all([
    db.query<BatchFingerprintRow>(
      `SELECT id, kind, status, source_hash
         FROM import_batch
        WHERE company_id = $1 AND status IN ('staged', 'committed')
        ORDER BY id ASC`,
      [companyId],
    ),
    db.query<AccountFingerprintRow>(
      `SELECT COUNT(*)::text AS cnt, COALESCE(SUM(version), 0)::text AS ver_sum
         FROM account
        WHERE company_id = $1 AND active = true`,
      [companyId],
    ),
    db.query<PlanFingerprintRow>(
      `SELECT pv.scenario_id, pv.id AS plan_version_id, pv.version_no,
              COUNT(pl.id)::text AS line_cnt
         FROM plan_version pv
         LEFT JOIN plan_line pl ON pl.company_id = pv.company_id AND pl.version_id = pv.id
        WHERE pv.company_id = $1 AND pv.is_current = true
        GROUP BY pv.scenario_id, pv.id, pv.version_no
        ORDER BY pv.scenario_id ASC, pv.id ASC`,
      [companyId],
    ),
  ]);

  return sha256Hex(
    canonicalJson({
      batches: batchesRes.rows.map((r) => `${r.id}:${r.kind}:${r.status}:${r.source_hash}`),
      accounts: accountsRes.rows[0] ?? { cnt: '0', ver_sum: '0' },
      plans: plansRes.rows.map(
        (r) => `${r.scenario_id}:${r.plan_version_id}:${String(r.version_no)}:${r.line_cnt}`,
      ),
    }),
  );
}

async function resolvePeriod(
  db: SqlExecutor,
  companyId: string,
  periodCode: string,
  fiscalYear?: number | null,
): Promise<PeriodRow> {
  const scoped = fiscalYear !== undefined && fiscalYear !== null;
  const res = await db.query<PeriodRow>(
    `SELECT id, code, fiscal_year, period_no, is_adjustment
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

export async function computeDashboardSummaryUncached(
  db: SqlExecutor,
  params: DashboardSummaryParams,
): Promise<DashboardSummaryResponse> {
  const companyRes = await db.query<CompanyRow>(
    `SELECT name, base_currency FROM company WHERE id = $1`,
    [params.companyId],
  );
  const company = companyRes.rows[0];
  if (company === undefined) {
    throw new AppError('NOT_FOUND', { userMessage: 'The company could not be found.' });
  }
  const currencyScale = scaleForCurrency(company.base_currency) as CurrencyScale;

  const throughRow = await resolvePeriod(
    db,
    params.companyId,
    params.throughPeriodCode,
    params.fiscalYear,
  );
  const templateId: ReportTemplateId = params.templateId ?? 'executive_summary';

  const fyPeriodsRes = await db.query<PeriodRow>(
    `SELECT id, code, fiscal_year, period_no, is_adjustment
       FROM fiscal_period
      WHERE company_id = $1
        AND fiscal_year = $2
        AND period_no <= $3
        AND (is_adjustment = false OR id = $4)
      ORDER BY period_no ASC`,
    [params.companyId, throughRow.fiscal_year, throughRow.period_no, throughRow.id],
  );
  const fyPeriods = fyPeriodsRes.rows;
  const fromRow = fyPeriods[0];
  if (fromRow === undefined) {
    throw new AppError('PERIOD_NOT_FOUND', {
      userMessage: 'The fiscal year of the requested period has no periods.',
      details: { periodCode: throughRow.code, fiscalYear: throughRow.fiscal_year },
    });
  }

  const [accountRes, lineRes, sourceRes, budget] = await Promise.all([
    db.query<AccountRow>(
      `SELECT id, code, name, type, normal_side, is_contra, statement_line_key, version
         FROM account
        WHERE company_id = $1 AND active = true
        ORDER BY code ASC`,
      [params.companyId],
    ),
    db.query<LineRow>(
      `SELECT gl.entry_id, gl.account_id, gl.period_id, gl.debit::text AS debit, gl.credit::text AS credit,
              (fp.fiscal_year > $2 OR (fp.fiscal_year = $2 AND fp.period_no >= $3)) AS in_range
         FROM gl_line gl
         JOIN gl_entry ge ON ge.id = gl.entry_id
         JOIN fiscal_period fp ON fp.id = gl.period_id
        WHERE gl.company_id = $1
          AND ${activeBatchPredicate('ge')}
          AND (fp.fiscal_year < $4 OR (fp.fiscal_year = $4 AND fp.period_no <= $5))
        ORDER BY gl.entry_id ASC, gl.id ASC`,
      [params.companyId, fromRow.fiscal_year, fromRow.period_no, throughRow.fiscal_year, throughRow.period_no],
    ),
    db.query<TrialBalanceSource & Record<string, unknown>>(
      `SELECT b.id AS "batchId", b.source_filename AS "sourceFilename", b.source_hash AS "sourceHash",
              b.imported_at::text AS "importedAt"
         FROM import_batch b
        WHERE b.company_id = $1 AND b.kind = 'actuals' AND b.status IN ('staged', 'committed')
        ORDER BY b.imported_at ASC, b.id ASC`,
      [params.companyId],
    ),
    getBudget(db, { companyId: params.companyId, fiscalYear: throughRow.fiscal_year }),
  ]);

  const accounts: StatementAccountDef[] = accountRes.rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type as AccountType,
    normalSide: row.normal_side as NormalSide,
    isContra: row.is_contra,
    statementLineKey: row.statement_line_key,
  }));
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const accountsByCode = new Map(accounts.map((a) => [a.code, a]));

  const openingBalancesByKey = new Map<string, ReturnType<typeof money>>();
  const linesByPeriodId = new Map<string, GlLineFact[]>();
  const allFyLines: GlLineFact[] = [];

  for (const row of lineRes.rows) {
    const account = accountsById.get(row.account_id);
    if (account === undefined) {
      throw new AppError('INTERNAL_ERROR', {
        userMessage: 'A posting references an account that is not active in this company.',
        details: { accountId: row.account_id },
      });
    }
    const debit = money(row.debit);
    const credit = money(row.credit);
    if (row.in_range) {
      const fact: GlLineFact = {
        entryId: row.entry_id,
        accountId: row.account_id,
        periodId: row.period_id,
        debit,
        credit,
      };
      allFyLines.push(fact);
      const list = linesByPeriodId.get(row.period_id);
      if (list === undefined) linesByPeriodId.set(row.period_id, [fact]);
      else list.push(fact);
    } else if (account.statementLineKey.startsWith('bs.')) {
      const contribution = computeSheetContribution(account.type, debit, credit);
      const prev = openingBalancesByKey.get(account.statementLineKey) ?? money('0');
      openingBalancesByKey.set(account.statementLineKey, add(prev, contribution));
    }
  }

  // Compute YTD bundle matching getFinancialStatements 100%, plus period-by-period trend
  const cumulativeLines: GlLineFact[] = [];
  const trendInputs: PeriodTrendInput[] = [];
  let prevRevenue = money('0');
  let prevEbitda = money('0');
  let prevNetIncome = money('0');
  let prevOperatingCashFlow = money('0');
  let finalBundle = buildArticulatingStatements({
    accounts,
    openingBalancesByKey,
    periodGlLines: allFyLines,
  });

  for (const periodRow of fyPeriods) {
    const pLines = linesByPeriodId.get(periodRow.id) ?? [];
    for (const line of pLines) cumulativeLines.push(line);

    const bundle = buildArticulatingStatements({
      accounts,
      openingBalancesByKey,
      periodGlLines: cumulativeLines,
    });
    if (periodRow.id === throughRow.id) {
      finalBundle = bundle;
    }

    trendInputs.push({
      periodCode: periodRow.code,
      periodNo: periodRow.period_no,
      fiscalYear: periodRow.fiscal_year,
      revenue: sub(bundle.pnl.revenue, prevRevenue),
      ebitda: sub(bundle.pnl.ebitda, prevEbitda),
      netIncome: sub(bundle.pnl.netIncome, prevNetIncome),
      operatingCashFlow: sub(bundle.cashFlow.operatingCashFlow, prevOperatingCashFlow),
      endingCash: bundle.cashFlow.endingCash,
    });

    prevRevenue = bundle.pnl.revenue;
    prevEbitda = bundle.pnl.ebitda;
    prevNetIncome = bundle.pnl.netIncome;
    prevOperatingCashFlow = bundle.cashFlow.operatingCashFlow;
  }

  // Plan statement totals (from current budget plan_version YTD through throughRow.period_no)
  const hasPlan = budget.planVersionId !== null && budget.lines.length > 0;
  let planRevenue: ReturnType<typeof money> | null = null;
  let planEbitda: ReturnType<typeof money> | null = null;
  if (hasPlan) {
    const planAmountsByKey = new Map<string, ReturnType<typeof money>[]>();
    let hasRevenuePlanLine = false;
    let hasEbitdaPlanLine = false;
    for (const line of budget.lines) {
      if (line.periodNo > throughRow.period_no) continue;
      const acct = accountsByCode.get(line.accountCode);
      if (acct === undefined || !acct.statementLineKey.startsWith('pl.')) continue;
      if (acct.statementLineKey.startsWith('pl.revenue.')) hasRevenuePlanLine = true;
      if (
        acct.statementLineKey.startsWith('pl.revenue.') ||
        acct.statementLineKey.startsWith('pl.cogs.') ||
        acct.statementLineKey.startsWith('pl.opex.')
      ) {
        hasEbitdaPlanLine = true;
      }
      const list = planAmountsByKey.get(acct.statementLineKey);
      if (list === undefined) planAmountsByKey.set(acct.statementLineKey, [money(line.amount)]);
      else list.push(money(line.amount));
    }
    const pnlPlanInputs: PnlLineInput[] = [];
    for (const [key, vals] of planAmountsByKey.entries()) {
      pnlPlanInputs.push({ statementLineKey: key, naturalAmount: sum(vals) });
    }
    const planPnl = computePnlStatement(pnlPlanInputs);
    planRevenue = hasRevenuePlanLine ? planPnl.revenue : null;
    planEbitda = hasEbitdaPlanLine ? planPnl.ebitda : null;
  }

  const kpiLibrary = evaluateKpiLibrary({
    currencyScale,
    hasPlan,
    pnl: {
      revenue: finalBundle.pnl.revenue,
      cogs: finalBundle.pnl.cogs,
      grossProfit: finalBundle.pnl.grossProfit,
      opex: finalBundle.pnl.opex,
      ebitda: finalBundle.pnl.ebitda,
      netIncome: finalBundle.pnl.netIncome,
    },
    balanceSheet: {
      totalAssets: finalBundle.balanceSheet.totalAssets,
      totalLiabilities: finalBundle.balanceSheet.totalLiabilities,
      totalEquity: finalBundle.balanceSheet.totalEquity,
      cashBalance: finalBundle.balanceSheet.cashBalance,
    },
    cashFlow: {
      operatingCashFlow: finalBundle.cashFlow.operatingCashFlow,
      freeCashFlow: finalBundle.cashFlow.freeCashFlow,
      endingCash: finalBundle.cashFlow.endingCash,
    },
    plan: {
      revenue: planRevenue,
      ebitda: planEbitda,
    },
  });

  const mergedStatementLines = new Map<string, ReturnType<typeof money>>([
    ...finalBundle.pnl.byKey.entries(),
    ...finalBundle.balanceSheet.byKey.entries(),
  ]);

  const trend = buildKpiTrendSeries(trendInputs, currencyScale);
  const reportBuilder = buildReportBlocks({
    templateId,
    kpiLibrary,
    statementLinesByKey: mergedStatementLines,
  });

  return {
    companyId: params.companyId,
    companyName: company.name,
    baseCurrency: company.base_currency,
    currencyScale,
    range: {
      fromPeriodCode: fromRow.code,
      throughPeriodCode: throughRow.code,
      fiscalYear: throughRow.fiscal_year,
    },
    hasActuals: lineRes.rows.length > 0 || sourceRes.rows.length > 0,
    hasPlan,
    scenarioName: budget.scenarioName,
    versionNo: budget.versionNo,
    articulation: {
      valid: finalBundle.articulation.valid,
      checks: finalBundle.articulation.checks.map((c) => ({
        id: c.id,
        name: c.name,
        passed: c.passed,
        delta: serialize(money(c.delta), currencyScale),
        detail: c.detail,
      })),
    },
    kpis: kpiLibrary.kpis.map((kpi) => ({
      ...kpi,
      sourceKeys: [...kpi.sourceKeys],
    })),
    trend: [...trend],
    reportBuilder: {
      ...reportBuilder,
      blocks: [...reportBuilder.blocks],
    },
    sources: sourceRes.rows.map((row) => ({
      batchId: String(row['batchId']),
      sourceFilename: String(row['sourceFilename']),
      sourceHash: String(row['sourceHash']),
      importedAt: String(row['importedAt']),
    })),
  };
}

export async function getDashboardSummaryWithMeta(
  db: SqlExecutor,
  params: DashboardSummaryParams,
): Promise<{
  readonly report: DashboardSummaryResponse;
  readonly cacheHit: boolean;
  readonly fingerprint: string;
}> {
  const resolvedPeriod = await resolvePeriod(
    db,
    params.companyId,
    params.throughPeriodCode,
    params.fiscalYear,
  );
  const templateId: ReportTemplateId = params.templateId ?? 'executive_summary';
  const cacheKey = `${params.companyId}:${String(resolvedPeriod.fiscal_year)}:${String(resolvedPeriod.period_no)}:${templateId}`;
  const fingerprint = await computeCompanyDashboardFingerprint(db, params.companyId);

  const dbCache = getDbCache(db);
  const cached = dbCache.get(cacheKey);
  if (cached !== undefined && cached.fingerprint === fingerprint) {
    return {
      report: cached.report,
      cacheHit: true,
      fingerprint,
    };
  }

  const report = await computeDashboardSummaryUncached(db, {
    companyId: params.companyId,
    throughPeriodCode: resolvedPeriod.code,
    fiscalYear: resolvedPeriod.fiscal_year,
    templateId,
  });
  dbCache.set(cacheKey, { fingerprint, report });
  return {
    report,
    cacheHit: false,
    fingerprint,
  };
}

export async function getDashboardSummary(
  db: SqlExecutor,
  params: DashboardSummaryParams,
): Promise<DashboardSummaryResponse> {
  const { report } = await getDashboardSummaryWithMeta(db, params);
  return report;
}
