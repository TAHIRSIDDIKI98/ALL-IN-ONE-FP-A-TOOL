import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compare, money, negate, serialize, sum } from '../../../core/money/index.js';
import type { DriverDefinition } from '../../../core/planning/index.js';
import type { CoaSeedAccount } from '../../../shared/import.js';
import type { CompanySetupRequest } from '../../../shared/setup.js';
import type { DatabaseHandle } from '../client.js';
import { commitImport, seedChartOfAccounts } from '../repositories/import.js';
import { createCompanyWorkspace, ensureAppUser, type AppUserIdentity } from '../repositories/setup.js';

/**
 * Shared corpus fixtures for the database test suites. Not a product module: it loads the committed
 * fixtures so every repository test ties out against the SAME source data and the SAME independent
 * BigInt oracle instead of inventing local numbers (§1.6-5, Corpus Gate C7).
 */

export const OCCURRED_AT = '2026-11-25T12:00:00.000Z';

export interface CorpusGlEntry {
  readonly entryId: string;
  readonly entryRef: string;
  readonly postingDate: string;
  readonly totalDebit: string;
  readonly totalCredit: string;
}

export interface CorpusGlLine {
  readonly entryId: string;
  readonly accountCode: string;
  readonly debit: string;
  readonly credit: string;
  readonly statementLineKey: string;
}

export interface CorpusAccount {
  readonly code: string;
  readonly name: string;
  readonly type: CoaSeedAccount['type'];
  readonly normalSide: CoaSeedAccount['normalSide'];
  readonly isControl: boolean;
  readonly parentCode: string | null;
  readonly statementLineKey: CoaSeedAccount['statementLineKey'];
  readonly active: boolean;
}

interface CorpusFile {
  readonly coa: readonly CorpusAccount[];
  readonly glEntries: readonly CorpusGlEntry[];
  readonly glLines: readonly CorpusGlLine[];
  readonly openingBalanceSheet: Readonly<Record<string, string>>;
}

export const CORPUS: CorpusFile = JSON.parse(
  readFileSync(join(process.cwd(), 'fixtures', 'corpus', 'corpus.json'), 'utf8'),
) as CorpusFile;

export interface CorpusOracle {
  readonly trialBalance: { readonly totalDebits: string; readonly totalCredits: string; readonly balanced: boolean };
  readonly pnl: Record<string, string>;
  readonly balanceSheet: Record<string, string>;
  readonly cashFlow: Record<string, string>;
  readonly retainedEarnings: Record<string, string>;
}

/** Independent BigInt oracle — generated without importing /core (Corpus Gate C7). */
export const CORPUS_ORACLE: CorpusOracle = JSON.parse(
  readFileSync(join(process.cwd(), 'fixtures', 'oracles', 'expected', 'corpus_expected.json'), 'utf8'),
) as CorpusOracle;

export const MESSY_CSV = readFileSync(
  join(process.cwd(), 'fixtures', 'messy-exports', 'erp_mixed_gl.csv'),
  'utf8',
);

export function corpusAccounts(): CoaSeedAccount[] {
  return CORPUS.coa.map((account) => ({
    code: account.code,
    name: account.name,
    type: account.type,
    normalSide: account.normalSide,
    parentCode: account.parentCode,
    // The corpus export posts directly to accounts it also flags as control accounts, and M1 models
    // no statement hierarchy, so every corpus account must accept postings. Control/aggregation
    // semantics live in the statement-line rollup, not in `account.is_postable`.
    isPostable: true,
    statementLineKey: account.statementLineKey,
    active: account.active,
  }));
}

