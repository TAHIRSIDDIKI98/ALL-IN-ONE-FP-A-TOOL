// Ported from fpa/src-tauri/src/core/audit.rs @ 6f6f72f5b681, FPA-modular/app/core/hashing.py @ 641d3d830573, and fp-A-betterversion/server/src/db/auditSchema.ts @ 86d785ca696c. Class B.
// Changes: Implemented pure canonical JSON (lexicographically sorted keys, strict type checks) + SHA-256 hash chain verification matching MASTER_PROMPT §4.4 (`entry_hash = sha256(prev_hash || canonical_json(payload))`, genesis = 64 zero hex chars). Oracle: core/audit/audit.test.ts.

import { sha256Hex } from './sha256.js';

export const GENESIS_PREV_HASH = '0'.repeat(64);
const HEX_64_RE = /^[0-9a-f]{64}$/;

export interface AuditEntryPayload {
  readonly companyId: string;
  readonly actorId: string;
  readonly action: string;
  readonly targetTable: string;
  readonly targetId: string;
  readonly oldPayload: unknown;
  readonly newPayload: unknown;
  readonly occurredAt: string;
}

export interface AuditChainRecord extends AuditEntryPayload {
  readonly id?: string;
  readonly prevHash: string;
  readonly entryHash: string;
}

export type AuditChainFailureReason =
  | 'INVALID_HASH_FORMAT'
  | 'GENESIS_MISMATCH'
  | 'PREV_HASH_LINK_MISMATCH'
  | 'ENTRY_HASH_MISMATCH';

export interface AuditVerificationResult {
  readonly valid: boolean;
  readonly checkedCount: number;
  readonly brokenIndex?: number;
  readonly reason?: AuditChainFailureReason;
  readonly detail?: string;
}

function hasToJson(value: object): value is { toJSON: () => unknown } {
  return 'toJSON' in value && typeof (value as { toJSON?: unknown }).toJSON === 'function';
}

