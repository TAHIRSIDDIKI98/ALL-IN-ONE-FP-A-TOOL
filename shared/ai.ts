/**
 * OneFP&A Shared Zod Contracts for AI Intelligence (`/shared/ai.ts`)
 * MASTER_PROMPT §10.3, SPEC.md §7.3 WI-0048A.
 * 
 * Strict string-only money contracts across transport boundaries.
 * Note: Do NOT export from shared/index.ts.
 */

import { z } from 'zod';

export const AiFeatureSchema = z.enum(['variance_commentary', 'nlq_query', 'formula_builder']);
export type AiFeature = z.infer<typeof AiFeatureSchema>;

export const EngineFactSchema = z.object({
  citationKey: z.string().min(1),
  statementLineKey: z.string().min(1),
  periodCode: z.string().min(1),
  accountCode: z.string().optional(),
  entityCode: z.string().optional(),
  label: z.string().min(1),
  value: z.string().min(1),
  basis: z.string().min(1),
});
export type EngineFactDto = z.infer<typeof EngineFactSchema>;

export const CommentarySentenceSchema = z.object({
  text: z.string().min(1),
  citationKeys: z.array(z.string()),
});
export type CommentarySentenceDto = z.infer<typeof CommentarySentenceSchema>;

export const NarrativeStatusSchema = z.enum(['ai_draft', 'human_edited', 'approved', 'locked']);
export type NarrativeStatus = z.infer<typeof NarrativeStatusSchema>;

export const NarrativeCommentarySchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  periodId: z.string().uuid(),
  statementLineKey: z.string().min(1),
  versionNo: z.number().int().positive(),
  status: NarrativeStatusSchema,
  provenance: z.enum(['ai_draft', 'deterministic_fallback', 'human_edited']),
  disclosure: z.string().min(1),
  sentences: z.array(CommentarySentenceSchema),
  citationCoveragePct: z.string().min(1),
  createdAt: z.string().min(1),
  approvedAt: z.string().nullable(),
});
export type NarrativeCommentaryDto = z.infer<typeof NarrativeCommentarySchema>;

export const AiPolicyConfigSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  aiEnabled: z.boolean(),
  consentNoticeVersion: z.string().min(1),
  consentRecordedAt: z.string().nullable(),
  consentRecordedBy: z.string().uuid().nullable(),
  maxRequestsPerHour: z.number().int().positive(),
  updatedAt: z.string().min(1),
});
export type AiPolicyConfigDto = z.infer<typeof AiPolicyConfigSchema>;

export const GenerateCommentaryRequestSchema = z.object({
  periodCode: z.string().min(1),
  statementLineKey: z.string().min(1),
  basis: z.string().optional(),
});
export type GenerateCommentaryRequest = z.infer<typeof GenerateCommentaryRequestSchema>;

export const GenerateCommentaryResponseSchema = z.object({
  commentary: NarrativeCommentarySchema,
  mode: z.enum(['llm', 'deterministic_fallback']),
  redactionCount: z.number().int().nonnegative(),
});
export type GenerateCommentaryResponse = z.infer<typeof GenerateCommentaryResponseSchema>;

export const NlqRequestSchema = z.object({
  question: z.string().min(1),
  periodCode: z.string().optional(),
});
export type NlqRequest = z.infer<typeof NlqRequestSchema>;

export const NlqResponseSchema = z.object({
  intent: z.enum(['statement_metric', 'bva_variance', 'flux_drivers', 'kpi_lookup', 'unsupported']),
  targetKeys: z.array(z.string()),
  periodCode: z.string().nullable(),
  fiscalYear: z.number().nullable(),
  answerText: z.string().min(1),
  facts: z.array(EngineFactSchema),
  rejectedReason: z.string().nullable(),
});
export type NlqResponse = z.infer<typeof NlqResponseSchema>;

export const FormulaEvalRequestSchema = z.object({
  expression: z.string().min(1),
  periodCode: z.string().min(1),
  currencyScale: z.union([z.literal(0), z.literal(2), z.literal(3)]).default(2),
});
export type FormulaEvalRequest = z.infer<typeof FormulaEvalRequestSchema>;

export const FormulaEvalResponseSchema = z.object({
  valid: z.boolean(),
  normalizedFormula: z.string().nullable(),
  referencedKeys: z.array(z.string()),
  value: z.string().nullable(),
  errorCode: z.string().nullable(),
});
export type FormulaEvalResponse = z.infer<typeof FormulaEvalResponseSchema>;

export const NarrativeTransitionRequestSchema = z.object({
  targetStatus: NarrativeStatusSchema,
  reason: z.string().optional(),
});
export type NarrativeTransitionRequest = z.infer<typeof NarrativeTransitionRequestSchema>;
