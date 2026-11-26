import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import schemaSnapshot from '../../db/schema.snapshot.json' with { type: 'json' };
import { appendAuditLog, verifyCompanyAuditLog } from '../audit/index.js';
import { applyMigrations, type SqlExecutor } from './migrate.js';

let pg: PGlite;
let db: SqlExecutor;

beforeAll(async () => {
  pg = new PGlite();
  db = {
    async exec(sql: string) {
      await pg.exec(sql);
    },
    async query<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []) {
      const res = await pg.query<T>(sql, [...params]);
      return { rows: res.rows };
    },
  };
  await applyMigrations(db);
  await db.query(
    `INSERT INTO statement_line (key, statement, label, sort_order, sign_rule)
     VALUES
       ('bs.asset.cash', 'bs', 'Cash & Equivalents', 10, 'debit_minus_credit'),
       ('pl.revenue.product', 'pl', 'Product Revenue', 10, 'credit_minus_debit')
     ON CONFLICT (key) DO NOTHING`,
  );
}, 60_000);

afterAll(async () => {
  await pg.close();
});

interface SeedFixtures {
  userId: string;
  companyA: string;
  companyB: string;
  calA: string;
  calB: string;
  periodA: string;
  periodB: string;
  entityA: string;
  entityB: string;
  cashAcctA: string;
  revAcctA: string;
  revAcctB: string;
  scenarioA: string;
  versionA: string;
  batchA: string;
  rowRawA1: string;
  rowRawA2: string;
}

