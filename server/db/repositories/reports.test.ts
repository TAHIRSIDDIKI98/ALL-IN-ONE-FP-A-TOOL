import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { money } from '../../../core/money/index.js';
import { verifyCompanyAuditLog } from '../../audit/index.js';
import { openSandboxDatabase, type DatabaseHandle } from '../client.js';
import { applyMigrations } from '../migrate.js';
import { AccountDrilldownSchema, TrialBalanceReportSchema, FinancialStatementsSchema } from '../../../shared/reports.js';
import { getAccountDrilldown, getFinancialStatements, getTrialBalance } from './reports.js';
import {
  CORPUS,
  CORPUS_ORACLE,
  M2_CORPUS,
  M2_CORPUS_ORACLE,
  OCCURRED_AT,
  corpusCsv,
  importCorpus,
  seedCorpusCompany,
  seedCorpusWithOpeningBalances,
  seedTenantBCompany,
  tenantBCsv,
  tenantBOpeningBalanceCsv,
} from '../testing/corpus-fixtures.js';
import { createConnectorConfig, listConnectorsOverview } from './connectors.js';
import { getDashboardSummary } from './dashboards.js';
import { commitImport } from './import.js';
import { commitDriverPlan, getScenarioComparison, listScenarios } from './planning.js';
import { createApprovalTask, listWorkflowOverview } from './workflow.js';
import { commitWorkforcePlan, getWorkforceWorkspace } from './workforce.js';

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

function oracleValue(section: Record<string, string>, key: string): string {
  const value = section[key];
  if (value === undefined) throw new Error(`oracle is missing ${key}`);
  return value;
}

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

