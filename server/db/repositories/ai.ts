/**
 * OneFP&A AI Intelligence & Commentary Repository (`/server/db/repositories/ai.ts`)
 * MASTER_PROMPT §10.3, SPEC.md §7.3 WI-0048B, DEC-026.
 */

import { AppError } from '../../../shared/errors.js';
import { appendAuditLog } from '../../audit/index.js';
import type { SqlExecutor } from '../migrate.js';
import { canTransitionNarrativeStatus } from '../../../core/ai/index.js';
import type { NarrativeStatus } from '../../../shared/ai.js';

export interface AiPolicyConfigRow extends Record<string, unknown> {
  id: string;
  company_id: string;
  ai_enabled: boolean;
  consent_notice_version: string;
  consent_recorded_at: string | Date | null;
  consent_recorded_by: string | null;
  max_requests_per_hour: number;
  updated_at: string | Date;
}

export interface NarrativeCommentaryRow extends Record<string, unknown> {
  id: string;
  company_id: string;
  period_id: string;
  statement_line_key: string;
  version_no: number;
  status: NarrativeStatus;
  provenance: 'ai_draft' | 'deterministic_fallback' | 'human_edited';
  disclosure: string;
  sentences_json: unknown;
  citation_coverage_pct: string;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | Date | null;
  created_at: string | Date;
}

export interface AiEgressAuditRow extends Record<string, unknown> {
  id: string;
  company_id: string;
  actor_id: string | null;
  feature: string;
  endpoint: string;
  model_used: string;
  mode: string;
  prompt_bytes: number;
  redaction_count: number;
  fallback_reason: string | null;
  prompt_hash: string;
  created_at: string | Date;
}

export async function getAiPolicyConfig(db: SqlExecutor, companyId: string): Promise<AiPolicyConfigRow> {
  const res = await db.query<AiPolicyConfigRow>(
    `SELECT * FROM ai_policy_config WHERE company_id = $1`,
    [companyId]
  );
  if (res.rows.length === 0) {
    await db.query(
      `INSERT INTO ai_policy_config (company_id, ai_enabled, max_requests_per_hour)
       VALUES ($1, false, 60)
       ON CONFLICT (company_id) DO NOTHING`,
      [companyId]
    );
    const retry = await db.query<AiPolicyConfigRow>(
      `SELECT * FROM ai_policy_config WHERE company_id = $1`,
      [companyId]
    );
    return retry.rows[0]!;
  }
  return res.rows[0]!;
}

export async function updateAiPolicyConfig(
  db: SqlExecutor,
  companyId: string,
  actorId: string,
  aiEnabled: boolean
): Promise<AiPolicyConfigRow> {
  const current = await getAiPolicyConfig(db, companyId);
  const res = await db.query<AiPolicyConfigRow>(
    `UPDATE ai_policy_config
     SET ai_enabled = $2,
         consent_recorded_at = CASE WHEN $2 = true AND ai_enabled = false THEN now() ELSE consent_recorded_at END,
         consent_recorded_by = CASE WHEN $2 = true AND ai_enabled = false THEN $3 ELSE consent_recorded_by END,
         updated_at = now()
     WHERE company_id = $1
     RETURNING *`,
    [companyId, aiEnabled, actorId]
  );

  await appendAuditLog(db, {
    companyId,
    actorId,
    action: 'ai.policy.update',
    targetTable: 'ai_policy_config',
    targetId: companyId,
    oldPayload: { aiEnabled: current.ai_enabled },
    newPayload: { aiEnabled },
    occurredAt: new Date().toISOString(),
  });

  return res.rows[0]!;
}

