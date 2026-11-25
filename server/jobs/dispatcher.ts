import type { NotificationEventKind } from '../../shared/workflow.js';
import { appendAuditLog } from '../audit/index.js';
import type { SqlExecutor } from '../db/migrate.js';

export interface NotificationDispatchJobInput {
  readonly companyId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly eventKind: NotificationEventKind;
  readonly planVersionId: string;
  readonly taskId: string | null;
  readonly commentId: string | null;
  readonly recipientIds: readonly string[];
  readonly title: string;
  readonly body: string;
  readonly occurredAt: string;
}

export interface NotificationDispatchJobResult {
  readonly jobId: string;
  readonly deduplicated: boolean;
  readonly notificationIds: readonly string[];
}

/**
 * Synchronous-in-sandbox, ledger-backed notification dispatcher (§11.2 JOB1/JOB3, §11.9 COL3).
 *
 * Idempotency is guaranteed by `(company_id, kind, idempotency_key)` uniqueness in `job`, and both
 * the inbox `notification` inserts and the `job.completed` audit entry execute inside the caller's
 * SQL transaction so partial delivery is impossible.
 */
export async function dispatchNotificationJob(
  tx: SqlExecutor,
  input: NotificationDispatchJobInput,
): Promise<NotificationDispatchJobResult> {
  const uniqueRecipients: string[] = [];
  const seen = new Set<string>();
  for (const id of input.recipientIds) {
    if (!seen.has(id)) {
      seen.add(id);
      uniqueRecipients.push(id);
    }
  }

  const existingRes = await tx.query<{ id: string }>(
    `SELECT id
       FROM job
      WHERE company_id = $1
        AND kind = 'notification.dispatch'
        AND idempotency_key = $2
      LIMIT 1`,
    [input.companyId, input.idempotencyKey],
  );
  const existing = existingRes.rows[0];
  if (existing !== undefined) {
    const existingNotifs = await tx.query<{ id: string }>(
      `SELECT id FROM notification WHERE company_id = $1 AND job_id = $2 ORDER BY created_at ASC`,
      [input.companyId, existing.id],
    );
    return {
      jobId: existing.id,
      deduplicated: true,
      notificationIds: existingNotifs.rows.map((r) => r.id),
    };
  }

  const payloadJson = JSON.stringify({
    eventKind: input.eventKind,
    planVersionId: input.planVersionId,
    taskId: input.taskId,
    commentId: input.commentId,
    recipientIds: uniqueRecipients,
  });

  const jobRes = await tx.query<{ id: string }>(
    `INSERT INTO job (company_id, kind, idempotency_key, status, attempts, payload, created_by)
     VALUES ($1, 'notification.dispatch', $2, 'running', 1, $3::jsonb, $4)
     RETURNING id`,
    [input.companyId, input.idempotencyKey, payloadJson, input.actorId],
  );
  const jobId = jobRes.rows[0]!.id;

  const notificationIds: string[] = [];
  for (const recipientId of uniqueRecipients) {
    const notifRes = await tx.query<{ id: string }>(
      `INSERT INTO notification (
         company_id, recipient_id, job_id, event_kind, plan_version_id,
         task_id, comment_id, title, body, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz)
       RETURNING id`,
      [
        input.companyId,
        recipientId,
        jobId,
        input.eventKind,
        input.planVersionId,
        input.taskId,
        input.commentId,
        input.title,
        input.body,
        input.occurredAt,
      ],
    );
    notificationIds.push(notifRes.rows[0]!.id);
  }

  const resultRef = {
    eventKind: input.eventKind,
    notificationIds,
    recipientCount: notificationIds.length,
  };

  await tx.query(
    `UPDATE job
        SET status = 'completed',
            result_ref = $1::jsonb,
            completed_at = $2::timestamptz
      WHERE company_id = $3 AND id = $4`,
    [JSON.stringify(resultRef), input.occurredAt, input.companyId, jobId],
  );

  await appendAuditLog(tx, {
    companyId: input.companyId,
    actorId: input.actorId,
    action: 'job.completed',
    targetTable: 'job',
    targetId: jobId,
    oldPayload: null,
    newPayload: {
      kind: 'notification.dispatch',
      idempotencyKey: input.idempotencyKey,
      eventKind: input.eventKind,
      notificationIds,
    },
    occurredAt: input.occurredAt,
  });

  return {
    jobId,
    deduplicated: false,
    notificationIds,
  };
}
