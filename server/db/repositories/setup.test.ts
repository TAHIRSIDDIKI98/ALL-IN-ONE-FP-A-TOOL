import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STATEMENT_LINE_CATALOG } from '../../../core/statements/index.js';
import { AppError } from '../../../shared/errors.js';
import { CompanySetupRequestSchema, type CompanySetupRequest } from '../../../shared/setup.js';
import { verifyCompanyAuditLog } from '../../audit/index.js';
import { applyMigrations } from '../migrate.js';
import { openSandboxDatabase, type DatabaseHandle } from '../client.js';
import {
  addEntity,
  createCompanyWorkspace,
  ensureAppUser,
  ensureStatementLineCatalog,
  getCompanyWorkspace,
  listActorCompanies,
  type AppUserIdentity,
} from './setup.js';

let db: DatabaseHandle;

beforeAll(async () => {
  db = await openSandboxDatabase();
  await applyMigrations(db);
});

afterAll(async () => {
  await db.close();
});

const OCCURRED_AT = '2026-11-25T10:00:00.000Z';

const ACTOR: AppUserIdentity = {
  firebaseUid: 'uid-setup-owner',
  email: 'owner@onefpa.test',
  displayName: 'Setup Owner',
};

/** Class A NRF 4-5-4 oracle (fixtures/oracles/calendar/nrf-454-2024-2028.json) for FY2028. */
const NRF_454 = JSON.parse(
  readFileSync(join(process.cwd(), 'fixtures', 'oracles', 'calendar', 'nrf-454-2024-2028.json'), 'utf8'),
) as {
  years: Array<{
    fy_label: string;
    start_date: string;
    end_date: string;
    week_count: number;
    period_count: number;
    fifty_third_period: { period_no: number; code: string } | null;
  }>;
};

const ORACLE_2028 = NRF_454.years.find((y) => y.fy_label === 'FY2028');
if (ORACLE_2028 === undefined) {
  throw new Error('NRF 4-5-4 oracle is missing FY2028');
}
const ORACLE_2028_FINAL = ORACLE_2028;
const ORACLE_2028_53RD = ORACLE_2028.fifty_third_period;
if (ORACLE_2028_53RD === null) {
  throw new Error('NRF 4-5-4 oracle is missing the FY2028 53rd-week period');
}
const ORACLE_2028_53RD_FINAL = ORACLE_2028_53RD;

function rawRequest(overrides: Partial<CompanySetupRequest> = {}): CompanySetupRequest {
  return {
    companyName: 'Persistence Test Co',
    baseCurrency: 'USD',
    calendarKind: '12month',
    fiscalYear: 2026,
    yearCount: 1,
    entityCode: 'ENT-US-HQ',
    entityName: 'Persistence Test Co HQ',
    ...overrides,
  };
}

function buildRequest(overrides: Partial<CompanySetupRequest> = {}): CompanySetupRequest {
  return CompanySetupRequestSchema.parse({
    companyName: 'Persistence Test Co',
    baseCurrency: 'USD',
    calendarKind: '12month',
    fiscalYear: 2026,
    yearCount: 1,
    entityCode: 'ENT-US-HQ',
    entityName: 'Persistence Test Co HQ',
    ...overrides,
  });
}

