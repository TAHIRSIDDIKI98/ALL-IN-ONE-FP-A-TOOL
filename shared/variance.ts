import { z } from 'zod';
import { AccountTypeSchema, MoneyStringSchema } from './index.js';
import { BvaFavorabilitySchema, BvaVariancePctKindSchema } from './bva.js';

/**
 * M2 Flux Analysis & Price-Volume-Mix (PVM) Bridge Contracts (MASTER_PROMPT §2.6, §5.7).
 * Every financial amount and unit quantity crosses the wire strictly as canonical decimal strings.
 */

export const FluxDriverRowSchema = z.object({
  rank: z.number().int().positive(),
  accountCode: z.string().min(1),
  accountName: z.string().min(1),
  accountType: AccountTypeSchema,
  actual: z.string(),
  plan: z.string(),
  varianceAmount: z.string(),
  absVarianceAmount: z.string(),
  variancePctKind: BvaVariancePctKindSchema,
  variancePctFormatted: z.string().nullable(),
  shareOfAbsVariancePct: z.string(),
  favorability: BvaFavorabilitySchema,
  isMaterial: z.boolean(),
});
export type FluxDriverRow = z.infer<typeof FluxDriverRowSchema>;

export const FluxUnplannedAccountSchema = z.object({
  accountCode: z.string().min(1),
  accountName: z.string().min(1),
  accountType: AccountTypeSchema,
  actual: z.string(),
});
export type FluxUnplannedAccount = z.infer<typeof FluxUnplannedAccountSchema>;

export const FluxBridgeSummarySchema = z.object({
  planTotal: z.string(),
  topDriversVariance: z.string(),
  otherPlannedVariance: z.string(),
  plannedVarianceTotal: z.string(),
  plannedActualTotal: z.string(),
  unplannedActualTotal: z.string(),
  actualTotal: z.string(),
  totalAbsPlannedVariance: z.string(),
  revenueVariance: z.string(),
  expenseVariance: z.string(),
  netOperatingVariance: z.string(),
  tieOutValid: z.boolean(),
});
export type FluxBridgeSummary = z.infer<typeof FluxBridgeSummarySchema>;

export const FluxAnalysisResponseSchema = z.object({
  companyId: z.string().uuid(),
  fiscalYear: z.number().int(),
  throughPeriodCode: z.string().min(1),
  scenarioId: z.string().uuid().nullable(),
  scenarioName: z.string().nullable(),
  planVersionId: z.string().uuid().nullable(),
  versionNo: z.number().int().positive().nullable(),
  hasPlan: z.boolean(),
  minAbsVariance: z.string(),
  topN: z.number().int().positive(),
  totalPlannedAccounts: z.number().int().nonnegative(),
  materialCount: z.number().int().nonnegative(),
  otherPlannedCount: z.number().int().nonnegative(),
  drivers: z.array(FluxDriverRowSchema),
  unplannedAccounts: z.array(FluxUnplannedAccountSchema),
  bridge: FluxBridgeSummarySchema,
});
export type FluxAnalysisResponse = z.infer<typeof FluxAnalysisResponseSchema>;

export const PvmBridgeItemInputSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  planUnits: MoneyStringSchema,
  planPrice: MoneyStringSchema,
  actualUnits: MoneyStringSchema,
  actualPrice: MoneyStringSchema,
});
export type PvmBridgeItemInput = z.infer<typeof PvmBridgeItemInputSchema>;

export const PvmBridgeRequestSchema = z.object({
  periodCode: z.string().trim().min(1),
  fiscalYear: z.number().int().positive().nullable().optional(),
  scenarioId: z.string().uuid().nullable().optional(),
  items: z.array(PvmBridgeItemInputSchema).min(1).max(100),
});
export type PvmBridgeRequest = z.infer<typeof PvmBridgeRequestSchema>;

export const PvmBridgeItemRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  planUnits: z.string(),
  planPrice: z.string(),
  actualUnits: z.string(),
  actualPrice: z.string(),
  planRevenue: z.string(),
  actualRevenue: z.string(),
  totalVariance: z.string(),
  priceEffect: z.string(),
  volumeAtPlanPrice: z.string(),
  mixContribution: z.string(),
  favorability: BvaFavorabilitySchema,
});
export type PvmBridgeItemRow = z.infer<typeof PvmBridgeItemRowSchema>;

export const PvmBridgeResponseSchema = z.object({
  companyId: z.string().uuid(),
  fiscalYear: z.number().int(),
  periodCode: z.string(),
  baseCurrency: z.string().length(3),
  scenarioName: z.string().nullable(),
  totalPlanUnits: z.string(),
  totalActualUnits: z.string(),
  totalPlanRevenue: z.string(),
  totalActualRevenue: z.string(),
  totalVariance: z.string(),
  variancePct: z.string().nullable(),
  variancePctStatus: BvaVariancePctKindSchema,
  priceVariance: z.string(),
  volumeVariance: z.string(),
  mixVariance: z.string(),
  invariantPassed: z.boolean(),
  invariantDelta: z.string(),
  items: z.array(PvmBridgeItemRowSchema),
});
export type PvmBridgeResponse = z.infer<typeof PvmBridgeResponseSchema>;
