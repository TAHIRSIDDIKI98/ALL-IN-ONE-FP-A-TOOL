// Ported from fp-A-betterversion/src/utils/glRowMoney.ts @ 86d785ca696c & glAnalysis.ts @ 86d785ca696c, and verified against fpa/tests/fixtures/coa + statements @ 6f6f72f5b681. Class B.
// Changes: Replaced JS number outputs with pure Decimal values; banned Math.abs sign fixes; implemented canonical statement_line vocabulary, CoA normalization/upsert/merge rules, natural-sign TB, P&L (EBITDA +300), Balance Sheet, Indirect Cash Flow, and largest-remainder display-unit rounding (MASTER_PROMPT §5.4–§5.6). Oracle: fixtures/oracles/coa/* + fixtures/oracles/statements/*.

import Decimal from 'decimal.js';
import { verifyArticulation, type ArticulationReport } from '../invariants.js';
import { add, compare, eq, money, negate, sub, sum } from '../money/index.js';

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type NormalSide = 'debit' | 'credit';
export type StatementKind = 'pl' | 'bs' | 'cf';

export interface CanonicalStatementLineSpec {
  readonly key: string;
  readonly statement: StatementKind;
  readonly label: string;
  readonly sortOrder: number;
  readonly signRule: 'debit_minus_credit' | 'credit_minus_debit';
}