/** Renders the corpus GL as a real CSV export (balanced, one row per posting line). */
export function corpusCsv(): string {
  const entryById = new Map(CORPUS.glEntries.map((entry) => [entry.entryId, entry]));
  const rows = ['entry_ref,date,account_code,description,debit,credit'];
  for (const line of CORPUS.glLines) {
    const entry = entryById.get(line.entryId);
    if (entry === undefined) {
      throw new Error(`corpus line references unknown entry ${line.entryId}`);
    }
    const account = CORPUS.coa.find((candidate) => candidate.code === line.accountCode);
    const description = (account?.name ?? 'Corpus posting').replace(/[,"\n]/g, ' ');
    rows.push([entry.entryRef, entry.postingDate, line.accountCode, description, line.debit, line.credit].join(','));
  }
  return `${rows.join('\n')}\n`;
}

/**
 * Renders the corpus opening balance sheet (keyed by statement_line_key) as one balanced opening
 * journal dated the last day of the prior fiscal year, so the statements read model can derive the
 * opening position from the GL alone instead of a second storage of the same numbers.
 */
export function openingBalanceCsv(postingDate = '2025-12-31'): string {
  const rows = ['entry_ref,date,account_code,description,debit,credit'];
  const debits: ReturnType<typeof money>[] = [];
  const credits: ReturnType<typeof money>[] = [];
  for (const [lineKey, amount] of Object.entries(CORPUS.openingBalanceSheet)) {
    const account = CORPUS.coa.find((candidate) => candidate.statementLineKey === lineKey);
    if (account === undefined) {
      throw new Error(`opening balance key ${lineKey} has no corpus account`);
    }
    const contribution = money(amount);
    if (contribution.isZero()) continue;
    // The fixture is keyed by SHEET CONTRIBUTION (assets positive, liabilities and equity positive,
    // contra-assets negative) — the same convention as computeSheetContribution(type, debit, credit)
    // — so the sign is inverted by account TYPE, never by normal side (a contra-asset is an asset
    // whose contribution is negative, not a credit-normal account).
    const debitNormalSheet = account.type === 'asset' || account.type === 'expense';
    let debit = money('0');
    let credit = money('0');
    if (debitNormalSheet) {
      if (contribution.isNegative()) credit = negate(contribution);
      else debit = contribution;
    } else if (contribution.isNegative()) {
      debit = negate(contribution);
    } else {
      credit = contribution;
    }
    debits.push(debit);
    credits.push(credit);
    const description = account.name.replace(/[,"\n]/g, ' ');
    rows.push(
      ['JE-OPEN', postingDate, account.code, description, serialize(debit, 2), serialize(credit, 2)].join(','),
    );
  }
  // An unbalanced opening journal would be quarantined whole by the import gate and would silently
  // hide the real problem, so the fixture refuses to emit one.
  const debitTotal = sum(debits);
  const creditTotal = sum(credits);
  if (compare(debitTotal, creditTotal) !== 0) {
    throw new Error(
      `opening balance sheet does not balance: debits=${serialize(debitTotal)} credits=${serialize(creditTotal)}`,
    );
  }
  return `${rows.join('\n')}\n`;
}

export async function seedCorpusCompany(
  db: DatabaseHandle,
  params: {
    readonly companyName: string;
    readonly entityCode: string;
    readonly actor?: AppUserIdentity;
    /** Opening balances live in the PRIOR fiscal year, so statements need a two-year calendar. */
    readonly priorYear?: boolean;
  },
): Promise<{ companyId: string; actorId: string }> {
  const actor: AppUserIdentity = params.actor ?? {
    firebaseUid: 'uid-import-owner',
    email: 'import-owner@onefpa.test',
    displayName: 'Import Owner',
  };
  const request: CompanySetupRequest = {
    companyName: params.companyName,
    baseCurrency: 'USD',
    calendarKind: '12month',
    fiscalYear: params.priorYear === true ? 2025 : 2026,
    yearCount: params.priorYear === true ? 2 : 1,
    entityCode: params.entityCode,
    entityName: `${params.companyName} HQ`,
  };
  return db.transaction(async (tx) => {
    const workspace = await createCompanyWorkspace(tx, { actor, request, occurredAt: OCCURRED_AT });
    const actorId = await ensureAppUser(tx, actor);
    await seedChartOfAccounts(tx, { companyId: workspace.companyId, accounts: corpusAccounts() });
    return { companyId: workspace.companyId, actorId };
  });
}

/** Seeds the two-year company and imports the opening journal into the prior year. */
export async function seedCorpusWithOpeningBalances(
  db: DatabaseHandle,
  params: { readonly companyName: string; readonly entityCode: string },
): Promise<{ companyId: string; actorId: string }> {
  const seeded = await seedCorpusCompany(db, { ...params, priorYear: true });
  await db.transaction((tx) =>
    commitImport(tx, {
      companyId: seeded.companyId,
      actorId: seeded.actorId,
      kind: 'actuals',
      sourceFilename: 'opening_balance_sheet.csv',
      csvText: openingBalanceCsv(),
      occurredAt: OCCURRED_AT,
    }),
  );
  return seeded;
}

export async function importCorpus(
  db: DatabaseHandle,
  params: { readonly companyId: string; readonly actorId: string; readonly occurredAt?: string },
) {
  return db.transaction((tx) =>
    commitImport(tx, {
      companyId: params.companyId,
      actorId: params.actorId,
      kind: 'actuals',
      sourceFilename: 'corpus_gl.csv',
      csvText: corpusCsv(),
      occurredAt: params.occurredAt ?? OCCURRED_AT,
    }),
  );
}

export interface M2CorpusFile {
  readonly tenantB: {
    readonly company: {
      readonly id: string;
      readonly name: string;
      readonly calendarKind: '454';
      readonly entityCode: string;
      readonly entityName: string;
      readonly currency: string;
    };
    readonly coa: readonly CorpusAccount[];
    readonly glEntries: readonly CorpusGlEntry[];
    readonly glLines: readonly CorpusGlLine[];
    readonly openingBalanceSheet: Readonly<Record<string, string>>;
  };
  readonly rollingForecastCorpus: {
    readonly cutoffPeriod: string;
    readonly scenarioName: string;
    readonly periods: readonly string[];
    readonly forecastDrivers: readonly DriverDefinition[];
    readonly summaryCheck: {
      readonly totalActual: string;
      readonly totalForecast: string;
      readonly totalFullHorizon: string;
      readonly totalMissingCells: number;
    };
  };
  readonly scenarioCorpus: {
    readonly periods: readonly string[];
    readonly scenarios: {
      readonly base: { readonly name: string; readonly drivers: readonly DriverDefinition[]; readonly grandTotal: string };
      readonly upside: { readonly name: string; readonly drivers: readonly DriverDefinition[]; readonly grandTotal: string };
      readonly downside: { readonly name: string; readonly drivers: readonly DriverDefinition[]; readonly grandTotal: string };
    };
    readonly comparisonCheck: {
      readonly baseVsUpsideTotalDelta: string;
      readonly baseVsDownsideTotalDelta: string;
    };
  };
  readonly workforceCorpus: {
    readonly periods: readonly string[];
    readonly positions: readonly {
      readonly positionCode: string;
      readonly title: string;
      readonly departmentName: string;
      readonly accountCode: string;
      readonly startPeriodCode: string;
      readonly endPeriodCode: string | null;
      readonly fte: string;
      readonly annualSalary: string;
      readonly burdenRate: string;
      readonly bonusRate: string;
      readonly rampFirstPeriodPct: string;
      readonly meritPeriodCode: string | null;
      readonly meritIncreasePct: string;
      readonly status: 'active' | 'inactive';
    }[];
  };
}

export const M2_CORPUS: M2CorpusFile = JSON.parse(
  readFileSync(join(process.cwd(), 'fixtures', 'corpus', 'm2_corpus.json'), 'utf8'),
) as M2CorpusFile;

export const M2_CORPUS_ORACLE: {
  readonly tenantB: CorpusOracle;
  readonly rollingForecast: {
    readonly cutoffPeriod: string;
    readonly totalActual: string;
    readonly totalForecast: string;
    readonly totalFullHorizon: string;
    readonly totalMissingCells: number;
  };
  readonly scenarios: {
    readonly baseGrandTotal: string;
    readonly upsideGrandTotal: string;
    readonly downsideGrandTotal: string;
    readonly baseVsUpsideTotalDelta: string;
    readonly baseVsDownsideTotalDelta: string;
  };
  readonly workforce: {
    readonly activePositionCount: number;
    readonly inactiveExcludedCount: number;
    readonly grandTotalCost: string;
    readonly grandTotalFteMonths: string;
  };
} = JSON.parse(
  readFileSync(join(process.cwd(), 'fixtures', 'oracles', 'expected', 'm2_corpus_expected.json'), 'utf8'),
) as {
  readonly tenantB: CorpusOracle;
  readonly rollingForecast: {
    readonly cutoffPeriod: string;
    readonly totalActual: string;
    readonly totalForecast: string;
    readonly totalFullHorizon: string;
    readonly totalMissingCells: number;
  };
  readonly scenarios: {
    readonly baseGrandTotal: string;
    readonly upsideGrandTotal: string;
    readonly downsideGrandTotal: string;
    readonly baseVsUpsideTotalDelta: string;
    readonly baseVsDownsideTotalDelta: string;
  };
  readonly workforce: {
    readonly activePositionCount: number;
    readonly inactiveExcludedCount: number;
    readonly grandTotalCost: string;
    readonly grandTotalFteMonths: string;
  };
};

export function tenantBCsv(): string {
  const entryById = new Map(M2_CORPUS.tenantB.glEntries.map((entry) => [entry.entryId, entry]));
  const rows = ['entry_ref,date,account_code,description,debit,credit'];
  for (const line of M2_CORPUS.tenantB.glLines) {
    const entry = entryById.get(line.entryId);
    if (entry === undefined) {
      throw new Error(`Tenant B corpus line references unknown entry ${line.entryId}`);
    }
    const account = M2_CORPUS.tenantB.coa.find((c) => c.code === line.accountCode);
    const description = (account?.name ?? 'Tenant B posting').replace(/[,"\n]/g, ' ');
    rows.push([entry.entryRef, entry.postingDate, line.accountCode, description, line.debit, line.credit].join(','));
  }
  return `${rows.join('\n')}\n`;
}

export function tenantBOpeningBalanceCsv(postingDate = '2025-12-31'): string {
  const rows = ['entry_ref,date,account_code,description,debit,credit'];
  const debits: ReturnType<typeof money>[] = [];
  const credits: ReturnType<typeof money>[] = [];
  for (const [lineKey, amount] of Object.entries(M2_CORPUS.tenantB.openingBalanceSheet)) {
    const account = M2_CORPUS.tenantB.coa.find((c) => c.statementLineKey === lineKey);
    if (account === undefined) {
      throw new Error(`Tenant B opening key ${lineKey} has no account`);
    }
    const contribution = money(amount);
    if (contribution.isZero()) continue;
    const debitNormalSheet = account.type === 'asset' || account.type === 'expense';
    let debit = money('0');
    let credit = money('0');
    if (debitNormalSheet) {
      if (contribution.isNegative()) credit = negate(contribution);
      else debit = contribution;
    } else if (contribution.isNegative()) {
      debit = negate(contribution);
    } else {
      credit = contribution;
    }
    debits.push(debit);
    credits.push(credit);
    const description = account.name.replace(/[,"\n]/g, ' ');
    rows.push(['NM-OPEN', postingDate, account.code, description, serialize(debit, 2), serialize(credit, 2)].join(','));
  }
  const debitTotal = sum(debits);
  const creditTotal = sum(credits);
  if (compare(debitTotal, creditTotal) !== 0) {
    throw new Error(`Tenant B opening BS unbalanced: ${serialize(debitTotal)} != ${serialize(creditTotal)}`);
  }
  return `${rows.join('\n')}\n`;
}

export async function seedTenantBCompany(
  db: DatabaseHandle,
): Promise<{ companyId: string; actorId: string }> {
  const actor: AppUserIdentity = {
    firebaseUid: 'uid-tenant-b-owner',
    email: 'owner-b@northstar.test',
    displayName: 'Northstar Owner B',
  };
  const request: CompanySetupRequest = {
    companyName: M2_CORPUS.tenantB.company.name,
    baseCurrency: M2_CORPUS.tenantB.company.currency,
    calendarKind: M2_CORPUS.tenantB.company.calendarKind,
    fiscalYear: 2025,
    yearCount: 2,
    entityCode: M2_CORPUS.tenantB.company.entityCode,
    entityName: M2_CORPUS.tenantB.company.entityName,
  };
  return db.transaction(async (tx) => {
    const workspace = await createCompanyWorkspace(tx, { actor, request, occurredAt: OCCURRED_AT });
    const actorId = await ensureAppUser(tx, actor);
    const coa: CoaSeedAccount[] = M2_CORPUS.tenantB.coa.map((a) => ({
      code: a.code,
      name: a.name,
      type: a.type,
      normalSide: a.normalSide,
      parentCode: a.parentCode,
      isPostable: true,
      statementLineKey: a.statementLineKey,
      active: a.active,
    }));
    await seedChartOfAccounts(tx, { companyId: workspace.companyId, accounts: coa });
    return { companyId: workspace.companyId, actorId };
  });
}

export async function seedTenantBWithOpeningAndActuals(
  db: DatabaseHandle,
): Promise<{ companyId: string; actorId: string }> {
  const seeded = await seedTenantBCompany(db);

  await db.transaction((tx) =>
    commitImport(tx, {
      companyId: seeded.companyId,
      actorId: seeded.actorId,
      kind: 'actuals',
      sourceFilename: 'tenant_b_opening.csv',
      csvText: tenantBOpeningBalanceCsv(),
      occurredAt: OCCURRED_AT,
    }),
  );

  await db.transaction((tx) =>
    commitImport(tx, {
      companyId: seeded.companyId,
      actorId: seeded.actorId,
      kind: 'actuals',
      sourceFilename: 'tenant_b_gl.csv',
      csvText: tenantBCsv(),
      occurredAt: OCCURRED_AT,
    }),
  );

  return seeded;
}
