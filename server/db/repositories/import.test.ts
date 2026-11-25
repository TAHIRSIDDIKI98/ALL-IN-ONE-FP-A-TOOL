import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors.js';
import type { CoaSeedAccount } from '../../../shared/import.js';
import { verifyCompanyAuditLog } from '../../audit/index.js';
import { openSandboxDatabase, type DatabaseHandle } from '../client.js';
import { applyMigrations } from '../migrate.js';
import {
  CORPUS,
  CORPUS_ORACLE,
  MESSY_CSV,
  OCCURRED_AT,
  corpusCsv,
  importCorpus,
  seedCorpusCompany,
} from '../testing/corpus-fixtures.js';
import { commitImport, seedChartOfAccounts } from './import.js';

let db: DatabaseHandle;

beforeAll(async () => {
  db = await openSandboxDatabase();
  await applyMigrations(db);
});

afterAll(async () => {
  await db.close();
});

function makeCompany(name: string, entityCode: string): Promise<{ companyId: string; actorId: string }> {
  return seedCorpusCompany(db, { companyName: name, entityCode });
}

describe('WI-0015 atomic idempotent import commit (G1, G2, D3, D5, C6, C7)', () => {
  it('posts a balanced corpus export, ties to the independent BigInt oracle, and replaces idempotently', async () => {
    const { companyId, actorId } = await makeCompany('Corpus Import Co', 'ENT-CORPUS');
    const other = await makeCompany('Scope B Co', 'ENT-SB');
    const csv = corpusCsv();

    const first = await db.transaction((tx) =>
      commitImport(tx, {
        companyId,
        actorId,
        kind: 'actuals',
        sourceFilename: 'corpus_gl.csv',
        csvText: csv,
        occurredAt: OCCURRED_AT,
      }),
    );

    expect(first.rowsIn).toBe(CORPUS.glLines.length);
    expect(first.importedCount).toBe(CORPUS.glLines.length);
    expect(first.quarantinedCount).toBe(0);
    expect(first.quarantined).toEqual([]);
    expect(first.entryCount).toBe(CORPUS.glEntries.length);
    expect(first.totalDebits).toBe(CORPUS_ORACLE.trialBalance.totalDebits);
    expect(first.totalCredits).toBe(CORPUS_ORACLE.trialBalance.totalCredits);
    expect(first.replacedBatchId).toBeNull();

    // Storage-level proof: posted debit/credit columns equal the oracle to the cent (NUMERIC(28,6)).
    const activeTotals = async () =>
      db.query<{ debits: string; credits: string }>(
        `SELECT COALESCE(SUM(gl.debit), 0)::text AS debits, COALESCE(SUM(gl.credit), 0)::text AS credits
           FROM gl_line gl
           JOIN gl_entry ge ON ge.id = gl.entry_id
           JOIN import_batch b ON b.id = ge.batch_id
          WHERE gl.company_id = $1 AND b.status IN ('staged', 'committed')`,
        [companyId],
      );

    const afterFirst = await activeTotals();
    expect(afterFirst.rows[0]?.debits).toBe(`${CORPUS_ORACLE.trialBalance.totalDebits}0000`);
    expect(afterFirst.rows[0]?.credits).toBe(`${CORPUS_ORACLE.trialBalance.totalCredits}0000`);

    // A second import of the SAME source replaces the prior batch: one active batch, no doubling.
    const second = await db.transaction((tx) =>
      commitImport(tx, {
        companyId,
        actorId,
        kind: 'actuals',
        sourceFilename: 'corpus_gl.csv',
        csvText: csv,
        occurredAt: '2026-11-25T12:05:00.000Z',
      }),
    );
    expect(second.sourceHash).toBe(first.sourceHash);
    expect(second.replacedBatchId).toBe(first.batchId);

    const batches = await db.query<{ status: string }>(
      `SELECT status FROM import_batch WHERE company_id = $1 ORDER BY imported_at ASC, id ASC`,
      [companyId],
    );
    expect(batches.rows.map((row) => row.status)).toEqual(['replaced', 'committed']);
    expect(batches.rows.filter((row) => row.status === 'committed')).toHaveLength(1);

    const afterSecond = await activeTotals();
    expect(afterSecond.rows[0]).toEqual(afterFirst.rows[0]);

    // History is preserved, never hard-deleted (§4.2): both batches keep every raw row.
    const rawRows = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM import_row_raw WHERE company_id = $1`,
      [companyId],
    );
    expect(rawRows.rows[0]?.count).toBe(String(CORPUS.glLines.length * 2));

    // company.create + import.commit + import.commit — every write is chained (§3.4, G10).
    const chain = await verifyCompanyAuditLog(db, companyId);
    expect(chain.valid).toBe(true);
    expect(chain.checkedCount).toBe(3);

    // Tenant isolation (D2): the second company sees none of the first company's batches.
    const otherBatches = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM import_batch WHERE company_id = $1`,
      [other.companyId],
    );
    expect(otherBatches.rows[0]?.count).toBe('0');
    const crossRead = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM import_batch WHERE company_id = $1 AND id = $2`,
      [other.companyId, first.batchId],
    );
    expect(crossRead.rows[0]?.count).toBe('0');
  }, 120_000);

  it('accounts for every messy-export row and quarantines unbalanced journals whole', async () => {
    const { companyId, actorId } = await makeCompany('Messy Export Co', 'ENT-MESSY');
    await db.transaction((tx) =>
      seedChartOfAccounts(tx, {
        companyId,
        accounts: [
          { code: '001200', name: 'Inventory', type: 'asset', normalSide: 'debit', parentCode: null, isPostable: true, statementLineKey: 'bs.asset.inventory', active: true },
          { code: '2000', name: 'Accounts Payable', type: 'liability', normalSide: 'credit', parentCode: null, isPostable: true, statementLineKey: 'bs.liability.ap', active: true },
          { code: '4000', name: 'Service Revenue', type: 'revenue', normalSide: 'credit', parentCode: null, isPostable: true, statementLineKey: 'pl.revenue.service', active: true },
          { code: '6000', name: 'Payroll', type: 'expense', normalSide: 'debit', parentCode: null, isPostable: true, statementLineKey: 'pl.opex.payroll', active: true },
          { code: '6100', name: 'G&A', type: 'expense', normalSide: 'debit', parentCode: null, isPostable: true, statementLineKey: 'pl.opex.ga', active: true },
          { code: '6200', name: 'S&M', type: 'expense', normalSide: 'debit', parentCode: null, isPostable: true, statementLineKey: 'pl.opex.sm', active: true },
        ],
      }),
    );

    const result = await db.transaction((tx) =>
      commitImport(tx, {
        companyId,
        actorId,
        kind: 'actuals',
        sourceFilename: 'erp_mixed_gl.csv',
        csvText: MESSY_CSV,
        occurredAt: OCCURRED_AT,
      }),
    );

    // G1/C6 row accounting: nothing disappears.
    expect(result.rowsIn).toBe(11);
    expect(result.importedCount + result.quarantinedCount).toBe(11);
    expect(result.importedCount).toBe(2);
    expect(result.quarantinedCount).toBe(9);

    const reasons = new Map(result.quarantined.map((q) => [q.rowNo, q.reason]));
    expect(reasons.get(5)).toBe('BLANK_ROW');
    expect(reasons.get(7)).toBe('DUPLICATE_ROW:JE-M-002');
    expect(reasons.get(9)).toBe('AMBIGUOUS_DATE:03/04/2026');
    expect(reasons.get(10)).toBe('UNMAPPED_ACCOUNT:9999');
    expect(reasons.get(12)).toBe('RAGGED_ROW:expected=6:got=3');
    expect(reasons.get(13)).toBe('SUMMARY_TOTAL_ROW');
    expect(reasons.get(6)).toBe('UNBALANCED_ENTRY:JE-M-002');
    expect(reasons.get(8)).toBe('UNBALANCED_ENTRY:JE-M-003');

    // The stored batch matches the returned accounting exactly (D5 trigger agreed at COMMIT).
    const stored = await db.query<{ imported: string; quarantined: string; total: string }>(
      `SELECT COUNT(*) FILTER (WHERE status = 'imported')::text AS imported,
              COUNT(*) FILTER (WHERE status = 'quarantined')::text AS quarantined,
              COUNT(*)::text AS total
         FROM import_row_raw WHERE batch_id = $1`,
      [result.batchId],
    );
    expect(stored.rows[0]).toEqual({ imported: '2', quarantined: '9', total: '11' });

    // Every source row is retained verbatim in raw_payload (§4.4) — quoted commas, embedded
    // newlines, padded codes and accounting parens included, exactly as the export delivered them.
    const rawRow = await db.query<{ raw_payload: { cells: string[] } }>(
      `SELECT raw_payload FROM import_row_raw WHERE batch_id = $1 AND row_no = 2`,
      [result.batchId],
    );
    expect(rawRow.rows[0]?.raw_payload.cells).toEqual([
      'JE-M-001',
      '2026-01-15',
      '  001200 ',
      'Inventory restock, "Batch A"',
      '$ 2,500.00',
      '',
    ]);
    expect(result.totalDebits).toBe('2500.00');
    expect(result.totalCredits).toBe('2500.00');
  }, 120_000);

  it('quarantines rows whose posting date falls outside the company fiscal calendar', async () => {
    const { companyId, actorId } = await makeCompany('Off Calendar Co', 'ENT-OFFCAL');
    await db.transaction((tx) =>
      seedChartOfAccounts(tx, {
        companyId,
        accounts: [
          { code: '1000', name: 'Cash', type: 'asset', normalSide: 'debit', parentCode: null, isPostable: true, statementLineKey: 'bs.asset.cash', active: true },
          { code: '4000', name: 'Revenue', type: 'revenue', normalSide: 'credit', parentCode: null, isPostable: true, statementLineKey: 'pl.revenue.product', active: true },
        ],
      }),
    );

    const csv = [
      'entry_ref,date,account_code,description,debit,credit',
      'JE-IN,2026-02-10,1000,Cash in,100.00,',
      'JE-IN,2026-02-10,4000,Revenue,,100.00',
      'JE-OUT,2027-03-10,1000,Next year cash,50.00,',
      'JE-OUT,2027-03-10,4000,Next year revenue,,50.00',
    ].join('\n');

    const result = await db.transaction((tx) =>
      commitImport(tx, {
        companyId,
        actorId,
        kind: 'actuals',
        sourceFilename: 'off_calendar.csv',
        csvText: csv,
        occurredAt: OCCURRED_AT,
      }),
    );

    expect(result.rowsIn).toBe(4);
    expect(result.importedCount).toBe(2);
    expect(result.quarantinedCount).toBe(2);
    expect(result.quarantined.map((q) => q.reason)).toEqual([
      'PERIOD_NOT_FOUND:2027-03-10',
      'PERIOD_NOT_FOUND:2027-03-10',
    ]);
    expect(result.totalDebits).toBe('100.00');
    expect(result.totalCredits).toBe('100.00');
  }, 120_000);

  it('is all-or-nothing: an aborted transaction leaves no batch, raw row, posting, or audit row', async () => {
    const { companyId, actorId } = await makeCompany('Rollback Co', 'ENT-RB');
    await db.transaction((tx) =>
      seedChartOfAccounts(tx, {
        companyId,
        accounts: [
          { code: '001200', name: 'Inventory', type: 'asset', normalSide: 'debit', parentCode: null, isPostable: true, statementLineKey: 'bs.asset.inventory', active: true },
          { code: '2000', name: 'Accounts Payable', type: 'liability', normalSide: 'credit', parentCode: null, isPostable: true, statementLineKey: 'bs.liability.ap', active: true },
        ],
      }),
    );

    const auditBefore = await verifyCompanyAuditLog(db, companyId);
    expect(auditBefore.checkedCount).toBe(1);

    await expect(
      db.transaction(async (tx) => {
        const committed = await commitImport(tx, {
          companyId,
          actorId,
          kind: 'actuals',
          sourceFilename: 'erp_mixed_gl.csv',
          csvText: MESSY_CSV,
          occurredAt: OCCURRED_AT,
        });
        // The commit is legal in isolation — the caller then aborts the unit of work.
        expect(committed.importedCount).toBe(2);
        throw new Error('caller-aborted');
      }),
    ).rejects.toThrow('caller-aborted');

    const counts = await db.query<{ batches: string; rawRows: string; entries: string; lines: string }>(
      `SELECT (SELECT COUNT(*) FROM import_batch WHERE company_id = $1)::text AS batches,
              (SELECT COUNT(*) FROM import_row_raw WHERE company_id = $1)::text AS "rawRows",
              (SELECT COUNT(*) FROM gl_entry WHERE company_id = $1)::text AS entries,
              (SELECT COUNT(*) FROM gl_line WHERE company_id = $1)::text AS lines`,
      [companyId],
    );
    expect(counts.rows[0]).toEqual({ batches: '0', rawRows: '0', entries: '0', lines: '0' });

    const auditAfter = await verifyCompanyAuditLog(db, companyId);
    expect(auditAfter.valid).toBe(true);
    expect(auditAfter.checkedCount).toBe(1);
  }, 120_000);

  it('rejects an empty import, a missing entity, and an unknown company with typed errors', async () => {
    const { companyId, actorId } = await makeCompany('Error Path Co', 'ENT-ERR');

    await expect(
      db.transaction((tx) =>
        commitImport(tx, {
          companyId,
          actorId,
          kind: 'actuals',
          sourceFilename: 'empty.csv',
          csvText: '   ',
          occurredAt: OCCURRED_AT,
        }),
      ),
    ).rejects.toMatchObject({ code: 'IMPORT_FILE_UNREADABLE', httpStatus: 422 });

    await expect(
      db.transaction((tx) =>
        commitImport(tx, {
          companyId: '00000000-0000-4000-8000-000000000000',
          actorId,
          kind: 'actuals',
          sourceFilename: 'x.csv',
          csvText: 'entry_ref,date,account_code,debit,credit\nA,2026-01-01,1000,1.00,\n',
          occurredAt: OCCURRED_AT,
        }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  }, 120_000);

  it('refuses to seed a chart of accounts with a dangling parent code', async () => {
    const { companyId } = await makeCompany('Dangling Parent Co', 'ENT-DP');
    let caught: unknown = null;
    try {
      await db.transaction((tx) =>
        seedChartOfAccounts(tx, {
          companyId,
          accounts: [
            {
              code: '9999',
              name: 'Orphan',
              type: 'asset',
              normalSide: 'debit',
              parentCode: '0000',
              isPostable: true,
              statementLineKey: 'bs.asset.other_current',
              active: true,
            },
          ],
        }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe('VALIDATION_FAILED');
    expect((caught as AppError).details['parentCode']).toBe('0000');

    const orphans = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM account WHERE company_id = $1 AND code = '9999'`,
      [companyId],
    );
    expect(orphans.rows[0]?.count).toBe('0');
  }, 120_000);
});
