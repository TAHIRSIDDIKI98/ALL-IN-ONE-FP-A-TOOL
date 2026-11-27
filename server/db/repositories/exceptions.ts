import {
  buildRectificationCsv,
  evaluateExceptionRules,
  evaluateExceptionTransition,
  EXCEPTION_RULES_CATALOG,
  type ExceptionBvaFact,
  type ExceptionGlLineFact,
  type ExceptionQuarantinedFact,
  type ExceptionSeverity,
  type ExceptionSoftCloseWriteFact,
  type ExceptionStatus,
  type RectificationSuggestion,
} from '../../../core/exceptions/index.js';
import { AppError } from '../../../shared/errors.js';
import type {
  ExceptionFindingSummary,
  ExceptionScanRequest,
  ExceptionScanSummarySchema,
  ExceptionTransitionRequest,
  ExceptionWorkspaceResponse,
  RectificationJournalSummarySchema,
  RectifyExceptionRequest,
} from '../../../shared/exceptions.js';
import type { PeriodWriteAdvisory } from '../../../shared/import.js';
import { PeriodDateSchema, UtcInstantSchema, type UtcInstant } from '../../../shared/temporal.js';
import { appendAuditLog } from '../../audit/index.js';
import type { DatabaseHandle } from '../client.js';
import type { SqlExecutor } from '../migrate.js';
import { getBvaReport } from './bva.js';
import { activeBatchPredicate, commitImport } from './import.js';
import type { z } from 'zod';

type ActorRole = 'owner' | 'editor' | 'reviewer' | 'viewer';

interface MembershipRow extends Record<string, unknown> {
  user_id: string;
  email: string;
  display_name: string;
  role: ActorRole;
}

interface CompanyRow extends Record<string, unknown> {
  base_currency: string;
}

interface EntityRow extends Record<string, unknown> {
  code: string;
}

interface PeriodRow extends Record<string, unknown> {
  id: string;
  fiscal_year: number;
  period_no: number;
  code: string;
  label: string;
  start_date: string | Date;
  end_date: string | Date;
  is_adjustment: boolean;
  lock_status: 'open' | 'soft_closed' | 'hard_closed';
}

interface FindingRow extends Record<string, unknown> {
  id: string;
  finding_key: string;
  finding_id_hash: string;
  rule_id: string;
  title: string;
  severity: ExceptionSeverity;
  status: ExceptionStatus;
  period_id: string;
  account_code: string | null;
  statement_line_key: string | null;
  grain_key: string;
  amount: string;
  owner_user_id: string | null;
  due_date: string | Date;
  explanation_note: string | null;
  waiver_reason: string | null;
  waiver_expires_at: string | Date | null;
  evidence_json: Record<string, unknown>;
  suggestion_json: RectificationSuggestion;
  version: number;
  detected_at: string | Date;
  updated_at: string | Date;
}

interface RectificationRow extends Record<string, unknown> {
  id: string;
  finding_id: string;
  target_period_id: string;
  mode: 'post_reversal' | 'export_csv' | 'dismiss';
  suggestion_kind: RectificationSuggestion['kind'];
  basis: string;
  erp_hint: string;
  lines_json: RectificationSuggestion['lines'];
  total_debit: string;
  total_credit: string;
  posted_batch_id: string | null;
  csv_payload: string | null;
  note: string | null;
  created_by: string;
  created_at: string | Date;
}

interface EventRow extends Record<string, unknown> {
  id: string;
  finding_id: string;
  from_status: ExceptionStatus | null;
  to_status: ExceptionStatus;
  action:
    | 'detected'
    | 'reopened'
    | 'assign'
    | 'acknowledge'
    | 'explain'
    | 'correct'
    | 'verify'
    | 'close'
    | 'waive';
  note: string | null;
  actor_id: string;
  created_at: string | Date;
}

