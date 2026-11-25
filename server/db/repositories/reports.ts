import type Decimal from 'decimal.js';
import { add, money, scaleForCurrency, serialize, sum } from '../../../core/money/index.js';
import {
  buildArticulatingStatements,
  buildTrialBalance,
  computeNaturalActivity,
  computeSheetContribution,
  normalizeCode,
  type AccountType,
  type GlLineFact,
  type NormalSide,
  type StatementAccountDef,
} from '../../../core/statements/index.js';
import { AppError } from '../../../shared/errors.js';
import type { StatementLineKey } from '../../../shared/spine.js';
import type {
  AccountDrillRow,
  AccountDrilldown,
  FinancialStatements,
  TrialBalanceReport,
  TrialBalanceRow,
  TrialBalanceSource,
} from '../../../shared/reports.js';
import type { SqlExecutor } from '../migrate.js';
import { activeBatchPredicate } from './import.js';

/**
 * Trial-balance and drill-to-source read model (MASTER_PROMPT §4.2, §7.6; Spine G2/G3/G6).
 *
 * Every query filters postings through `ACTIVE_BATCH_PREDICATE`, so a batch that was replaced by a
 * re-import can never be double-counted. All arithmetic happens in /core (buildTrialBalance); this
 * module only moves NUMERIC text into Decimals and Decimals back into canonical strings.
 */

interface CompanyRow extends Record<string, unknown> {
  base_currency: string;
}

interface AccountRow extends Record<string, unknown> {
  id: string;
  code: string;
  name: string;
  type: string;
  normal_side: string;
  is_contra: boolean;
  statement_line_key: string;
}

interface LineRow extends Record<string, unknown> {
  entry_id: string;
  account_id: string;
  period_id: string;
  debit: string;
  credit: string;
}

interface PeriodRow extends Record<string, unknown> {
  id: string;
  code: string;
  fiscal_year: number;
  period_no: number;
}

interface PeriodKey {
  readonly fiscalYear: number;
  readonly periodNo: number;
}

export interface TrialBalanceParams {
  readonly companyId: string;
  readonly throughPeriodCode?: string | null;
  readonly fiscalYear?: number | null;
}

async function loadCompanyCurrency(db: SqlExecutor, companyId: string): Promise<string> {
  const res = await db.query<CompanyRow>(`SELECT base_currency FROM company WHERE id = $1`, [companyId]);
  const currency = res.rows[0]?.base_currency;
  if (currency === undefined) {
    throw new AppError('NOT_FOUND', { userMessage: 'The company could not be found.' });
  }
  return currency;
}

/**
 * Resolves a period code into its (fiscal_year, period_no) key so "through period" comparisons are
 * calendar-shaped rather than string-shaped. A 12-month calendar reuses `P01` in every fiscal year,
 * so a code that matches more than one year is AMBIGUOUS and must be disambiguated by `fiscalYear`
 * rather than silently resolved to whichever row the database returned first.
 */
