import {
  buildCommentAnchorKey,
  canActorComment,
  canActorCreateTask,
  canActorManageMembers,
  extractMentionTokens,
  resolveMentions,
  transitionApprovalTask,
} from '../../../core/workflow/index.js';
import { AppError } from '../../../shared/errors.js';
import type {
  AddCompanyMemberRequest,
  ApprovalStatus,
  ApprovalTaskSummary,
  CommentAnchorKind,
  CompanyMember,
  CreateApprovalTaskRequest,
  CreateWorkflowCommentRequest,
  MembershipRole,
  NotificationEventKind,
  PlanVersionSummary,
  TransitionApprovalTaskRequest,
  WorkflowCommentSummary,
  WorkflowNotificationSummary,
  WorkflowOverviewResponse,
} from '../../../shared/workflow.js';
import { appendAuditLog } from '../../audit/index.js';
import { dispatchNotificationJob } from '../../jobs/dispatcher.js';
import { isUniqueViolation } from '../client.js';
import type { SqlExecutor } from '../migrate.js';
import { isActorMember } from './setup.js';

interface RoleRow extends Record<string, unknown> {
  role: MembershipRole;
}

interface MemberDbRow extends Record<string, unknown> {
  user_id: string;
  email: string;
  display_name: string;
  role: MembershipRole;
}

interface PlanVersionDbRow extends Record<string, unknown> {
  plan_version_id: string;
  scenario_id: string;
  scenario_name: string;
  scenario_kind: 'actual' | 'budget' | 'forecast';
  version_no: number;
  label: string;
  is_current: boolean;
  locked_at: Date | string | null;
}

