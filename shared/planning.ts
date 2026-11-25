import { z } from 'zod';

const DecimalStringSchema = z.string().regex(/^[+-]?\d+(?:\.\d+)?$/, 'Expected canonical decimal string');
const NonEmptyTextSchema = z.string().trim().min(1);

export const ScenarioKindSchema = z.enum(['budget', 'forecast']);
export type ScenarioKind = z.infer<typeof ScenarioKindSchema>;

export const FixedDriverSchema = z.object({
  kind: z.literal('fixed'),
  driverKey: NonEmptyTextSchema,
  accountCode: NonEmptyTextSchema,
  assumptionLabel: NonEmptyTextSchema,
  amount: DecimalStringSchema,
  periodOverrides: z.record(NonEmptyTextSchema, DecimalStringSchema).optional(),
});

export const GrowthRateDriverSchema = z.object({
  kind: z.literal('growth_rate'),
  driverKey: NonEmptyTextSchema,
  accountCode: NonEmptyTextSchema,
  assumptionLabel: NonEmptyTextSchema,
  baseAmount: DecimalStringSchema,
  ratePerPeriod: DecimalStringSchema,
  periodOverrides: z.record(NonEmptyTextSchema, DecimalStringSchema).optional(),
});

export const PercentOfAccountDriverSchema = z.object({
  kind: z.literal('percent_of_account'),
  driverKey: NonEmptyTextSchema,
  accountCode: NonEmptyTextSchema,
  assumptionLabel: NonEmptyTextSchema,
  sourceAccountCode: NonEmptyTextSchema,
  ratio: DecimalStringSchema,
  periodOverrides: z.record(NonEmptyTextSchema, DecimalStringSchema).optional(),
});

export const PriceTimesVolumeDriverSchema = z.object({
  kind: z.literal('price_times_volume'),
  driverKey: NonEmptyTextSchema,
  accountCode: NonEmptyTextSchema,
  assumptionLabel: NonEmptyTextSchema,
  unitPriceByPeriod: z.record(NonEmptyTextSchema, DecimalStringSchema),
  volumeByPeriod: z.record(NonEmptyTextSchema, DecimalStringSchema),
  periodOverrides: z.record(NonEmptyTextSchema, DecimalStringSchema).optional(),
});

export const DriverDefinitionSchema = z.discriminatedUnion('kind', [
  FixedDriverSchema,
  GrowthRateDriverSchema,
  PercentOfAccountDriverSchema,
  PriceTimesVolumeDriverSchema,
]);
export type DriverDefinitionInput = z.infer<typeof DriverDefinitionSchema>;

export const DriverPlanPreviewRequestSchema = z.object({
  fiscalYear: z.number().int().min(2000).max(2100),
  periods: z.array(NonEmptyTextSchema).min(1),
  drivers: z.array(DriverDefinitionSchema).min(1),
});
export type DriverPlanPreviewRequest = z.infer<typeof DriverPlanPreviewRequestSchema>;

export const ComputedPlanLineSchema = z.object({
  accountCode: NonEmptyTextSchema,
  periodCode: NonEmptyTextSchema,
  amount: DecimalStringSchema,
  source: z.enum(['driver', 'override']),
  driverKey: NonEmptyTextSchema,
  assumptionLabel: NonEmptyTextSchema,
});

export const DriverPlanPreviewResponseSchema = z.object({
  fiscalYear: z.number().int(),
  currencyScale: z.union([z.literal(0), z.literal(2), z.literal(3)]),
  periods: z.array(NonEmptyTextSchema),
  lines: z.array(ComputedPlanLineSchema),
  totalsByAccount: z.record(NonEmptyTextSchema, DecimalStringSchema),
  totalsByPeriod: z.record(NonEmptyTextSchema, DecimalStringSchema),
  grandTotal: DecimalStringSchema,
});
export type DriverPlanPreviewResponse = z.infer<typeof DriverPlanPreviewResponseSchema>;

