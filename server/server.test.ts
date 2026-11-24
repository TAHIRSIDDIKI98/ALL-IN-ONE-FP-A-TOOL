import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createSpineApp } from './app.js';

let server: Server;
let baseUrl = '';

beforeAll(async () => {
  const app = createSpineApp();
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

describe('Express 5 Spine API Server (/server/app.ts)', () => {
  it('serves /healthz and /readyz with structured status JSON', async () => {
    const h = await fetch(`${baseUrl}/healthz`);
    expect(h.status).toBe(200);
    expect(await h.json()).toEqual({ ok: true, service: 'onefpa-api', milestone: 'M0' });

    const r = await fetch(`${baseUrl}/readyz`);
    expect(r.status).toBe(200);
    const rBody = (await r.json()) as { ok: boolean; database: string };
    expect(rBody.ok).toBe(true);
    expect(['configured', 'pglite-sandbox']).toContain(rBody.database);
  });

  it('returns typed 401 SESSION_REQUIRED and 404 NOT_FOUND AppError envelopes without secrets', async () => {
    const unauth = await fetch(`${baseUrl}/api/session/workspace`);
    expect(unauth.status).toBe(401);
    const unauthBody = (await unauth.json()) as { error: { code: string; httpStatus: number } };
    expect(unauthBody.error.code).toBe('SESSION_REQUIRED');
    expect(unauthBody.error.httpStatus).toBe(401);

    const missing = await fetch(`${baseUrl}/api/nonexistent-route`);
    expect(missing.status).toBe(404);
    const missingBody = (await missing.json()) as { error: { code: string } };
    expect(missingBody.error.code).toBe('NOT_FOUND');
  });

  it('computes fiscal calendar preview via /core/calendar including NRF 2028 53-week year', async () => {
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
    const badBody = (await bad.json()) as { error: { code: string } };
    expect(badBody.error.code).toBe('VALIDATION_FAILED');
  });

  it('previews CSV import via /core/import returning stringified totals and quarantined rows', async () => {
    const csvText = 'entry_ref,date,account_code,description,debit,credit\nJE-1,2026-01-10,001200,Stock,100.00,\nJE-1,2026-01-10,9999,Unmapped,,100.00\n';
    const res = await fetch(`${baseUrl}/api/import/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        csvText,
        locale: 'unknown',
        knownAccountCodes: ['001200', '2000'],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rowsIn: number;
      importedCount: number;
      quarantinedCount: number;
      totalDebits: string;
      totalCredits: string;
    };
    expect(body.rowsIn).toBe(2);
    expect(body.importedCount).toBe(1);
    expect(body.quarantinedCount).toBe(1);
    expect(body.importedCount + body.quarantinedCount).toBe(body.rowsIn);
    expect(body.totalDebits).toBe('100.00');
    expect(body.totalCredits).toBe('0.00');
  });
});
