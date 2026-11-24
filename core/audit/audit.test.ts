import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  GENESIS_PREV_HASH,
  buildAuditChain,
  canonicalJson,
  computeAuditEntryHash,
  createAuditChainEntry,
  sha256Hex,
  verifyAuditChain,
  type AuditEntryPayload,
} from './index.js';

describe('WI-0006 Audit Hash Chain & Canonical JSON (Port P11 — D7, SEC7)', () => {
  it('matches NIST FIPS 180-4 SHA-256 vectors and node:crypto independently', () => {
    // Independent NIST FIPS 180-4 published SHA-256 vectors
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );

    // Cross-check multi-byte UTF-8 input against node:crypto
    const utf8Sample = 'OneFP&A — €1,234.56 · 日本語';
    const nodeDigest = createHash('sha256').update(utf8Sample, 'utf8').digest('hex');
    expect(sha256Hex(utf8Sample)).toBe(nodeDigest);
  });

  it('produces deterministic key-sorted canonical JSON and rejects invalid types', () => {
    expect(GENESIS_PREV_HASH).toBe('0000000000000000000000000000000000000000000000000000000000000000');
    expect(GENESIS_PREV_HASH).toHaveLength(64);

    const a = { z: 1, a: { d: 'x', b: [true, null, { y: 2, x: 1 }] }, skip: undefined };
    const b = { a: { b: [true, null, { x: 1, y: 2 }], d: 'x' }, z: 1 };
    expect(canonicalJson(a)).toBe('{"a":{"b":[true,null,{"x":1,"y":2}],"d":"x"},"z":1}');
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(-0)).toBe('0');

    expect(() => canonicalJson(Number.NaN)).toThrow(/CANONICAL_JSON_NON_FINITE_NUMBER/);
    expect(() => canonicalJson(10n)).toThrow(/CANONICAL_JSON_UNSUPPORTED_TYPE/);

    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(() => canonicalJson(circular)).toThrow(/CANONICAL_JSON_CIRCULAR_REFERENCE/);
  });

  it('computes exact independent entry_hash = sha256(prev_hash || canonical_json(payload))', () => {
    const payload: AuditEntryPayload = {
      companyId: '11111111-1111-4111-8111-111111111111',
      actorId: '22222222-2222-4222-8222-222222222222',
      action: 'import.commit',
      targetTable: 'import_batch',
      targetId: '33333333-3333-4333-8333-333333333333',
      oldPayload: null,
      newPayload: { rowCount: 12, status: 'committed' },
      occurredAt: '2026-01-15T12:00:00.000Z',
    };

    const canonicalPayload =
      '{"action":"import.commit","actorId":"22222222-2222-4222-8222-222222222222","companyId":"11111111-1111-4111-8111-111111111111","newPayload":{"rowCount":12,"status":"committed"},"occurredAt":"2026-01-15T12:00:00.000Z","oldPayload":null,"targetId":"33333333-3333-4333-8333-333333333333","targetTable":"import_batch"}';

    const independentHash = createHash('sha256')
      .update(`${GENESIS_PREV_HASH}${canonicalPayload}`, 'utf8')
      .digest('hex');

    expect(computeAuditEntryHash(GENESIS_PREV_HASH, payload)).toBe(independentHash);
    const record = createAuditChainEntry(GENESIS_PREV_HASH, payload);
    expect(record.entryHash).toBe(independentHash);
  });

  it('verifies valid chains and detects historical payload tampering, broken links, and format errors', () => {
    expect(verifyAuditChain([])).toEqual({ valid: true, checkedCount: 0 });

    const chain = buildAuditChain([
      {
        companyId: '11111111-1111-4111-8111-111111111111',
        actorId: '22222222-2222-4222-8222-222222222222',
        action: 'company.create',
        targetTable: 'company',
        targetId: '11111111-1111-4111-8111-111111111111',
        oldPayload: null,
        newPayload: { name: 'Sample Co', baseCurrency: 'USD' },
        occurredAt: '2026-01-01T00:00:00.000Z',
      },
      {
        companyId: '11111111-1111-4111-8111-111111111111',
        actorId: '22222222-2222-4222-8222-222222222222',
        action: 'plan_line.upsert',
        targetTable: 'plan_line',
        targetId: '44444444-4444-4444-8444-444444444444',
        oldPayload: { amount: '100.00' },
        newPayload: { amount: '250.00' },
        occurredAt: '2026-01-02T00:00:00.000Z',
      },
      {
        companyId: '11111111-1111-4111-8111-111111111111',
        actorId: '22222222-2222-4222-8222-222222222222',
        action: 'plan_version.lock',
        targetTable: 'plan_version',
        targetId: '55555555-5555-4555-8555-555555555555',
        oldPayload: { isCurrent: true, lockedAt: null },
        newPayload: { isCurrent: true, lockedAt: '2026-01-03T00:00:00.000Z' },
        occurredAt: '2026-01-03T00:00:00.000Z',
      },
    ]);

    expect(verifyAuditChain(chain)).toEqual({ valid: true, checkedCount: 3 });

    // Tamper historical payload in entry 0
    const tamperedPayloadChain = chain.map((rec, idx) =>
      idx === 0 ? { ...rec, newPayload: { name: 'Tampered Co', baseCurrency: 'USD' } } : rec,
    );
    const tamperRes = verifyAuditChain(tamperedPayloadChain);
    expect(tamperRes.valid).toBe(false);
    expect(tamperRes.brokenIndex).toBe(0);
    expect(tamperRes.reason).toBe('ENTRY_HASH_MISMATCH');

    // Break prevHash link at entry 2
    const brokenLinkChain = chain.map((rec, idx) =>
      idx === 2 ? { ...rec, prevHash: GENESIS_PREV_HASH } : rec,
    );
    const linkRes = verifyAuditChain(brokenLinkChain);
    expect(linkRes.valid).toBe(false);
    expect(linkRes.brokenIndex).toBe(2);
    expect(linkRes.reason).toBe('PREV_HASH_LINK_MISMATCH');

    // Genesis mismatch at entry 0
    const badGenesis = chain.map((rec, idx) =>
      idx === 0 ? { ...rec, prevHash: 'f'.repeat(64) } : rec,
    );
    const genesisRes = verifyAuditChain(badGenesis);
    expect(genesisRes.valid).toBe(false);
    expect(genesisRes.brokenIndex).toBe(0);
    expect(genesisRes.reason).toBe('GENESIS_MISMATCH');

    // Malformed hash format rejected
    const badFormat = chain.map((rec, idx) => (idx === 1 ? { ...rec, entryHash: 'not-hex' } : rec));
    const formatRes = verifyAuditChain(badFormat);
    expect(formatRes.valid).toBe(false);
    expect(formatRes.brokenIndex).toBe(1);
    expect(formatRes.reason).toBe('INVALID_HASH_FORMAT');
  });
});
