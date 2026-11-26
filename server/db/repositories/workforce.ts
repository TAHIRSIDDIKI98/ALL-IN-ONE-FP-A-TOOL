import {
  money,
  scaleForCurrency,
  serialize,
  STORAGE_SCALE,
} from '../../../core/money/index.js';
import {
  compileWorkforceModuleToDrivers,
  WORKFORCE_MODULE_SPEC,
  type WorkforcePositionInput,
} from '../../../core/workforce/index.js';
import { canActorCreateTask } from '../../../core/workflow/index.js';
import { AppError } from '../../../shared/errors.js';
import type {
  WorkforceCommitRequest,
  WorkforceCommitResponse,
  WorkforcePositionPayload,
  WorkforcePositionRecord,
  WorkforcePreviewRequest,
  WorkforcePreviewResponse,
  WorkforceWorkspaceResponse,
} from '../../../shared/workforce.js';
import { appendAuditLog } from '../../audit/index.js';
import type { SqlExecutor } from '../migrate.js';
import { commitDriverPlan } from './planning.js';
import { getMemberRole } from './workflow.js';

interface CompanyRow extends Record<string, unknown> {
  base_currency: string;
}

interface AccountRow extends Record<string, unknown> {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface PeriodRow extends Record<string, unknown> {
  code: string;
}

interface YearRow extends Record<string, unknown> {
  fiscal_year: number | null;
}

interface WorkforcePositionDbRow extends Record<string, unknown> {
  id: string;
  position_code: string;
  title: string;
  department_name: string;
  account_code: string;
  account_name: string;
  start_period_code: string;
  end_period_code: string | null;
  fte: string | number;
  annual_salary: string | number;
  burden_rate: string | number;
  bonus_rate: string | number;
  ramp_first_period_pct: string | number;
  merit_period_code: string | null;
  merit_increase_pct: string | number;
  status: 'active' | 'inactive';
  created_at: Date | string;
  updated_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function formatRatioString(raw: string | number): string {
  const fixed = serialize(money(String(raw)), 4);
  return fixed.replace(/(\.\d{2,}?)0+$/, '$1');
}

function normalizePositionCode(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

function mapPositionRow(
  row: WorkforcePositionDbRow,
  currencyScale: 0 | 2 | 3,
): WorkforcePositionRecord {
  return {
    id: row.id,
    positionCode: row.position_code,
    title: row.title,
    departmentName: row.department_name,
    accountCode: row.account_code,
    accountName: row.account_name,
    startPeriodCode: row.start_period_code,
    endPeriodCode: row.end_period_code,
    fte: serialize(money(String(row.fte)), 2),
    annualSalary: serialize(money(String(row.annual_salary)), currencyScale),
    burdenRate: formatRatioString(row.burden_rate),
    bonusRate: formatRatioString(row.bonus_rate),
    rampFirstPeriodPct: formatRatioString(row.ramp_first_period_pct),
    meritPeriodCode: row.merit_period_code,
    meritIncreasePct: formatRatioString(row.merit_increase_pct),
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

async function readCompanyCurrency(
  db: SqlExecutor,
  companyId: string,
): Promise<{ readonly currency: string; readonly currencyScale: 0 | 2 | 3 }> {
  const res = await db.query<CompanyRow>('SELECT base_currency FROM company WHERE id = $1', [
    companyId,
  ]);
  const row = res.rows[0];
  if (row === undefined) {
    throw new AppError('NOT_FOUND', { userMessage: 'The company workspace no longer exists.' });
  }
  return {
    currency: row.base_currency,
    currencyScale: scaleForCurrency(row.base_currency),
  };
}

async function resolveFiscalYear(
  db: SqlExecutor,
  companyId: string,
  requestedYear: number | null | undefined,
): Promise<number> {
  if (requestedYear !== undefined && requestedYear !== null) {
    return requestedYear;
  }
  const yearRes = await db.query<YearRow>(
    `SELECT MIN(fiscal_year) AS fiscal_year
       FROM fiscal_period
      WHERE company_id = $1 AND is_adjustment = false`,
    [companyId],
  );
  const year = yearRes.rows[0]?.fiscal_year;
  if (year === undefined || year === null) {
    throw new AppError('PERIOD_NOT_FOUND', {
      userMessage: 'No fiscal periods exist for this company calendar.',
    });
  }
  return year;
}

async function readCompanyPeriods(
  db: SqlExecutor,
  companyId: string,
  fiscalYear: number,
): Promise<readonly string[]> {
  const res = await db.query<PeriodRow>(
    `SELECT code
       FROM fiscal_period
      WHERE company_id = $1
        AND fiscal_year = $2
        AND is_adjustment = false
      ORDER BY period_no ASC`,
    [companyId, fiscalYear],
  );
  const periods = res.rows.map((r) => r.code);
  if (periods.length === 0) {
    throw new AppError('PERIOD_NOT_FOUND', {
      userMessage: `No fiscal periods exist for fiscal year ${String(fiscalYear)}.`,
    });
  }
  return periods;
}

async function readPostableAccounts(
  db: SqlExecutor,
  companyId: string,
): Promise<readonly AccountRow[]> {
  const res = await db.query<AccountRow>(
    `SELECT id, code, name, type
       FROM account
      WHERE company_id = $1
        AND active = true
        AND is_postable = true
      ORDER BY code ASC`,
    [companyId],
  );
  return res.rows;
}

async function readSavedPositions(
  db: SqlExecutor,
  companyId: string,
  currencyScale: 0 | 2 | 3,
): Promise<readonly WorkforcePositionRecord[]> {
  const res = await db.query<WorkforcePositionDbRow>(
    `SELECT wp.id,
            wp.position_code,
            wp.title,
            wp.department_name,
            a.code AS account_code,
            a.name AS account_name,
            wp.start_period_code,
            wp.end_period_code,
            wp.fte,
            wp.annual_salary,
            wp.burden_rate,
            wp.bonus_rate,
            wp.ramp_first_period_pct,
            wp.merit_period_code,
            wp.merit_increase_pct,
            wp.status,
            wp.created_at,
            wp.updated_at
       FROM workforce_position wp
       JOIN account a
         ON a.company_id = wp.company_id AND a.id = wp.account_id
      WHERE wp.company_id = $1
      ORDER BY wp.position_code ASC`,
    [companyId],
  );
  return res.rows.map((row) => mapPositionRow(row, currencyScale));
}

function validateRosterAgainstChartAndPeriods(params: {
  readonly positions: readonly WorkforcePositionPayload[];
  readonly yearPeriods: readonly string[];
  readonly accountIdByCode: ReadonlyMap<string, string>;
}): readonly string[] {
  const { positions, yearPeriods, accountIdByCode } = params;
  const periodIndex = new Map<string, number>();
  for (let i = 0; i < yearPeriods.length; i += 1) {
    periodIndex.set(yearPeriods[i]!, i);
  }

  const issues: string[] = [];
  const seenCodes = new Set<string>();

  for (const pos of positions) {
    const code = normalizePositionCode(pos.positionCode);
    if (seenCodes.has(code)) {
      issues.push(`DUPLICATE_POSITION_CODE:${code}`);
      continue;
    }
    seenCodes.add(code);

    const acctCode = pos.accountCode.trim();
    if (!accountIdByCode.has(acctCode)) {
      issues.push(`UNMAPPED_ACCOUNT:${acctCode}`);
    }

    const startCode = pos.startPeriodCode.trim();
    const startIdx = periodIndex.get(startCode);
    if (startIdx === undefined) {
      issues.push(`UNKNOWN_START_PERIOD:${code}/${startCode}`);
    }

    let endIdx = yearPeriods.length - 1;
    if (pos.endPeriodCode !== null && pos.endPeriodCode.trim().length > 0) {
      const endCode = pos.endPeriodCode.trim();
      const resolvedEnd = periodIndex.get(endCode);
      if (resolvedEnd === undefined) {
        issues.push(`UNKNOWN_END_PERIOD:${code}/${endCode}`);
      } else {
        endIdx = resolvedEnd;
      }
    }
    if (startIdx !== undefined && endIdx < startIdx) {
      issues.push(`END_BEFORE_START:${code}`);
    }

    if (pos.meritPeriodCode !== null && pos.meritPeriodCode.trim().length > 0) {
      const meritCode = pos.meritPeriodCode.trim();
      if (!periodIndex.has(meritCode)) {
        issues.push(`UNKNOWN_MERIT_PERIOD:${code}/${meritCode}`);
      }
    }

    if (money(pos.fte).isNegative()) {
      issues.push(`NEGATIVE_VALUE:${code}.fte`);
    }
    if (money(pos.annualSalary).isNegative()) {
      issues.push(`NEGATIVE_VALUE:${code}.annualSalary`);
    }
    if (money(pos.burdenRate).isNegative()) {
      issues.push(`NEGATIVE_VALUE:${code}.burdenRate`);
    }
    if (money(pos.bonusRate).isNegative()) {
      issues.push(`NEGATIVE_VALUE:${code}.bonusRate`);
    }
    const ramp = money(pos.rampFirstPeriodPct);
    if (ramp.isNegative() || ramp.gt(money('1'))) {
      issues.push(`RAMP_OUT_OF_RANGE:${code}`);
    }
    if (money(pos.meritIncreasePct).isNegative()) {
      issues.push(`NEGATIVE_VALUE:${code}.meritIncreasePct`);
    }
  }

  return issues;
}

export async function getWorkforceWorkspace(
  db: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly fiscalYear?: number | null;
  },
): Promise<WorkforceWorkspaceResponse> {
  const { currency, currencyScale } = await readCompanyCurrency(db, params.companyId);
  const actorRole = await getMemberRole(db, params.companyId, params.actorId);
  const fiscalYear = await resolveFiscalYear(db, params.companyId, params.fiscalYear);
  const periods = await readCompanyPeriods(db, params.companyId, fiscalYear);
  const accounts = await readPostableAccounts(db, params.companyId);
  const positions = await readSavedPositions(db, params.companyId, currencyScale);

  return {
    companyId: params.companyId,
    fiscalYear,
    currency,
    currencyScale,
    actorRole,
    moduleSpec: {
      moduleKey: WORKFORCE_MODULE_SPEC.moduleKey,
      moduleName: WORKFORCE_MODULE_SPEC.moduleName,
      version: WORKFORCE_MODULE_SPEC.version,
      dimensions: [...WORKFORCE_MODULE_SPEC.dimensions],
      driverKinds: ['fixed'],
      recommendedStatementLineKeys: [...WORKFORCE_MODULE_SPEC.recommendedStatementLineKeys],
      inputColumns: WORKFORCE_MODULE_SPEC.inputColumns.map((col) => ({ ...col })),
      reportPackSections: [...WORKFORCE_MODULE_SPEC.reportPackSections],
    },
    periods: [...periods],
    accounts: accounts.map((a) => ({ code: a.code, name: a.name, type: a.type })),
    positions: [...positions],
  };
}

export async function saveWorkforcePositions(
  tx: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly positions: readonly WorkforcePositionPayload[];
    readonly fiscalYear?: number | null;
    readonly occurredAt: string;
  },
): Promise<WorkforceWorkspaceResponse> {
  const actorRole = await getMemberRole(tx, params.companyId, params.actorId);
  if (!canActorCreateTask(actorRole)) {
    throw new AppError('TENANT_FORBIDDEN', {
      userMessage: `Role "${actorRole}" is read-only for Workforce planning; owner or editor access is required.`,
    });
  }

  const fiscalYear = await resolveFiscalYear(tx, params.companyId, params.fiscalYear);
  const yearPeriods = await readCompanyPeriods(tx, params.companyId, fiscalYear);
  const accounts = await readPostableAccounts(tx, params.companyId);
  const accountIdByCode = new Map<string, string>();
  for (const acct of accounts) {
    accountIdByCode.set(acct.code, acct.id);
  }

  const issues = validateRosterAgainstChartAndPeriods({
    positions: params.positions,
    yearPeriods,
    accountIdByCode,
  });
  if (issues.length > 0) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Workforce roster validation failed; no positions were saved.',
      details: { issues: [...issues] },
    });
  }

