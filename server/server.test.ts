import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpineApp } from './app.js';
import { createSandboxTokenVerifier, issueSandboxToken, type VerifiedIdentity } from './auth/session.js';
import { openSandboxDatabase, type DatabaseHandle } from './db/client.js';
import { applyMigrations } from './db/migrate.js';
import { ApiClientError, createApiClient } from '../src/api/client.js';
import { seedChartOfAccounts } from './db/repositories/import.js';
import { MESSY_CSV } from './db/testing/corpus-fixtures.js';
import { verifyCompanyAuditLog } from './audit/index.js';
import { CoaMappingReportSchema } from '../shared/coaMapping.js';
import {
  computeDashboardSummaryUncached,
  getDashboardSummaryWithMeta,
  invalidateDashboardCacheForTests,
} from './db/repositories/dashboards.js';
import workforceOracle from '../fixtures/oracles/workforce/workforce_oracle.json' with { type: 'json' };
import fluxPvmOracle from '../fixtures/oracles/variance/flux_pvm_oracle.json' with { type: 'json' };
import googleSheetsFixture from '../fixtures/oracles/connectors/google_sheets_gl.json' with { type: 'json' };
import qboFixture from '../fixtures/oracles/connectors/quickbooks_online_je.json' with { type: 'json' };
import xeroFixture from '../fixtures/oracles/connectors/xero_manual_journals.json' with { type: 'json' };
import mismatchFixture from '../fixtures/oracles/connectors/reconciliation_mismatch_je.json' with { type: 'json' };
import { NormalizedJournalEntrySchema } from '../shared/integrations.js';
import { buildSyntheticPartnerDataset } from '../core/onboarding/index.js';

const SECRET = 'server-test-sandbox-secret-long-enough';

let db: DatabaseHandle;
let server: Server;
let baseUrl = '';
let openDb: DatabaseHandle;
let openServer: Server;
let openBaseUrl = '';

const OWNER: VerifiedIdentity = {
  firebaseUid: 'sandbox:owner@onefpa.test',
  email: 'owner@onefpa.test',
  displayName: 'Owner',
};
const INTRUDER: VerifiedIdentity = {
  firebaseUid: 'sandbox:intruder@onefpa.test',
  email: 'intruder@onefpa.test',
  displayName: 'Intruder',
};

function bearer(identity: VerifiedIdentity): Record<string, string> {
  return {
    authorization: `Bearer ${issueSandboxToken({ identity, secret: SECRET, ttlMs: 600_000 })}`,
    'content-type': 'application/json',
  };
}

async function countBatches(companyId: string): Promise<number> {
  const res = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM import_batch WHERE company_id = $1`,
    [companyId],
  );
  return Number(res.rows[0]?.count ?? 'NaN');
}

/** Read the exported bytes, never the pre-render definition (A6/U5/G7). */
async function loadWorkbook(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const directory = mkdtempSync(join(tmpdir(), 'onefpa-api-pack-'));
  const path = join(directory, 'pack.xlsx');
  try {
    writeFileSync(path, bytes);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path);
    return workbook;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function extractPdfText(bytes: Uint8Array): string {
  const latin = Buffer.from(bytes).toString('latin1');
  let decoded = '';
  for (const stream of latin.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    for (const token of (stream[1] ?? '').matchAll(/<([0-9A-Fa-f]+)>/g)) {
      decoded += Buffer.from(token[1] ?? '', 'hex').toString('latin1');
    }
    decoded += '\n';
  }
  return decoded;
}

function extractPptxRuns(bytes: Uint8Array): string[] {
  const buf = Buffer.from(bytes);
  expect(buf.subarray(0, 2).toString('ascii')).toBe('PK');
  let eocdPos = -1;
  for (let pos = buf.length - 22; pos >= 0 && pos >= buf.length - 65_557; pos -= 1) {
    if (buf.readUInt32LE(pos) === 0x06054b50) {
      eocdPos = pos;
      break;
    }
  }
  expect(eocdPos).toBeGreaterThanOrEqual(0);
  const cdEntries = buf.readUInt16LE(eocdPos + 10);
  const cdOffset = buf.readUInt32LE(eocdPos + 16);
  const runs: string[] = [];
  let cursor = cdOffset;
  for (let idx = 0; idx < cdEntries; idx += 1) {
    expect(buf.readUInt32LE(cursor)).toBe(0x02014b50);
    const method = buf.readUInt16LE(cursor + 10);
    const compSize = buf.readUInt32LE(cursor + 20);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const localOffset = buf.readUInt32LE(cursor + 42);
    const entryName = buf.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8');
    cursor = cursor + 46 + nameLen + extraLen + commentLen;
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(entryName)) continue;
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataPos = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buf.subarray(dataPos, dataPos + compSize);
    const xml = (method === 8 ? inflateRawSync(compressed) : compressed).toString('utf8');
    for (const match of xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)) {
      runs.push(
        (match[1] ?? '')
          .replaceAll('&amp;', '&')
          .replaceAll('&lt;', '<')
          .replaceAll('&gt;', '>')
          .replaceAll('&quot;', '"')
          .replaceAll('&apos;', "'"),
      );
    }
  }
  return runs;
}

async function listen(app: ReturnType<typeof createSpineApp>): Promise<{ server: Server; baseUrl: string }> {
  const s = app.listen(0, '127.0.0.1');
  await once(s, 'listening');
  const addr = s.address() as AddressInfo;
  return { server: s, baseUrl: `http://127.0.0.1:${addr.port}` };
}

beforeAll(async () => {
  db = await openSandboxDatabase();
  await applyMigrations(db);
  const verifier = createSandboxTokenVerifier({ secret: SECRET });
  const started = await listen(createSpineApp({ db, verifier, sandboxSecret: SECRET }));
  server = started.server;
  baseUrl = started.baseUrl;

  // A second instance that models a production-like context: no sandbox token endpoint.
  openDb = await openSandboxDatabase();
  await applyMigrations(openDb);
  const second = await listen(
    createSpineApp({ db: openDb, verifier: createSandboxTokenVerifier({ secret: SECRET }), sandboxSecret: null }),
  );
  openServer = second.server;
  openBaseUrl = second.baseUrl;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => openServer.close(() => resolve()));
  await db.close();
  await openDb.close();
});