export const DriverPlanCommitRequestSchema = z.object({
  fiscalYear: z.number().int().min(2000).max(2100),
  scenarioName: NonEmptyTextSchema,
  scenarioKind: ScenarioKindSchema.default('forecast'),
  periods: z.array(NonEmptyTextSchema).min(1),
  drivers: z.array(DriverDefinitionSchema).min(1),
});
export type DriverPlanCommitRequest = z.infer<typeof DriverPlanCommitRequestSchema>;

export const DriverPlanCommitResponseSchema = z.object({
  scenarioId: z.string().uuid(),
  scenarioName: NonEmptyTextSchema,
  scenarioKind: ScenarioKindSchema,
  planVersionId: z.string().uuid(),
  versionNo: z.number().int().positive(),
  lineCount: z.number().int().nonnegative(),
  grandTotal: DecimalStringSchema,
  totalsByAccount: z.record(NonEmptyTextSchema, DecimalStringSchema),
});
export type DriverPlanCommitResponse = z.infer<typeof DriverPlanCommitResponseSchema>;

export const ScenarioSummarySchema = z.object({
  scenarioId: z.string().uuid(),
  name: NonEmptyTextSchema,
  kind: ScenarioKindSchema,
  currentVersionNo: z.number().int().positive().nullable(),
  currentVersionLabel: z.string().nullable(),
});
export type ScenarioSummary = z.infer<typeof ScenarioSummarySchema>;

export const ScenarioListResponseSchema = z.object({
  companyId: z.string().uuid(),
  scenarios: z.array(ScenarioSummarySchema),
});
export type ScenarioListResponse = z.infer<typeof ScenarioListResponseSchema>;

export const RollingForecastCellSchema = z.object({
  periodCode: NonEmptyTextSchema,
  basis: z.enum(['actual', 'forecast']),
  amount: DecimalStringSchema.nullable(),
});

export const RollingForecastAccountRowSchema = z.object({
  accountCode: NonEmptyTextSchema,
  cells: z.array(RollingForecastCellSchema),
  actualSubtotal: DecimalStringSchema,
  forecastSubtotal: DecimalStringSchema,
  fullHorizonTotal: DecimalStringSchema,
  missingCellCount: z.number().int().nonnegative(),
});

export const RollingForecastResponseSchema = z.object({
  companyId: z.string().uuid(),
  fiscalYear: z.number().int(),
  scenarioName: NonEmptyTextSchema,
  planVersionNo: z.number().int().positive().nullable(),
  cutoffPeriod: z.string(),
  periods: z.array(NonEmptyTextSchema),
  actualPeriods: z.array(NonEmptyTextSchema),
  forecastPeriods: z.array(NonEmptyTextSchema),
  rows: z.array(RollingForecastAccountRowSchema),
  totalActual: DecimalStringSchema,
  totalForecast: DecimalStringSchema,
  totalFullHorizon: DecimalStringSchema,
  totalMissingCells: z.number().int().nonnegative(),
});
export type RollingForecastResponse = z.infer<typeof RollingForecastResponseSchema>;

export const ScenarioComparisonRowSchema = z.object({
  accountCode: NonEmptyTextSchema,
  baseTotal: DecimalStringSchema.nullable(),
  targetTotal: DecimalStringSchema.nullable(),
  deltaAmount: DecimalStringSchema.nullable(),
  deltaPct: z.string().nullable(),
  deltaPctStatus: z.enum(['computed', 'zero', 'nm', 'null']),
});

export const ScenarioComparisonResponseSchema = z.object({
  companyId: z.string().uuid(),
  fiscalYear: z.number().int(),
  baseScenarioName: NonEmptyTextSchema,
  targetScenarioName: NonEmptyTextSchema,
  rows: z.array(ScenarioComparisonRowSchema),
  totalBase: DecimalStringSchema,
  totalTarget: DecimalStringSchema,
  totalDelta: DecimalStringSchema,
});
export type ScenarioComparisonResponse = z.infer<typeof ScenarioComparisonResponseSchema>;
