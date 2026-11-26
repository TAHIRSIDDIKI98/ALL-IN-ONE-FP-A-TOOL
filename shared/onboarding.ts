import { z } from 'zod';
import { MoneyStringSchema } from './index.js';
import { CoaMappingEditSchema } from './coaMapping.js';
import { ImportCommitResultSchema, QuarantineRecordSchema } from './import.js';

/**
 * M2 Customer Onboarding & Data Migration Pipeline Contracts (MASTER_PROMPT §11.12, ONB1–ONB3).
 *
 * - Assisted CoA suggestions are deterministic at M2 (zero LLM calls) and always require human confirmation.
 * - Row accounting satisfies `rowsIn === importableCount + quarantinedCount` (G1/C6, ONB2).
 * - Money crosses boundaries strictly as canonical decimal strings (§5.2 E11).
 */

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected an ISO YYYY-MM-DD date');

export const OnboardingMatchRuleSchema = z.enum([
  'already_mapped',
  'already_quarantined',
  'exact_code',
  'leading_zero_alias',
  'token_name_match',
  'ambiguous_leading_zero',
  'ambiguous_token_match',
  'unmatched',
]);

export const OnboardingMappingSuggestionSchema = z.object({
  sourceCode: z.string().min(1).max(64),
  rowCount: z.number().int().nonnegative(),
  sampleValues: z.array(z.string()).max(5),
  currentStatus: z.enum(['mapped', 'quarantined', 'unmapped']),
  currentAccountCode: z.string().min(1).max(32).nullable(),
  suggestedAccountCode: z.string().min(1).max(32).nullable(),
  suggestedAccountName: z.string().nullable(),
  matchRule: OnboardingMatchRuleSchema,
  confidenceScore: z.number().int().min(0).max(100),
  reason: z.string().min(1),
  requiresHumanApproval: z.literal(true),
});
export type OnboardingMappingSuggestionDto = z.infer<typeof OnboardingMappingSuggestionSchema>;

export const OnboardingAnomalySchema = z.object({
  kind: z.enum([
    'unmapped_source_codes',
    'unbalanced_entries',
    'period_not_found',
    'calendar_gap',
    'leading_zero_collision',
    'quarantined_rows',
    'outlier_amount',
  ]),
  severity: z.enum(['blocker', 'review']),
  title: z.string().min(1),
  detail: z.string().min(1),
});
export type OnboardingAnomalyDto = z.infer<typeof OnboardingAnomalySchema>;

export const OnboardingQuarantineCategorySchema = z.object({
  category: z.string().min(1),
  count: z.number().int().nonnegative(),
});

export const OnboardingValidateRequestSchema = z.object({
  csvText: z.string().min(1).max(6_000_000),
  asOfDate: IsoDateSchema.optional(),
});
export type OnboardingValidateRequest = z.infer<typeof OnboardingValidateRequestSchema>;

export const OnboardingValidationReportSchema = z.object({
  companyId: z.string().uuid(),
  sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
  asOfDate: IsoDateSchema,
  rowsIn: z.number().int().nonnegative(),
  importableCount: z.number().int().nonnegative(),
  quarantinedCount: z.number().int().nonnegative(),
  rowAccountingTies: z.boolean(),
  duplicatesDetected: z.number().int().nonnegative(),
  entryCount: z.number().int().nonnegative(),
  totalDebits: MoneyStringSchema,
  totalCredits: MoneyStringSchema,
  coveredPeriods: z.array(z.string()),
  missingInteriorPeriods: z.array(z.string()),
  leadingZeroCollisions: z.array(z.string()),
  quarantineBreakdown: z.array(OnboardingQuarantineCategorySchema),
  quarantined: z.array(QuarantineRecordSchema),
  anomalies: z.array(OnboardingAnomalySchema),
  suggestions: z.array(OnboardingMappingSuggestionSchema),
  availableAccounts: z.array(z.object({ code: z.string().min(1), name: z.string().min(1) })),
  goLiveStatus: z.enum(['ready', 'ready_with_warnings', 'blocked']),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type OnboardingValidationReport = z.infer<typeof OnboardingValidationReportSchema>;

export const OnboardingApproveMappingsRequestSchema = z.object({
  csvText: z.string().min(1).max(6_000_000),
  entries: z.array(CoaMappingEditSchema).min(1).max(500),
  asOfDate: IsoDateSchema.optional(),
});
export type OnboardingApproveMappingsRequest = z.infer<typeof OnboardingApproveMappingsRequestSchema>;

export const OnboardingApproveMappingsResponseSchema = z.object({
  companyId: z.string().uuid(),
  effectiveFrom: IsoDateSchema,
  written: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  validation: OnboardingValidationReportSchema,
});
export type OnboardingApproveMappingsResponse = z.infer<typeof OnboardingApproveMappingsResponseSchema>;

export const OnboardingRehearseModeSchema = z.enum(['dry_run', 'stage_commit']);
export type OnboardingRehearseMode = z.infer<typeof OnboardingRehearseModeSchema>;

export const OnboardingRehearseRequestSchema = z.object({
  mode: OnboardingRehearseModeSchema,
  sourceFilename: z.string().trim().min(1).max(200),
  csvText: z.string().min(1).max(6_000_000),
  asOfDate: IsoDateSchema.optional(),
});
export type OnboardingRehearseRequest = z.infer<typeof OnboardingRehearseRequestSchema>;

export const OnboardingTrialBalanceSummarySchema = z.object({
  isBalanced: z.boolean(),
  totalDebit: MoneyStringSchema,
  totalCredit: MoneyStringSchema,
  accountCount: z.number().int().nonnegative(),
});
export type OnboardingTrialBalanceSummary = z.infer<typeof OnboardingTrialBalanceSummarySchema>;

export const OnboardingRehearseResponseSchema = z.object({
  companyId: z.string().uuid(),
  mode: OnboardingRehearseModeSchema,
  rehearsalHash: z.string().regex(/^[0-9a-f]{64}$/),
  sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
  validation: OnboardingValidationReportSchema,
  committed: ImportCommitResultSchema.nullable(),
  trialBalanceAfter: OnboardingTrialBalanceSummarySchema,
  executedAt: z.string().datetime(),
});
export type OnboardingRehearseResponse = z.infer<typeof OnboardingRehearseResponseSchema>;
