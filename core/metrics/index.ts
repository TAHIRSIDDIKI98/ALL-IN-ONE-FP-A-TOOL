/**
 * M2 Semantic / Metric Layer & Reporting Engine (/core/metrics, MASTER_PROMPT §11.5).
 *
 * - METRIC_DEFINITIONS is the single source of truth (RPT1, K3): every metric is defined once
 *   by canonical key, formula, unit, format, basis, and phase, and referenced by key across
 *   Dashboards, Board Pack, and Report Builder.
 * - Pure Decimal evaluation via /core/money only (no JS floats, no Math.abs).
 * - Absent plans return `not_planned` ("not planned") and zero/non-positive denominators return
 *   `nm` ("n/m"), never fabricated zeros (§5.2 Null Law).
 * - Report Builder enforces 100.00% canonical citation coverage across `metric` and `statement_line`
 *   blocks (RPT4).
 */

import Decimal from 'decimal.js';
import { add, compare, div, money, mul, negate, serialize } from '../money/index.js';
import { STATEMENT_LINE_MAP } from '../statements/index.js';

export type CurrencyScale = 0 | 2 | 3;
export type MetricCategory = 'profitability' | 'cash' | 'balance_sheet' | 'plan';
export type MetricUnit = 'currency' | 'percent' | 'ratio';
export type MetricFormat = 'currency' | 'percent' | 'multiple';
export type MetricBasis = 'ytd' | 'point_in_time';
export type MetricStatus = 'computed' | 'nm' | 'not_planned';

export type MetricKey =
  | 'pnl.revenue'
  | 'pnl.gross_profit'
  | 'pnl.gross_margin'
  | 'pnl.ebitda'
  | 'pnl.ebitda_margin'
  | 'pnl.net_income'
  | 'pnl.net_margin'
  | 'pnl.opex_ratio'
  | 'cf.operating_cash_flow'
  | 'cf.free_cash_flow'
  | 'cf.cash_conversion'
  | 'cf.ending_cash'
  | 'bs.total_assets'
  | 'bs.total_liabilities'
  | 'bs.total_equity'
  | 'bs.liabilities_to_equity'
  | 'plan.revenue_attainment'
  | 'plan.ebitda_attainment';

export interface MetricDefinition {
  readonly key: MetricKey;
  readonly label: string;
  readonly category: MetricCategory;
  readonly formula: string;
  readonly sourceKeys: readonly string[];
  readonly boardPackKey: string | null;
  readonly unit: MetricUnit;
  readonly format: MetricFormat;
  readonly basis: MetricBasis;
  readonly phase: 'M2';
}