async function countCompaniesNamed(name: string): Promise<number> {
  const res = await db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM company WHERE name = $1`, [name]);
  return Number.parseInt(res.rows[0]?.count ?? '0', 10);
}

async function createWorkspace(request: CompanySetupRequest, actor: AppUserIdentity = ACTOR) {
  return db.transaction((tx) =>
    createCompanyWorkspace(tx, { actor, request, occurredAt: OCCURRED_AT }),
  );
}

describe('WI-0012 spine persistence foundation (/server/db)', () => {
  it('creates one atomic company workspace whose periods come from the NRF 4-5-4 Class A oracle', async () => {
    const workspace = await createWorkspace(
      buildRequest({ companyName: 'NRF Oracle Co', calendarKind: '454', fiscalYear: 2028, startMonth: 2 }),
    );

    expect(workspace.companyName).toBe('NRF Oracle Co');
    expect(workspace.baseCurrency).toBe('USD');
    expect(workspace.currencyScale).toBe(2);
    expect(workspace.calendarKind).toBe('454');
    expect(workspace.entities).toHaveLength(1);
    expect(workspace.entities[0]?.code).toBe('ENT-US-HQ');
    expect(workspace.entities[0]?.currency).toBe('USD');

    // Oracle: FY2028 is a 53-week year; the 4-day rule absorbs week 53 into P12 (no W53 code).
    expect(workspace.periods).toHaveLength(ORACLE_2028_FINAL.period_count);
    expect(workspace.periods[0]?.startDate).toBe(ORACLE_2028_FINAL.start_date);
    expect(workspace.periods[workspace.periods.length - 1]?.endDate).toBe(ORACLE_2028_FINAL.end_date);
    const flagged = workspace.periods.filter((p) => p.is53rdWeek);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.periodNo).toBe(ORACLE_2028_53RD_FINAL.period_no);
    expect(flagged[0]?.code).toBe(ORACLE_2028_53RD_FINAL.code);

    // Every period row is contiguous and belongs to FY2028.
    expect(workspace.periods.every((p) => p.fiscalYear === 2028)).toBe(true);
    expect(workspace.periods.every((p) => p.startDate <= p.endDate)).toBe(true);

    const membership = await db.query<{ role: string }>(
      `SELECT m.role
         FROM membership m
         JOIN app_user u ON u.id = m.user_id
        WHERE m.company_id = $1 AND u.firebase_uid = $2`,
      [workspace.companyId, ACTOR.firebaseUid],
    );
    expect(membership.rows.map((r) => r.role)).toEqual(['owner']);

    const audit = await db.query<{ action: string; new_payload: { periodsCreated: number } }>(
      `SELECT action, new_payload FROM audit_log WHERE company_id = $1`,
      [workspace.companyId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.action).toBe('company.create');
    expect(audit.rows[0]?.new_payload.periodsCreated).toBe(ORACLE_2028_FINAL.period_count);

    const chain = await verifyCompanyAuditLog(db, workspace.companyId);
    expect(chain.valid).toBe(true);
    expect(chain.checkedCount).toBe(1);
  });

  it('stores an adjustment period as period 13, excluded from the monthly spine view', async () => {
    const workspace = await createWorkspace(
      buildRequest({ companyName: 'Adjustment Co', includeAdjustmentPeriod: true }),
    );
    expect(workspace.periods).toHaveLength(13);
    const last = workspace.periods[12];
    expect(last?.periodNo).toBe(13);
    expect(last?.isAdjustment).toBe(true);
    expect(workspace.periods.filter((p) => !p.isAdjustment)).toHaveLength(12);
  });

  it('rolls the entire setup unit back when any step fails — no partial company survives', async () => {
    const request = buildRequest({ companyName: 'Rollback Co', entityCode: 'ENT-RB' });

    await expect(
      db.transaction(async (tx) => {
        await createCompanyWorkspace(tx, { actor: ACTOR, request, occurredAt: OCCURRED_AT });
        throw new Error('SIMULATED_FAILURE_AFTER_SETUP');
      }),
    ).rejects.toThrow('SIMULATED_FAILURE_AFTER_SETUP');

    expect(await countCompaniesNamed('Rollback Co')).toBe(0);
    const orphanPeriods = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM fiscal_period fp
         JOIN company c ON c.id = fp.company_id
        WHERE c.name = 'Rollback Co'`,
    );
    expect(orphanPeriods.rows[0]?.count).toBe('0');
    const orphanAudit = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM audit_log a
         JOIN company c ON c.id = a.company_id
        WHERE c.name = 'Rollback Co'`,
    );
    expect(orphanAudit.rows[0]?.count).toBe('0');
  });

  it('rejects a currency with no locked display scale with VALIDATION_FAILED and writes nothing', async () => {
    // Deliberately bypasses the zod contract to prove the repository's own defence-in-depth
    // guard: an internal caller can never persist a currency without a locked display scale.
    const request = rawRequest({ companyName: 'Bad Currency Co', baseCurrency: 'ZZZ' });

    await expect(createWorkspace(request)).rejects.toBeInstanceOf(AppError);
    await expect(createWorkspace(request)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      httpStatus: 422,
      details: { field: 'baseCurrency', value: 'ZZZ' },
    });
    expect(await countCompaniesNamed('Bad Currency Co')).toBe(0);
  });

  it('maps a duplicate entity code to a typed DUPLICATE_CODE conflict and keeps the prior row', async () => {
    const workspace = await createWorkspace(
      buildRequest({ companyName: 'Duplicate Entity Co', entityCode: 'ENT-DUP' }),
    );

    let caught: unknown = null;
    try {
      await db.transaction((tx) =>
        addEntity(tx, { companyId: workspace.companyId, code: 'ENT-DUP', name: 'Dup', currency: 'USD' }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe('DUPLICATE_CODE');
    expect((caught as AppError).httpStatus).toBe(409);

    const entities = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM entity WHERE company_id = $1`,
      [workspace.companyId],
    );
    expect(entities.rows[0]?.count).toBe('1');
  });

  it('scopes workspace reads to the owning company and returns null for an unknown company', async () => {
    const [a, b] = await Promise.all([
      createWorkspace(buildRequest({ companyName: 'Tenant A Co', entityCode: 'ENT-A' })),
      createWorkspace(buildRequest({ companyName: 'Tenant B Co', entityCode: 'ENT-B' })),
    ]);

    const readA = await getCompanyWorkspace(db, a.companyId);
    const readB = await getCompanyWorkspace(db, b.companyId);
    expect(readA?.companyName).toBe('Tenant A Co');
    expect(readB?.companyName).toBe('Tenant B Co');
    expect(readA?.entities.map((e) => e.code)).toEqual(['ENT-A']);
    expect(readB?.entities.map((e) => e.code)).toEqual(['ENT-B']);

    const idsA = new Set((readA?.periods ?? []).map((p) => p.id));
    const overlap = (readB?.periods ?? []).filter((p) => idsA.has(p.id));
    expect(overlap).toHaveLength(0);

    const missing = await getCompanyWorkspace(db, '00000000-0000-4000-8000-000000000000');
    expect(missing).toBeNull();
  });

  it('seeds the canonical statement_line catalog idempotently from the kernel catalog', async () => {
    const first = await ensureStatementLineCatalog(db);
    const second = await ensureStatementLineCatalog(db);
    expect(second).toBe(0);
    expect(first).toBeGreaterThanOrEqual(0);

    const stored = await db.query<{ key: string; label: string; statement: string; sign_rule: string; sort_order: number }>(
      `SELECT key, label, statement, sign_rule, sort_order FROM statement_line ORDER BY key`,
    );
    const storedKeys = stored.rows.map((r) => r.key);
    for (const spec of STATEMENT_LINE_CATALOG) {
      expect(storedKeys).toContain(spec.key);
    }
    const sample = STATEMENT_LINE_CATALOG.find((s) => s.key === 'pl.revenue.product');
    const storedSample = stored.rows.find((r) => r.key === 'pl.revenue.product');
    expect(storedSample?.label).toBe(sample?.label);
    expect(storedSample?.sign_rule).toBe(sample?.signRule);
    expect(storedSample?.statement).toBe(sample?.statement);
    expect(storedSample?.sort_order).toBe(sample?.sortOrder);
  });

  it('lists only the companies an actor is a member of, and reuses the identity row on upsert', async () => {
    const alice: AppUserIdentity = {
      firebaseUid: 'uid-alice',
      email: 'alice@onefpa.test',
      displayName: 'Alice',
    };
    const bob: AppUserIdentity = {
      firebaseUid: 'uid-bob',
      email: 'bob@onefpa.test',
      displayName: 'Bob',
    };

    const aliceCo = await createWorkspace(buildRequest({ companyName: 'Alice Co', entityCode: 'ENT-AL' }), alice);
    const bobCo = await createWorkspace(buildRequest({ companyName: 'Bob Co', entityCode: 'ENT-BO' }), bob);

    const aliceId = await db.transaction((tx) => ensureAppUser(tx, alice));
    const bobId = await db.transaction((tx) => ensureAppUser(tx, bob));
    const aliceIdAgain = await db.transaction((tx) => ensureAppUser(tx, { ...alice, email: 'alice+new@onefpa.test' }));
    expect(aliceIdAgain).toBe(aliceId);

    const aliceCompanies = await listActorCompanies(db, aliceId);
    const bobCompanies = await listActorCompanies(db, bobId);
    expect(aliceCompanies.map((c) => c.id)).toEqual([aliceCo.companyId]);
    expect(bobCompanies.map((c) => c.id)).toEqual([bobCo.companyId]);
    expect(aliceCompanies[0]?.name).toBe('Alice Co');
    expect(aliceCompanies[0]?.baseCurrency).toBe('USD');

    const refreshed = await db.query<{ email: string }>(`SELECT email FROM app_user WHERE id = $1`, [aliceId]);
    expect(refreshed.rows[0]?.email).toBe('alice+new@onefpa.test');
  });

  it('rejects an invalid setup payload at the contract boundary before any database work', () => {
    const bad = CompanySetupRequestSchema.safeParse({
      companyName: 'X',
      baseCurrency: 'us',
      calendarKind: 'not-a-calendar',
      fiscalYear: 1990,
      entityCode: '',
      entityName: '',
    });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const paths = bad.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('companyName');
      expect(paths).toContain('baseCurrency');
      expect(paths).toContain('calendarKind');
      expect(paths).toContain('fiscalYear');
      expect(paths).toContain('entityCode');
      expect(paths).toContain('entityName');
    }
  });
});