describe('WI-0018 articulating statements read model (G3, A1–A5)', () => {
  it('builds P&L, balance sheet, cash flow and RE roll-forward that tie to the independent oracle', async () => {
    const seeded = await seedCorpusWithOpeningBalances(db, {
      companyName: 'Statements Co',
      entityCode: 'ENT-STMT',
    });
    await importCorpus(db, { companyId: seeded.companyId, actorId: seeded.actorId });

    const statements = await getFinancialStatements(db, {
      companyId: seeded.companyId,
      throughPeriodCode: 'P12',
      fiscalYear: 2026,
    });

    expect(() => FinancialStatementsSchema.parse(statements)).not.toThrow();
    expect(statements.range).toEqual({
      fromPeriodCode: 'P01',
      throughPeriodCode: 'P12',
      fiscalYear: 2026,
    });

    // P&L line by line against the BigInt oracle.
    for (const [field, expected] of Object.entries(CORPUS_ORACLE.pnl)) {
      expect(statements.pnl[field as keyof typeof statements.pnl], field).toBe(expected);
    }
    // Balance sheet from the opening journal + period activity.
    for (const [field, expected] of Object.entries(CORPUS_ORACLE.balanceSheet)) {
      if (field === 'balanced') continue;
      expect(statements.balanceSheet[field as keyof typeof statements.balanceSheet], field).toBe(expected);
    }
    expect(statements.balanceSheet.isBalanced).toBe(true);
    // Indirect cash flow, including the beginning cash that comes from the prior-year journal.
    for (const [field, expected] of Object.entries(CORPUS_ORACLE.cashFlow)) {
      if (field === 'tiesToBsCash') continue;
      expect(statements.cashFlow[field as keyof typeof statements.cashFlow], field).toBe(expected);
    }
    // Retained-earnings roll-forward (A4).
    expect(statements.retainedEarnings.opening).toBe(CORPUS_ORACLE.retainedEarnings.opening);
    expect(statements.retainedEarnings.netIncome).toBe(CORPUS_ORACLE.retainedEarnings.netIncome);
    expect(statements.retainedEarnings.distributions).toBe(CORPUS_ORACLE.retainedEarnings.distributions);
    expect(statements.retainedEarnings.closingTotal).toBe(CORPUS_ORACLE.retainedEarnings.closingTotal);
    expect(statements.retainedEarnings.rollForwardValid).toBe(true);

    // A1–A5 must all pass, and the two source files are both attributable.
    expect(statements.articulation.valid).toBe(true);
    expect(statements.articulation.checks.map((check) => check.id)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5']);
    for (const check of statements.articulation.checks) {
      expect(check.passed, `${check.id} ${check.detail}`).toBe(true);
    }
    expect(statements.sources.map((source) => source.sourceFilename)).toEqual([
      'opening_balance_sheet.csv',
      'corpus_gl.csv',
    ]);
  }, 180_000);

  it('serves year-to-date statements: every month articulates and the year closes the annual numbers', async () => {
    const seeded = await seedCorpusWithOpeningBalances(db, {
      companyName: 'Range Co',
      entityCode: 'ENT-RANGE',
    });
    await importCorpus(db, { companyId: seeded.companyId, actorId: seeded.actorId });

    let previousNetIncome = money('0');
    let latest = await getFinancialStatements(db, {
      companyId: seeded.companyId,
      throughPeriodCode: 'P01',
      fiscalYear: 2026,
    });

    for (let periodNo = 1; periodNo <= 12; periodNo += 1) {
      const code = `P${String(periodNo).padStart(2, '0')}`;
      const ytd = await getFinancialStatements(db, {
        companyId: seeded.companyId,
        throughPeriodCode: code,
        fiscalYear: 2026,
      });
      // YTD always starts at the fiscal year's first period, whatever month is requested.
      expect(ytd.range, code).toEqual({
        fromPeriodCode: 'P01',
        throughPeriodCode: code,
        fiscalYear: 2026,
      });
      // Opening balances never move with the closing month: they come from the prior year only.
      expect(ytd.retainedEarnings.opening, code).toBe(CORPUS_ORACLE.retainedEarnings.opening);
      for (const check of ytd.articulation.checks) {
        expect(check.passed, `${code} ${check.id} ${check.detail}`).toBe(true);
      }
      // Earnings accumulate monotonically and the balance sheet stays balanced at every month end.
      expect(money(ytd.pnl.netIncome).gte(previousNetIncome), code).toBe(true);
      expect(ytd.balanceSheet.isBalanced, code).toBe(true);
      previousNetIncome = money(ytd.pnl.netIncome);
      latest = ytd;
    }

    // The December YTD bundle is the annual statement set that ties to the oracle.
    expect(latest.pnl.netIncome).toBe(CORPUS_ORACLE.pnl.netIncome);
    expect(latest.pnl.revenue).toBe(CORPUS_ORACLE.pnl.revenue);
    expect(latest.balanceSheet.cashBalance).toBe(CORPUS_ORACLE.balanceSheet.cashBalance);
    expect(latest.cashFlow.endingCash).toBe(CORPUS_ORACLE.cashFlow.endingCash);
    expect(latest.retainedEarnings.closingTotal).toBe(CORPUS_ORACLE.retainedEarnings.closingTotal);

    // An adjustment-only or unknown period is still a typed error, never a silent fallback.
    await expect(
      getFinancialStatements(db, {
        companyId: seeded.companyId,
        throughPeriodCode: 'P99',
        fiscalYear: 2026,
      }),
    ).rejects.toMatchObject({ code: 'PERIOD_NOT_FOUND', httpStatus: 422 });
  }, 180_000);

  it('refuses an ambiguous period code in a multi-year calendar instead of guessing a year', async () => {
    const seeded = await seedCorpusWithOpeningBalances(db, {
      companyName: 'Ambiguous Co',
      entityCode: 'ENT-AMB',
    });

    // P01 exists in FY2025 and FY2026; without a fiscal year the request is ambiguous.
    await expect(
      getTrialBalance(db, { companyId: seeded.companyId, throughPeriodCode: 'P01' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', httpStatus: 422 });

    const scoped = await getTrialBalance(db, {
      companyId: seeded.companyId,
      throughPeriodCode: 'P01',
      fiscalYear: 2026,
    });
    expect(scoped.throughPeriodCode).toBe('P01');
    expect(scoped.isBalanced).toBe(true);

    const priorYear = await getTrialBalance(db, {
      companyId: seeded.companyId,
      throughPeriodCode: 'P12',
      fiscalYear: 2025,
    });
    // The opening journal is the only prior-year posting: hand-computed from
    // fixtures/corpus/corpus.json -> openingBalanceSheet, gross assets 4,950,000 on the debit side
    // against liabilities 1,800,000 + equity 2,700,000 + accumulated depreciation 450,000.
    expect(priorYear.totalDebit).toBe('4950000.00');
    expect(priorYear.totalCredit).toBe('4950000.00');
    expect(priorYear.isBalanced).toBe(true);
  }, 180_000);
});

describe('WI-0041 M2 Coherent Corpus v2 — Tenant B DB tie-out & cross-tenant isolation (C3, C4, D2, TST5)', () => {
  it('ties Tenant B NRF 454 statements, scenarios, and workforce DB outputs to independent oracle with zero cross-tenant leakage into Tenant A', async () => {
    const tenantB = await seedTenantBCompany(db);

    await db.transaction((tx) =>
      commitImport(tx, {
        companyId: tenantB.companyId,
        actorId: tenantB.actorId,
        kind: 'actuals',
        sourceFilename: 'tenant_b_gl.csv',
        csvText: tenantBCsv(),
        occurredAt: OCCURRED_AT,
      }),
    );

    const tenantBTb = await getTrialBalance(db, { companyId: tenantB.companyId });
    expect(tenantBTb.isBalanced).toBe(true);
    expect(tenantBTb.totalDebit).toBe(M2_CORPUS_ORACLE.tenantB.trialBalance.totalDebits);
    expect(tenantBTb.totalCredit).toBe(M2_CORPUS_ORACLE.tenantB.trialBalance.totalCredits);
    expect(tenantBTb.rows.some((r) => r.code === '001400')).toBe(true);
    expect(tenantBTb.rows.some((r) => r.code === '1400')).toBe(true);

    await db.transaction((tx) =>
      commitImport(tx, {
        companyId: tenantB.companyId,
        actorId: tenantB.actorId,
        kind: 'actuals',
        sourceFilename: 'tenant_b_opening.csv',
        csvText: tenantBOpeningBalanceCsv(),
        occurredAt: OCCURRED_AT,
      }),
    );

    const tenantBStatements = await getFinancialStatements(db, {
      companyId: tenantB.companyId,
      throughPeriodCode: 'P12',
      fiscalYear: 2026,
    });
    expect(() => FinancialStatementsSchema.parse(tenantBStatements)).not.toThrow();
    expect(tenantBStatements.pnl.revenue).toBe(M2_CORPUS_ORACLE.tenantB.pnl.revenue);
    expect(tenantBStatements.pnl.netIncome).toBe(M2_CORPUS_ORACLE.tenantB.pnl.netIncome);
    expect(tenantBStatements.balanceSheet.totalAssets).toBe(M2_CORPUS_ORACLE.tenantB.balanceSheet.totalAssets);
    expect(tenantBStatements.balanceSheet.cashBalance).toBe(M2_CORPUS_ORACLE.tenantB.balanceSheet.cashBalance);
    expect(tenantBStatements.cashFlow.endingCash).toBe(M2_CORPUS_ORACLE.tenantB.cashFlow.endingCash);
    expect(tenantBStatements.retainedEarnings.closingTotal).toBe(
      M2_CORPUS_ORACLE.tenantB.retainedEarnings.closingTotal,
    );
    expect(tenantBStatements.articulation.valid).toBe(true);

    // Seed Tenant B planning scenarios, workforce roster, approval task, and connector
    const baseCommit = await db.transaction((tx) =>
      commitDriverPlan(tx, {
        companyId: tenantB.companyId,
        actorId: tenantB.actorId,
        input: {
          fiscalYear: 2026,
          scenarioName: M2_CORPUS.scenarioCorpus.scenarios.base.name,
          scenarioKind: 'budget',
          periods: [...M2_CORPUS.scenarioCorpus.periods],
          drivers: [...M2_CORPUS.scenarioCorpus.scenarios.base.drivers],
        },
        occurredAt: OCCURRED_AT,
      }),
    );
    expect(baseCommit.grandTotal).toBe(M2_CORPUS_ORACLE.scenarios.baseGrandTotal);

    const upsideCommit = await db.transaction((tx) =>
      commitDriverPlan(tx, {
        companyId: tenantB.companyId,
        actorId: tenantB.actorId,
        input: {
          fiscalYear: 2026,
          scenarioName: M2_CORPUS.scenarioCorpus.scenarios.upside.name,
          scenarioKind: 'forecast',
          periods: [...M2_CORPUS.scenarioCorpus.periods],
          drivers: [...M2_CORPUS.scenarioCorpus.scenarios.upside.drivers],
        },
        occurredAt: OCCURRED_AT,
      }),
    );
    expect(upsideCommit.grandTotal).toBe(M2_CORPUS_ORACLE.scenarios.upsideGrandTotal);

    const scenarioCmp = await getScenarioComparison(db, {
      companyId: tenantB.companyId,
      fiscalYear: 2026,
      baseScenarioName: M2_CORPUS.scenarioCorpus.scenarios.base.name,
      targetScenarioName: M2_CORPUS.scenarioCorpus.scenarios.upside.name,
    });
    expect(scenarioCmp.totalDelta).toBe(M2_CORPUS_ORACLE.scenarios.baseVsUpsideTotalDelta);

    const wfCommit = await db.transaction((tx) =>
      commitWorkforcePlan(tx, {
        companyId: tenantB.companyId,
        actorId: tenantB.actorId,
        request: {
          fiscalYear: 2026,
          scenarioName: 'Tenant B Workforce Plan',
          scenarioKind: 'forecast',
          saveRoster: true,
          periods: [...M2_CORPUS.workforceCorpus.periods],
          positions: M2_CORPUS.workforceCorpus.positions.map((p) => ({ ...p })),
        },
        occurredAt: OCCURRED_AT,
      }),
    );
    expect(wfCommit.preview.grandTotalFteMonths).toBe(M2_CORPUS_ORACLE.workforce.grandTotalFteMonths);
    expect(wfCommit.preview.grandTotalCost).toBe(M2_CORPUS_ORACLE.workforce.grandTotalCost);
    expect(wfCommit.commit.grandTotal).toBe(M2_CORPUS_ORACLE.workforce.grandTotalCost);

    await db.transaction((tx) =>
      createApprovalTask(tx, {
        companyId: tenantB.companyId,
        actorId: tenantB.actorId,
        request: {
          planVersionId: upsideCommit.planVersionId,
          title: 'Tenant B Upside Approval',
        },
        occurredAt: OCCURRED_AT,
      }),
    );

    await db.transaction((tx) =>
      createConnectorConfig(tx, {
        companyId: tenantB.companyId,
        actorId: tenantB.actorId,
        request: {
          sourceSystem: 'google_sheets',
          name: 'Tenant B Plant Feed',
          externalRef: 'sheet-tenant-b-01',
          credentialSecret: 'synthetic-tenant-b-secret',
        },
        occurredAt: OCCURRED_AT,
      }),
    );

    // TST5 / D2: Verify zero leakage into Tenant A (`companyId`, `actorId` from Reports Co)
    const tenantATb = await getTrialBalance(db, { companyId });
    expect(tenantATb.totalDebit).toBe(CORPUS_ORACLE.trialBalance.totalDebits);
    expect(tenantATb.rows.some((r) => r.code === '001400')).toBe(false);

    const tenantAScenarios = await listScenarios(db, companyId);
    expect(tenantAScenarios.scenarios.some((s) => s.name === 'Upside Forecast')).toBe(false);
    expect(tenantAScenarios.scenarios.some((s) => s.name === 'Tenant B Workforce Plan')).toBe(false);

    const tenantAWorkflow = await listWorkflowOverview(db, { companyId, actorId });
    expect(tenantAWorkflow.tasks.some((t) => t.title === 'Tenant B Upside Approval')).toBe(false);

    const tenantAConnectors = await listConnectorsOverview(db, companyId);
    expect(tenantAConnectors.connectors.some((c) => c.name === 'Tenant B Plant Feed')).toBe(false);

    const tenantAWorkforce = await getWorkforceWorkspace(db, { companyId, actorId, fiscalYear: 2026 });
    expect(tenantAWorkforce.positions.some((p) => p.positionCode === 'WF-ENG-01')).toBe(false);

    const tenantADashboard = await getDashboardSummary(db, {
      companyId,
      throughPeriodCode: 'P12',
      fiscalYear: 2026,
    });
    expect(tenantADashboard.companyId).toBe(companyId);
    expect(tenantADashboard.companyName).toBe('Reports Co');

    // Cross-tenant RBAC refusal: Tenant A actor cannot access Tenant B workflow or workforce
    await expect(
      listWorkflowOverview(db, { companyId: tenantB.companyId, actorId }),
    ).rejects.toMatchObject({ code: 'TENANT_FORBIDDEN', httpStatus: 403 });
    await expect(
      getWorkforceWorkspace(db, { companyId: tenantB.companyId, actorId }),
    ).rejects.toMatchObject({ code: 'TENANT_FORBIDDEN', httpStatus: 403 });
  }, 180_000);
});