export const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  {
    key: 'pnl.revenue',
    label: 'Revenue (YTD)',
    category: 'profitability',
    formula: 'SUM(pl.revenue.*)',
    sourceKeys: ['pl.revenue.product', 'pl.revenue.service', 'pl.revenue.other'],
    boardPackKey: 'statement:pnl.revenue',
    unit: 'currency',
    format: 'currency',
    basis: 'ytd',
    phase: 'M2',
  },
  {
    key: 'pnl.gross_profit',
    label: 'Gross Profit',
    category: 'profitability',
    formula: 'pnl.revenue - SUM(pl.cogs.*)',
    sourceKeys: ['pl.revenue.product', 'pl.cogs.direct', 'pl.cogs.other'],
    boardPackKey: null,
    unit: 'currency',
    format: 'currency',
    basis: 'ytd',
    phase: 'M2',
  },
  {
    key: 'pnl.gross_margin',
    label: 'Gross Margin %',
    category: 'profitability',
    formula: '(pnl.gross_profit / pnl.revenue) * 100',
    sourceKeys: ['pl.revenue.product', 'pl.cogs.direct'],
    boardPackKey: null,
    unit: 'percent',
    format: 'percent',
    basis: 'ytd',
    phase: 'M2',
  },
  {
    key: 'pnl.ebitda',
    label: 'EBITDA',
    category: 'profitability',
    formula: 'pnl.gross_profit - SUM(pl.opex.*)',
    sourceKeys: ['pl.revenue.product', 'pl.cogs.direct', 'pl.opex.payroll', 'pl.opex.ga'],
    boardPackKey: null,
    unit: 'currency',
    format: 'currency',
    basis: 'ytd',
    phase: 'M2',
  },
  {
    key: 'pnl.ebitda_margin',
    label: 'EBITDA Margin %',
    category: 'profitability',
    formula: '(pnl.ebitda / pnl.revenue) * 100',
    sourceKeys: ['pl.revenue.product', 'pl.opex.payroll', 'pl.opex.ga'],
    boardPackKey: null,
    unit: 'percent',
    format: 'percent',
    basis: 'ytd',
    phase: 'M2',
  },
  {
    key: 'pnl.net_income',
    label: 'Net Income (YTD)',
    category: 'profitability',
    formula: 'pnl.ebit + pl.nonop.* - pl.tax.income_tax',
    sourceKeys: ['pl.revenue.product', 'pl.tax.income_tax'],
    boardPackKey: 'statement:pnl.netIncome',
    unit: 'currency',
    format: 'currency',
    basis: 'ytd',
    phase: 'M2',
  },
  {
    key: 'pnl.net_margin',
    label: 'Net Margin %',
    category: 'profitability',
    formula: '(pnl.net_income / pnl.revenue) * 100',
    sourceKeys: ['pl.revenue.product', 'pl.tax.income_tax'],
    boardPackKey: null,
    unit: 'percent',
    format: 'percent',
    basis: 'ytd',
    phase: 'M2',
  },
  {
    key: 'pnl.opex_ratio',
    label: 'OpEx Ratio %',
    category: 'profitability',
    formula: '(SUM(pl.opex.*) / pnl.revenue) * 100',
    sourceKeys: ['pl.opex.payroll', 'pl.opex.ga', 'pl.opex.sm', 'pl.opex.rd'],
    boardPackKey: null,
    unit: 'percent',
    format: 'percent',
    basis: 'ytd',
    phase: 'M2',
  },
  {
    key: 'cf.operating_cash_flow',
    label: 'Operating Cash Flow',
    category: 'cash',
    formula: 'cf.operating.net_income + cf.operating.da_addback + cf.operating.delta_wc',
    sourceKeys: ['cf.operating.net_income', 'cf.operating.da_addback', 'cf.operating.delta_wc'],
    boardPackKey: null,
    unit: 'currency',
    format: 'currency',
    basis: 'ytd',
    phase: 'M2',
  },
  {
    key: 'cf.free_cash_flow',
    label: 'Free Cash Flow',
    category: 'cash',
    formula: 'cf.operating_cash_flow + cf.investing.capex',
    sourceKeys: ['cf.operating.net_income', 'cf.investing.capex'],
    boardPackKey: null,
    unit: 'currency',
    format: 'currency',
    basis: 'ytd',
    phase: 'M2',
  },
  {
    key: 'cf.cash_conversion',
    label: 'Cash Conversion %',
    category: 'cash',
    formula: '(cf.operating_cash_flow / pnl.ebitda) * 100',
    sourceKeys: ['cf.operating.net_income', 'pl.opex.payroll'],
    boardPackKey: null,
    unit: 'percent',
    format: 'percent',
    basis: 'ytd',
    phase: 'M2',
  },
  {
    key: 'cf.ending_cash',
    label: 'Ending Cash',
    category: 'cash',
    formula: 'bs.asset.cash',
    sourceKeys: ['bs.asset.cash'],
    boardPackKey: 'statement:cf.endingCash',
    unit: 'currency',
    format: 'currency',
    basis: 'point_in_time',
    phase: 'M2',
  },
  {
    key: 'bs.total_assets',
    label: 'Total Assets',
    category: 'balance_sheet',
    formula: 'SUM(bs.asset.*)',
    sourceKeys: ['bs.asset.cash', 'bs.asset.ar', 'bs.asset.ppe_gross'],
    boardPackKey: 'statement:bs.totalAssets',
    unit: 'currency',
    format: 'currency',
    basis: 'point_in_time',
    phase: 'M2',
  },
  {
    key: 'bs.total_liabilities',
    label: 'Total Liabilities',
    category: 'balance_sheet',
    formula: 'SUM(bs.liability.*)',
    sourceKeys: ['bs.liability.ap', 'bs.liability.accrued', 'bs.liability.long_term_debt'],
    boardPackKey: null,
    unit: 'currency',
    format: 'currency',
    basis: 'point_in_time',
    phase: 'M2',
  },
  {
    key: 'bs.total_equity',
    label: 'Total Equity',
    category: 'balance_sheet',
    formula: 'SUM(bs.equity.*)',
    sourceKeys: ['bs.equity.common_stock', 'bs.equity.retained_earnings', 'bs.equity.current_net_income'],
    boardPackKey: null,
    unit: 'currency',
    format: 'currency',
    basis: 'point_in_time',
    phase: 'M2',
  },
  {
    key: 'bs.liabilities_to_equity',
    label: 'Liabilities / Equity',
    category: 'balance_sheet',
    formula: 'bs.total_liabilities / bs.total_equity',
    sourceKeys: ['bs.liability.ap', 'bs.equity.retained_earnings'],
    boardPackKey: null,
    unit: 'ratio',
    format: 'multiple',
    basis: 'point_in_time',
    phase: 'M2',
  },
  {
    key: 'plan.revenue_attainment',
    label: 'Revenue Plan Attainment %',
    category: 'plan',
    formula: '(pnl.revenue / plan.revenue) * 100',
    sourceKeys: ['pl.revenue.product', 'pl.revenue.service'],
    boardPackKey: null,
    unit: 'percent',
    format: 'percent',
    basis: 'ytd',
    phase: 'M2',
  },
  {
    key: 'plan.ebitda_attainment',
    label: 'EBITDA Plan Attainment %',
    category: 'plan',
    formula: '(pnl.ebitda / plan.ebitda) * 100',
    sourceKeys: ['pl.revenue.product', 'pl.cogs.direct', 'pl.opex.payroll'],
    boardPackKey: null,
    unit: 'percent',
    format: 'percent',
    basis: 'ytd',
    phase: 'M2',
  },
];