export const STATEMENT_LINE_CATALOG: readonly CanonicalStatementLineSpec[] = [
  // P&L
  { key: 'pl.revenue.product', statement: 'pl', label: 'Product Revenue', sortOrder: 10, signRule: 'credit_minus_debit' },
  { key: 'pl.revenue.service', statement: 'pl', label: 'Service Revenue', sortOrder: 20, signRule: 'credit_minus_debit' },
  { key: 'pl.revenue.other', statement: 'pl', label: 'Other Revenue', sortOrder: 30, signRule: 'credit_minus_debit' },
  { key: 'pl.cogs.direct', statement: 'pl', label: 'Cost of Goods Sold', sortOrder: 40, signRule: 'debit_minus_credit' },
  { key: 'pl.cogs.other', statement: 'pl', label: 'Other Cost of Sales', sortOrder: 50, signRule: 'debit_minus_credit' },
  { key: 'pl.opex.payroll', statement: 'pl', label: 'Payroll & Benefits', sortOrder: 60, signRule: 'debit_minus_credit' },
  { key: 'pl.opex.ga', statement: 'pl', label: 'General & Administrative', sortOrder: 70, signRule: 'debit_minus_credit' },
  { key: 'pl.opex.sm', statement: 'pl', label: 'Sales & Marketing', sortOrder: 80, signRule: 'debit_minus_credit' },
  { key: 'pl.opex.rd', statement: 'pl', label: 'Research & Development', sortOrder: 90, signRule: 'debit_minus_credit' },
  { key: 'pl.opex.other', statement: 'pl', label: 'Other Operating Expenses', sortOrder: 100, signRule: 'debit_minus_credit' },
  { key: 'pl.da.depreciation', statement: 'pl', label: 'Depreciation', sortOrder: 110, signRule: 'debit_minus_credit' },
  { key: 'pl.da.amortization', statement: 'pl', label: 'Amortization', sortOrder: 120, signRule: 'debit_minus_credit' },
  { key: 'pl.nonop.interest_income', statement: 'pl', label: 'Interest Income', sortOrder: 130, signRule: 'credit_minus_debit' },
  { key: 'pl.nonop.interest_expense', statement: 'pl', label: 'Interest Expense', sortOrder: 140, signRule: 'debit_minus_credit' },
  { key: 'pl.nonop.other', statement: 'pl', label: 'Other Non-Operating', sortOrder: 150, signRule: 'debit_minus_credit' },
  { key: 'pl.tax.income_tax', statement: 'pl', label: 'Income Tax Expense', sortOrder: 160, signRule: 'debit_minus_credit' },

  // Balance Sheet
  { key: 'bs.asset.cash', statement: 'bs', label: 'Cash and Cash Equivalents', sortOrder: 10, signRule: 'debit_minus_credit' },
  { key: 'bs.asset.ar', statement: 'bs', label: 'Accounts Receivable', sortOrder: 20, signRule: 'debit_minus_credit' },
  { key: 'bs.asset.inventory', statement: 'bs', label: 'Inventory', sortOrder: 30, signRule: 'debit_minus_credit' },
  { key: 'bs.asset.other_current', statement: 'bs', label: 'Other Current Assets', sortOrder: 40, signRule: 'debit_minus_credit' },
  { key: 'bs.asset.ppe_gross', statement: 'bs', label: 'Property, Plant & Equipment', sortOrder: 50, signRule: 'debit_minus_credit' },
  { key: 'bs.asset.ppe_accum_depr', statement: 'bs', label: 'Accumulated Depreciation', sortOrder: 60, signRule: 'credit_minus_debit' },
  { key: 'bs.asset.other_noncurrent', statement: 'bs', label: 'Other Non-Current Assets', sortOrder: 70, signRule: 'debit_minus_credit' },
  { key: 'bs.liability.ap', statement: 'bs', label: 'Accounts Payable', sortOrder: 80, signRule: 'credit_minus_debit' },
  { key: 'bs.liability.accrued', statement: 'bs', label: 'Accrued Liabilities', sortOrder: 90, signRule: 'credit_minus_debit' },
  { key: 'bs.liability.deferred_rev', statement: 'bs', label: 'Deferred Revenue', sortOrder: 100, signRule: 'credit_minus_debit' },
  { key: 'bs.liability.short_term_debt', statement: 'bs', label: 'Short-Term Debt', sortOrder: 110, signRule: 'credit_minus_debit' },
  { key: 'bs.liability.long_term_debt', statement: 'bs', label: 'Long-Term Debt', sortOrder: 120, signRule: 'credit_minus_debit' },
  { key: 'bs.liability.other_noncurrent', statement: 'bs', label: 'Other Non-Current Liabilities', sortOrder: 130, signRule: 'credit_minus_debit' },
  { key: 'bs.equity.common_stock', statement: 'bs', label: 'Common Stock & APIC', sortOrder: 140, signRule: 'credit_minus_debit' },
  { key: 'bs.equity.retained_earnings', statement: 'bs', label: 'Retained Earnings', sortOrder: 150, signRule: 'credit_minus_debit' },
  { key: 'bs.equity.distributions', statement: 'bs', label: 'Dividends & Distributions', sortOrder: 160, signRule: 'debit_minus_credit' },
  { key: 'bs.equity.current_net_income', statement: 'bs', label: 'Current Period Net Income', sortOrder: 170, signRule: 'credit_minus_debit' },

  // Cash Flow (indirect)
  { key: 'cf.operating.net_income', statement: 'cf', label: 'Net Income', sortOrder: 10, signRule: 'credit_minus_debit' },
  { key: 'cf.operating.da_addback', statement: 'cf', label: 'Depreciation & Amortization Addback', sortOrder: 20, signRule: 'debit_minus_credit' },
  { key: 'cf.operating.delta_wc', statement: 'cf', label: 'Changes in Working Capital', sortOrder: 30, signRule: 'credit_minus_debit' },
  { key: 'cf.investing.capex', statement: 'cf', label: 'Capital Expenditures', sortOrder: 40, signRule: 'credit_minus_debit' },
  { key: 'cf.financing.debt', statement: 'cf', label: 'Debt Proceeds / (Repayments)', sortOrder: 50, signRule: 'credit_minus_debit' },
  { key: 'cf.financing.equity', statement: 'cf', label: 'Equity Issuance', sortOrder: 60, signRule: 'credit_minus_debit' },
  { key: 'cf.financing.distributions', statement: 'cf', label: 'Dividends & Distributions Paid', sortOrder: 70, signRule: 'credit_minus_debit' },
];

export const STATEMENT_LINE_MAP: ReadonlyMap<string, CanonicalStatementLineSpec> = new Map(
  STATEMENT_LINE_CATALOG.map((s) => [s.key, s]),
);

/**
 * Code normalization (§4.2): trim and collapse internal whitespace; PRESERVE leading zeros.
 * Never number-parses a code ("001200" !== "1200").
 */
export function normalizeCode(rawCode: string): string {
  const normalized = rawCode.trim().replace(/\s+/g, ' ');
  if (normalized.length === 0) {
    throw new Error('INVALID_EMPTY_CODE');
  }
  return normalized;
}

export function expectedNormalSideForType(type: AccountType): NormalSide {
  return type === 'asset' || type === 'expense' ? 'debit' : 'credit';
}

export function validateAccountCoherence(
  type: AccountType,
  normalSide: NormalSide,
  isContra = false,
): { readonly valid: true } | { readonly valid: false; readonly reason: string } {
  if (isContra) {
    return { valid: true };
  }
  const expected = expectedNormalSideForType(type);
  if (normalSide !== expected) {
    return {
      valid: false,
      reason: `Account type "${type}" requires normal_side "${expected}", got "${normalSide}"`,
    };
  }
  return { valid: true };
}