  const keepCodes = params.positions.map((p) => normalizePositionCode(p.positionCode));
  if (keepCodes.length === 0) {
    await tx.query('DELETE FROM workforce_position WHERE company_id = $1', [params.companyId]);
  } else {
    const placeholders = keepCodes.map((_, idx) => `$${String(idx + 2)}`).join(', ');
    await tx.query(
      `DELETE FROM workforce_position
        WHERE company_id = $1
          AND position_code NOT IN (${placeholders})`,
      [params.companyId, ...keepCodes],
    );
  }

  for (const pos of params.positions) {
    const code = normalizePositionCode(pos.positionCode);
    const accountId = accountIdByCode.get(pos.accountCode.trim())!;
    const endPeriodCode =
      pos.endPeriodCode !== null && pos.endPeriodCode.trim().length > 0
        ? pos.endPeriodCode.trim()
        : null;
    const meritPeriodCode =
      pos.meritPeriodCode !== null && pos.meritPeriodCode.trim().length > 0
        ? pos.meritPeriodCode.trim()
        : null;

    await tx.query(
      `INSERT INTO workforce_position (
         company_id, position_code, title, department_name, account_id,
         start_period_code, end_period_code, fte, annual_salary, burden_rate,
         bonus_rate, ramp_first_period_pct, merit_period_code, merit_increase_pct,
         status, created_by, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10,
         $11, $12, $13, $14,
         $15, $16, now()
       )
       ON CONFLICT (company_id, position_code) DO UPDATE SET
         title = EXCLUDED.title,
         department_name = EXCLUDED.department_name,
         account_id = EXCLUDED.account_id,
         start_period_code = EXCLUDED.start_period_code,
         end_period_code = EXCLUDED.end_period_code,
         fte = EXCLUDED.fte,
         annual_salary = EXCLUDED.annual_salary,
         burden_rate = EXCLUDED.burden_rate,
         bonus_rate = EXCLUDED.bonus_rate,
         ramp_first_period_pct = EXCLUDED.ramp_first_period_pct,
         merit_period_code = EXCLUDED.merit_period_code,
         merit_increase_pct = EXCLUDED.merit_increase_pct,
         status = EXCLUDED.status,
         updated_at = now()`,
      [
        params.companyId,
        code,
        pos.title.trim(),
        pos.departmentName.trim(),
        accountId,
        pos.startPeriodCode.trim(),
        endPeriodCode,
        serialize(money(pos.fte), STORAGE_SCALE),
        serialize(money(pos.annualSalary), STORAGE_SCALE),
        serialize(money(pos.burdenRate), STORAGE_SCALE),
        serialize(money(pos.bonusRate), STORAGE_SCALE),
        serialize(money(pos.rampFirstPeriodPct), STORAGE_SCALE),
        meritPeriodCode,
        serialize(money(pos.meritIncreasePct), STORAGE_SCALE),
        pos.status,
        params.actorId,
      ],
    );
  }

