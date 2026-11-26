import { z } from 'zod';
import {
  ArticulationCheckSchema,
  StatementPeriodRangeSchema,
  TrialBalanceSourceSchema,
} from './reports.js';

/**
 * M2 Dashboards v1 & KPI Library wire contracts (MASTER_PROMPT §11.5: RPT1, RPT2, RPT4).
 *
 * All evaluated KPI figures cross the wire as canonical decimal strings (or null for `nm` /
 * `not_planned`), accompanied by formatted display values issued verbatim by /core/metrics.
 */

export const MetricCategorySchema = z.enum(['profitability', 'cash', 'balance_sheet', 'plan']);
export type MetricCategoryDto = z.infer<typeof MetricCategorySchema>;

export const MetricUnitSchema = z.enum(['currency', 'percent', 'ratio']);
export const MetricFormatSchema = z.enum(['currency', 'percent', 'multiple']);
export const MetricBasisSchema = z.enum(['ytd', 'point_in_time']);
export const MetricStatusSchema = z.enum(['computed', 'nm', 'not_planned']);

export const EvaluatedKpiSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  category: MetricCategorySchema,
  formula: z.string().min(1),
  sourceKeys: z.array(z.string().min(1)),
  boardPackKey: z.string().min(1).nullable(),
  unit: MetricUnitSchema,
  format: MetricFormatSchema,
  basis: MetricBasisSchema,
  phase: z.literal('M2'),
  value: z.string().nullable(),
  formattedValue: z.string().min(1),
  status: MetricStatusSchema,
});
export type EvaluatedKpiDto = z.infer<typeof EvaluatedKpiSchema>;

export const DashboardTrendPointSchema = z.object({
  periodCode: z.string().min(1),
  periodNo: z.number().int().min(1),
  fiscalYear: z.number().int(),
  revenue: z.string(),
  ebitda: z.string(),
  netIncome: z.string(),
  operatingCashFlow: z.string(),
  endingCash: z.string(),
  revenueBarPct: z.number().int().min(0).max(100),
  ebitdaBarPct: z.number().int().min(0).max(100),
  cashBarPct: z.number().int().min(0).max(100),
  ebitdaPositive: z.boolean(),
  cashPositive: z.boolean(),
});
export type DashboardTrendPointDto = z.infer<typeof DashboardTrendPointSchema>;

export const DashboardReportTemplateIdSchema = z.enum([
  'executive_summary',
  'cash_and_runway',
  'plan_performance',
]);
export type DashboardReportTemplateId = z.infer<typeof DashboardReportTemplateIdSchema>;

export const DashboardReportBlockSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['metric', 'statement_line']),
  title: z.string().min(1),
  citationKey: z.string().min(1),
  unit: MetricUnitSchema,
  value: z.string().nullable(),
  formattedValue: z.string().min(1),
  status: MetricStatusSchema,
  cited: z.boolean(),
});
export type DashboardReportBlockDto = z.infer<typeof DashboardReportBlockSchema>;

export const DashboardReportBuilderSchema = z.object({
  templateId: DashboardReportTemplateIdSchema,
  templateLabel: z.string().min(1),
  blockCount: z.number().int().nonnegative(),
  citedBlockCount: z.number().int().nonnegative(),
  unlinkedBlockCount: z.number().int().nonnegative(),
  citationCoveragePct: z.string().min(1),
  blocks: z.array(DashboardReportBlockSchema),
});
export type DashboardReportBuilderDto = z.infer<typeof DashboardReportBuilderSchema>;

export const DashboardSummaryResponseSchema = z.object({
  companyId: z.string().uuid(),
  companyName: z.string().min(1),
  baseCurrency: z.string().length(3),
  currencyScale: z.union([z.literal(0), z.literal(2), z.literal(3)]),
  range: StatementPeriodRangeSchema,
  hasActuals: z.boolean(),
  hasPlan: z.boolean(),
  scenarioName: z.string().nullable(),
  versionNo: z.number().int().nullable(),
  articulation: z.object({
    valid: z.boolean(),
    checks: z.array(ArticulationCheckSchema),
  }),
  kpis: z.array(EvaluatedKpiSchema),
  trend: z.array(DashboardTrendPointSchema),
  reportBuilder: DashboardReportBuilderSchema,
  sources: z.array(TrialBalanceSourceSchema),
});
export type DashboardSummaryResponse = z.infer<typeof DashboardSummaryResponseSchema>;