export interface CoaAccountRecord {
  readonly code: string;
  readonly name: string;
  readonly type: string;
  readonly section: string;
  readonly parentCode: string | null;
  readonly isControl?: boolean;
  readonly version: number;
  readonly active: boolean;
}

export interface CoaImportOutcome {
  readonly ok: boolean;
  readonly created: number;
  readonly updated: number;
  readonly accounts: readonly CoaAccountRecord[];
  readonly errorCode?: 'COA_DUPLICATE_CODE' | 'COA_REFERENCED';
  readonly httpStatus?: 409;
  readonly conflictCode?: string;
  readonly glLineCount?: number;
}

export function evaluateCoaImport(
  existing: readonly CoaAccountRecord[],
  incoming: readonly Omit<CoaAccountRecord, 'version' | 'active'>[],
  glLineCountByCode: ReadonlyMap<string, number> = new Map(),
): CoaImportOutcome {
  const byCode = new Map<string, CoaAccountRecord>();
  for (const acct of existing) {
    byCode.set(normalizeCode(acct.code), acct);
  }

  let created = 0;
  let updated = 0;

  for (const item of incoming) {
    const code = normalizeCode(item.code);
    const current = byCode.get(code);
    if (!current) {
      byCode.set(code, {
        ...item,
        code,
        parentCode: item.parentCode !== null ? normalizeCode(item.parentCode) : null,
        version: 1,
        active: true,
      });
      created += 1;
      continue;
    }

    if (current.type !== item.type) {
      return {
        ok: false,
        created,
        updated,
        accounts: existing,
        errorCode: 'COA_DUPLICATE_CODE',
        httpStatus: 409,
        conflictCode: code,
      };
    }

    const refCount = glLineCountByCode.get(code) ?? 0;
    if (refCount > 0) {
      return {
        ok: false,
        created,
        updated,
        accounts: existing,
        errorCode: 'COA_REFERENCED',
        httpStatus: 409,
        conflictCode: code,
        glLineCount: refCount,
      };
    }

    byCode.set(code, {
      ...current,
      name: item.name,
      section: item.section,
      parentCode: item.parentCode !== null ? normalizeCode(item.parentCode) : null,
      version: current.version + 1,
    });
    updated += 1;
  }

  return {
    ok: true,
    created,
    updated,
    accounts: [...byCode.values()],
  };
}

export interface CoaMergeGlLine {
  readonly accountCode: string;
  readonly debitMinor: number;
  readonly creditMinor: number;
}

export function evaluateCoaMerge(
  existing: readonly CoaAccountRecord[],
  glLines: readonly CoaMergeGlLine[],
  fromCodeRaw: string,
  toCodeRaw: string,
): {
  readonly remappedLinesCount: number;
  readonly glLines: readonly CoaMergeGlLine[];
  readonly accounts: readonly CoaAccountRecord[];
} {
  const fromCode = normalizeCode(fromCodeRaw);
  const toCode = normalizeCode(toCodeRaw);
  const fromAcct = existing.find((a) => normalizeCode(a.code) === fromCode);
  const toAcct = existing.find((a) => normalizeCode(a.code) === toCode);

  if (!fromAcct || !toAcct) {
    throw new Error(`COA_MERGE_ACCOUNT_NOT_FOUND: ${fromCode} -> ${toCode}`);
  }
  if (fromAcct.type !== toAcct.type) {
    throw new Error(`COA_MERGE_TYPE_MISMATCH: ${fromAcct.type} !== ${toAcct.type}`);
  }

  let remappedLinesCount = 0;
  const updatedLines = glLines.map((line) => {
    if (normalizeCode(line.accountCode) === fromCode) {
      remappedLinesCount += 1;
      return { ...line, accountCode: toCode };
    }
    return line;
  });

  const updatedAccounts = existing.map((acct) => {
    const code = normalizeCode(acct.code);
    if (code === fromCode) {
      return {
        ...acct,
        active: false,
        version: acct.version + 1,
      };
    }
    if (acct.parentCode !== null && normalizeCode(acct.parentCode) === fromCode) {
      return {
        ...acct,
        parentCode: toCode,
      };
    }
    return acct;
  });

  return {
    remappedLinesCount,
    glLines: updatedLines,
    accounts: updatedAccounts,
  };
}

/**
 * Natural-sign activity (§5.5):
 *   debit-normal  -> debit - credit
 *   credit-normal -> credit - debit
 * Never uses Math.abs().
 */