interface ApprovalTaskDbRow extends Record<string, unknown> {
  id: string;
  company_id: string;
  scenario_id: string;
  scenario_name: string;
  plan_version_id: string;
  version_no: number;
  version_label: string;
  title: string;
  status: ApprovalStatus;
  version: number;
  created_by: string;
  created_by_name: string;
  assignee_id: string | null;
  assignee_name: string | null;
  submitted_by: string | null;
  submitted_at: Date | string | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: Date | string | null;
  decision_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface CommentDbRow extends Record<string, unknown> {
  id: string;
  company_id: string;
  plan_version_id: string;
  version_no: number;
  scenario_name: string;
  anchor_kind: CommentAnchorKind;
  anchor_key: string;
  account_code: string | null;
  period_code: string | null;
  statement_line_key: string | null;
  author_id: string;
  author_name: string;
  author_email: string;
  body: string;
  mentioned_user_ids: unknown;
  created_at: Date | string;
}

interface NotificationDbRow extends Record<string, unknown> {
  id: string;
  company_id: string;
  recipient_id: string;
  job_id: string;
  event_kind: NotificationEventKind;
  plan_version_id: string;
  task_id: string | null;
  comment_id: string | null;
  title: string;
  body: string;
  read_at: Date | string | null;
  created_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toIsoNullable(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string');
}

function mapApprovalTaskRow(row: ApprovalTaskDbRow): ApprovalTaskSummary {
  return {
    id: row.id,
    companyId: row.company_id,
    scenarioId: row.scenario_id,
    scenarioName: row.scenario_name,
    planVersionId: row.plan_version_id,
    versionNo: row.version_no,
    versionLabel: row.version_label,
    title: row.title,
    status: row.status,
    version: row.version,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    assigneeId: row.assignee_id,
    assigneeName: row.assignee_name,
    submittedBy: row.submitted_by,
    submittedAt: toIsoNullable(row.submitted_at),
    decidedBy: row.decided_by,
    decidedByName: row.decided_by_name,
    decidedAt: toIsoNullable(row.decided_at),
    decisionReason: row.decision_reason,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapCommentRow(row: CommentDbRow): WorkflowCommentSummary {
  return {
    id: row.id,
    companyId: row.company_id,
    planVersionId: row.plan_version_id,
    versionNo: row.version_no,
    scenarioName: row.scenario_name,
    anchorKind: row.anchor_kind,
    anchorKey: row.anchor_key,
    accountCode: row.account_code,
    periodCode: row.period_code,
    statementLineKey: row.statement_line_key,
    authorId: row.author_id,
    authorName: row.author_name,
    authorEmail: row.author_email,
    body: row.body,
    mentionedUserIds: toStringArray(row.mentioned_user_ids),
    createdAt: toIso(row.created_at),
  };
}

function mapNotificationRow(row: NotificationDbRow): WorkflowNotificationSummary {
  return {
    id: row.id,
    companyId: row.company_id,
    recipientId: row.recipient_id,
    jobId: row.job_id,
    eventKind: row.event_kind,
    planVersionId: row.plan_version_id,
    taskId: row.task_id,
    commentId: row.comment_id,
    title: row.title,
    body: row.body,
    readAt: toIsoNullable(row.read_at),
    createdAt: toIso(row.created_at),
  };
}

export async function getMemberRole(
  db: SqlExecutor,
  companyId: string,
  actorId: string,
): Promise<MembershipRole> {
  const res = await db.query<RoleRow>(
    `SELECT role FROM membership WHERE company_id = $1 AND user_id = $2 LIMIT 1`,
    [companyId, actorId],
  );
  const row = res.rows[0];
  if (row === undefined) {
    throw new AppError('TENANT_FORBIDDEN');
  }
  return row.role;
}

async function readApprovalTaskById(
  db: SqlExecutor,
  companyId: string,
  taskId: string,
): Promise<ApprovalTaskSummary> {
  const res = await db.query<ApprovalTaskDbRow>(
    `SELECT t.id, t.company_id, t.scenario_id, s.name AS scenario_name,
            t.plan_version_id, pv.version_no, pv.label AS version_label,
            t.title, t.status, t.version,
            t.created_by, uc.display_name AS created_by_name,
            t.assignee_id, ua.display_name AS assignee_name,
            t.submitted_by, t.submitted_at,
            t.decided_by, ud.display_name AS decided_by_name,
            t.decided_at, t.decision_reason,
            t.created_at, t.updated_at
       FROM approval_task t
       JOIN scenario s ON s.company_id = t.company_id AND s.id = t.scenario_id
       JOIN plan_version pv ON pv.company_id = t.company_id AND pv.id = t.plan_version_id
       JOIN app_user uc ON uc.id = t.created_by
  LEFT JOIN app_user ua ON ua.id = t.assignee_id
  LEFT JOIN app_user ud ON ud.id = t.decided_by
      WHERE t.company_id = $1 AND t.id = $2
      LIMIT 1`,
    [companyId, taskId],
  );
  const row = res.rows[0];
  if (row === undefined) {
    throw new AppError('NOT_FOUND', { userMessage: 'Approval task was not found.' });
  }
  return mapApprovalTaskRow(row);
}

async function readCommentById(
  db: SqlExecutor,
  companyId: string,
  commentId: string,
): Promise<WorkflowCommentSummary> {
  const res = await db.query<CommentDbRow>(
    `SELECT c.id, c.company_id, c.plan_version_id, pv.version_no, s.name AS scenario_name,
            c.anchor_kind, c.anchor_key,
            a.code AS account_code, fp.code AS period_code, c.statement_line_key,
            c.author_id, u.display_name AS author_name, u.email AS author_email,
            c.body, c.mentioned_user_ids, c.created_at
       FROM comment c
       JOIN plan_version pv ON pv.company_id = c.company_id AND pv.id = c.plan_version_id
       JOIN scenario s ON s.company_id = pv.company_id AND s.id = pv.scenario_id
       JOIN app_user u ON u.id = c.author_id
  LEFT JOIN account a ON a.company_id = c.company_id AND a.id = c.account_id
  LEFT JOIN fiscal_period fp ON fp.company_id = c.company_id AND fp.id = c.period_id
      WHERE c.company_id = $1 AND c.id = $2
      LIMIT 1`,
    [companyId, commentId],
  );
  const row = res.rows[0];
  if (row === undefined) {
    throw new AppError('NOT_FOUND', { userMessage: 'Comment was not found.' });
  }
  return mapCommentRow(row);
}

export async function listWorkflowOverview(
  db: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly scenarioName?: string | undefined;
  },
): Promise<WorkflowOverviewResponse> {
  const { companyId, actorId } = params;
  const scenarioFilter =
    params.scenarioName !== undefined && params.scenarioName.trim().length > 0
      ? params.scenarioName.trim()
      : null;

  const actorRole = await getMemberRole(db, companyId, actorId);

  const membersRes = await db.query<MemberDbRow>(
    `SELECT u.id AS user_id, u.email, u.display_name, m.role
       FROM membership m
       JOIN app_user u ON u.id = m.user_id
      WHERE m.company_id = $1
      ORDER BY m.created_at ASC, u.email ASC`,
    [companyId],
  );
  const members: CompanyMember[] = membersRes.rows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    displayName: r.display_name,
    role: r.role,
  }));

