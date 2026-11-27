import {
  addUtcDaysToPeriodDate,
  computeCloseTaskDagState,
  derivePeriodCloseStatus,
  evaluateCloseReconciliation,
  evaluateCloseTaskTransition,
  evaluatePeriodLockTransition,
  validateCloseTaskDag,
  type CloseMembershipRole,
  type CloseOwnerRole,
  type CloseTaskCategory,
  type CloseTaskSnapshot,
  type CloseTaskStatus,
  type CloseTaskTemplateInput,
  type PeriodLockStatus,
} from '../../../core/close/index.js';
import type {
  CloseReconciliationSummary,
  CloseTaskTemplateSummary,
  CloseWorkspaceResponse,
  PeriodCloseOverviewItem,
  PeriodLockEventSummary,
  UpsertCloseTemplatesResponse,
} from '../../../shared/close.js';
import { PeriodDateSchema } from '../../../shared/temporal.js';
import { AppError, type ErrorDetails } from '../../../shared/errors.js';
import { appendAuditLog } from '../../audit/index.js';
import type { SqlExecutor } from '../migrate.js';
import { activeBatchPredicate } from './import.js';
import { getFinancialStatements, getTrialBalance } from './reports.js';

interface PeriodDbRow extends Record<string, unknown> {
  id: string;
  fiscal_year: number;
  period_no: number;
  code: string;
  label: string;
  start_date: string | Date;
  end_date: string | Date;
  lock_status: PeriodLockStatus;
  lock_updated_at: string | Date | null;
}

interface TemplateDbRow extends Record<string, unknown> {
  id: string;
  task_key: string;
  title: string;
  category: CloseTaskCategory;
  owner_role: CloseOwnerRole;
  due_day_offset: number;
  prerequisite_keys: string[] | string;
  requires_reconciliation: boolean;
  sort_order: number;
  active: boolean;
}

interface CycleDbRow extends Record<string, unknown> {
  id: string;
  period_id: string;
  created_at: string | Date;
}

interface TaskDbRow extends Record<string, unknown> {
  id: string;
  cycle_id: string;
  task_key: string;
  title: string;
  category: CloseTaskCategory;
  owner_role: CloseOwnerRole;
  due_date: string | Date;
  prerequisite_keys: string[] | string;
  requires_reconciliation: boolean;
  status: CloseTaskStatus;
  sort_order: number;
  signed_off_by: string | null;
  signed_off_by_email: string | null;
  signed_off_at: string | Date | null;
  signoff_note: string | null;
  version: number;
}

interface LockEventDbRow extends Record<string, unknown> {
  id: string;
  period_id: string;
  period_code: string;
  fiscal_year: number;
  from_status: PeriodLockStatus;
  to_status: PeriodLockStatus;
  action: 'soft_close' | 'hard_close' | 'unlock';
  reason: string;
  actor_id: string;
  actor_email: string;
  audit_entry_id: string;
  created_at: string | Date;
}

function toIsoDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function toIsoTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parsePgTextArray(raw: string[] | string): string[] {
  if (Array.isArray(raw)) return [...raw];
  const trimmed = raw.trim();
  if (trimmed === '{}' || trimmed === '') return [];
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim().replace(/^"(.*)"$/, '$1'))
      .filter((item) => item.length > 0);
  }
  return [trimmed];
}

async function requireActorCloseRole(
  db: SqlExecutor,
  companyId: string,
  actorId: string,
): Promise<CloseMembershipRole> {
  const res = await db.query<{ role: CloseMembershipRole }>(
    `SELECT role FROM membership WHERE company_id = $1 AND user_id = $2`,
    [companyId, actorId],
  );
  const role = res.rows[0]?.role;
  if (role === undefined) {
    throw new AppError('TENANT_FORBIDDEN');
  }
  return role;
}