function toIsoDate(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toUtcInstant(value: string | Date): UtcInstant {
  const iso = value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
  return UtcInstantSchema.parse(iso);
}

async function requireActorRole(
  db: SqlExecutor,
  companyId: string,
  actorId: string,
): Promise<ActorRole> {
  const res = await db.query<{ role: ActorRole }>(
    `SELECT role FROM membership WHERE company_id = $1 AND user_id = $2`,
    [companyId, actorId],
  );
  const role = res.rows[0]?.role;
  if (role === undefined) {
    throw new AppError('TENANT_FORBIDDEN', {
      userMessage: 'You do not have access to this company workspace.',
    });
  }
  return role;
}

async function loadPeriods(db: SqlExecutor, companyId: string): Promise<PeriodRow[]> {
  const res = await db.query<PeriodRow>(
    `SELECT id, fiscal_year, period_no, code, label, start_date, end_date, is_adjustment, lock_status
       FROM fiscal_period
      WHERE company_id = $1
      ORDER BY fiscal_year ASC, period_no ASC`,
    [companyId],
  );
  if (res.rows.length === 0) {
    throw new AppError('PERIOD_NOT_FOUND', {
      userMessage: 'No fiscal periods exist for this company yet.',
    });
  }
  return res.rows;
}

function selectPeriodRow(
  periods: readonly PeriodRow[],
  fiscalYear?: number,
  periodCode?: string,
): PeriodRow {
  const regular = periods.filter((p) => !p.is_adjustment);
  const pool = regular.length > 0 ? regular : periods;
  if (periodCode !== undefined) {
    const matches = periods.filter(
      (p) => p.code === periodCode && (fiscalYear === undefined || p.fiscal_year === fiscalYear),
    );
    if (matches.length === 0) {
      throw new AppError('PERIOD_NOT_FOUND', {
        userMessage: `Period ${periodCode} does not exist in this company calendar.`,
        details: { periodCode, fiscalYear: fiscalYear ?? null },
      });
    }
    if (matches.length > 1) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Period code ${periodCode} exists across multiple fiscal years; specify year.`,
        details: { periodCode },
      });
    }
    return matches[0]!;
  }
  if (fiscalYear !== undefined) {
    const byYear = pool.filter((p) => p.fiscal_year === fiscalYear);
    if (byYear.length === 0) {
      throw new AppError('PERIOD_NOT_FOUND', {
        userMessage: `Fiscal year ${fiscalYear} has no periods.`,
        details: { fiscalYear },
      });
    }
    return byYear.find((p) => p.lock_status === 'open') ?? byYear[0]!;
  }
  return pool.find((p) => p.lock_status === 'open') ?? pool[0]!;
}

function findOpenTargetPeriod(periods: readonly PeriodRow[], selected: PeriodRow): PeriodRow {
  const openAfterOrSame = periods.find(
    (p) =>
      !p.is_adjustment &&
      p.lock_status === 'open' &&
      (p.fiscal_year > selected.fiscal_year ||
        (p.fiscal_year === selected.fiscal_year && p.period_no >= selected.period_no)),
  );
  if (openAfterOrSame !== undefined) return openAfterOrSame;
  const anyOpen = periods.find((p) => !p.is_adjustment && p.lock_status === 'open');
  return anyOpen ?? selected;
}

async function buildWorkspacePayload(
  db: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly actorRole: ActorRole;
    readonly selectedPeriod: PeriodRow;
    readonly periods: readonly PeriodRow[];
    readonly lastScan?: z.infer<typeof ExceptionScanSummarySchema> | null;
    readonly periodAdvisories?: readonly PeriodWriteAdvisory[];
  },
): Promise<ExceptionWorkspaceResponse> {
  const membersRes = await db.query<MembershipRow>(
    `SELECT m.user_id, u.email, u.display_name, m.role
       FROM membership m
       JOIN app_user u ON u.id = m.user_id
      WHERE m.company_id = $1
      ORDER BY u.display_name ASC, u.email ASC`,
    [params.companyId],
  );
  const memberById = new Map(membersRes.rows.map((m) => [m.user_id, m]));
  const periodById = new Map(params.periods.map((p) => [p.id, p]));

  const findingsRes = await db.query<FindingRow>(
    `SELECT id, finding_key, finding_id_hash, rule_id, title, severity, status,
            period_id, account_code, statement_line_key, grain_key, amount::text AS amount,
            owner_user_id, due_date, explanation_note, waiver_reason, waiver_expires_at,
            evidence_json, suggestion_json, version, detected_at, updated_at
       FROM exception_finding
      WHERE company_id = $1 AND period_id = $2
      ORDER BY
        CASE severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC,
        detected_at DESC,
        finding_key ASC`,
    [params.companyId, params.selectedPeriod.id],
  );

  const rectRes = await db.query<RectificationRow>(
    `SELECT id, finding_id, target_period_id, mode, suggestion_kind, basis, erp_hint,
            lines_json, total_debit::text AS total_debit, total_credit::text AS total_credit,
            posted_batch_id, csv_payload, note, created_by, created_at
       FROM rectification_journal
      WHERE company_id = $1`,
    [params.companyId],
  );
  const rectByFindingId = new Map<string, z.infer<typeof RectificationJournalSummarySchema>>();
  for (const r of rectRes.rows) {
    const targetPeriod = periodById.get(r.target_period_id);
    const creator = memberById.get(r.created_by);
    rectByFindingId.set(r.finding_id, {
      id: r.id,
      findingId: r.finding_id,
      targetPeriodId: r.target_period_id,
      targetPeriodCode: targetPeriod?.code ?? params.selectedPeriod.code,
      mode: r.mode,
      suggestionKind: r.suggestion_kind,
      basis: r.basis,
      erpHint: r.erp_hint,
      lines: Array.isArray(r.lines_json) ? r.lines_json : [],
      totalDebit: r.total_debit,
      totalCredit: r.total_credit,
      postedBatchId: r.posted_batch_id,
      csvPayload: r.csv_payload,
      note: r.note,
      createdByEmail: creator?.email ?? null,
      createdAt: toUtcInstant(r.created_at),
    });
  }

  const eventsRes = await db.query<EventRow>(
    `SELECT e.id, e.finding_id, e.from_status, e.to_status, e.action, e.note, e.actor_id, e.created_at
       FROM exception_finding_event e
       JOIN exception_finding f ON f.id = e.finding_id AND f.company_id = e.company_id
      WHERE e.company_id = $1 AND f.period_id = $2
      ORDER BY e.created_at DESC
      LIMIT 40`,
    [params.companyId, params.selectedPeriod.id],
  );

  const findings: ExceptionFindingSummary[] = findingsRes.rows.map((row) => {
    const owner = row.owner_user_id === null ? undefined : memberById.get(row.owner_user_id);
    return {
      id: row.id,
      findingKey: row.finding_key,
      findingIdHash: row.finding_id_hash,
      ruleId: row.rule_id,
      title: row.title,
      severity: row.severity,
      status: row.status,
      periodId: row.period_id,
      periodCode: params.selectedPeriod.code,
      accountCode: row.account_code,
      statementLineKey: row.statement_line_key,
      grainKey: row.grain_key,
      amount: row.amount,
      ownerUserId: row.owner_user_id,
      ownerDisplayName: owner?.display_name ?? null,
      dueDate: PeriodDateSchema.parse(toIsoDate(row.due_date)),
      explanationNote: row.explanation_note,
      waiverReason: row.waiver_reason,
      waiverExpiresAt: row.waiver_expires_at === null ? null : toUtcInstant(row.waiver_expires_at),
      evidence: row.evidence_json ?? {},
      suggestion: {
        ...row.suggestion_json,
        lines: [...(row.suggestion_json?.lines ?? [])],
      },
      rectification: rectByFindingId.get(row.id) ?? null,
      version: row.version,
      detectedAt: toUtcInstant(row.detected_at),
      updatedAt: toUtcInstant(row.updated_at),
    };
  });

  const openStatuses = new Set<ExceptionStatus>(['new', 'acknowledged', 'explained', 'corrected']);
  const metrics = {
    totalFindings: findings.length,
    openCount: findings.filter((f) => openStatuses.has(f.status)).length,
    highSeverityOpenCount: findings.filter(
      (f) => openStatuses.has(f.status) && f.severity === 'high',
    ).length,
    unassignedOpenCount: findings.filter(
      (f) => openStatuses.has(f.status) && f.ownerUserId === null,
    ).length,
    correctedPendingVerifyCount: findings.filter((f) => f.status === 'corrected').length,
    waivedCount: findings.filter((f) => f.status === 'waived').length,
    closedOrVerifiedCount: findings.filter(
      (f) => f.status === 'verified' || f.status === 'closed',
    ).length,
  };

  return {
    companyId: params.companyId,
    actorRole: params.actorRole,
    selectedFiscalYear: params.selectedPeriod.fiscal_year,
    selectedPeriodCode: params.selectedPeriod.code,
    selectedPeriodId: params.selectedPeriod.id,
    periods: params.periods.map((p) => ({
      periodId: p.id,
      fiscalYear: p.fiscal_year,
      periodNo: p.period_no,
      periodCode: p.code,
      label: p.label,
      lockStatus: p.lock_status,
    })),
    members: membersRes.rows.map((m) => ({
      userId: m.user_id,
      email: m.email,
      displayName: m.display_name,
      role: m.role,
    })),
    catalog: EXCEPTION_RULES_CATALOG.map((r) => ({ ...r })),
    metrics,
    lastScan: params.lastScan ?? null,
    findings,
    recentEvents: eventsRes.rows.map((e) => ({
      id: e.id,
      fromStatus: e.from_status,
      toStatus: e.to_status,
      action: e.action,
      note: e.note,
      actorEmail: memberById.get(e.actor_id)?.email ?? null,
      createdAt: toUtcInstant(e.created_at),
    })),
    ...(params.periodAdvisories && params.periodAdvisories.length > 0
      ? { periodAdvisories: [...params.periodAdvisories] }
      : {}),
  };
}

export async function getExceptionsWorkspace(
  db: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly fiscalYear?: number;
    readonly periodCode?: string;
  },
): Promise<ExceptionWorkspaceResponse> {
  const actorRole = await requireActorRole(db, params.companyId, params.actorId);
  const periods = await loadPeriods(db, params.companyId);
  const selectedPeriod = selectPeriodRow(periods, params.fiscalYear, params.periodCode);
  return buildWorkspacePayload(db, {
    companyId: params.companyId,
    actorRole,
    selectedPeriod,
    periods,
  });
}

export async function scanCompanyExceptions(
  db: DatabaseHandle,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly occurredAt: string;
    readonly input: ExceptionScanRequest;
  },
): Promise<ExceptionWorkspaceResponse> {
  const actorRole = await requireActorRole(db, params.companyId, params.actorId);
  if (actorRole === 'viewer') {
    throw new AppError('TENANT_FORBIDDEN', {
      userMessage: 'Viewers cannot run exception scans.',
    });
  }

  const companyRes = await db.query<CompanyRow>(
    `SELECT base_currency FROM company WHERE id = $1`,
    [params.companyId],
  );
  const currency = companyRes.rows[0]?.base_currency;
  if (currency === undefined) {
    throw new AppError('NOT_FOUND', { userMessage: 'Company not found.' });
  }

  const entityRes = await db.query<EntityRow>(
    `SELECT code FROM entity WHERE company_id = $1 AND active = true ORDER BY code ASC LIMIT 1`,
    [params.companyId],
  );
  const entityCode = entityRes.rows[0]?.code ?? 'HQ-1';

  const periods = await loadPeriods(db, params.companyId);
  const selectedPeriod = selectPeriodRow(
    periods,
    params.input.fiscalYear,
    params.input.periodCode,
  );
  const openTargetPeriod = findOpenTargetPeriod(periods, selectedPeriod);

  const glRes = await db.query<{
    line_id: string;
    entry_id: string;
    batch_id: string;
    batch_imported_at: string | Date;
    entity_code: string;
    period_id: string;
    period_code: string;
    fiscal_year: number;
    period_no: number;
    entry_date: string | Date;
    source_ref: string | null;
    account_code: string;
    account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
    normal_side: 'debit' | 'credit';
    is_contra: boolean;
    statement_line_key: string;
    debit: string;
    credit: string;
    description: string | null;
  }>(
    `SELECT gl.id AS line_id, ge.id AS entry_id, ge.batch_id, b.imported_at AS batch_imported_at,
            e.code AS entity_code, fp.id AS period_id, fp.code AS period_code,
            fp.fiscal_year, fp.period_no, ge.entry_date, ge.source_ref,
            a.code AS account_code, a.type AS account_type, a.normal_side, a.is_contra,
            a.statement_line_key, gl.debit::text AS debit, gl.credit::text AS credit,
            raw.parsed_fields->>'description' AS description
       FROM gl_line gl
       JOIN gl_entry ge ON ge.id = gl.entry_id AND ge.company_id = gl.company_id
       JOIN import_batch b ON b.id = ge.batch_id AND b.company_id = ge.company_id
       JOIN import_row_raw raw ON raw.id = gl.source_row_id AND raw.company_id = gl.company_id
       JOIN account a ON a.id = gl.account_id AND a.company_id = gl.company_id
       JOIN fiscal_period fp ON fp.id = gl.period_id AND fp.company_id = gl.company_id
       JOIN entity e ON e.id = gl.entity_id AND e.company_id = gl.company_id
      WHERE gl.company_id = $1
        AND ${activeBatchPredicate('ge')}
      ORDER BY fp.fiscal_year ASC, fp.period_no ASC, ge.entry_date ASC, gl.id ASC`,
    [params.companyId],
  );

  const glLines: ExceptionGlLineFact[] = glRes.rows.map((r) => ({
    lineId: r.line_id,
    entryId: r.entry_id,
    batchId: r.batch_id,
    batchImportedAt: toUtcInstant(r.batch_imported_at),
    entityCode: r.entity_code,
    periodId: r.period_id,
    periodCode: r.period_code,
    fiscalYear: r.fiscal_year,
    periodNo: r.period_no,
    entryDate: toIsoDate(r.entry_date),
    sourceRef: r.source_ref ?? '',
    accountCode: r.account_code,
    accountType: r.account_type,
    normalSide: r.normal_side,
    isContra: r.is_contra,
    statementLineKey: r.statement_line_key,
    debit: r.debit,
    credit: r.credit,
    description: r.description ?? '',
  }));

  const quarRes = await db.query<{
    row_no: number;
    batch_id: string;
    quarantine_reason: string;
    parsed_fields: Record<string, unknown> | null;
  }>(
    `SELECT r.row_no, r.batch_id, r.quarantine_reason, r.parsed_fields
       FROM import_row_raw r
       JOIN import_batch b ON b.id = r.batch_id AND b.company_id = r.company_id
      WHERE r.company_id = $1
        AND b.status IN ('staged', 'committed')
        AND r.status = 'quarantined'`,
    [params.companyId],
  );
  const startIso = toIsoDate(selectedPeriod.start_date);
  const endIso = toIsoDate(selectedPeriod.end_date);
  const quarantinedRows: ExceptionQuarantinedFact[] = [];
  for (const q of quarRes.rows) {
    const pf = q.parsed_fields ?? {};
    const postingDate = typeof pf['postingDate'] === 'string' ? pf['postingDate'] : null;
    if (postingDate !== null && (postingDate < startIso || postingDate > endIso)) continue;
    quarantinedRows.push({
      rowNo: q.row_no,
      batchId: q.batch_id,
      periodCode: selectedPeriod.code,
      entityCode,
      sourceRef: typeof pf['entryRef'] === 'string' ? pf['entryRef'] : null,
      accountCode: typeof pf['accountCode'] === 'string' ? pf['accountCode'] : null,
      reason: q.quarantine_reason,
      debit: typeof pf['debit'] === 'string' ? pf['debit'] : null,
      credit: typeof pf['credit'] === 'string' ? pf['credit'] : null,
    });
  }

  let bvaRows: ExceptionBvaFact[] = [];
  const statementLineByAccount = new Map(
    glLines.map((l) => [l.accountCode, l.statementLineKey] as const),
  );
  try {
    const bva = await getBvaReport(db, {
      companyId: params.companyId,
      throughPeriodCode: selectedPeriod.code,
      fiscalYear: selectedPeriod.fiscal_year,
    });
    if (bva.hasPlan) {
      for (const row of bva.rows) {
        if (row.actual === null || row.plan === null || row.varianceAmount === null) continue;
        const pctClean =
          row.variancePctKind === 'computed' && row.variancePctFormatted !== null
            ? row.variancePctFormatted.replace(/%$/, '').replace(/^\+/, '')
            : null;
        bvaRows.push({
          accountCode: row.accountCode,
          accountType: row.accountType,
          statementLineKey: statementLineByAccount.get(row.accountCode) ?? `unknown.${row.accountType}`,
          actual: row.actual,
          plan: row.plan,
          variance: row.varianceAmount,
          variancePct: pctClean,
        });
      }
    }
  } catch {
    bvaRows = [];
  }

  // Detect postings committed into the selected period after a soft_close event
  const softWritesRes = await db.query<{
    batch_id: string;
    source_ref: string | null;
    amount: string;
    account_code: string;
    imported_at: string | Date;
  }>(
    `SELECT DISTINCT ge.batch_id, ge.source_ref, gl.debit::text AS amount, a.code AS account_code, b.imported_at
       FROM gl_entry ge
       JOIN import_batch b ON b.id = ge.batch_id AND b.company_id = ge.company_id
       JOIN gl_line gl ON gl.entry_id = ge.id AND gl.company_id = ge.company_id AND gl.debit > 0
       JOIN account a ON a.id = gl.account_id AND a.company_id = gl.company_id
       JOIN period_lock_event ple ON ple.company_id = ge.company_id AND ple.period_id = ge.period_id
      WHERE ge.company_id = $1
        AND ge.period_id = $2
        AND ${activeBatchPredicate('ge')}
        AND ple.action = 'soft_close'
        AND b.imported_at >= ple.created_at`,
    [params.companyId, selectedPeriod.id],
  );
  const softCloseWrites: ExceptionSoftCloseWriteFact[] = softWritesRes.rows.map((w) => ({
    batchId: w.batch_id,
    periodCode: selectedPeriod.code,
    entityCode,
    sourceRef: w.source_ref ?? w.batch_id.slice(0, 8),
    amount: w.amount,
    accountCode: w.account_code,
    occurredAt: toUtcInstant(w.imported_at),
  }));

  const evaluation = evaluateExceptionRules({
    companyId: params.companyId,
    currency,
    entityCode,
    periodId: selectedPeriod.id,
    periodCode: selectedPeriod.code,
    periodEndDate: endIso,
    fiscalYear: selectedPeriod.fiscal_year,
    periodNo: selectedPeriod.period_no,
    openTargetPeriodId: openTargetPeriod.id,
    openTargetPeriodCode: openTargetPeriod.code,
    openTargetPeriodStartDate: toIsoDate(openTargetPeriod.start_date),
    glLines,
    quarantinedRows,
    bvaRows,
    softCloseWrites,
  });

  const counts = await db.transaction(async (tx) => {
    const existingRes = await tx.query<{
      id: string;
      finding_key: string;
      status: ExceptionStatus;
      waiver_expires_at: string | Date | null;
      version: number;
    }>(
      `SELECT id, finding_key, status, waiver_expires_at, version
         FROM exception_finding
        WHERE company_id = $1 AND period_id = $2`,
      [params.companyId, selectedPeriod.id],
    );
    const existingByKey = new Map(existingRes.rows.map((r) => [r.finding_key, r]));

    let newFindingsCount = 0;
    let existingFindingsCount = 0;
    let resurfacedWaiversCount = 0;

    // Resurface expired waivers first
    for (const row of existingRes.rows) {
      if (
        row.status === 'waived' &&
        row.waiver_expires_at !== null &&
        new Date(String(row.waiver_expires_at)).getTime() <= new Date(params.occurredAt).getTime()
      ) {
        const auditRecord = await appendAuditLog(tx, {
          companyId: params.companyId,
          actorId: params.actorId,
          action: 'exception.waiver_expired',
          targetTable: 'exception_finding',
          targetId: row.id,
          oldPayload: { status: 'waived' },
          newPayload: { status: 'new', resurfacedAt: params.occurredAt },
          occurredAt: params.occurredAt,
        });
        await tx.query(
          `UPDATE exception_finding
              SET status = 'new', version = version + 1, updated_at = $1, updated_by = $2
            WHERE company_id = $3 AND id = $4`,
          [params.occurredAt, params.actorId, params.companyId, row.id],
        );
        await tx.query(
          `INSERT INTO exception_finding_event (
             company_id, finding_id, from_status, to_status, action, note, actor_id, audit_entry_id
           ) VALUES ($1, $2, 'waived', 'new', 'reopened', 'Waiver expired and finding resurfaced.', $3, $4)`,
          [params.companyId, row.id, params.actorId, auditRecord.id],
        );
        resurfacedWaiversCount += 1;
      }
    }

    for (const finding of evaluation.findings) {
      const existing = existingByKey.get(finding.findingKey);
      if (existing !== undefined) {
        existingFindingsCount += 1;
        continue;
      }
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO exception_finding (
           company_id, finding_key, finding_id_hash, rule_id, title, severity, status,
           period_id, account_code, statement_line_key, grain_key, amount,
           due_date, evidence_json, suggestion_json, detected_at, updated_at, updated_by
         ) VALUES (
           $1, $2, $3, $4, $5, $6, 'new',
           $7, $8, $9, $10, $11,
           $12, $13::jsonb, $14::jsonb, $15, $15, $16
         )
         RETURNING id`,
        [
          params.companyId,
          finding.findingKey,
          finding.findingIdHash,
          finding.ruleId,
          finding.title,
          finding.severity,
          finding.periodId,
          finding.accountCode,
          finding.statementLineKey,
          finding.grainKey,
          finding.amount,
          finding.dueDate,
          JSON.stringify(finding.evidence),
          JSON.stringify(finding.suggestion),
          params.occurredAt,
          params.actorId,
        ],
      );
      const findingId = inserted.rows[0]!.id;
      const auditRecord = await appendAuditLog(tx, {
        companyId: params.companyId,
        actorId: params.actorId,
        action: 'exception.detected',
        targetTable: 'exception_finding',
        targetId: findingId,
        oldPayload: null,
        newPayload: {
          findingKey: finding.findingKey,
          ruleId: finding.ruleId,
          severity: finding.severity,
          amount: finding.amount,
        },
        occurredAt: params.occurredAt,
      });
      await tx.query(
        `INSERT INTO exception_finding_event (
           company_id, finding_id, from_status, to_status, action, note, actor_id, audit_entry_id
         ) VALUES ($1, $2, NULL, 'new', 'detected', $3, $4, $5)`,
        [params.companyId, findingId, finding.suggestion.basis, params.actorId, auditRecord.id],
      );
      newFindingsCount += 1;
    }

    await appendAuditLog(tx, {
      companyId: params.companyId,
      actorId: params.actorId,
      action: 'exception.scan',
      targetTable: 'fiscal_period',
      targetId: selectedPeriod.id,
      oldPayload: null,
      newPayload: {
        periodCode: selectedPeriod.code,
        evaluatedRuleCount: evaluation.evaluatedRuleIds.length,
        newFindingsCount,
        existingFindingsCount,
        resurfacedWaiversCount,
      },
      occurredAt: params.occurredAt,
    });

    return { newFindingsCount, existingFindingsCount, resurfacedWaiversCount };
  });

  return buildWorkspacePayload(db, {
    companyId: params.companyId,
    actorRole,
    selectedPeriod,
    periods,
    lastScan: {
      evaluatedRuleCount: evaluation.evaluatedRuleIds.length,
      notRunRules: [...evaluation.notRunRules],
      ...counts,
    },
  });
}

