import {
  buildRollingForecast,
  compareScenarios,
  computeDriverPlan,
  type DriverDefinition,
  type PeriodAmountFact,
} from '../../../core/planning/index.js';
import { money, scaleForCurrency, serialize, STORAGE_SCALE, sub } from '../../../core/money/index.js';
import { AppError } from '../../../shared/errors.js';
import type {
  DriverPlanCommitRequest,
  DriverPlanCommitResponse,
  DriverPlanPreviewRequest,
  DriverPlanPreviewResponse,
  RollingForecastResponse,
  ScenarioComparisonResponse,
  ScenarioKind,
  ScenarioListResponse,
} from '../../../shared/planning.js';
import { appendAuditLog } from '../../audit/index.js';
import type { SqlExecutor } from '../migrate.js';
import { activeBatchPredicate } from './import.js';

interface CompanyRow extends Record<string, unknown> {
  base_currency: string;
}

interface AccountRow extends Record<string, unknown> {
  id: string;
  code: string;
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
  name: string;
  kind: ScenarioKind;
}

interface ScenarioSummaryRow extends Record<string, unknown> {
  scenario_id: string;
  name: string;
  kind: ScenarioKind;
  version_no: number | null;
  label: string | null;
}

interface PlanVersionRow extends Record<string, unknown> {
  id: string;
  version_no: number;
}

interface PlanFactRow extends Record<string, unknown> {
  account_code: string;
  period_code: string;
  amount: string | number;
}

interface ActualFactRow extends Record<string, unknown> {
  account_code: string;
  normal_side: string;
  period_code: string;
  debit: string | number;
  credit: string | number;
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

export async function listScenarios(
  db: SqlExecutor,
  companyId: string,
): Promise<ScenarioListResponse> {
  await readCompanyCurrency(db, companyId);
  const res = await db.query<ScenarioSummaryRow>(
    `SELECT s.id AS scenario_id,
            s.name,
            s.kind,
            pv.version_no,
            pv.label
       FROM scenario s
  LEFT JOIN plan_version pv
         ON pv.company_id = s.company_id
        AND pv.scenario_id = s.id
        AND pv.is_current = true
      WHERE s.company_id = $1
      ORDER BY s.name ASC`,
    [companyId],
  );
  return {
    companyId,
    scenarios: res.rows.map((r) => ({
      scenarioId: r.scenario_id,
      name: r.name,
      kind: r.kind,
      currentVersionNo: r.version_no,
      currentVersionLabel: r.label,
    })),
  };
}

export async function previewDriverPlan(
  db: SqlExecutor,
  companyId: string,
  input: DriverPlanPreviewRequest,
): Promise<DriverPlanPreviewResponse> {
  const currency = await readCompanyCurrency(db, companyId);
  const scale = scaleForCurrency(currency);

  const outcome = computeDriverPlan({
    periods: input.periods,
    drivers: input.drivers as readonly DriverDefinition[],
    currencyScale: scale,
  });

  if (!outcome.ok) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Driver plan validation failed.',
      details: { issues: [...outcome.issues] },
    });
  }

  return {
    fiscalYear: input.fiscalYear,
    currencyScale: outcome.currencyScale,
    periods: [...outcome.periods],
    lines: outcome.lines.map((l) => ({ ...l })),
    totalsByAccount: { ...outcome.totalsByAccount },
    totalsByPeriod: { ...outcome.totalsByPeriod },
    grandTotal: outcome.grandTotal,
  };
}