export function computeNaturalActivity(
  normalSide: NormalSide,
  debit: Decimal,
  credit: Decimal,
): Decimal {
  return normalSide === 'debit' ? sub(debit, credit) : sub(credit, debit);
}

/**
 * Sheet-side signed contribution (§5.5 / §5.6):
 *   asset / expense      -> debit - credit (contra-assets with credit balance become negative assets)
 *   liability / equity / revenue -> credit - debit (contra-equity/distributions with debit balance become negative equity)
 */
export function computeSheetContribution(
  type: AccountType,
  debit: Decimal,
  credit: Decimal,
): Decimal {
  return type === 'asset' || type === 'expense'
    ? sub(debit, credit)
    : sub(credit, debit);
}

export interface StatementAccountDef {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly normalSide: NormalSide;
  readonly isContra?: boolean;
  readonly statementLineKey: string;
}

export interface GlLineFact {
  readonly entryId: string;
  readonly accountId: string;
  readonly periodId: string;
  readonly debit: Decimal;
  readonly credit: Decimal;
}

export interface TrialBalanceRow {
  readonly accountId: string;
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly normalSide: NormalSide;
  readonly statementLineKey: string;
  readonly totalDebit: Decimal;
  readonly totalCredit: Decimal;
  readonly naturalActivity: Decimal;
  readonly sheetContribution: Decimal;
}

export interface TrialBalanceResult {
  readonly rows: readonly TrialBalanceRow[];
  readonly totalDebit: Decimal;
  readonly totalCredit: Decimal;
  readonly isBalanced: boolean;
  readonly unbalancedEntryIds: readonly string[];
}

export function buildTrialBalance(
  accounts: readonly StatementAccountDef[],
  lines: readonly GlLineFact[],
): TrialBalanceResult {
  const entrySums = new Map<string, { debit: Decimal; credit: Decimal }>();
  const acctSums = new Map<string, { debit: Decimal; credit: Decimal }>();

  for (const line of lines) {
    if (line.debit.isNegative() || line.credit.isNegative()) {
      throw new Error(`NEGATIVE_GL_LINE_AMOUNT: entry=${line.entryId}`);
    }
    if (line.debit.isZero() === line.credit.isZero()) {
      throw new Error(`INVALID_GL_LINE_SIDES: entry=${line.entryId}`);
    }

    const e = entrySums.get(line.entryId) ?? { debit: money('0'), credit: money('0') };
    e.debit = add(e.debit, line.debit);
    e.credit = add(e.credit, line.credit);
    entrySums.set(line.entryId, e);

    const a = acctSums.get(line.accountId) ?? { debit: money('0'), credit: money('0') };
    a.debit = add(a.debit, line.debit);
    a.credit = add(a.credit, line.credit);
    acctSums.set(line.accountId, a);
  }

  const unbalancedEntryIds: string[] = [];
  for (const [entryId, totals] of entrySums.entries()) {
    if (!totals.debit.eq(totals.credit)) {
      unbalancedEntryIds.push(entryId);
    }
  }

  const rows: TrialBalanceRow[] = [];
  const allDebits: Decimal[] = [];
  const allCredits: Decimal[] = [];

  const sortedAccounts = [...accounts].sort((a, b) => a.code.localeCompare(b.code));
  for (const acct of sortedAccounts) {
    const totals = acctSums.get(acct.id) ?? { debit: money('0'), credit: money('0') };
    allDebits.push(totals.debit);
    allCredits.push(totals.credit);
    rows.push({
      accountId: acct.id,
      code: acct.code,
      name: acct.name,
      type: acct.type,
      normalSide: acct.normalSide,
      statementLineKey: acct.statementLineKey,
      totalDebit: totals.debit,
      totalCredit: totals.credit,
      naturalActivity: computeNaturalActivity(acct.normalSide, totals.debit, totals.credit),
      sheetContribution: computeSheetContribution(acct.type, totals.debit, totals.credit),
    });
  }

  const totalDebit = sum(allDebits);
  const totalCredit = sum(allCredits);

  return {
    rows,
    totalDebit,
    totalCredit,
    isBalanced: unbalancedEntryIds.length === 0 && totalDebit.eq(totalCredit),
    unbalancedEntryIds,
  };
}

export interface PnlLineInput {
  readonly statementLineKey: string;
  readonly naturalAmount: Decimal;
}

export interface PnlStatementResult {
  readonly byKey: ReadonlyMap<string, Decimal>;
  readonly revenue: Decimal;
  readonly cogs: Decimal;
  readonly grossProfit: Decimal;
  readonly opex: Decimal;
  readonly ebitda: Decimal;
  readonly depreciation: Decimal;
  readonly ebit: Decimal;
  readonly nonOperatingNet: Decimal;
  readonly ebt: Decimal;
  readonly tax: Decimal;
  readonly netIncome: Decimal;
}