export async function transitionExceptionFinding(
  db: DatabaseHandle,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly findingId: string;
    readonly occurredAt: string;
    readonly input: ExceptionTransitionRequest;
  },
): Promise<ExceptionWorkspaceResponse> {
  const actorRole = await requireActorRole(db, params.companyId, params.actorId);
  const periods = await loadPeriods(db, params.companyId);

  const findingRes = await db.query<FindingRow>(
    `SELECT id, finding_key, finding_id_hash, rule_id, title, severity, status,
            period_id, account_code, statement_line_key, grain_key, amount::text AS amount,
            owner_user_id, due_date, explanation_note, waiver_reason, waiver_expires_at,
            evidence_json, suggestion_json, version, detected_at, updated_at
       FROM exception_finding
      WHERE company_id = $1 AND id = $2`,
    [params.companyId, params.findingId],
  );
  const finding = findingRes.rows[0];
  if (finding === undefined) {
    throw new AppError('NOT_FOUND', { userMessage: 'Exception finding not found.' });
  }

  const decision = evaluateExceptionTransition({
    currentStatus: finding.status,
    currentVersion: finding.version,
    expectedVersion: params.input.expectedVersion,
    action: params.input.action,
    actorRole,
    note: params.input.note ?? null,
    ownerUserId: params.input.ownerUserId ?? null,
    waiverReason: params.input.waiverReason ?? null,
    waiverExpiryDays: params.input.waiverExpiryDays ?? null,
    nowIso: params.occurredAt,
  });

  if (!decision.ok) {
    throw new AppError(decision.errorCode ?? 'VALIDATION_FAILED', {
      userMessage: decision.reason ?? 'Exception transition rejected.',
      details: { action: params.input.action, status: finding.status },
    });
  }

  if (params.input.ownerUserId !== undefined && params.input.ownerUserId !== null) {
    const memberCheck = await db.query<{ user_id: string }>(
      `SELECT user_id FROM membership WHERE company_id = $1 AND user_id = $2`,
      [params.companyId, params.input.ownerUserId],
    );
    if (memberCheck.rows.length === 0) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Assigned owner must be an active member of this company.',
      });
    }
  }

  await db.transaction(async (tx) => {
    const nextStatus = decision.nextStatus ?? finding.status;
    const nextOwner =
      params.input.action === 'assign'
        ? (params.input.ownerUserId ?? null)
        : finding.owner_user_id;
    const nextExplanation =
      params.input.action === 'explain' ? (params.input.note ?? null) : finding.explanation_note;
    const nextWaiverReason =
      params.input.action === 'waive'
        ? (params.input.waiverReason ?? null)
        : finding.waiver_reason;
    const nextWaiverExpires =
      params.input.action === 'waive'
        ? (decision.waiverExpiresAt ?? null)
        : finding.waiver_expires_at;

    const updated = await tx.query<{ id: string }>(
      `UPDATE exception_finding
          SET status = $1,
              owner_user_id = $2,
              explanation_note = $3,
              waiver_reason = $4,
              waiver_expires_at = $5,
              version = version + 1,
              updated_at = $6,
              updated_by = $7
        WHERE company_id = $8 AND id = $9 AND version = $10
        RETURNING id`,
      [
        nextStatus,
        nextOwner,
        nextExplanation,
        nextWaiverReason,
        nextWaiverExpires,
        params.occurredAt,
        params.actorId,
        params.companyId,
        params.findingId,
        params.input.expectedVersion,
      ],
    );
    if (updated.rows.length === 0) {
      throw new AppError('MODEL_VERSION_LOCKED', {
        userMessage: 'This exception finding was modified concurrently; refresh and retry.',
      });
    }

    const auditRecord = await appendAuditLog(tx, {
      companyId: params.companyId,
      actorId: params.actorId,
      action: `exception.${params.input.action}`,
      targetTable: 'exception_finding',
      targetId: params.findingId,
      oldPayload: { status: finding.status, ownerUserId: finding.owner_user_id, version: finding.version },
      newPayload: {
        status: nextStatus,
        ownerUserId: nextOwner,
        waiverExpiresAt: nextWaiverExpires,
        note: params.input.note ?? null,
      },
      occurredAt: params.occurredAt,
    });

    await tx.query(
      `INSERT INTO exception_finding_event (
         company_id, finding_id, from_status, to_status, action, note, actor_id, audit_entry_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        params.companyId,
        params.findingId,
        finding.status,
        nextStatus,
        params.input.action,
        params.input.note ?? params.input.waiverReason ?? null,
        params.actorId,
        auditRecord.id,
      ],
    );
  });

  const selectedPeriod = periods.find((p) => p.id === finding.period_id) ?? periods[0]!;
  return buildWorkspacePayload(db, {
    companyId: params.companyId,
    actorRole,
    selectedPeriod,
    periods,
  });
}

export async function rectifyExceptionFinding(
  db: DatabaseHandle,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly findingId: string;
    readonly occurredAt: string;
    readonly input: RectifyExceptionRequest;
  },
): Promise<ExceptionWorkspaceResponse> {
  const actorRole = await requireActorRole(db, params.companyId, params.actorId);
  if (actorRole === 'viewer') {
    throw new AppError('TENANT_FORBIDDEN', {
      userMessage: 'Viewers cannot rectify or dismiss exception findings.',
    });
  }
  if (params.input.mode === 'post_reversal' && actorRole === 'reviewer') {
    throw new AppError('TENANT_FORBIDDEN', {
      userMessage: 'Only workspace owners or editors may post reversal entries to the GL.',
    });
  }

  const periods = await loadPeriods(db, params.companyId);
  const findingRes = await db.query<FindingRow>(
    `SELECT id, finding_key, finding_id_hash, rule_id, title, severity, status,
            period_id, account_code, statement_line_key, grain_key, amount::text AS amount,
            owner_user_id, due_date, explanation_note, waiver_reason, waiver_expires_at,
            evidence_json, suggestion_json, version, detected_at, updated_at
       FROM exception_finding
      WHERE company_id = $1 AND id = $2`,
    [params.companyId, params.findingId],
  );
  const finding = findingRes.rows[0];
  if (finding === undefined) {
    throw new AppError('NOT_FOUND', { userMessage: 'Exception finding not found.' });
  }
  if (finding.version !== params.input.expectedVersion) {
    throw new AppError('MODEL_VERSION_LOCKED', {
      userMessage: `Finding version ${finding.version} does not match expected version ${params.input.expectedVersion}.`,
    });
  }

  const existingRect = await db.query<{ id: string }>(
    `SELECT id FROM rectification_journal WHERE company_id = $1 AND finding_id = $2`,
    [params.companyId, params.findingId],
  );
  if (existingRect.rows.length > 0) {
    throw new AppError('DUPLICATE_CODE', {
      userMessage: 'A rectification journal action has already been recorded for this finding.',
    });
  }

  const findingPeriod = periods.find((p) => p.id === finding.period_id) ?? periods[0]!;
  const targetPeriod = params.input.targetPeriodCode
    ? selectPeriodRow(periods, findingPeriod.fiscal_year, params.input.targetPeriodCode)
    : (periods.find((p) => p.id === finding.suggestion_json.targetPeriodId) ??
      findOpenTargetPeriod(periods, findingPeriod));

  const suggestion = finding.suggestion_json;
  if (params.input.mode !== 'dismiss' && suggestion.lines.length === 0) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Finding ${finding.rule_id} has advisory kind "${suggestion.kind}" without journal lines; explain or dismiss instead.`,
    });
  }
  if (params.input.mode === 'dismiss' && (!params.input.note || params.input.note.trim().length === 0)) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Dismissing a rectification suggestion requires a non-empty note.',
    });
  }

  let periodAdvisories: PeriodWriteAdvisory[] = [];

  await db.transaction(async (tx) => {
    let postedBatchId: string | null = null;
    let csvPayload: string | null = null;

    if (params.input.mode === 'post_reversal' || params.input.mode === 'export_csv') {
      csvPayload = buildRectificationCsv({
        entryDate: toIsoDate(targetPeriod.start_date),
        entryRef: `RECT-${finding.finding_id_hash.slice(0, 8).toUpperCase()}`,
        lines: suggestion.lines,
      });
    }

    if (params.input.mode === 'post_reversal' && csvPayload !== null) {
      const committed = await commitImport(tx, {
        companyId: params.companyId,
        actorId: params.actorId,
        kind: 'actuals',
        sourceFilename: `rectification-${finding.finding_id_hash.slice(0, 12)}.csv`,
        csvText: csvPayload,
        occurredAt: params.occurredAt,
      });
      if (committed.importedCount !== suggestion.lines.length || committed.entryCount === 0) {
        throw new AppError('VALIDATION_FAILED', {
          userMessage: 'Rectification journal could not post cleanly through the GL import guard.',
          details: { quarantinedReasons: committed.quarantined.map((q) => q.reason) },
        });
      }
      postedBatchId = committed.batchId;
      if (committed.periodAdvisories) {
        periodAdvisories = [...committed.periodAdvisories];
      }
    }

    await tx.query(
      `INSERT INTO rectification_journal (
         company_id, finding_id, target_period_id, mode, suggestion_kind, basis, erp_hint,
         lines_json, total_debit, total_credit, posted_batch_id, csv_payload, note, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14)`,
      [
        params.companyId,
        finding.id,
        targetPeriod.id,
        params.input.mode,
        suggestion.kind,
        suggestion.basis,
        suggestion.erpHint,
        JSON.stringify(suggestion.lines),
        params.input.mode === 'dismiss' ? '0' : suggestion.totalDebit,
        params.input.mode === 'dismiss' ? '0' : suggestion.totalCredit,
        postedBatchId,
        csvPayload,
        params.input.note ?? null,
        params.actorId,
      ],
    );

    const nextStatus: ExceptionStatus =
      params.input.mode === 'dismiss' ? finding.status : 'corrected';
    await tx.query(
      `UPDATE exception_finding
          SET status = $1, version = version + 1, updated_at = $2, updated_by = $3
        WHERE company_id = $4 AND id = $5 AND version = $6`,
      [
        nextStatus,
        params.occurredAt,
        params.actorId,
        params.companyId,
        finding.id,
        params.input.expectedVersion,
      ],
    );

    const auditRecord = await appendAuditLog(tx, {
      companyId: params.companyId,
      actorId: params.actorId,
      action: `exception.rectify_${params.input.mode}`,
      targetTable: 'exception_finding',
      targetId: finding.id,
      oldPayload: { status: finding.status, version: finding.version },
      newPayload: {
        status: nextStatus,
        mode: params.input.mode,
        targetPeriodCode: targetPeriod.code,
        postedBatchId,
      },
      occurredAt: params.occurredAt,
    });

    if (params.input.mode !== 'dismiss') {
      await tx.query(
        `INSERT INTO exception_finding_event (
           company_id, finding_id, from_status, to_status, action, note, actor_id, audit_entry_id
         ) VALUES ($1, $2, $3, 'corrected', 'correct', $4, $5, $6)`,
        [
          params.companyId,
          finding.id,
          finding.status,
          params.input.note ?? `Rectification (${params.input.mode}) into ${targetPeriod.code}`,
          params.actorId,
          auditRecord.id,
        ],
      );
    }
  });

  return buildWorkspacePayload(db, {
    companyId: params.companyId,
    actorRole,
    selectedPeriod: findingPeriod,
    periods,
    periodAdvisories,
  });
}
