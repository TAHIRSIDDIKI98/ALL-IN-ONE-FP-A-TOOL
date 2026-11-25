import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpineApp } from './app.js';
import { createSandboxTokenVerifier, issueSandboxToken, type VerifiedIdentity } from './auth/session.js';
import { openSandboxDatabase, type DatabaseHandle } from './db/client.js';
import { applyMigrations } from './db/migrate.js';

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
});