export async function commitDriverPlan(
  tx: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly input: DriverPlanCommitRequest;
    readonly occurredAt: string;
  },
): Promise<DriverPlanCommitResponse> {
  const { companyId, actorId, input, occurredAt } = params;
  const currency = await readCompanyCurrency(tx, companyId);
  const scale = scaleForCurrency(currency);

  const outcome = computeDriverPlan({
    periods: input.periods,
    drivers: input.drivers as readonly DriverDefinition[],
    currencyScale: scale,
  });

  if (!outcome.ok) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Driver plan validation failed; nothing was written.',
      details: { issues: [...outcome.issues] },
    });
  }

  // Validate accounts & periods against this company's chart and calendar
  const accountsRes = await tx.query<AccountRow>(
    'SELECT id, code FROM account WHERE company_id = $1 AND active = true',
    [companyId],
  );
  const accountByCode = new Map<string, string>();
  for (const a of accountsRes.rows) {
    accountByCode.set(a.code, a.id);
  }

  const periodsRes = await tx.query<PeriodRow>(
    `SELECT id, code, period_no
       FROM fiscal_period
      WHERE company_id = $1
        AND fiscal_year = $2
        AND is_adjustment = false
      ORDER BY period_no ASC`,
    [companyId, input.fiscalYear],
  );
  const periodByCode = new Map<string, string>();
  for (const p of periodsRes.rows) {
    periodByCode.set(p.code, p.id);
  }

  const refIssues: string[] = [];
  for (const d of input.drivers) {
    if (!accountByCode.has(d.accountCode.trim())) {
      refIssues.push(`UNMAPPED_ACCOUNT:${d.accountCode.trim()}`);
    }
  }
  for (const p of outcome.periods) {
    if (!periodByCode.has(p)) {
      refIssues.push(`UNKNOWN_PERIOD:${p} (fiscal year ${String(input.fiscalYear)})`);
    }
  }
  if (refIssues.length > 0) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Driver plan references unknown accounts or periods; nothing was written.',
      details: { issues: refIssues },
    });
  }

  const entityRes = await tx.query<EntityRow>(
    'SELECT id FROM entity WHERE company_id = $1 ORDER BY code ASC LIMIT 1',
    [companyId],
  );
  const entityId = entityRes.rows[0]?.id;
  if (entityId === undefined) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Company has no entity configured.',
    });
  }

  // Find or create scenario
  const existingScenarioRes = await tx.query<ScenarioRow>(
    'SELECT id, name, kind FROM scenario WHERE company_id = $1 AND name = $2',
    [companyId, input.scenarioName],
  );
  let scenarioId: string;
  const existingScenario = existingScenarioRes.rows[0];
  if (existingScenario !== undefined) {
    if (existingScenario.kind !== input.scenarioKind) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Scenario "${input.scenarioName}" already exists with kind "${existingScenario.kind}".`,
        details: { issues: [`SCENARIO_KIND_CONFLICT:${input.scenarioName}`] },
      });
    }
    scenarioId = existingScenario.id;
  } else {
    const insScenario = await tx.query<{ id: string }>(
      `INSERT INTO scenario (company_id, kind, name, status)
       VALUES ($1, $2, $3, 'draft')
       RETURNING id`,
      [companyId, input.scenarioKind, input.scenarioName],
    );
    scenarioId = insScenario.rows[0]!.id;
  }

  // Bump plan_version atomically
  const maxVerRes = await tx.query<{ max_ver: number | null }>(
    `SELECT MAX(version_no) AS max_ver
       FROM plan_version
      WHERE company_id = $1 AND scenario_id = $2`,
    [companyId, scenarioId],
  );
  const nextVersionNo = Number(maxVerRes.rows[0]?.max_ver ?? 0) + 1;
  const label = `${input.scenarioName} v${String(nextVersionNo)}`;

  await tx.query(
    `UPDATE plan_version
        SET is_current = false
      WHERE company_id = $1 AND scenario_id = $2 AND is_current = true`,
    [companyId, scenarioId],
  );

  const insVer = await tx.query<PlanVersionRow>(
    `INSERT INTO plan_version (company_id, scenario_id, version_no, label, is_current)
     VALUES ($1, $2, $3, $4, true)
     RETURNING id, version_no`,
    [companyId, scenarioId, nextVersionNo, label],
  );
  const planVersionId = insVer.rows[0]!.id;

  for (const line of outcome.lines) {
    const accountId = accountByCode.get(line.accountCode)!;
    const periodId = periodByCode.get(line.periodCode)!;
    const storageAmount = serialize(money(line.amount), STORAGE_SCALE);
    await tx.query(
      `INSERT INTO plan_line
         (company_id, scenario_id, version_id, account_id, period_id, entity_id, department_id, amount)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)`,
      [companyId, scenarioId, planVersionId, accountId, periodId, entityId, storageAmount],
    );
  }

  await appendAuditLog(tx, {
    companyId,
    actorId,
    action: 'planning.driver_commit',
    targetTable: 'plan_version',
    targetId: planVersionId,
    oldPayload: null,
    newPayload: {
      scenarioId,
      scenarioName: input.scenarioName,
      scenarioKind: input.scenarioKind,
      versionNo: nextVersionNo,
      lineCount: outcome.lines.length,
      grandTotal: outcome.grandTotal,
    },
    occurredAt,
  });

  return {
    scenarioId,
    scenarioName: input.scenarioName,
    scenarioKind: input.scenarioKind,
    planVersionId,
    versionNo: nextVersionNo,
    lineCount: outcome.lines.length,
    grandTotal: outcome.grandTotal,
    totalsByAccount: { ...outcome.totalsByAccount },
  };
}

async function loadScenarioFacts(
  db: SqlExecutor,
  companyId: string,
  fiscalYear: number,
  scenarioName: string,
): Promise<{ readonly versionNo: number | null; readonly facts: readonly PeriodAmountFact[] }> {
  const verRes = await db.query<{ id: string; version_no: number }>(
    `SELECT pv.id, pv.version_no
       FROM scenario s
       JOIN plan_version pv
         ON pv.company_id = s.company_id
        AND pv.scenario_id = s.id
        AND pv.is_current = true
      WHERE s.company_id = $1 AND s.name = $2
      LIMIT 1`,
    [companyId, scenarioName],
  );
  const ver = verRes.rows[0];
  if (ver === undefined) {
    return { versionNo: null, facts: [] };
  }

  const linesRes = await db.query<PlanFactRow>(
    `SELECT a.code AS account_code,
            fp.code AS period_code,
            pl.amount
       FROM plan_line pl
       JOIN account a
         ON a.company_id = pl.company_id AND a.id = pl.account_id
       JOIN fiscal_period fp
         ON fp.company_id = pl.company_id AND fp.id = pl.period_id
      WHERE pl.company_id = $1
        AND pl.version_id = $2
        AND fp.fiscal_year = $3
        AND fp.is_adjustment = false`,
    [companyId, ver.id, fiscalYear],
  );

  return {
    versionNo: ver.version_no,
    facts: linesRes.rows.map((r) => ({
      accountCode: r.account_code,
      periodCode: r.period_code,
      amount: String(r.amount),
    })),
  };
}

export async function getRollingForecast(
  db: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly fiscalYear: number;
    readonly cutoffPeriod: string | null;
    readonly scenarioName: string;
  },
): Promise<RollingForecastResponse> {
  const currency = await readCompanyCurrency(db, params.companyId);
  const scale = scaleForCurrency(currency);

  const periodsRes = await db.query<PeriodRow>(
    `SELECT id, code, period_no
       FROM fiscal_period
      WHERE company_id = $1
        AND fiscal_year = $2
        AND is_adjustment = false
      ORDER BY period_no ASC`,
    [params.companyId, params.fiscalYear],
  );
  const periods = periodsRes.rows.map((p) => p.code);
  if (periods.length === 0) {
    throw new AppError('PERIOD_NOT_FOUND', {
      userMessage: `No fiscal periods found for year ${String(params.fiscalYear)}.`,
    });
  }

  const actualsRes = await db.query<ActualFactRow>(
    `SELECT a.code AS account_code,
            a.normal_side,
            fp.code AS period_code,
            gl.debit,
            gl.credit
       FROM gl_line gl
       JOIN gl_entry ge
         ON ge.company_id = gl.company_id AND ge.id = gl.entry_id
       JOIN account a
         ON a.company_id = gl.company_id AND a.id = gl.account_id
       JOIN fiscal_period fp
         ON fp.company_id = ge.company_id AND fp.id = ge.period_id
      WHERE gl.company_id = $1
        AND fp.fiscal_year = $2
        AND fp.is_adjustment = false
        AND ${activeBatchPredicate('ge')}`,
    [params.companyId, params.fiscalYear],
  );

  const actualFacts: PeriodAmountFact[] = actualsRes.rows.map((r) => {
    const d = money(String(r.debit));
    const c = money(String(r.credit));
    const natural = r.normal_side === 'debit' ? sub(d, c) : sub(c, d);
    return {
      accountCode: r.account_code,
      periodCode: r.period_code,
      amount: serialize(natural, STORAGE_SCALE),
    };
  });

  const { versionNo, facts: forecastFacts } = await loadScenarioFacts(
    db,
    params.companyId,
    params.fiscalYear,
    params.scenarioName,
  );

  const outcome = buildRollingForecast({
    periods,
    cutoffPeriod: params.cutoffPeriod,
    actuals: actualFacts,
    forecast: forecastFacts,
    currencyScale: scale,
  });

  if (!outcome.ok) {
    throw new AppError('PERIOD_NOT_FOUND', {
      userMessage: 'Invalid cutoff period for rolling forecast.',
      details: { issues: [...outcome.issues] },
    });
  }

  return {
    companyId: params.companyId,
    fiscalYear: params.fiscalYear,
    scenarioName: params.scenarioName,
    planVersionNo: versionNo,
    cutoffPeriod: outcome.cutoffPeriod,
    periods: [...outcome.periods],
    actualPeriods: [...outcome.actualPeriods],
    forecastPeriods: [...outcome.forecastPeriods],
    rows: outcome.rows.map((r) => ({
      accountCode: r.accountCode,
      cells: r.cells.map((c) => ({ ...c })),
      actualSubtotal: r.actualSubtotal,
      forecastSubtotal: r.forecastSubtotal,
      fullHorizonTotal: r.fullHorizonTotal,
      missingCellCount: r.missingCellCount,
    })),
    totalActual: outcome.totalActual,
    totalForecast: outcome.totalForecast,
    totalFullHorizon: outcome.totalFullHorizon,
    totalMissingCells: outcome.totalMissingCells,
  };
}

export async function getScenarioComparison(
  db: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly fiscalYear: number;
    readonly baseScenarioName: string;
    readonly targetScenarioName: string;
  },
): Promise<ScenarioComparisonResponse> {
  const currency = await readCompanyCurrency(db, params.companyId);
  const scale = scaleForCurrency(currency);

  const baseLoaded = await loadScenarioFacts(
    db,
    params.companyId,
    params.fiscalYear,
    params.baseScenarioName,
  );
  const targetLoaded = await loadScenarioFacts(
    db,
    params.companyId,
    params.fiscalYear,
    params.targetScenarioName,
  );

  const report = compareScenarios({
    baseScenarioName: params.baseScenarioName,
    targetScenarioName: params.targetScenarioName,
    baseLines: baseLoaded.facts,
    targetLines: targetLoaded.facts,
    currencyScale: scale,
  });

  return {
    companyId: params.companyId,
    fiscalYear: params.fiscalYear,
    baseScenarioName: report.baseScenarioName,
    targetScenarioName: report.targetScenarioName,
    rows: report.rows.map((r) => ({ ...r })),
    totalBase: report.totalBase,
    totalTarget: report.totalTarget,
    totalDelta: report.totalDelta,
  };
}