function mapTaskSnapshot(row: TaskDbRow): CloseTaskSnapshot {
  return {
    id: row.id,
    taskKey: row.task_key,
    title: row.title,
    category: row.category,
    ownerRole: row.owner_role,
    dueDate: toIsoDate(row.due_date),
    prerequisiteKeys: parsePgTextArray(row.prerequisite_keys),
    requiresReconciliation: row.requires_reconciliation,
    status: row.status,
    sortOrder: row.sort_order,
    signedOffBy: row.signed_off_by,
    signedOffAt: row.signed_off_at === null ? null : toIsoTimestamp(row.signed_off_at),
    signoffNote: row.signoff_note,
    version: row.version,
  };
}

function parseIntegerCount(value: string | number | undefined): number {
  if (typeof value === 'number') return value;
  return Number.parseInt(value ?? '0', 10);
}

async function evaluateCompanyPeriodReconciliation(
  db: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly periodId: string;
    readonly periodCode: string;
    readonly fiscalYear: number;
    readonly startDate: string;
    readonly endDate: string;
  },
): Promise<CloseReconciliationSummary> {
  const actualsCountRes = await db.query<{ cnt: string | number }>(
    `SELECT COUNT(*)::int AS cnt
       FROM gl_entry
      WHERE company_id = $1
        AND period_id = $2
        AND ${activeBatchPredicate('gl_entry')}`,
    [params.companyId, params.periodId],
  );
  const hasActualsInPeriod = parseIntegerCount(actualsCountRes.rows[0]?.cnt) > 0;

  const quarRes = await db.query<{ cnt: string | number }>(
    `SELECT COUNT(*)::int AS cnt
       FROM import_row_raw r
       JOIN import_batch b ON b.id = r.batch_id AND b.company_id = r.company_id
      WHERE r.company_id = $1
        AND b.status IN ('staged', 'committed')
        AND r.status = 'quarantined'
        AND (
          (COALESCE(r.parsed_fields->>'postingDate', '') BETWEEN $2 AND $3)
          OR EXISTS (
            SELECT 1 FROM gl_entry ge
             WHERE ge.company_id = r.company_id
               AND ge.batch_id = r.batch_id
               AND ge.period_id = $4
          )
        )`,
    [params.companyId, params.startDate, params.endDate, params.periodId],
  );
  const unmappedOrQuarantinedCount = parseIntegerCount(quarRes.rows[0]?.cnt);

  const tb = await getTrialBalance(db, {
    companyId: params.companyId,
    throughPeriodCode: params.periodCode,
    fiscalYear: params.fiscalYear,
  });

  let statementArticulationValid = true;
  if (hasActualsInPeriod) {
    const stmts = await getFinancialStatements(db, {
      companyId: params.companyId,
      throughPeriodCode: params.periodCode,
      fiscalYear: params.fiscalYear,
    });
    statementArticulationValid = stmts.articulation.valid;
  }

  const evalResult = evaluateCloseReconciliation({
    trialBalanceBalanced: tb.isBalanced,
    unmappedOrQuarantinedCount,
    statementArticulationValid,
    hasActualsInPeriod,
  });

  return {
    passed: evalResult.passed,
    trialBalanceBalanced: tb.isBalanced,
    unmappedOrQuarantinedCount,
    statementArticulationValid,
    hasActualsInPeriod,
    issues: [...evalResult.issues],
  };
}

async function listCompanyTemplates(
  db: SqlExecutor,
  companyId: string,
  includeInactive = false,
): Promise<CloseTaskTemplateSummary[]> {
  const res = await db.query<TemplateDbRow>(
    `SELECT id, task_key, title, category, owner_role, due_day_offset,
            prerequisite_keys, requires_reconciliation, sort_order, active
       FROM close_task_template
      WHERE company_id = $1
        ${includeInactive ? '' : 'AND active = true'}
      ORDER BY sort_order ASC, task_key ASC`,
    [companyId],
  );
  return res.rows.map((row) => ({
    id: row.id,
    taskKey: row.task_key,
    title: row.title,
    category: row.category,
    ownerRole: row.owner_role,
    dueDayOffset: row.due_day_offset,
    prerequisiteKeys: parsePgTextArray(row.prerequisite_keys),
    requiresReconciliation: row.requires_reconciliation,
    sortOrder: row.sort_order,
    active: row.active,
  }));
}