export const METRIC_CATALOG_BY_KEY: ReadonlyMap<MetricKey, MetricDefinition> = new Map(
  METRIC_DEFINITIONS.map((def) => [def.key, def]),
);

export interface EvaluatedKpi extends MetricDefinition {
  readonly value: string | null;
  readonly formattedValue: string;
  readonly status: MetricStatus;
}

export interface KpiEvaluationInput {
  readonly currencyScale: CurrencyScale;
  readonly hasPlan: boolean;
  readonly pnl: {
    readonly revenue: Decimal | string;
    readonly cogs: Decimal | string;
    readonly grossProfit: Decimal | string;
    readonly opex: Decimal | string;
    readonly ebitda: Decimal | string;
    readonly netIncome: Decimal | string;
  };
  readonly balanceSheet: {
    readonly totalAssets: Decimal | string;
    readonly totalLiabilities: Decimal | string;
    readonly totalEquity: Decimal | string;
    readonly cashBalance: Decimal | string;
  };
  readonly cashFlow: {
    readonly operatingCashFlow: Decimal | string;
    readonly freeCashFlow: Decimal | string;
    readonly endingCash: Decimal | string;
  };
  readonly plan?: {
    readonly revenue: Decimal | string | null;
    readonly ebitda: Decimal | string | null;
  };
}

export interface KpiLibraryResult {
  readonly currencyScale: CurrencyScale;
  readonly kpis: readonly EvaluatedKpi[];
  readonly byKey: Readonly<Record<string, EvaluatedKpi>>;
}

function asDecimal(val: Decimal | string): Decimal {
  return typeof val === 'string' ? money(val) : val;
}

function evalCurrencyKpi(
  def: MetricDefinition,
  val: Decimal,
  scale: CurrencyScale,
): EvaluatedKpi {
  const formatted = serialize(val, scale);
  return {
    ...def,
    value: formatted,
    formattedValue: formatted,
    status: 'computed',
  };
}

