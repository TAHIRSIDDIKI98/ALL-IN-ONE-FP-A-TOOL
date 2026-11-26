import Decimal from 'decimal.js';
import { generateFiscalYears, type GeneratedPeriod } from '../../core/calendar/index.js';
import { fromMinorUnits, money, serialize, sub, sum } from '../../core/money/index.js';
import {
  buildRollingForecast,
  compareScenarios,
  computeDriverPlan,
  type DriverDefinition,
} from '../../core/planning/index.js';
import {
  buildArticulatingStatements,
  type GlLineFact,
} from '../../core/statements/index.js';
import {
  compileWorkforceModuleToDrivers,
  type WorkforcePositionInput,
} from '../../core/workforce/index.js';
import type {
  CorpusAccount,
  CorpusActualLine,
  CorpusConfig,
  CorpusDeviation,
  CorpusGlEntry,
  CorpusGlLine,
  CorpusPlanLine,
} from './generator.js';

export const M2_CORPUS_GENERATOR_VERSION = '2.0.0';
export const DEFAULT_M2_CORPUS_SEED = 202602;

export const DEFAULT_M2_CORPUS_CONFIG: CorpusConfig = {
  fiscalYear: 2026,
  currency: 'USD',
  scale: 2,
};

export interface M2AnswerKeyItem {
  readonly id: string;
  readonly domain:
    | 'tenant_b_variance'
    | 'rolling_forecast'
    | 'scenario_delta'
    | 'workforce_ramp'
    | 'workforce_attrition'
    | 'workforce_inactive_excluded'
    | 'tenant_isolation';
  readonly grain: {
    readonly company_id: string;
    readonly account_code: string;
    readonly period: string;
    readonly entity: string;
    readonly position_code?: string;
    readonly scenario?: string;
  };
  readonly amount: string;
  readonly statement_line_key: string;
  readonly expected_finding_key: string;
  readonly expected_severity: 'info' | 'warn' | 'critical';
  readonly cause: string;
}