export async function getCloseWorkspace(
  db: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly actorRole?: CloseMembershipRole;
    readonly fiscalYear?: number;
    readonly periodCode?: string;
  },
): Promise<CloseWorkspaceResponse> {
  const actorRole =
    params.actorRole ?? (await requireActorCloseRole(db, params.companyId, params.actorId));
  const periodRes = await db.query<PeriodDbRow>(
    `SELECT id, fiscal_year, period_no, code, label, start_date, end_date, lock_status, lock_updated_at
       FROM fiscal_period
      WHERE company_id = $1
      ORDER BY fiscal_year ASC, period_no ASC`,
    [params.companyId],
  );
  if (periodRes.rows.length === 0) {
    throw new AppError('PERIOD_NOT_FOUND', {
      userMessage: 'This company has no fiscal periods; complete company setup first.',
    });
  }

  const requestedYear = params.fiscalYear ?? periodRes.rows[0]!.fiscal_year;
  const yearPeriods = periodRes.rows.filter((p) => p.fiscal_year === requestedYear);
  const candidatePeriods = yearPeriods.length > 0 ? yearPeriods : periodRes.rows;

  const selectedPeriod =
    params.periodCode !== undefined
      ? candidatePeriods.find((p) => p.code === params.periodCode)
      : candidatePeriods[0];
  if (selectedPeriod === undefined) {
    throw new AppError('PERIOD_NOT_FOUND', {
      userMessage: `Fiscal period ${params.periodCode ?? ''} does not exist for FY${requestedYear}.`,
      details: { fiscalYear: requestedYear, periodCode: params.periodCode ?? '' },
    });
  }

  const cyclesRes = await db.query<CycleDbRow>(
    `SELECT id, period_id, created_at
       FROM close_cycle
      WHERE company_id = $1`,
    [params.companyId],
  );
  const cycleByPeriodId = new Map(cyclesRes.rows.map((c) => [c.period_id, c]));

  const allTasksRes = await db.query<TaskDbRow>(
    `SELECT t.id, t.cycle_id, t.task_key, t.title, t.category, t.owner_role, t.due_date,
            t.prerequisite_keys, t.requires_reconciliation, t.status, t.sort_order,
            t.signed_off_by, u.email AS signed_off_by_email, t.signed_off_at, t.signoff_note, t.version
       FROM close_task t
       LEFT JOIN app_user u ON u.id = t.signed_off_by
      WHERE t.company_id = $1
      ORDER BY t.sort_order ASC, t.task_key ASC`,
    [params.companyId],
  );
  const tasksByCycleId = new Map<string, TaskDbRow[]>();
  for (const row of allTasksRes.rows) {
    const arr = tasksByCycleId.get(row.cycle_id);
    if (arr === undefined) tasksByCycleId.set(row.cycle_id, [row]);
    else arr.push(row);
  }

  const selectedStartDate = toIsoDate(selectedPeriod.start_date);
  const selectedEndDate = toIsoDate(selectedPeriod.end_date);
  const selectedReconciliation = await evaluateCompanyPeriodReconciliation(db, {
    companyId: params.companyId,
    periodId: selectedPeriod.id,
    periodCode: selectedPeriod.code,
    fiscalYear: selectedPeriod.fiscal_year,
    startDate: selectedStartDate,
    endDate: selectedEndDate,
  });

  const periodOverview: PeriodCloseOverviewItem[] = [];
  for (const p of periodRes.rows) {
    const cyc = cycleByPeriodId.get(p.id);
    const pTasks = (cyc === undefined ? [] : (tasksByCycleId.get(cyc.id) ?? [])).map(mapTaskSnapshot);
    const rec =
      p.id === selectedPeriod.id
        ? { passed: selectedReconciliation.passed, issues: selectedReconciliation.issues }
        : { passed: true, issues: [] };
    const summary = derivePeriodCloseStatus({
      tasks: pTasks,
      lockStatus: p.lock_status,
      reconciliation: rec,
    });
    periodOverview.push({
      periodId: p.id,
      fiscalYear: p.fiscal_year,
      periodNo: p.period_no,
      periodCode: p.code,
      label: p.label,
      startDate: PeriodDateSchema.parse(toIsoDate(p.start_date)),
      endDate: PeriodDateSchema.parse(toIsoDate(p.end_date)),
      lockStatus: p.lock_status,
      lockUpdatedAt: p.lock_updated_at === null ? null : toIsoTimestamp(p.lock_updated_at),
      hasCycle: cyc !== undefined,
      derivedStatus: summary.derivedStatus,
      completionPct: summary.completionPct,
      signedOffCount: summary.signedOffCount,
      totalTasks: summary.totalTasks,
    });
  }

  const selectedCycleRow = cycleByPeriodId.get(selectedPeriod.id) ?? null;
  const selectedTaskRows =
    selectedCycleRow === null ? [] : (tasksByCycleId.get(selectedCycleRow.id) ?? []);
  const emailByUserId = new Map<string, string | null>();
  for (const row of selectedTaskRows) {
    if (row.signed_off_by !== null) {
      emailByUserId.set(row.signed_off_by, row.signed_off_by_email);
    }
  }
  const snapshots = selectedTaskRows.map(mapTaskSnapshot);
  const dagTasks = computeCloseTaskDagState(snapshots, {
    passed: selectedReconciliation.passed,
    issues: selectedReconciliation.issues,
  });
  const statusSummary = derivePeriodCloseStatus({
    tasks: snapshots,
    lockStatus: selectedPeriod.lock_status,
    reconciliation: {
      passed: selectedReconciliation.passed,
      issues: selectedReconciliation.issues,
    },
  });

  const lockEventsRes = await db.query<LockEventDbRow>(
    `SELECT e.id, e.period_id, fp.code AS period_code, fp.fiscal_year,
            e.from_status, e.to_status, e.action, e.reason,
            e.actor_id, u.email AS actor_email, e.audit_entry_id, e.created_at
       FROM period_lock_event e
       JOIN fiscal_period fp ON fp.company_id = e.company_id AND fp.id = e.period_id
       JOIN app_user u ON u.id = e.actor_id
      WHERE e.company_id = $1
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT 50`,
    [params.companyId],
  );
  const lockEvents: PeriodLockEventSummary[] = lockEventsRes.rows.map((row) => ({
    id: row.id,
    periodId: row.period_id,
    periodCode: row.period_code,
    fiscalYear: row.fiscal_year,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    action: row.action,
    reason: row.reason,
    actorId: row.actor_id,
    actorEmail: row.actor_email,
    auditEntryId: row.audit_entry_id,
    createdAt: toIsoTimestamp(row.created_at),
  }));

  return {
    companyId: params.companyId,
    actorRole,
    selectedFiscalYear: selectedPeriod.fiscal_year,
    selectedPeriodCode: selectedPeriod.code,
    selectedPeriodId: selectedPeriod.id,
    periods: periodOverview,
    templates: await listCompanyTemplates(db, params.companyId, false),
    cycle:
      selectedCycleRow === null
        ? null
        : {
            id: selectedCycleRow.id,
            periodId: selectedCycleRow.period_id,
            periodCode: selectedPeriod.code,
            fiscalYear: selectedPeriod.fiscal_year,
            createdAt: toIsoTimestamp(selectedCycleRow.created_at),
          },
    statusSummary: {
      ...statusSummary,
      incompleteTaskKeys: [...statusSummary.incompleteTaskKeys],
    },
    reconciliation: selectedReconciliation,
    tasks: dagTasks.map((t) => ({
      ...t,
      dueDate: PeriodDateSchema.parse(t.dueDate),
      prerequisiteKeys: [...t.prerequisiteKeys],
      blockingPrerequisites: [...t.blockingPrerequisites],
      blockingReasons: [...t.blockingReasons],
      signedOffByEmail: t.signedOffBy === null ? null : (emailByUserId.get(t.signedOffBy) ?? null),
    })),
    lockEvents,
  };
}