export function computePnlStatement(inputs: readonly PnlLineInput[]): PnlStatementResult {
  const byKey = new Map<string, Decimal>();
  for (const item of inputs) {
    const prev = byKey.get(item.statementLineKey) ?? money('0');
    byKey.set(item.statementLineKey, add(prev, item.naturalAmount));
  }

  const revParts: Decimal[] = [];
  const cogsParts: Decimal[] = [];
  const opexParts: Decimal[] = [];
  const daParts: Decimal[] = [];
  const nonOpParts: Decimal[] = [];
  const taxParts: Decimal[] = [];

  for (const [key, val] of byKey.entries()) {
    if (key.startsWith('pl.revenue.')) {
      revParts.push(val);
    } else if (key.startsWith('pl.cogs.')) {
      cogsParts.push(val);
    } else if (key.startsWith('pl.opex.')) {
      opexParts.push(val);
    } else if (key.startsWith('pl.da.')) {
      daParts.push(val);
    } else if (key === 'pl.nonop.interest_income') {
      nonOpParts.push(val);
    } else if (key.startsWith('pl.nonop.')) {
      nonOpParts.push(negate(val));
    } else if (key.startsWith('pl.tax.')) {
      taxParts.push(val);
    }
  }

  const revenue = sum(revParts);
  const cogs = sum(cogsParts);
  const grossProfit = sub(revenue, cogs);
  const opex = sum(opexParts);
  const ebitda = sub(grossProfit, opex);
  const depreciation = sum(daParts);
  const ebit = sub(ebitda, depreciation);
  const nonOperatingNet = sum(nonOpParts);
  const ebt = add(ebit, nonOperatingNet);
  const tax = sum(taxParts);
  const netIncome = sub(ebt, tax);

  return {
    byKey,
    revenue,
    cogs,
    grossProfit,
    opex,
    ebitda,
    depreciation,
    ebit,
    nonOperatingNet,
    ebt,
    tax,
    netIncome,
  };
}

export interface BsLineInput {
  readonly statementLineKey: string;
  readonly amount: Decimal; // sheet contribution (assets positive, contra-assets negative; liab/equity positive, distributions negative)
}

export interface BalanceSheetResult {
  readonly byKey: ReadonlyMap<string, Decimal>;
  readonly currentAssets: Decimal;
  readonly nonCurrentAssets: Decimal;
  readonly totalAssets: Decimal;
  readonly currentLiabilities: Decimal;
  readonly nonCurrentLiabilities: Decimal;
  readonly totalLiabilities: Decimal;
  readonly totalEquity: Decimal;
  readonly totalLiabilitiesAndEquity: Decimal;
  readonly cashBalance: Decimal;
  readonly balanceDelta: Decimal;
  readonly isBalanced: boolean;
}

const CURRENT_ASSET_KEYS = new Set([
  'bs.asset.cash',
  'bs.asset.ar',
  'bs.asset.inventory',
  'bs.asset.other_current',
]);

const CURRENT_LIABILITY_KEYS = new Set([
  'bs.liability.ap',
  'bs.liability.accrued',
  'bs.liability.deferred_rev',
  'bs.liability.short_term_debt',
]);

export function computeBalanceSheet(inputs: readonly BsLineInput[]): BalanceSheetResult {
  const byKey = new Map<string, Decimal>();
  for (const item of inputs) {
    const prev = byKey.get(item.statementLineKey) ?? money('0');
    byKey.set(item.statementLineKey, add(prev, item.amount));
  }

  const curAssets: Decimal[] = [];
  const nonCurAssets: Decimal[] = [];
  const curLiab: Decimal[] = [];
  const nonCurLiab: Decimal[] = [];
  const equityParts: Decimal[] = [];

  for (const [key, val] of byKey.entries()) {
    if (key.startsWith('bs.asset.')) {
      if (CURRENT_ASSET_KEYS.has(key)) curAssets.push(val);
      else nonCurAssets.push(val);
    } else if (key.startsWith('bs.liability.')) {
      if (CURRENT_LIABILITY_KEYS.has(key)) curLiab.push(val);
      else nonCurLiab.push(val);
    } else if (key.startsWith('bs.equity.')) {
      equityParts.push(val);
    }
  }

  const currentAssets = sum(curAssets);
  const nonCurrentAssets = sum(nonCurAssets);
  const totalAssets = add(currentAssets, nonCurrentAssets);

  const currentLiabilities = sum(curLiab);
  const nonCurrentLiabilities = sum(nonCurLiab);
  const totalLiabilities = add(currentLiabilities, nonCurrentLiabilities);

  const totalEquity = sum(equityParts);
  const totalLiabilitiesAndEquity = add(totalLiabilities, totalEquity);
  const balanceDelta = sub(totalAssets, totalLiabilitiesAndEquity);
  const cashBalance = byKey.get('bs.asset.cash') ?? money('0');

  return {
    byKey,
    currentAssets,
    nonCurrentAssets,
    totalAssets,
    currentLiabilities,
    nonCurrentLiabilities,
    totalLiabilities,
    totalEquity,
    totalLiabilitiesAndEquity,
    cashBalance,
    balanceDelta,
    isBalanced: balanceDelta.isZero(),
  };
}