  const versionsRes = await db.query<PlanVersionDbRow>(
    `SELECT pv.id AS plan_version_id, s.id AS scenario_id, s.name AS scenario_name,
            s.kind AS scenario_kind, pv.version_no, pv.label, pv.is_current, pv.locked_at
       FROM plan_version pv
       JOIN scenario s ON s.company_id = pv.company_id AND s.id = pv.scenario_id
      WHERE pv.company_id = $1
        AND ($2::text IS NULL OR s.name = $2)
      ORDER BY s.name ASC, pv.version_no DESC`,
    [companyId, scenarioFilter],
  );
  const planVersions: PlanVersionSummary[] = versionsRes.rows.map((r) => ({
    planVersionId: r.plan_version_id,
    scenarioId: r.scenario_id,
    scenarioName: r.scenario_name,
    scenarioKind: r.scenario_kind,
    versionNo: r.version_no,
    label: r.label,
    isCurrent: r.is_current,
    lockedAt: toIsoNullable(r.locked_at),
  }));

  const tasksRes = await db.query<ApprovalTaskDbRow>(
    `SELECT t.id, t.company_id, t.scenario_id, s.name AS scenario_name,
            t.plan_version_id, pv.version_no, pv.label AS version_label,
            t.title, t.status, t.version,
            t.created_by, uc.display_name AS created_by_name,
            t.assignee_id, ua.display_name AS assignee_name,
            t.submitted_by, t.submitted_at,
            t.decided_by, ud.display_name AS decided_by_name,
            t.decided_at, t.decision_reason,
            t.created_at, t.updated_at
       FROM approval_task t
       JOIN scenario s ON s.company_id = t.company_id AND s.id = t.scenario_id
       JOIN plan_version pv ON pv.company_id = t.company_id AND pv.id = t.plan_version_id
       JOIN app_user uc ON uc.id = t.created_by
  LEFT JOIN app_user ua ON ua.id = t.assignee_id
  LEFT JOIN app_user ud ON ud.id = t.decided_by
      WHERE t.company_id = $1
        AND ($2::text IS NULL OR s.name = $2)
      ORDER BY t.updated_at DESC, t.created_at DESC`,
    [companyId, scenarioFilter],
  );

  const commentsRes = await db.query<CommentDbRow>(
    `SELECT c.id, c.company_id, c.plan_version_id, pv.version_no, s.name AS scenario_name,
            c.anchor_kind, c.anchor_key,
            a.code AS account_code, fp.code AS period_code, c.statement_line_key,
            c.author_id, u.display_name AS author_name, u.email AS author_email,
            c.body, c.mentioned_user_ids, c.created_at
       FROM comment c
       JOIN plan_version pv ON pv.company_id = c.company_id AND pv.id = c.plan_version_id
       JOIN scenario s ON s.company_id = pv.company_id AND s.id = pv.scenario_id
       JOIN app_user u ON u.id = c.author_id
  LEFT JOIN account a ON a.company_id = c.company_id AND a.id = c.account_id
  LEFT JOIN fiscal_period fp ON fp.company_id = c.company_id AND fp.id = c.period_id
      WHERE c.company_id = $1
        AND ($2::text IS NULL OR s.name = $2)
      ORDER BY c.created_at DESC, c.id DESC`,
    [companyId, scenarioFilter],
  );

  const notifRes = await db.query<NotificationDbRow>(
    `SELECT id, company_id, recipient_id, job_id, event_kind, plan_version_id,
            task_id, comment_id, title, body, read_at, created_at
       FROM notification
      WHERE company_id = $1 AND recipient_id = $2
      ORDER BY created_at DESC, id DESC`,
    [companyId, actorId],
  );

  return {
    companyId,
    actorRole,
    members,
    planVersions,
    tasks: tasksRes.rows.map(mapApprovalTaskRow),
    comments: commentsRes.rows.map(mapCommentRow),
    notifications: notifRes.rows.map(mapNotificationRow),
  };
}

