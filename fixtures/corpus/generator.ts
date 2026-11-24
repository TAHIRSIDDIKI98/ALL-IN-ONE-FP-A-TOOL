import Decimal from 'decimal.js';
import { generateFiscalYears, type GeneratedPeriod } from '../../core/calendar/index.js';
import { fromMinorUnits, money, serialize, sub, sum } from '../../core/money/index.js';
import {
  buildArticulatingStatements,
  type AccountType,
  type GlLineFact,
  type NormalSide,
  type StatementAccountDef,
} from '../../core/statements/index.js';

export const CORPUS_GENERATOR_VERSION = '1.0.0';
export const DEFAULT_CORPUS_SEED = 202601;

export interface CorpusConfig {
  readonly fiscalYear: number;
  readonly currency: string;
  readonly scale: 0 | 2 | 3;
}

export const DEFAULT_CORPUS_CONFIG: CorpusConfig = {
  fiscalYear: 2026,
  currency: 'USD',
  scale: 2,
};

export interface CorpusAccount extends StatementAccountDef {
  readonly active: boolean;
  readonly isControl: boolean;
  readonly parentCode: string | null;
}

export interface CorpusPlanLine {
  readonly accountCode: string;
  readonly periodCode: string;
  readonly statementLineKey: string;
  readonly amount: string;
  readonly minorUnits: number;
}

export interface CorpusDeviation {
  readonly id: string;
  readonly kind:
    | 'price_variance'
    | 'volume_variance'
    | 'timing_shift'
    | 'one_off_expense'
    | 'favorable_expense'
    | 'zero_plan_non_zero_actual'
    | 'negative_plan'
    | 'structural_unmapped'
    | 'structural_duplicate'
    | 'structural_quarantine'
    | 'structural_unbalanced_rejected';
  readonly grain: {
    readonly account_code: string;
    readonly period: string;
    readonly entity: string;
  };
  readonly amount: string;
  readonly minorUnits: number;
  readonly cause: string;
  readonly favorability: 'favorable' | 'unfavorable' | 'neutral' | 'na';
  readonly statement_line_key: string;
  readonly expected_finding_key: string;
  readonly expected_severity: 'info' | 'warn' | 'critical';
  readonly expected_rule: string;
}

export interface CorpusActualLine {
  readonly accountCode: string;
  readonly periodCode: string;
  readonly statementLineKey: string;
  readonly budgetAmount: string;
  readonly deviationAmount: string;
  readonly actualAmount: string;
  readonly actualMinorUnits: number;
}

export interface CorpusGlEntry {
  readonly entryId: string;
  readonly entryRef: string;
  readonly periodCode: string;
  readonly postingDate: string;
  readonly memo: string;
  readonly totalDebit: string;
  readonly totalCredit: string;
}

export interface CorpusGlLine {
  readonly lineId: string;
  readonly entryId: string;
  readonly periodCode: string;
  readonly accountCode: string;
  readonly statementLineKey: string;
  readonly debit: string;
  readonly credit: string;
  readonly debitMinor: number;
  readonly creditMinor: number;
}

export interface GeneratedCorpus {
  readonly meta: {
    readonly generatorVersion: string;
    readonly seed: number;
    readonly config: CorpusConfig;
    readonly demoLabel: string;
  };
  readonly company: {
    readonly id: string;
    readonly name: string;
    readonly entityCode: string;
    readonly entityName: string;
    readonly currency: string;
    readonly scale: number;
  };
  readonly calendar: readonly GeneratedPeriod[];
  readonly coa: readonly CorpusAccount[];
  readonly openingBalanceSheet: Readonly<Record<string, string>>;
  readonly openingBalanceSheetMinor: Readonly<Record<string, number>>;
  readonly budget: readonly CorpusPlanLine[];
  readonly deviations: readonly CorpusDeviation[];
  readonly actuals: readonly CorpusActualLine[];
  readonly glEntries: readonly CorpusGlEntry[];
  readonly glLines: readonly CorpusGlLine[];
  readonly summaryCheck: {
    readonly accountCount: number;
    readonly glEntryCount: number;
    readonly glLineCount: number;
    readonly ebitdaFullYear: string;
    readonly netIncomeFullYear: string;
    readonly totalAssetsClosing: string;
    readonly endingCashClosing: string;
    readonly articulationValid: boolean;
  };
  readonly answerKey: readonly CorpusDeviation[];
}

function createMulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface AccountTemplate {
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly normalSide: NormalSide;
  readonly isContra?: boolean;
  readonly isControl?: boolean;
  readonly parentCode: string | null;
  readonly statementLineKey: string;
  readonly monthlyBudgetCents?: number; // signed natural-sign cents base
}