function evalPercentRatioKpi(
  def: MetricDefinition,
  numerator: Decimal,
  denominator: Decimal,
): EvaluatedKpi {
  if (denominator.lte(money('0'))) {
    return {
      ...def,
      value: null,
      formattedValue: 'n/m',
      status: 'nm',
    };
  }
  const quotient = div(numerator, denominator, 12, 'HALF_UP');
  if (quotient === null) {
    return { ...def, value: null, formattedValue: 'n/m', status: 'nm' };
  }
  const pct = mul(quotient, money('100'));
  const formattedNum = serialize(pct, 2);
  return {
    ...def,
    value: formattedNum,
    formattedValue: `${formattedNum}%`,
    status: 'computed',
  };
}

function evalMultipleKpi(
  def: MetricDefinition,
  numerator: Decimal,
  denominator: Decimal,
): EvaluatedKpi {
  if (denominator.lte(money('0'))) {
    return {
      ...def,
      value: null,
      formattedValue: 'n/m',
      status: 'nm',
    };
  }
  const ratio = div(numerator, denominator, 2, 'HALF_UP');
  if (ratio === null) {
    return { ...def, value: null, formattedValue: 'n/m', status: 'nm' };
  }
  const formattedNum = serialize(ratio, 2);
  return {
    ...def,
    value: formattedNum,
    formattedValue: `${formattedNum}x`,
    status: 'computed',
  };
}

function evalPlanAttainmentKpi(
  def: MetricDefinition,
  hasPlan: boolean,
  actual: Decimal,
  planned: Decimal | string | null | undefined,
): EvaluatedKpi {
  if (!hasPlan || planned === null || planned === undefined) {
    return {
      ...def,
      value: null,
      formattedValue: 'not planned',
      status: 'not_planned',
    };
  }
  const planDec = asDecimal(planned);
  if (planDec.lte(money('0'))) {
    return {
      ...def,
      value: null,
      formattedValue: 'n/m',
      status: 'nm',
    };
  }
  return evalPercentRatioKpi(def, actual, planDec);
}