export async function addCompanyMember(
  tx: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly request: AddCompanyMemberRequest;
    readonly occurredAt: string;
  },
): Promise<CompanyMember> {
  const { companyId, actorId, request, occurredAt } = params;
  const actorRole = await getMemberRole(tx, companyId, actorId);
  if (!canActorManageMembers(actorRole)) {
    throw new AppError('TENANT_FORBIDDEN', {
      userMessage: 'Only a company owner can grant or update workspace member roles.',
    });
  }

  const normalizedEmail = request.email.trim().toLowerCase();
  const displayName = request.displayName.trim();

  const existingUserRes = await tx.query<{
    id: string;
    email: string;
    display_name: string;
  }>(
    `SELECT id, email, display_name
       FROM app_user
      WHERE lower(email) = $1
      ORDER BY created_at ASC
      LIMIT 1`,
    [normalizedEmail],
  );

  let memberUserId: string;
  const existingUser = existingUserRes.rows[0];
  if (existingUser !== undefined) {
    memberUserId = existingUser.id;
  } else {
    const insUser = await tx.query<{ id: string }>(
      `INSERT INTO app_user (firebase_uid, email, display_name)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [`sandbox:${normalizedEmail}`, normalizedEmail, displayName],
    );
    memberUserId = insUser.rows[0]!.id;
  }

  const oldMembershipRes = await tx.query<RoleRow>(
    `SELECT role FROM membership WHERE company_id = $1 AND user_id = $2 LIMIT 1`,
    [companyId, memberUserId],
  );
  const oldRole = oldMembershipRes.rows[0]?.role ?? null;

  await tx.query(
    `INSERT INTO membership (company_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (company_id, user_id) DO UPDATE
       SET role = EXCLUDED.role`,
    [companyId, memberUserId, request.role],
  );

  await appendAuditLog(tx, {
    companyId,
    actorId,
    action: 'membership.grant',
    targetTable: 'membership',
    targetId: memberUserId,
    oldPayload: oldRole === null ? null : { role: oldRole },
    newPayload: {
      userId: memberUserId,
      email: existingUser?.email ?? normalizedEmail,
      displayName: existingUser?.display_name ?? displayName,
      role: request.role,
    },
    occurredAt,
  });

  return {
    userId: memberUserId,
    email: existingUser?.email ?? normalizedEmail,
    displayName: existingUser?.display_name ?? displayName,
    role: request.role,
  };
}

export async function createApprovalTask(
  tx: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly request: CreateApprovalTaskRequest;
    readonly occurredAt: string;
  },
): Promise<ApprovalTaskSummary> {
  const { companyId, actorId, request, occurredAt } = params;
  const actorRole = await getMemberRole(tx, companyId, actorId);
  if (!canActorCreateTask(actorRole)) {
    throw new AppError('TENANT_FORBIDDEN', {
      userMessage: `Role "${actorRole}" cannot create approval tasks.`,
    });
  }

  const pvRes = await tx.query<{ id: string; scenario_id: string; locked_at: Date | string | null }>(
    `SELECT id, scenario_id, locked_at
       FROM plan_version
      WHERE company_id = $1 AND id = $2
      LIMIT 1`,
    [companyId, request.planVersionId],
  );
  const pv = pvRes.rows[0];
  if (pv === undefined) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Referenced plan version does not belong to this company.',
      details: { issues: [`UNKNOWN_PLAN_VERSION:${request.planVersionId}`] },
    });
  }
  if (pv.locked_at !== null) {
    throw new AppError('MODEL_VERSION_LOCKED', {
      userMessage: 'That plan version is already approved and locked.',
    });
  }

  const assigneeId = request.assigneeId ?? null;
  if (assigneeId !== null && !(await isActorMember(tx, companyId, assigneeId))) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Assignee must be an active member of this company.',
      details: { issues: [`UNKNOWN_ASSIGNEE:${assigneeId}`] },
    });
  }

  let taskId: string;
  try {
    const ins = await tx.query<{ id: string }>(
      `INSERT INTO approval_task (
         company_id, scenario_id, plan_version_id, title, status, version,
         created_by, assignee_id, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, 'draft', 1, $5, $6, $7::timestamptz, $7::timestamptz)
       RETURNING id`,
      [companyId, pv.scenario_id, pv.id, request.title.trim(), actorId, assigneeId, occurredAt],
    );
    taskId = ins.rows[0]!.id;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError('DUPLICATE_CODE', {
        userMessage: 'An approval task already exists for this plan version.',
        details: { planVersionId: request.planVersionId },
      });
    }
    throw error;
  }

  await appendAuditLog(tx, {
    companyId,
    actorId,
    action: 'approval_task.create',
    targetTable: 'approval_task',
    targetId: taskId,
    oldPayload: null,
    newPayload: {
      scenarioId: pv.scenario_id,
      planVersionId: pv.id,
      title: request.title.trim(),
      assigneeId,
      status: 'draft',
    },
    occurredAt,
  });

  return readApprovalTaskById(tx, companyId, taskId);
}

export async function transitionApprovalTaskRecord(
  tx: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly taskId: string;
    readonly request: TransitionApprovalTaskRequest;
    readonly occurredAt: string;
  },
): Promise<ApprovalTaskSummary> {
  const { companyId, actorId, taskId, request, occurredAt } = params;
  const actorRole = await getMemberRole(tx, companyId, actorId);

  const taskRes = await tx.query<{
    id: string;
    scenario_id: string;
    plan_version_id: string;
    title: string;
    status: ApprovalStatus;
    version: number;
    created_by: string;
    assignee_id: string | null;
    submitted_by: string | null;
  }>(
    `SELECT id, scenario_id, plan_version_id, title, status, version,
            created_by, assignee_id, submitted_by
       FROM approval_task
      WHERE company_id = $1 AND id = $2
      FOR UPDATE`,
    [companyId, taskId],
  );
  const current = taskRes.rows[0];
  if (current === undefined) {
    throw new AppError('NOT_FOUND', {
      userMessage: 'Approval task was not found in this company.',
    });
  }

  if (request.expectedVersion !== undefined && request.expectedVersion !== current.version) {
    throw new AppError('MODEL_VERSION_LOCKED', {
      userMessage: 'Approval task was modified concurrently; refresh before retrying.',
      details: {
        expectedVersion: request.expectedVersion,
        actualVersion: current.version,
      },
    });
  }

  const outcome = transitionApprovalTask({
    currentStatus: current.status,
    nextStatus: request.targetStatus,
    actorRole,
    actorId,
    reason: request.reason ?? null,
    occurredAt,
  });

  if (!outcome.ok) {
    throw new AppError(outcome.errorCode, {
      userMessage: outcome.reason,
      details: { issues: [outcome.reason] },
    });
  }

  const nextVersion = current.version + 1;
  if (outcome.nextStatus === 'submitted') {
    await tx.query(
      `UPDATE approval_task
          SET status = 'submitted',
              version = $1,
              submitted_by = $2,
              submitted_at = $3::timestamptz,
              decision_reason = $4,
              updated_at = $3::timestamptz
        WHERE company_id = $5 AND id = $6`,
      [nextVersion, actorId, occurredAt, outcome.decisionReason, companyId, taskId],
    );
  } else {
    await tx.query(
      `UPDATE approval_task
          SET status = $1,
              version = $2,
              decided_by = $3,
              decided_at = $4::timestamptz,
              decision_reason = $5,
              updated_at = $4::timestamptz
        WHERE company_id = $6 AND id = $7`,
      [
        outcome.nextStatus,
        nextVersion,
        actorId,
        occurredAt,
        outcome.decisionReason,
        companyId,
        taskId,
      ],
    );
  }

  if (outcome.lockPlanVersion) {
    await tx.query(
      `UPDATE plan_version
          SET locked_at = $1::timestamptz
        WHERE company_id = $2 AND id = $3 AND locked_at IS NULL`,
      [occurredAt, companyId, current.plan_version_id],
    );
  }

  await appendAuditLog(tx, {
    companyId,
    actorId,
    action: 'approval_task.transition',
    targetTable: 'approval_task',
    targetId: taskId,
    oldPayload: {
      status: current.status,
      version: current.version,
    },
    newPayload: {
      status: outcome.nextStatus,
      version: nextVersion,
      decisionReason: outcome.decisionReason,
      lockPlanVersion: outcome.lockPlanVersion,
    },
    occurredAt,
  });

  const recipients: string[] = [];
  if (outcome.eventKind === 'approval.submitted') {
    if (current.assignee_id !== null && current.assignee_id !== actorId) {
      recipients.push(current.assignee_id);
    } else if (current.assignee_id === null) {
      const reviewersRes = await tx.query<{ user_id: string }>(
        `SELECT user_id
           FROM membership
          WHERE company_id = $1 AND role = 'reviewer' AND user_id <> $2
          ORDER BY created_at ASC`,
        [companyId, actorId],
      );
      for (const r of reviewersRes.rows) {
        recipients.push(r.user_id);
      }
    }
  } else {
    for (const candidate of [current.created_by, current.submitted_by]) {
      if (candidate !== null && candidate !== actorId && !recipients.includes(candidate)) {
        recipients.push(candidate);
      }
    }
  }

  if (recipients.length > 0) {
    const title =
      outcome.eventKind === 'approval.submitted'
        ? `Submitted for review: ${current.title}`
        : outcome.eventKind === 'approval.approved'
          ? `Approved: ${current.title}`
          : `Rejected: ${current.title}`;
    const body =
      outcome.decisionReason !== null
        ? `${title} — ${outcome.decisionReason}`
        : title;
    await dispatchNotificationJob(tx, {
      companyId,
      actorId,
      idempotencyKey: `task:${taskId}:v${String(nextVersion)}`,
      eventKind: outcome.eventKind,
      planVersionId: current.plan_version_id,
      taskId,
      commentId: null,
      recipientIds: recipients,
      title,
      body,
      occurredAt,
    });
  }

  return readApprovalTaskById(tx, companyId, taskId);
}

export async function createWorkflowComment(
  tx: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly request: CreateWorkflowCommentRequest;
    readonly occurredAt: string;
  },
): Promise<WorkflowCommentSummary> {
  const { companyId, actorId, request, occurredAt } = params;
  const actorRole = await getMemberRole(tx, companyId, actorId);
  if (!canActorComment(actorRole)) {
    throw new AppError('TENANT_FORBIDDEN', {
      userMessage: `Role "${actorRole}" has read-only access and cannot post comments.`,
    });
  }

  const anchorOutcome = buildCommentAnchorKey(request.anchor);
  if (!anchorOutcome.ok) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: anchorOutcome.reason,
      details: { issues: [anchorOutcome.reason] },
    });
  }
  const { anchor } = anchorOutcome;

  const pvRes = await tx.query<{ id: string }>(
    `SELECT id FROM plan_version WHERE company_id = $1 AND id = $2 LIMIT 1`,
    [companyId, request.planVersionId],
  );
  if (pvRes.rows[0] === undefined) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Referenced plan version does not belong to this company.',
      details: { issues: [`UNKNOWN_PLAN_VERSION:${request.planVersionId}`] },
    });
  }

  let accountId: string | null = null;
  if (anchor.accountCode !== null) {
    const acctRes = await tx.query<{ id: string }>(
      `SELECT id FROM account WHERE company_id = $1 AND code = $2 LIMIT 1`,
      [companyId, anchor.accountCode],
    );
    const acct = acctRes.rows[0];
    if (acct === undefined) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Account "${anchor.accountCode}" was not found in this company chart.`,
        details: { issues: [`UNKNOWN_ACCOUNT:${anchor.accountCode}`] },
      });
    }
    accountId = acct.id;
  }

  let periodId: string | null = null;
  if (anchor.periodCode !== null) {
    const periodRes = await tx.query<{ id: string }>(
      `SELECT id
         FROM fiscal_period
        WHERE company_id = $1 AND code = $2 AND is_adjustment = false
        ORDER BY fiscal_year DESC
        LIMIT 1`,
      [companyId, anchor.periodCode],
    );
    const period = periodRes.rows[0];
    if (period === undefined) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Fiscal period "${anchor.periodCode}" was not found in this company calendar.`,
        details: { issues: [`UNKNOWN_PERIOD:${anchor.periodCode}`] },
      });
    }
    periodId = period.id;
  }

  let statementLineKey: string | null = null;
  if (anchor.statementLineKey !== null) {
    const lineRes = await tx.query<{ key: string }>(
      `SELECT key FROM statement_line WHERE key = $1 LIMIT 1`,
      [anchor.statementLineKey],
    );
    const line = lineRes.rows[0];
    if (line === undefined) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Statement line key "${anchor.statementLineKey}" does not exist.`,
        details: { issues: [`UNKNOWN_STATEMENT_LINE:${anchor.statementLineKey}`] },
      });
    }
    statementLineKey = line.key;
  }

  const membersRes = await tx.query<{ user_id: string; email: string; display_name: string }>(
    `SELECT u.id AS user_id, u.email, u.display_name
       FROM membership m
       JOIN app_user u ON u.id = m.user_id
      WHERE m.company_id = $1
      ORDER BY u.email ASC`,
    [companyId],
  );
  const members = membersRes.rows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    displayName: r.display_name,
  }));

  const mentionTokens = extractMentionTokens(request.body);
  const mentionResolution = resolveMentions(mentionTokens, members);
  if (!mentionResolution.ok) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Comment contains an unknown or ambiguous @mention.',
      details: { issues: [...mentionResolution.issues] },
    });
  }

  const mentionedUserIds = mentionResolution.recipients.map((r) => r.userId);
  const ins = await tx.query<{ id: string }>(
    `INSERT INTO comment (
       company_id, plan_version_id, anchor_kind, anchor_key,
       account_id, period_id, statement_line_key,
       author_id, body, mentioned_user_ids, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::timestamptz)
     RETURNING id`,
    [
      companyId,
      request.planVersionId,
      anchor.anchorKind,
      anchor.anchorKey,
      accountId,
      periodId,
      statementLineKey,
      actorId,
      request.body.trim(),
      JSON.stringify(mentionedUserIds),
      occurredAt,
    ],
  );
  const commentId = ins.rows[0]!.id;

  await appendAuditLog(tx, {
    companyId,
    actorId,
    action: 'workflow.comment_create',
    targetTable: 'comment',
    targetId: commentId,
    oldPayload: null,
    newPayload: {
      planVersionId: request.planVersionId,
      anchorKind: anchor.anchorKind,
      anchorKey: anchor.anchorKey,
      mentionedUserIds,
    },
    occurredAt,
  });

  if (mentionedUserIds.length > 0) {
    await dispatchNotificationJob(tx, {
      companyId,
      actorId,
      idempotencyKey: `comment:${commentId}`,
      eventKind: 'mention',
      planVersionId: request.planVersionId,
      taskId: null,
      commentId,
      recipientIds: mentionedUserIds,
      title: `Mentioned on ${anchor.anchorKey}`,
      body: request.body.trim().slice(0, 240),
      occurredAt,
    });
  }

  return readCommentById(tx, companyId, commentId);
}

