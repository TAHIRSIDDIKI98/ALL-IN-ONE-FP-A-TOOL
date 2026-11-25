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
    `SELECT a.entry_hash
       FROM audit_log a
      WHERE a.company_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM audit_log child
           WHERE child.company_id = $1
             AND child.prev_hash = a.entry_hash
        )
      ORDER BY a.occurred_at DESC, a.created_at DESC, a.id DESC
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

  const rawRecords: AuditChainRecord[] = res.rows.map((r) => ({
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

  // Walk the hash-linked chain from GENESIS_PREV_HASH so rows committed in the same transaction
  // or millisecond are verified in true link order rather than arbitrary UUIDv4 tie-break order.
  const byPrev = new Map<string, AuditChainRecord[]>();
  for (const rec of rawRecords) {
    const bucket = byPrev.get(rec.prevHash);
    if (bucket === undefined) {
      byPrev.set(rec.prevHash, [rec]);
    } else {
      bucket.push(rec);
    }
  }

  const ordered: AuditChainRecord[] = [];
  const visited = new Set<AuditChainRecord>();
  let cursor = GENESIS_PREV_HASH;
  while (true) {
    const candidates = byPrev.get(cursor);
    if (candidates === undefined || candidates.length !== 1) {
      break;
    }
    const next = candidates[0]!;
    if (visited.has(next)) {
      break;
    }
    visited.add(next);
    ordered.push(next);
    cursor = next.entryHash;
  }
  for (const rec of rawRecords) {
    if (!visited.has(rec)) {
      ordered.push(rec);
    }
  }

  return verifyAuditChain(ordered);
}
