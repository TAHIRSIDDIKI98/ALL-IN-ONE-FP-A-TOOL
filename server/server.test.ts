import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpineApp } from './app.js';
import { createSandboxTokenVerifier, issueSandboxToken, type VerifiedIdentity } from './auth/session.js';
import { openSandboxDatabase, type DatabaseHandle } from './db/client.js';
import { applyMigrations } from './db/migrate.js';
import { ApiClientError, createApiClient } from '../src/api/client.js';
import { seedChartOfAccounts } from './db/repositories/import.js';
import { MESSY_CSV } from './db/testing/corpus-fixtures.js';

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
  }, 120_000);
});