export function evaluateKpiLibrary(input: KpiEvaluationInput): KpiLibraryResult {
  const scale = input.currencyScale;
  const revenue = asDecimal(input.pnl.revenue);
  const grossProfit = asDecimal(input.pnl.grossProfit);
  const opex = asDecimal(input.pnl.opex);
  const ebitda = asDecimal(input.pnl.ebitda);
  const netIncome = asDecimal(input.pnl.netIncome);

  const totalAssets = asDecimal(input.balanceSheet.totalAssets);
  const totalLiabilities = asDecimal(input.balanceSheet.totalLiabilities);
  const totalEquity = asDecimal(input.balanceSheet.totalEquity);

  const operatingCashFlow = asDecimal(input.cashFlow.operatingCashFlow);
  const freeCashFlow = asDecimal(input.cashFlow.freeCashFlow);
  const endingCash = asDecimal(input.cashFlow.endingCash);

  const computedByKey: Record<MetricKey, EvaluatedKpi> = {
    'pnl.revenue': evalCurrencyKpi(METRIC_CATALOG_BY_KEY.get('pnl.revenue')!, revenue, scale),
    'pnl.gross_profit': evalCurrencyKpi(METRIC_CATALOG_BY_KEY.get('pnl.gross_profit')!, grossProfit, scale),
    'pnl.gross_margin': evalPercentRatioKpi(METRIC_CATALOG_BY_KEY.get('pnl.gross_margin')!, grossProfit, revenue),
    'pnl.ebitda': evalCurrencyKpi(METRIC_CATALOG_BY_KEY.get('pnl.ebitda')!, ebitda, scale),
    'pnl.ebitda_margin': evalPercentRatioKpi(METRIC_CATALOG_BY_KEY.get('pnl.ebitda_margin')!, ebitda, revenue),
    'pnl.net_income': evalCurrencyKpi(METRIC_CATALOG_BY_KEY.get('pnl.net_income')!, netIncome, scale),
    'pnl.net_margin': evalPercentRatioKpi(METRIC_CATALOG_BY_KEY.get('pnl.net_margin')!, netIncome, revenue),
    'pnl.opex_ratio': evalPercentRatioKpi(METRIC_CATALOG_BY_KEY.get('pnl.opex_ratio')!, opex, revenue),
    'cf.operating_cash_flow': evalCurrencyKpi(
      METRIC_CATALOG_BY_KEY.get('cf.operating_cash_flow')!,
      operatingCashFlow,
      scale,
    ),
    'cf.free_cash_flow': evalCurrencyKpi(METRIC_CATALOG_BY_KEY.get('cf.free_cash_flow')!, freeCashFlow, scale),
    'cf.cash_conversion': evalPercentRatioKpi(
      METRIC_CATALOG_BY_KEY.get('cf.cash_conversion')!,
      operatingCashFlow,
      ebitda,
    ),
    'cf.ending_cash': evalCurrencyKpi(METRIC_CATALOG_BY_KEY.get('cf.ending_cash')!, endingCash, scale),
    'bs.total_assets': evalCurrencyKpi(METRIC_CATALOG_BY_KEY.get('bs.total_assets')!, totalAssets, scale),
    'bs.total_liabilities': evalCurrencyKpi(
      METRIC_CATALOG_BY_KEY.get('bs.total_liabilities')!,
      totalLiabilities,
      scale,
    ),
    'bs.total_equity': evalCurrencyKpi(METRIC_CATALOG_BY_KEY.get('bs.total_equity')!, totalEquity, scale),
    'bs.liabilities_to_equity': evalMultipleKpi(
      METRIC_CATALOG_BY_KEY.get('bs.liabilities_to_equity')!,
      totalLiabilities,
      totalEquity,
    ),
    'plan.revenue_attainment': evalPlanAttainmentKpi(
      METRIC_CATALOG_BY_KEY.get('plan.revenue_attainment')!,
      input.hasPlan,
      revenue,
      input.plan?.revenue,
    ),
    'plan.ebitda_attainment': evalPlanAttainmentKpi(
      METRIC_CATALOG_BY_KEY.get('plan.ebitda_attainment')!,
      input.hasPlan,
      ebitda,
      input.plan?.ebitda,
    ),
  };

  const kpis = METRIC_DEFINITIONS.map((def) => computedByKey[def.key]);
  return {
    currencyScale: scale,
    kpis,
    byKey: computedByKey,
  };
}

export interface PeriodTrendInput {
  readonly periodCode: string;
  readonly periodNo: number;
  readonly fiscalYear: number;
  readonly revenue: Decimal;
  readonly ebitda: Decimal;
  readonly netIncome: Decimal;
  readonly operatingCashFlow: Decimal;
  readonly endingCash: Decimal;
}

export interface DashboardTrendPoint {
  readonly periodCode: string;
  readonly periodNo: number;
  readonly fiscalYear: number;
  readonly revenue: string;
  readonly ebitda: string;
  readonly netIncome: string;
  readonly operatingCashFlow: string;
  readonly endingCash: string;
  readonly revenueBarPct: number;
  readonly ebitdaBarPct: number;
  readonly cashBarPct: number;
  readonly ebitdaPositive: boolean;
  readonly cashPositive: boolean;
}

function magnitudeOf(val: Decimal): Decimal {
  return val.isNegative() ? negate(val) : val;
}

function scaledBarPct(val: Decimal, maxMagnitude: Decimal): number {
  if (maxMagnitude.lte(money('0'))) return 0;
  const mag = magnitudeOf(val);
  if (mag.lte(money('0'))) return 0;
  const quotient = div(mag, maxMagnitude, 6, 'HALF_UP');
  if (quotient === null) return 0;
  const pct = mul(quotient, money('100')).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const clamped = compare(pct, money('100')) > 0 ? money('100') : pct;
  return Number.parseInt(clamped.toFixed(0), 10);
}

/**
 * Pure period trend series with server-computed Decimal chart percentages (`0..100`) so browser
 * charts never parse or scale monetary strings (§5.2 E11).
 */