export async function logAiEgressAudit(
  db: SqlExecutor,
  companyId: string,
  actorId: string | null,
  params: {
    feature: string;
    endpoint: string;
    modelUsed: string;
    mode: 'llm' | 'deterministic_fallback';
    promptBytes: number;
    redactionCount: number;
    fallbackReason?: string;
    promptHash: string;
  }
): Promise<AiEgressAuditRow> {
  const res = await db.query<AiEgressAuditRow>(
    `INSERT INTO ai_egress_audit (
       company_id, actor_id, feature, endpoint, model_used, mode,
       prompt_bytes, redaction_count, fallback_reason, prompt_hash
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      companyId,
      actorId,
      params.feature,
      params.endpoint,
      params.modelUsed,
      params.mode,
      params.promptBytes,
      params.redactionCount,
      params.fallbackReason || null,
      params.promptHash,
    ]
  );
  return res.rows[0]!;
}

export async function createNarrativeCommentary(
  db: SqlExecutor,
  companyId: string,
  actorId: string | null,
  params: {
    periodId: string;
    statementLineKey: string;
    status: NarrativeStatus;
    provenance: 'ai_draft' | 'deterministic_fallback' | 'human_edited';
    disclosure: string;
    sentencesJson: unknown;
    citationCoveragePct: string;
  }
): Promise<NarrativeCommentaryRow> {
  const maxRes = await db.query<{ max_v: number | null }>(
    `SELECT MAX(version_no) as max_v FROM narrative_commentary
     WHERE company_id = $1 AND period_id = $2 AND statement_line_key = $3`,
    [companyId, params.periodId, params.statementLineKey]
  );
  const nextVersion = (maxRes.rows[0]?.max_v || 0) + 1;

  const res = await db.query<NarrativeCommentaryRow>(
    `INSERT INTO narrative_commentary (
       company_id, period_id, statement_line_key, version_no, status,
       provenance, disclosure, sentences_json, citation_coverage_pct, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
     RETURNING *`,
    [
      companyId,
      params.periodId,
      params.statementLineKey,
      nextVersion,
      params.status,
      params.provenance,
      params.disclosure,
      JSON.stringify(params.sentencesJson),
      params.citationCoveragePct,
      actorId,
    ]
  );

  const inserted = res.rows[0]!;

  await appendAuditLog(db, {
    companyId,
    actorId: actorId || '00000000-0000-0000-0000-000000000000',
    action: 'ai.commentary.create',
    targetTable: 'narrative_commentary',
    targetId: inserted.id,
    oldPayload: null,
    newPayload: { versionNo: nextVersion, status: params.status },
    occurredAt: new Date().toISOString(),
  });

  return inserted;
}

export async function getNarrativeCommentaries(
  db: SqlExecutor,
  companyId: string,
  periodId: string,
  statementLineKey: string
): Promise<readonly NarrativeCommentaryRow[]> {
  const res = await db.query<NarrativeCommentaryRow>(
    `SELECT * FROM narrative_commentary
     WHERE company_id = $1 AND period_id = $2 AND statement_line_key = $3
     ORDER BY version_no DESC`,
    [companyId, periodId, statementLineKey]
  );
  return res.rows;
}

export async function transitionNarrativeStatus(
  db: SqlExecutor,
  companyId: string,
  actorId: string,
  commentaryId: string,
  targetStatus: NarrativeStatus,
  role: 'owner' | 'editor' | 'reviewer' | 'viewer'
): Promise<NarrativeCommentaryRow> {
  const curRes = await db.query<NarrativeCommentaryRow>(
    `SELECT * FROM narrative_commentary WHERE company_id = $1 AND id = $2`,
    [companyId, commentaryId]
  );
  if (curRes.rows.length === 0) {
    throw new AppError('NOT_FOUND', { userMessage: 'Commentary not found' });
  }
  const current = curRes.rows[0]!;

  const transitionRes = canTransitionNarrativeStatus(current.status, targetStatus, role);

  if (!transitionRes.allowed) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Cannot transition commentary status from ${current.status} to ${targetStatus} as ${role}: ${transitionRes.reason}`,
    });
  }

  const isApprovedOrLocked = targetStatus === 'approved' || targetStatus === 'locked';

  const res = await db.query<NarrativeCommentaryRow>(
    `UPDATE narrative_commentary
     SET status = $3,
         approved_by = CASE WHEN $4 = true THEN $5 ELSE approved_by END,
         approved_at = CASE WHEN $4 = true THEN now() ELSE approved_at END
     WHERE company_id = $1 AND id = $2
     RETURNING *`,
    [companyId, commentaryId, targetStatus, isApprovedOrLocked, actorId]
  );

  const updated = res.rows[0]!;

  await appendAuditLog(db, {
    companyId,
    actorId,
    action: 'ai.commentary.transition',
    targetTable: 'narrative_commentary',
    targetId: commentaryId,
    oldPayload: { status: current.status },
    newPayload: { status: targetStatus },
    occurredAt: new Date().toISOString(),
  });

  return updated;
}

export async function getApprovedCommentaries(
  db: SqlExecutor,
  companyId: string,
  periodId: string
): Promise<readonly NarrativeCommentaryRow[]> {
  const res = await db.query<NarrativeCommentaryRow>(
    `SELECT DISTINCT ON (statement_line_key) *
     FROM narrative_commentary
     WHERE company_id = $1 AND period_id = $2 AND status IN ('approved', 'locked')
     ORDER BY statement_line_key, version_no DESC`,
    [companyId, periodId]
  );
  return res.rows;
}