  await appendAuditLog(tx, {
    companyId: params.companyId,
    actorId: params.actorId,
    action: 'workforce.roster_save',
    targetTable: 'workforce_position',
    targetId: params.companyId,
    oldPayload: null,
    newPayload: {
      fiscalYear,
      positionCount: keepCodes.length,
      positionCodes: keepCodes,
    },
    occurredAt: params.occurredAt,
  });

  return getWorkforceWorkspace(tx, {
    companyId: params.companyId,
    actorId: params.actorId,
    fiscalYear,
  });
}

async function compilePreviewForCompany(
  db: SqlExecutor,
  companyId: string,
  request: {
    readonly fiscalYear: number;
    readonly periods?: readonly string[] | undefined;
    readonly positions?: readonly WorkforcePositionPayload[] | undefined;
  },
): Promise<WorkforcePreviewResponse> {
  const { currency, currencyScale } = await readCompanyCurrency(db, companyId);
  const yearPeriods = await readCompanyPeriods(db, companyId, request.fiscalYear);
  const yearPeriodSet = new Set(yearPeriods);

  const periods =
    request.periods !== undefined && request.periods.length > 0
      ? request.periods.map((p) => p.trim())
      : yearPeriods;

  const periodIssues: string[] = [];
  for (const periodCode of periods) {
    if (!yearPeriodSet.has(periodCode)) {
      periodIssues.push(`UNKNOWN_PERIOD:${periodCode} (fiscal year ${String(request.fiscalYear)})`);
    }
  }
  if (periodIssues.length > 0) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Workforce plan references fiscal periods not found in the company calendar.',
      details: { issues: periodIssues },
    });
  }

  const accounts = await readPostableAccounts(db, companyId);
  const activeAccountCodes = new Set(accounts.map((a) => a.code));

  const positionsToCompile: readonly WorkforcePositionInput[] =
    request.positions !== undefined
      ? request.positions
      : (await readSavedPositions(db, companyId, currencyScale)).map((p) => ({
          positionCode: p.positionCode,
          title: p.title,
          departmentName: p.departmentName,
          accountCode: p.accountCode,
          startPeriodCode: p.startPeriodCode,
          endPeriodCode: p.endPeriodCode,
          fte: p.fte,
          annualSalary: p.annualSalary,
          burdenRate: p.burdenRate,
          bonusRate: p.bonusRate,
          rampFirstPeriodPct: p.rampFirstPeriodPct,
          meritPeriodCode: p.meritPeriodCode,
          meritIncreasePct: p.meritIncreasePct,
          status: p.status,
        }));

  const acctIssues: string[] = [];
  for (const pos of positionsToCompile) {
    const acctCode = pos.accountCode.trim();
    if (acctCode.length > 0 && !activeAccountCodes.has(acctCode)) {
      acctIssues.push(`UNMAPPED_ACCOUNT:${acctCode}`);
    }
  }
  if (acctIssues.length > 0) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Workforce positions reference inactive or unknown GL expense accounts.',
      details: { issues: acctIssues },
    });
  }

  const outcome = compileWorkforceModuleToDrivers({
    periods,
    positions: positionsToCompile,
    currencyScale,
    periodsInYear: yearPeriods.length,
  });

  if (!outcome.ok) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Workforce plan validation failed.',
      details: { issues: [...outcome.issues] },
    });
  }

  return {
    companyId,
    fiscalYear: request.fiscalYear,
    currency,
    currencyScale: outcome.currencyScale,
    periods: [...outcome.periods],
    positionPeriodRows: outcome.positionPeriodRows.map((row) => ({ ...row })),
    positionSummaries: outcome.positionSummaries.map((row) => ({ ...row })),
    departmentSummaries: outcome.departmentSummaries.map((row) => ({ ...row })),
    fteByPeriod: { ...outcome.fteByPeriod },
    costByPeriod: { ...outcome.costByPeriod },
    grandTotalFteMonths: outcome.grandTotalFteMonths,
    grandTotalCost: outcome.grandTotalCost,
    compiledDrivers: outcome.compiledDrivers.map((d) => ({
      ...d,
      ...(d.periodOverrides === undefined ? {} : { periodOverrides: { ...d.periodOverrides } }),
    })),
    driverPlan: {
      fiscalYear: request.fiscalYear,
      currencyScale: outcome.driverPlan.currencyScale,
      periods: [...outcome.driverPlan.periods],
      lines: outcome.driverPlan.lines.map((l) => ({ ...l })),
      totalsByAccount: { ...outcome.driverPlan.totalsByAccount },
      totalsByPeriod: { ...outcome.driverPlan.totalsByPeriod },
      grandTotal: outcome.driverPlan.grandTotal,
    },
  };
}