export interface GeneratedM2Corpus {
  readonly meta: {
    readonly generatorVersion: string;
    readonly seed: number;
    readonly config: CorpusConfig;
    readonly demoLabel: string;
  };
  readonly tenantB: {
    readonly company: {
      readonly id: string;
      readonly name: string;
      readonly calendarKind: '454';
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
  };
  readonly rollingForecastCorpus: {
    readonly cutoffPeriod: string;
    readonly scenarioName: string;
    readonly periods: readonly string[];
    readonly forecastDrivers: readonly DriverDefinition[];
    readonly actualFacts: readonly { readonly accountCode: string; readonly periodCode: string; readonly amount: string }[];
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
    readonly positions: readonly WorkforcePositionInput[];
    readonly summaryCheck: {
      readonly activePositionCount: number;
      readonly inactiveExcludedCount: number;
      readonly grandTotalFteMonths: string;
      readonly grandTotalCost: string;
    };
  };
  readonly answerKey: readonly M2AnswerKeyItem[];
}

interface TenantBAccountTemplate {
  readonly code: string;
  readonly name: string;
  readonly type: CorpusAccount['type'];
  readonly normalSide: CorpusAccount['normalSide'];
  readonly isContra?: boolean;
  readonly isControl?: boolean;
  readonly parentCode: string | null;
  readonly statementLineKey: string;
  readonly monthlyBudgetCents?: number;
}

const TENANT_B_COA_TEMPLATES: readonly TenantBAccountTemplate[] = [
  // Assets (8) — preserves distinct leading-zero '001400' alongside '1400'
  { code: '1000', name: 'Plant Operating Cash', type: 'asset', normalSide: 'debit', isControl: true, parentCode: null, statementLineKey: 'bs.asset.cash' },
  { code: '1100', name: 'Trade Receivables', type: 'asset', normalSide: 'debit', isControl: true, parentCode: null, statementLineKey: 'bs.asset.ar' },
  { code: '001400', name: 'WIP Manufacturing Inventory', type: 'asset', normalSide: 'debit', isControl: true, parentCode: null, statementLineKey: 'bs.asset.inventory' },
  { code: '1400', name: 'Raw Materials Inventory', type: 'asset', normalSide: 'debit', parentCode: '001400', statementLineKey: 'bs.asset.inventory' },
  { code: '1300', name: 'Plant Prepaids', type: 'asset', normalSide: 'debit', parentCode: null, statementLineKey: 'bs.asset.other_current' },
  { code: '1500', name: 'CNC Machinery & Tooling', type: 'asset', normalSide: 'debit', parentCode: null, statementLineKey: 'bs.asset.ppe_gross' },
  { code: '1590', name: 'Machinery Accumulated Depreciation', type: 'asset', normalSide: 'credit', isContra: true, parentCode: null, statementLineKey: 'bs.asset.ppe_accum_depr' },
  { code: '1600', name: 'Utility & Lease Deposits', type: 'asset', normalSide: 'debit', parentCode: null, statementLineKey: 'bs.asset.other_noncurrent' },

  // Liabilities (5)
  { code: '2000', name: 'Trade Accounts Payable', type: 'liability', normalSide: 'credit', isControl: true, parentCode: null, statementLineKey: 'bs.liability.ap' },
  { code: '2100', name: 'Factory Payroll Accrual', type: 'liability', normalSide: 'credit', parentCode: null, statementLineKey: 'bs.liability.accrued' },
  { code: '2200', name: 'Customer tooling deposits', type: 'liability', normalSide: 'credit', parentCode: null, statementLineKey: 'bs.liability.deferred_rev' },
  { code: '2500', name: 'Equipment Term Loan', type: 'liability', normalSide: 'credit', parentCode: null, statementLineKey: 'bs.liability.long_term_debt' },
  { code: '2600', name: 'Environmental Remediation Reserve', type: 'liability', normalSide: 'credit', parentCode: null, statementLineKey: 'bs.liability.other_noncurrent' },

  // Equity (4)
  { code: '3000', name: 'Member Paid-In Capital', type: 'equity', normalSide: 'credit', parentCode: null, statementLineKey: 'bs.equity.common_stock' },
  { code: '3100', name: 'Retained Earnings', type: 'equity', normalSide: 'credit', parentCode: null, statementLineKey: 'bs.equity.retained_earnings' },
  { code: '3200', name: 'Owner Distributions', type: 'equity', normalSide: 'debit', isContra: true, parentCode: null, statementLineKey: 'bs.equity.distributions' },
  { code: '3900', name: 'Current Period Net Income', type: 'equity', normalSide: 'credit', parentCode: null, statementLineKey: 'bs.equity.current_net_income' },

  // Revenue (4)
  { code: '4000', name: 'Precision Assemblies Revenue', type: 'revenue', normalSide: 'credit', parentCode: null, statementLineKey: 'pl.revenue.product', monthlyBudgetCents: 18500000 },
  { code: '4090', name: 'Scrap & Warranty Allowances', type: 'revenue', normalSide: 'credit', parentCode: null, statementLineKey: 'pl.revenue.other', monthlyBudgetCents: -250000 },
  { code: '4200', name: 'Unbudgeted Freight Recovery', type: 'revenue', normalSide: 'credit', parentCode: null, statementLineKey: 'pl.revenue.other', monthlyBudgetCents: 0 },
  { code: '4900', name: 'Dormant Patent Royalties', type: 'revenue', normalSide: 'credit', parentCode: null, statementLineKey: 'pl.revenue.other', monthlyBudgetCents: 0 },

  // Expense (8 -> total 29 distinct Tenant B accounts)
  { code: '5000', name: 'Steel & Alloy Materials COGS', type: 'expense', normalSide: 'debit', parentCode: null, statementLineKey: 'pl.cogs.direct', monthlyBudgetCents: 7400000 },
  { code: '5100', name: 'Direct Assembly Labor', type: 'expense', normalSide: 'debit', parentCode: null, statementLineKey: 'pl.cogs.other', monthlyBudgetCents: 2600000 },
  { code: '6000', name: 'Plant Supervision & Engineering', type: 'expense', normalSide: 'debit', parentCode: null, statementLineKey: 'pl.opex.payroll', monthlyBudgetCents: 3100000 },
  { code: '6100', name: 'Factory Utilities & Maintenance', type: 'expense', normalSide: 'debit', parentCode: null, statementLineKey: 'pl.opex.ga', monthlyBudgetCents: 1200000 },
  { code: '6300', name: 'Industrial Trade Shows', type: 'expense', normalSide: 'debit', parentCode: null, statementLineKey: 'pl.opex.sm', monthlyBudgetCents: 650000 },
  { code: '6400', name: 'Manufacturing Process R&D', type: 'expense', normalSide: 'debit', parentCode: null, statementLineKey: 'pl.opex.rd', monthlyBudgetCents: 800000 },
  { code: '7000', name: 'CNC Depreciation Expense', type: 'expense', normalSide: 'debit', parentCode: null, statementLineKey: 'pl.da.depreciation', monthlyBudgetCents: 950000 },
  { code: '8000', name: 'State & Federal Income Tax', type: 'expense', normalSide: 'debit', parentCode: null, statementLineKey: 'pl.tax.income_tax', monthlyBudgetCents: 420000 },
];

function createTenantBSeasonFactorBps(seed: number, code: string, periodIdx: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < code.length; i += 1) {
    hash = ((hash * 33) ^ code.charCodeAt(i)) >>> 0;
  }
  hash = ((hash + periodIdx * 97) * 2654435761) >>> 0;
  // Deterministic range [-300, +300] bps (+/- 3.00%)
  return (hash % 601) - 300;
}