function toErrorDetails(details: Readonly<Record<string, string | readonly string[]>>): ErrorDetails {
  const out: ErrorDetails = {};
  for (const [k, v] of Object.entries(details)) {
    out[k] = typeof v === 'string' ? v : [...v];
  }
  return out;
}

export async function upsertCloseTemplates(
  tx: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly templates: readonly CloseTaskTemplateInput[];
    readonly occurredAt: string;
  },
): Promise<UpsertCloseTemplatesResponse> {
  const actorRole = await requireActorCloseRole(tx, params.companyId, params.actorId);
  if (actorRole !== 'owner' && actorRole !== 'editor') {
    throw new AppError('TENANT_FORBIDDEN', {
      userMessage: 'Only workspace owners and editors can update close calendar templates.',
    });
  }

  const dag = validateCloseTaskDag(params.templates);
  if (!dag.ok) {
    throw new AppError(dag.errorCode, {
      userMessage: dag.reason,
      details: toErrorDetails(dag.details),
    });
  }

  const activeKeys = dag.ordered.map((t) => t.taskKey);
  await tx.query(
    `UPDATE close_task_template
        SET active = false, updated_at = $2::timestamptz
      WHERE company_id = $1
        AND NOT (task_key = ANY($3::text[]))`,
    [params.companyId, params.occurredAt, activeKeys],
  );

  for (const tpl of dag.ordered) {
    await tx.query(
      `INSERT INTO close_task_template (
         company_id, task_key, title, category, owner_role, due_day_offset,
         prerequisite_keys, requires_reconciliation, sort_order, active, created_by, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8, $9, true, $10, $11::timestamptz)
       ON CONFLICT (company_id, task_key)
       DO UPDATE SET
         title = EXCLUDED.title,
         category = EXCLUDED.category,
         owner_role = EXCLUDED.owner_role,
         due_day_offset = EXCLUDED.due_day_offset,
         prerequisite_keys = EXCLUDED.prerequisite_keys,
         requires_reconciliation = EXCLUDED.requires_reconciliation,
         sort_order = EXCLUDED.sort_order,
         active = true,
         updated_at = EXCLUDED.updated_at`,
      [
        params.companyId,
        tpl.taskKey,
        tpl.title,
        tpl.category,
        tpl.ownerRole,
        tpl.dueDayOffset,
        tpl.prerequisiteKeys,
        tpl.requiresReconciliation,
        tpl.sortOrder,
        params.actorId,
        params.occurredAt,
      ],
    );
  }

  await appendAuditLog(tx, {
    companyId: params.companyId,
    actorId: params.actorId,
    action: 'close.templates_updated',
    targetTable: 'close_task_template',
    targetId: params.companyId,
    oldPayload: null,
    newPayload: {
      taskKeys: activeKeys,
      count: dag.ordered.length,
    },
    occurredAt: params.occurredAt,
  });

  return {
    companyId: params.companyId,
    templates: await listCompanyTemplates(tx, params.companyId, false),
  };
}