export interface IndirectCashFlowInput {
  readonly netIncome: Decimal;
  readonly depreciationAndAmortization: Decimal;
  readonly beginningNonCashCurrentAssets: Decimal;
  readonly endingNonCashCurrentAssets: Decimal;
  readonly beginningCurrentLiabilities: Decimal;
  readonly endingCurrentLiabilities: Decimal;
  readonly capexCashOutflow: Decimal; // negative for outflow, e.g. -640000
  readonly debtNetCashFlow: Decimal;
  readonly equityIssuanceCashFlow: Decimal;
  readonly distributionsCashFlow: Decimal; // negative for dividend paid
  readonly beginningCash: Decimal;
}

export interface IndirectCashFlowResult {
  readonly netIncome: Decimal;
  readonly nonCashAddbacks: Decimal;
  readonly deltaWorkingCapitalCashImpact: Decimal;
  readonly operatingCashFlow: Decimal;
  readonly investingCashFlow: Decimal;
  readonly freeCashFlow: Decimal;
  readonly financingCashFlow: Decimal;
  readonly netCashChange: Decimal;
  readonly beginningCash: Decimal;
  readonly endingCash: Decimal;
}

/**
 * Indirect Cash Flow (§5.6 A5):
 *   CFO = NI + non-cash addbacks - Δnon-cash current assets + Δcurrent liabilities
 *   Cash itself is excluded from working-capital deltas.
 */
export function computeIndirectCashFlow(input: IndirectCashFlowInput): IndirectCashFlowResult {
  const deltaNonCashCa = sub(input.endingNonCashCurrentAssets, input.beginningNonCashCurrentAssets);
  const deltaCl = sub(input.endingCurrentLiabilities, input.beginningCurrentLiabilities);
  const deltaWorkingCapitalCashImpact = sub(deltaCl, deltaNonCashCa);

  const operatingCashFlow = add(
    input.netIncome,
    add(input.depreciationAndAmortization, deltaWorkingCapitalCashImpact),
  );
  const investingCashFlow = input.capexCashOutflow;
  const freeCashFlow = add(operatingCashFlow, investingCashFlow);
  const financingCashFlow = add(
    input.debtNetCashFlow,
    add(input.equityIssuanceCashFlow, input.distributionsCashFlow),
  );
  const netCashChange = add(operatingCashFlow, add(investingCashFlow, financingCashFlow));
  const endingCash = add(input.beginningCash, netCashChange);

  return {
    netIncome: input.netIncome,
    nonCashAddbacks: input.depreciationAndAmortization,
    deltaWorkingCapitalCashImpact,
    operatingCashFlow,
    investingCashFlow,
    freeCashFlow,
    financingCashFlow,
    netCashChange,
    beginningCash: input.beginningCash,
    endingCash,
  };
}

/** A4 as reported to the user: closing RE == opening RE + Net Income − distributions (§4.5). */
export interface RetainedEarningsRollForward {
  readonly opening: Decimal;
  readonly netIncome: Decimal;
  readonly distributions: Decimal;
  readonly closingTotal: Decimal;
  readonly rollForwardValid: boolean;
}

export interface FullStatementsBundle {
  readonly trialBalance: TrialBalanceResult;
  readonly pnl: PnlStatementResult;
  readonly balanceSheet: BalanceSheetResult;
  readonly cashFlow: IndirectCashFlowResult;
  readonly retainedEarnings: RetainedEarningsRollForward;
  readonly articulation: ArticulationReport;
}

/**
 * Synthesizes articulating TB, P&L, Balance Sheet (including closing RE roll-forward),
 * and Indirect Cash Flow from opening balances + period activity GL lines.
 */