export function buildKpiTrendSeries(
  periods: readonly PeriodTrendInput[],
  currencyScale: CurrencyScale,
): readonly DashboardTrendPoint[] {
  let maxMagnitude = money('0');
  for (const p of periods) {
    const revMag = magnitudeOf(p.revenue);
    const ebitdaMag = magnitudeOf(p.ebitda);
    const cashMag = magnitudeOf(p.endingCash);
    if (compare(revMag, maxMagnitude) > 0) maxMagnitude = revMag;
    if (compare(ebitdaMag, maxMagnitude) > 0) maxMagnitude = ebitdaMag;
    if (compare(cashMag, maxMagnitude) > 0) maxMagnitude = cashMag;
  }

  return periods.map((p) => ({
    periodCode: p.periodCode,
    periodNo: p.periodNo,
    fiscalYear: p.fiscalYear,
    revenue: serialize(p.revenue, currencyScale),
    ebitda: serialize(p.ebitda, currencyScale),
    netIncome: serialize(p.netIncome, currencyScale),
    operatingCashFlow: serialize(p.operatingCashFlow, currencyScale),
    endingCash: serialize(p.endingCash, currencyScale),
    revenueBarPct: scaledBarPct(p.revenue, maxMagnitude),
    ebitdaBarPct: scaledBarPct(p.ebitda, maxMagnitude),
    cashBarPct: scaledBarPct(p.endingCash, maxMagnitude),
    ebitdaPositive: !p.ebitda.isNegative(),
    cashPositive: !p.endingCash.isNegative(),
  }));
}

export type ReportTemplateId = 'executive_summary' | 'cash_and_runway' | 'plan_performance';

export interface ReportBlockSpec {
  readonly id: string;
  readonly kind: 'metric' | 'statement_line';
  readonly title: string;
  readonly citationKey: string;
}

export interface ReportTemplateDefinition {
  readonly id: ReportTemplateId;
  readonly label: string;
  readonly blocks: readonly ReportBlockSpec[];
}

export const REPORT_TEMPLATES: Readonly<Record<ReportTemplateId, ReportTemplateDefinition>> = {
  executive_summary: {
    id: 'executive_summary',
    label: 'Executive Summary Pack',
    blocks: [
      { id: 'exec-rev', kind: 'metric', title: 'YTD Revenue', citationKey: 'pnl.revenue' },
      { id: 'exec-gm', kind: 'metric', title: 'Gross Margin', citationKey: 'pnl.gross_margin' },
      { id: 'exec-ebitda', kind: 'metric', title: 'EBITDA', citationKey: 'pnl.ebitda' },
      { id: 'exec-ni', kind: 'metric', title: 'Net Income', citationKey: 'pnl.net_income' },
      { id: 'exec-prod-rev', kind: 'statement_line', title: 'Product Revenue Line', citationKey: 'pl.revenue.product' },
      { id: 'exec-cash', kind: 'statement_line', title: 'Cash & Equivalents Line', citationKey: 'bs.asset.cash' },
    ],
  },
  cash_and_runway: {
    id: 'cash_and_runway',
    label: 'Cash & Liquidity Brief',
    blocks: [
      { id: 'cash-ocf', kind: 'metric', title: 'Operating Cash Flow', citationKey: 'cf.operating_cash_flow' },
      { id: 'cash-fcf', kind: 'metric', title: 'Free Cash Flow', citationKey: 'cf.free_cash_flow' },
      { id: 'cash-conv', kind: 'metric', title: 'EBITDA Cash Conversion', citationKey: 'cf.cash_conversion' },
      { id: 'cash-end', kind: 'metric', title: 'Ending Cash Balance', citationKey: 'cf.ending_cash' },
      { id: 'cash-ar', kind: 'statement_line', title: 'Accounts Receivable', citationKey: 'bs.asset.ar' },
      { id: 'cash-ap', kind: 'statement_line', title: 'Accounts Payable', citationKey: 'bs.liability.ap' },
    ],
  },
  plan_performance: {
    id: 'plan_performance',
    label: 'Plan & Operating Leverage Review',
    blocks: [
      { id: 'plan-rev-att', kind: 'metric', title: 'Revenue Plan Attainment', citationKey: 'plan.revenue_attainment' },
      { id: 'plan-ebitda-att', kind: 'metric', title: 'EBITDA Plan Attainment', citationKey: 'plan.ebitda_attainment' },
      { id: 'plan-opex-ratio', kind: 'metric', title: 'OpEx Share of Revenue', citationKey: 'pnl.opex_ratio' },
      { id: 'plan-lev', kind: 'metric', title: 'Liabilities to Equity', citationKey: 'bs.liabilities_to_equity' },
      { id: 'plan-payroll', kind: 'statement_line', title: 'Payroll & Benefits Line', citationKey: 'pl.opex.payroll' },
      { id: 'plan-ga', kind: 'statement_line', title: 'General & Administrative Line', citationKey: 'pl.opex.ga' },
    ],
  },
};