export async function initializeCloseCycle(
  tx: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly fiscalYear: number;
    readonly periodCode: string;
    readonly occurredAt: string;
  },
): Promise<CloseWorkspaceResponse> {
  const actorRole = await requireActorCloseRole(tx, params.companyId, params.actorId);
  if (actorRole !== 'owner' && actorRole !== 'editor') {
    throw new AppError('TENANT_FORBIDDEN', {
      userMessage: 'Only workspace owners and editors can initialize a close cycle.',
    });
  }

  const periodRes = await tx.query<PeriodDbRow>(
    `SELECT id, fiscal_year, period_no, code, label, start_date, end_date, lock_status, lock_updated_at
       FROM fiscal_period
      WHERE company_id = $1 AND fiscal_year = $2 AND code = $3`,
    [params.companyId, params.fiscalYear, params.periodCode],
  );
  const period = periodRes.rows[0];
  if (period === undefined) {
    throw new AppError('PERIOD_NOT_FOUND', {
      userMessage: `Fiscal period FY${params.fiscalYear} ${params.periodCode} was not found.`,
    });
  }
  if (period.lock_status === 'hard_closed') {
    throw new AppError('PERIOD_LOCKED', {
      userMessage: `FY${period.fiscal_year} ${period.code} is hard-closed and cannot initialize a new close cycle.`,
    });
  }

  const existingRes = await tx.query<{ id: string }>(
    `SELECT id FROM close_cycle WHERE company_id = $1 AND period_id = $2`,
    [params.companyId, period.id],
  );
  if (existingRes.rows[0] !== undefined) {
    throw new AppError('DUPLICATE_CODE', {
      userMessage: `A close cycle already exists for FY${period.fiscal_year} ${period.code}.`,
    });
  }

  const templates = await listCompanyTemplates(tx, params.companyId, false);
  if (templates.length === 0) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Configure close calendar task templates before initializing a close cycle.',
    });
  }

  const dag = validateCloseTaskDag(templates);
  if (!dag.ok) {
    throw new AppError(dag.errorCode, {
      userMessage: dag.reason,
      details: toErrorDetails(dag.details),
    });
  }

  const cycleRes = await tx.query<{ id: string }>(
    `INSERT INTO close_cycle (company_id, period_id, created_by)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [params.companyId, period.id, params.actorId],
  );
  const cycleId = cycleRes.rows[0]?.id;
  if (cycleId === undefined) {
    throw new AppError('INTERNAL_ERROR', { userMessage: 'Could not create close cycle.' });
  }

  const templateIdByKey = new Map(templates.map((t) => [t.taskKey, t.id]));
  const periodEndDate = toIsoDate(period.end_date);

  for (const tpl of dag.ordered) {
    const dueDate = addUtcDaysToPeriodDate(periodEndDate, tpl.dueDayOffset);
    await tx.query(
      `INSERT INTO close_task (
         company_id, cycle_id, template_id, task_key, title, category, owner_role,
         due_date, prerequisite_keys, requires_reconciliation, status, sort_order
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::text[], $10, 'pending', $11)`,
      [
        params.companyId,
        cycleId,
        templateIdByKey.get(tpl.taskKey) ?? null,
        tpl.taskKey,
        tpl.title,
        tpl.category,
        tpl.ownerRole,
        dueDate,
        tpl.prerequisiteKeys,
        tpl.requiresReconciliation,
        tpl.sortOrder,
      ],
    );
  }

  await appendAuditLog(tx, {
    companyId: params.companyId,
    actorId: params.actorId,
    action: 'close.cycle_initialized',
    targetTable: 'close_cycle',
    targetId: cycleId,
    oldPayload: null,
    newPayload: {
      fiscalYear: period.fiscal_year,
      periodCode: period.code,
      taskCount: dag.ordered.length,
    },
    occurredAt: params.occurredAt,
  });

  return getCloseWorkspace(tx, {
    companyId: params.companyId,
    actorId: params.actorId,
    actorRole,
    fiscalYear: period.fiscal_year,
    periodCode: period.code,
  });
}

export async function transitionCloseTaskRecord(
  tx: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly cycleId: string;
    readonly taskId: string;
    readonly action: 'start' | 'sign_off' | 'reopen';
    readonly expectedVersion: number;
    readonly note?: string | null;
    readonly occurredAt: string;
  },
): Promise<CloseWorkspaceResponse> {
  const actorRole = await requireActorCloseRole(tx, params.companyId, params.actorId);
  const cycleRes = await tx.query<{
    id: string;
    period_id: string;
    fiscal_year: number;
    code: string;
    start_date: string | Date;
    end_date: string | Date;
    lock_status: PeriodLockStatus;
  }>(
    `SELECT c.id, c.period_id, fp.fiscal_year, fp.code, fp.start_date, fp.end_date, fp.lock_status
       FROM close_cycle c
       JOIN fiscal_period fp ON fp.company_id = c.company_id AND fp.id = c.period_id
      WHERE c.company_id = $1 AND c.id = $2`,
    [params.companyId, params.cycleId],
  );
  const cycle = cycleRes.rows[0];
  if (cycle === undefined) {
    throw new AppError('NOT_FOUND', { userMessage: 'Close cycle not found for this company.' });
  }

  const taskRowsRes = await tx.query<TaskDbRow>(
    `SELECT t.id, t.cycle_id, t.task_key, t.title, t.category, t.owner_role, t.due_date,
            t.prerequisite_keys, t.requires_reconciliation, t.status, t.sort_order,
            t.signed_off_by, NULL::text AS signed_off_by_email, t.signed_off_at, t.signoff_note, t.version
       FROM close_task t
      WHERE t.company_id = $1 AND t.cycle_id = $2
      ORDER BY t.sort_order ASC, t.task_key ASC`,
    [params.companyId, params.cycleId],
  );
  const snapshots = taskRowsRes.rows.map(mapTaskSnapshot);
  const target = snapshots.find((t) => t.id === params.taskId);
  if (target === undefined) {
    throw new AppError('NOT_FOUND', { userMessage: 'Close task not found in this cycle.' });
  }

  const reconciliation = await evaluateCompanyPeriodReconciliation(tx, {
    companyId: params.companyId,
    periodId: cycle.period_id,
    periodCode: cycle.code,
    fiscalYear: cycle.fiscal_year,
    startDate: toIsoDate(cycle.start_date),
    endDate: toIsoDate(cycle.end_date),
  });

  const outcome = evaluateCloseTaskTransition({
    tasks: snapshots,
    taskId: params.taskId,
    action: params.action,
    actorRole,
    actorId: params.actorId,
    periodLockStatus: cycle.lock_status,
    reconciliation: { passed: reconciliation.passed, issues: reconciliation.issues },
    expectedVersion: params.expectedVersion,
    note: params.note ?? null,
    occurredAt: params.occurredAt,
  });
  if (!outcome.ok) {
    throw new AppError(outcome.errorCode, { userMessage: outcome.reason });
  }

  const updated = await tx.query<{ id: string }>(
    `UPDATE close_task
        SET status = $3,
            signed_off_by = $4,
            signed_off_at = $5::timestamptz,
            signoff_note = $6,
            version = version + 1,
            updated_at = $7::timestamptz
      WHERE company_id = $1 AND id = $2 AND version = $8
      RETURNING id`,
    [
      params.companyId,
      params.taskId,
      outcome.nextStatus,
      outcome.signedOffBy,
      outcome.signedOffAt,
      outcome.signoffNote,
      params.occurredAt,
      params.expectedVersion,
    ],
  );
  if (updated.rows[0] === undefined) {
    throw new AppError('MODEL_VERSION_LOCKED', {
      userMessage: 'Close task was updated concurrently; refresh and retry.',
    });
  }

  await appendAuditLog(tx, {
    companyId: params.companyId,
    actorId: params.actorId,
    action: outcome.auditAction,
    targetTable: 'close_task',
    targetId: params.taskId,
    oldPayload: {
      taskKey: target.taskKey,
      status: target.status,
      version: target.version,
    },
    newPayload: {
      taskKey: target.taskKey,
      status: outcome.nextStatus,
      version: target.version + 1,
      note: outcome.signoffNote,
    },
    occurredAt: params.occurredAt,
  });

  return getCloseWorkspace(tx, {
    companyId: params.companyId,
    actorId: params.actorId,
    actorRole,
    fiscalYear: cycle.fiscal_year,
    periodCode: cycle.code,
  });
}

export async function transitionPeriodLockRecord(
  tx: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly periodId: string;
    readonly action: 'soft_close' | 'hard_close' | 'unlock';
    readonly reason: string;
    readonly occurredAt: string;
  },
): Promise<CloseWorkspaceResponse> {
  const actorRole = await requireActorCloseRole(tx, params.companyId, params.actorId);
  const periodRes = await tx.query<PeriodDbRow>(
    `SELECT id, fiscal_year, period_no, code, label, start_date, end_date, lock_status, lock_updated_at
       FROM fiscal_period
      WHERE company_id = $1 AND id = $2`,
    [params.companyId, params.periodId],
  );
  const period = periodRes.rows[0];
  if (period === undefined) {
    throw new AppError('PERIOD_NOT_FOUND', { userMessage: 'Fiscal period not found in this company.' });
  }

  const cycleRes = await tx.query<{ id: string }>(
    `SELECT id FROM close_cycle WHERE company_id = $1 AND period_id = $2`,
    [params.companyId, period.id],
  );
  const cycleId = cycleRes.rows[0]?.id ?? null;

  let snapshots: CloseTaskSnapshot[] = [];
  if (cycleId !== null) {
    const taskRes = await tx.query<TaskDbRow>(
      `SELECT t.id, t.cycle_id, t.task_key, t.title, t.category, t.owner_role, t.due_date,
              t.prerequisite_keys, t.requires_reconciliation, t.status, t.sort_order,
              t.signed_off_by, NULL::text AS signed_off_by_email, t.signed_off_at, t.signoff_note, t.version
         FROM close_task t
        WHERE t.company_id = $1 AND t.cycle_id = $2`,
      [params.companyId, cycleId],
    );
    snapshots = taskRes.rows.map(mapTaskSnapshot);
  }

  const reconciliation = await evaluateCompanyPeriodReconciliation(tx, {
    companyId: params.companyId,
    periodId: period.id,
    periodCode: period.code,
    fiscalYear: period.fiscal_year,
    startDate: toIsoDate(period.start_date),
    endDate: toIsoDate(period.end_date),
  });

  const derived = derivePeriodCloseStatus({
    tasks: snapshots,
    lockStatus: period.lock_status,
    reconciliation: { passed: reconciliation.passed, issues: reconciliation.issues },
  });

  const outcome = evaluatePeriodLockTransition({
    currentStatus: period.lock_status,
    action: params.action,
    actorRole,
    reason: params.reason,
    hasCycle: cycleId !== null,
    readyForHardClose: derived.readyForHardClose,
    incompleteTaskKeys: derived.incompleteTaskKeys,
    reconciliationIssues: reconciliation.issues,
  });
  if (!outcome.ok) {
    throw new AppError(outcome.errorCode, { userMessage: outcome.reason });
  }

  await tx.query(
    `UPDATE fiscal_period
        SET lock_status = $3,
            lock_updated_at = $4::timestamptz,
            lock_updated_by = $5
      WHERE company_id = $1 AND id = $2`,
    [params.companyId, period.id, outcome.nextStatus, params.occurredAt, params.actorId],
  );

  const auditEntry = await appendAuditLog(tx, {
    companyId: params.companyId,
    actorId: params.actorId,
    action: outcome.auditAction,
    targetTable: 'fiscal_period',
    targetId: period.id,
    oldPayload: {
      fiscalYear: period.fiscal_year,
      periodCode: period.code,
      lockStatus: period.lock_status,
    },
    newPayload: {
      fiscalYear: period.fiscal_year,
      periodCode: period.code,
      lockStatus: outcome.nextStatus,
      reason: params.reason.trim(),
    },
    occurredAt: params.occurredAt,
  });
  if (auditEntry.id === undefined) {
    throw new AppError('INTERNAL_ERROR', { userMessage: 'Audit entry ID was not returned.' });
  }

  await tx.query(
    `INSERT INTO period_lock_event (
       company_id, period_id, from_status, to_status, action, reason, actor_id, audit_entry_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      params.companyId,
      period.id,
      period.lock_status,
      outcome.nextStatus,
      params.action,
      params.reason.trim(),
      params.actorId,
      auditEntry.id,
    ],
  );

  return getCloseWorkspace(tx, {
    companyId: params.companyId,
    actorId: params.actorId,
    actorRole,
    fiscalYear: period.fiscal_year,
    periodCode: period.code,
  });
}