export function buildArticulatingStatements(params: {
  readonly accounts: readonly StatementAccountDef[];
  readonly openingBalancesByKey: ReadonlyMap<string, Decimal>;
  readonly periodGlLines: readonly GlLineFact[];
}): FullStatementsBundle {
  const trialBalance = buildTrialBalance(params.accounts, params.periodGlLines);

  const pnlInputs: PnlLineInput[] = [];
  const bsPeriodDeltas = new Map<string, Decimal>();

  for (const row of trialBalance.rows) {
    if (row.statementLineKey.startsWith('pl.')) {
      pnlInputs.push({
        statementLineKey: row.statementLineKey,
        naturalAmount: row.naturalActivity,
      });
    } else if (row.statementLineKey.startsWith('bs.')) {
      const prev = bsPeriodDeltas.get(row.statementLineKey) ?? money('0');
      bsPeriodDeltas.set(row.statementLineKey, add(prev, row.sheetContribution));
    }
  }

  const pnl = computePnlStatement(pnlInputs);

  const bsKeys = new Set<string>([
    ...params.openingBalancesByKey.keys(),
    ...bsPeriodDeltas.keys(),
  ]);
  const bsInputs: BsLineInput[] = [];
  for (const key of bsKeys) {
    if (key === 'bs.equity.current_net_income') continue;
    const open = params.openingBalancesByKey.get(key) ?? money('0');
    const delta = bsPeriodDeltas.get(key) ?? money('0');
    bsInputs.push({ statementLineKey: key, amount: add(open, delta) });
  }
  bsInputs.push({ statementLineKey: 'bs.equity.current_net_income', amount: pnl.netIncome });

  const balanceSheet = computeBalanceSheet(bsInputs);

  // Indirect CF derived from opening vs closing BS + P&L D&A
  const openCash = params.openingBalancesByKey.get('bs.asset.cash') ?? money('0');
  const openAr = params.openingBalancesByKey.get('bs.asset.ar') ?? money('0');
  const openInv = params.openingBalancesByKey.get('bs.asset.inventory') ?? money('0');
  const openOtherCa = params.openingBalancesByKey.get('bs.asset.other_current') ?? money('0');
  const beginningNonCashCa = add(openAr, add(openInv, openOtherCa));

  const endAr = balanceSheet.byKey.get('bs.asset.ar') ?? money('0');
  const endInv = balanceSheet.byKey.get('bs.asset.inventory') ?? money('0');
  const endOtherCa = balanceSheet.byKey.get('bs.asset.other_current') ?? money('0');
  const endingNonCashCa = add(endAr, add(endInv, endOtherCa));

  const openAp = params.openingBalancesByKey.get('bs.liability.ap') ?? money('0');
  const openAccrued = params.openingBalancesByKey.get('bs.liability.accrued') ?? money('0');
  const openDefRev = params.openingBalancesByKey.get('bs.liability.deferred_rev') ?? money('0');
  const openStDebt = params.openingBalancesByKey.get('bs.liability.short_term_debt') ?? money('0');
  const beginningCl = add(openAp, add(openAccrued, add(openDefRev, openStDebt)));
  const endingCl = balanceSheet.currentLiabilities;

  // Non-cash depreciation addback: accumulated depreciation change (credit-normal contra-asset -> negative asset delta, so negate)
  const accumDeprDelta = bsPeriodDeltas.get('bs.asset.ppe_accum_depr') ?? money('0');
  const daAddback = negate(accumDeprDelta);

  const ppeGrossDelta = bsPeriodDeltas.get('bs.asset.ppe_gross') ?? money('0');
  const otherNonCurAssetDelta = bsPeriodDeltas.get('bs.asset.other_noncurrent') ?? money('0');
  const capexCashOutflow = negate(add(ppeGrossDelta, otherNonCurAssetDelta));

  const ltDebtDelta = bsPeriodDeltas.get('bs.liability.long_term_debt') ?? money('0');
  const otherNclDelta = bsPeriodDeltas.get('bs.liability.other_noncurrent') ?? money('0');
  const debtNetCashFlow = add(ltDebtDelta, otherNclDelta);

  const equityIssuanceCashFlow = bsPeriodDeltas.get('bs.equity.common_stock') ?? money('0');
  const distributionsDelta = bsPeriodDeltas.get('bs.equity.distributions') ?? money('0'); // negative on equity sheet contribution

  const cashFlow = computeIndirectCashFlow({
    netIncome: pnl.netIncome,
    depreciationAndAmortization: daAddback,
    beginningNonCashCurrentAssets: beginningNonCashCa,
    endingNonCashCurrentAssets: endingNonCashCa,
    beginningCurrentLiabilities: beginningCl,
    endingCurrentLiabilities: endingCl,
    capexCashOutflow,
    debtNetCashFlow,
    equityIssuanceCashFlow,
    distributionsCashFlow: distributionsDelta,
    beginningCash: openCash,
  });

  const openingRe = params.openingBalancesByKey.get('bs.equity.retained_earnings') ?? money('0');
  const distributionsMagnitude = negate(distributionsDelta);
  const closingReTotal = add(
    balanceSheet.byKey.get('bs.equity.retained_earnings') ?? money('0'),
    sub(
      balanceSheet.byKey.get('bs.equity.current_net_income') ?? money('0'),
      distributionsMagnitude,
    ),
  );

  const pnlTotalExpense = add(
    pnl.cogs,
    add(
      pnl.opex,
      add(
        pnl.depreciation,
        add(negate(pnl.nonOperatingNet), pnl.tax),
      ),
    ),
  );

  const articulation = verifyArticulation({
    totalDebits: trialBalance.totalDebit,
    totalCredits: trialBalance.totalCredit,
    pnlRevenue: pnl.revenue,
    pnlExpense: pnlTotalExpense,
    pnlNetIncome: pnl.netIncome,
    bsAssets: balanceSheet.totalAssets,
    bsLiabilities: balanceSheet.totalLiabilities,
    bsEquity: balanceSheet.totalEquity,
    openingRetainedEarnings: openingRe,
    distributions: distributionsMagnitude,
    closingRetainedEarnings: closingReTotal,
    cfBeginningCash: cashFlow.beginningCash,
    cfOperating: cashFlow.operatingCashFlow,
    cfInvesting: cashFlow.investingCashFlow,
    cfFinancing: cashFlow.financingCashFlow,
    cfEndingCash: cashFlow.endingCash,
    bsCash: balanceSheet.cashBalance,
  });

  const retainedEarnings: RetainedEarningsRollForward = {
    opening: openingRe,
    netIncome: pnl.netIncome,
    distributions: distributionsMagnitude,
    closingTotal: closingReTotal,
    rollForwardValid: eq(closingReTotal, sub(add(openingRe, pnl.netIncome), distributionsMagnitude)),
  };

  return {
    trialBalance,
    pnl,
    balanceSheet,
    cashFlow,
    retainedEarnings,
    articulation,
  };
}