async function seedBaseTenants(dbExec: SqlExecutor, tag: string): Promise<SeedFixtures> {
  const uRes = await dbExec.query<{ id: string }>(
    `INSERT INTO app_user (firebase_uid, email, display_name)
     VALUES ($1, $2, 'Owner')
     RETURNING id`,
    [`uid-${tag}`, `owner-${tag}@example.com`],
  );
  const userId = uRes.rows[0]!.id;

  const compARes = await dbExec.query<{ id: string }>(
    `INSERT INTO company (name, base_currency) VALUES ($1, 'USD') RETURNING id`,
    [`Tenant A ${tag}`],
  );
  const compBRes = await dbExec.query<{ id: string }>(
    `INSERT INTO company (name, base_currency) VALUES ($1, 'USD') RETURNING id`,
    [`Tenant B ${tag}`],
  );
  const companyA = compARes.rows[0]!.id;
  const companyB = compBRes.rows[0]!.id;

  await db.query(`INSERT INTO membership (company_id, user_id, role) VALUES ($1, $2, 'owner')`, [companyA, userId]);
  await db.query(`INSERT INTO membership (company_id, user_id, role) VALUES ($1, $2, 'owner')`, [companyB, userId]);

  const calARes = await db.query<{ id: string }>(
    `INSERT INTO fiscal_calendar (company_id, kind, year_start_month) VALUES ($1, '12month', 1) RETURNING id`,
    [companyA],
  );
  const calBRes = await db.query<{ id: string }>(
    `INSERT INTO fiscal_calendar (company_id, kind, year_start_month) VALUES ($1, '12month', 1) RETURNING id`,
    [companyB],
  );
  const calA = calARes.rows[0]!.id;
  const calB = calBRes.rows[0]!.id;

  await db.query(`UPDATE company SET fiscal_calendar_id = $1 WHERE id = $2`, [calA, companyA]);
  await db.query(`UPDATE company SET fiscal_calendar_id = $1 WHERE id = $2`, [calB, companyB]);

  const perARes = await db.query<{ id: string }>(
    `INSERT INTO fiscal_period (company_id, fiscal_calendar_id, fiscal_year, period_no, code, label, quarter, start_date, end_date)
     VALUES ($1, $2, 2026, 1, 'P01', 'P01 (Jan 2026)', 1, '2026-01-01', '2026-01-31') RETURNING id`,
    [companyA, calA],
  );
  const perBRes = await db.query<{ id: string }>(
    `INSERT INTO fiscal_period (company_id, fiscal_calendar_id, fiscal_year, period_no, code, label, quarter, start_date, end_date)
     VALUES ($1, $2, 2026, 1, 'P01', 'P01 (Jan 2026)', 1, '2026-01-01', '2026-01-31') RETURNING id`,
    [companyB, calB],
  );
  const periodA = perARes.rows[0]!.id;
  const periodB = perBRes.rows[0]!.id;

  const entARes = await db.query<{ id: string }>(
    `INSERT INTO entity (company_id, code, name, currency) VALUES ($1, '001', 'Entity A', 'USD') RETURNING id`,
    [companyA],
  );
  const entBRes = await db.query<{ id: string }>(
    `INSERT INTO entity (company_id, code, name, currency) VALUES ($1, '001', 'Entity B', 'USD') RETURNING id`,
    [companyB],
  );
  const entityA = entARes.rows[0]!.id;
  const entityB = entBRes.rows[0]!.id;

  const cashARes = await db.query<{ id: string }>(
    `INSERT INTO account (company_id, code, name, type, normal_side, statement_line_key)
     VALUES ($1, '001000', 'Cash', 'asset', 'debit', 'bs.asset.cash') RETURNING id`,
    [companyA],
  );
  const revARes = await db.query<{ id: string }>(
    `INSERT INTO account (company_id, code, name, type, normal_side, statement_line_key)
     VALUES ($1, '004000', 'Product Revenue', 'revenue', 'credit', 'pl.revenue.product') RETURNING id`,
    [companyA],
  );
  const revBRes = await db.query<{ id: string }>(
    `INSERT INTO account (company_id, code, name, type, normal_side, statement_line_key)
     VALUES ($1, '004000', 'Product Revenue B', 'revenue', 'credit', 'pl.revenue.product') RETURNING id`,
    [companyB],
  );

  const scenARes = await db.query<{ id: string }>(
    `INSERT INTO scenario (company_id, kind, name, status) VALUES ($1, 'budget', 'FY26 Budget', 'draft') RETURNING id`,
    [companyA],
  );
  const scenarioA = scenARes.rows[0]!.id;

  const verARes = await db.query<{ id: string }>(
    `INSERT INTO plan_version (company_id, scenario_id, version_no, label) VALUES ($1, $2, 1, 'v1') RETURNING id`,
    [companyA, scenarioA],
  );
  const versionA = verARes.rows[0]!.id;

  const sourceHash = 'a'.repeat(64);
  const batchARes = await db.query<{ id: string }>(
    `INSERT INTO import_batch (company_id, kind, source_filename, source_hash, row_count, status, imported_by)
     VALUES ($1, 'actuals', 'jan.csv', $2, 2, 'staged', $3) RETURNING id`,
    [companyA, sourceHash, userId],
  );
  const batchA = batchARes.rows[0]!.id;

  const r1 = await db.query<{ id: string }>(
    `INSERT INTO import_row_raw (company_id, batch_id, row_no, raw_payload, status)
     VALUES ($1, $2, 1, '{"acct":"001000","debit":"1000.00"}'::jsonb, 'imported') RETURNING id`,
    [companyA, batchA],
  );
  const r2 = await db.query<{ id: string }>(
    `INSERT INTO import_row_raw (company_id, batch_id, row_no, raw_payload, status)
     VALUES ($1, $2, 2, '{"acct":"004000","credit":"1000.00"}'::jsonb, 'imported') RETURNING id`,
    [companyA, batchA],
  );
  await db.query(`UPDATE import_batch SET status = 'committed' WHERE id = $1`, [batchA]);

  return {
    userId,
    companyA,
    companyB,
    calA,
    calB,
    periodA,
    periodB,
    entityA,
    entityB,
    cashAcctA: cashARes.rows[0]!.id,
    revAcctA: revARes.rows[0]!.id,
    revAcctB: revBRes.rows[0]!.id,
    scenarioA,
    versionA,
    batchA,
    rowRawA1: r1.rows[0]!.id,
    rowRawA2: r2.rows[0]!.id,
  };
}

