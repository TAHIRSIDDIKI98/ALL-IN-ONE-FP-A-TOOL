// Ported from fp-A-betterversion/server/src/db/auditSchema.ts @ 86d785ca696c. Class B.
// Changes: Uses pure /core/audit SHA-256 canonical JSON hash chain + parameterized SQL inside caller transaction; verifies chain integrity against stored rows (MASTER_PROMPT §3.4, §4.4, D7). Oracle: server/db/schema.test.ts.

import {
  GENESIS_PREV_HASH,
  createAuditChainEntry,
  verifyAuditChain,
  type AuditChainRecord,
  type AuditEntryPayload,
  type AuditVerificationResult,
} from '../../core/audit/index.js';
import type { SqlExecutor } from '../db/migrate.js';

interface AuditRowDb extends Record<string, unknown> {
  id: string;
  company_id: string;
  actor_id: string;
  action: string;
  target_table: string;
  target_id: string;
  old_payload: unknown;
  new_payload: unknown;
  occurred_at: Date | string;
  prev_hash: string;
  entry_hash: string;
}

function toIsoTimestamp(val: Date | string): string {
  if (val instanceof Date) {
    return val.toISOString();
  }
  return new Date(val).toISOString();
}

export async function appendAuditLog(
  tx: SqlExecutor,
  payload: AuditEntryPayload,
): Promise<AuditChainRecord> {
  const latest = await tx.query<{ entry_hash: string }>(
    `SELECT entry_hash
       FROM audit_log
      WHERE company_id = $1
      ORDER BY occurred_at DESC, created_at DESC, id DESC
      LIMIT 1`,
    [payload.companyId],
  );

  const prevHash = latest.rows[0]?.entry_hash ?? GENESIS_PREV_HASH;
  const entry = createAuditChainEntry(prevHash, payload);

  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO audit_log (
       company_id, actor_id, action, target_table, target_id,
       old_payload, new_payload, occurred_at, prev_hash, entry_hash
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::timestamptz, $9, $10)
     RETURNING id`,
    [
      entry.companyId,
      entry.actorId,
      entry.action,
      entry.targetTable,
      entry.targetId,
      entry.oldPayload === null ? null : JSON.stringify(entry.oldPayload),
      entry.newPayload === null ? null : JSON.stringify(entry.newPayload),
      entry.occurredAt,
      entry.prevHash,
      entry.entryHash,
    ],
  );

  const insertedId = inserted.rows[0]?.id;
  return {
    ...entry,
    ...(insertedId !== undefined ? { id: insertedId } : {}),
  };
}

export async function verifyCompanyAuditLog(
  db: SqlExecutor,
  companyId: string,
): Promise<AuditVerificationResult> {
  const res = await db.query<AuditRowDb>(
    `SELECT id, company_id, actor_id, action, target_table, target_id,
            old_payload, new_payload, occurred_at, prev_hash, entry_hash
       FROM audit_log
      WHERE company_id = $1
      ORDER BY occurred_at ASC, created_at ASC, id ASC`,
    [companyId],
  );

  const records: AuditChainRecord[] = res.rows.map((r) => ({
    id: r.id,
    companyId: r.company_id,
    actorId: r.actor_id,
    action: r.action,
    targetTable: r.target_table,
    targetId: r.target_id,
    oldPayload: r.old_payload,
    newPayload: r.new_payload,
    occurredAt: toIsoTimestamp(r.occurred_at),
    prevHash: r.prev_hash,
    entryHash: r.entry_hash,
  }));

  return verifyAuditChain(records);
}