const COA_TEMPLATES: readonly AccountTemplate[] = [
  // Assets (12 accounts, includes leading-zero "001200" per §5.4 / §7.6)
  { code: '1000', name: 'Operating Cash', type: 'asset', normalSide: 'debit', isControl: true, parentCode: null, statementLineKey: 'bs.asset.cash' },
  { code: '1010', name: 'Payroll Clearing Cash', type: 'asset', normalSide: 'debit', parentCode: '1000', statementLineKey: 'bs.asset.cash' },
  { code: '1100', name: 'Accounts Receivable', type: 'asset', normalSide: 'debit', isControl: true, parentCode: null, statementLineKey: 'bs.asset.ar' },
  { code: '1110', name: 'Unbilled Receivables', type: 'asset', normalSide: 'debit', parentCode: '1100', statementLineKey: 'bs.asset.ar' },
  { code: '001200', name: 'Finished Goods Inventory', type: 'asset', normalSide: 'debit', isControl: true, parentCode: null, statementLineKey: 'bs.asset.inventory' },
  { code: '1200', name: 'Raw Materials Inventory', type: 'asset', normalSide: 'debit', parentCode: null, statementLineKey: 'bs.asset.inventory' },
  { code: '1300', name: 'Prepaid Expenses', type: 'asset', normalSide: 'debit', parentCode: null, statementLineKey: 'bs.asset.other_current' },
  { code: '1310', name: 'Employee Advances', type: 'asset', normalSide: 'debit', parentCode: '1300', statementLineKey: 'bs.asset.other_current' },
  { code: '1500', name: 'Computer Equipment', type: 'asset', normalSide: 'debit', parentCode: null, statementLineKey: 'bs.asset.ppe_gross' },
  { code: '1510', name: 'Leasehold Improvements', type: 'asset', normalSide: 'debit', parentCode: null, statementLineKey: 'bs.asset.ppe_gross' },
  { code: '1590', name: 'Accumulated Depreciation', type: 'asset', normalSide: 'credit', isContra: true, parentCode: null, statementLineKey: 'bs.asset.ppe_accum_depr' },
  { code: '1600', name: 'Security Deposits', type: 'asset', normalSide: 'debit', parentCode: null, statementLineKey: 'bs.asset.other_noncurrent' },

  // Liabilities (9 accounts)
  { code: '2000', name: 'Accounts Payable', type: 'liability', normalSide: 'credit', isControl: true, parentCode: null, statementLineKey: 'bs.liability.ap' },
  { code: '2010', name: 'Vendor Accruals', type: 'liability', normalSide: 'credit', parentCode: '2000', statementLineKey: 'bs.liability.ap' },
  { code: '2100', name: 'Accrued Payroll', type: 'liability', normalSide: 'credit', parentCode: null, statementLineKey: 'bs.liability.accrued' },
  { code: '2110', name: 'Accrued Bonus & Taxes', type: 'liability', normalSide: 'credit', parentCode: '2100', statementLineKey: 'bs.liability.accrued' },
  { code: '2200', name: 'Deferred Subscription Revenue', type: 'liability', normalSide: 'credit', parentCode: null, statementLineKey: 'bs.liability.deferred_rev' },
  { code: '2400', name: 'Revolving Credit Line', type: 'liability', normalSide: 'credit', parentCode: null, statementLineKey: 'bs.liability.short_term_debt' },
  { code: '2500', name: 'Term Loan Facility', type: 'liability', normalSide: 'credit', parentCode: null, statementLineKey: 'bs.liability.long_term_debt' },
  { code: '2510', name: 'Equipment Financing Note', type: 'liability', normalSide: 'credit', parentCode: '2500', statementLineKey: 'bs.liability.long_term_debt' },
  { code: '2600', name: 'Long-Term Lease Obligation', type: 'liability', normalSide: 'credit', parentCode: null, statementLineKey: 'bs.liability.other_noncurrent' },

  // Equity (4 accounts)
  { code: '3000', name: 'Common Stock & APIC', type: 'equity', normalSide: 'credit', parentCode: null, statementLineKey: 'bs.equity.common_stock' },
  { code: '3100', name: 'Retained Earnings', type: 'equity', normalSide: 'credit', parentCode: null, statementLineKey: 'bs.equity.retained_earnings' },
  { code: '3200', name: 'Dividends & Distributions', type: 'equity', normalSide: 'debit', isContra: true, parentCode: null, statementLineKey: 'bs.equity.distributions' },
  { code: '3900', name: 'Current Period Net Income', type: 'equity', normalSide: 'credit', parentCode: null, statementLineKey: 'bs.equity.current_net_income' },

  // Revenue (6 accounts)
  { code: '4000', name: 'Core Product Revenue', type: 'revenue', normalSide: 'credit', parentCode: null, statementLineKey: 'pl.revenue.product', monthlyBudgetCents: 32000000 },
  { code: '4010', name: 'Enterprise Platform Subscriptions', type: 'revenue', normalSide: 'credit', parentCode: null, statementLineKey: 'pl.revenue.service', monthlyBudgetCents: 18000000 },
  { code: '4020', name: 'Implementation & Onboarding Fees', type: 'revenue', normalSide: 'credit', parentCode: '4010', statementLineKey: 'pl.revenue.service', monthlyBudgetCents: 4500000 },
  { code: '4090', name: 'Sales Returns & Allowances', type: 'revenue', normalSide: 'credit', parentCode: null, statementLineKey: 'pl.revenue.other', monthlyBudgetCents: -500000 },
  { code: '4200', name: 'Partner Referral Rebates', type: 'revenue', normalSide: 'credit', parentCode: null, statementLineKey: 'pl.revenue.other', monthlyBudgetCents: 0 },
  { code: '4900', name: 'Dormant Licensing Royalties', type: 'revenue', normalSide: 'credit', parentCode: null, statementLineKey: 'pl.revenue.other', monthlyBudgetCents: 0 },

  // Expenses (13 accounts -> total 44 accounts)
  { code: '5000', name: 'Direct Inventory Cost', type: 'expense', normalSide: 'debit', parentCode: null, statementLineKey: 'pl.cogs.direct', monthlyBudgetCents: 14000000 },
  { code: '5100', name: 'Cloud Hosting Infrastructure', type: 'expense', normalSide: 'debit', parentCode: null, statementLineKey: 'pl.cogs.other', monthlyBudgetCents: 4200000 },
  { code: '6000', name: 'Salaries & Wages', type: 'expense', normalSide: 'debit', parentCode: null, statementLineKey: 'pl.opex.payroll', monthlyBudgetCents: 12000000 },
  { code: '6010', name: 'Employee Benefits & Payroll Tax', type: 'expense', normalSide: 'debit', parentCode: '6000', statementLineKey: 'pl.opex.payroll', monthlyBudgetCents: 2400000 },
  { code: '6100', name: 'Facilities & Office Rent', type: 'expense', normalSide: 'debit', parentCode: null, statementLineKey: 'pl.opex.ga', monthlyBudgetCents: 1800000 },
  { code: '6200', name: 'Legal & Professional Fees', type: 'expense', normalSide: 'debit', parentCode: null, statementLineKey: 'pl.opex.ga', monthlyBudgetCents: 1500000 },
  { code: '6300', name: 'Demand Generation Marketing', type: 'expense', normalSide: 'debit', parentCode: null, statementLineKey: 'pl.opex.sm', monthlyBudgetCents: 3500000 },
  { code: '6400', name: 'R&D Engineering Tooling', type: 'expense', normalSide: 'debit', parentCode: null, statementLineKey: 'pl.opex.rd', monthlyBudgetCents: 2800000 },
  { code: '6500', name: 'Travel & Misc OpEx', type: 'expense', normalSide: 'debit', parentCode: null, statementLineKey: 'pl.opex.other', monthlyBudgetCents: 900000 },
  { code: '6900', name: 'Dormant Restructuring Expense', type: 'expense', normalSide: 'debit', parentCode: null, statementLineKey: 'pl.opex.other', monthlyBudgetCents: 0 },
  { code: '7000', name: 'Depreciation Expense', type: 'expense', normalSide: 'debit', parentCode: null, statementLineKey: 'pl.da.depreciation', monthlyBudgetCents: 2000000 },
  { code: '7500', name: 'Interest Expense', type: 'expense', normalSide: 'debit', parentCode: null, statementLineKey: 'pl.nonop.interest_expense', monthlyBudgetCents: 600000 },
  { code: '8000', name: 'Income Tax Expense', type: 'expense', normalSide: 'debit', parentCode: null, statementLineKey: 'pl.tax.income_tax', monthlyBudgetCents: 1800000 },
];