describe('WI-0007 M1 18-Table Schema Migrations on PGLite (D1–D7, D9)', () => {
  it('D1 & D9: applies migration idempotently and creates the exact 18 approved M1 tables with NUMERIC money columns', async () => {
    const tablesRes = await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const actualTables = tablesRes.rows.map((r) => r.tablename);
    const expectedTables = [...schemaSnapshot.tables].sort();
    expect(actualTables).toEqual(expectedTables);
    expect(actualTables).toHaveLength(25);

    // Idempotent second run applies 0 new files
    const secondRun = await applyMigrations(db);
    expect(secondRun).toEqual([]);
  });

  it('D2: composite tenant FKs reject cross-company references and preserve leading zeros on account codes', async () => {
    const s = await seedBaseTenants(db, 'd2');

    // Leading zeros preserved: "001000" and "1000" are distinct accounts in the same company
    await db.query(
      `INSERT INTO account (company_id, code, name, type, normal_side, statement_line_key)
       VALUES ($1, '1000', 'Cash Alt', 'asset', 'debit', 'bs.asset.cash')`,
      [s.companyA],
    );

    // Negative: asset with credit normal_side without is_contra=true is rejected
    await expect(
      db.query(
        `INSERT INTO account (company_id, code, name, type, normal_side, statement_line_key)
         VALUES ($1, '1099', 'Bad Asset', 'asset', 'credit', 'bs.asset.cash')`,
        [s.companyA],
      ),
    ).rejects.toThrow();

    // Negative cross-tenant FK: Company A plan_line referencing Company B account must fail
    await expect(
      db.query(
        `INSERT INTO plan_line (company_id, scenario_id, version_id, account_id, period_id, entity_id, amount)
         VALUES ($1, $2, $3, $4, $5, $6, '500.000000')`,
        [s.companyA, s.scenarioA, s.versionA, s.revAcctB, s.periodA, s.entityA],
      ),
    ).rejects.toThrow();

    // Negative cross-tenant FK: Company A gl_entry referencing Company B period must fail
    await expect(
      db.query(
        `INSERT INTO gl_entry (company_id, batch_id, period_id, entity_id, entry_date, currency, total_debit, total_credit)
         VALUES ($1, $2, $3, $4, '2026-01-15', 'USD', '100.00', '100.00')`,
        [s.companyA, s.batchA, s.periodB, s.entityA],
      ),
    ).rejects.toThrow();
  });

  it('D3 & D4: enforces balanced gl_entry at COMMIT via deferred trigger and valid single-sided gl_line constraints', async () => {
    const s = await seedBaseTenants(db, 'd3');

    // Positive: balanced journal entry commits cleanly
    await pg.exec('BEGIN');
    const entRes = await db.query<{ id: string }>(
      `INSERT INTO gl_entry (company_id, batch_id, period_id, entity_id, entry_date, source_ref, currency, total_debit, total_credit)
       VALUES ($1, $2, $3, $4, '2026-01-15', 'JE-001', 'USD', '1000.000000', '1000.000000') RETURNING id`,
      [s.companyA, s.batchA, s.periodA, s.entityA],
    );
    const jeId = entRes.rows[0]!.id;
    await db.query(
      `INSERT INTO gl_line (company_id, entry_id, account_id, period_id, entity_id, debit, credit, source_row_id)
       VALUES ($1, $2, $3, $4, $5, '1000.000000', '0', $6)`,
      [s.companyA, jeId, s.cashAcctA, s.periodA, s.entityA, s.rowRawA1],
    );
    await db.query(
      `INSERT INTO gl_line (company_id, entry_id, account_id, period_id, entity_id, debit, credit, source_row_id)
       VALUES ($1, $2, $3, $4, $5, '0', '1000.000000', $6)`,
      [s.companyA, jeId, s.revAcctA, s.periodA, s.entityA, s.rowRawA2],
    );
    await pg.exec('COMMIT');

    // Negative D3: unbalanced lines rejected at COMMIT by deferred trigger
    await pg.exec('BEGIN');
    const badJeRes = await db.query<{ id: string }>(
      `INSERT INTO gl_entry (company_id, batch_id, period_id, entity_id, entry_date, source_ref, currency, total_debit, total_credit)
       VALUES ($1, $2, $3, $4, '2026-01-16', 'JE-BAD', 'USD', '500.000000', '500.000000') RETURNING id`,
      [s.companyA, s.batchA, s.periodA, s.entityA],
    );
    const badJeId = badJeRes.rows[0]!.id;
    await db.query(
      `INSERT INTO gl_line (company_id, entry_id, account_id, period_id, entity_id, debit, credit, source_row_id)
       VALUES ($1, $2, $3, $4, $5, '500.000000', '0', $6)`,
      [s.companyA, badJeId, s.cashAcctA, s.periodA, s.entityA, s.rowRawA1],
    );
    await db.query(
      `INSERT INTO gl_line (company_id, entry_id, account_id, period_id, entity_id, debit, credit, source_row_id)
       VALUES ($1, $2, $3, $4, $5, '0', '450.000000', $6)`,
      [s.companyA, badJeId, s.revAcctA, s.periodA, s.entityA, s.rowRawA2],
    );
    await expect(pg.exec('COMMIT')).rejects.toThrow(/TRIAL_BALANCE_IMBALANCE/);
    await pg.exec('ROLLBACK');

    // Negative D4: both-nonzero, both-zero, and negative gl_line amounts rejected immediately
    await expect(
      db.query(
        `INSERT INTO gl_line (company_id, entry_id, account_id, period_id, entity_id, debit, credit, source_row_id)
         VALUES ($1, $2, $3, $4, $5, '10.00', '10.00', $6)`,
        [s.companyA, jeId, s.cashAcctA, s.periodA, s.entityA, s.rowRawA1],
      ),
    ).rejects.toThrow();

    await expect(
      db.query(
        `INSERT INTO gl_line (company_id, entry_id, account_id, period_id, entity_id, debit, credit, source_row_id)
         VALUES ($1, $2, $3, $4, $5, '0', '0', $6)`,
        [s.companyA, jeId, s.cashAcctA, s.periodA, s.entityA, s.rowRawA1],
      ),
    ).rejects.toThrow();

    await expect(
      db.query(
        `INSERT INTO gl_line (company_id, entry_id, account_id, period_id, entity_id, debit, credit, source_row_id)
         VALUES ($1, $2, $3, $4, $5, '-5.00', '0', $6)`,
        [s.companyA, jeId, s.cashAcctA, s.periodA, s.entityA, s.rowRawA1],
      ),
    ).rejects.toThrow();
  });

  it('D5 & D6: enforces atomic import idempotency/row-accounting and plan_line duplicate prevention (NULLS NOT DISTINCT)', async () => {
    const s = await seedBaseTenants(db, 'd5');

    const sourceHash = 'a'.repeat(64);
    // Negative D5: duplicate active import_batch for same (company_id, kind, source_hash) rejected
    await expect(
      db.query(
        `INSERT INTO import_batch (company_id, kind, source_filename, source_hash, row_count, status, imported_by)
         VALUES ($1, 'actuals', 'jan.csv', $2, 0, 'staged', $3)`,
        [s.companyA, sourceHash, s.userId],
      ),
    ).rejects.toThrow();

    // Negative D5: committed batch whose raw rows != row_count rejected at COMMIT
    await pg.exec('BEGIN');
    await db.query(
      `INSERT INTO import_batch (company_id, kind, source_filename, source_hash, row_count, status, imported_by)
       VALUES ($1, 'actuals', 'feb.csv', $2, 3, 'committed', $3)`,
      [s.companyA, 'b'.repeat(64), s.userId],
    );
    await expect(pg.exec('COMMIT')).rejects.toThrow(/IMPORT_ROW_ACCOUNTING_FAILED/);
    await pg.exec('ROLLBACK');

    // Positive D5: atomic replace marks old batch 'replaced' and commits new batch with same source_hash
    await pg.exec('BEGIN');
    await db.query(`UPDATE import_batch SET status = 'replaced' WHERE id = $1`, [s.batchA]);
    const repRes = await db.query<{ id: string }>(
      `INSERT INTO import_batch (company_id, kind, source_filename, source_hash, row_count, status, replaced_batch_id, imported_by)
       VALUES ($1, 'actuals', 'jan.csv', $2, 1, 'committed', $3, $4) RETURNING id`,
      [s.companyA, sourceHash, s.batchA, s.userId],
    );
    await db.query(
      `INSERT INTO import_row_raw (company_id, batch_id, row_no, raw_payload, status, quarantine_reason)
       VALUES ($1, $2, 1, '{"acct":"9999"}'::jsonb, 'quarantined', 'UNMAPPED_ACCOUNT')`,
      [s.companyA, repRes.rows[0]!.id],
    );
    await pg.exec('COMMIT');

    // Positive & Negative D6: plan_line rejects duplicate when department_id IS NULL and supports ON CONFLICT upsert
    await db.query(
      `INSERT INTO plan_line (company_id, scenario_id, version_id, account_id, period_id, entity_id, department_id, amount)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, '1200.000000')`,
      [s.companyA, s.scenarioA, s.versionA, s.revAcctA, s.periodA, s.entityA],
    );

    await expect(
      db.query(
        `INSERT INTO plan_line (company_id, scenario_id, version_id, account_id, period_id, entity_id, department_id, amount)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, '1300.000000')`,
        [s.companyA, s.scenarioA, s.versionA, s.revAcctA, s.periodA, s.entityA],
      ),
    ).rejects.toThrow();

    await db.query(
      `INSERT INTO plan_line (company_id, scenario_id, version_id, account_id, period_id, entity_id, department_id, amount)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, '1350.000000')
       ON CONFLICT (company_id, scenario_id, version_id, account_id, period_id, entity_id, department_id)
       DO UPDATE SET amount = EXCLUDED.amount`,
      [s.companyA, s.scenarioA, s.versionA, s.revAcctA, s.periodA, s.entityA],
    );

    const planCheck = await db.query<{ amount: string }>(
      `SELECT amount::text AS amount FROM plan_line WHERE company_id = $1 AND account_id = $2`,
      [s.companyA, s.revAcctA],
    );
    expect(planCheck.rows).toHaveLength(1);
    expect(planCheck.rows[0]!.amount).toBe('1350.000000');
  });

  it('D7: writes hash-chained audit_log rows and blocks UPDATE/DELETE mutations via trigger', async () => {
    const s = await seedBaseTenants(db, 'd7');

    const first = await appendAuditLog(db, {
      companyId: s.companyA,
      actorId: s.userId,
      action: 'company.create',
      targetTable: 'company',
      targetId: s.companyA,
      oldPayload: null,
      newPayload: { name: 'Tenant A' },
      occurredAt: '2026-01-01T00:00:00.000Z',
    });

    const second = await appendAuditLog(db, {
      companyId: s.companyA,
      actorId: s.userId,
      action: 'plan_line.upsert',
      targetTable: 'plan_line',
      targetId: s.versionA,
      oldPayload: null,
      newPayload: { amount: '1350.000000' },
      occurredAt: '2026-01-02T00:00:00.000Z',
    });

    expect(second.prevHash).toBe(first.entryHash);
    const verified = await verifyCompanyAuditLog(db, s.companyA);
    expect(verified).toEqual({ valid: true, checkedCount: 2 });

    // Negative D7: UPDATE and DELETE on audit_log must fail
    await expect(
      db.query(`UPDATE audit_log SET action = 'tampered' WHERE id = $1`, [first.id]),
    ).rejects.toThrow(/AUDIT_LOG_IMMUTABLE/);

    await expect(
      db.query(`DELETE FROM audit_log WHERE id = $1`, [first.id]),
    ).rejects.toThrow(/AUDIT_LOG_IMMUTABLE/);
  });

  it('WI-0034 COL1–COL3: enforces approval_task state machine, anchored comment keys, job idempotency, and tenant membership FKs', async () => {
    const s = await seedBaseTenants(db, 'wf');
    const verBRes = await db.query<{ id: string }>(
      `INSERT INTO scenario (company_id, kind, name, status) VALUES ($1, 'forecast', 'Tenant B Forecast', 'draft') RETURNING id`,
      [s.companyB],
    );
    const scenB = verBRes.rows[0]!.id;
    const pvBRes = await db.query<{ id: string }>(
      `INSERT INTO plan_version (company_id, scenario_id, version_no, label) VALUES ($1, $2, 1, 'B v1') RETURNING id`,
      [s.companyB, scenB],
    );
    const versionB = pvBRes.rows[0]!.id;

    // Create a second user belonging ONLY to companyB (not companyA)
    const revUserRes = await db.query<{ id: string }>(
      `INSERT INTO app_user (firebase_uid, email, display_name) VALUES ('uid-wf-b-only', 'bonly@example.com', 'B Only') RETURNING id`,
    );
    const bOnlyUserId = revUserRes.rows[0]!.id;
    await db.query(`INSERT INTO membership (company_id, user_id, role) VALUES ($1, $2, 'reviewer')`, [
      s.companyB,
      bOnlyUserId,
    ]);

    // Negative: assigning approval_task in companyA to non-member bOnlyUserId fails composite membership FK
    await expect(
      db.query(
        `INSERT INTO approval_task (company_id, scenario_id, plan_version_id, title, status, created_by, assignee_id)
         VALUES ($1, $2, $3, 'Cross-tenant assignee', 'draft', $4, $5)`,
        [s.companyA, s.scenarioA, s.versionA, s.userId, bOnlyUserId],
      ),
    ).rejects.toThrow();

    // Negative: referencing companyB plan_version from companyA fails composite FK
    await expect(
      db.query(
        `INSERT INTO approval_task (company_id, scenario_id, plan_version_id, title, status, created_by)
         VALUES ($1, $2, $3, 'Cross-tenant version', 'draft', $4)`,
        [s.companyA, s.scenarioA, versionB, s.userId],
      ),
    ).rejects.toThrow();

    // Positive: create task in draft
    const taskRes = await db.query<{ id: string }>(
      `INSERT INTO approval_task (company_id, scenario_id, plan_version_id, title, status, created_by)
       VALUES ($1, $2, $3, 'Review FY26 Budget v1', 'draft', $4) RETURNING id`,
      [s.companyA, s.scenarioA, s.versionA, s.userId],
    );
    const taskId = taskRes.rows[0]!.id;

    // Negative COL1: draft -> approved direct jump blocked by trigger
    await expect(
      db.query(
        `UPDATE approval_task
            SET status = 'approved', submitted_by = $1, submitted_at = now(), decided_by = $1, decided_at = now()
          WHERE id = $2`,
        [s.userId, taskId],
      ),
    ).rejects.toThrow(/INVALID_WORKFLOW_TRANSITION/);

    // Positive: draft -> submitted
    await db.query(
      `UPDATE approval_task
          SET status = 'submitted', submitted_by = $1, submitted_at = now(), version = version + 1
        WHERE id = $2`,
      [s.userId, taskId],
    );

    // Negative COL1: submitted -> rejected without reason blocked by CHECK
    await expect(
      db.query(
        `UPDATE approval_task
            SET status = 'rejected', decided_by = $1, decided_at = now(), decision_reason = '   '
          WHERE id = $2`,
        [s.userId, taskId],
      ),
    ).rejects.toThrow();

    // Positive: submitted -> approved
    await db.query(
      `UPDATE approval_task
          SET status = 'approved', decided_by = $1, decided_at = now(), decision_reason = 'Signed off', version = version + 1
        WHERE id = $2`,
      [s.userId, taskId],
    );

    // Negative COL1: approved -> rejected blocked by trigger (terminal)
    await expect(
      db.query(
        `UPDATE approval_task
            SET status = 'rejected', decision_reason = 'Revert'
          WHERE id = $1`,
        [taskId],
      ),
    ).rejects.toThrow(/INVALID_WORKFLOW_TRANSITION/);

    // Negative COL2: cell anchor missing period_id or mismatched key prefix rejected by CHECK
    await expect(
      db.query(
        `INSERT INTO comment (company_id, plan_version_id, anchor_kind, anchor_key, account_id, author_id, body)
         VALUES ($1, $2, 'cell', 'cell:004000:P01', $3, $4, 'Missing period FK')`,
        [s.companyA, s.versionA, s.revAcctA, s.userId],
      ),
    ).rejects.toThrow();

    await expect(
      db.query(
        `INSERT INTO comment (company_id, plan_version_id, anchor_kind, anchor_key, account_id, period_id, author_id, body)
         VALUES ($1, $2, 'cell', 'cell:004000:P01', $3, $4, $5, 'Cross-tenant account')`,
        [s.companyA, s.versionA, s.revAcctB, s.periodA, s.userId],
      ),
    ).rejects.toThrow();

    // Positive COL2: valid cell comment + job + notification + duplicate idempotency_key blocked (JOB1)
    const commentRes = await db.query<{ id: string }>(
      `INSERT INTO comment (company_id, plan_version_id, anchor_kind, anchor_key, account_id, period_id, author_id, body, mentioned_user_ids)
       VALUES ($1, $2, 'cell', 'cell:004000:P01', $3, $4, $5, 'Check Q1 growth @owner', $6::jsonb)
       RETURNING id`,
      [s.companyA, s.versionA, s.revAcctA, s.periodA, s.userId, JSON.stringify([s.userId])],
    );
    const commentId = commentRes.rows[0]!.id;

    const jobRes = await db.query<{ id: string }>(
      `INSERT INTO job (company_id, kind, idempotency_key, status, attempts, payload, result_ref, created_by, completed_at)
       VALUES ($1, 'notification.dispatch', 'comment:test-1', 'completed', 1, '{}'::jsonb, '{"count":1}'::jsonb, $2, now())
       RETURNING id`,
      [s.companyA, s.userId],
    );
    const jobId = jobRes.rows[0]!.id;

    await expect(
      db.query(
        `INSERT INTO job (company_id, kind, idempotency_key, status, attempts, payload, created_by)
         VALUES ($1, 'notification.dispatch', 'comment:test-1', 'queued', 0, '{}'::jsonb, $2)`,
        [s.companyA, s.userId],
      ),
    ).rejects.toThrow();

    await db.query(
      `INSERT INTO notification (company_id, recipient_id, job_id, event_kind, plan_version_id, comment_id, title, body)
       VALUES ($1, $2, $3, 'mention', $4, $5, 'Mentioned on cell:004000:P01', 'Check Q1 growth')`,
      [s.companyA, s.userId, jobId, s.versionA, commentId],
    );

    // Negative COL3: cross-tenant notification recipient rejected
    await expect(
      db.query(
        `INSERT INTO notification (company_id, recipient_id, job_id, event_kind, plan_version_id, comment_id, title, body)
         VALUES ($1, $2, $3, 'mention', $4, $5, 'Cross tenant', 'Should fail')`,
        [s.companyA, bOnlyUserId, jobId, s.versionA, commentId],
      ),
    ).rejects.toThrow();
  });

  it('WI-0035 M2 Workforce: enforces workforce_position tenant FKs, unique code per company, and NUMERIC range checks', async () => {
    const s = await seedBaseTenants(db, 'wfpos');

    const bOnlyRes = await db.query<{ id: string }>(
      `INSERT INTO app_user (firebase_uid, email, display_name) VALUES ('uid-wfpos-bonly', 'wfpos-bonly@example.com', 'B Only') RETURNING id`,
    );
    const bOnlyUserId = bOnlyRes.rows[0]!.id;
    await db.query(`INSERT INTO membership (company_id, user_id, role) VALUES ($1, $2, 'editor')`, [
      s.companyB,
      bOnlyUserId,
    ]);

    // Positive: valid workforce_position row inserts cleanly with NUMERIC(28,6) precision
    await db.query(
      `INSERT INTO workforce_position (
         company_id, position_code, title, department_name, account_id,
         start_period_code, end_period_code, fte, annual_salary, burden_rate,
         bonus_rate, ramp_first_period_pct, merit_period_code, merit_increase_pct,
         status, created_by
       ) VALUES (
         $1, 'ENG-001', 'Staff Engineer', 'Engineering', $2,
         'P01', NULL, '1.000000', '120000.000000', '0.200000',
         '0.100000', '0.500000', NULL, '0.000000',
         'active', $3
       )`,
      [s.companyA, s.revAcctA, s.userId],
    );

    // Negative: duplicate position_code in same company rejected
    await expect(
      db.query(
        `INSERT INTO workforce_position (
           company_id, position_code, title, department_name, account_id,
           start_period_code, fte, annual_salary, status, created_by
         ) VALUES ($1, 'ENG-001', 'Dup', 'Engineering', $2, 'P01', '1', '100000', 'active', $3)`,
        [s.companyA, s.revAcctA, s.userId],
      ),
    ).rejects.toThrow();

    // Negative cross-tenant FK: referencing Company B account from Company A fails
    await expect(
      db.query(
        `INSERT INTO workforce_position (
           company_id, position_code, title, department_name, account_id,
           start_period_code, fte, annual_salary, status, created_by
         ) VALUES ($1, 'ENG-002', 'Bad Acct', 'Engineering', $2, 'P01', '1', '100000', 'active', $3)`,
        [s.companyA, s.revAcctB, s.userId],
      ),
    ).rejects.toThrow();

    // Negative cross-tenant FK: created_by belonging only to Company B fails
    await expect(
      db.query(
        `INSERT INTO workforce_position (
           company_id, position_code, title, department_name, account_id,
           start_period_code, fte, annual_salary, status, created_by
         ) VALUES ($1, 'ENG-003', 'Bad Creator', 'Engineering', $2, 'P01', '1', '100000', 'active', $3)`,
        [s.companyA, s.revAcctA, bOnlyUserId],
      ),
    ).rejects.toThrow();

    // Negative CHECK constraints: negative salary or ramp > 1 rejected
    await expect(
      db.query(
        `INSERT INTO workforce_position (
           company_id, position_code, title, department_name, account_id,
           start_period_code, fte, annual_salary, status, created_by
         ) VALUES ($1, 'ENG-NEG', 'Neg Salary', 'Engineering', $2, 'P01', '1', '-1.00', 'active', $3)`,
        [s.companyA, s.revAcctA, s.userId],
      ),
    ).rejects.toThrow();

    await expect(
      db.query(
        `INSERT INTO workforce_position (
           company_id, position_code, title, department_name, account_id,
           start_period_code, fte, annual_salary, ramp_first_period_pct, status, created_by
         ) VALUES ($1, 'ENG-RAMP', 'Bad Ramp', 'Engineering', $2, 'P01', '1', '10000', '1.25', 'active', $3)`,
        [s.companyA, s.revAcctA, s.userId],
      ),
    ).rejects.toThrow();
  });

  it('WI-0040 M2 Connectors: enforces connector_config & sync_run tenant FKs, source allow-list, hashed credential_ref, and quarantine check', async () => {
    const s = await seedBaseTenants(db, 'conn');

    const bOnlyRes = await db.query<{ id: string }>(
      `INSERT INTO app_user (firebase_uid, email, display_name) VALUES ('uid-conn-bonly', 'conn-bonly@example.com', 'B Only') RETURNING id`,
    );
    const bOnlyUserId = bOnlyRes.rows[0]!.id;
    await db.query(`INSERT INTO membership (company_id, user_id, role) VALUES ($1, $2, 'editor')`, [
      s.companyB,
      bOnlyUserId,
    ]);

    const credHash = `vault:sha256:${'c'.repeat(64)}`;
    const connRes = await db.query<{ id: string }>(
      `INSERT INTO connector_config (company_id, source_system, name, external_ref, credential_ref, created_by)
       VALUES ($1, 'quickbooks_online', 'QBO Sandbox Primary', 'realm-913035', $2, $3)
       RETURNING id`,
      [s.companyA, credHash, s.userId],
    );
    const connIdA = connRes.rows[0]!.id;

    // Negative: unapproved M3+ source_system ('netsuite') blocked by CHECK
    await expect(
      db.query(
        `INSERT INTO connector_config (company_id, source_system, name, external_ref, credential_ref, created_by)
         VALUES ($1, 'netsuite', 'NetSuite M3', 'ns-1', $2, $3)`,
        [s.companyA, credHash, s.userId],
      ),
    ).rejects.toThrow();

    // Negative: raw credential instead of hashed vault:sha256:<64-hex> rejected by CHECK (CON4)
    await expect(
      db.query(
        `INSERT INTO connector_config (company_id, source_system, name, external_ref, credential_ref, created_by)
         VALUES ($1, 'xero', 'Xero Bad Cred', 'tenant-1', 'plaintext-secret', $2)`,
        [s.companyA, s.userId],
      ),
    ).rejects.toThrow();

    // Negative: duplicate (company_id, source_system, name) rejected
    await expect(
      db.query(
        `INSERT INTO connector_config (company_id, source_system, name, external_ref, credential_ref, created_by)
         VALUES ($1, 'quickbooks_online', 'QBO Sandbox Primary', 'realm-other', $2, $3)`,
        [s.companyA, credHash, s.userId],
      ),
    ).rejects.toThrow();

    // Negative cross-tenant FK: sync_run in Company B referencing Company A connector_id rejected
    await expect(
      db.query(
        `INSERT INTO sync_run (
           company_id, connector_id, mode, status, source_hash,
           rows_pulled, rows_imported, rows_quarantined, total_debits, total_credits,
           reconciliation_status, triggered_by
         ) VALUES ($1, $2, 'incremental', 'completed', $3, 2, 2, 0, '100.00', '100.00', 'matched', $4)`,
        [s.companyB, connIdA, 'd'.repeat(64), bOnlyUserId],
      ),
    ).rejects.toThrow();

    // Negative CON3 check: mismatch_quarantined with non-null import_batch_id rejected
    await expect(
      db.query(
        `INSERT INTO sync_run (
           company_id, connector_id, mode, status, source_hash,
           rows_pulled, rows_imported, rows_quarantined, total_debits, total_credits,
           reconciliation_status, reconciliation_reason, import_batch_id, triggered_by
         ) VALUES ($1, $2, 'incremental', 'quarantined', $3, 2, 0, 2, '100.00', '90.00', 'mismatch_quarantined', 'RECONCILIATION_IMBALANCE', $4, $5)`,
        [s.companyA, connIdA, 'e'.repeat(64), s.batchA, s.userId],
      ),
    ).rejects.toThrow();

    // Positive: completed sync_run referencing same-company connector + import_batch commits cleanly
    await db.query(
      `INSERT INTO sync_run (
         company_id, connector_id, mode, status, source_hash,
         rows_pulled, rows_imported, rows_quarantined, total_debits, total_credits,
         reconciliation_status, import_batch_id, triggered_by, completed_at
       ) VALUES ($1, $2, 'incremental', 'completed', $3, 2, 2, 0, '1000.000000', '1000.000000', 'matched', $4, $5, now())`,
      [s.companyA, connIdA, 'f'.repeat(64), s.batchA, s.userId],
    );
  });
});