export async function previewWorkforcePlan(
  db: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly request: WorkforcePreviewRequest;
  },
): Promise<WorkforcePreviewResponse> {
  return compilePreviewForCompany(db, params.companyId, params.request);
}

export async function commitWorkforcePlan(
  tx: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly request: WorkforceCommitRequest;
    readonly occurredAt: string;
  },
): Promise<WorkforceCommitResponse> {
  const actorRole = await getMemberRole(tx, params.companyId, params.actorId);
  if (!canActorCreateTask(actorRole)) {
    throw new AppError('TENANT_FORBIDDEN', {
      userMessage: `Role "${actorRole}" cannot commit Workforce plans; owner or editor access is required.`,
    });
  }

  if (params.request.positions !== undefined && params.request.saveRoster) {
    await saveWorkforcePositions(tx, {
      companyId: params.companyId,
      actorId: params.actorId,
      positions: params.request.positions,
      fiscalYear: params.request.fiscalYear,
      occurredAt: params.occurredAt,
    });
  }

  const preview = await compilePreviewForCompany(tx, params.companyId, {
    fiscalYear: params.request.fiscalYear,
    periods: params.request.periods,
    ...(params.request.positions === undefined ? {} : { positions: params.request.positions }),
  });

  // §2.4 One-Engine Law proof: Workforce commits into the single planning engine (`commitDriverPlan`),
  // storing `plan_line` inside the requested scenario's new immutable `plan_version`.
  const commit = await commitDriverPlan(tx, {
    companyId: params.companyId,
    actorId: params.actorId,
    input: {
      fiscalYear: params.request.fiscalYear,
      scenarioName: params.request.scenarioName,
      scenarioKind: params.request.scenarioKind,
      periods: [...preview.periods],
      drivers: preview.compiledDrivers.map((d) => ({
        ...d,
        ...(d.periodOverrides === undefined ? {} : { periodOverrides: { ...d.periodOverrides } }),
      })),
    },
    occurredAt: params.occurredAt,
  });

  await appendAuditLog(tx, {
    companyId: params.companyId,
    actorId: params.actorId,
    action: 'workforce.plan_commit',
    targetTable: 'plan_version',
    targetId: commit.planVersionId,
    oldPayload: null,
    newPayload: {
      scenarioId: commit.scenarioId,
      scenarioName: commit.scenarioName,
      versionNo: commit.versionNo,
      positionCount: preview.positionSummaries.length,
      grandTotalFteMonths: preview.grandTotalFteMonths,
      grandTotalCost: preview.grandTotalCost,
    },
    occurredAt: params.occurredAt,
  });

  return { preview, commit };
}