/**
 * Largest-remainder allocation to an arbitrary display unit (e.g. `1000` for $000s or `0.01` for cents)
 * matching `fixtures/oracles/statements/rounding_oracle.json` (P18).
 */
export function allocateDisplayUnits(
  exactLines: readonly Decimal[],
  unit: Decimal,
): { readonly displayed: readonly Decimal[]; readonly displayedTotal: Decimal } {
  if (unit.lte(money('0'))) {
    throw new Error('INVALID_DISPLAY_UNIT: unit must be > 0');
  }
  const exactTotal = sum(exactLines);
  const targetUnits = exactTotal.dividedBy(unit).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

  // Truncate toward zero (or floor toward 0 magnitude) and distribute residual +/- 1 units by largest remainder
  const scaled = exactLines.map((val, idx) => {
    const q = val.dividedBy(unit);
    const trunc = q.isNegative() ? q.ceil() : q.floor();
    const rem = q.minus(trunc);
    const magRem = rem.isNegative() ? negate(rem) : rem;
    return { idx, trunc, rem, magRem };
  });

  let currentUnits = money('0');
  for (const s of scaled) {
    currentUnits = add(currentUnits, s.trunc);
  }

  let residualUnits = sub(targetUnits, currentUnits);
  const stepSign = residualUnits.isNegative() ? money('-1') : money('1');
  const stepsNeeded = residualUnits.isNegative() ? negate(residualUnits) : residualUnits;
  const stepsInt = Number(stepsNeeded.toFixed(0));

  const ranked = [...scaled].sort((a, b) => {
    const cmp = compare(b.magRem, a.magRem);
    if (cmp !== 0) return cmp;
    return a.idx - b.idx;
  });

  const adjusted = scaled.map((s) => s.trunc);
  for (let i = 0; i < stepsInt; i++) {
    const target = ranked[i % ranked.length]!;
    adjusted[target.idx] = add(adjusted[target.idx]!, stepSign);
  }

  const displayed = adjusted.map((u) => {
    const val = u.times(unit);
    return val.isZero() ? money('0') : val;
  });
  const displayedTotal = targetUnits.times(unit);

  return {
    displayed,
    displayedTotal: displayedTotal.isZero() ? money('0') : displayedTotal,
  };
}