export async function markWorkflowNotificationRead(
  tx: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly notificationId: string;
    readonly occurredAt: string;
  },
): Promise<WorkflowNotificationSummary> {
  const { companyId, actorId, notificationId, occurredAt } = params;
  await getMemberRole(tx, companyId, actorId);

  const existingRes = await tx.query<{ read_at: Date | string | null }>(
    `SELECT read_at
       FROM notification
      WHERE company_id = $1 AND recipient_id = $2 AND id = $3
      LIMIT 1`,
    [companyId, actorId, notificationId],
  );
  const existing = existingRes.rows[0];
  if (existing === undefined) {
    throw new AppError('NOT_FOUND', {
      userMessage: 'Notification was not found in your inbox.',
    });
  }

  const updatedRes = await tx.query<NotificationDbRow>(
    `UPDATE notification
        SET read_at = COALESCE(read_at, $1::timestamptz)
      WHERE company_id = $2 AND recipient_id = $3 AND id = $4
      RETURNING id, company_id, recipient_id, job_id, event_kind, plan_version_id,
                task_id, comment_id, title, body, read_at, created_at`,
    [occurredAt, companyId, actorId, notificationId],
  );
  const updated = updatedRes.rows[0]!;

  if (existing.read_at === null) {
    await appendAuditLog(tx, {
      companyId,
      actorId,
      action: 'notification.read',
      targetTable: 'notification',
      targetId: notificationId,
      oldPayload: { readAt: null },
      newPayload: { readAt: toIso(updated.read_at!) },
      occurredAt,
    });
  }

  return mapNotificationRow(updated);
}