describe('M1 Express spine API (/server/app.ts)', () => {
  it('serves /healthz and a real database-backed /readyz', async () => {
    const health = await fetch(`${baseUrl}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, service: 'onefpa-api', milestone: 'M1' });

    const ready = await fetch(`${baseUrl}/readyz`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ ok: true, database: 'pglite' });
  });

  it('returns typed 401 envelopes for missing, malformed, forged, and expired sessions', async () => {
    const missing = await fetch(`${baseUrl}/api/session/workspace`);
    expect(missing.status).toBe(401);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('SESSION_REQUIRED');

    const malformed = await fetch(`${baseUrl}/api/session/workspace`, {
      headers: { authorization: 'Basic abc' },
    });
    expect(((await malformed.json()) as { error: { code: string } }).error.code).toBe('SESSION_REQUIRED');

    const forged = await fetch(`${baseUrl}/api/session/workspace`, {
      headers: { authorization: 'Bearer sbx1.forged.signature' },
    });
    expect(forged.status).toBe(401);
    expect(((await forged.json()) as { error: { code: string } }).error.code).toBe('TOKEN_INVALID');

    const expiredToken = issueSandboxToken({
      identity: OWNER,
      secret: SECRET,
      ttlMs: 1_000,
      nowMs: Date.now() - 86_400_000,
    });
    const expired = await fetch(`${baseUrl}/api/session/workspace`, {
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    expect(expired.status).toBe(401);
    expect(((await expired.json()) as { error: { code: string } }).error.code).toBe('TOKEN_INVALID');
  });

  it('mints a real sandbox token and bootstraps an empty workspace for a brand-new identity', async () => {
    const freshly = await fetch(`${baseUrl}/api/session/sandbox-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'fresh@onefpa.test', displayName: 'Fresh User' }),
    });
    expect(freshly.status).toBe(201);
    const minted = (await freshly.json()) as { token: string; tokenType: string; expiresInSeconds: number };
    expect(minted.tokenType).toBe('sandbox-hmac');
    expect(minted.expiresInSeconds).toBe(3600);

    const workspace = await fetch(`${baseUrl}/api/session/workspace`, {
      headers: { authorization: `Bearer ${minted.token}` },
    });
    expect(workspace.status).toBe(200);
    const body = (await workspace.json()) as {
      authenticated: boolean;
      identity: { email: string };
      companies: unknown[];
      workspace: unknown;
    };
    expect(body.authenticated).toBe(true);
    expect(body.identity.email).toBe('fresh@onefpa.test');
    expect(body.companies).toEqual([]);
    expect(body.workspace).toBeNull();

    const invalid = await fetch(`${baseUrl}/api/session/sandbox-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', ttlSeconds: 5 }),
    });
    expect(invalid.status).toBe(422);
    expect(((await invalid.json()) as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('removes the sandbox token endpoint entirely when no sandbox secret is configured', async () => {
    const res = await fetch(`${openBaseUrl}/api/session/sandbox-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@onefpa.test' }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('creates a company workspace through the API and reads it back through the session bootstrap', async () => {
    const create = await fetch(`${baseUrl}/api/setup/company`, {
      method: 'POST',
      headers: bearer(OWNER),
      body: JSON.stringify({
        companyName: 'API Test Co',
        baseCurrency: 'USD',
        calendarKind: '12month',
        fiscalYear: 2026,
        entityCode: 'ENT-API',
        entityName: 'API Test Co HQ',
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as {
      companyId: string;
      companyName: string;
      periods: Array<{ code: string; startDate: string; endDate: string }>;
      entities: Array<{ code: string }>;
      currencyScale: number;
    };
    expect(created.companyName).toBe('API Test Co');
    expect(created.currencyScale).toBe(2);
    expect(created.periods).toHaveLength(12);
    expect(created.periods[0]).toEqual(
      expect.objectContaining({ code: 'P01', startDate: '2026-01-01', endDate: '2026-01-31' }),
    );
    expect(created.entities.map((e) => e.code)).toEqual(['ENT-API']);

    const bootstrap = await fetch(`${baseUrl}/api/session/workspace`, { headers: bearer(OWNER) });
    const body = (await bootstrap.json()) as {
      companies: Array<{ id: string; name: string }>;
      workspace: { companyId: string; periods: unknown[] } | null;
    };
    expect(body.companies).toEqual([{ id: created.companyId, name: 'API Test Co', baseCurrency: 'USD' }]);
    expect(body.workspace?.companyId).toBe(created.companyId);
    expect(body.workspace?.periods).toHaveLength(12);

    const direct = await fetch(`${baseUrl}/api/companies/${created.companyId}/workspace`, {
      headers: bearer(OWNER),
    });
    expect(direct.status).toBe(200);
    expect(((await direct.json()) as { companyId: string }).companyId).toBe(created.companyId);
  });

  it('denies every foreign-tenant read with 403 TENANT_FORBIDDEN and leaks no company names', async () => {
    const ownerBootstrap = await fetch(`${baseUrl}/api/session/workspace`, { headers: bearer(OWNER) });
    const ownerBody = (await ownerBootstrap.json()) as { companies: Array<{ id: string }> };
    const foreignCompanyId = ownerBody.companies[0]?.id ?? '';

    const intruderWorkspace = await fetch(`${baseUrl}/api/session/workspace`, { headers: bearer(INTRUDER) });
    expect(intruderWorkspace.status).toBe(200);
    const intruderBody = (await intruderWorkspace.json()) as {
      companies: unknown[];
      workspace: unknown;
    };
    expect(intruderBody.companies).toEqual([]);
    expect(intruderBody.workspace).toBeNull();

    const foreignRead = await fetch(`${baseUrl}/api/companies/${foreignCompanyId}/workspace`, {
      headers: bearer(INTRUDER),
    });
    expect(foreignRead.status).toBe(403);
    const foreignBody = (await foreignRead.json()) as { error: { code: string; details: Record<string, unknown> } };
    expect(foreignBody.error.code).toBe('TENANT_FORBIDDEN');
    expect(JSON.stringify(foreignBody)).not.toContain('API Test Co');

    const unknownRead = await fetch(
      `${baseUrl}/api/companies/00000000-0000-4000-8000-000000000000/workspace`,
      { headers: bearer(OWNER) },
    );
    expect(unknownRead.status).toBe(403);
    expect(((await unknownRead.json()) as { error: { code: string } }).error.code).toBe('TENANT_FORBIDDEN');
  });

  it('rejects unauthenticated writes and invalid setup payloads with typed envelopes', async () => {
    const unauthenticated = await fetch(`${baseUrl}/api/setup/company`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ companyName: 'No Auth Co' }),
    });
    expect(unauthenticated.status).toBe(401);

    const invalid = await fetch(`${baseUrl}/api/setup/company`, {
      method: 'POST',
      headers: bearer(OWNER),
      body: JSON.stringify({ companyName: 'X', baseCurrency: 'ZZZ', calendarKind: 'nope' }),
    });
    expect(invalid.status).toBe(422);
    const invalidBody = (await invalid.json()) as { error: { code: string; details: { issues: string[] } } };
    expect(invalidBody.error.code).toBe('VALIDATION_FAILED');
    expect(invalidBody.error.details.issues.join(' ')).toContain('baseCurrency');
  });

  it('versions source→account mappings, reuses one resolver for preview and commit, and audits every write', async () => {
    const created = await fetch(`${baseUrl}/api/setup/company`, {
      method: 'POST',
      headers: bearer(OWNER),
      body: JSON.stringify({
        companyName: 'HTTP Mapping Co',
        baseCurrency: 'USD',
        calendarKind: '12month',
        fiscalYear: 2026,
        entityCode: 'ENT-MAP',
        entityName: 'Mapping HQ',
      }),
    });
    expect(created.status).toBe(201);
    const { companyId } = (await created.json()) as { companyId: string };

    await db.transaction((tx) =>
      seedChartOfAccounts(tx, {
        companyId,
        accounts: [
          { code: '1000', name: 'Operating bank', type: 'asset', normalSide: 'debit', parentCode: null, isPostable: true, statementLineKey: 'bs.asset.cash', active: true },
          { code: '2000', name: 'Accounts payable', type: 'liability', normalSide: 'credit', parentCode: null, isPostable: true, statementLineKey: 'bs.liability.ap', active: true },
          { code: '4000', name: 'Service revenue', type: 'revenue', normalSide: 'credit', parentCode: null, isPostable: true, statementLineKey: 'pl.revenue.service', active: true },
        ],
      }),
    );

    const journal = [
      'entry_ref,date,account_code,description,debit,credit',
      'JE-MAP-1,2026-01-15,BANK-EXT,Client receipt,600.00,',
      'JE-MAP-1,2026-01-15,2000,Client receipt offset,,600.00',
    ].join('\n');
    const path = `/api/companies/${companyId}`;

    const before = await fetch(`${baseUrl}${path}/import/preview`, {
      method: 'POST',
      headers: bearer(OWNER),
      body: JSON.stringify({ csvText: journal }),
    });
    expect(before.status).toBe(200);
    const beforeReport = (await before.json()) as {
      importedCount: number;
      quarantinedCount: number;
      quarantined: Array<{ reason: string }>;
    };
    expect(beforeReport.importedCount).toBe(0);
    expect(beforeReport.quarantinedCount).toBe(2);
    expect(beforeReport.quarantined.map((row) => row.reason)).toContain('UNMAPPED_ACCOUNT:BANK-EXT');

    const firstCommit = await fetch(`${baseUrl}${path}/import/commit`, {
      method: 'POST',
      headers: bearer(OWNER),
      body: JSON.stringify({ kind: 'actuals', sourceFilename: 'map-before.csv', csvText: journal }),
    });
    expect(firstCommit.status).toBe(201);
    expect(((await firstCommit.json()) as { importedCount: number }).importedCount).toBe(0);

    const anonymous = await fetch(`${baseUrl}${path}/coa-mapping`);
    expect(anonymous.status).toBe(401);
    expect(((await anonymous.json()) as { error: { code: string } }).error.code).toBe('SESSION_REQUIRED');
    const foreign = await fetch(`${baseUrl}${path}/coa-mapping`, { headers: bearer(INTRUDER) });
    expect(foreign.status).toBe(403);
    expect(((await foreign.json()) as { error: { code: string } }).error.code).toBe('TENANT_FORBIDDEN');

    const reportResponse = await fetch(`${baseUrl}${path}/coa-mapping`, { headers: bearer(OWNER) });
    expect(reportResponse.status).toBe(200);
    const initialReport = CoaMappingReportSchema.parse(await reportResponse.json());
    expect(initialReport.mappings.map((entry) => entry.sourceCode).sort()).toEqual(['2000', 'BANK-EXT']);
    expect(initialReport.mappings.find((entry) => entry.sourceCode === 'BANK-EXT')).toMatchObject({
      status: 'unmapped',
      mappingVersion: 0,
      rowCount: 1,
    });

    const badTarget = await fetch(`${baseUrl}${path}/coa-mapping/commit`, {
      method: 'POST',
      headers: bearer(OWNER),
      body: JSON.stringify({
        entries: [{ sourceCode: 'BANK-EXT', status: 'mapped', accountCode: '9999', quarantineReason: null }],
      }),
    });
    expect(badTarget.status).toBe(422);
    expect(((await badTarget.json()) as { error: { details: { issues: string[] } } }).error.details.issues)
      .toContain('row 1: UNKNOWN_ACCOUNT:9999');

    const badStatus = await fetch(`${baseUrl}${path}/coa-mapping/commit`, {
      method: 'POST',
      headers: bearer(OWNER),
      body: JSON.stringify({
        entries: [{ sourceCode: 'BANK-EXT', status: 'quarantined', accountCode: '1000', quarantineReason: 'MANUAL_QUARANTINE' }],
      }),
    });
    expect(badStatus.status).toBe(422);
    expect(((await badStatus.json()) as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');

    const commitMapping = async (entries: readonly Record<string, unknown>[]) => {
      const res = await fetch(`${baseUrl}${path}/coa-mapping/commit`, {
        method: 'POST',
        headers: bearer(OWNER),
        body: JSON.stringify({ entries }),
      });
      expect(res.status).toBe(201);
      return (await res.json()) as {
        written: number;
        unchanged: number;
        effectiveFrom: string;
        report: typeof initialReport;
      };
    };

    const firstMapping = await commitMapping([
      { sourceCode: 'BANK-EXT', status: 'mapped', accountCode: '1000', quarantineReason: null },
    ]);
    expect([firstMapping.written, firstMapping.unchanged]).toEqual([1, 0]);
    expect(firstMapping.report.mappings.find((entry) => entry.sourceCode === 'BANK-EXT')).toMatchObject({
      status: 'mapped',
      accountCode: '1000',
      mappingVersion: 1,
      effectiveFrom: firstMapping.effectiveFrom,
    });

    const replay = await commitMapping([
      { sourceCode: 'BANK-EXT', status: 'mapped', accountCode: '1000', quarantineReason: null },
    ]);
    expect([replay.written, replay.unchanged]).toEqual([0, 1]);
    expect(replay.report.mappings.find((entry) => entry.sourceCode === 'BANK-EXT')?.mappingVersion).toBe(1);

    // A future-dated row cannot change the effective mapping for today's preview or commit.
    await db.query(
      `INSERT INTO coa_mapping (
         company_id, source_system, source_code, account_id, mapping_version, effective_from, status
       )
       SELECT $1, 'csv', 'BANK-EXT', a.id, 9, '2027-01-01', 'mapped'
         FROM account a WHERE a.company_id = $1 AND a.code = '1000'`,
      [companyId],
    );
    const asOf = await fetch(`${baseUrl}${path}/coa-mapping?asOfDate=${firstMapping.effectiveFrom}`, {
      headers: bearer(OWNER),
    });
    const asOfReport = CoaMappingReportSchema.parse(await asOf.json());
    expect(asOfReport.mappings.find((entry) => entry.sourceCode === 'BANK-EXT')?.mappingVersion).toBe(1);

    const after = await fetch(`${baseUrl}${path}/import/preview`, {
      method: 'POST',
      headers: bearer(OWNER),
      body: JSON.stringify({ csvText: journal, asOfDate: firstMapping.effectiveFrom }),
    });
    const afterReport = (await after.json()) as {
      importedCount: number;
      quarantinedCount: number;
      totalDebits: string;
    };
    expect(afterReport.importedCount).toBe(2);
    expect(afterReport.quarantinedCount).toBe(0);
    expect(afterReport.totalDebits).toBe('600.00');

    const afterCommit = await fetch(`${baseUrl}${path}/import/commit`, {
      method: 'POST',
      headers: bearer(OWNER),
      body: JSON.stringify({ kind: 'actuals', sourceFilename: 'map-after.csv', csvText: journal }),
    });
    expect(afterCommit.status).toBe(201);
    expect(await afterCommit.json()).toMatchObject({
      importedCount: afterReport.importedCount,
      quarantinedCount: afterReport.quarantinedCount,
      totalDebits: afterReport.totalDebits,
    });

    const quarantineJournal = [
      'entry_ref,date,account_code,description,debit,credit',
      'JE-MAP-2,2026-02-15,ODD-SRC,Manual hold,300.00,',
      'JE-MAP-2,2026-02-15,2000,Manual hold offset,,300.00',
    ].join('\n');
    const discover = await fetch(`${baseUrl}${path}/import/commit`, {
      method: 'POST',
      headers: bearer(OWNER),
      body: JSON.stringify({ kind: 'actuals', sourceFilename: 'map-quarantine.csv', csvText: quarantineJournal }),
    });
    expect(discover.status).toBe(201);
    const quarantinedMapping = await commitMapping([
      { sourceCode: 'ODD-SRC', status: 'quarantined', accountCode: null, quarantineReason: 'MANUAL_QUARANTINE' },
    ]);
    expect(quarantinedMapping.written).toBe(1);
    expect(quarantinedMapping.report.mappings.find((entry) => entry.sourceCode === 'ODD-SRC')).toMatchObject({
      status: 'quarantined',
      quarantineReason: 'MANUAL_QUARANTINE',
      accountCode: null,
      mappingVersion: 1,
    });

    const held = await fetch(`${baseUrl}${path}/import/commit`, {
      method: 'POST',
      headers: bearer(OWNER),
      body: JSON.stringify({ kind: 'actuals', sourceFilename: 'map-held.csv', csvText: quarantineJournal }),
    });
    expect(held.status).toBe(201);
    expect(((await held.json()) as { quarantined: Array<{ reason: string }> }).quarantined.map((row) => row.reason))
      .toContain('QUARANTINED_BY_MAPPING:MANUAL_QUARANTINE');

    const auditRows = await db.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE company_id = $1 AND action = 'coa_mapping.commit'`,
      [companyId],
    );
    expect(auditRows.rows).toHaveLength(3);
    const chain = await verifyCompanyAuditLog(db, companyId);
    expect(chain.valid).toBe(true);
    // company.create + 4 import commits + 3 mapping commits (including the no-op replay).
    expect(chain.checkedCount).toBe(8);
  });

  it('surfaces a failed readiness probe as a typed 500 once the database handle is closed', async () => {
    const probeDb = await openSandboxDatabase();
    await applyMigrations(probeDb);
    const started = await listen(
      createSpineApp({
        db: probeDb,
        verifier: createSandboxTokenVerifier({ secret: SECRET }),
        sandboxSecret: null,
      }),
    );
    try {
      const healthy = await fetch(`${started.baseUrl}/readyz`);
      expect(healthy.status).toBe(200);

      await probeDb.close();

      const broken = await fetch(`${started.baseUrl}/readyz`);
      expect(broken.status).toBe(500);
      const body = (await broken.json()) as { error: { code: string; details: Record<string, unknown> } };
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.details['dependency']).toBe('database');
    } finally {
      await new Promise<void>((resolve) => started.server.close(() => resolve()));
    }
  });

  it('computes fiscal calendar preview via /core/calendar including the NRF 2028 53-week year', async () => {
    const res = await fetch(`${baseUrl}/api/calendar/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: '454', startYear: 2028, yearCount: 1, week53Rule: 'nrf4day' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { years: Array<{ weekCount: number; periods: unknown[] }> };
    expect(body.years[0]?.weekCount).toBe(53);
    expect(body.years[0]?.periods.length).toBe(12);

    const bad = await fetch(`${baseUrl}/api/calendar/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'invalid_kind', startYear: 1990 }),
    });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('previews a messy CSV import with stringified money totals and quarantined rows', async () => {
    const csvText =
      'entry_ref,date,account_code,description,debit,credit\nJE-1,2026-01-10,001200,Stock,100.00,\nJE-1,2026-01-10,9999,Unmapped,,100.00\n';
    const res = await fetch(`${baseUrl}/api/import/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ csvText, locale: 'unknown', knownAccountCodes: ['001200', '2000'] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rowsIn: number;
      importedCount: number;
      quarantinedCount: number;
      totalDebits: string;
      totalCredits: string;
      quarantined: Array<{ reason: string }>;
    };
    expect(body.rowsIn).toBe(2);
    expect(body.importedCount).toBe(1);
    expect(body.quarantinedCount).toBe(1);
    expect(body.totalDebits).toBe('100.00');
    expect(body.totalCredits).toBe('0.00');
    expect(body.quarantined[0]?.reason).toContain('UNMAPPED_ACCOUNT');
  });

  it('keeps the unknown-API-route fallback typed and free of secrets or stack traces', async () => {
    const missing = await fetch(`${baseUrl}/api/nonexistent-route`);
    expect(missing.status).toBe(404);
    const text = await missing.text();
    expect(JSON.parse(text)).toEqual({
      error: expect.objectContaining({ code: 'NOT_FOUND', httpStatus: 404 }),
    });
    expect(text).not.toContain('at ');
    expect(text).not.toContain('SECRET');
  });

  it('commits an import over HTTP and serves the trial balance and drill-down from it', async () => {
    const create = await fetch(`${baseUrl}/api/setup/company`, {
      method: 'POST',
      headers: bearer(OWNER),
      body: JSON.stringify({
        companyName: 'HTTP Import Co',
        baseCurrency: 'USD',
        calendarKind: '12month',
        fiscalYear: 2026,
        entityCode: 'ENT-HTTP',
        entityName: 'HTTP Import Co HQ',
      }),
    });
    expect(create.status).toBe(201);
    const { companyId } = (await create.json()) as { companyId: string };

    // Chart of accounts arrives through the setup path (CoA import screen); seeded here directly.
    await db.transaction((tx) =>
      seedChartOfAccounts(tx, {
        companyId,
        accounts: [
          { code: '001200', name: 'Inventory', type: 'asset', normalSide: 'debit', parentCode: null, isPostable: true, statementLineKey: 'bs.asset.inventory', active: true },
          { code: '2000', name: 'Accounts Payable', type: 'liability', normalSide: 'credit', parentCode: null, isPostable: true, statementLineKey: 'bs.liability.ap', active: true },
        ],
      }),
    );

    const commit = await fetch(`${baseUrl}/api/companies/${companyId}/import/commit`, {
      method: 'POST',
      headers: bearer(OWNER),
      body: JSON.stringify({ kind: 'actuals', sourceFilename: 'erp_mixed_gl.csv', csvText: MESSY_CSV }),
    });
    expect(commit.status).toBe(201);
    const committed = (await commit.json()) as {
      batchId: string;
      rowsIn: number;
      importedCount: number;
      quarantinedCount: number;
      totalDebits: string;
      totalCredits: string;
      sourceHash: string;
      replacedBatchId: string | null;
      quarantined: Array<{ rowNo: number; reason: string }>;
    };
    expect(committed.rowsIn).toBe(11);
    expect(committed.importedCount).toBe(2);
    expect(committed.quarantinedCount).toBe(9);
    expect(committed.totalDebits).toBe('2500.00');
    expect(committed.totalCredits).toBe('2500.00');
    expect(committed.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(committed.replacedBatchId).toBeNull();
    expect(committed.quarantined.every((row) => row.reason.length > 0)).toBe(true);

    const tbResponse = await fetch(`${baseUrl}/api/companies/${companyId}/trial-balance`, {
      headers: bearer(OWNER),
    });
    expect(tbResponse.status).toBe(200);
    const tb = (await tbResponse.json()) as {
      totalDebit: string;
      totalCredit: string;
      isBalanced: boolean;
      sources: Array<{ batchId: string; sourceFilename: string }>;
      rows: Array<{ code: string; totalDebit: string; totalCredit: string }>;
    };
    expect(tb.isBalanced).toBe(true);
    expect(tb.totalDebit).toBe('2500.00');
    expect(tb.totalCredit).toBe('2500.00');
    expect(tb.sources).toEqual([expect.objectContaining({ batchId: committed.batchId, sourceFilename: 'erp_mixed_gl.csv' })]);
    expect(tb.rows.map((row) => row.code)).toEqual(['001200', '2000']);

    const drillResponse = await fetch(
      `${baseUrl}/api/companies/${companyId}/accounts/001200/drill?period=P01`,
      { headers: bearer(OWNER) },
    );
    expect(drillResponse.status).toBe(200);
    const drill = (await drillResponse.json()) as {
      accountCode: string;
      throughPeriodCode: string | null;
      totalDebit: string;
      rows: Array<{ rowNo: number; sourceFilename: string; rawCells: string[]; debit: string }>;
    };
    expect(drill.accountCode).toBe('001200');
    expect(drill.throughPeriodCode).toBe('P01');
    expect(drill.totalDebit).toBe('2500.00');
    expect(drill.rows.length).toBeGreaterThan(0);
    expect(drill.rows[0]?.sourceFilename).toBe('erp_mixed_gl.csv');
    expect(drill.rows[0]?.rawCells.length).toBeGreaterThanOrEqual(6);
  }, 120_000);

  it('rejects foreign-tenant, unauthenticated, oversized, and malformed import commits without writing', async () => {
    const bootstrap = await fetch(`${baseUrl}/api/session/workspace`, { headers: bearer(OWNER) });
    const ownerBody = (await bootstrap.json()) as { companies: Array<{ id: string }> };
    const companyId = ownerBody.companies[0]?.id ?? '';
    expect(companyId).not.toBe('');

    const payload = JSON.stringify({ kind: 'actuals', sourceFilename: 'x.csv', csvText: MESSY_CSV });
    const batchesBefore = await countBatches(companyId);

    const unauthenticated = await fetch(`${baseUrl}/api/companies/${companyId}/import/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    });
    expect(unauthenticated.status).toBe(401);
    expect(((await unauthenticated.json()) as { error: { code: string } }).error.code).toBe('SESSION_REQUIRED');

    const foreign = await fetch(`${baseUrl}/api/companies/${companyId}/import/commit`, {
      method: 'POST',
      headers: bearer(INTRUDER),
      body: payload,
    });
    expect(foreign.status).toBe(403);
    expect(((await foreign.json()) as { error: { code: string } }).error.code).toBe('TENANT_FORBIDDEN');

    const oversized = await fetch(`${baseUrl}/api/companies/${companyId}/import/commit`, {
      method: 'POST',
      headers: bearer(OWNER),
      body: JSON.stringify({ kind: 'actuals', sourceFilename: 'big.csv', csvText: 'x'.repeat(5_000_001) }),
    });
    expect(oversized.status).toBe(413);
    expect(((await oversized.json()) as { error: { code: string } }).error.code).toBe('IMPORT_FILE_TOO_LARGE');

    const beyondParserLimit = await fetch(`${baseUrl}/api/companies/${companyId}/import/commit`, {
      method: 'POST',
      headers: bearer(OWNER),
      body: JSON.stringify({ kind: 'actuals', sourceFilename: 'huge.csv', csvText: 'x'.repeat(7_000_000) }),
    });
    expect(beyondParserLimit.status).toBe(413);
    expect(((await beyondParserLimit.json()) as { error: { code: string } }).error.code).toBe('IMPORT_FILE_TOO_LARGE');

    const malformed = await fetch(`${baseUrl}/api/companies/${companyId}/import/commit`, {
      method: 'POST',
      headers: bearer(OWNER),
      body: '{not json',
    });
    expect(malformed.status).toBe(422);
    expect(((await malformed.json()) as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');

    const unknownPeriod = await fetch(
      `${baseUrl}/api/companies/${companyId}/trial-balance?period=P99`,
      { headers: bearer(OWNER) },
    );
    expect(unknownPeriod.status).toBe(422);
    expect(((await unknownPeriod.json()) as { error: { code: string } }).error.code).toBe('PERIOD_NOT_FOUND');

    // Not one rejected request wrote a batch (§8.7: a failure must leave no partial state).
    expect(await countBatches(companyId)).toBe(batchesBefore);
  }, 120_000);

  it('serves year-to-date statements and rejects a statements request without a period', async () => {
    const create = await fetch(`${baseUrl}/api/setup/company`, {
      method: 'POST',
      headers: bearer(OWNER),
      body: JSON.stringify({
        companyName: 'HTTP Statements Co',
        baseCurrency: 'USD',
        calendarKind: '12month',
        fiscalYear: 2026,
        entityCode: 'ENT-STMT',
        entityName: 'HTTP Statements Co HQ',
      }),
    });
    expect(create.status).toBe(201);
    const { companyId } = (await create.json()) as { companyId: string };

    await db.transaction((tx) =>
      seedChartOfAccounts(tx, {
        companyId,
        accounts: [
          { code: '1000', name: 'Cash', type: 'asset', normalSide: 'debit', parentCode: null, isPostable: true, statementLineKey: 'bs.asset.cash', active: true },
          { code: '4000', name: 'Service Revenue', type: 'revenue', normalSide: 'credit', parentCode: null, isPostable: true, statementLineKey: 'pl.revenue.service', active: true },
        ],
      }),
    );

    const commit = await fetch(`${baseUrl}/api/companies/${companyId}/import/commit`, {
      method: 'POST',
      headers: bearer(OWNER),
      body: JSON.stringify({
        kind: 'actuals',
        sourceFilename: 'cash_sale.csv',
        csvText: [
          'entry_ref,date,account_code,description,debit,credit',
          'JE-S1,2026-03-10,1000,Cash received,1000.00,0.00',
          'JE-S1,2026-03-10,4000,Service revenue,0.00,1000.00',
        ].join('\n'),
      }),
    });
    expect(commit.status).toBe(201);

    const missingPeriod = await fetch(`${baseUrl}/api/companies/${companyId}/statements`, {
      headers: bearer(OWNER),
    });
    expect(missingPeriod.status).toBe(422);
    expect(((await missingPeriod.json()) as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');

    const foreign = await fetch(`${baseUrl}/api/companies/${companyId}/statements?period=P03`, {
      headers: bearer(INTRUDER),
    });
    expect(foreign.status).toBe(403);
    expect(((await foreign.json()) as { error: { code: string } }).error.code).toBe('TENANT_FORBIDDEN');

    const statementsResponse = await fetch(
      `${baseUrl}/api/companies/${companyId}/statements?period=P03`,
      { headers: bearer(OWNER) },
    );
    expect(statementsResponse.status).toBe(200);
    const statements = (await statementsResponse.json()) as {
      range: { fromPeriodCode: string; throughPeriodCode: string; fiscalYear: number };
      pnl: { revenue: string; netIncome: string };
      balanceSheet: { isBalanced: boolean; totalAssets: string; totalEquity: string };
      cashFlow: { endingCash: string };
      retainedEarnings: { opening: string; closingTotal: string; rollForwardValid: boolean };
      articulation: { valid: boolean; checks: Array<{ id: string; passed: boolean }> };
    };
    // Year-to-date: the range always opens at the fiscal year's first period.
    expect(statements.range).toEqual({ fromPeriodCode: 'P01', throughPeriodCode: 'P03', fiscalYear: 2026 });
    expect(statements.pnl.revenue).toBe('1000.00');
    expect(statements.pnl.netIncome).toBe('1000.00');
    expect(statements.balanceSheet.isBalanced).toBe(true);
    expect(statements.balanceSheet.totalAssets).toBe('1000.00');
    expect(statements.balanceSheet.totalEquity).toBe('1000.00');
    expect(statements.cashFlow.endingCash).toBe('1000.00');
    expect(statements.retainedEarnings.opening).toBe('0.00');
    expect(statements.retainedEarnings.closingTotal).toBe('1000.00');
    expect(statements.retainedEarnings.rollForwardValid).toBe(true);
    expect(statements.articulation.valid).toBe(true);
    expect(statements.articulation.checks.map((check) => check.id)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5']);
  }, 120_000);

  it('drives the real spine API through the browser API client (sign-in, workspace, setup)', async () => {
    const anonymous = createApiClient({ getToken: () => null, baseUrl });
    let noSession: unknown = null;
    try {
      await anonymous.getSessionWorkspace();
    } catch (error) {
      noSession = error;
    }
    expect(noSession).toBeInstanceOf(ApiClientError);
    expect((noSession as ApiClientError).code).toBe('SESSION_REQUIRED');

    // Real sign-in against the mounted route: the client mints a token the server itself verifies.
    const minted = await anonymous.signInSandboxToken({
      email: 'client-flow@onefpa.test',
      displayName: 'Client Flow',
    });
    expect(minted.tokenType).toBe('sandbox-hmac');
    expect(minted.token.length).toBeGreaterThan(20);

    const authed = createApiClient({ getToken: () => minted.token, baseUrl });
    const session = await authed.getSessionWorkspace();
    expect(session.authenticated).toBe(true);
    expect(session.identity.email).toBe('client-flow@onefpa.test');
    expect(session.companies).toEqual([]);
    expect(session.workspace).toBeNull();

    const workspace = await authed.createCompany({
      companyName: 'Client Flow Co',
      baseCurrency: 'USD',
      calendarKind: '12month',
      fiscalYear: 2026,
      entityCode: 'ENT-CLIENT',
      entityName: 'Client Flow Co HQ',
    });
    expect(workspace.companyName).toBe('Client Flow Co');
    expect(workspace.currencyScale).toBe(2);
    expect(workspace.periods).toHaveLength(12);
    expect(workspace.periods[0]?.code).toBe('P01');
    expect(workspace.entities[0]?.code).toBe('ENT-CLIENT');

    const reread = await authed.getCompanyWorkspace(workspace.companyId);
    expect(reread.companyId).toBe(workspace.companyId);

    // The same client, holding somebody else's token, gets the typed tenant error, not data.
    const intruderClient = createApiClient({
      getToken: () => issueSandboxToken({ identity: INTRUDER, secret: SECRET, ttlMs: 60_000 }),
      baseUrl,
    });
    let forbidden: unknown = null;
    try {
      await intruderClient.getCompanyWorkspace(workspace.companyId);
    } catch (error) {
      forbidden = error;
    }
    expect(forbidden).toBeInstanceOf(ApiClientError);
    expect((forbidden as ApiClientError).code).toBe('TENANT_FORBIDDEN');
    expect((forbidden as ApiClientError).httpStatus).toBe(403);

    const afterSignIn = await authed.getSessionWorkspace();
    expect(afterSignIn.companies.map((company) => company.name)).toEqual(['Client Flow Co']);
  }, 120_000);

  it('refuses a budget commit instead of posting it into actuals, and leaves every table untouched', async () => {
    const minted = await createApiClient({ getToken: () => null, baseUrl }).signInSandboxToken({
      email: 'client-budget@onefpa.test',
      displayName: 'Client Budget',
    });
    const client = createApiClient({ getToken: () => minted.token, baseUrl });
    const workspace = await client.createCompany({
      companyName: 'Budget Guard Co',
      baseCurrency: 'USD',
      calendarKind: '12month',
      fiscalYear: 2026,
      entityCode: 'ENT-BG',
      entityName: 'Budget Guard Co HQ',
    });
    await client.importChart(workspace.companyId, {
      csvText: [
        'code,name,type,normal_side,statement_line_key',
        '1000,Cash,asset,debit,bs.asset.cash',
        '4000,Service revenue,revenue,credit,pl.revenue.service',
      ].join('\n'),
    });

    const csv = [
      'entry_ref,date,account_code,description,debit,credit',
      'JE-B1,2026-05-10,1000,Budgeted cash,100.00,0.00',
      'JE-B1,2026-05-10,4000,Budgeted revenue,0.00,100.00',
    ].join('\n');

    const batchesBefore = await countBatches(workspace.companyId);
    let rejected: unknown = null;
    try {
      await client.commitImport(workspace.companyId, {
        kind: 'budget',
        sourceFilename: 'budget_2026.csv',
        csvText: csv,
      });
    } catch (error) {
      rejected = error;
    }
    expect(rejected).toBeInstanceOf(ApiClientError);
    expect((rejected as ApiClientError).code).toBe('VALIDATION_FAILED');
    expect((rejected as ApiClientError).details['supportedKinds']).toEqual(['actuals']);

    // Nothing was written and no budget number can leak into actuals.
    expect(await countBatches(workspace.companyId)).toBe(batchesBefore);
    const grid = await client.getTrialBalance(workspace.companyId, { period: 'P05' });
    expect(grid.totalDebit).toBe('0.00');
    expect(grid.totalCredit).toBe('0.00');
    expect(grid.sources).toEqual([]);

    // The same rows committed as actuals still post, so the guard is about kind, not content.
    const actual = await client.commitImport(workspace.companyId, {
      kind: 'actuals',
      sourceFilename: 'budget_2026.csv',
      csvText: csv,
    });
    expect(actual.importedCount).toBe(2);
    const after = await client.getTrialBalance(workspace.companyId, { period: 'P05' });
    expect(after.totalDebit).toBe('100.00');
  }, 120_000);

  it('imports a chart of accounts atomically, then posts an import against it', async () => {
    const minted = await createApiClient({ getToken: () => null, baseUrl }).signInSandboxToken({
      email: 'client-chart@onefpa.test',
      displayName: 'Client Chart',
    });
    const client = createApiClient({ getToken: () => minted.token, baseUrl });
    const workspace = await client.createCompany({
      companyName: 'Chart Co',
      baseCurrency: 'USD',
      calendarKind: '12month',
      fiscalYear: 2026,
      entityCode: 'ENT-CHART',
      entityName: 'Chart Co HQ',
    });

    // A brand-new company has NO chart, so every import row would quarantine as unmapped.
    const before = await client.getChart(workspace.companyId);
    expect(before.accounts).toEqual([]);

    const chartCsv = [
      'code,name,type,normal_side,statement_line_key,parent_code,is_postable',
      '1000,Cash,asset,debit,bs.asset.cash,,true',
      '001200,Operating bank account,asset,debit,bs.asset.cash,1000,true',
      '4000,Service revenue,revenue,credit,pl.revenue.service,,true',
    ].join('\n');
    const importedChart = await client.importChart(workspace.companyId, { csvText: chartCsv });
    expect(importedChart.rowCount).toBe(3);
    expect(importedChart.inserted).toBe(3);
    expect(importedChart.updated).toBe(0);
    expect(importedChart.accounts.map((account) => account.code)).toEqual(['001200', '1000', '4000']);
    expect(importedChart.accounts[0]?.parentCode).toBe('1000');

    // Re-importing the SAME chart updates in place and duplicates nothing.
    const reimported = await client.importChart(workspace.companyId, { csvText: chartCsv });
    expect(reimported.inserted).toBe(0);
    expect(reimported.updated).toBe(3);
    expect(reimported.accounts).toHaveLength(3);
    expect(reimported.accounts.find((account) => account.code === '1000')?.version).toBe(2);

    // A chart with one invalid row is rejected WHOLE: nothing is written.
    const rejected = await client
      .importChart(workspace.companyId, {
        csvText: [
          'code,name,type,normal_side,statement_line_key',
          '5000,Cost of goods sold,expense,debit,pl.cogs.direct',
          '6000,Broken,bank,debit,pl.opex.other',
        ].join('\n'),
      })
      .then(() => null)
      .catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(ApiClientError);
    expect((rejected as ApiClientError).code).toBe('VALIDATION_FAILED');
    expect((rejected as ApiClientError).details['issues']).toEqual(['row 3: INVALID_TYPE:bank']);
    const afterReject = await client.getChart(workspace.companyId);
    expect(afterReject.accounts).toHaveLength(3);

    // Now the import can post: the same CSV that would have quarantined everything posts.
    const journal = [
      'entry_ref,date,account_code,description,debit,credit',
      'JE-CH1,2026-04-10,001200,Cash received,750.25,0.00',
      'JE-CH1,2026-04-10,4000,Service revenue,0.00,750.25',
    ].join('\n');
    const preview = await client.previewImport(workspace.companyId, { csvText: journal });
    expect(preview.importedCount).toBe(2);
    expect(preview.quarantinedCount).toBe(0);
    const committed = await client.commitImport(workspace.companyId, {
      kind: 'actuals',
      sourceFilename: 'chart_co.csv',
      csvText: journal,
    });
    expect(committed.importedCount).toBe(2);
    expect(committed.totalDebits).toBe('750.25');

    const grid = await client.getTrialBalance(workspace.companyId, { period: 'P04' });
    expect(grid.totalDebit).toBe('750.25');
    expect(grid.totalCredit).toBe('750.25');
    const revenueRow = grid.rows.find((row) => row.code === '4000');
    expect(revenueRow?.naturalActivity).toBe('750.25');

    // Every write is chained (§3.4, G10): company.create + chart.import ×2 + import.commit.
    const chain = await verifyCompanyAuditLog(db, workspace.companyId);
    expect(chain.valid).toBe(true);
    expect(chain.checkedCount).toBe(4);

    // Cross-tenant: another identity cannot read or write this company's chart.
    await expect(
      createApiClient({
        getToken: () => issueSandboxToken({ identity: INTRUDER, secret: SECRET, ttlMs: 60_000 }),
        baseUrl,
      }).getChart(workspace.companyId),
    ).rejects.toMatchObject({ code: 'TENANT_FORBIDDEN' });
  }, 120_000);

  it('stores a budget as a plan version without touching the GL, and versions it on re-import', async () => {
    const minted = await createApiClient({ getToken: () => null, baseUrl }).signInSandboxToken({
      email: 'client-budget@onefpa.test',
      displayName: 'Client Budget',
    });
    const client = createApiClient({ getToken: () => minted.token, baseUrl });
    const workspace = await client.createCompany({
      companyName: 'Budget Co',
      baseCurrency: 'USD',
      calendarKind: '12month',
      fiscalYear: 2026,
      entityCode: 'ENT-BUDGET',
      entityName: 'Budget Co HQ',
    });
    await db.transaction((tx) =>
      seedChartOfAccounts(tx, {
        companyId: workspace.companyId,
        accounts: [
          { code: '1000', name: 'Cash', type: 'asset', normalSide: 'debit', parentCode: null, isPostable: true, statementLineKey: 'bs.asset.cash', active: true },
          { code: '4000', name: 'Service Revenue', type: 'revenue', normalSide: 'credit', parentCode: null, isPostable: true, statementLineKey: 'pl.revenue.service', active: true },
          { code: '5000', name: 'Salaries', type: 'expense', normalSide: 'debit', parentCode: null, isPostable: true, statementLineKey: 'pl.opex.payroll', active: true },
          { code: '6000', name: 'Software', type: 'expense', normalSide: 'debit', parentCode: null, isPostable: true, statementLineKey: 'pl.opex.other', active: true },
        ],
      }),
    );

    // No budget yet: an honest empty report, never an invented all-zero plan, and a BvA that says
    // plainly there is no plan instead of comparing against a fabricated zero.
    const bvaBeforeAnyData = await client.getBva(workspace.companyId, { period: 'P04' });
    expect(bvaBeforeAnyData.hasPlan).toBe(false);
    expect(bvaBeforeAnyData.scenarioId).toBeNull();
    expect(bvaBeforeAnyData.rows).toEqual([]);

    // No budget yet: an honest empty report, never an invented all-zero plan.
    const empty = await client.getBudget(workspace.companyId, { fiscalYear: 2026 });
    expect(empty.scenarioId).toBeNull();
    expect(empty.planVersionId).toBeNull();
    expect(empty.versionNo).toBeNull();
    expect(empty.lineCount).toBe(0);
    expect(empty.lines).toEqual([]);

    const budgetCsv = [
      'account_code,period,amount',
      '4000,P01,12500.00',
      '4000,P02,12500.00',
      '4000,P03,13000.00',
      '5000,P01,4200.00',
      '5000,P02,4200.00',
      '5000,P03,4400.00',
      '6000,P01,1800.00',
      '6000,P02,1800.00',
      '6000,P03,1900.00',
    ].join('\n');

    const imported = await client.importBudget(workspace.companyId, {
      csvText: budgetCsv,
      fiscalYear: 2026,
      sourceFilename: 'fy2026-budget.csv',
    });
    expect(imported.rowCount).toBe(9);
    expect(imported.lineCount).toBe(9);
    expect(imported.versionNo).toBe(1);
    expect(imported.scenarioName).toBe('Budget FY2026');
    expect(imported.totalAmount).toBe('56300.00');
    expect(imported.accounts.map((account) => `${account.accountCode}=${account.amount}`)).toEqual([
      '4000=38000.00',
      '5000=12800.00',
      '6000=5500.00',
    ]);

    // A budget is NOT an actual: the trial balance stays empty.
    const afterBudget = await client.getTrialBalance(workspace.companyId);
    expect(afterBudget.totalDebit).toBe('0.00');
    expect(afterBudget.totalCredit).toBe('0.00');
    expect(afterBudget.rows.every((row) => row.naturalActivity === '0.00')).toBe(true);

    // Re-importing the same plan creates version 2 and duplicates no plan line.
    const reimported = await client.importBudget(workspace.companyId, {
      csvText: budgetCsv,
      fiscalYear: 2026,
      sourceFilename: 'fy2026-budget.csv',
    });
    expect(reimported.versionNo).toBe(2);
    expect(reimported.lineCount).toBe(9);
    expect(reimported.totalAmount).toBe('56300.00');
    const planRows = await db.query<{ total: number; versions: number; current: number }>(
      `SELECT (SELECT COUNT(*)::int FROM plan_line WHERE company_id = $1) AS total,
              (SELECT COUNT(*)::int FROM plan_version WHERE company_id = $1) AS versions,
              (SELECT COUNT(*)::int FROM plan_version WHERE company_id = $1 AND is_current) AS current`,
      [workspace.companyId],
    );
    expect(planRows.rows[0]).toEqual({ total: 18, versions: 2, current: 1 });

    // A plan line for an account that does not exist is rejected with a named reason, and writes nothing.
    const unmapped = await client
      .importBudget(workspace.companyId, {
        csvText: ['account_code,period,amount', '9999,P01,100.00'].join('\n'),
        fiscalYear: 2026,
      })
      .then(() => null)
      .catch((error: unknown) => error);
    expect(unmapped).toBeInstanceOf(ApiClientError);
    expect((unmapped as ApiClientError).code).toBe('VALIDATION_FAILED');
    expect((unmapped as ApiClientError).details['issues']).toEqual(['row 2: UNMAPPED_ACCOUNT:9999']);

    // A period code outside the requested fiscal year is rejected the same way.
    const wrongYear = await client
      .importBudget(workspace.companyId, {
        csvText: ['account_code,period,amount', '4000,P01,100.00'].join('\n'),
        fiscalYear: 2030,
      })
      .then(() => null)
      .catch((error: unknown) => error);
    expect((wrongYear as ApiClientError).code).toBe('VALIDATION_FAILED');
    expect((wrongYear as ApiClientError).details['issues']).toEqual([
      'row 2: UNKNOWN_PERIOD:P01 (fiscal year 2030)',
    ]);

    const stillTwo = await client.getBudget(workspace.companyId, { fiscalYear: 2026 });
    expect(stillTwo.versionNo).toBe(2);
    expect(stillTwo.lineCount).toBe(9);

    // Actuals still post normally alongside the plan; the GL holds only the actual 750.25.
    const journal = [
      'entry_ref,date,account_code,description,debit,credit',
      'JE-B1,2026-04-10,1000,Cash received,750.25,0.00',
      'JE-B1,2026-04-10,4000,Service revenue,0.00,750.25',
    ].join('\n');
    const committed = await client.commitImport(workspace.companyId, {
      kind: 'actuals',
      sourceFilename: 'budget_co_actuals.csv',
      csvText: journal,
    });
    expect(committed.totalCredits).toBe('750.25');
    const gl = await client.getTrialBalance(workspace.companyId);
    expect(gl.totalDebit).toBe('750.25');
    expect(
      gl.rows
        .filter((row) => row.naturalActivity !== '0.00')
        .map((row) => `${row.code}=${row.naturalActivity}`),
    ).toEqual(['1000=750.25', '4000=750.25']);

    // BvA: plan year-to-date through P04 (all nine lines) against the actuals that exist.
    const bva = await client.getBva(workspace.companyId, { period: 'P04' });
    expect(bva.hasPlan).toBe(true);
    expect(bva.versionNo).toBe(2);
    expect(bva.throughPeriodCode).toBe('P04');

    const revenueRow = bva.rows.find((row) => row.accountCode === '4000');
    expect(revenueRow).toMatchObject({
      accountType: 'revenue',
      actual: '750.25',
      plan: '38000.00',
      varianceAmount: '-37249.75',
      favorability: 'unfavorable',
    });
    const salariesRow = bva.rows.find((row) => row.accountCode === '5000');
    expect(salariesRow).toMatchObject({
      actual: '0.00',
      plan: '12800.00',
      varianceAmount: '-12800.00',
      favorability: 'favorable',
    });
    // An account with actuals but no plan line is NOT compared against an invented zero plan.
    const cashRow = bva.rows.find((row) => row.accountCode === '1000');
    expect(cashRow).toMatchObject({
      actual: '750.25',
      plan: null,
      varianceAmount: null,
      variancePctKind: 'null',
      favorability: 'na',
    });
    expect(bva.totals).toMatchObject({
      actual: '1500.50',
      plan: '56300.00',
      unplannedActual: '750.25',
      varianceAmount: '-55549.75',
      plannedRows: 3,
      unplannedRows: 1,
      favorable: 2,
      unfavorable: 1,
      neutral: 0,
      na: 1,
    });

    // The earlier period only compares the plan months that have elapsed.
    const bvaP02 = await client.getBva(workspace.companyId, { period: 'P02' });
    expect(bvaP02.rows.find((row) => row.accountCode === '4000')).toMatchObject({
      actual: '0.00',
      plan: '25000.00',
      varianceAmount: '-25000.00',
    });

    // G5 tie-out: the BvA actual totals ARE the statement figures for every account type.
    const statements = await client.getStatements(workspace.companyId, { period: 'P04' });
    const revenueTotal = bva.byType.find((total) => total.accountType === 'revenue');
    const expenseTotal = bva.byType.find((total) => total.accountType === 'expense');
    expect(revenueTotal?.actual).toBe(statements.pnl.revenue);
    expect(revenueTotal?.plan).toBe('38000.00');
    expect(expenseTotal?.actual).toBe('0.00');
    expect(expenseTotal?.plan).toBe('18300.00');
    expect(statements.pnl.netIncome).toBe('750.25');

    // company.create + 2 × budget.import + import.commit; the two rejected budgets wrote nothing.
    const chain = await verifyCompanyAuditLog(db, workspace.companyId);
    expect(chain.valid).toBe(true);
    expect(chain.checkedCount).toBe(4);

    await expect(
      createApiClient({
        getToken: () => issueSandboxToken({ identity: INTRUDER, secret: SECRET, ttlMs: 60_000 }),
        baseUrl,
      }).getBudget(workspace.companyId, { fiscalYear: 2026 }),
    ).rejects.toMatchObject({ code: 'TENANT_FORBIDDEN' });
  }, 120_000);

  it('drives the import wizard and model grid contracts through the browser client against the real API', async () => {
    const minted = await createApiClient({ getToken: () => null, baseUrl }).signInSandboxToken({
      email: 'client-import@onefpa.test',
      displayName: 'Client Import',
    });
    const client = createApiClient({ getToken: () => minted.token, baseUrl });
    const workspace = await client.createCompany({
      companyName: 'Client Import Co',
      baseCurrency: 'USD',
      calendarKind: '12month',
      fiscalYear: 2026,
      entityCode: 'ENT-CIMP',
      entityName: 'Client Import Co HQ',
    });
    await db.transaction((tx) =>
      seedChartOfAccounts(tx, {
        companyId: workspace.companyId,
        accounts: [
          { code: '1000', name: 'Cash', type: 'asset', normalSide: 'debit', parentCode: null, isPostable: true, statementLineKey: 'bs.asset.cash', active: true },
          { code: '4000', name: 'Service Revenue', type: 'revenue', normalSide: 'credit', parentCode: null, isPostable: true, statementLineKey: 'pl.revenue.service', active: true },
        ],
      }),
    );

    const csv = [
      'entry_ref,date,account_code,description,debit,credit',
      'JE-C1,2026-02-10,1000,Cash received,1250.50,0.00',
      'JE-C1,2026-02-10,4000,Service revenue,0.00,1250.50',
      'JE-C2,2026-02-11,9999,Unmapped account,50.00,0.00',
      'JE-C2,2026-02-11,1000,Unmapped counter,0.00,50.00',
    ].join('\n');

    // The empty grid proves the company has no postings yet; the preview needs nothing from the
    // browser beyond the file text, because the server classifies against its own chart.
    const emptyGrid = await client.getTrialBalance(workspace.companyId);
    expect(emptyGrid.sources).toEqual([]);
    expect(emptyGrid.rows.map((row) => row.code)).toEqual(['1000', '4000']);

    const preview = await client.previewImport(workspace.companyId, { csvText: csv });
    expect(preview.rowsIn).toBe(4);
    expect(preview.importedCount).toBe(2);
    expect(preview.quarantinedCount).toBe(2);
    expect(preview.importedCount + preview.quarantinedCount).toBe(preview.rowsIn);
    expect(preview.entryCount).toBe(1);
    expect(preview.totalDebits).toBe('1250.50');
    expect(preview.totalCredits).toBe('1250.50');
    // The unmapped code is named, and the journal left half-posted is quarantined WHOLE.
    expect(preview.quarantined.map((row) => row.reason)).toEqual([
      'UNMAPPED_ACCOUNT:9999',
      'UNBALANCED_ENTRY:JE-C2',
    ]);
    // Preview and commit must agree: nothing was written by the preview.
    expect(await countBatches(workspace.companyId)).toBe(0);

    const committed = await client.commitImport(workspace.companyId, {
      kind: 'actuals',
      sourceFilename: 'client_import.csv',
      csvText: csv,
    });
    expect(committed.rowsIn).toBe(4);
    expect(committed.importedCount).toBe(2);
    expect(committed.quarantinedCount).toBe(2);
    expect(committed.entryCount).toBe(1);
    expect(committed.replacedBatchId).toBeNull();
    expect(committed.sourceHash).toMatch(/^[0-9a-f]{64}$/);

    const grid = await client.getTrialBalance(workspace.companyId, { period: 'P02' });
    expect(grid.isBalanced).toBe(true);
    expect(grid.totalDebit).toBe('1250.50');
    expect(grid.totalCredit).toBe('1250.50');
    expect(grid.sources).toEqual([
      expect.objectContaining({ batchId: committed.batchId, sourceFilename: 'client_import.csv' }),
    ]);
    const cashRow = grid.rows.find((row) => row.code === '1000');
    expect(cashRow?.totalDebit).toBe('1250.50');
    expect(cashRow?.naturalActivity).toBe('1250.50');

    const drill = await client.getAccountDrilldown(workspace.companyId, '1000', { period: 'P02' });
    // Σ of the contributing source rows must equal the grid row exactly (§9.4).
    expect(drill.totalDebit).toBe(cashRow?.totalDebit);
    expect(drill.totalCredit).toBe(cashRow?.totalCredit);
    expect(drill.rows).toHaveLength(1);
    expect(drill.rows[0]).toEqual(
      expect.objectContaining({
        sourceFilename: 'client_import.csv',
        periodCode: 'P02',
        rowNo: 2,
      }),
    );
    expect(drill.rows[0]?.rawCells.length).toBeGreaterThanOrEqual(6);

    // Re-committing the SAME source replaces atomically: one active batch, unchanged totals.
    const recommitted = await client.commitImport(workspace.companyId, {
      kind: 'actuals',
      sourceFilename: 'client_import.csv',
      csvText: csv,
    });
    expect(recommitted.replacedBatchId).toBe(committed.batchId);
    const afterReplace = await client.getTrialBalance(workspace.companyId, { period: 'P02' });
    expect(afterReplace.totalDebit).toBe('1250.50');
    expect(afterReplace.sources).toEqual([
      expect.objectContaining({ batchId: recommitted.batchId }),
    ]);
    expect(await countBatches(workspace.companyId)).toBe(2);

    // Board pack: the JSON preview and both exported artifacts must carry the SAME engine strings
    // (A6/U5/G7). The expectations below come from the hand-written journal above, not a renderer.
    const pack = await client.getBoardPack(workspace.companyId, { period: 'P02', fiscalYear: 2026 });
    expect(pack.companyName).toBe('Client Import Co');
    expect(pack.baseCurrency).toBe('USD');
    expect(pack.range).toEqual({ fromPeriodCode: 'P01', throughPeriodCode: 'P02', fiscalYear: 2026 });
    expect(pack.rows.find((row) => row.key === 'statement:pnl.revenue')?.value).toBe('1250.50');
    expect(pack.rows.find((row) => row.key === 'statement:cf.endingCash')?.value).toBe('1250.50');
    expect(pack.articulation.valid).toBe(true);
    expect(pack.sources.map((source) => source.sourceFilename)).toEqual(['client_import.csv']);

    const xlsxBlob = await client.downloadBoardPack(workspace.companyId, {
      period: 'P02',
      fiscalYear: 2026,
      format: 'xlsx',
    });
    const workbook = await loadWorkbook(new Uint8Array(await xlsxBlob.arrayBuffer()));
    const cells: string[] = [];
    for (const sheet of workbook.worksheets) {
      sheet.eachRow((row) => {
        const values = row === null ? [] : row.values;
        for (const cell of Array.isArray(values) ? values : Object.values(values)) {
          if (typeof cell === 'string') cells.push(cell);
        }
      });
    }
    const pdfBlob = await client.downloadBoardPack(workspace.companyId, {
      period: 'P02',
      fiscalYear: 2026,
      format: 'pdf',
    });
    const pdfText = extractPdfText(new Uint8Array(await pdfBlob.arrayBuffer()));
    expect(pdfText.length).toBeGreaterThan(0);
    const pptxBlob = await client.downloadBoardPack(workspace.companyId, {
      period: 'P02',
      fiscalYear: 2026,
      format: 'pptx',
    });
    const pptxRuns = extractPptxRuns(new Uint8Array(await pptxBlob.arrayBuffer()));
    expect(pptxRuns.length).toBeGreaterThan(0);

    for (const row of pack.rows) {
      expect(cells, `xlsx ${row.key}`).toContain(row.label);
      expect(cells, `xlsx ${row.key}`).toContain(row.value);
      expect(pdfText, `pdf ${row.key}`).toContain(row.label);
      expect(pdfText, `pdf ${row.key}`).toContain(row.value);
      expect(pptxRuns, `pptx ${row.key}`).toContain(row.label);
      expect(pptxRuns, `pptx ${row.key}`).toContain(row.value);
      if (row.detail !== null) {
        expect(cells, `xlsx detail ${row.key}`).toContain(row.detail);
        expect(pdfText, `pdf detail ${row.key}`).toContain(row.detail);
        expect(pptxRuns, `pptx detail ${row.key}`).toContain(row.detail);
      }
    }
    expect(cells).toContain(pack.basis);
    expect(cells).toContain(pack.disclosure);
    expect(pdfText).toContain(pack.basis);
    expect(pptxRuns).toContain(pack.basis);
    expect(pptxRuns).toContain(pack.disclosure);

    // Typed negative & header cases: verify PPTX OOXML MIME type, filename, and negative guards.
    const clientIdentity: VerifiedIdentity = {
      firebaseUid: 'sandbox:client-import@onefpa.test',
      email: 'client-import@onefpa.test',
      displayName: 'Client Import',
    };
    const pptxHttpResponse = await fetch(
      `${baseUrl}/api/companies/${workspace.companyId}/board-pack/export?period=P02&format=pptx`,
      { headers: bearer(clientIdentity) },
    );
    expect(pptxHttpResponse.status).toBe(200);
    expect(pptxHttpResponse.headers.get('content-type')).toContain(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(pptxHttpResponse.headers.get('content-disposition')).toBe(
      'attachment; filename="board-pack-P02.pptx"',
    );
    const unauthenticated = await fetch(
      `${baseUrl}/api/companies/${workspace.companyId}/board-pack?period=P02`,
    );
    expect(unauthenticated.status).toBe(401);
    expect(((await unauthenticated.json()) as { error: { code: string } }).error.code).toBe('SESSION_REQUIRED');
    const unauthPptx = await fetch(
      `${baseUrl}/api/companies/${workspace.companyId}/board-pack/export?period=P02&format=pptx`,
    );
    expect(unauthPptx.status).toBe(401);

    const noPeriod = await fetch(`${baseUrl}/api/companies/${workspace.companyId}/board-pack`, {
      headers: bearer(clientIdentity),
    });
    expect(noPeriod.status).toBe(422);
    expect(((await noPeriod.json()) as { error: { details: { issues: string[] } } }).error.details.issues).toEqual([
      'period: required',
    ]);
    const badFormat = await fetch(
      `${baseUrl}/api/companies/${workspace.companyId}/board-pack/export?period=P02&format=docx`,
      { headers: bearer(clientIdentity) },
    );
    expect(badFormat.status).toBe(422);
    const foreignPack = await fetch(
      `${baseUrl}/api/companies/${workspace.companyId}/board-pack?period=P02`,
      { headers: bearer(INTRUDER) },
    );
    expect(foreignPack.status).toBe(403);
    expect(((await foreignPack.json()) as { error: { code: string } }).error.code).toBe('TENANT_FORBIDDEN');
    const foreignPptx = await fetch(
      `${baseUrl}/api/companies/${workspace.companyId}/board-pack/export?period=P02&format=pptx`,
      { headers: bearer(INTRUDER) },
    );
    expect(foreignPptx.status).toBe(403);
    expect(await countBatches(workspace.companyId)).toBe(2);
  }, 120_000);

  it('M2 Planning endpoints: driver preview/commit, scenarios list, rolling forecast, scenario compare, and tenant/validation guards (WI-0030)', async () => {
    const owner: VerifiedIdentity = {
      firebaseUid: 'sandbox:m2-planner@onefpa.test',
      email: 'm2-planner@onefpa.test',
      displayName: 'M2 Planner',
    };

    const createRes = await fetch(`${baseUrl}/api/setup/company`, {
      method: 'POST',
      headers: { ...bearer(owner), 'content-type': 'application/json' },
      body: JSON.stringify({
        companyName: 'M2 Planning Corp',
        baseCurrency: 'USD',
        calendarKind: '12month',
        fiscalYear: 2026,
        entityCode: 'HQ',
        entityName: 'HQ',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { companyId: string };
    const companyId = created.companyId;

    // Seed a 3-account chart (1000 Cash, 4000 Revenue, 5000 COGS)
    const chartRes = await fetch(`${baseUrl}/api/companies/${companyId}/chart/import`, {
      method: 'POST',
      headers: { ...bearer(owner), 'content-type': 'application/json' },
      body: JSON.stringify({
        csvText: [
          'code,name,type,normal_side,statement_line_key',
          '1000,Cash,asset,debit,bs.asset.cash',
          '4000,Revenue,revenue,credit,pl.revenue.service',
          '5000,COGS,expense,debit,pl.cogs.direct',
        ].join('\n'),
      }),
    });
    expect(chartRes.status).toBe(201);

    // Post P01 actuals (Revenue 1200.00, Cash 1200.00)
    const actualsRes = await fetch(`${baseUrl}/api/companies/${companyId}/import/commit`, {
      method: 'POST',
      headers: { ...bearer(owner), 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'actuals',
        sourceFilename: 'p01_actuals.csv',
        csvText: [
          'date,entry_ref,account_code,debit,credit,memo',
          '2026-01-15,JE-1,1000,1200.00,0.00,Cash sale',
          '2026-01-15,JE-1,4000,0.00,1200.00,Cash sale',
        ].join('\n'),
      }),
    });
    expect(actualsRes.status).toBe(201);

    const baseDrivers = [
      {
        kind: 'growth_rate' as const,
        driverKey: 'rev_growth',
        accountCode: '4000',
        assumptionLabel: 'Revenue +10% MoM (assumption)',
        baseAmount: '1000.00',
        ratePerPeriod: '0.10',
      },
      {
        kind: 'percent_of_account' as const,
        driverKey: 'cogs_pct',
        accountCode: '5000',
        assumptionLabel: 'COGS 30% of Revenue (assumption)',
        sourceAccountCode: '4000',
        ratio: '0.30',
      },
    ];

    // 1. Preview writes nothing
    const previewRes = await fetch(`${baseUrl}/api/companies/${companyId}/planning/drivers/preview`, {
      method: 'POST',
      headers: { ...bearer(owner), 'content-type': 'application/json' },
      body: JSON.stringify({
        fiscalYear: 2026,
        periods: ['P01', 'P02', 'P03'],
        drivers: baseDrivers,
      }),
    });
    expect(previewRes.status).toBe(200);
    const preview = (await previewRes.json()) as {
      grandTotal: string;
      totalsByAccount: Record<string, string>;
    };
    // 4000: 1000 + 1100 + 1210 = 3310.00; 5000: 300 + 330 + 363 = 993.00; grand = 4303.00
    expect(preview.totalsByAccount).toEqual({ '4000': '3310.00', '5000': '993.00' });
    expect(preview.grandTotal).toBe('4303.00');

    const scenariosBefore = await fetch(`${baseUrl}/api/companies/${companyId}/planning/scenarios`, {
      headers: bearer(owner),
    });
    expect(scenariosBefore.status).toBe(200);
    expect(((await scenariosBefore.json()) as { scenarios: unknown[] }).scenarios).toEqual([]);

    // 2. Commit Base Forecast (v1) & Upside Forecast (v1)
    const commitBase = await fetch(`${baseUrl}/api/companies/${companyId}/planning/drivers/commit`, {
      method: 'POST',
      headers: { ...bearer(owner), 'content-type': 'application/json' },
      body: JSON.stringify({
        fiscalYear: 2026,
        scenarioName: 'Base Forecast',
        scenarioKind: 'forecast',
        periods: ['P01', 'P02', 'P03'],
        drivers: baseDrivers,
      }),
    });
    expect(commitBase.status).toBe(201);
    const baseCommitted = (await commitBase.json()) as { versionNo: number; grandTotal: string };
    expect(baseCommitted.versionNo).toBe(1);
    expect(baseCommitted.grandTotal).toBe('4303.00');

    const commitUpside = await fetch(`${baseUrl}/api/companies/${companyId}/planning/drivers/commit`, {
      method: 'POST',
      headers: { ...bearer(owner), 'content-type': 'application/json' },
      body: JSON.stringify({
        fiscalYear: 2026,
        scenarioName: 'Upside Forecast',
        scenarioKind: 'forecast',
        periods: ['P01', 'P02', 'P03'],
        drivers: [
          {
            kind: 'fixed',
            driverKey: 'rev_upside',
            accountCode: '4000',
            assumptionLabel: 'Upside flat 1500 (assumption)',
            amount: '1500.00',
          },
          {
            kind: 'percent_of_account',
            driverKey: 'cogs_upside',
            accountCode: '5000',
            assumptionLabel: 'COGS 30% (assumption)',
            sourceAccountCode: '4000',
            ratio: '0.30',
          },
        ],
      }),
    });
    expect(commitUpside.status).toBe(201);

    // 3. List scenarios
    const listRes = await fetch(`${baseUrl}/api/companies/${companyId}/planning/scenarios`, {
      headers: bearer(owner),
    });
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as { scenarios: Array<{ name: string; currentVersionNo: number }> };
    expect(listed.scenarios.map((s) => `${s.name}:v${String(s.currentVersionNo)}`)).toEqual([
      'Base Forecast:v1',
      'Upside Forecast:v1',
    ]);

    // 4. Rolling forecast (cutoff P01 -> P01 actuals 1200 Cash + 1200 Rev = 2400; P02+P03 forecast 4000=2310, 5000=693 -> 3003)
    const rfRes = await fetch(
      `${baseUrl}/api/companies/${companyId}/planning/rolling-forecast?year=2026&cutoffPeriod=P01&scenario=${encodeURIComponent('Base Forecast')}`,
      { headers: bearer(owner) },
    );
    expect(rfRes.status).toBe(200);
    const rf = (await rfRes.json()) as {
      totalActual: string;
      totalForecast: string;
      totalFullHorizon: string;
      actualPeriods: string[];
      rows: Array<{ accountCode: string; actualSubtotal: string; forecastSubtotal: string; fullHorizonTotal: string }>;
    };
    expect(rf.actualPeriods).toEqual(['P01']);
    expect(rf.totalActual).toBe('2400.00');
    expect(rf.totalForecast).toBe('3003.00');
    expect(rf.totalFullHorizon).toBe('5403.00');
    const revRow = rf.rows.find((r) => r.accountCode === '4000');
    expect(revRow?.actualSubtotal).toBe('1200.00');
    expect(revRow?.forecastSubtotal).toBe('2310.00');
    expect(revRow?.fullHorizonTotal).toBe('3510.00');

    // 4b. Omitting cutoffPeriod resolves to the LAST period that actually posted (P01 here), so the
    // automatic opening view of the planning screen is a real rolling forecast, not an arbitrary month.
    const rfAutoRes = await fetch(
      `${baseUrl}/api/companies/${companyId}/planning/rolling-forecast?year=2026&scenario=${encodeURIComponent('Base Forecast')}`,
      { headers: bearer(owner) },
    );
    expect(rfAutoRes.status).toBe(200);
    const rfAuto = (await rfAutoRes.json()) as {
      cutoffPeriod: string;
      actualPeriods: string[];
      forecastPeriods: string[];
      totalActual: string;
      totalForecast: string;
    };
    expect(rfAuto.cutoffPeriod).toBe('P01');
    expect(rfAuto.actualPeriods).toEqual(['P01']);
    expect(rfAuto.forecastPeriods.length).toBe(11);
    expect(rfAuto.forecastPeriods.slice(0, 2)).toEqual(['P02', 'P03']);
    expect(rfAuto.totalActual).toBe('2400.00');
    expect(rfAuto.totalForecast).toBe('3003.00');

    // 5. Scenario comparison (Base 4303.00 vs Upside 4500+1350=5850.00 -> delta +1547.00)
    const cmpRes = await fetch(
      `${baseUrl}/api/companies/${companyId}/planning/compare?year=2026&base=${encodeURIComponent('Base Forecast')}&target=${encodeURIComponent('Upside Forecast')}`,
      { headers: bearer(owner) },
    );
    expect(cmpRes.status).toBe(200);
    const cmp = (await cmpRes.json()) as {
      totalBase: string;
      totalTarget: string;
      totalDelta: string;
    };
    expect(cmp.totalBase).toBe('4303.00');
    expect(cmp.totalTarget).toBe('5850.00');
    expect(cmp.totalDelta).toBe('1547.00');

    // 6. Re-commit Base Forecast -> bumps versionNo to 2 cleanly, and mismatched scenarioKind returns SCENARIO_KIND_CONFLICT
    const reCommitBase = await fetch(`${baseUrl}/api/companies/${companyId}/planning/drivers/commit`, {
      method: 'POST',
      headers: { ...bearer(owner), 'content-type': 'application/json' },
      body: JSON.stringify({
        fiscalYear: 2026,
        scenarioName: 'Base Forecast',
        scenarioKind: 'forecast',
        periods: ['P01', 'P02', 'P03'],
        drivers: baseDrivers,
      }),
    });
    expect(reCommitBase.status).toBe(201);
    const reCommitted = (await reCommitBase.json()) as { versionNo: number; grandTotal: string };
    expect(reCommitted.versionNo).toBe(2);
    expect(reCommitted.grandTotal).toBe('4303.00');

    const conflictKindRes = await fetch(`${baseUrl}/api/companies/${companyId}/planning/drivers/commit`, {
      method: 'POST',
      headers: { ...bearer(owner), 'content-type': 'application/json' },
      body: JSON.stringify({
        fiscalYear: 2026,
        scenarioName: 'Base Forecast',
        scenarioKind: 'budget',
        periods: ['P01', 'P02', 'P03'],
        drivers: baseDrivers,
      }),
    });
    expect(conflictKindRes.status).toBe(422);
    const conflictBody = (await conflictKindRes.json()) as {
      error: { code: string; details: { issues: string[] } };
    };
    expect(conflictBody.error.code).toBe('VALIDATION_FAILED');
    expect(conflictBody.error.details.issues).toEqual(['SCENARIO_KIND_CONFLICT:Base Forecast']);

    // 7. Negative cases: unmapped account rejected atomically, foreign tenant 403, unauthenticated 401
    const badAccountRes = await fetch(`${baseUrl}/api/companies/${companyId}/planning/drivers/commit`, {
      method: 'POST',
      headers: { ...bearer(owner), 'content-type': 'application/json' },
      body: JSON.stringify({
        fiscalYear: 2026,
        scenarioName: 'Bad Scenario',
        scenarioKind: 'forecast',
        periods: ['P01'],
        drivers: [
          {
            kind: 'fixed',
            driverKey: 'bad',
            accountCode: '9999',
            assumptionLabel: 'Missing account',
            amount: '100.00',
          },
        ],
      }),
    });
    expect(badAccountRes.status).toBe(422);

    const foreignRes = await fetch(`${baseUrl}/api/companies/${companyId}/planning/scenarios`, {
      headers: bearer(INTRUDER),
    });
    expect(foreignRes.status).toBe(403);

    const unauthRes = await fetch(`${baseUrl}/api/companies/${companyId}/planning/scenarios`);
    expect(unauthRes.status).toBe(401);
  }, 60_000);

  it('WI-0034 COL1–COL3 & JOB1/3: executes approval state machine, RBAC, anchored @mentions, job-backed notifications, and audit chain over HTTP', async () => {
    const owner: VerifiedIdentity = {
      firebaseUid: 'sandbox:wf-owner@onefpa.test',
      email: 'wf-owner@onefpa.test',
      displayName: 'WF Owner',
    };
    const editor: VerifiedIdentity = {
      firebaseUid: 'sandbox:wf-editor@onefpa.test',
      email: 'wf-editor@onefpa.test',
      displayName: 'WF Editor',
    };
    const reviewer: VerifiedIdentity = {
      firebaseUid: 'sandbox:wf-reviewer@onefpa.test',
      email: 'wf-reviewer@onefpa.test',
      displayName: 'WF Reviewer',
    };
    const viewer: VerifiedIdentity = {
      firebaseUid: 'sandbox:wf-viewer@onefpa.test',
      email: 'wf-viewer@onefpa.test',
      displayName: 'WF Viewer',
    };

    // 1. Setup company, chart, and commit two plan versions (v1 and v2)
    const setupRes = await fetch(`${baseUrl}/api/setup/company`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({
        companyName: 'Workflow Collab Co',
        baseCurrency: 'USD',
        calendarKind: '12month',
        fiscalYear: 2026,
        entityCode: 'HQ',
        entityName: 'HQ',
      }),
    });
    expect(setupRes.status).toBe(201);
    const { companyId } = (await setupRes.json()) as { companyId: string };

    const chartCsv = [
      'code,name,type,normal_side,statement_line_key',
      '4000,Subscription Revenue,revenue,credit,pl.revenue.service',
      '5000,Hosting COGS,expense,debit,pl.cogs.direct',
    ].join('\n');
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/chart/import`, {
          method: 'POST',
          headers: bearer(owner),
          body: JSON.stringify({ csvText: chartCsv }),
        })
      ).status,
    ).toBe(201);

    const commitV1Res = await fetch(`${baseUrl}/api/companies/${companyId}/planning/drivers/commit`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({
        fiscalYear: 2026,
        scenarioName: 'FY26 Base',
        scenarioKind: 'forecast',
        periods: ['P01', 'P02'],
        drivers: [
          {
            kind: 'fixed',
            driverKey: 'rev',
            accountCode: '4000',
            assumptionLabel: 'Core SaaS',
            amount: '1000.00',
          },
        ],
      }),
    });
    expect(commitV1Res.status).toBe(201);
    const v1 = (await commitV1Res.json()) as { planVersionId: string };

    const commitV2Res = await fetch(`${baseUrl}/api/companies/${companyId}/planning/drivers/commit`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({
        fiscalYear: 2026,
        scenarioName: 'FY26 Base',
        scenarioKind: 'forecast',
        periods: ['P01', 'P02'],
        drivers: [
          {
            kind: 'fixed',
            driverKey: 'rev',
            accountCode: '4000',
            assumptionLabel: 'Revised SaaS',
            amount: '1200.00',
          },
        ],
      }),
    });
    expect(commitV2Res.status).toBe(201);
    const v2 = (await commitV2Res.json()) as { planVersionId: string };

    // 2. Owner adds editor, reviewer, viewer; non-owner blocked from member management (403)
    const addEd = await fetch(`${baseUrl}/api/companies/${companyId}/members`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({ email: editor.email, displayName: editor.displayName, role: 'editor' }),
    });
    expect(addEd.status).toBe(201);
    const addRev = await fetch(`${baseUrl}/api/companies/${companyId}/members`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({ email: reviewer.email, displayName: reviewer.displayName, role: 'reviewer' }),
    });
    expect(addRev.status).toBe(201);
    const reviewerMember = (await addRev.json()) as { userId: string };
    const addView = await fetch(`${baseUrl}/api/companies/${companyId}/members`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({ email: viewer.email, displayName: viewer.displayName, role: 'viewer' }),
    });
    expect(addView.status).toBe(201);

    const nonOwnerAdd = await fetch(`${baseUrl}/api/companies/${companyId}/members`, {
      method: 'POST',
      headers: bearer(editor),
      body: JSON.stringify({ email: 'extra@onefpa.test', displayName: 'Extra', role: 'viewer' }),
    });
    expect(nonOwnerAdd.status).toBe(403);

    // 3. Viewer cannot create approval task or comment (403)
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/workflow/approvals`, {
          method: 'POST',
          headers: bearer(viewer),
          body: JSON.stringify({ planVersionId: v1.planVersionId, title: 'Viewer task' }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/workflow/comments`, {
          method: 'POST',
          headers: bearer(viewer),
          body: JSON.stringify({
            planVersionId: v1.planVersionId,
            anchor: { kind: 'version' },
            body: 'Viewer note',
          }),
        })
      ).status,
    ).toBe(403);

    // 4. Editor creates draft approval task for v1; duplicate task on same planVersionId rejected (409)
    const createT1 = await fetch(`${baseUrl}/api/companies/${companyId}/workflow/approvals`, {
      method: 'POST',
      headers: bearer(editor),
      body: JSON.stringify({
        planVersionId: v1.planVersionId,
        title: 'Approve v1 forecast',
        assigneeId: reviewerMember.userId,
      }),
    });
    expect(createT1.status).toBe(201);
    const task1 = (await createT1.json()) as { id: string; status: string; version: number };
    expect(task1.status).toBe('draft');
    expect(task1.version).toBe(1);

    const dupT1 = await fetch(`${baseUrl}/api/companies/${companyId}/workflow/approvals`, {
      method: 'POST',
      headers: bearer(editor),
      body: JSON.stringify({ planVersionId: v1.planVersionId, title: 'Duplicate' }),
    });
    expect(dupT1.status).toBe(409);

    // Negative COL1: draft -> approved direct jump fails (422)
    const skipSubmit = await fetch(
      `${baseUrl}/api/companies/${companyId}/workflow/approvals/${task1.id}/transition`,
      {
        method: 'POST',
        headers: bearer(reviewer),
        body: JSON.stringify({ targetStatus: 'approved', expectedVersion: 1 }),
      },
    );
    expect(skipSubmit.status).toBe(422);

    // Editor submits v1 (draft -> submitted); dispatches notification job to reviewer
    const submitT1 = await fetch(
      `${baseUrl}/api/companies/${companyId}/workflow/approvals/${task1.id}/transition`,
      {
        method: 'POST',
        headers: bearer(editor),
        body: JSON.stringify({ targetStatus: 'submitted', expectedVersion: 1 }),
      },
    );
    expect(submitT1.status).toBe(200);
    const submittedT1 = (await submitT1.json()) as { status: string; version: number };
    expect(submittedT1.status).toBe('submitted');
    expect(submittedT1.version).toBe(2);

    // Negative RBAC: editor cannot approve (403)
    const editorApprove = await fetch(
      `${baseUrl}/api/companies/${companyId}/workflow/approvals/${task1.id}/transition`,
      {
        method: 'POST',
        headers: bearer(editor),
        body: JSON.stringify({ targetStatus: 'approved', expectedVersion: 2 }),
      },
    );
    expect(editorApprove.status).toBe(403);

    // Negative COL1: reviewer cannot reject without reason (422)
    const rejectNoReason = await fetch(
      `${baseUrl}/api/companies/${companyId}/workflow/approvals/${task1.id}/transition`,
      {
        method: 'POST',
        headers: bearer(reviewer),
        body: JSON.stringify({ targetStatus: 'rejected', reason: '   ', expectedVersion: 2 }),
      },
    );
    expect(rejectNoReason.status).toBe(422);

    // Reviewer rejects v1 WITH reason -> notifies editor & creator
    const rejectOk = await fetch(
      `${baseUrl}/api/companies/${companyId}/workflow/approvals/${task1.id}/transition`,
      {
        method: 'POST',
        headers: bearer(reviewer),
        body: JSON.stringify({
          targetStatus: 'rejected',
          reason: 'Revise P02 run rate upward',
          expectedVersion: 2,
        }),
      },
    );
    expect(rejectOk.status).toBe(200);
    const rejectedT1 = (await rejectOk.json()) as { status: string; decisionReason: string; version: number };
    expect(rejectedT1.status).toBe('rejected');
    expect(rejectedT1.decisionReason).toBe('Revise P02 run rate upward');

    // Negative COL1: rejected task cannot transition further (422)
    const afterReject = await fetch(
      `${baseUrl}/api/companies/${companyId}/workflow/approvals/${task1.id}/transition`,
      {
        method: 'POST',
        headers: bearer(reviewer),
        body: JSON.stringify({ targetStatus: 'approved', expectedVersion: 3 }),
      },
    );
    expect(afterReject.status).toBe(422);

    // 5. v2 approval: draft -> submitted -> optimistic stale check (409) -> approved -> locks plan_version (409 on further edits)
    const createT2 = await fetch(`${baseUrl}/api/companies/${companyId}/workflow/approvals`, {
      method: 'POST',
      headers: bearer(editor),
      body: JSON.stringify({
        planVersionId: v2.planVersionId,
        title: 'Approve v2 revised forecast',
        assigneeId: reviewerMember.userId,
      }),
    });
    expect(createT2.status).toBe(201);
    const task2 = (await createT2.json()) as { id: string; version: number };

    const submitT2 = await fetch(
      `${baseUrl}/api/companies/${companyId}/workflow/approvals/${task2.id}/transition`,
      {
        method: 'POST',
        headers: bearer(editor),
        body: JSON.stringify({ targetStatus: 'submitted', expectedVersion: 1 }),
      },
    );
    expect(submitT2.status).toBe(200);

    // Stale expectedVersion = 1 returns 409 MODEL_VERSION_LOCKED
    const staleApprove = await fetch(
      `${baseUrl}/api/companies/${companyId}/workflow/approvals/${task2.id}/transition`,
      {
        method: 'POST',
        headers: bearer(reviewer),
        body: JSON.stringify({ targetStatus: 'approved', expectedVersion: 1 }),
      },
    );
    expect(staleApprove.status).toBe(409);

    const approveT2 = await fetch(
      `${baseUrl}/api/companies/${companyId}/workflow/approvals/${task2.id}/transition`,
      {
        method: 'POST',
        headers: bearer(reviewer),
        body: JSON.stringify({
          targetStatus: 'approved',
          reason: 'Aligned to revised SaaS pipeline',
          expectedVersion: 2,
        }),
      },
    );
    expect(approveT2.status).toBe(200);

    // Verify plan_version.locked_at stamped in DB
    const pvLockCheck = await db.query<{ locked_at: Date | null }>(
      `SELECT locked_at FROM plan_version WHERE company_id = $1 AND id = $2`,
      [companyId, v2.planVersionId],
    );
    expect(pvLockCheck.rows[0]?.locked_at).not.toBeNull();

    // Terminal approved task refuses further transition (409 MODEL_VERSION_LOCKED)
    const reTransitionLocked = await fetch(
      `${baseUrl}/api/companies/${companyId}/workflow/approvals/${task2.id}/transition`,
      {
        method: 'POST',
        headers: bearer(reviewer),
        body: JSON.stringify({ targetStatus: 'rejected', reason: 'Late change', expectedVersion: 3 }),
      },
    );
    expect(reTransitionLocked.status).toBe(409);

    // 6. Anchored comments & @mentions -> job-backed inbox notification & read tracking
    const cellCommentRes = await fetch(`${baseUrl}/api/companies/${companyId}/workflow/comments`, {
      method: 'POST',
      headers: bearer(editor),
      body: JSON.stringify({
        planVersionId: v2.planVersionId,
        anchor: { kind: 'cell', accountCode: '4000', periodCode: 'P01' },
        body: `Confirmed revenue uplift with @${reviewer.email} and @${owner.email}`,
      }),
    });
    expect(cellCommentRes.status).toBe(201);
    const cellComment = (await cellCommentRes.json()) as {
      anchorKey: string;
      mentionedUserIds: string[];
    };
    expect(cellComment.anchorKey).toBe('cell:4000:P01');
    expect(cellComment.mentionedUserIds).toHaveLength(2);

    const stmtCommentRes = await fetch(`${baseUrl}/api/companies/${companyId}/workflow/comments`, {
      method: 'POST',
      headers: bearer(reviewer),
      body: JSON.stringify({
        planVersionId: v2.planVersionId,
        anchor: { kind: 'statement_line', statementLineKey: 'pl.revenue.service' },
        body: 'Matches P&L service revenue target.',
      }),
    });
    expect(stmtCommentRes.status).toBe(201);

    // Negative COL2/COL3: unknown account anchor and unknown @mention fail cleanly (422)
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/workflow/comments`, {
          method: 'POST',
          headers: bearer(editor),
          body: JSON.stringify({
            planVersionId: v2.planVersionId,
            anchor: { kind: 'account', accountCode: '9999' },
            body: 'Bad account',
          }),
        })
      ).status,
    ).toBe(422);

    const badMentionRes = await fetch(`${baseUrl}/api/companies/${companyId}/workflow/comments`, {
      method: 'POST',
      headers: bearer(editor),
      body: JSON.stringify({
        planVersionId: v2.planVersionId,
        anchor: { kind: 'version' },
        body: 'Ping @ghost@outside.com',
      }),
    });
    expect(badMentionRes.status).toBe(422);

    // Owner inbox contains mention notification; owner marks it read
    const ownerOverviewRes = await fetch(`${baseUrl}/api/companies/${companyId}/workflow`, {
      headers: bearer(owner),
    });
    expect(ownerOverviewRes.status).toBe(200);
    const ownerOverview = (await ownerOverviewRes.json()) as {
      notifications: { id: string; eventKind: string; readAt: string | null }[];
      comments: { anchorKey: string }[];
      tasks: { status: string }[];
    };
    expect(ownerOverview.tasks).toHaveLength(2);
    expect(ownerOverview.comments.map((c) => c.anchorKey)).toEqual([
      'statement:pl.revenue.service',
      'cell:4000:P01',
    ]);
    const mentionNotif = ownerOverview.notifications.find((n) => n.eventKind === 'mention');
    expect(mentionNotif).toBeDefined();
    expect(mentionNotif?.readAt).toBeNull();

    const markReadRes = await fetch(
      `${baseUrl}/api/companies/${companyId}/workflow/notifications/${mentionNotif!.id}/read`,
      {
        method: 'POST',
        headers: bearer(owner),
        body: JSON.stringify({}),
      },
    );
    expect(markReadRes.status).toBe(200);
    const markedRead = (await markReadRes.json()) as { readAt: string | null };
    expect(markedRead.readAt).not.toBeNull();

    // Job ledger contains completed notification.dispatch jobs
    const jobCountRes = await db.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM job WHERE company_id = $1 AND kind = 'notification.dispatch' AND status = 'completed'`,
      [companyId],
    );
    expect(Number(jobCountRes.rows[0]?.cnt ?? '0')).toBeGreaterThanOrEqual(4);

    // Cross-tenant and unauthenticated access denied
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/workflow`, {
          headers: bearer(INTRUDER),
        })
      ).status,
    ).toBe(403);
    expect((await fetch(`${baseUrl}/api/companies/${companyId}/workflow`)).status).toBe(401);

    // D7: unbroken SHA-256 audit hash chain across company setup, chart, planning, member grants, approvals, comments, jobs, and notification reads
    const auditVerification = await verifyCompanyAuditLog(db, companyId);
    expect(auditVerification.valid).toBe(true);
    expect(auditVerification.checkedCount).toBeGreaterThanOrEqual(15);
  }, 60_000);

  it('WI-0035 M2 Workforce Module & §2.4 One-Engine Proof: persists positions, compiles golden oracle drivers, commits to plan_line, ties out Rolling Forecast & BvA, and enforces RBAC', async () => {
    const owner: VerifiedIdentity = {
      firebaseUid: 'sandbox:wfmod-owner@onefpa.test',
      email: 'wfmod-owner@onefpa.test',
      displayName: 'Workforce Owner',
    };
    const viewer: VerifiedIdentity = {
      firebaseUid: 'sandbox:wfmod-viewer@onefpa.test',
      email: 'wfmod-viewer@onefpa.test',
      displayName: 'Workforce Viewer',
    };

    // 1. Setup company & Chart of Accounts (`5100` COGS Direct, `6100` OpEx Payroll)
    const setupRes = await fetch(`${baseUrl}/api/setup/company`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({
        companyName: 'Workforce Co',
        baseCurrency: 'USD',
        calendarKind: '12month',
        fiscalYear: 2026,
        entityCode: 'HQ',
        entityName: 'HQ',
      }),
    });
    expect(setupRes.status).toBe(201);
    const { companyId } = (await setupRes.json()) as { companyId: string };

    const chartCsv = [
      'code,name,type,normal_side,statement_line_key',
      '5100,Direct Engineering Payroll,expense,debit,pl.cogs.direct',
      '6100,OpEx Payroll & Benefits,expense,debit,pl.opex.payroll',
    ].join('\n');
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/chart/import`, {
          method: 'POST',
          headers: bearer(owner),
          body: JSON.stringify({ csvText: chartCsv }),
        })
      ).status,
    ).toBe(201);

    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/members`, {
          method: 'POST',
          headers: bearer(owner),
          body: JSON.stringify({
            email: viewer.email,
            displayName: viewer.displayName,
            role: 'viewer',
          }),
        })
      ).status,
    ).toBe(201);

    // 2. Initial GET /workforce returns spec, 12 periods, 2 postable accounts, 0 positions
    const initialRes = await fetch(`${baseUrl}/api/companies/${companyId}/workforce`, {
      headers: bearer(owner),
    });
    expect(initialRes.status).toBe(200);
    const initial = (await initialRes.json()) as {
      fiscalYear: number;
      actorRole: string;
      moduleSpec: { moduleKey: string; dimensions: string[] };
      periods: string[];
      accounts: { code: string }[];
      positions: unknown[];
    };
    expect(initial.fiscalYear).toBe(2026);
    expect(initial.actorRole).toBe('owner');
    expect(initial.moduleSpec.moduleKey).toBe('workforce');
    expect(initial.moduleSpec.dimensions).toEqual(['department', 'position', 'account']);
    expect(initial.periods).toHaveLength(12);
    expect(initial.accounts.map((a) => a.code)).toEqual(['5100', '6100']);
    expect(initial.positions).toEqual([]);

    // 3. Save golden oracle roster to `workforce_position` table
    const saveRes = await fetch(`${baseUrl}/api/companies/${companyId}/workforce/positions`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({
        fiscalYear: 2026,
        positions: workforceOracle.positions,
      }),
    });
    expect(saveRes.status).toBe(200);
    const saved = (await saveRes.json()) as { positions: { positionCode: string; status: string }[] };
    expect(saved.positions).toHaveLength(3);

    // 4. Dry-run preview from saved roster matches golden oracle to the cent
    const previewRes = await fetch(`${baseUrl}/api/companies/${companyId}/workforce/preview`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({ fiscalYear: 2026 }),
    });
    expect(previewRes.status).toBe(200);
    const preview = (await previewRes.json()) as {
      grandTotalCost: string;
      grandTotalFteMonths: string;
      driverPlan: { grandTotal: string; totalsByAccount: Record<string, string> };
    };
    expect(preview.grandTotalCost).toBe(workforceOracle.expected.grandTotalCost);
    expect(preview.grandTotalFteMonths).toBe(workforceOracle.expected.grandTotalFteMonths);
    expect(preview.driverPlan.grandTotal).toBe(workforceOracle.expected.grandTotalCost);
    expect(preview.driverPlan.totalsByAccount).toEqual(workforceOracle.expected.totalsByAccount);

    // 5. Commit Workforce module into Budget FY2026 via shared One-Engine planning repository
    const commitRes = await fetch(`${baseUrl}/api/companies/${companyId}/workforce/commit`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({
        fiscalYear: 2026,
        scenarioName: 'Budget FY2026',
        scenarioKind: 'budget',
      }),
    });
    expect(commitRes.status).toBe(201);
    const committed = (await commitRes.json()) as {
      preview: { grandTotalCost: string };
      commit: { versionNo: number; grandTotal: string; lineCount: number };
    };
    expect(committed.commit.versionNo).toBe(1);
    expect(committed.commit.grandTotal).toBe('260025.00');
    expect(committed.commit.lineCount).toBe(24);

    // 6. Verify Rolling Forecast and BvA read the exact committed plan_lines cent-for-cent
    const rfRes = await fetch(
      `${baseUrl}/api/companies/${companyId}/planning/rolling-forecast?year=2026&scenario=${encodeURIComponent('Budget FY2026')}`,
      { headers: bearer(owner) },
    );
    expect(rfRes.status).toBe(200);
    const rf = (await rfRes.json()) as {
      totalForecast: string;
      rows: { accountCode: string; forecastSubtotal: string }[];
    };
    expect(rf.totalForecast).toBe('260025.00');
    expect(rf.rows.find((r) => r.accountCode === '5100')?.forecastSubtotal).toBe('159900.00');
    expect(rf.rows.find((r) => r.accountCode === '6100')?.forecastSubtotal).toBe('100125.00');

    const bvaRes = await fetch(`${baseUrl}/api/companies/${companyId}/bva?period=P12&year=2026`, {
      headers: bearer(owner),
    });
    expect(bvaRes.status).toBe(200);
    const bva = (await bvaRes.json()) as { hasPlan: boolean; totals: { plan: string } };
    expect(bva.hasPlan).toBe(true);
    expect(bva.totals.plan).toBe('260025.00');

    // 7. Negative cases: viewer cannot write positions/commit (403), unmapped account or inverted range fails atomically (422), foreign tenant 403, unauth 401
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/workforce/positions`, {
          method: 'POST',
          headers: bearer(viewer),
          body: JSON.stringify({ fiscalYear: 2026, positions: [] }),
        })
      ).status,
    ).toBe(403);

    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/workforce/commit`, {
          method: 'POST',
          headers: bearer(viewer),
          body: JSON.stringify({
            fiscalYear: 2026,
            scenarioName: 'Budget FY2026',
            scenarioKind: 'budget',
          }),
        })
      ).status,
    ).toBe(403);

    const badSaveRes = await fetch(`${baseUrl}/api/companies/${companyId}/workforce/positions`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({
        fiscalYear: 2026,
        positions: [
          {
            ...workforceOracle.positions[0],
            startPeriodCode: 'P08',
            endPeriodCode: 'P02',
            accountCode: '9999',
          },
        ],
      }),
    });
    expect(badSaveRes.status).toBe(422);
    const badSaveBody = (await badSaveRes.json()) as { error: { details: { issues: string[] } } };
    expect(badSaveBody.error.details.issues).toContain('UNMAPPED_ACCOUNT:9999');
    expect(badSaveBody.error.details.issues).toContain('END_BEFORE_START:ENG-001');

    // Confirm previous 3 positions are still intact after rejected save
    const afterBadSaveRes = await fetch(`${baseUrl}/api/companies/${companyId}/workforce`, {
      headers: bearer(owner),
    });
    const afterBadSave = (await afterBadSaveRes.json()) as { positions: unknown[] };
    expect(afterBadSave.positions).toHaveLength(3);

    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/workforce`, {
          headers: bearer(INTRUDER),
        })
      ).status,
    ).toBe(403);
    expect((await fetch(`${baseUrl}/api/companies/${companyId}/workforce`)).status).toBe(401);

    const auditVerification = await verifyCompanyAuditLog(db, companyId);
    expect(auditVerification.valid).toBe(true);
  }, 60_000);

  it('WI-0036 M2 Flux Analysis Waterfall Bridge & PVM Decomposition: ties out to committed BvA/GL, enforces calendar/tenant/input validation, and preserves exact cent reconciliation', async () => {
    const owner: VerifiedIdentity = {
      firebaseUid: 'sandbox:flux-owner@onefpa.test',
      email: 'flux-owner@onefpa.test',
      displayName: 'Flux Owner',
    };

    // 1. Setup company, Chart of Accounts, FY2026 Budget, and balanced P01 Actuals GL journal
    const setupRes = await fetch(`${baseUrl}/api/setup/company`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({
        companyName: 'Flux Variance Co',
        baseCurrency: 'USD',
        calendarKind: '12month',
        fiscalYear: 2026,
        entityCode: 'HQ',
        entityName: 'HQ',
      }),
    });
    expect(setupRes.status).toBe(201);
    const { companyId } = (await setupRes.json()) as { companyId: string };

    const chartCsv = [
      'code,name,type,normal_side,statement_line_key',
      '1000,Operating Cash,asset,debit,bs.asset.cash',
      '4000,Service revenue,revenue,credit,pl.revenue.service',
      '5100,Engineering payroll,expense,debit,pl.cogs.direct',
      '6100,Cloud hosting,expense,debit,pl.opex.other',
      '6200,Travel & events,expense,debit,pl.opex.other',
      '6300,Legal advisory,expense,debit,pl.opex.other',
    ].join('\n');
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/chart/import`, {
          method: 'POST',
          headers: bearer(owner),
          body: JSON.stringify({ csvText: chartCsv }),
        })
      ).status,
    ).toBe(201);

    const budgetCsv = [
      'account_code,period,amount',
      '4000,P01,10000.00',
      '5100,P01,6000.00',
      '6100,P01,1500.00',
      '6200,P01,800.00',
    ].join('\n');
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/budget/import`, {
          method: 'POST',
          headers: bearer(owner),
          body: JSON.stringify({ csvText: budgetCsv, fiscalYear: 2026, sourceFilename: 'flux-budget.csv' }),
        })
      ).status,
    ).toBe(201);

    const actualsCsv = [
      'entry_ref,date,account_code,description,debit,credit',
      'JE-FLUX-1,2026-01-15,1000,Net cash movement,2400.00,0.00',
      'JE-FLUX-1,2026-01-15,4000,Service revenue actuals,0.00,11850.00',
      'JE-FLUX-1,2026-01-15,5100,Engineering payroll actuals,7200.00,0.00',
      'JE-FLUX-1,2026-01-15,6100,Cloud hosting actuals,1100.00,0.00',
      'JE-FLUX-1,2026-01-15,6200,Travel & events actuals,850.00,0.00',
      'JE-FLUX-1,2026-01-15,6300,Unplanned legal advisory,300.00,0.00',
    ].join('\n');
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/import/commit`, {
          method: 'POST',
          headers: bearer(owner),
          body: JSON.stringify({ kind: 'actuals', sourceFilename: 'flux-actuals.csv', csvText: actualsCsv }),
        })
      ).status,
    ).toBe(201);

    // 2. GET /variance/flux ties out identically to BvA and the golden oracle
    const fluxRes = await fetch(
      `${baseUrl}/api/companies/${companyId}/variance/flux?period=P01&year=2026&minAbs=100.00&topN=2`,
      { headers: bearer(owner) },
    );
    expect(fluxRes.status).toBe(200);
    const flux = (await fluxRes.json()) as {
      hasPlan: boolean;
      totalPlannedAccounts: number;
      otherPlannedCount: number;
      drivers: { accountCode: string; shareOfAbsVariancePct: string }[];
      unplannedAccounts: { accountCode: string; actual: string }[];
      bridge: {
        planTotal: string;
        topDriversVariance: string;
        otherPlannedVariance: string;
        plannedVarianceTotal: string;
        plannedActualTotal: string;
        unplannedActualTotal: string;
        actualTotal: string;
        revenueVariance: string;
        expenseVariance: string;
        netOperatingVariance: string;
        tieOutValid: boolean;
      };
    };

    expect(flux.hasPlan).toBe(true);
    expect(flux.totalPlannedAccounts).toBe(4);
    expect(flux.otherPlannedCount).toBe(fluxPvmOracle.flux.expected.otherPlannedCount);
    expect(flux.drivers.map((d) => d.accountCode)).toEqual(fluxPvmOracle.flux.expected.topAccountCodes);
    expect(flux.drivers.map((d) => d.shareOfAbsVariancePct)).toEqual(fluxPvmOracle.flux.expected.topShares);
    expect(flux.unplannedAccounts.map((u) => u.accountCode)).toEqual(['1000', '6300']);
    expect(flux.bridge.planTotal).toBe(fluxPvmOracle.flux.expected.bridge.planTotal);
    expect(flux.bridge.topDriversVariance).toBe(fluxPvmOracle.flux.expected.bridge.topDriversVariance);
    expect(flux.bridge.otherPlannedVariance).toBe(fluxPvmOracle.flux.expected.bridge.otherPlannedVariance);
    expect(flux.bridge.plannedVarianceTotal).toBe(fluxPvmOracle.flux.expected.bridge.plannedVarianceTotal);
    expect(flux.bridge.plannedActualTotal).toBe(fluxPvmOracle.flux.expected.bridge.plannedActualTotal);
    expect(flux.bridge.unplannedActualTotal).toBe('2700.00');
    expect(flux.bridge.actualTotal).toBe('23700.00');
    expect(flux.bridge.revenueVariance).toBe(fluxPvmOracle.flux.expected.bridge.revenueVariance);
    expect(flux.bridge.expenseVariance).toBe(fluxPvmOracle.flux.expected.bridge.expenseVariance);
    expect(flux.bridge.netOperatingVariance).toBe(fluxPvmOracle.flux.expected.bridge.netOperatingVariance);
    expect(flux.bridge.tieOutValid).toBe(true);

    // Confirm BvA ties out to Flux totals cent-for-cent
    const bvaRes = await fetch(`${baseUrl}/api/companies/${companyId}/bva?period=P01&year=2026`, {
      headers: bearer(owner),
    });
    expect(bvaRes.status).toBe(200);
    const bva = (await bvaRes.json()) as {
      totals: { plan: string; varianceAmount: string; unplannedActual: string; actual: string };
    };
    expect(flux.bridge.planTotal).toBe(bva.totals.plan);
    expect(flux.bridge.plannedVarianceTotal).toBe(bva.totals.varianceAmount);
    expect(flux.bridge.unplannedActualTotal).toBe(bva.totals.unplannedActual);
    expect(flux.bridge.actualTotal).toBe(bva.totals.actual);

    // 3. POST /variance/pvm reproduces golden oracle decomposition and exact invariant
    const scenariosRes = await fetch(`${baseUrl}/api/companies/${companyId}/planning/scenarios`, {
      headers: bearer(owner),
    });
    const scenariosBody = (await scenariosRes.json()) as { scenarios: { scenarioId: string }[] };
    const budgetScenarioId = scenariosBody.scenarios[0]?.scenarioId ?? null;
    expect(budgetScenarioId).not.toBeNull();

    const pvmRes = await fetch(`${baseUrl}/api/companies/${companyId}/variance/pvm`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({
        periodCode: 'P01',
        fiscalYear: 2026,
        scenarioId: budgetScenarioId,
        items: fluxPvmOracle.pvm.items,
      }),
    });
    expect(pvmRes.status).toBe(200);
    const pvm = (await pvmRes.json()) as {
      scenarioName: string | null;
      totalPlanRevenue: string;
      totalActualRevenue: string;
      totalVariance: string;
      variancePct: string | null;
      priceVariance: string;
      volumeVariance: string;
      mixVariance: string;
      invariantPassed: boolean;
      invariantDelta: string;
      items: {
        key: string;
        planRevenue: string;
        actualRevenue: string;
        totalVariance: string;
        priceEffect: string;
        volumeAtPlanPrice: string;
        mixContribution: string;
      }[];
    };
    expect(pvm.scenarioName).toBe('Budget FY2026');
    expect(pvm.totalPlanRevenue).toBe(fluxPvmOracle.pvm.expected.totalPlanRevenue);
    expect(pvm.totalActualRevenue).toBe(fluxPvmOracle.pvm.expected.totalActualRevenue);
    expect(pvm.totalVariance).toBe(fluxPvmOracle.pvm.expected.totalVariance);
    expect(pvm.variancePct).toBe(fluxPvmOracle.pvm.expected.variancePct);
    expect(pvm.priceVariance).toBe(fluxPvmOracle.pvm.expected.priceVariance);
    expect(pvm.volumeVariance).toBe(fluxPvmOracle.pvm.expected.volumeVariance);
    expect(pvm.mixVariance).toBe(fluxPvmOracle.pvm.expected.mixVariance);
    expect(pvm.invariantPassed).toBe(true);
    expect(pvm.invariantDelta).toBe('0');
    expect(pvm.items[0]?.priceEffect).toBe(fluxPvmOracle.pvm.expected.items[0]!.priceEffect);
    expect(pvm.items[1]?.priceEffect).toBe(fluxPvmOracle.pvm.expected.items[1]!.priceEffect);

    // 4. Negative cases: invalid query/body/period/scenario, cross-tenant (403), unauthenticated (401)
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/variance/flux`, {
          headers: bearer(owner),
        })
      ).status,
    ).toBe(422);

    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/variance/flux?period=P01&minAbs=-5.00`, {
          headers: bearer(owner),
        })
      ).status,
    ).toBe(422);

    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/variance/flux?period=P01&topN=0`, {
          headers: bearer(owner),
        })
      ).status,
    ).toBe(422);

    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/variance/pvm`, {
          method: 'POST',
          headers: bearer(owner),
          body: JSON.stringify({
            periodCode: 'P99',
            fiscalYear: 2026,
            items: fluxPvmOracle.pvm.items,
          }),
        })
      ).status,
    ).toBe(422);

    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/variance/pvm`, {
          method: 'POST',
          headers: bearer(owner),
          body: JSON.stringify({
            periodCode: 'P01',
            fiscalYear: 2026,
            scenarioId: '99999999-9999-4999-8999-999999999999',
            items: fluxPvmOracle.pvm.items,
          }),
        })
      ).status,
    ).toBe(404);

    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/variance/pvm`, {
          method: 'POST',
          headers: bearer(owner),
          body: JSON.stringify({
            periodCode: 'P01',
            fiscalYear: 2026,
            items: [
              {
                key: 'SKU_NEG',
                label: 'Invalid',
                planUnits: '-5',
                planPrice: '10.00',
                actualUnits: '10',
                actualPrice: '10.00',
              },
            ],
          }),
        })
      ).status,
    ).toBe(422);

    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/variance/flux?period=P01`, {
          headers: bearer(INTRUDER),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/variance/pvm`, {
          method: 'POST',
          headers: bearer(INTRUDER),
          body: JSON.stringify({ periodCode: 'P01', items: fluxPvmOracle.pvm.items }),
        })
      ).status,
    ).toBe(403);
    expect((await fetch(`${baseUrl}/api/companies/${companyId}/variance/flux?period=P01`)).status).toBe(401);
  }, 60_000);

  it('WI-0038 RPT1/RPT2/RPT4: serves canonical KPIs, trend series, 100% cited Report Builder, and cache-to-engine tieout & invalidation', async () => {
    const owner: VerifiedIdentity = {
      firebaseUid: 'sandbox:dash-owner@onefpa.test',
      email: 'dash-owner@onefpa.test',
      displayName: 'Dash Owner',
    };

    const setupRes = await fetch(`${baseUrl}/api/setup/company`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({
        companyName: 'Metrics Co',
        baseCurrency: 'USD',
        calendarKind: '12month',
        fiscalYear: 2026,
        entityCode: 'HQ',
        entityName: 'HQ',
      }),
    });
    expect(setupRes.status).toBe(201);
    const { companyId } = (await setupRes.json()) as { companyId: string };

    const chartCsv = [
      'code,name,type,normal_side,statement_line_key',
      '1000,Operating Bank,asset,debit,bs.asset.cash',
      '4000,Product Revenue,revenue,credit,pl.revenue.product',
      '5000,Direct COGS,expense,debit,pl.cogs.direct',
      '6000,Payroll OpEx,expense,debit,pl.opex.payroll',
    ].join('\n');
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/chart/import`, {
          method: 'POST',
          headers: bearer(owner),
          body: JSON.stringify({ csvText: chartCsv }),
        })
      ).status,
    ).toBe(201);

    // 1. Empty actuals state before GL import
    const emptyDashRes = await fetch(
      `${baseUrl}/api/companies/${companyId}/dashboards?period=P02`,
      { headers: bearer(owner) },
    );
    expect(emptyDashRes.status).toBe(200);
    const emptyDash = (await emptyDashRes.json()) as {
      hasActuals: boolean;
      hasPlan: boolean;
      kpis: readonly { key: string; status: string; formattedValue: string }[];
      reportBuilder: { unlinkedBlockCount: number; citationCoveragePct: string };
    };
    expect(emptyDash.hasActuals).toBe(false);
    expect(emptyDash.hasPlan).toBe(false);
    expect(emptyDash.kpis.find((k) => k.key === 'pnl.gross_margin')?.status).toBe('nm');
    expect(emptyDash.kpis.find((k) => k.key === 'plan.revenue_attainment')?.status).toBe('not_planned');
    expect(emptyDash.reportBuilder.unlinkedBlockCount).toBe(0);
    expect(emptyDash.reportBuilder.citationCoveragePct).toBe('100.00%');

    // 2. Commit P01 & P02 GL actuals (P01 rev 1000, cogs 400, opex 200 -> EBITDA 400; P02 rev 200, cogs 80, opex 160 -> EBITDA -40)
    // YTD P02: rev 1200.00, cogs 480.00 -> GP 720.00 (60.00%), opex 360.00 -> EBITDA 360.00 (30.00%), Cash 360.00
    const actualsCsv = [
      'entry_ref,posting_date,account_code,description,debit,credit',
      'J-101,2026-01-15,1000,Cash inflow Jan,1000.00,0.00',
      'J-101,2026-01-15,4000,Product Sales Jan,0.00,1000.00',
      'J-102,2026-01-20,5000,Hosting Jan,400.00,0.00',
      'J-102,2026-01-20,6000,Payroll Jan,200.00,0.00',
      'J-102,2026-01-20,1000,Vendor & Payroll cash out Jan,0.00,600.00',
      'J-201,2026-02-15,1000,Cash inflow Feb,200.00,0.00',
      'J-201,2026-02-15,4000,Product Sales Feb,0.00,200.00',
      'J-202,2026-02-20,5000,Hosting Feb,80.00,0.00',
      'J-202,2026-02-20,6000,Payroll Feb,160.00,0.00',
      'J-202,2026-02-20,1000,Vendor & Payroll cash out Feb,0.00,240.00',
    ].join('\n');
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/import/commit`, {
          method: 'POST',
          headers: bearer(owner),
          body: JSON.stringify({
            kind: 'actuals',
            sourceFilename: 'dash-actuals.csv',
            csvText: actualsCsv,
          }),
        })
      ).status,
    ).toBe(201);

    // Cache must invalidate automatically after GL commit!
    const dashP02Res = await fetch(
      `${baseUrl}/api/companies/${companyId}/dashboards?period=P02&template=cash_and_runway`,
      { headers: bearer(owner) },
    );
    expect(dashP02Res.status).toBe(200);
    const dashP02 = (await dashP02Res.json()) as {
      hasActuals: boolean;
      hasPlan: boolean;
      kpis: readonly { key: string; value: string | null; formattedValue: string; status: string }[];
      trend: readonly { periodCode: string; revenue: string; ebitda: string; endingCash: string }[];
      reportBuilder: {
        templateId: string;
        blockCount: number;
        citedBlockCount: number;
        unlinkedBlockCount: number;
        citationCoveragePct: string;
      };
    };

    expect(dashP02.hasActuals).toBe(true);
    expect(dashP02.hasPlan).toBe(false);
    expect(dashP02.kpis.find((k) => k.key === 'pnl.revenue')?.formattedValue).toBe('1200.00');
    expect(dashP02.kpis.find((k) => k.key === 'pnl.gross_margin')?.formattedValue).toBe('60.00%');
    expect(dashP02.kpis.find((k) => k.key === 'pnl.ebitda')?.formattedValue).toBe('360.00');
    expect(dashP02.kpis.find((k) => k.key === 'pnl.ebitda_margin')?.formattedValue).toBe('30.00%');
    expect(dashP02.kpis.find((k) => k.key === 'cf.ending_cash')?.formattedValue).toBe('360.00');
    expect(dashP02.kpis.find((k) => k.key === 'plan.revenue_attainment')?.formattedValue).toBe('not planned');
    expect(dashP02.trend).toHaveLength(2);
    expect(dashP02.trend[0]).toMatchObject({ periodCode: 'P01', revenue: '1000.00', ebitda: '400.00', endingCash: '400.00' });
    expect(dashP02.trend[1]).toMatchObject({ periodCode: 'P02', revenue: '200.00', ebitda: '-40.00', endingCash: '360.00' });
    expect(dashP02.reportBuilder.templateId).toBe('cash_and_runway');
    expect(dashP02.reportBuilder.unlinkedBlockCount).toBe(0);
    expect(dashP02.reportBuilder.citationCoveragePct).toBe('100.00%');

    // RPT1 tieout against Statements + Board Pack cover
    const [stmRes, packRes] = await Promise.all([
      fetch(`${baseUrl}/api/companies/${companyId}/statements?period=P02`, { headers: bearer(owner) }),
      fetch(`${baseUrl}/api/companies/${companyId}/board-pack?period=P02`, { headers: bearer(owner) }),
    ]);
    expect(stmRes.status).toBe(200);
    expect(packRes.status).toBe(200);
    const stm = (await stmRes.json()) as { pnl: { revenue: string; netIncome: string }; cashFlow: { endingCash: string } };
    const pack = (await packRes.json()) as { rows: readonly { section: string; key: string; value: string }[] };
    expect(dashP02.kpis.find((k) => k.key === 'pnl.revenue')?.value).toBe(stm.pnl.revenue);
    expect(dashP02.kpis.find((k) => k.key === 'pnl.revenue')?.value).toBe(
      pack.rows.find((r) => r.section === 'cover' && r.key === 'statement:pnl.revenue')?.value,
    );

    // 3. Import budget CSV -> RPT2 cache invalidates cleanly & plan attainment computes
    const budgetCsv = [
      'account_code,period_code,amount',
      '4000,P01,1000.00',
      '4000,P02,500.00',
      '5000,P01,400.00',
      '5000,P02,300.00',
      '6000,P01,250.00',
      '6000,P02,250.00',
    ].join('\n');
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/budget/import`, {
          method: 'POST',
          headers: bearer(owner),
          body: JSON.stringify({ fiscalYear: 2026, csvText: budgetCsv, sourceFilename: 'dash-budget.csv' }),
        })
      ).status,
    ).toBe(201);

    const plannedDashRes = await fetch(
      `${baseUrl}/api/companies/${companyId}/dashboards?period=P02&template=plan_performance`,
      { headers: bearer(owner) },
    );
    expect(plannedDashRes.status).toBe(200);
    const plannedDash = (await plannedDashRes.json()) as {
      hasPlan: boolean;
      kpis: readonly { key: string; formattedValue: string }[];
      reportBuilder: { templateId: string; citationCoveragePct: string; unlinkedBlockCount: number };
    };
    expect(plannedDash.hasPlan).toBe(true);
    // YTD P02 plan rev = 1500.00, actual rev = 1200.00 -> 80.00%; plan ebitda = 1500 - 700 - 500 = 300.00, actual 360.00 -> 120.00%
    expect(plannedDash.kpis.find((k) => k.key === 'plan.revenue_attainment')?.formattedValue).toBe('80.00%');
    expect(plannedDash.kpis.find((k) => k.key === 'plan.ebitda_attainment')?.formattedValue).toBe('120.00%');
    expect(plannedDash.reportBuilder.templateId).toBe('plan_performance');
    expect(plannedDash.reportBuilder.unlinkedBlockCount).toBe(0);
    expect(plannedDash.reportBuilder.citationCoveragePct).toBe('100.00%');

    // 4. RPT2 explicit cache-hit vs uncached engine tieout
    invalidateDashboardCacheForTests(db);
    const firstMeta = await getDashboardSummaryWithMeta(db, {
      companyId,
      throughPeriodCode: 'P02',
      templateId: 'plan_performance',
    });
    expect(firstMeta.cacheHit).toBe(false);
    const secondMeta = await getDashboardSummaryWithMeta(db, {
      companyId,
      throughPeriodCode: 'P02',
      templateId: 'plan_performance',
    });
    expect(secondMeta.cacheHit).toBe(true);
    const freshEngine = await computeDashboardSummaryUncached(db, {
      companyId,
      throughPeriodCode: 'P02',
      templateId: 'plan_performance',
    });
    expect(secondMeta.report).toEqual(freshEngine);

    // 5. Validation & RBAC negative cases (401/403/422)
    expect((await fetch(`${baseUrl}/api/companies/${companyId}/dashboards`, { headers: bearer(owner) })).status).toBe(422);
    expect((await fetch(`${baseUrl}/api/companies/${companyId}/dashboards?period=P02&template=bogus`, { headers: bearer(owner) })).status).toBe(422);
    expect((await fetch(`${baseUrl}/api/companies/${companyId}/dashboards?period=P99`, { headers: bearer(owner) })).status).toBe(422);
    expect((await fetch(`${baseUrl}/api/companies/${companyId}/dashboards?period=P02`, { headers: bearer(INTRUDER) })).status).toBe(403);
    expect((await fetch(`${baseUrl}/api/companies/${companyId}/dashboards?period=P02`)).status).toBe(401);
  }, 60_000);

  it('WI-0039: lists verified data-only industry packs, applies SaaS CoA atomically & idempotently, and enforces RBAC', async () => {
    const owner: VerifiedIdentity = {
      firebaseUid: 'sandbox:pack-owner@onefpa.test',
      email: 'pack-owner@onefpa.test',
      displayName: 'Pack Owner',
    };
    const viewer: VerifiedIdentity = {
      firebaseUid: 'sandbox:pack-viewer@onefpa.test',
      email: 'pack-viewer@onefpa.test',
      displayName: 'Pack Viewer',
    };

    const setupRes = await fetch(`${baseUrl}/api/setup/company`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({
        companyName: 'Pack Ready SaaS Co',
        baseCurrency: 'USD',
        calendarKind: '12month',
        fiscalYear: 2026,
        entityCode: 'HQ',
        entityName: 'HQ',
      }),
    });
    expect(setupRes.status).toBe(201);
    const { companyId } = (await setupRes.json()) as { companyId: string };

    // Add viewer member to test RBAC rejection on apply
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/members`, {
          method: 'POST',
          headers: bearer(owner),
          body: JSON.stringify({
            email: viewer.email,
            displayName: viewer.displayName,
            role: 'viewer',
          }),
        })
      ).status,
    ).toBe(201);

    // 1. List verified M2 packs
    const catalogRes = await fetch(`${baseUrl}/api/companies/${companyId}/packs`, {
      headers: bearer(owner),
    });
    expect(catalogRes.status).toBe(200);
    const catalog = (await catalogRes.json()) as {
      companyId: string;
      packs: readonly {
        key: string;
        name: string;
        version: string;
        dataOnly: boolean;
        accounts: readonly { code: string; statementLineKey: string }[];
        kpis: readonly { key: string }[];
        drivers: readonly { key: string }[];
      }[];
    };
    expect(catalog.companyId).toBe(companyId);
    expect(catalog.packs.map((p) => p.key)).toEqual(['saas', 'retail', 'manufacturing']);
    expect(catalog.packs.every((p) => p.dataOnly)).toBe(true);
    expect(catalog.packs[0]?.accounts.length).toBe(7);
    expect(catalog.packs[1]?.accounts.length).toBe(7);
    expect(catalog.packs[2]?.accounts.length).toBe(8);

    // 2. Apply SaaS pack atomically
    const applyRes = await fetch(`${baseUrl}/api/companies/${companyId}/packs/saas/apply`, {
      method: 'POST',
      headers: bearer(owner),
    });
    expect(applyRes.status).toBe(201);
    const applied = (await applyRes.json()) as {
      packKey: string;
      packVersion: string;
      inserted: number;
      updated: number;
      accounts: readonly { code: string; version: number; statementLineKey: string }[];
    };
    expect(applied.packKey).toBe('saas');
    expect(applied.packVersion).toBe('2.1.1');
    expect(applied.inserted).toBe(7);
    expect(applied.updated).toBe(0);
    expect(applied.accounts.length).toBe(7);
    expect(applied.accounts.every((a) => a.version === 1)).toBe(true);

    // 3. Re-applying is idempotent (updates in place, bumps version to 2, no duplicates)
    const reapplyRes = await fetch(`${baseUrl}/api/companies/${companyId}/packs/saas/apply`, {
      method: 'POST',
      headers: bearer(owner),
    });
    expect(reapplyRes.status).toBe(201);
    const reapplied = (await reapplyRes.json()) as {
      inserted: number;
      updated: number;
      accounts: readonly { code: string; version: number }[];
    };
    expect(reapplied.inserted).toBe(0);
    expect(reapplied.updated).toBe(7);
    expect(reapplied.accounts.length).toBe(7);
    expect(reapplied.accounts.every((a) => a.version === 2)).toBe(true);

    // 4. Actuals post cleanly onto applied SaaS pack accounts and statements articulate A1-A5
    const actualsCsv = [
      'entry_ref,posting_date,account_code,description,debit,credit',
      'J-SAAS-1,2026-01-15,1200,Annual subscription AR,1500.00,0.00',
      'J-SAAS-1,2026-01-15,4000,Subscription revenue Jan,0.00,1000.00',
      'J-SAAS-1,2026-01-15,2300,Deferred revenue Jan,0.00,500.00',
      'J-SAAS-2,2026-01-20,5000,R&D engineering cloud,300.00,0.00',
      'J-SAAS-2,2026-01-20,1200,AR credit offset,0.00,300.00',
    ].join('\n');
    const importRes = await fetch(`${baseUrl}/api/companies/${companyId}/import/commit`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({
        kind: 'actuals',
        sourceFilename: 'saas-actuals.csv',
        csvText: actualsCsv,
      }),
    });
    expect(importRes.status).toBe(201);
    const committed = (await importRes.json()) as { importedCount: number; quarantinedCount: number };
    expect(committed.importedCount).toBe(5);
    expect(committed.quarantinedCount).toBe(0);

    const stmRes = await fetch(`${baseUrl}/api/companies/${companyId}/statements?period=P01`, {
      headers: bearer(owner),
    });
    expect(stmRes.status).toBe(200);
    const stm = (await stmRes.json()) as {
      pnl: { revenue: string; opex: string; netIncome: string };
      articulation: { valid: boolean };
    };
    expect(stm.pnl.revenue).toBe('1000.00');
    expect(stm.pnl.opex).toBe('300.00');
    expect(stm.pnl.netIncome).toBe('700.00');
    expect(stm.articulation.valid).toBe(true);

    // 5. Audit log chain includes pack.apply and remains intact
    const auditChain = await verifyCompanyAuditLog(db, companyId);
    expect(auditChain.valid).toBe(true);
    expect(auditChain.checkedCount).toBeGreaterThanOrEqual(4);

    // 6. Negative RBAC / cut-line / auth cases
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/packs/retail/apply`, {
          method: 'POST',
          headers: bearer(viewer),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/packs/ecommerce/apply`, {
          method: 'POST',
          headers: bearer(owner),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/packs`, {
          headers: bearer(INTRUDER),
        })
      ).status,
    ).toBe(403);
    expect((await fetch(`${baseUrl}/api/companies/${companyId}/packs`)).status).toBe(401);
  }, 60_000);

  it('WI-0040 CON1–CON5: normalizes Sheets/QBO/Xero into single GL pipeline, enforces mismatch quarantine, atomic replace, write-only secrets, and RBAC', async () => {
    const owner: VerifiedIdentity = {
      firebaseUid: 'sandbox:conn-owner@onefpa.test',
      email: 'conn-owner@onefpa.test',
      displayName: 'Connector Owner',
    };
    const viewer: VerifiedIdentity = {
      firebaseUid: 'sandbox:conn-viewer@onefpa.test',
      email: 'conn-viewer@onefpa.test',
      displayName: 'Connector Viewer',
    };

    const setupRes = await fetch(`${baseUrl}/api/setup/company`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({
        companyName: 'Connector Sync Co',
        baseCurrency: 'USD',
        calendarKind: '12month',
        fiscalYear: 2026,
        entityCode: 'HQ',
        entityName: 'HQ',
      }),
    });
    expect(setupRes.status).toBe(201);
    const { companyId } = (await setupRes.json()) as { companyId: string };

    // Add viewer for RBAC checks + CoA matching accounts used across all 3 connector fixtures (preserving leading-zero 001200)
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/members`, {
          method: 'POST',
          headers: bearer(owner),
          body: JSON.stringify({
            email: viewer.email,
            displayName: viewer.displayName,
            role: 'viewer',
          }),
        })
      ).status,
    ).toBe(201);

    const chartCsv = [
      'code,name,type,normal_side,statement_line_key',
      '001200,Operating Bank Zero-Padded,asset,debit,bs.asset.cash',
      '1100,Accounts Receivable,asset,debit,bs.asset.ar',
      '2000,Accounts Payable,liability,credit,bs.liability.ap',
      '4000,Product & Service Revenue,revenue,credit,pl.revenue.product',
      '5000,Cloud Hosting COGS,expense,debit,pl.cogs.direct',
      '6000,Operating & G&A Expense,expense,debit,pl.opex.other',
    ].join('\n');
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/chart/import`, {
          method: 'POST',
          headers: bearer(owner),
          body: JSON.stringify({ csvText: chartCsv }),
        })
      ).status,
    ).toBe(201);

    // 1. Configure Google Sheets, QBO, and Xero connectors with synthetic write-only secrets
    const rawSecrets = [
      'sandbox-oauth-token-sheets-001',
      'sandbox-oauth-token-qbo-002',
      'sandbox-oauth-token-xero-003',
    ];
    const createConn = async (
      sourceSystem: 'google_sheets' | 'quickbooks_online' | 'xero',
      name: string,
      externalRef: string,
      secret: string,
    ): Promise<{ id: string }> => {
      const res = await fetch(`${baseUrl}/api/companies/${companyId}/connectors`, {
        method: 'POST',
        headers: bearer(owner),
        body: JSON.stringify({ sourceSystem, name, externalRef, credentialSecret: secret }),
      });
      expect(res.status).toBe(201);
      const bodyText = await res.text();
      expect(bodyText).not.toContain(secret);
      expect(bodyText).not.toContain('credential_ref');
      return JSON.parse(bodyText) as { id: string };
    };

    const sheetsConn = await createConn('google_sheets', 'Sheets GL Feed', 'sheet-p04-ops', rawSecrets[0]!);
    const qboConn = await createConn('quickbooks_online', 'QBO Main Sandbox', 'realm-913035', rawSecrets[1]!);
    const xeroConn = await createConn('xero', 'Xero AU Entity', 'tenant-xero-01', rawSecrets[2]!);

    // Duplicate connector name returns 409 DUPLICATE_CODE
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/connectors`, {
          method: 'POST',
          headers: bearer(owner),
          body: JSON.stringify({
            sourceSystem: 'google_sheets',
            name: 'Sheets GL Feed',
            externalRef: 'other',
            credentialSecret: 'another-synthetic-secret',
          }),
        })
      ).status,
    ).toBe(409);

    // Wrong sourceSystem payload vs configured connector rejected with 422 VALIDATION_FAILED
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/connectors/${sheetsConn.id}/sync`, {
          method: 'POST',
          headers: bearer(owner),
          body: JSON.stringify({ mode: 'incremental', payload: qboFixture }),
        })
      ).status,
    ).toBe(422);

    // 2. CON1/CON5: Sync all 3 connectors and validate canonical normalizedEntries + single GL commit path
    const syncAdapter = async (
      connectorId: string,
      cursor: string,
      payload: unknown,
    ): Promise<{
      run: { id: string; status: string; totalDebits: string; totalCredits: string; importBatchId: string | null };
      normalizedEntries: unknown[];
      importResult: { importedCount: number; batchId: string } | null;
    }> => {
      const res = await fetch(`${baseUrl}/api/companies/${companyId}/connectors/${connectorId}/sync`, {
        method: 'POST',
        headers: bearer(owner),
        body: JSON.stringify({ mode: 'incremental', cursor, payload }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        run: { id: string; status: string; totalDebits: string; totalCredits: string; importBatchId: string | null };
        normalizedEntries: unknown[];
        importResult: { importedCount: number; batchId: string } | null;
      };
      for (const entry of body.normalizedEntries) {
        expect(() => NormalizedJournalEntrySchema.parse(entry)).not.toThrow();
      }
      return body;
    };

    const sheetsSync = await syncAdapter(sheetsConn.id, '2026-04-12', googleSheetsFixture);
    expect(sheetsSync.run.status).toBe('completed');
    expect(sheetsSync.run.totalDebits).toBe('1950.25');
    expect(sheetsSync.run.importBatchId).toBe(sheetsSync.importResult?.batchId);
    expect(sheetsSync.importResult?.importedCount).toBe(4);

    const qboSync = await syncAdapter(qboConn.id, '2026-04-18', qboFixture);
    expect(qboSync.run.totalDebits).toBe('3000.00');
    expect(qboSync.importResult?.importedCount).toBe(4);

    const xeroSync = await syncAdapter(xeroConn.id, '2026-04-20', xeroFixture);
    expect(xeroSync.run.totalDebits).toBe('1235.50');
    expect(xeroSync.importResult?.importedCount).toBe(4);

    // Combined TB, Statements, and 001200 drill-to-source across all 3 connector syncs
    const tbRes = await fetch(`${baseUrl}/api/companies/${companyId}/trial-balance?period=P04`, {
      headers: bearer(owner),
    });
    expect(tbRes.status).toBe(200);
    const tb = (await tbRes.json()) as {
      totalDebit: string;
      totalCredit: string;
      isBalanced: boolean;
      sources: readonly { sourceFilename: string }[];
    };
    expect(tb.totalDebit).toBe('6185.75');
    expect(tb.totalCredit).toBe('6185.75');
    expect(tb.isBalanced).toBe(true);
    expect(tb.sources).toHaveLength(3);

    const stmRes = await fetch(`${baseUrl}/api/companies/${companyId}/statements?period=P04`, {
      headers: bearer(owner),
    });
    expect(stmRes.status).toBe(200);
    const stm = (await stmRes.json()) as {
      pnl: { revenue: string; cogs: string; opex: string; netIncome: string };
      balanceSheet: { totalAssets: string; isBalanced: boolean };
      articulation: { valid: boolean };
    };
    expect(stm.pnl.revenue).toBe('4825.50');
    expect(stm.pnl.cogs).toBe('600.00');
    expect(stm.pnl.opex).toBe('760.25');
    expect(stm.pnl.netIncome).toBe('3465.25');
    expect(stm.balanceSheet.totalAssets).toBe('4375.25');
    expect(stm.balanceSheet.isBalanced).toBe(true);
    expect(stm.articulation.valid).toBe(true);

    const drillRes = await fetch(`${baseUrl}/api/companies/${companyId}/accounts/001200/drill?period=P04`, {
      headers: bearer(owner),
    });
    expect(drillRes.status).toBe(200);
    const drill = (await drillRes.json()) as {
      accountCode: string;
      naturalActivity: string;
      rows: readonly { sourceFilename: string; sourceRef: string }[];
    };
    expect(drill.accountCode).toBe('001200');
    expect(drill.naturalActivity).toBe('1975.25');
    expect(drill.rows.map((r) => r.sourceRef)).toContain('GS-2026-001');
    expect(drill.rows.map((r) => r.sourceRef)).toContain('XERO-MJ-201');

    // 3. CON3: Reconciliation mismatch fixture quarantines with importBatchId = null and leaves TB untouched
    const mismatchRes = await fetch(`${baseUrl}/api/companies/${companyId}/connectors/${qboConn.id}/sync`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({ mode: 'incremental', cursor: '2026-04-22', payload: mismatchFixture }),
    });
    expect(mismatchRes.status).toBe(201);
    const mismatch = (await mismatchRes.json()) as {
      run: {
        status: string;
        reconciliationStatus: string;
        reconciliationReason: string;
        importBatchId: string | null;
        rowsPulled: number;
        rowsQuarantined: number;
      };
      importResult: unknown;
    };
    expect(mismatch.run.status).toBe('quarantined');
    expect(mismatch.run.reconciliationStatus).toBe('mismatch_quarantined');
    expect(mismatch.run.reconciliationReason).toContain('ROW_COUNT_MISMATCH:expected=3:got=2');
    expect(mismatch.run.reconciliationReason).toContain('RECONCILIATION_IMBALANCE');
    expect(mismatch.run.importBatchId).toBeNull();
    expect(mismatch.importResult).toBeNull();

    const tbAfterMismatchRes = await fetch(`${baseUrl}/api/companies/${companyId}/trial-balance?period=P04`, {
      headers: bearer(owner),
    });
    const tbAfterMismatch = (await tbAfterMismatchRes.json()) as { totalDebit: string };
    expect(tbAfterMismatch.totalDebit).toBe('6185.75');

    // 4. CON2: Idempotent incremental re-sync & full_repull atomic replacement without double-counting
    const dupRes = await fetch(`${baseUrl}/api/companies/${companyId}/connectors/${xeroConn.id}/sync`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({ mode: 'incremental', cursor: '2026-04-20', payload: xeroFixture }),
    });
    expect(dupRes.status).toBe(201);
    const dupBody = (await dupRes.json()) as {
      run: { replacedRunId: string | null };
      importResult: { replacedBatchId: string | null } | null;
    };
    expect(dupBody.run.replacedRunId).toBe(xeroSync.run.id);
    expect(dupBody.importResult?.replacedBatchId).toBe(xeroSync.importResult?.batchId);

    const repullRes = await fetch(`${baseUrl}/api/companies/${companyId}/connectors/${sheetsConn.id}/sync`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({
        mode: 'full_repull',
        cursor: '2026-04-30',
        payload: {
          sourceSystem: 'google_sheets',
          currency: 'USD',
          expectedRowCount: 2,
          rows: [
            {
              entryRef: 'GS-2026-099',
              date: '2026-04-25',
              period: 'P04',
              accountCode: '001200',
              description: 'Replacement cash receipt',
              debit: '200.00',
              credit: '',
              dims: {},
            },
            {
              entryRef: 'GS-2026-099',
              date: '2026-04-25',
              period: 'P04',
              accountCode: '4000',
              description: 'Replacement revenue',
              debit: '',
              credit: '200.00',
              dims: {},
            },
          ],
        },
      }),
    });
    expect(repullRes.status).toBe(201);
    const repullBody = (await repullRes.json()) as {
      run: { replacedRunId: string | null; totalDebits: string };
    };
    expect(repullBody.run.replacedRunId).toBe(sheetsSync.run.id);
    expect(repullBody.run.totalDebits).toBe('200.00');

    // TB after replacing Google Sheets (1950.25 -> 200.00): 3000.00 + 1235.50 + 200.00 = 4435.50
    const tbAfterRepullRes = await fetch(`${baseUrl}/api/companies/${companyId}/trial-balance?period=P04`, {
      headers: bearer(owner),
    });
    const tbAfterRepull = (await tbAfterRepullRes.json()) as { totalDebit: string; isBalanced: boolean };
    expect(tbAfterRepull.totalDebit).toBe('4435.50');
    expect(tbAfterRepull.isBalanced).toBe(true);

    // 5. Run history + CON4 zero secrets anywhere in overview, runs, or audit_log
    const [overviewRes, runsRes] = await Promise.all([
      fetch(`${baseUrl}/api/companies/${companyId}/connectors`, { headers: bearer(owner) }),
      fetch(`${baseUrl}/api/companies/${companyId}/connectors/${sheetsConn.id}/runs`, { headers: bearer(owner) }),
    ]);
    expect(overviewRes.status).toBe(200);
    expect(runsRes.status).toBe(200);
    const overviewText = await overviewRes.text();
    const runsText = await runsRes.text();
    const runsJson = JSON.parse(runsText) as { runs: readonly { status: string }[] };
    expect(runsJson.runs.map((r) => r.status)).toEqual(['completed', 'replaced']);

    const auditRows = await db.query<{ action: string; old_payload: unknown; new_payload: unknown }>(
      `SELECT action, old_payload, new_payload FROM audit_log WHERE company_id = $1`,
      [companyId],
    );
    const serializedAudit = JSON.stringify(auditRows.rows);
    for (const secret of rawSecrets) {
      expect(overviewText).not.toContain(secret);
      expect(runsText).not.toContain(secret);
      expect(serializedAudit).not.toContain(secret);
    }
    expect(overviewText).not.toContain('credential_ref');
    expect(runsText).not.toContain('vault:sha256:');
    expect(serializedAudit).not.toContain('vault:sha256:');

    const auditVerification = await verifyCompanyAuditLog(db, companyId);
    expect(auditVerification.valid).toBe(true);
    expect(auditVerification.checkedCount).toBeGreaterThanOrEqual(8);

    // 6. RBAC / tenant / auth negative guards
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/connectors`, {
          method: 'POST',
          headers: bearer(viewer),
          body: JSON.stringify({
            sourceSystem: 'xero',
            name: 'Viewer Denied',
            externalRef: 'x',
            credentialSecret: 'viewer-cannot-create-secret',
          }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/connectors/${sheetsConn.id}/sync`, {
          method: 'POST',
          headers: bearer(viewer),
          body: JSON.stringify({ mode: 'incremental', payload: googleSheetsFixture }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/connectors`, {
          headers: bearer(INTRUDER),
        })
      ).status,
    ).toBe(403);
    expect((await fetch(`${baseUrl}/api/companies/${companyId}/connectors`)).status).toBe(401);
  }, 60_000);

  it('WI-0042 M2 Customer Onboarding & Data Migration Pipeline (ONB1–ONB3): deterministic CoA assist, exact row accounting, repeatable cutover rehearsal, and RBAC guards', async () => {
    const owner: VerifiedIdentity = {
      firebaseUid: 'sandbox:onb-owner@onefpa.test',
      email: 'onb-owner@onefpa.test',
      displayName: 'Onboarding Owner',
    };
    const viewer: VerifiedIdentity = {
      firebaseUid: 'sandbox:onb-viewer@onefpa.test',
      email: 'onb-viewer@onefpa.test',
      displayName: 'Onboarding Viewer',
    };

    const setupRes = await fetch(`${baseUrl}/api/setup/company`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({
        companyName: 'Apex Partner Onboarding Co',
        baseCurrency: 'USD',
        calendarKind: '12month',
        fiscalYear: 2026,
        entityCode: 'HQ',
        entityName: 'HQ',
      }),
    });
    expect(setupRes.status).toBe(201);
    const { companyId } = (await setupRes.json()) as { companyId: string };

    const chartCsv = [
      'code,name,type,normal_side,statement_line_key',
      '1000,Operating Cash,asset,debit,bs.asset.cash',
      '1100,Accounts Receivable,asset,debit,bs.asset.ar',
      '4000,Subscription Revenue,revenue,credit,pl.revenue.product',
      '6000,Payroll Expense,expense,debit,pl.opex.payroll',
    ].join('\n');
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/chart/import`, {
          method: 'POST',
          headers: bearer(owner),
          body: JSON.stringify({ csvText: chartCsv }),
        })
      ).status,
    ).toBe(201);

    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/members`, {
          method: 'POST',
          headers: bearer(owner),
          body: JSON.stringify({
            email: viewer.email,
            displayName: viewer.displayName,
            role: 'viewer',
          }),
        })
      ).status,
    ).toBe(201);

    const partner = buildSyntheticPartnerDataset();

    // 1. Validate unmapped synthetic partner export: exact row accounting + deterministic CoA suggestions
    const valRes1 = await fetch(`${baseUrl}/api/companies/${companyId}/onboarding/validate`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({ csvText: partner.csvText }),
    });
    expect(valRes1.status).toBe(200);
    const val1 = (await valRes1.json()) as {
      rowsIn: number;
      importableCount: number;
      quarantinedCount: number;
      rowAccountingTies: boolean;
      goLiveStatus: string;
      suggestions: {
        sourceCode: string;
        suggestedAccountCode: string | null;
        requiresHumanApproval: boolean;
      }[];
    };
    expect(val1.rowsIn).toBe(10);
    expect(val1.rowAccountingTies).toBe(true);
    expect(val1.importableCount + val1.quarantinedCount).toBe(val1.rowsIn);
    expect(val1.goLiveStatus).toBe('blocked');
    expect(val1.suggestions.every((s) => s.requiresHumanApproval)).toBe(true);
    const sugByCode = new Map(val1.suggestions.map((s) => [s.sourceCode, s.suggestedAccountCode]));
    expect(sugByCode.get('OPS-CASH')).toBe('1000');
    expect(sugByCode.get('CUST-AR')).toBe('1100');
    expect(sugByCode.get('SAAS-REV')).toBe('4000');
    expect(sugByCode.get('SAL-PAYROLL')).toBe('6000');

    // Stage-commit rehearsal is blocked while unmapped codes remain (422)
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/onboarding/rehearse`, {
          method: 'POST',
          headers: bearer(owner),
          body: JSON.stringify({
            mode: 'stage_commit',
            sourceFilename: partner.sourceFilename,
            csvText: partner.csvText,
          }),
        })
      ).status,
    ).toBe(422);

    // 2. Explicit human approval writes immutable coa_mapping rows and clears mapping blockers
    const approveRes = await fetch(`${baseUrl}/api/companies/${companyId}/onboarding/mappings/approve`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({
        csvText: partner.csvText,
        entries: val1.suggestions.map((s) => ({
          sourceCode: s.sourceCode,
          status: 'mapped',
          accountCode: s.suggestedAccountCode,
          quarantineReason: null,
        })),
      }),
    });
    expect(approveRes.status).toBe(201);
    const approved = (await approveRes.json()) as {
      written: number;
      validation: {
        rowsIn: number;
        importableCount: number;
        quarantinedCount: number;
        rowAccountingTies: boolean;
        goLiveStatus: string;
        missingInteriorPeriods: string[];
        totalDebits: string;
        totalCredits: string;
      };
    };
    expect(approved.written).toBe(4);
    expect(approved.validation.rowsIn).toBe(10);
    expect(approved.validation.importableCount).toBe(8);
    expect(approved.validation.quarantinedCount).toBe(2);
    expect(approved.validation.rowAccountingTies).toBe(true);
    expect(approved.validation.goLiveStatus).toBe('ready_with_warnings');
    expect(approved.validation.missingInteriorPeriods).toEqual(['FY2026 P03']);
    expect(approved.validation.totalDebits).toBe('58000.00');
    expect(approved.validation.totalCredits).toBe('58000.00');

    // 3. Dry-run rehearsal computes projected TB & fingerprint with ZERO GL writes
    const dryRes = await fetch(`${baseUrl}/api/companies/${companyId}/onboarding/rehearse`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({
        mode: 'dry_run',
        sourceFilename: partner.sourceFilename,
        csvText: partner.csvText,
      }),
    });
    expect(dryRes.status).toBe(200);
    const dryRun = (await dryRes.json()) as {
      mode: string;
      rehearsalHash: string;
      committed: null;
      trialBalanceAfter: { isBalanced: boolean; totalDebit: string; totalCredit: string; accountCount: number };
    };
    expect(dryRun.mode).toBe('dry_run');
    expect(dryRun.committed).toBeNull();
    expect(dryRun.trialBalanceAfter.isBalanced).toBe(true);
    expect(dryRun.trialBalanceAfter.totalDebit).toBe('58000.00');

    const batchCountBeforeCommit = await db.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM import_batch WHERE company_id = $1`,
      [companyId],
    );
    expect(Number(batchCountBeforeCommit.rows[0]?.cnt ?? '0')).toBe(0);

    // 4. First stage_commit + repeat stage_commit produce identical rehearsalHash & TB with atomic replacement (ONB3)
    const commit1Res = await fetch(`${baseUrl}/api/companies/${companyId}/onboarding/rehearse`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({
        mode: 'stage_commit',
        sourceFilename: partner.sourceFilename,
        csvText: partner.csvText,
      }),
    });
    expect(commit1Res.status).toBe(201);
    const commit1 = (await commit1Res.json()) as {
      rehearsalHash: string;
      committed: { batchId: string; replacedBatchId: string | null; importedCount: number; quarantinedCount: number };
      trialBalanceAfter: { totalDebit: string; totalCredit: string; isBalanced: boolean };
    };
    expect(commit1.rehearsalHash).toBe(dryRun.rehearsalHash);
    expect(commit1.committed.replacedBatchId).toBeNull();
    expect(commit1.committed.importedCount).toBe(8);
    expect(commit1.committed.quarantinedCount).toBe(2);
    expect(commit1.trialBalanceAfter.totalDebit).toBe('58000.00');

    const commit2Res = await fetch(`${baseUrl}/api/companies/${companyId}/onboarding/rehearse`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({
        mode: 'stage_commit',
        sourceFilename: partner.sourceFilename,
        csvText: partner.csvText,
      }),
    });
    expect(commit2Res.status).toBe(201);
    const commit2 = (await commit2Res.json()) as {
      rehearsalHash: string;
      committed: { batchId: string; replacedBatchId: string | null };
      trialBalanceAfter: { totalDebit: string; totalCredit: string };
    };
    expect(commit2.rehearsalHash).toBe(dryRun.rehearsalHash);
    expect(commit2.committed.replacedBatchId).toBe(commit1.committed.batchId);
    expect(commit2.trialBalanceAfter.totalDebit).toBe('58000.00');

    // 5. Negative RBAC, cross-tenant, and unauthenticated checks
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/onboarding/validate`, {
          method: 'POST',
          headers: bearer(viewer),
          body: JSON.stringify({ csvText: partner.csvText }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/onboarding/validate`, {
          method: 'POST',
          headers: bearer(INTRUDER),
          body: JSON.stringify({ csvText: partner.csvText }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/onboarding/validate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ csvText: partner.csvText }),
        })
      ).status,
    ).toBe(401);

    const auditVerification = await verifyCompanyAuditLog(db, companyId);
    expect(auditVerification.valid).toBe(true);
  }, 60_000);

  it('tracks live 5-step onboarding checklist prerequisites, enforces owner/editor signoff after preconditions, and replays idempotently (WI-0043 DOC3)', async () => {
    const owner = {
      firebaseUid: 'sandbox:wi43-owner@onefpa.test',
      email: 'wi43-owner@onefpa.test',
      displayName: 'Onboarding Checklist Owner',
    };
    const viewerEmail = 'wi43-viewer@onefpa.test';
    const viewer = {
      firebaseUid: `sandbox:${viewerEmail}`,
      email: viewerEmail,
      displayName: 'Checklist Viewer',
    };

    const setupRes = await fetch(`${baseUrl}/api/setup/company`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({
        companyName: 'Checklist Guided Co',
        baseCurrency: 'USD',
        calendarKind: '12month',
        fiscalYear: 2026,
        entityCode: 'CHK-1',
        entityName: 'Checklist HQ',
      }),
    });
    expect(setupRes.status).toBe(201);
    const { companyId } = (await setupRes.json()) as { companyId: string };

    const addViewer = await fetch(`${baseUrl}/api/companies/${companyId}/members`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({ email: viewerEmail, displayName: 'Checklist Viewer', role: 'viewer' }),
    });
    expect(addViewer.status).toBe(201);

    // Initially only company_setup (1/5) is done; sign-off must be blocked (422)
    const initialRes = await fetch(`${baseUrl}/api/companies/${companyId}/onboarding/checklist`, {
      headers: bearer(owner),
    });
    expect(initialRes.status).toBe(200);
    const initial = (await initialRes.json()) as {
      completedCount: number;
      readyForSignoff: boolean;
      isComplete: boolean;
      steps: { id: string; done: boolean }[];
    };
    expect(initial.completedCount).toBe(1);
    expect(initial.readyForSignoff).toBe(false);
    expect(initial.isComplete).toBe(false);

    const earlySignoff = await fetch(
      `${baseUrl}/api/companies/${companyId}/onboarding/checklist/signoff`,
      { method: 'POST', headers: bearer(owner), body: JSON.stringify({}) },
    );
    expect(earlySignoff.status).toBe(422);

    // Seed CoA, Actuals, and Plan Baseline
    const chartRes = await fetch(`${baseUrl}/api/companies/${companyId}/chart/import`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({
        csvText:
          'code,name,type,normal_side,statement_line_key\n1000,Cash,asset,debit,bs.asset.cash\n4000,Revenue,revenue,credit,pl.revenue.product\n',
      }),
    });
    expect(chartRes.status).toBe(201);

    const actualsRes = await fetch(`${baseUrl}/api/companies/${companyId}/import/commit`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({
        kind: 'actuals',
        sourceFilename: 'chk-actuals.csv',
        csvText:
          'entry_ref,date,account_code,description,debit,credit\nJE-CHK-1,2026-01-15,1000,Cash sale,500.00,0.00\nJE-CHK-1,2026-01-15,4000,Revenue sale,0.00,500.00\n',
      }),
    });
    expect(actualsRes.status).toBe(201);

    const planRes = await fetch(`${baseUrl}/api/companies/${companyId}/planning/drivers/commit`, {
      method: 'POST',
      headers: bearer(owner),
      body: JSON.stringify({
        fiscalYear: 2026,
        scenarioName: 'Checklist Budget',
        scenarioKind: 'budget',
        periods: ['P01'],
        drivers: [
          {
            kind: 'fixed',
            driverKey: 'rev_p1',
            accountCode: '4000',
            assumptionLabel: 'Jan target',
            amount: '600.00',
          },
        ],
      }),
    });
    expect(planRes.status).toBe(201);

    const readyRes = await fetch(`${baseUrl}/api/companies/${companyId}/onboarding/checklist`, {
      headers: bearer(owner),
    });
    expect(readyRes.status).toBe(200);
    const ready = (await readyRes.json()) as { completedCount: number; readyForSignoff: boolean };
    expect(ready.completedCount).toBe(4);
    expect(ready.readyForSignoff).toBe(true);

    // RBAC & unauthenticated negative checks
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/onboarding/checklist/signoff`, {
          method: 'POST',
          headers: bearer(viewer),
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${baseUrl}/api/companies/${companyId}/onboarding/checklist`, {
          headers: bearer(INTRUDER),
        })
      ).status,
    ).toBe(403);
    expect(
      (await fetch(`${baseUrl}/api/companies/${companyId}/onboarding/checklist`)).status,
    ).toBe(401);

    // Owner sign-off writes audit_log entry & subsequent sign-off is idempotent
    const signoffRes = await fetch(
      `${baseUrl}/api/companies/${companyId}/onboarding/checklist/signoff`,
      { method: 'POST', headers: bearer(owner), body: JSON.stringify({}) },
    );
    expect(signoffRes.status).toBe(201);
    const completed = (await signoffRes.json()) as {
      completedCount: number;
      isComplete: boolean;
      signedOffAt: string | null;
      signedOffByName: string | null;
    };
    expect(completed.completedCount).toBe(5);
    expect(completed.isComplete).toBe(true);
    expect(completed.signedOffAt).not.toBeNull();
    expect(completed.signedOffByName).toBe('Onboarding Checklist Owner');

    const replaySignoff = await fetch(
      `${baseUrl}/api/companies/${companyId}/onboarding/checklist/signoff`,
      { method: 'POST', headers: bearer(owner), body: JSON.stringify({}) },
    );
    expect(replaySignoff.status).toBe(201);
    const auditCntRes = await db.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt
         FROM audit_log
        WHERE company_id = $1 AND action = 'onboarding.checklist_signoff'`,
      [companyId],
    );
    expect(Number(auditCntRes.rows[0]?.cnt ?? '0')).toBe(1);
    expect((await verifyCompanyAuditLog(db, companyId)).valid).toBe(true);
  }, 60_000);
});


