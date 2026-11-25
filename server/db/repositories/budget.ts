import { parseBudgetCsv } from '../../../core/budget/index.js';
import { money, scaleForCurrency, serialize, sum } from '../../../core/money/index.js';
import type {
  BudgetAccountTotal,
  BudgetImportResult,
  BudgetLine,
  BudgetReport,
} from '../../../shared/budget.js';
import { AppError } from '../../../shared/errors.js';
import { appendAuditLog } from '../../audit/index.js';
import type { SqlExecutor } from '../migrate.js';

/**
 * Budget (plan) persistence and read model (MASTER_PROMPT §5.7; Spine Gates G4/G10).
 *
 * - The CSV is parsed by the PURE `/core/budget` parser before any write, so one bad row rejects
 *   the whole file and nothing is persisted (§1.6-7). Unknown account codes / period codes are
 *   resolved against this company's own chart and calendar and reported with row numbers.
 * - Plan rows live in `scenario → plan_version → plan_line`. They are NEVER inserted into
 *   `gl_entry`: a budget can never be mistaken for an actual, and the actuals-only guard added in
 *   WI-0024 stays the only path into the GL.
 * - Each import creates a NEW `plan_version` and flips `is_current` on the previous one inside the
 *   same transaction, so history is kept and no line is ever duplicated across versions.
 * - The audit row is written in the SAME transaction as the lines (G10).
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
}

interface PeriodRow extends Record<string, unknown> {
  id: string;
  code: string;
  period_no: number;
}

interface EntityRow extends Record<string, unknown> {
  id: string;
}

interface ScenarioRow extends Record<string, unknown> {
  id: string;
  kind: string;
  name: string;
}

interface PlanVersionRow extends Record<string, unknown> {
  id: string;
  version_no: number;
}

interface PlanLineRow extends Record<string, unknown> {
  code: string;
  name: string;
  type: string;
  normal_side: string;
  period_code: string;
  period_no: number;
  amount: string | number;
}

interface CurrentVersionRow extends Record<string, unknown> {
  scenario_id: string;
  scenario_name: string;
  plan_version_id: string;
  version_no: number;
}

/** The scenario name a fiscal year's budget lives under; unique per company by schema. */
export function budgetScenarioName(fiscalYear: number): string {
  return `Budget FY${String(fiscalYear)}`;
}

async function readCompanyCurrency(db: SqlExecutor, companyId: string): Promise<string> {
  const res = await db.query<CompanyRow>('SELECT base_currency FROM company WHERE id = $1', [
    companyId,
  ]);
  const row = res.rows[0];
  if (row === undefined) {
    throw new AppError('NOT_FOUND', { userMessage: 'The company workspace no longer exists.' });
  }
  return row.base_currency;
}

export interface BudgetParams {
  readonly companyId: string;
  readonly fiscalYear: number;
}

export async function getBudget(db: SqlExecutor, params: BudgetParams): Promise<BudgetReport> {
  const currency = await readCompanyCurrency(db, params.companyId);
  const scale = scaleForCurrency(currency);
  const scenarioName = budgetScenarioName(params.fiscalYear);

  const versionRes = await db.query<CurrentVersionRow>(
    `SELECT s.id AS scenario_id,
            s.name AS scenario_name,
            pv.id AS plan_version_id,
            pv.version_no
       FROM scenario s
       JOIN plan_version pv
         ON pv.company_id = s.company_id
        AND pv.scenario_id = s.id
        AND pv.is_current = true
      WHERE s.company_id = $1
        AND s.kind = 'budget'
        AND s.name = $2
      ORDER BY pv.version_no DESC
      LIMIT 1`,
    [params.companyId, scenarioName],
  );
  const version = versionRes.rows[0];

  if (version === undefined) {
    return {
      companyId: params.companyId,
      fiscalYear: params.fiscalYear,
      scenarioId: null,
      scenarioName: null,
      planVersionId: null,
      versionNo: null,
      lineCount: 0,
      totalAmount: serialize(money('0'), scale),
      lines: [],
      accounts: [],
    };
  }

  const lineRes = await db.query<PlanLineRow>(
    `SELECT a.code,
            a.name,
            a.type,
            a.normal_side,
            fp.code AS period_code,
            fp.period_no,
            pl.amount
       FROM plan_line pl
       JOIN account a
         ON a.company_id = pl.company_id AND a.id = pl.account_id
       JOIN fiscal_period fp
         ON fp.company_id = pl.company_id AND fp.id = pl.period_id
      WHERE pl.company_id = $1
        AND pl.scenario_id = $2
        AND pl.version_id = $3
      ORDER BY a.code ASC, fp.period_no ASC`,
    [params.companyId, version.scenario_id, version.plan_version_id],
  );

  const lines: BudgetLine[] = lineRes.rows.map((row) => ({
    accountCode: row.code,
    accountName: row.name,
    accountType: row.type as BudgetLine['accountType'],
    periodCode: row.period_code,
    periodNo: row.period_no,
    amount: serialize(money(String(row.amount)), scale),
  }));

  const accounts = buildAccountTotals(lineRes.rows, scale);

  return {
    companyId: params.companyId,
    fiscalYear: params.fiscalYear,
    scenarioId: version.scenario_id,
    scenarioName: version.scenario_name,
    planVersionId: version.plan_version_id,
    versionNo: version.version_no,
    lineCount: lines.length,
    totalAmount: serialize(
      sum(lines.map((line) => money(line.amount))),
      scale,
    ),
    lines,
    accounts,
  };
}

