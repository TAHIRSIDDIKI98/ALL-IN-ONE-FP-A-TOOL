import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    for (const row of pack.rows) {
      expect(cells, `xlsx ${row.key}`).toContain(row.label);
      expect(cells, `xlsx ${row.key}`).toContain(row.value);
      expect(pdfText, `pdf ${row.key}`).toContain(row.label);
      expect(pdfText, `pdf ${row.key}`).toContain(row.value);
      if (row.detail !== null) {
        expect(cells, `xlsx detail ${row.key}`).toContain(row.detail);
        expect(pdfText, `pdf detail ${row.key}`).toContain(row.detail);
      }
    }
    expect(cells).toContain(pack.basis);
    expect(cells).toContain(pack.disclosure);
    expect(pdfText).toContain(pack.basis);

    // Typed negative cases: no period, unsupported format, foreign tenant. None writes a batch.
    const clientIdentity: VerifiedIdentity = {
      firebaseUid: 'sandbox:client-import@onefpa.test',
      email: 'client-import@onefpa.test',
      displayName: 'Client Import',
    };
    const unauthenticated = await fetch(
      `${baseUrl}/api/companies/${workspace.companyId}/board-pack?period=P02`,
    );
    expect(unauthenticated.status).toBe(401);
    expect(((await unauthenticated.json()) as { error: { code: string } }).error.code).toBe('SESSION_REQUIRED');

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
});