export function generateM2Corpus(
  seed: number = DEFAULT_M2_CORPUS_SEED,
  config: CorpusConfig = DEFAULT_M2_CORPUS_CONFIG,
): GeneratedM2Corpus {
  const scale = config.scale;
  const companyId = `cmp_tenant_b_${seed}`;
  const companyName = 'Northstar Manufacturing — DEMO — SYNTHETIC DATA';
  const entityCode = 'ENT-MW-PLANT';
  const entityName = 'Northstar Midwest Plant';
  const calendar = generateFiscalYears({
    kind: '454',
    startYear: config.fiscalYear,
    yearCount: 1,
  })[0]!.periods;

  const coa: CorpusAccount[] = TENANT_B_COA_TEMPLATES.map((t) => ({
    id: `acc_b_${t.code}`,
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

  // Opening BS at start of FY2026: Assets 2,400,000.00 = Liab 900,000.00 + Equity 1,500,000.00
  const openingBalanceSheetMinor: Record<string, number> = {
    'bs.asset.cash': 62000000, // 620,000.00
    'bs.asset.ar': 48000000, // 480,000.00
    'bs.asset.inventory': 51000000, // 510,000.00
    'bs.asset.other_current': 6000000, // 60,000.00
    'bs.asset.ppe_gross': 98000000, // 980,000.00
    'bs.asset.ppe_accum_depr': -28000000, // -280,000.00
    'bs.asset.other_noncurrent': 3000000, // 30,000.00
    'bs.liability.ap': 26000000, // 260,000.00
    'bs.liability.accrued': 11000000, // 110,000.00
    'bs.liability.deferred_rev': 8000000, // 80,000.00
    'bs.liability.long_term_debt': 40000000, // 400,000.00
    'bs.liability.other_noncurrent': 5000000, // 50,000.00
    'bs.equity.common_stock': 85000000, // 850,000.00
    'bs.equity.retained_earnings': 65000000, // 650,000.00
  };
  const openingBalanceSheet: Record<string, string> = {};
  const openingByKeyDecimal = new Map<string, Decimal>();
  for (const [k, cents] of Object.entries(openingBalanceSheetMinor)) {
    const dec = fromMinorUnits(cents, scale);
    openingBalanceSheet[k] = serialize(dec, scale);
    openingByKeyDecimal.set(k, dec);
  }

  // Budget plan lines for Tenant B
  const budget: CorpusPlanLine[] = [];
  for (const tpl of TENANT_B_COA_TEMPLATES) {
    if (tpl.monthlyBudgetCents === undefined) continue;
    for (let pIdx = 0; pIdx < calendar.length; pIdx += 1) {
      const period = calendar[pIdx]!;
      let cents = tpl.monthlyBudgetCents;
      if (cents !== 0 && tpl.code !== '4090') {
        const bps = createTenantBSeasonFactorBps(seed, tpl.code, pIdx);
        cents = Math.round((cents * (10000 + bps)) / 10000 / 100) * 100;
      }
      budget.push({
        accountCode: tpl.code,
        periodCode: period.code,
        statementLineKey: tpl.statementLineKey,
        amount: serialize(fromMinorUnits(cents, scale), scale),
        minorUnits: cents,
      });
    }
  }

  // Registered Tenant B deviations
  const deviations: CorpusDeviation[] = [
    {
      id: 'TB-DEV-001',
      kind: 'price_variance',
      grain: { account_code: '4000', period: 'P02', entity: entityCode },
      amount: '18500.00',
      minorUnits: 1850000,
      cause: 'Tier-1 OEM surcharge recovered on precision turbine housings',
      favorability: 'favorable',
      statement_line_key: 'pl.revenue.product',
      expected_finding_key: 'bva:price_variance:4000:P02',
      expected_severity: 'info',
      expected_rule: 'VAR_MATERIAL_FAVORABLE',
    },
    {
      id: 'TB-DEV-002',
      kind: 'volume_variance',
      grain: { account_code: '5000', period: 'P05', entity: entityCode },
      amount: '9200.00',
      minorUnits: 920000,
      cause: 'Alloy spot market spike during May replenishment',
      favorability: 'unfavorable',
      statement_line_key: 'pl.cogs.direct',
      expected_finding_key: 'bva:volume_variance:5000:P05',
      expected_severity: 'warn',
      expected_rule: 'VAR_MATERIAL_UNFAVORABLE',
    },
    {
      id: 'TB-DEV-003A',
      kind: 'timing_shift',
      grain: { account_code: '6300', period: 'P04', entity: entityCode },
      amount: '-6000.00',
      minorUnits: -600000,
      cause: 'IMTS booth deposit deferred from P04 to P05',
      favorability: 'favorable',
      statement_line_key: 'pl.opex.sm',
      expected_finding_key: 'bva:timing_shift:6300:P04',
      expected_severity: 'info',
      expected_rule: 'VAR_TIMING_SHIFT',
    },
    {
      id: 'TB-DEV-003B',
      kind: 'timing_shift',
      grain: { account_code: '6300', period: 'P05', entity: entityCode },
      amount: '6000.00',
      minorUnits: 600000,
      cause: 'IMTS booth deposit posted in P05',
      favorability: 'unfavorable',
      statement_line_key: 'pl.opex.sm',
      expected_finding_key: 'bva:timing_shift:6300:P05',
      expected_severity: 'warn',
      expected_rule: 'VAR_TIMING_SHIFT',
    },
    {
      id: 'TB-DEV-004',
      kind: 'zero_plan_non_zero_actual',
      grain: { account_code: '4200', period: 'P09', entity: entityCode },
      amount: '4400.00',
      minorUnits: 440000,
      cause: 'Unbudgeted expedited freight recovery billed to distributor',
      favorability: 'favorable',
      statement_line_key: 'pl.revenue.other',
      expected_finding_key: 'bva:zero_plan_nm:4200:P09',
      expected_severity: 'info',
      expected_rule: 'VAR_ZERO_PLAN_NM',
    },
    {
      id: 'TB-DEV-005',
      kind: 'negative_plan',
      grain: { account_code: '4090', period: 'P08', entity: entityCode },
      amount: '1000.00',
      minorUnits: 100000,
      cause: 'Lower warranty claims (-1,500.00 actual vs -2,500.00 negative plan)',
      favorability: 'favorable',
      statement_line_key: 'pl.revenue.other',
      expected_finding_key: 'bva:negative_plan:4090:P08',
      expected_severity: 'info',
      expected_rule: 'VAR_NEGATIVE_PLAN',
    },
  ];

  const devMap = new Map<string, number>();
  for (const d of deviations) {
    const key = `${d.grain.account_code}::${d.grain.period}`;
    devMap.set(key, (devMap.get(key) ?? 0) + d.minorUnits);
  }

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

  // Realize balanced double-entry GL for Tenant B
  const glEntries: CorpusGlEntry[] = [];
  const glLines: CorpusGlLine[] = [];
  const glLineFacts: GlLineFact[] = [];
  let entrySeq = 0;
  let lineSeq = 0;

  const postEntry = (
    period: GeneratedPeriod,
    memo: string,
    legs: readonly { readonly accountCode: string; readonly debitCents: number; readonly creditCents: number }[],
  ): void => {
    const nonZeroLegs = legs.filter((l) => l.debitCents > 0 || l.creditCents > 0);
    if (nonZeroLegs.length === 0) return;

    let dSum = 0;
    let cSum = 0;
    for (const l of nonZeroLegs) {
      dSum += l.debitCents;
      cSum += l.creditCents;
    }
    if (dSum !== cSum) {
      throw new Error(`M2_CORPUS_UNBALANCED_ENTRY: ${memo} ${dSum}!=${cSum}`);
    }

    entrySeq += 1;
    const entryId = `gle_b_${String(entrySeq).padStart(4, '0')}`;
    const entryRef = `NM-${period.code}-${String(entrySeq).padStart(4, '0')}`;

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
        throw new Error(`M2_CORPUS_UNKNOWN_ACCOUNT: ${leg.accountCode}`);
      }
      lineSeq += 1;
      const debitDec = fromMinorUnits(leg.debitCents, scale);
      const creditDec = fromMinorUnits(leg.creditCents, scale);
      glLines.push({
        lineId: `gll_b_${String(lineSeq).padStart(5, '0')}`,
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

  for (let pIdx = 0; pIdx < calendar.length; pIdx += 1) {
    const period = calendar[pIdx]!;
    const getAct = (code: string) => actualByAccountPeriod.get(`${code}::${period.code}`) ?? 0;

    const rev4000 = getAct('4000');
    if (rev4000 > 0) {
      const cashPart = Math.round(rev4000 * 0.65);
      const arPart = rev4000 - cashPart;
      postEntry(period, 'Precision turbine billing', [
        { accountCode: '1000', debitCents: cashPart, creditCents: 0 },
        { accountCode: '1100', debitCents: arPart, creditCents: 0 },
        { accountCode: '4000', debitCents: 0, creditCents: rev4000 },
      ]);
    }

    const rev4090 = getAct('4090');
    if (rev4090 < 0) {
      const mag = -rev4090;
      postEntry(period, 'Warranty claim allowance credit', [
        { accountCode: '4090', debitCents: mag, creditCents: 0 },
        { accountCode: '1000', debitCents: 0, creditCents: mag },
      ]);
    }

    const rev4200 = getAct('4200');
    if (rev4200 > 0) {
      postEntry(period, 'Expedited freight recovery', [
        { accountCode: '1000', debitCents: rev4200, creditCents: 0 },
        { accountCode: '4200', debitCents: 0, creditCents: rev4200 },
      ]);
    }

    const cogs5000 = getAct('5000');
    if (cogs5000 > 0) {
      postEntry(period, 'WIP Steel & Alloy consumption', [
        { accountCode: '5000', debitCents: cogs5000, creditCents: 0 },
        { accountCode: '001400', debitCents: 0, creditCents: cogs5000 },
      ]);
    }

    const cogs5100 = getAct('5100');
    const payroll6000 = getAct('6000');
    const payrollSum = cogs5100 + payroll6000;
    if (payrollSum > 0) {
      const cashPay = Math.round(payrollSum * 0.8);
      const accruedPay = payrollSum - cashPay;
      postEntry(period, 'Factory & plant engineering payroll', [
        { accountCode: '5100', debitCents: cogs5100, creditCents: 0 },
        { accountCode: '6000', debitCents: payroll6000, creditCents: 0 },
        { accountCode: '1000', debitCents: 0, creditCents: cashPay },
        { accountCode: '2100', debitCents: 0, creditCents: accruedPay },
      ]);
    }

    const opexCash = getAct('6100');
    if (opexCash > 0) {
      postEntry(period, 'Factory utilities cash payment', [
        { accountCode: '6100', debitCents: opexCash, creditCents: 0 },
        { accountCode: '1000', debitCents: 0, creditCents: opexCash },
      ]);
    }

    const opexAp = getAct('6300') + getAct('6400');
    if (opexAp > 0) {
      postEntry(period, 'Trade show & process R&D invoices', [
        { accountCode: '6300', debitCents: getAct('6300'), creditCents: 0 },
        { accountCode: '6400', debitCents: getAct('6400'), creditCents: 0 },
        { accountCode: '2000', debitCents: 0, creditCents: opexAp },
      ]);
    }

    const depr7000 = getAct('7000');
    if (depr7000 > 0) {
      postEntry(period, 'Monthly CNC machinery depreciation', [
        { accountCode: '7000', debitCents: depr7000, creditCents: 0 },
        { accountCode: '1590', debitCents: 0, creditCents: depr7000 },
      ]);
    }

    const tax8000 = getAct('8000');
    if (tax8000 > 0) {
      postEntry(period, 'Corporate income tax installment', [
        { accountCode: '8000', debitCents: tax8000, creditCents: 0 },
        { accountCode: '1000', debitCents: 0, creditCents: tax8000 },
      ]);
    }

    // Working capital cycle
    postEntry(period, 'OEM receivable collections', [
      { accountCode: '1000', debitCents: 6300000, creditCents: 0 },
      { accountCode: '1100', debitCents: 0, creditCents: 6300000 },
    ]);
    postEntry(period, 'WIP & alloy replenishment on account', [
      { accountCode: '001400', debitCents: 7500000, creditCents: 0 },
      { accountCode: '2000', debitCents: 0, creditCents: 7500000 },
    ]);
    postEntry(period, 'Vendor AP disbursement', [
      { accountCode: '2000', debitCents: 8800000, creditCents: 0 },
      { accountCode: '1000', debitCents: 0, creditCents: 8800000 },
    ]);
    postEntry(period, 'Payroll accrual settlement', [
      { accountCode: '2100', debitCents: 1100000, creditCents: 0 },
      { accountCode: '1000', debitCents: 0, creditCents: 1100000 },
    ]);

    if (pIdx === 2) {
      postEntry(period, '5-axis CNC mill capital acquisition', [
        { accountCode: '1500', debitCents: 12000000, creditCents: 0 },
        { accountCode: '1000', debitCents: 0, creditCents: 12000000 },
      ]);
      postEntry(period, 'Equipment loan draw for CNC expansion', [
        { accountCode: '1000', debitCents: 10000000, creditCents: 0 },
        { accountCode: '2500', debitCents: 0, creditCents: 10000000 },
      ]);
    }
    if (pIdx === 10) {
      postEntry(period, 'Annual owner distribution', [
        { accountCode: '3200', debitCents: 3500000, creditCents: 0 },
        { accountCode: '1000', debitCents: 0, creditCents: 3500000 },
      ]);
    }
  }

  const tenantBBundle = buildArticulatingStatements({
    accounts: coa,
    openingBalancesByKey: openingByKeyDecimal,
    periodGlLines: glLineFacts,
  });

  if (!tenantBBundle.articulation.valid) {
    const failed = tenantBBundle.articulation.checks
      .filter((c) => !c.passed)
      .map((c) => `${c.id}: ${c.detail}`);
    throw new Error(`M2_CORPUS_ARTICULATION_FAILED: ${failed.join(' | ')}`);
  }

  const diffCheck = sum(actuals.map((a) => sub(money(a.actualAmount), money(a.budgetAmount))));
  const devSum = sum(deviations.map((d) => money(d.amount)));
  if (!diffCheck.eq(devSum)) {
    throw new Error(`M2_CORPUS_COHERENCE_MISMATCH: ${diffCheck.toFixed()} != ${devSum.toFixed()}`);
  }

  // Rolling Forecast & Scenario Corpora over 12 periods
  const periods = calendar.map((p) => p.code);
  const cutoffPeriod = 'P06';

  const makePeriodMap = (val: string): Record<string, string> => {
    const rec: Record<string, string> = {};
    for (const p of periods) rec[p] = val;
    return rec;
  };

  const baseDrivers: DriverDefinition[] = [
    {
      kind: 'growth_rate',
      driverKey: 'drv_rev_base',
      accountCode: '4000',
      assumptionLabel: 'Core OEM revenue +2% monthly compounding',
      baseAmount: '180000.00',
      ratePerPeriod: '0.02',
    },
    {
      kind: 'percent_of_account',
      driverKey: 'drv_cogs_base',
      accountCode: '5000',
      assumptionLabel: 'Material COGS 40% of 4000 revenue',
      sourceAccountCode: '4000',
      ratio: '0.40',
    },
    {
      kind: 'fixed',
      driverKey: 'drv_payroll_base',
      accountCode: '6000',
      assumptionLabel: 'Plant engineering base payroll',
      amount: '31000.00',
    },
    {
      kind: 'fixed',
      driverKey: 'drv_rebate_base_zero',
      accountCode: '4200',
      assumptionLabel: 'Unplanned freight recovery in base (0.00)',
      amount: '0.00',
    },
    {
      kind: 'fixed',
      driverKey: 'drv_dormant_base_zero',
      accountCode: '4900',
      assumptionLabel: 'Dormant royalty account (0 vs 0 edge)',
      amount: '0.00',
    },
  ];

  const upsideDrivers: DriverDefinition[] = [
    {
      kind: 'growth_rate',
      driverKey: 'drv_rev_upside',
      accountCode: '4000',
      assumptionLabel: 'Upside OEM revenue +3.5% compounding w/ P11 contract win',
      baseAmount: '185000.00',
      ratePerPeriod: '0.035',
      periodOverrides: { P11: '275000.00' },
    },
    {
      kind: 'percent_of_account',
      driverKey: 'drv_cogs_upside',
      accountCode: '5000',
      assumptionLabel: 'Volume discount COGS 38% of 4000 revenue',
      sourceAccountCode: '4000',
      ratio: '0.38',
    },
    {
      kind: 'price_times_volume',
      driverKey: 'drv_field_service_upside',
      accountCode: '6300',
      assumptionLabel: 'Trade show leads ($250 x 30 slots)',
      unitPriceByPeriod: makePeriodMap('250.00'),
      volumeByPeriod: makePeriodMap('30'),
    },
    {
      kind: 'fixed',
      driverKey: 'drv_payroll_upside',
      accountCode: '6000',
      assumptionLabel: 'Plant engineering w/ hiring surge',
      amount: '34500.00',
    },
    {
      kind: 'fixed',
      driverKey: 'drv_freight_upside_nm',
      accountCode: '4200',
      assumptionLabel: 'Freight recovery program (+3,000/mo vs 0 base -> n/m)',
      amount: '3000.00',
    },
    {
      kind: 'fixed',
      driverKey: 'drv_dormant_upside_zero',
      accountCode: '4900',
      assumptionLabel: 'Dormant royalty account (0 vs 0)',
      amount: '0.00',
    },
  ];

  const downsideDrivers: DriverDefinition[] = [
    {
      kind: 'growth_rate',
      driverKey: 'drv_rev_downside',
      accountCode: '4000',
      assumptionLabel: 'Downside OEM contraction -1.5% monthly',
      baseAmount: '175000.00',
      ratePerPeriod: '-0.015',
    },
    {
      kind: 'percent_of_account',
      driverKey: 'drv_cogs_downside',
      accountCode: '5000',
      assumptionLabel: 'Fixed overhead deleverage 44% COGS',
      sourceAccountCode: '4000',
      ratio: '0.44',
    },
    {
      kind: 'fixed',
      driverKey: 'drv_payroll_downside',
      accountCode: '6000',
      assumptionLabel: 'Hiring freeze payroll run-rate',
      amount: '29500.00',
    },
    {
      kind: 'fixed',
      driverKey: 'drv_rd_downside_only',
      accountCode: '6400',
      assumptionLabel: 'Targeted process efficiency project (target-only account)',
      amount: '5500.00',
    },
  ];

  const basePlan = computeDriverPlan({ periods, drivers: baseDrivers, currencyScale: scale });
  const upsidePlan = computeDriverPlan({ periods, drivers: upsideDrivers, currencyScale: scale });
  const downsidePlan = computeDriverPlan({ periods, drivers: downsideDrivers, currencyScale: scale });
  if (!basePlan.ok || !upsidePlan.ok || !downsidePlan.ok) {
    throw new Error('M2_CORPUS_SCENARIO_EVAL_FAILED');
  }

  // Rolling forecast feeds actuals for 4000, 5000, 6000 in P01..P06 (leaving 6300 & 4200 missing in actual periods)
  const rollingActualCodes = new Set(['4000', '5000', '6000']);
  const rollingActualFacts = actuals
    .filter((a) => rollingActualCodes.has(a.accountCode) && a.periodCode <= cutoffPeriod)
    .map((a) => ({
      accountCode: a.accountCode,
      periodCode: a.periodCode,
      amount: a.actualAmount,
    }));

  const rollingReport = buildRollingForecast({
    periods,
    cutoffPeriod,
    actuals: rollingActualFacts,
    forecast: upsidePlan.lines.map((l) => ({
      accountCode: l.accountCode,
      periodCode: l.periodCode,
      amount: l.amount,
    })),
    currencyScale: scale,
  });
  if (!rollingReport.ok) {
    throw new Error(`M2_CORPUS_ROLLING_FAILED: ${rollingReport.issues.join(', ')}`);
  }

  const baseVsUpside = compareScenarios({
    baseScenarioName: 'Base Budget',
    targetScenarioName: 'Upside Forecast',
    baseLines: basePlan.lines,
    targetLines: upsidePlan.lines,
    currencyScale: scale,
  });
  const baseVsDownside = compareScenarios({
    baseScenarioName: 'Base Budget',
    targetScenarioName: 'Downside Case',
    baseLines: basePlan.lines,
    targetLines: downsidePlan.lines,
    currencyScale: scale,
  });

  // Workforce Module Corpus (employees, onboarding ramp, merit increase, mid-year attrition, inactive requisition)
  const workforcePositions: WorkforcePositionInput[] = [
    {
      positionCode: 'WF-ENG-01',
      title: 'Principal Controls Engineer',
      departmentName: 'Engineering',
      accountCode: '6000',
      startPeriodCode: 'P01',
      endPeriodCode: null,
      fte: '1.00',
      annualSalary: '144000.00',
      burdenRate: '0.18',
      bonusRate: '0.10',
      rampFirstPeriodPct: '1.00',
      meritPeriodCode: null,
      meritIncreasePct: '0.00',
      status: 'active',
    },
    {
      positionCode: 'WF-MFG-02',
      title: 'Senior CNC Lead',
      departmentName: 'Production',
      accountCode: '5100',
      startPeriodCode: 'P01',
      endPeriodCode: null,
      fte: '1.00',
      annualSalary: '96000.00',
      burdenRate: '0.20',
      bonusRate: '0.05',
      rampFirstPeriodPct: '1.00',
      meritPeriodCode: null,
      meritIncreasePct: '0.00',
      status: 'active',
    },
    {
      positionCode: 'WF-CSM-03',
      title: 'OEM Customer Success Specialist',
      departmentName: 'Commercial',
      accountCode: '6000',
      startPeriodCode: 'P04',
      endPeriodCode: null,
      fte: '1.00',
      annualSalary: '84000.00',
      burdenRate: '0.15',
      bonusRate: '0.08',
      rampFirstPeriodPct: '0.50', // Onboarding ramp in P04
      meritPeriodCode: null,
      meritIncreasePct: '0.00',
      status: 'active',
    },
    {
      positionCode: 'WF-OPS-04',
      title: 'Supply Chain Planner',
      departmentName: 'Operations',
      accountCode: '5100',
      startPeriodCode: 'P01',
      endPeriodCode: null,
      fte: '1.00',
      annualSalary: '108000.00',
      burdenRate: '0.16',
      bonusRate: '0.05',
      rampFirstPeriodPct: '1.00',
      meritPeriodCode: 'P07', // Mid-year merit increase
      meritIncreasePct: '0.06',
      status: 'active',
    },
    {
      positionCode: 'WF-FIN-05',
      title: 'Plant Cost Accountant (Attrition P05)',
      departmentName: 'Finance',
      accountCode: '6000',
      startPeriodCode: 'P01',
      endPeriodCode: 'P05', // Mid-year attrition after P05
      fte: '1.00',
      annualSalary: '90000.00',
      burdenRate: '0.18',
      bonusRate: '0.00',
      rampFirstPeriodPct: '1.00',
      meritPeriodCode: null,
      meritIncreasePct: '0.00',
      status: 'active',
    },
    {
      positionCode: 'WF-TMP-06',
      title: 'Unapproved Q4 Contractor Req',
      departmentName: 'Engineering',
      accountCode: '6000',
      startPeriodCode: 'P10',
      endPeriodCode: null,
      fte: '1.00',
      annualSalary: '120000.00',
      burdenRate: '0.10',
      bonusRate: '0.00',
      rampFirstPeriodPct: '1.00',
      meritPeriodCode: null,
      meritIncreasePct: '0.00',
      status: 'inactive',
    },
  ];

  const wfOutcome = compileWorkforceModuleToDrivers({
    periods,
    positions: workforcePositions,
    currencyScale: scale,
    periodsInYear: 12,
  });
  if (!wfOutcome.ok) {
    throw new Error(`M2_CORPUS_WORKFORCE_FAILED: ${wfOutcome.issues.join(', ')}`);
  }

  const wfRampSummary = wfOutcome.positionPeriodRows.find(
    (r) => r.positionCode === 'WF-CSM-03' && r.periodCode === 'P04',
  )!;
  const wfAttrP06 = wfOutcome.positionPeriodRows.find(
    (r) => r.positionCode === 'WF-FIN-05' && r.periodCode === 'P06',
  )!;

  const inactiveCount = workforcePositions.filter((p) => p.status === 'inactive').length;
  const activeCount = workforcePositions.length - inactiveCount;

  const answerKey: M2AnswerKeyItem[] = [
    ...deviations.map((d) => ({
      id: `M2-${d.id}`,
      domain: 'tenant_b_variance' as const,
      grain: {
        company_id: companyId,
        account_code: d.grain.account_code,
        period: d.grain.period,
        entity: entityCode,
      },
      amount: d.amount,
      statement_line_key: d.statement_line_key,
      expected_finding_key: d.expected_finding_key,
      expected_severity: d.expected_severity,
      cause: d.cause,
    })),
    {
      id: 'M2-RF-001',
      domain: 'rolling_forecast',
      grain: {
        company_id: companyId,
        account_code: '4000',
        period: 'P06',
        entity: entityCode,
        scenario: 'Upside Forecast',
      },
      amount: rollingReport.totalFullHorizon,
      statement_line_key: 'pl.revenue.product',
      expected_finding_key: 'planning:rolling_forecast:cutoff:P06',
      expected_severity: 'info',
      cause: 'P01..P06 immutable actuals stitched with P07..P12 driver forecast including P11 contract override and null disclosures for missing actual accounts',
    },
    {
      id: 'M2-SCN-001',
      domain: 'scenario_delta',
      grain: {
        company_id: companyId,
        account_code: '4200',
        period: 'P12',
        entity: entityCode,
        scenario: 'Upside Forecast',
      },
      amount: '36000.00',
      statement_line_key: 'pl.revenue.other',
      expected_finding_key: 'planning:scenario_delta:nm:4200',
      expected_severity: 'info',
      cause: 'Base Budget plans 0.00 on 4200 while Upside Forecast models 36,000.00 full-year -> deltaPctStatus nm (n/m)',
    },
    {
      id: 'M2-SCN-002',
      domain: 'scenario_delta',
      grain: {
        company_id: companyId,
        account_code: '6400',
        period: 'P12',
        entity: entityCode,
        scenario: 'Downside Case',
      },
      amount: '66000.00',
      statement_line_key: 'pl.opex.rd',
      expected_finding_key: 'planning:scenario_delta:target_only:6400',
      expected_severity: 'warn',
      cause: 'Target-only account 6400 absent from Base Budget preserves baseAmount = null (Null Law)',
    },
    {
      id: 'M2-WF-RAMP-001',
      domain: 'workforce_ramp',
      grain: {
        company_id: companyId,
        account_code: '6000',
        period: 'P04',
        entity: entityCode,
        position_code: 'WF-CSM-03',
      },
      amount: wfRampSummary.totalCost,
      statement_line_key: 'pl.opex.payroll',
      expected_finding_key: 'workforce:ramp:WF-CSM-03:P04',
      expected_severity: 'info',
      cause: '50% first-period onboarding ramp applied to WF-CSM-03 in P04',
    },
    {
      id: 'M2-WF-ATTR-001',
      domain: 'workforce_attrition',
      grain: {
        company_id: companyId,
        account_code: '6000',
        period: 'P06',
        entity: entityCode,
        position_code: 'WF-FIN-05',
      },
      amount: wfAttrP06.totalCost,
      statement_line_key: 'pl.opex.payroll',
      expected_finding_key: 'workforce:attrition:WF-FIN-05:P05',
      expected_severity: 'info',
      cause: 'WF-FIN-05 terminates after P05 leaving 0.00 cost and 0.00 FTE from P06..P12',
    },
    {
      id: 'M2-WF-INACT-001',
      domain: 'workforce_inactive_excluded',
      grain: {
        company_id: companyId,
        account_code: '6000',
        period: 'P10',
        entity: entityCode,
        position_code: 'WF-TMP-06',
      },
      amount: '0.00',
      statement_line_key: 'pl.opex.payroll',
      expected_finding_key: 'workforce:inactive_excluded:WF-TMP-06',
      expected_severity: 'info',
      cause: 'Inactive requisition WF-TMP-06 excluded cleanly from compiled fixed payroll drivers',
    },
    {
      id: 'M2-ISO-001',
      domain: 'tenant_isolation',
      grain: {
        company_id: companyId,
        account_code: '001400',
        period: 'P12',
        entity: entityCode,
      },
      amount: serialize(tenantBBundle.balanceSheet.totalAssets, scale),
      statement_line_key: 'bs.asset.inventory',
      expected_finding_key: 'tenancy:isolation:tenant_b:001400',
      expected_severity: 'critical',
      cause: 'Tenant B leading-zero account 001400 and all M2 planning/workforce/connector rows stay strictly isolated from Tenant A (TST5)',
    },
  ];

  return {
    meta: {
      generatorVersion: M2_CORPUS_GENERATOR_VERSION,
      seed,
      config,
      demoLabel: companyName,
    },
    tenantB: {
      company: {
        id: companyId,
        name: companyName,
        calendarKind: '454',
        entityCode,
        entityName,
        currency: config.currency,
        scale: config.scale,
      },
      calendar,
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
        ebitdaFullYear: serialize(tenantBBundle.pnl.ebitda, scale),
        netIncomeFullYear: serialize(tenantBBundle.pnl.netIncome, scale),
        totalAssetsClosing: serialize(tenantBBundle.balanceSheet.totalAssets, scale),
        endingCashClosing: serialize(tenantBBundle.cashFlow.endingCash, scale),
        articulationValid: tenantBBundle.articulation.valid,
      },
    },
    rollingForecastCorpus: {
      cutoffPeriod,
      scenarioName: 'Upside Forecast',
      periods,
      forecastDrivers: upsideDrivers,
      actualFacts: rollingActualFacts,
      summaryCheck: {
        totalActual: rollingReport.totalActual,
        totalForecast: rollingReport.totalForecast,
        totalFullHorizon: rollingReport.totalFullHorizon,
        totalMissingCells: rollingReport.totalMissingCells,
      },
    },
    scenarioCorpus: {
      periods,
      scenarios: {
        base: { name: 'Base Budget', drivers: baseDrivers, grandTotal: basePlan.grandTotal },
        upside: { name: 'Upside Forecast', drivers: upsideDrivers, grandTotal: upsidePlan.grandTotal },
        downside: { name: 'Downside Case', drivers: downsideDrivers, grandTotal: downsidePlan.grandTotal },
      },
      comparisonCheck: {
        baseVsUpsideTotalDelta: baseVsUpside.totalDelta,
        baseVsDownsideTotalDelta: baseVsDownside.totalDelta,
      },
    },
    workforceCorpus: {
      periods,
      positions: workforcePositions,
      summaryCheck: {
        activePositionCount: activeCount,
        inactiveExcludedCount: inactiveCount,
        grandTotalFteMonths: wfOutcome.grandTotalFteMonths,
        grandTotalCost: wfOutcome.grandTotalCost,
      },
    },
    answerKey,
  };
}
