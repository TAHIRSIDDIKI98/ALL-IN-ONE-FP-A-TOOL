import { z } from 'zod';
import { PeriodDateSchema } from './temporal.js';

/**
 * M3 Multi-Entity, Multi-Currency & Consolidation wire contracts (MASTER_PROMPT §11.6 FX1–FX5; SPEC §3.18).
 * Strictly pure zod + TS types with zero `any`; all monetary and FX rate values cross as decimal strings.
 */

const DecimalStringSchema = z
  .string()
  .trim()
  .regex(/^-?\d+(?:\.\d+)?$/, 'Expected canonical decimal string');

const PositiveDecimalStringSchema = z
  .string()
  .trim()
  .regex(/^(?!0+(?:\.0+)?$)\d+(?:\.\d+)?$/, 'Expected strictly positive decimal string');

const CurrencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Expected 3-letter ISO currency code');

export const FxRateTypeSchema = z.enum(['closing', 'average', 'historical']);
export type FxRateType = z.infer<typeof FxRateTypeSchema>;

export const FxRateSourceSchema = z.enum(['manual', 'ecb', 'fed', 'bloomberg', 'erp_feed']);
export type FxRateSource = z.infer<typeof FxRateSourceSchema>;

export const ConsolidationMethodSchema = z.enum(['full', 'equity', 'cost']);
export type ConsolidationMethod = z.infer<typeof ConsolidationMethodSchema>;

export const IntercompanyRuleTypeSchema = z.enum([
  'ic_receivable_payable',
  'ic_revenue_expense',
  'ic_investment_equity',
  'ic_dividend',
  'ic_loan',
]);
export type IntercompanyRuleType = z.infer<typeof IntercompanyRuleTypeSchema>;

export const CreateEntityRequestSchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(160),
  currency: CurrencyCodeSchema,
  parentEntityCode: z.string().trim().min(1).max(32).nullable().optional(),
});
export type CreateEntityRequest = z.infer<typeof CreateEntityRequestSchema>;

export const ConsolidationEntitySummarySchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  currency: CurrencyCodeSchema,
  parentId: z.string().uuid().nullable(),
  active: z.boolean(),
});
export type ConsolidationEntitySummary = z.infer<typeof ConsolidationEntitySummarySchema>;

export const UpsertEntityOwnershipRequestSchema = z.object({
  parentEntityCode: z.string().trim().min(1).max(32),
  childEntityCode: z.string().trim().min(1).max(32),
  ownershipPct: PositiveDecimalStringSchema,
  method: ConsolidationMethodSchema.default('full'),
  effectiveFrom: PeriodDateSchema.optional(),
});
export type UpsertEntityOwnershipRequest = z.infer<typeof UpsertEntityOwnershipRequestSchema>;

export const EntityOwnershipSummarySchema = z.object({
  id: z.string().uuid(),
  parentEntityId: z.string().uuid(),
  parentEntityCode: z.string(),
  childEntityId: z.string().uuid(),
  childEntityCode: z.string(),
  ownershipPct: z.string(),
  method: ConsolidationMethodSchema,
  effectiveFrom: z.string(),
});
export type EntityOwnershipSummary = z.infer<typeof EntityOwnershipSummarySchema>;

export const UpsertFxRateRequestSchema = z.object({
  baseCurrency: CurrencyCodeSchema,
  quoteCurrency: CurrencyCodeSchema,
  rateType: FxRateTypeSchema,
  asOfDate: PeriodDateSchema,
  rate: PositiveDecimalStringSchema,
  source: FxRateSourceSchema.default('manual'),
});
export type UpsertFxRateRequest = z.infer<typeof UpsertFxRateRequestSchema>;

export const FxRateSummarySchema = z.object({
  id: z.string().uuid(),
  baseCurrency: CurrencyCodeSchema,
  quoteCurrency: CurrencyCodeSchema,
  rateType: FxRateTypeSchema,
  asOfDate: z.string(),
  rate: z.string(),
  source: FxRateSourceSchema,
  createdAt: z.string(),
});
export type FxRateSummary = z.infer<typeof FxRateSummarySchema>;

export const CreateIntercompanyRuleRequestSchema = z.object({
  fromEntityCode: z.string().trim().min(1).max(32),
  fromAccountCode: z.string().trim().min(1).max(64),
  toEntityCode: z.string().trim().min(1).max(32),
  toAccountCode: z.string().trim().min(1).max(64),
  ruleType: IntercompanyRuleTypeSchema,
  description: z.string().trim().min(1).max(240),
});
export type CreateIntercompanyRuleRequest = z.infer<typeof CreateIntercompanyRuleRequestSchema>;

