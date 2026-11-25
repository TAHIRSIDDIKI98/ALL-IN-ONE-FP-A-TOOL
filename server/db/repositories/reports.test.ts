import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { money } from '../../../core/money/index.js';
import { AccountDrilldownSchema, TrialBalanceReportSchema } from '../../../shared/reports.js';
import { verifyCompanyAuditLog } from '../../audit/index.js';
import { openSandboxDatabase, type DatabaseHandle } from '../client.js';
import { applyMigrations } from '../migrate.js';
import { getAccountDrilldown, getTrialBalance } from './reports.js';
import {
  CORPUS,
  CORPUS_ORACLE,
  corpusCsv,
  importCorpus,
  seedCorpusCompany,
} from '../testing/corpus-fixtures.js';
import { commitImport } from './import.js';

let db: DatabaseHandle;
let companyId: string;
let actorId: string;

beforeAll(async () => {
  db = await openSandboxDatabase();
  await applyMigrations(db);
  const seeded = await seedCorpusCompany(db, { companyName: 'Reports Co', entityCode: 'ENT-REP' });
  companyId = seeded.companyId;
  actorId = seeded.actorId;
  await importCorpus(db, { companyId, actorId });
}, 180_000);

afterAll(async () => {
  await db.close();
});

describe('WI-0016 trial balance and drill-to-source read model (G2, G3, G6)', () => {
  it('ties the trial balance to the independent BigInt oracle and stays balanced', async () => {
    const tb = await getTrialBalance(db, { companyId });

    expect(tb.companyId).toBe(companyId);
    expect(tb.throughPeriodCode).toBeNull();
    expect(tb.isBalanced).toBe(true);
    expect(tb.unbalancedEntryIds).toEqual([]);
    expect(tb.totalDebit).toBe(CORPUS_ORACLE.trialBalance.totalDebits);
    expect(tb.totalCredit).toBe(CORPUS_ORACLE.trialBalance.totalCredits);
    expect(money(tb.totalDebit).eq(money(tb.totalCredit))).toBe(true);

    // One row per active chart account, ordered by code, and the row debits/credits sum to the total.
    expect(tb.rows).toHaveLength(CORPUS.coa.filter((account) => account.active).length);
    const codes = tb.rows.map((row) => row.code);
    expect(codes).toEqual([...codes].sort((a, b) => a.localeCompare(b)));
    const rowDebits = tb.rows.reduce((acc, row) => acc.plus(money(row.totalDebit)), money('0'));
    expect(rowDebits.toFixed(2)).toBe(tb.totalDebit);

    // The wire contract accepts the payload: money is canonical strings, every key is present.
    expect(() => TrialBalanceReportSchema.parse(tb)).not.toThrow();

    // Every posting is attributable to the one active corpus batch.
    expect(tb.sources).toHaveLength(1);
    expect(tb.sources[0]?.sourceFilename).toBe('corpus_gl.csv');
    expect(tb.sources[0]?.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  }, 120_000);

  it('drills an account down to the file, batch, row number and raw source cells (G6)', async () => {
    const drill = await getAccountDrilldown(db, { companyId, accountCode: '1000' });
    const tb = await getTrialBalance(db, { companyId });
    const tbRow = tb.rows.find((row) => row.code === '1000');

    expect(drill.accountCode).toBe('1000');
    expect(drill.accountName).toBe(tbRow?.name);
    expect(drill.totalDebit).toBe(tbRow?.totalDebit);
    expect(drill.totalCredit).toBe(tbRow?.totalCredit);
    expect(drill.rows.length).toBeGreaterThan(0);

    for (const row of drill.rows) {
      expect(row.sourceFilename).toBe('corpus_gl.csv');
      expect(row.sourceHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.rowNo).toBeGreaterThanOrEqual(2);
      expect(row.rawCells[2]).toBe('1000');
      expect(row.periodCode).toMatch(/^P\d{2}$/);
      expect(row.entryDate).toMatch(/^2026-/);
    }

    expect(() => AccountDrilldownSchema.parse(drill)).not.toThrow();

    // The drill IS the source of the trial-balance row: its lines add back up exactly.
    const debit = drill.rows.reduce((acc, row) => acc.plus(money(row.debit)), money('0'));
    const credit = drill.rows.reduce((acc, row) => acc.plus(money(row.credit)), money('0'));
    expect(debit.equals(rowDebitsOf(tb, '1000'))).toBe(true);
    expect(credit.equals(rowCreditsOf(tb, '1000'))).toBe(true);
  }, 120_000);

  it('never counts a replaced batch, so a re-import leaves the trial balance unchanged', async () => {
    const before = await getTrialBalance(db, { companyId });

    const second = await db.transaction((tx) =>
      commitImport(tx, {
        companyId,
        actorId,
        kind: 'actuals',
        sourceFilename: 'corpus_gl.csv',
        csvText: corpusCsv(),
        occurredAt: '2026-11-25T12:30:00.000Z',
      }),
    );
    expect(second.replacedBatchId).not.toBeNull();

    const after = await getTrialBalance(db, { companyId });
    expect(after.totalDebit).toBe(before.totalDebit);
    expect(after.totalCredit).toBe(before.totalCredit);
    expect(after.rows).toEqual(before.rows);
    expect(after.sources).toHaveLength(1);
    expect(after.sources[0]?.batchId).toBe(second.batchId);

    const chain = await verifyCompanyAuditLog(db, companyId);
    expect(chain.valid).toBe(true);
  }, 120_000);

  it('scopes the trial balance to a period code and reports an empty calendar half honestly', async () => {
    const full = await getTrialBalance(db, { companyId });
    const firstMonth = await getTrialBalance(db, { companyId, throughPeriodCode: 'P01' });

    expect(firstMonth.throughPeriodCode).toBe('P01');
    expect(firstMonth.isBalanced).toBe(true);
    // A month cannot report more activity than the full year, and never a negative total.
    expect(money(firstMonth.totalDebit).lte(money(full.totalDebit))).toBe(true);
    expect(money(firstMonth.totalDebit).gte(0)).toBe(true);

    // An unknown period code is a typed 422 from the error catalog, never a silently widened query.
    await expect(
      getTrialBalance(db, { companyId, throughPeriodCode: 'P99' }),
    ).rejects.toMatchObject({ code: 'PERIOD_NOT_FOUND', httpStatus: 422 });

    // An unknown account is a typed 404 too.
    await expect(
      getAccountDrilldown(db, { companyId, accountCode: 'ZZZZ' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', httpStatus: 404 });
  }, 120_000);

  it('does not leak another company postings into a trial balance (D2)', async () => {
    const other = await seedCorpusCompany(db, { companyName: 'Empty Reports Co', entityCode: 'ENT-EMPTY' });
    const emptyTb = await getTrialBalance(db, { companyId: other.companyId });

    expect(emptyTb.totalDebit).toBe('0.00');
    expect(emptyTb.totalCredit).toBe('0.00');
    expect(emptyTb.isBalanced).toBe(true);
    expect(emptyTb.sources).toEqual([]);
    expect(emptyTb.rows.length).toBeGreaterThan(0);
    for (const row of emptyTb.rows) {
      expect(row.totalDebit).toBe('0.00');
      expect(row.totalCredit).toBe('0.00');
      expect(row.naturalActivity).toBe('0.00');
    }
  }, 120_000);
});

function rowDebitsOf(tb: Awaited<ReturnType<typeof getTrialBalance>>, code: string) {
  const row = tb.rows.find((candidate) => candidate.code === code);
  if (row === undefined) throw new Error(`no trial-balance row for ${code}`);
  return money(row.totalDebit);
}

function rowCreditsOf(tb: Awaited<ReturnType<typeof getTrialBalance>>, code: string) {
  const row = tb.rows.find((candidate) => candidate.code === code);
  if (row === undefined) throw new Error(`no trial-balance row for ${code}`);
  return money(row.totalCredit);
}