/** Groups plan lines per account and sums them with Decimal arithmetic (never SQL float math). */
function buildAccountTotals(rows: readonly PlanLineRow[], scale: number): BudgetAccountTotal[] {
  const order: string[] = [];
  const grouped = new Map<string, { row: PlanLineRow; amounts: string[] }>();
  for (const row of rows) {
    const existing = grouped.get(row.code);
    if (existing === undefined) {
      order.push(row.code);
      grouped.set(row.code, { row, amounts: [String(row.amount)] });
    } else {
      existing.amounts.push(String(row.amount));
    }
  }
  return order.map((code) => {
    const entry = grouped.get(code);
    if (entry === undefined) {
      throw new Error(`GROUP_LOST_ACCOUNT: ${code}`);
    }
    return {
      accountCode: entry.row.code,
      accountName: entry.row.name,
      accountType: entry.row.type as BudgetAccountTotal['accountType'],
      normalSide: entry.row.normal_side as BudgetAccountTotal['normalSide'],
      amount: serialize(sum(entry.amounts.map((amount) => money(amount))), scale),
    };
  });
}

export interface BudgetImportParams extends BudgetParams {
  readonly actorId: string;
  readonly csvText: string;
  readonly sourceFilename: string | null;
  readonly occurredAt: string;
}

