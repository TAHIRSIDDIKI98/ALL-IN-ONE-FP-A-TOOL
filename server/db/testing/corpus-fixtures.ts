import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

export async function seedCorpusCompany(
  db: DatabaseHandle,
  params: { readonly companyName: string; readonly entityCode: string; readonly actor?: AppUserIdentity },
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
    fiscalYear: 2026,
    yearCount: 1,
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