async function resolvePeriod(
  db: SqlExecutor,
  companyId: string,
  periodCode: string,
  fiscalYear?: number | null,
): Promise<PeriodRow> {
  const res = await db.query<PeriodRow>(
    `SELECT id, code, fiscal_year, period_no
       FROM fiscal_period
      WHERE company_id = $1 AND code = $2${fiscalYear === undefined || fiscalYear === null ? '' : ' AND fiscal_year = $3'}
      ORDER BY fiscal_year ASC`,
    fiscalYear === undefined || fiscalYear === null
      ? [companyId, periodCode]
      : [companyId, periodCode, fiscalYear],
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

async function resolveThroughPeriod(
  db: SqlExecutor,
  companyId: string,
  periodCode: string | null | undefined,
  fiscalYear?: number | null,
): Promise<{ code: string; key: PeriodKey } | null> {
  if (periodCode === null || periodCode === undefined) return null;
  const row = await resolvePeriod(db, companyId, periodCode, fiscalYear);
  return { code: row.code, key: { fiscalYear: row.fiscal_year, periodNo: row.period_no } };
}

function periodFilter(
  alias: string,
  key: PeriodKey | null,
  startIndex: number,
): { sql: string; params: unknown[] } {
  if (key === null) return { sql: '', params: [] };
  return {
    sql:
      ` AND (${alias}.fiscal_year < $${startIndex}` +
      ` OR (${alias}.fiscal_year = $${startIndex} AND ${alias}.period_no <= $${startIndex + 1}))`,
    params: [key.fiscalYear, key.periodNo],
  };
}

export async function getTrialBalance(
  db: SqlExecutor,
  params: TrialBalanceParams,
): Promise<TrialBalanceReport> {
  const currency = await loadCompanyCurrency(db, params.companyId);
  const scale = scaleForCurrency(currency);
  const through = await resolveThroughPeriod(
    db,
    params.companyId,
    params.throughPeriodCode,
    params.fiscalYear,
  );

  const accountRes = await db.query<AccountRow>(
    `SELECT id, code, name, type, normal_side, is_contra, statement_line_key
       FROM account
      WHERE company_id = $1 AND active = true
      ORDER BY code ASC`,
    [params.companyId],
  );
  const accounts: StatementAccountDef[] = accountRes.rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type as AccountType,
    normalSide: row.normal_side as NormalSide,
    isContra: row.is_contra,
    statementLineKey: row.statement_line_key,
  }));

  const filter = periodFilter('fp', through === null ? null : through.key, 2);
  const lineParams: unknown[] = [params.companyId, ...filter.params];
  const lineRes = await db.query<LineRow>(
    `SELECT gl.entry_id, gl.account_id, gl.period_id, gl.debit::text AS debit, gl.credit::text AS credit
       FROM gl_line gl
       JOIN gl_entry ge ON ge.id = gl.entry_id
       JOIN fiscal_period fp ON fp.id = gl.period_id
      WHERE gl.company_id = $1
        AND ${activeBatchPredicate('ge')}${filter.sql}
      ORDER BY gl.entry_id ASC, gl.id ASC`,
    lineParams,
  );

  const lines: GlLineFact[] = lineRes.rows.map((row) => ({
    entryId: row.entry_id,
    accountId: row.account_id,
    periodId: row.period_id,
    debit: money(row.debit),
    credit: money(row.credit),
  }));

  const tb = buildTrialBalance(accounts, lines);

  const rows: TrialBalanceRow[] = tb.rows.map((row) => ({
    accountId: row.accountId,
    code: row.code,
    name: row.name,
    type: row.type,
    normalSide: row.normalSide,
    statementLineKey: row.statementLineKey as StatementLineKey,
    totalDebit: serialize(row.totalDebit, scale),
    totalCredit: serialize(row.totalCredit, scale),
    naturalActivity: serialize(row.naturalActivity, scale),
    sheetContribution: serialize(row.sheetContribution, scale),
  }));

  const sourceRes = await db.query<TrialBalanceSource & Record<string, unknown>>(
    `SELECT b.id AS "batchId", b.source_filename AS "sourceFilename", b.source_hash AS "sourceHash",
            b.imported_at::text AS "importedAt"
       FROM import_batch b
      WHERE b.company_id = $1 AND b.status IN ('staged', 'committed')
      ORDER BY b.imported_at ASC, b.id ASC`,
    [params.companyId],
  );

  return {
    companyId: params.companyId,
    throughPeriodCode: through === null ? null : through.code,
    rows,
    totalDebit: serialize(tb.totalDebit, scale),
    totalCredit: serialize(tb.totalCredit, scale),
    isBalanced: tb.isBalanced,
    unbalancedEntryIds: [...tb.unbalancedEntryIds],
    sources: sourceRes.rows.map((row) => ({
      batchId: String(row['batchId']),
      sourceFilename: String(row['sourceFilename']),
      sourceHash: String(row['sourceHash']),
      importedAt: String(row['importedAt']),
    })),
  };
}

/**
 * Drill-to-source (G6): every posting of one account, with the file, batch and raw source row that
 * produced it, so a number on a screen can always be opened down to the row the client sent.
 */