export interface EvaluatedReportBlock {
  readonly id: string;
  readonly kind: 'metric' | 'statement_line';
  readonly title: string;
  readonly citationKey: string;
  readonly unit: MetricUnit;
  readonly value: string | null;
  readonly formattedValue: string;
  readonly status: MetricStatus;
  readonly cited: boolean;
}

export interface EvaluatedReportBuilder {
  readonly templateId: ReportTemplateId;
  readonly templateLabel: string;
  readonly blockCount: number;
  readonly citedBlockCount: number;
  readonly unlinkedBlockCount: number;
  readonly citationCoveragePct: string;
  readonly blocks: readonly EvaluatedReportBlock[];
}

export function buildReportBlocks(params: {
  readonly templateId: ReportTemplateId;
  readonly kpiLibrary: KpiLibraryResult;
  readonly statementLinesByKey: ReadonlyMap<string, Decimal>;
  readonly customBlocks?: readonly ReportBlockSpec[];
}): EvaluatedReportBuilder {
  const template = REPORT_TEMPLATES[params.templateId];
  const specs = params.customBlocks ?? template.blocks;
  const blocks: EvaluatedReportBlock[] = [];

  for (const spec of specs) {
    if (spec.kind === 'metric') {
      const kpi = params.kpiLibrary.byKey[spec.citationKey];
      if (kpi === undefined || !METRIC_CATALOG_BY_KEY.has(spec.citationKey as MetricKey)) {
        throw new Error(`UNKNOWN_REPORT_CITATION:metric:${spec.citationKey}`);
      }
      blocks.push({
        id: spec.id,
        kind: 'metric',
        title: spec.title,
        citationKey: spec.citationKey,
        unit: kpi.unit,
        value: kpi.value,
        formattedValue: kpi.formattedValue,
        status: kpi.status,
        cited: true,
      });
    } else {
      if (!STATEMENT_LINE_MAP.has(spec.citationKey)) {
        throw new Error(`UNKNOWN_REPORT_CITATION:statement_line:${spec.citationKey}`);
      }
      const lineValue = params.statementLinesByKey.get(spec.citationKey) ?? money('0');
      const serialized = serialize(lineValue, params.kpiLibrary.currencyScale);
      blocks.push({
        id: spec.id,
        kind: 'statement_line',
        title: spec.title,
        citationKey: spec.citationKey,
        unit: 'currency',
        value: serialized,
        formattedValue: serialized,
        status: 'computed',
        cited: true,
      });
    }
  }

  const blockCount = blocks.length;
  const citedBlockCount = blocks.filter((b) => b.cited).length;
  const unlinkedBlockCount = blockCount - citedBlockCount;
  const coverageDiv =
    blockCount === 0 ? null : div(money(String(citedBlockCount)), money(String(blockCount)), 6, 'HALF_UP');
  const coverageRatio = coverageDiv === null ? money('0') : mul(coverageDiv, money('100'));
  const citationCoveragePct = `${serialize(add(coverageRatio, money('0')), 2)}%`;

  return {
    templateId: params.templateId,
    templateLabel: template.label,
    blockCount,
    citedBlockCount,
    unlinkedBlockCount,
    citationCoveragePct,
    blocks,
  };
}