export const IntercompanyRuleSummarySchema = z.object({
  id: z.string().uuid(),
  fromEntityId: z.string().uuid(),
  fromEntityCode: z.string(),
  fromAccountCode: z.string(),
  toEntityId: z.string().uuid(),
  toEntityCode: z.string(),
  toAccountCode: z.string(),
  ruleType: IntercompanyRuleTypeSchema,
  description: z.string(),
  active: z.boolean(),
});
export type IntercompanyRuleSummary = z.infer<typeof IntercompanyRuleSummarySchema>;

export const MonetaryRevaluationItemRequestSchema = z.object({
  itemKey: z.string().trim().min(1).max(64),
  entityCode: z.string().trim().min(1).max(32),
  accountCode: z.string().trim().min(1).max(64),
  accountType: z.enum(['asset', 'liability']),
  foreignCurrency: CurrencyCodeSchema,
  functionalCurrency: CurrencyCodeSchema,
  foreignAmount: PositiveDecimalStringSchema,
  bookingRate: PositiveDecimalStringSchema,
  periodEndRate: PositiveDecimalStringSchema,
  settled: z.boolean().default(false),
  settlementRate: PositiveDecimalStringSchema.optional(),
});

export const MonetaryRevaluationRequestSchema = z.object({
  functionalCurrency: CurrencyCodeSchema,
  fxGainLossAccountCode: z.string().trim().min(1).max(64).optional(),
  items: z.array(MonetaryRevaluationItemRequestSchema).min(1).max(200),
});
export type MonetaryRevaluationRequest = z.infer<typeof MonetaryRevaluationRequestSchema>;

export const MonetaryRevaluationResponseSchema = z.object({
  reportingOrFunctionalCurrency: CurrencyCodeSchema,
  items: z.array(
    z.object({
      itemKey: z.string(),
      entityCode: z.string(),
      accountCode: z.string(),
      foreignCurrency: CurrencyCodeSchema,
      functionalCurrency: CurrencyCodeSchema,
      foreignAmount: DecimalStringSchema,
      bookingAmountFunctional: DecimalStringSchema,
      valuationRate: DecimalStringSchema,
      revaluedAmountFunctional: DecimalStringSchema,
      classification: z.enum(['realized', 'unrealized']),
      gainLossFunctional: DecimalStringSchema,
    }),
  ),
  realizedTotal: DecimalStringSchema,
  unrealizedTotal: DecimalStringSchema,
  netRevaluationTotal: DecimalStringSchema,
  journalLines: z.array(
    z.object({
      entityCode: z.string(),
      accountCode: z.string(),
      debit: DecimalStringSchema,
      credit: DecimalStringSchema,
      memo: z.string(),
    }),
  ),
  journalBalanced: z.boolean(),
});
export type MonetaryRevaluationResponse = z.infer<typeof MonetaryRevaluationResponseSchema>;

export const RunConsolidationRequestSchema = z.object({
  periodCode: z.string().trim().min(1).max(16),
  fiscalYear: z.number().int().min(1900).max(2200).optional(),
  reportingCurrency: CurrencyCodeSchema.optional(),
  asOfDate: PeriodDateSchema.optional(),
  ctaAccountCode: z.string().trim().min(1).max(64).optional(),
});
export type RunConsolidationRequest = z.infer<typeof RunConsolidationRequestSchema>;