export async function importBudget(
  tx: SqlExecutor,
  params: BudgetImportParams,
): Promise<BudgetImportResult> {
  const parsed = parseBudgetCsv(params.csvText);
  const issues: string[] = parsed.issues.map((issue) => `row ${issue.rowNo}: ${issue.reason}`);
  if (issues.length > 0) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `The budget file has ${issues.length} rejected row(s); nothing was written.`,
      details: { issues },
    });
  }
  if (parsed.lines.length === 0) {
    throw new AppError('IMPORT_FILE_UNREADABLE', {
      userMessage: 'The budget file contains no plan lines.',
    });
  }

  const [accountRes, periodRes, entityRes] = await Promise.all([
    tx.query<AccountRow>(
      `SELECT id, code, name, type, normal_side
         FROM account
        WHERE company_id = $1 AND active = true
        ORDER BY code ASC`,
      [params.companyId],
    ),
    tx.query<PeriodRow>(
      `SELECT id, code, period_no
         FROM fiscal_period
        WHERE company_id = $1 AND fiscal_year = $2
        ORDER BY period_no ASC`,
      [params.companyId, params.fiscalYear],
    ),
    tx.query<EntityRow>(
      `SELECT id FROM entity WHERE company_id = $1 ORDER BY code ASC LIMIT 1`,
      [params.companyId],
    ),
  ]);

  const accountsByCode = new Map(accountRes.rows.map((row) => [row.code, row]));
  const periodsByCode = new Map(periodRes.rows.map((row) => [row.code, row]));
  const entity = entityRes.rows[0];
  if (entity === undefined) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'This company has no entity to plan against; create the workspace first.',
      details: { issues: ['entity: missing'] },
    });
  }

  const periodCodes = [...new Set(parsed.lines.map((line) => line.periodCode))].sort();
  if (periodCodes.length === 0) {
    throw new AppError('IMPORT_FILE_UNREADABLE', {
      userMessage: 'The budget file contains no plan lines.',
    });
  }

  // Resolve every account/period against THIS company's chart and calendar; a line for something
  // that does not exist is reported, never invented.
  const resolved: Array<{
    account: AccountRow;
    period: PeriodRow;
    amount: string;
  }> = [];
  const unresolved: string[] = [];
  for (const line of parsed.lines) {
    const account = accountsByCode.get(line.accountCode);
    if (account === undefined) {
      unresolved.push(`row ${String(line.rowNo)}: UNMAPPED_ACCOUNT:${line.accountCode}`);
      continue;
    }
    const period = periodsByCode.get(line.periodCode);
    if (period === undefined) {
      unresolved.push(
        `row ${String(line.rowNo)}: UNKNOWN_PERIOD:${line.periodCode} (fiscal year ${String(params.fiscalYear)})`,
      );
      continue;
    }
    resolved.push({ account, period, amount: line.amount });
  }
  if (unresolved.length > 0) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `The budget file references ${unresolved.length} unknown account/period(s); nothing was written.`,
      details: { issues: unresolved },
    });
  }

  const scenarioName = budgetScenarioName(params.fiscalYear);
  const existingScenario = await tx.query<ScenarioRow>(
    `SELECT id, kind, name FROM scenario WHERE company_id = $1 AND name = $2`,
    [params.companyId, scenarioName],
  );
  let scenarioId: string;
  const scenario = existingScenario.rows[0];
  if (scenario === undefined) {
    const created = await tx.query<{ id: string }>(
      `INSERT INTO scenario (company_id, kind, name, status)
       VALUES ($1, 'budget', $2, 'draft')
       RETURNING id`,
      [params.companyId, scenarioName],
    );
    const createdId = created.rows[0]?.id;
    if (createdId === undefined) {
      throw new AppError('INTERNAL_ERROR', { userMessage: 'The budget scenario could not be created.' });
    }
    scenarioId = createdId;
  } else {
    if (scenario.kind !== 'budget') {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `A ${scenario.kind} scenario already uses the name "${scenarioName}"; nothing was written.`,
        details: { issues: [`SCENARIO_NAME_CONFLICT:${scenarioName}`] },
      });
    }
    scenarioId = scenario.id;
  }

  const priorRes = await tx.query<{ max_no: number | null }>(
    `SELECT MAX(version_no) AS max_no FROM plan_version WHERE company_id = $1 AND scenario_id = $2`,
    [params.companyId, scenarioId],
  );
  const versionNo = Number(priorRes.rows[0]?.max_no ?? 0) + 1;

  await tx.query(
    `UPDATE plan_version
        SET is_current = false
      WHERE company_id = $1 AND scenario_id = $2 AND is_current = true`,
    [params.companyId, scenarioId],
  );

  const versionRes = await tx.query<PlanVersionRow>(
    `INSERT INTO plan_version (company_id, scenario_id, version_no, label, is_current)
     VALUES ($1, $2, $3, $4, true)
     RETURNING id, version_no`,
    [params.companyId, scenarioId, versionNo, `FY${String(params.fiscalYear)} Budget v${String(versionNo)}`],
  );
  const version = versionRes.rows[0];
  if (version === undefined) {
    throw new AppError('INTERNAL_ERROR', { userMessage: 'The budget version could not be created.' });
  }

  for (const line of resolved) {
    await tx.query(
      `INSERT INTO plan_line
         (company_id, scenario_id, version_id, account_id, period_id, entity_id, department_id, amount)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)`,
      [
        params.companyId,
        scenarioId,
        version.id,
        line.account.id,
        line.period.id,
        entity.id,
        line.amount,
      ],
    );
  }

  const report = await getBudget(tx, { companyId: params.companyId, fiscalYear: params.fiscalYear });

  await appendAuditLog(tx, {
    companyId: params.companyId,
    actorId: params.actorId,
    action: 'budget.import',
    targetTable: 'plan_version',
    targetId: version.id,
    oldPayload: null,
    newPayload: {
      scenarioId,
      scenarioName,
      planVersionId: version.id,
      versionNo: version.version_no,
      fiscalYear: params.fiscalYear,
      sourceFilename: params.sourceFilename,
      rowCount: parsed.rowCount,
      lineCount: report.lineCount,
      accountCount: report.accounts.length,
      periodCodes,
      totalAmount: report.totalAmount,
    },
    occurredAt: params.occurredAt,
  });

  return { ...report, rowCount: parsed.rowCount };
}