export function generateCorpus(
  seed: number = DEFAULT_CORPUS_SEED,
  config: CorpusConfig = DEFAULT_CORPUS_CONFIG,
): GeneratedCorpus {
  const rng = createMulberry32(seed);
  const scale = config.scale;
  const companyId = `cmp_demo_${seed}`;
  const entityCode = 'ENT-US-HQ';
  const periods = generateFiscalYears({
    kind: '12month',
    startYear: config.fiscalYear,
    yearCount: 1,
  })[0]!.periods;

  const coa: CorpusAccount[] = COA_TEMPLATES.map((t) => ({
    id: `acc_${t.code}`,
    code: t.code,
    name: t.name,
    type: t.type,
    normalSide: t.normalSide,
    ...(t.isContra !== undefined ? { isContra: t.isContra } : {}),
    isControl: t.isControl ?? false,
    parentCode: t.parentCode,
    statementLineKey: t.statementLineKey,
    active: true,
  }));

  const acctByCode = new Map(coa.map((a) => [a.code, a]));

  // Opening Balance Sheet at start of FY2026 (Assets = 4,500,000 = Liab 1,800,000 + Equity 2,700,000)
  const openingBalanceSheetMinor: Record<string, number> = {
    'bs.asset.cash': 120000000, // 1,200,000.00
    'bs.asset.ar': 95000000, // 950,000.00
    'bs.asset.inventory': 85000000, // 850,000.00
    'bs.asset.other_current': 10000000, // 100,000.00
    'bs.asset.ppe_gross': 180000000, // 1,800,000.00
    'bs.asset.ppe_accum_depr': -45000000, // -450,000.00
    'bs.asset.other_noncurrent': 5000000, // 50,000.00
    'bs.liability.ap': 55000000, // 550,000.00
    'bs.liability.accrued': 25000000, // 250,000.00
    'bs.liability.deferred_rev': 20000000, // 200,000.00
    'bs.liability.short_term_debt': 10000000, // 100,000.00
    'bs.liability.long_term_debt': 60000000, // 600,000.00
    'bs.liability.other_noncurrent': 10000000, // 100,000.00
    'bs.equity.common_stock': 150000000, // 1,500,000.00
    'bs.equity.retained_earnings': 120000000, // 1,200,000.00
  };
  const openingBalanceSheet: Record<string, string> = {};
  const openingByKeyDecimal = new Map<string, Decimal>();
  for (const [k, cents] of Object.entries(openingBalanceSheetMinor)) {
    const dec = fromMinorUnits(cents, scale);
    openingBalanceSheet[k] = serialize(dec, scale);
    openingByKeyDecimal.set(k, dec);
  }

  // Step 2: Deterministic seasonal budget plan lines (no random noise added to actuals)
  const budget: CorpusPlanLine[] = [];
  const budgetMinorMap = new Map<string, number>();

  for (const tpl of COA_TEMPLATES) {
    if (tpl.monthlyBudgetCents === undefined) continue;
    for (let pIdx = 0; pIdx < periods.length; pIdx++) {
      const period = periods[pIdx]!;
      let cents = tpl.monthlyBudgetCents;
      if (cents !== 0) {
        // Deterministic seasonal factor derived from PRNG for active non-zero accounts (stays 100% locked inside budget)
        const seasonalBps = Math.round((rng() - 0.5) * 400); // +/- 2.00% deterministic seasonal shape
        if (tpl.code !== '4090') {
          cents = Math.round((cents * (10000 + seasonalBps)) / 10000 / 100) * 100;
        }
      }
      const key = `${tpl.code}::${period.code}`;
      budgetMinorMap.set(key, cents);
      budget.push({
        accountCode: tpl.code,
        periodCode: period.code,
        statementLineKey: tpl.statementLineKey,
        amount: serialize(fromMinorUnits(cents, scale), scale),
        minorUnits: cents,
      });
    }
  }

  // Step 3: Registered deviations (written to answerKey BEFORE GL generation)
  const deviations: CorpusDeviation[] = [
    {
      id: 'DEV-001',
      kind: 'price_variance',
      grain: { account_code: '4000', period: 'P03', entity: entityCode },
      amount: '42000.00',
      minorUnits: 4200000,
      cause: 'Enterprise tier Q1 list price uplift (+5% realized ASP on Core Product)',
      favorability: 'favorable',
      statement_line_key: 'pl.revenue.product',
      expected_finding_key: 'bva:price_variance:4000:P03',
      expected_severity: 'info',
      expected_rule: 'VAR_MATERIAL_FAVORABLE',
    },
    {
      id: 'DEV-002',
      kind: 'volume_variance',
      grain: { account_code: '4010', period: 'P06', entity: entityCode },
      amount: '-28000.00',
      minorUnits: -2800000,
      cause: 'Two enterprise renewals slipped to Q3 reducing subscription seats',
      favorability: 'unfavorable',
      statement_line_key: 'pl.revenue.service',
      expected_finding_key: 'bva:volume_variance:4010:P06',
      expected_severity: 'warn',
      expected_rule: 'VAR_MATERIAL_UNFAVORABLE',
    },
    {
      id: 'DEV-003A',
      kind: 'timing_shift',
      grain: { account_code: '6300', period: 'P04', entity: entityCode },
      amount: '-15000.00',
      minorUnits: -1500000,
      cause: 'Spring field conference deferred from April to May (Part 1 of timing shift)',
      favorability: 'favorable',
      statement_line_key: 'pl.opex.sm',
      expected_finding_key: 'bva:timing_shift:6300:P04',
      expected_severity: 'info',
      expected_rule: 'VAR_TIMING_SHIFT',
    },
    {
      id: 'DEV-003B',
      kind: 'timing_shift',
      grain: { account_code: '6300', period: 'P05', entity: entityCode },
      amount: '15000.00',
      minorUnits: 1500000,
      cause: 'Deferred spring field conference invoiced in May (Part 2 of timing shift)',
      favorability: 'unfavorable',
      statement_line_key: 'pl.opex.sm',
      expected_finding_key: 'bva:timing_shift:6300:P05',
      expected_severity: 'warn',
      expected_rule: 'VAR_TIMING_SHIFT',
    },
    {
      id: 'DEV-004',
      kind: 'one_off_expense',
      grain: { account_code: '6200', period: 'P08', entity: entityCode },
      amount: '24000.00',
      minorUnits: 2400000,
      cause: 'Unbudgeted patent defense legal settlement retainer',
      favorability: 'unfavorable',
      statement_line_key: 'pl.opex.ga',
      expected_finding_key: 'bva:one_off_expense:6200:P08',
      expected_severity: 'warn',
      expected_rule: 'VAR_ONE_OFF_OPEX',
    },
    {
      id: 'DEV-005',
      kind: 'favorable_expense',
      grain: { account_code: '6400', period: 'P09', entity: entityCode },
      amount: '-11000.00',
      minorUnits: -1100000,
      cause: 'R&D cloud compute reserved-instance savings renegotiated early',
      favorability: 'favorable',
      statement_line_key: 'pl.opex.rd',
      expected_finding_key: 'bva:favorable_expense:6400:P09',
      expected_severity: 'info',
      expected_rule: 'VAR_MATERIAL_FAVORABLE',
    },
    {
      id: 'DEV-006',
      kind: 'zero_plan_non_zero_actual',
      grain: { account_code: '4200', period: 'P10', entity: entityCode },
      amount: '7500.00',
      minorUnits: 750000,
      cause: 'Unbudgeted partner referral rebate payout (tests 0-plan / non-zero actual -> n/m %)',
      favorability: 'favorable',
      statement_line_key: 'pl.revenue.other',
      expected_finding_key: 'bva:zero_plan_nm:4200:P10',
      expected_severity: 'info',
      expected_rule: 'VAR_ZERO_PLAN_NM',
    },
    {
      id: 'DEV-007',
      kind: 'negative_plan',
      grain: { account_code: '4090', period: 'P07', entity: entityCode },
      amount: '1500.00',
      minorUnits: 150000,
      cause: 'Lower customer returns (-3,500 actual vs -5,000 negative plan -> +1,500 fav variance)',
      favorability: 'favorable',
      statement_line_key: 'pl.revenue.other',
      expected_finding_key: 'bva:negative_plan:4090:P07',
      expected_severity: 'info',
      expected_rule: 'VAR_NEGATIVE_PLAN',
    },
  ];

  // Structural M1 expectations linked to messy-export / import quarantine rules (§7.3, §7.4)
  const structuralFindings: CorpusDeviation[] = [
    {
      id: 'STR-001',
      kind: 'structural_unmapped',
      grain: { account_code: '9999', period: 'P01', entity: entityCode },
      amount: '1250.00',
      minorUnits: 125000,
      cause: 'Unmapped ERP account 9999 quarantined during messy import',
      favorability: 'na',
      statement_line_key: 'pl.opex.other',
      expected_finding_key: 'import:quarantine:UNMAPPED_ACCOUNT:9999',
      expected_severity: 'critical',
      expected_rule: 'IMPORT_UNMAPPED_ACCOUNT',
    },
    {
      id: 'STR-002',
      kind: 'structural_duplicate',
      grain: { account_code: '6000', period: 'P01', entity: entityCode },
      amount: '4500.00',
      minorUnits: 450000,
      cause: 'Duplicate GL row detected in messy import and quarantined cleanly',
      favorability: 'na',
      statement_line_key: 'pl.opex.payroll',
      expected_finding_key: 'import:quarantine:DUPLICATE_ROW:JE-MESSY-002',
      expected_severity: 'warn',
      expected_rule: 'IMPORT_DUPLICATE_ROW',
    },
  ];

  const devMap = new Map<string, number>();
  for (const d of deviations) {
    const key = `${d.grain.account_code}::${d.grain.period}`;
    devMap.set(key, (devMap.get(key) ?? 0) + d.minorUnits);
  }

  // Step 4: Actuals = budget + registered deviations (zero unregistered noise)
  const actuals: CorpusActualLine[] = [];
  const actualByAccountPeriod = new Map<string, number>();

  for (const b of budget) {
    const key = `${b.accountCode}::${b.periodCode}`;
    const devMinor = devMap.get(key) ?? 0;
    const actMinor = b.minorUnits + devMinor;
    actualByAccountPeriod.set(key, actMinor);
    actuals.push({
      accountCode: b.accountCode,
      periodCode: b.periodCode,
      statementLineKey: b.statementLineKey,
      budgetAmount: b.amount,
      deviationAmount: serialize(fromMinorUnits(devMinor, scale), scale),
      actualAmount: serialize(fromMinorUnits(actMinor, scale), scale),
      actualMinorUnits: actMinor,
    });
  }

  // Step 5: Realize actuals + BS events via double-entry GL postings per period
  const glEntries: CorpusGlEntry[] = [];
  const glLines: CorpusGlLine[] = [];
  const glLineFacts: GlLineFact[] = [];
  let entrySeq = 0;
  let lineSeq = 0;

  const postEntry = (
    period: GeneratedPeriod,
    memo: string,
    legs: readonly { readonly accountCode: string; readonly debitCents: number; readonly creditCents: number }[],
  ) => {
    const nonZeroLegs = legs.filter((l) => l.debitCents > 0 || l.creditCents > 0);
    if (nonZeroLegs.length === 0) return;

    let dSum = 0;
    let cSum = 0;
    for (const l of nonZeroLegs) {
      dSum += l.debitCents;
      cSum += l.creditCents;
    }
    if (dSum !== cSum) {
      throw new Error(`CORPUS_GENERATOR_UNBALANCED_ENTRY: ${memo} debit=${dSum} credit=${cSum}`);
    }

    entrySeq += 1;
    const entryId = `gle_${String(entrySeq).padStart(4, '0')}`;
    const entryRef = `JE-${period.code}-${String(entrySeq).padStart(4, '0')}`;

    glEntries.push({
      entryId,
      entryRef,
      periodCode: period.code,
      postingDate: period.endDate,
      memo,
      totalDebit: serialize(fromMinorUnits(dSum, scale), scale),
      totalCredit: serialize(fromMinorUnits(cSum, scale), scale),
    });

    for (const leg of nonZeroLegs) {
      const acct = acctByCode.get(leg.accountCode);
      if (!acct) {
        throw new Error(`CORPUS_UNKNOWN_ACCOUNT: ${leg.accountCode}`);
      }
      lineSeq += 1;
      const debitDec = fromMinorUnits(leg.debitCents, scale);
      const creditDec = fromMinorUnits(leg.creditCents, scale);
      glLines.push({
        lineId: `gll_${String(lineSeq).padStart(5, '0')}`,
        entryId,
        periodCode: period.code,
        accountCode: acct.code,
        statementLineKey: acct.statementLineKey,
        debit: serialize(debitDec, scale),
        credit: serialize(creditDec, scale),
        debitMinor: leg.debitCents,
        creditMinor: leg.creditCents,
      });
      glLineFacts.push({
        entryId,
        accountId: acct.id,
        periodId: period.code,
        debit: debitDec,
        credit: creditDec,
      });
    }
  };

  for (let pIdx = 0; pIdx < periods.length; pIdx++) {
    const period = periods[pIdx]!;
    const getAct = (code: string) => actualByAccountPeriod.get(`${code}::${period.code}`) ?? 0;

    // 1. Product Revenue (70% Cash, 30% AR)
    const rev4000 = getAct('4000');
    if (rev4000 > 0) {
      const cashPart = Math.round(rev4000 * 0.7);
      const arPart = rev4000 - cashPart;
      postEntry(period, 'Core product billing', [
        { accountCode: '1000', debitCents: cashPart, creditCents: 0 },
        { accountCode: '1100', debitCents: arPart, creditCents: 0 },
        { accountCode: '4000', debitCents: 0, creditCents: rev4000 },
      ]);
    }

    // 2. Service & Implementation Revenue (60% Cash, 40% AR) + Other Revenue rebates (100% Cash)
    const rev4010 = getAct('4010');
    const rev4020 = getAct('4020');
    const serviceTotal = rev4010 + rev4020;
    if (serviceTotal > 0) {
      const cashPart = Math.round(serviceTotal * 0.6);
      const arPart = serviceTotal - cashPart;
      postEntry(period, 'Subscription & onboarding revenue', [
        { accountCode: '1000', debitCents: cashPart, creditCents: 0 },
        { accountCode: '1100', debitCents: arPart, creditCents: 0 },
        { accountCode: '4010', debitCents: 0, creditCents: rev4010 },
        { accountCode: '4020', debitCents: 0, creditCents: rev4020 },
      ]);
    }

    const rev4090 = getAct('4090'); // negative natural amount -> debit 4090, credit Cash
    if (rev4090 < 0) {
      const mag = -rev4090;
      postEntry(period, 'Customer returns & allowances', [
        { accountCode: '4090', debitCents: mag, creditCents: 0 },
        { accountCode: '1000', debitCents: 0, creditCents: mag },
      ]);
    }

    const rev4200 = getAct('4200');
    if (rev4200 > 0) {
      postEntry(period, 'Partner referral rebate received', [
        { accountCode: '1000', debitCents: rev4200, creditCents: 0 },
        { accountCode: '4200', debitCents: 0, creditCents: rev4200 },
      ]);
    }

    // 3. COGS: Direct Inventory consumption + Cloud Hosting via AP
    const cogs5000 = getAct('5000');
    if (cogs5000 > 0) {
      postEntry(period, 'Inventory cost of goods sold', [
        { accountCode: '5000', debitCents: cogs5000, creditCents: 0 },
        { accountCode: '001200', debitCents: 0, creditCents: cogs5000 },
      ]);
    }
    const cogs5100 = getAct('5100');
    if (cogs5100 > 0) {
      postEntry(period, 'Cloud infrastructure invoices', [
        { accountCode: '5100', debitCents: cogs5100, creditCents: 0 },
        { accountCode: '2000', debitCents: 0, creditCents: cogs5100 },
      ]);
    }

    // 4. OpEx Payroll (85% Cash, 15% Accrued Payroll)
    const pay6000 = getAct('6000');
    const pay6010 = getAct('6010');
    const payrollSum = pay6000 + pay6010;
    if (payrollSum > 0) {
      const cashPay = Math.round(payrollSum * 0.85);
      const accruedPay = payrollSum - cashPay;
      postEntry(period, 'Monthly payroll & benefits run', [
        { accountCode: '6000', debitCents: pay6000, creditCents: 0 },
        { accountCode: '6010', debitCents: pay6010, creditCents: 0 },
        { accountCode: '1000', debitCents: 0, creditCents: cashPay },
        { accountCode: '2100', debitCents: 0, creditCents: accruedPay },
      ]);
    }

    // 5. Remaining OpEx (Rent, Legal, S&M, R&D, Travel) settled in Cash / AP
    const opexCash = getAct('6100') + getAct('6500');
    postEntry(period, 'Facilities & travel cash disbursements', [
      { accountCode: '6100', debitCents: getAct('6100'), creditCents: 0 },
      { accountCode: '6500', debitCents: getAct('6500'), creditCents: 0 },
      { accountCode: '1000', debitCents: 0, creditCents: opexCash },
    ]);
    const opexAp = getAct('6200') + getAct('6300') + getAct('6400');
    postEntry(period, 'Vendor G&A, Marketing & R&D invoices', [
      { accountCode: '6200', debitCents: getAct('6200'), creditCents: 0 },
      { accountCode: '6300', debitCents: getAct('6300'), creditCents: 0 },
      { accountCode: '6400', debitCents: getAct('6400'), creditCents: 0 },
      { accountCode: '2000', debitCents: 0, creditCents: opexAp },
    ]);

    // 6. Non-Cash Depreciation (CFO addback)
    const depr7000 = getAct('7000');
    if (depr7000 > 0) {
      postEntry(period, 'Monthly fixed asset depreciation', [
        { accountCode: '7000', debitCents: depr7000, creditCents: 0 },
        { accountCode: '1590', debitCents: 0, creditCents: depr7000 },
      ]);
    }

    // 7. Interest Expense & Income Taxes (Cash)
    const int7500 = getAct('7500');
    if (int7500 > 0) {
      postEntry(period, 'Term loan interest payment', [
        { accountCode: '7500', debitCents: int7500, creditCents: 0 },
        { accountCode: '1000', debitCents: 0, creditCents: int7500 },
      ]);
    }
    const tax8000 = getAct('8000');
    if (tax8000 > 0) {
      postEntry(period, 'Estimated corporate income tax payment', [
        { accountCode: '8000', debitCents: tax8000, creditCents: 0 },
        { accountCode: '1000', debitCents: 0, creditCents: tax8000 },
      ]);
    }

    // 8. Working-capital cycle settlements (AR collection, Inventory purchase, AP payment, Accrued settlement)
    const arCollect = 16500000;
    postEntry(period, 'Customer AR collections', [
      { accountCode: '1000', debitCents: arCollect, creditCents: 0 },
      { accountCode: '1100', debitCents: 0, creditCents: arCollect },
    ]);
    const invPurchase = 14200000;
    postEntry(period, 'Inventory replenishment on account', [
      { accountCode: '001200', debitCents: invPurchase, creditCents: 0 },
      { accountCode: '2000', debitCents: 0, creditCents: invPurchase },
    ]);
    const apPay = 24800000;
    postEntry(period, 'Accounts payable vendor settlement', [
      { accountCode: '2000', debitCents: apPay, creditCents: 0 },
      { accountCode: '1000', debitCents: 0, creditCents: apPay },
    ]);
    const accruedPayOut = 2100000;
    postEntry(period, 'Prior payroll accrual settlement', [
      { accountCode: '2100', debitCents: accruedPayOut, creditCents: 0 },
      { accountCode: '1000', debitCents: 0, creditCents: accruedPayOut },
    ]);
    postEntry(period, 'Annual prepaid insurance & advances', [
      { accountCode: '1300', debitCents: 400000, creditCents: 0 },
      { accountCode: '1000', debitCents: 0, creditCents: 400000 },
    ]);
    postEntry(period, 'Upfront deferred subscription receipt', [
      { accountCode: '1000', debitCents: 600000, creditCents: 0 },
      { accountCode: '2200', debitCents: 0, creditCents: 600000 },
    ]);

    // 9. Investing (Capex) & Financing (Debt draw, Equity injection, Debt repayment, Dividend distribution)
    if (pIdx === 1 || pIdx === 5 || pIdx === 8) {
      const capexAmt = pIdx === 5 ? 12000000 : 8000000;
      postEntry(period, 'Capital expenditure — engineering servers & office buildout', [
        { accountCode: '1500', debitCents: capexAmt, creditCents: 0 },
        { accountCode: '1000', debitCents: 0, creditCents: capexAmt },
      ]);
    }
    if (pIdx === 1) {
      postEntry(period, 'Term loan facility draw', [
        { accountCode: '1000', debitCents: 25000000, creditCents: 0 },
        { accountCode: '2500', debitCents: 0, creditCents: 25000000 },
      ]);
    }
    if (pIdx === 2) {
      postEntry(period, 'Series growth equity issuance', [
        { accountCode: '1000', debitCents: 15000000, creditCents: 0 },
        { accountCode: '3000', debitCents: 0, creditCents: 15000000 },
      ]);
    }
    if (pIdx === 9) {
      postEntry(period, 'Term loan principal repayment', [
        { accountCode: '2500', debitCents: 10000000, creditCents: 0 },
        { accountCode: '1000', debitCents: 0, creditCents: 10000000 },
      ]);
    }
    if (pIdx === 10) {
      postEntry(period, 'Annual shareholder dividend distribution', [
        { accountCode: '3200', debitCents: 7500000, creditCents: 0 },
        { accountCode: '1000', debitCents: 0, creditCents: 7500000 },
      ]);
    }
  }

  const bundle = buildArticulatingStatements({
    accounts: coa,
    openingBalancesByKey: openingByKeyDecimal,
    periodGlLines: glLineFacts,
  });

  // Verify A1-A5 internally before returning
  if (!bundle.articulation.valid) {
    const failed = bundle.articulation.checks.filter((c) => !c.passed).map((c) => `${c.id}: ${c.detail}`);
    throw new Error(`CORPUS_ARTICULATION_FAILED: ${failed.join(' | ')}`);
  }

  // Cross-check plan vs actual coherence explicitly
  const diffCheck = sum(actuals.map((a) => sub(money(a.actualAmount), money(a.budgetAmount))));
  const devSum = sum(deviations.map((d) => money(d.amount)));
  if (!diffCheck.eq(devSum)) {
    throw new Error(`CORPUS_COHERENCE_MISMATCH: actual-budget=${diffCheck.toFixed()} != devSum=${devSum.toFixed()}`);
  }

  const answerKey = [...deviations, ...structuralFindings];

  return {
    meta: {
      generatorVersion: CORPUS_GENERATOR_VERSION,
      seed,
      config,
      demoLabel: 'Sample Co — DEMO — SYNTHETIC DATA',
    },
    company: {
      id: companyId,
      name: 'Sample Co — DEMO — SYNTHETIC DATA',
      entityCode,
      entityName: 'Sample Co US HQ',
      currency: config.currency,
      scale: config.scale,
    },
    calendar: periods,
    coa,
    openingBalanceSheet,
    openingBalanceSheetMinor,
    budget,
    deviations,
    actuals,
    glEntries,
    glLines,
    summaryCheck: {
      accountCount: coa.length,
      glEntryCount: glEntries.length,
      glLineCount: glLines.length,
      ebitdaFullYear: serialize(bundle.pnl.ebitda, scale),
      netIncomeFullYear: serialize(bundle.pnl.netIncome, scale),
      totalAssetsClosing: serialize(bundle.balanceSheet.totalAssets, scale),
      endingCashClosing: serialize(bundle.cashFlow.endingCash, scale),
      articulationValid: bundle.articulation.valid,
    },
    answerKey,
  };
}