export async function getAccountDrilldown(
  db: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly accountCode: string;
    readonly throughPeriodCode?: string | null;
    readonly fiscalYear?: number | null;
  },
): Promise<AccountDrilldown> {
  const currency = await loadCompanyCurrency(db, params.companyId);
  const scale = scaleForCurrency(currency);
  const through = await resolveThroughPeriod(
    db,
    params.companyId,
    params.throughPeriodCode,
    params.fiscalYear,
  );
  const code = normalizeCode(params.accountCode);

  const accountRes = await db.query<AccountRow>(
    `SELECT id, code, name, type, normal_side, is_contra, statement_line_key
       FROM account
      WHERE company_id = $1 AND code = $2`,
    [params.companyId, code],
  );
  const account = accountRes.rows[0];
  if (account === undefined) {
    throw new AppError('NOT_FOUND', {
      userMessage: `Account ${code} does not exist in this company chart of accounts.`,
      details: { accountCode: code },
    });
  }

  const filter = periodFilter('fp', through === null ? null : through.key, 3);
  const params4: unknown[] = [params.companyId, account.id, ...filter.params];
  const lineRes = await db.query<Record<string, unknown>>(
    `SELECT gl.id, ge.id AS entry_id, ge.entry_date::text AS entry_date, ge.source_ref,
            fp.code AS period_code, gl.debit::text AS debit, gl.credit::text AS credit,
            b.id AS batch_id, b.source_filename, b.source_hash,
            raw.row_no, raw.raw_payload
       FROM gl_line gl
       JOIN gl_entry ge ON ge.id = gl.entry_id
       JOIN fiscal_period fp ON fp.id = gl.period_id
       JOIN import_batch b ON b.id = ge.batch_id
       JOIN import_row_raw raw ON raw.id = gl.source_row_id
      WHERE gl.company_id = $1
        AND gl.account_id = $2
        AND ${activeBatchPredicate('ge')}${filter.sql}
      ORDER BY ge.entry_date ASC, ge.source_ref ASC, raw.row_no ASC`,
    params4,
  );

  const rows: AccountDrillRow[] = lineRes.rows.map((row) => {
    const payload = row['raw_payload'] as { cells?: unknown } | null;
    const cells = Array.isArray(payload?.cells) ? payload.cells.map((cell) => String(cell)) : [];
    return {
      entryId: String(row['entry_id']),
      entryDate: String(row['entry_date']),
      sourceRef: row['source_ref'] === null || row['source_ref'] === undefined ? null : String(row['source_ref']),
      periodCode: String(row['period_code']),
      debit: serialize(money(String(row['debit'])), scale),
      credit: serialize(money(String(row['credit'])), scale),
      batchId: String(row['batch_id']),
      sourceFilename: String(row['source_filename']),
      sourceHash: String(row['source_hash']),
      rowNo: Number(row['row_no']),
      rawCells: cells,
    };
  });

  const totalDebit = serialize(sum(rows.map((row) => money(row.debit))), scale);
  const totalCredit = serialize(sum(rows.map((row) => money(row.credit))), scale);
  const naturalActivity = serialize(
    computeNaturalActivity(account.normal_side as NormalSide, money(totalDebit), money(totalCredit)),
    scale,
  );

  return {
    companyId: params.companyId,
    accountCode: account.code,
    accountName: account.name,
    throughPeriodCode: through === null ? null : through.code,
    rows,
    totalDebit,
    totalCredit,
    naturalActivity,
  };
}

export interface StatementsParams {
  readonly companyId: string;
  readonly throughPeriodCode: string;
  readonly fiscalYear?: number | null;
}

/**
 * Articulating statements (MASTER_PROMPT §4.5, §5.6; Spine G3): opening position + period activity
 * → P&L, balance sheet, indirect cash flow, retained-earnings roll-forward, and the A1–A5 checks.
 *
 * Statements are YEAR-TO-DATE for the fiscal year of `throughPeriodCode`: activity runs from the
 * year's first period through the requested period, and opening balances are the sheet
 * contributions of every active posting strictly BEFORE that first period. A sub-year range would
 * not articulate, because the unclosed earnings of the earlier months of the same year are still
 * sitting in the P&L accounts rather than in retained earnings — the balance sheet would be short
 * by exactly that amount. Both sides therefore come from the same immutable GL.
 */