export const ConsolidationRunSummarySchema = z.object({
  runId: z.string().uuid(),
  fiscalYear: z.number().int(),
  periodId: z.string().uuid(),
  periodCode: z.string(),
  asOfDate: z.string(),
  reportingCurrency: CurrencyCodeSchema,
  status: z.enum(['completed', 'quarantined_residuals', 'failed']),
  groupTbBalanced: z.boolean(),
  groupBsBalanced: z.boolean(),
  totalAssets: DecimalStringSchema,
  totalLiabilities: DecimalStringSchema,
  totalEquityBeforeNci: DecimalStringSchema,
  controllingEquity: DecimalStringSchema,
  minorityInterest: DecimalStringSchema,
  totalGroupEquity: DecimalStringSchema,
  totalCta: DecimalStringSchema,
  totalRevenue: DecimalStringSchema,
  totalExpenses: DecimalStringSchema,
  consolidatedNetIncome: DecimalStringSchema,
  controllingNetIncome: DecimalStringSchema,
  nciNetIncome: DecimalStringSchema,
  totalEliminations: DecimalStringSchema,
  unmatchedIcCount: z.number().int().min(0),
  hasUnmatchedIc: z.boolean(),
  groupTbTotalDebit: DecimalStringSchema,
  groupTbTotalCredit: DecimalStringSchema,
  accountingEquationImbalance: DecimalStringSchema,
  ctaAccountCode: z.string(),
  ctaAccountName: z.string(),
  entityTranslations: z.array(
    z.object({
      entityId: z.string().uuid(),
      entityCode: z.string(),
      entityName: z.string(),
      functionalCurrency: CurrencyCodeSchema,
      reportingCurrency: CurrencyCodeSchema,
      method: ConsolidationMethodSchema,
      ownershipPct: DecimalStringSchema,
      closingRate: DecimalStringSchema,
      averageRate: DecimalStringSchema,
      historicalRate: DecimalStringSchema,
      localTotalDebit: DecimalStringSchema,
      localTotalCredit: DecimalStringSchema,
      translatedAssets: DecimalStringSchema,
      translatedLiabilities: DecimalStringSchema,
      translatedOpeningEquity: DecimalStringSchema,
      translatedRevenue: DecimalStringSchema,
      translatedExpenses: DecimalStringSchema,
      translatedNetIncome: DecimalStringSchema,
      openingEquityRateEffect: DecimalStringSchema,
      netIncomeRateEffect: DecimalStringSchema,
      roundingResidual: DecimalStringSchema,
      totalCta: DecimalStringSchema,
    }),
  ),
  minorityInterests: z.array(
    z.object({
      entityId: z.string().uuid(),
      entityCode: z.string(),
      entityName: z.string(),
      ownershipPct: DecimalStringSchema,
      minorityPct: DecimalStringSchema,
      subsidiaryNetEquity: DecimalStringSchema,
      subsidiaryNetIncome: DecimalStringSchema,
      nciNetIncomeShare: DecimalStringSchema,
      nciEquityShare: DecimalStringSchema,
      nciTotalBalance: DecimalStringSchema,
    }),
  ),
  icReconciliations: z.array(
    z.object({
      ruleId: z.string(),
      ruleType: IntercompanyRuleTypeSchema,
      fromEntityCode: z.string(),
      fromAccountCode: z.string(),
      toEntityCode: z.string(),
      toAccountCode: z.string(),
      fromTranslatedBalance: DecimalStringSchema,
      toTranslatedBalance: DecimalStringSchema,
      eliminatedAmount: DecimalStringSchema,
      unmatchedDifference: DecimalStringSchema,
      status: z.enum(['matched', 'unmatched_difference']),
      quarantineReason: z.string().nullable(),
      description: z.string(),
    }),
  ),
  eliminationLines: z.array(
    z.object({
      ruleId: z.string(),
      entityCode: z.string(),
      accountCode: z.string(),
      debit: DecimalStringSchema,
      credit: DecimalStringSchema,
      description: z.string(),
    }),
  ),
  consolidatedTrialBalance: z.array(
    z.object({
      accountCode: z.string(),
      accountName: z.string(),
      accountType: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
      normalSide: z.enum(['debit', 'credit']),
      preEliminationNatural: DecimalStringSchema,
      eliminationNatural: DecimalStringSchema,
      consolidatedNatural: DecimalStringSchema,
      debit: DecimalStringSchema,
      credit: DecimalStringSchema,
    }),
  ),
  createdAt: z.string(),
});
export type ConsolidationRunSummary = z.infer<typeof ConsolidationRunSummarySchema>;

export const ConsolidationWorkspaceResponseSchema = z.object({
  companyId: z.string().uuid(),
  baseCurrency: CurrencyCodeSchema,
  entities: z.array(ConsolidationEntitySummarySchema),
  ownerships: z.array(EntityOwnershipSummarySchema),
  fxRates: z.array(FxRateSummarySchema),
  icRules: z.array(IntercompanyRuleSummarySchema),
  latestRun: ConsolidationRunSummarySchema.nullable(),
  recentRuns: z.array(ConsolidationRunSummarySchema),
});
export type ConsolidationWorkspaceResponse = z.infer<typeof ConsolidationWorkspaceResponseSchema>;
