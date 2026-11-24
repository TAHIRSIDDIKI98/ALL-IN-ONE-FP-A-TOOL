/**
 * Independent BigInt minor-unit oracle verifier/generator (MASTER_PROMPT §7.5, C4).
 * STRICT RULE: Zero imports from /core, /shared, /server, or decimal.js.
 * Arithmetic is implemented strictly with native JS BigInt integer cents.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

interface RawCorpusAccount {
  readonly code: string;
  readonly type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  readonly normalSide: 'debit' | 'credit';
  readonly statementLineKey: string;
}

interface RawCorpusGlLine {
  readonly entryId: string;
  readonly accountCode: string;
  readonly statementLineKey: string;
  readonly debitMinor: number;
  readonly creditMinor: number;
}

interface RawCorpus {
  readonly meta: {
    readonly generatorVersion: string;
    readonly seed: number;
    readonly demoLabel: string;
  };
  readonly coa: readonly RawCorpusAccount[];
  readonly openingBalanceSheetMinor: Readonly<Record<string, number>>;
  readonly glLines: readonly RawCorpusGlLine[];
}

function formatCents(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${neg ? '-' : ''}${whole.toString()}.${frac}`;
}

export function computeIndependentCorpusOracle(corpus: RawCorpus) {
  const acctByCode = new Map<string, RawCorpusAccount>(corpus.coa.map((a) => [a.code, a]));

  let totalDebits = 0n;
  let totalCredits = 0n;
  const entryDebits = new Map<string, bigint>();
  const entryCredits = new Map<string, bigint>();
  const acctDebits = new Map<string, bigint>();
  const acctCredits = new Map<string, bigint>();

  for (const line of corpus.glLines) {
    const d = BigInt(line.debitMinor);
    const c = BigInt(line.creditMinor);
    if (d < 0n || c < 0n) {
      throw new Error(`ORACLE_NEGATIVE_SIDE: entry=${line.entryId}`);
    }
    if ((d === 0n) === (c === 0n)) {
      throw new Error(`ORACLE_INVALID_SIDES: entry=${line.entryId}`);
    }
    totalDebits += d;
    totalCredits += c;
    entryDebits.set(line.entryId, (entryDebits.get(line.entryId) ?? 0n) + d);
    entryCredits.set(line.entryId, (entryCredits.get(line.entryId) ?? 0n) + c);
    acctDebits.set(line.accountCode, (acctDebits.get(line.accountCode) ?? 0n) + d);
    acctCredits.set(line.accountCode, (acctCredits.get(line.accountCode) ?? 0n) + c);
  }

  for (const [eid, d] of entryDebits.entries()) {
    const c = entryCredits.get(eid) ?? 0n;
    if (d !== c) {
      throw new Error(`ORACLE_UNBALANCED_ENTRY: ${eid} debit=${d} credit=${c}`);
    }
  }

  // P&L natural sums by statement_line_key
  const pnlByKey = new Map<string, bigint>();
  const bsPeriodDeltas = new Map<string, bigint>();

  for (const acct of corpus.coa) {
    const d = acctDebits.get(acct.code) ?? 0n;
    const c = acctCredits.get(acct.code) ?? 0n;
    const nat = acct.normalSide === 'debit' ? d - c : c - d;
    const sheetContrib = acct.type === 'asset' || acct.type === 'expense' ? d - c : c - d;

    if (acct.statementLineKey.startsWith('pl.')) {
      pnlByKey.set(acct.statementLineKey, (pnlByKey.get(acct.statementLineKey) ?? 0n) + nat);
    } else if (acct.statementLineKey.startsWith('bs.')) {
      bsPeriodDeltas.set(acct.statementLineKey, (bsPeriodDeltas.get(acct.statementLineKey) ?? 0n) + sheetContrib);
    }
  }

  let revenue = 0n;
  let cogs = 0n;
  let opex = 0n;
  let depreciation = 0n;
  let nonOperatingNet = 0n;
  let tax = 0n;

  for (const [key, val] of pnlByKey.entries()) {
    if (key.startsWith('pl.revenue.')) revenue += val;
    else if (key.startsWith('pl.cogs.')) cogs += val;
    else if (key.startsWith('pl.opex.')) opex += val;
    else if (key.startsWith('pl.da.')) depreciation += val;
    else if (key === 'pl.nonop.interest_income') nonOperatingNet += val;
    else if (key.startsWith('pl.nonop.')) nonOperatingNet -= val;
    else if (key.startsWith('pl.tax.')) tax += val;
  }

  const grossProfit = revenue - cogs;
  const ebitda = grossProfit - opex;
  const ebit = ebitda - depreciation;
  const ebt = ebit + nonOperatingNet;
  const netIncome = ebt - tax;

  // Closing Balance Sheet
  const bsKeys = new Set<string>([
    ...Object.keys(corpus.openingBalanceSheetMinor),
    ...bsPeriodDeltas.keys(),
  ]);
  const bsClosing = new Map<string, bigint>();
  for (const key of bsKeys) {
    if (key === 'bs.equity.current_net_income') continue;
    const open = BigInt(corpus.openingBalanceSheetMinor[key] ?? 0);
    const delta = bsPeriodDeltas.get(key) ?? 0n;
    bsClosing.set(key, open + delta);
  }
  bsClosing.set('bs.equity.current_net_income', netIncome);

  const CURRENT_ASSETS = new Set(['bs.asset.cash', 'bs.asset.ar', 'bs.asset.inventory', 'bs.asset.other_current']);
  const CURRENT_LIAB = new Set(['bs.liability.ap', 'bs.liability.accrued', 'bs.liability.deferred_rev', 'bs.liability.short_term_debt']);

  let currentAssets = 0n;
  let nonCurrentAssets = 0n;
  let currentLiabilities = 0n;
  let nonCurrentLiabilities = 0n;
  let totalEquity = 0n;

  for (const [key, val] of bsClosing.entries()) {
    if (key.startsWith('bs.asset.')) {
      if (CURRENT_ASSETS.has(key)) currentAssets += val;
      else nonCurrentAssets += val;
    } else if (key.startsWith('bs.liability.')) {
      if (CURRENT_LIAB.has(key)) currentLiabilities += val;
      else nonCurrentLiabilities += val;
    } else if (key.startsWith('bs.equity.')) {
      totalEquity += val;
    }
  }

  const totalAssets = currentAssets + nonCurrentAssets;
  const totalLiabilities = currentLiabilities + nonCurrentLiabilities;
  const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;
  const bsCash = bsClosing.get('bs.asset.cash') ?? 0n;

  // Indirect Cash Flow (BigInt)
  const openCash = BigInt(corpus.openingBalanceSheetMinor['bs.asset.cash'] ?? 0);
  const openNonCashCa =
    BigInt(corpus.openingBalanceSheetMinor['bs.asset.ar'] ?? 0) +
    BigInt(corpus.openingBalanceSheetMinor['bs.asset.inventory'] ?? 0) +
    BigInt(corpus.openingBalanceSheetMinor['bs.asset.other_current'] ?? 0);
  const endNonCashCa =
    (bsClosing.get('bs.asset.ar') ?? 0n) +
    (bsClosing.get('bs.asset.inventory') ?? 0n) +
    (bsClosing.get('bs.asset.other_current') ?? 0n);

  const openCl =
    BigInt(corpus.openingBalanceSheetMinor['bs.liability.ap'] ?? 0) +
    BigInt(corpus.openingBalanceSheetMinor['bs.liability.accrued'] ?? 0) +
    BigInt(corpus.openingBalanceSheetMinor['bs.liability.deferred_rev'] ?? 0) +
    BigInt(corpus.openingBalanceSheetMinor['bs.liability.short_term_debt'] ?? 0);
  const endCl = currentLiabilities;

  const daAddback = -(bsPeriodDeltas.get('bs.asset.ppe_accum_depr') ?? 0n);
  const deltaWc = (endCl - openCl) - (endNonCashCa - openNonCashCa);
  const cfo = netIncome + daAddback + deltaWc;
  const cfi = -((bsPeriodDeltas.get('bs.asset.ppe_gross') ?? 0n) + (bsPeriodDeltas.get('bs.asset.other_noncurrent') ?? 0n));
  const distributionsDelta = bsPeriodDeltas.get('bs.equity.distributions') ?? 0n;
  const cff =
    (bsPeriodDeltas.get('bs.liability.long_term_debt') ?? 0n) +
    (bsPeriodDeltas.get('bs.liability.other_noncurrent') ?? 0n) +
    (bsPeriodDeltas.get('bs.equity.common_stock') ?? 0n) +
    distributionsDelta;
  const cfEndingCash = openCash + cfo + cfi + cff;

  const openRe = BigInt(corpus.openingBalanceSheetMinor['bs.equity.retained_earnings'] ?? 0);
  const distributionsMag = -distributionsDelta;
  const closingReTotal =
    (bsClosing.get('bs.equity.retained_earnings') ?? 0n) +
    (bsClosing.get('bs.equity.current_net_income') ?? 0n) -
    distributionsMag;

  void acctByCode;

  return {
    derivationMethod: 'Independent JS BigInt minor-unit integer summation with zero /core imports',
    approvedDate: '2026-11-24',
    generatorVersion: corpus.meta.generatorVersion,
    seed: corpus.meta.seed,
    trialBalance: {
      totalDebits: formatCents(totalDebits),
      totalCredits: formatCents(totalCredits),
      balanced: totalDebits === totalCredits,
    },
    pnl: {
      revenue: formatCents(revenue),
      cogs: formatCents(cogs),
      grossProfit: formatCents(grossProfit),
      opex: formatCents(opex),
      ebitda: formatCents(ebitda),
      depreciation: formatCents(depreciation),
      ebit: formatCents(ebit),
      nonOperatingNet: formatCents(nonOperatingNet),
      ebt: formatCents(ebt),
      tax: formatCents(tax),
      netIncome: formatCents(netIncome),
    },
    balanceSheet: {
      currentAssets: formatCents(currentAssets),
      nonCurrentAssets: formatCents(nonCurrentAssets),
      totalAssets: formatCents(totalAssets),
      currentLiabilities: formatCents(currentLiabilities),
      nonCurrentLiabilities: formatCents(nonCurrentLiabilities),
      totalLiabilities: formatCents(totalLiabilities),
      totalEquity: formatCents(totalEquity),
      totalLiabilitiesAndEquity: formatCents(totalLiabilitiesAndEquity),
      cashBalance: formatCents(bsCash),
      balanced: totalAssets === totalLiabilitiesAndEquity,
    },
    cashFlow: {
      beginningCash: formatCents(openCash),
      operatingCashFlow: formatCents(cfo),
      investingCashFlow: formatCents(cfi),
      financingCashFlow: formatCents(cff),
      endingCash: formatCents(cfEndingCash),
      tiesToBsCash: cfEndingCash === bsCash,
    },
    retainedEarnings: {
      opening: formatCents(openRe),
      netIncome: formatCents(netIncome),
      distributions: formatCents(distributionsMag),
      closingTotal: formatCents(closingReTotal),
      rollForwardValid: closingReTotal === openRe + netIncome - distributionsMag,
    },
  };
}

export function writeIndependentOracle(rootDir = process.cwd()): string {
  const corpusPath = join(rootDir, 'fixtures/corpus/corpus.json');
  const outPath = join(rootDir, 'fixtures/oracles/expected/corpus_expected.json');
  const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as RawCorpus;
  const oracle = computeIndependentCorpusOracle(corpus);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(oracle, null, 2)}\n`, 'utf8');
  return outPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = writeIndependentOracle(process.cwd());
  process.stdout.write(`✓ Wrote independent BigInt oracle at ${out}\n`);
}