function canonicalizeValue(value: unknown, seen: Set<object>): string {
  if (value === null) {
    return 'null';
  }
  const t = typeof value;
  if (t === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (t === 'string') {
    return JSON.stringify(value);
  }
  if (t === 'number') {
    const n = value as number;
    if (!Number.isFinite(n)) {
      throw new Error(`CANONICAL_JSON_NON_FINITE_NUMBER: ${String(n)}`);
    }
    // Normalize -0 to 0
    return JSON.stringify(Object.is(n, -0) ? 0 : n);
  }
  if (t === 'bigint' || t === 'symbol' || t === 'function' || t === 'undefined') {
    throw new Error(`CANONICAL_JSON_UNSUPPORTED_TYPE: ${t}`);
  }

  const obj = value as object;
  if (seen.has(obj)) {
    throw new Error('CANONICAL_JSON_CIRCULAR_REFERENCE');
  }

  if (obj instanceof Date) {
    if (Number.isNaN(obj.getTime())) {
      throw new Error('CANONICAL_JSON_INVALID_DATE');
    }
    return JSON.stringify(obj.toISOString());
  }

  if (hasToJson(obj)) {
    seen.add(obj);
    const serialized = canonicalizeValue(obj.toJSON(), seen);
    seen.delete(obj);
    return serialized;
  }

  seen.add(obj);
  if (Array.isArray(obj)) {
    const parts: string[] = [];
    for (let i = 0; i < obj.length; i++) {
      const item: unknown = obj[i];
      parts.push(item === undefined ? 'null' : canonicalizeValue(item, seen));
    }
    seen.delete(obj);
    return `[${parts.join(',')}]`;
  }

  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const entries: string[] = [];
  for (const key of keys) {
    const propVal = record[key];
    if (propVal === undefined) {
      continue;
    }
    entries.push(`${JSON.stringify(key)}:${canonicalizeValue(propVal, seen)}`);
  }
  seen.delete(obj);
  return `{${entries.join(',')}}`;
}

/**
 * Deterministic key-sorted JSON serialization with no whitespace.
 */
export function canonicalJson(value: unknown): string {
  return canonicalizeValue(value, new Set<object>());
}

export function isSha256Hex(hash: string): boolean {
  return HEX_64_RE.test(hash);
}

/**
 * Computes `sha256(prev_hash || canonical_json(payload))` per MASTER_PROMPT §4.4.
 */
export function computeAuditEntryHash(prevHash: string, payload: unknown): string {
  if (!isSha256Hex(prevHash)) {
    throw new Error(`INVALID_PREV_HASH: expected 64 lowercase hex chars, got "${prevHash}"`);
  }
  return sha256Hex(`${prevHash}${canonicalJson(payload)}`);
}

export function extractAuditPayload(entry: AuditEntryPayload): AuditEntryPayload {
  return {
    companyId: entry.companyId,
    actorId: entry.actorId,
    action: entry.action,
    targetTable: entry.targetTable,
    targetId: entry.targetId,
    oldPayload: entry.oldPayload,
    newPayload: entry.newPayload,
    occurredAt: entry.occurredAt,
  };
}

export function createAuditChainEntry(
  prevHash: string,
  payload: AuditEntryPayload,
  id?: string,
): AuditChainRecord {
  const normalized = extractAuditPayload(payload);
  const entryHash = computeAuditEntryHash(prevHash, normalized);
  return {
    ...(id !== undefined ? { id } : {}),
    ...normalized,
    prevHash,
    entryHash,
  };
}

export function buildAuditChain(
  payloads: readonly AuditEntryPayload[],
  initialPrevHash: string = GENESIS_PREV_HASH,
): AuditChainRecord[] {
  if (!isSha256Hex(initialPrevHash)) {
    throw new Error(`INVALID_INITIAL_PREV_HASH: "${initialPrevHash}"`);
  }
  const chain: AuditChainRecord[] = [];
  let prev = initialPrevHash;
  for (const p of payloads) {
    const entry = createAuditChainEntry(prev, p);
    chain.push(entry);
    prev = entry.entryHash;
  }
  return chain;
}

export function verifyAuditChain(
  records: readonly AuditChainRecord[],
  expectedGenesisPrevHash: string = GENESIS_PREV_HASH,
): AuditVerificationResult {
  if (!isSha256Hex(expectedGenesisPrevHash)) {
    return {
      valid: false,
      checkedCount: 0,
      brokenIndex: 0,
      reason: 'INVALID_HASH_FORMAT',
      detail: `Expected genesis prevHash is not valid 64-hex: ${expectedGenesisPrevHash}`,
    };
  }

  for (let i = 0; i < records.length; i++) {
    const rec = records[i]!;
    if (!isSha256Hex(rec.prevHash) || !isSha256Hex(rec.entryHash)) {
      return {
        valid: false,
        checkedCount: i,
        brokenIndex: i,
        reason: 'INVALID_HASH_FORMAT',
        detail: `Record ${i} contains malformed SHA-256 hex digest`,
      };
    }

    const expectedPrev = i === 0 ? expectedGenesisPrevHash : records[i - 1]!.entryHash;
    if (rec.prevHash !== expectedPrev) {
      return {
        valid: false,
        checkedCount: i,
        brokenIndex: i,
        reason: i === 0 ? 'GENESIS_MISMATCH' : 'PREV_HASH_LINK_MISMATCH',
        detail: `Record ${i} prevHash mismatch (expected ${expectedPrev}, got ${rec.prevHash})`,
      };
    }

    const expectedEntryHash = computeAuditEntryHash(rec.prevHash, extractAuditPayload(rec));
    if (rec.entryHash !== expectedEntryHash) {
      return {
        valid: false,
        checkedCount: i,
        brokenIndex: i,
        reason: 'ENTRY_HASH_MISMATCH',
        detail: `Record ${i} entryHash mismatch (payload tampered or hash forged)`,
      };
    }
  }

  return {
    valid: true,
    checkedCount: records.length,
  };
}

export { sha256Hex };