export async function getFinancialStatements(
  db: SqlExecutor,
  params: StatementsParams,
): Promise<FinancialStatements> {
  const currency = await loadCompanyCurrency(db, params.companyId);
  const scale = scaleForCurrency(currency);

  const throughRow = await resolvePeriod(
    db,
    params.companyId,
    params.throughPeriodCode,
    params.fiscalYear,
  );
  const throughKey: PeriodKey = { fiscalYear: throughRow.fiscal_year, periodNo: throughRow.period_no };

  const yearStartRes = await db.query<PeriodRow>(
    `SELECT id, code, fiscal_year, period_no
       FROM fiscal_period
      WHERE company_id = $1 AND fiscal_year = $2
      ORDER BY period_no ASC
      LIMIT 1`,
    [params.companyId, throughKey.fiscalYear],
  );
  const fromRow = yearStartRes.rows[0];
  if (fromRow === undefined) {
    throw new AppError('PERIOD_NOT_FOUND', {
      userMessage: 'The fiscal year of the requested period has no periods.',
      details: { periodCode: throughRow.code, fiscalYear: throughKey.fiscalYear },
    });
  }
  const fromKey: PeriodKey = { fiscalYear: fromRow.fiscal_year, periodNo: fromRow.period_no };

  const accountRes = await db.query<AccountRow>(
    `SELECT id, code, name, type, normal_side, is_contra, statement_line_key
       FROM account
      WHERE company_id = $1 AND active = true
      ORDER BY code ASC`,
    [params.companyId],
  );
  const accounts: StatementAccountDef[] = accountRes.rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type as AccountType,
    normalSide: row.normal_side as NormalSide,
    isContra: row.is_contra,
    statementLineKey: row.statement_line_key as StatementLineKey,
  }));
  const accountsById = new Map(accounts.map((account) => [account.id, account]));

  const lineRes = await db.query<LineRow | (LineRow & { in_range: boolean })>(
    `SELECT gl.entry_id, gl.account_id, gl.period_id, gl.debit::text AS debit, gl.credit::text AS credit,
            (fp.fiscal_year > $2 OR (fp.fiscal_year = $2 AND fp.period_no >= $3)) AS in_range
       FROM gl_line gl
       JOIN gl_entry ge ON ge.id = gl.entry_id
       JOIN fiscal_period fp ON fp.id = gl.period_id
      WHERE gl.company_id = $1
        AND ${activeBatchPredicate('ge')}
        AND (fp.fiscal_year < $4 OR (fp.fiscal_year = $4 AND fp.period_no <= $5))
      ORDER BY gl.entry_id ASC, gl.id ASC`,
    [params.companyId, fromKey.fiscalYear, fromKey.periodNo, throughKey.fiscalYear, throughKey.periodNo],
  );

  const activity: GlLineFact[] = [];
  const openingBalancesByKey = new Map<string, ReturnType<typeof money>>();
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
    const inRange = (row as { in_range?: boolean }).in_range === true;
    if (inRange) {
      activity.push({
        entryId: row.entry_id,
        accountId: row.account_id,
        periodId: row.period_id,
        debit,
        credit,
      });
      continue;
    }
    if (account.statementLineKey.startsWith('bs.')) {
      const contribution = computeSheetContribution(account.type, debit, credit);
      const prev = openingBalancesByKey.get(account.statementLineKey) ?? money('0');
      openingBalancesByKey.set(account.statementLineKey, add(prev, contribution));
    }
  }

  const bundle = buildArticulatingStatements({ accounts, openingBalancesByKey, periodGlLines: activity });

  const toRecord = (map: ReadonlyMap<string, Decimal>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [key, value] of map.entries()) out[key] = serialize(value, scale);
    return out;
  };

  const distributions = money(bundle.retainedEarnings.distributions);
  const retainedEarnings = {
    opening: serialize(bundle.retainedEarnings.opening, scale),
    netIncome: serialize(bundle.retainedEarnings.netIncome, scale),
    distributions: serialize(distributions, scale),
    closingTotal: serialize(bundle.retainedEarnings.closingTotal, scale),
    rollForwardValid: bundle.retainedEarnings.rollForwardValid,
  };

  const sourceRes = await db.query<Record<string, unknown>>(
    `SELECT b.id AS "batchId", b.source_filename AS "sourceFilename", b.source_hash AS "sourceHash",
            b.imported_at::text AS "importedAt"
       FROM import_batch b
      WHERE b.company_id = $1 AND b.status IN ('staged', 'committed')
      ORDER BY b.imported_at ASC, b.id ASC`,
    [params.companyId],
  );

  return {
    companyId: params.companyId,
    range: {
      fromPeriodCode: fromRow.code,
      throughPeriodCode: throughRow.code,
      fiscalYear: fromKey.fiscalYear,
    },
    pnl: {
      byKey: toRecord(bundle.pnl.byKey),
      revenue: serialize(bundle.pnl.revenue, scale),
      cogs: serialize(bundle.pnl.cogs, scale),
      grossProfit: serialize(bundle.pnl.grossProfit, scale),
      opex: serialize(bundle.pnl.opex, scale),
      ebitda: serialize(bundle.pnl.ebitda, scale),
      depreciation: serialize(bundle.pnl.depreciation, scale),
      ebit: serialize(bundle.pnl.ebit, scale),
      nonOperatingNet: serialize(bundle.pnl.nonOperatingNet, scale),
      ebt: serialize(bundle.pnl.ebt, scale),
      tax: serialize(bundle.pnl.tax, scale),
      netIncome: serialize(bundle.pnl.netIncome, scale),
    },
    balanceSheet: {
      byKey: toRecord(bundle.balanceSheet.byKey),
      currentAssets: serialize(bundle.balanceSheet.currentAssets, scale),
      nonCurrentAssets: serialize(bundle.balanceSheet.nonCurrentAssets, scale),
      totalAssets: serialize(bundle.balanceSheet.totalAssets, scale),
      currentLiabilities: serialize(bundle.balanceSheet.currentLiabilities, scale),
      nonCurrentLiabilities: serialize(bundle.balanceSheet.nonCurrentLiabilities, scale),
      totalLiabilities: serialize(bundle.balanceSheet.totalLiabilities, scale),
      totalEquity: serialize(bundle.balanceSheet.totalEquity, scale),
      totalLiabilitiesAndEquity: serialize(bundle.balanceSheet.totalLiabilitiesAndEquity, scale),
      cashBalance: serialize(bundle.balanceSheet.cashBalance, scale),
      balanceDelta: serialize(bundle.balanceSheet.balanceDelta, scale),
      isBalanced: bundle.balanceSheet.isBalanced,
    },
    cashFlow: {
      netIncome: serialize(bundle.cashFlow.netIncome, scale),
      nonCashAddbacks: serialize(bundle.cashFlow.nonCashAddbacks, scale),
      deltaWorkingCapitalCashImpact: serialize(bundle.cashFlow.deltaWorkingCapitalCashImpact, scale),
      operatingCashFlow: serialize(bundle.cashFlow.operatingCashFlow, scale),
      investingCashFlow: serialize(bundle.cashFlow.investingCashFlow, scale),
      freeCashFlow: serialize(bundle.cashFlow.freeCashFlow, scale),
      financingCashFlow: serialize(bundle.cashFlow.financingCashFlow, scale),
      netCashChange: serialize(bundle.cashFlow.netCashChange, scale),
      beginningCash: serialize(bundle.cashFlow.beginningCash, scale),
      endingCash: serialize(bundle.cashFlow.endingCash, scale),
    },
    retainedEarnings,
    articulation: {
      valid: bundle.articulation.valid,
      checks: bundle.articulation.checks.map((check) => ({
        id: check.id,
        name: check.name,
        passed: check.passed,
        delta: check.delta,
        detail: check.detail,
      })),
    },
    sources: sourceRes.rows.map((row) => ({
      batchId: String(row['batchId']),
      sourceFilename: String(row['sourceFilename']),
      sourceHash: String(row['sourceHash']),
      importedAt: String(row['importedAt']),
    })),
  };
}
