import { z } from 'zod';
import { PeriodDateSchema } from './temporal.js';

/**
 * M3 Close Management & Period Locks wire contracts (MASTER_PROMPT §12.6 CLS1–CLS4; SPEC §3.16).
 * Strictly pure zod + TS types with zero `any`.
 */

export const PeriodLockStatusSchema = z.enum(['open', 'soft_closed', 'hard_closed']);
export type PeriodLockStatus = z.infer<typeof PeriodLockStatusSchema>;

export const CloseTaskCategorySchema = z.enum([
  'import',
  'reconciliation',
  'review',
  'reporting',
  'lock',
]);
export type CloseTaskCategory = z.infer<typeof CloseTaskCategorySchema>;

export const CloseOwnerRoleSchema = z.enum(['owner', 'editor', 'reviewer']);
export type CloseOwnerRole = z.infer<typeof CloseOwnerRoleSchema>;

export const CloseTaskStatusSchema = z.enum([
  'pending',
  'in_progress',
  'signed_off',
  'reopened',
]);
export type CloseTaskStatus = z.infer<typeof CloseTaskStatusSchema>;

export const CloseDerivedStatusSchema = z.enum([
  'not_started',
  'in_progress',
  'blocked_reconciliation',
  'ready_to_close',
  'soft_closed',
  'hard_closed',
]);
export type CloseDerivedStatus = z.infer<typeof CloseDerivedStatusSchema>;

export const CloseTaskKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9_-]{1,63}$/, 'Task key must be lowercase alphanumeric/hyphen/underscore (2-64 chars)');

export const CloseTaskTemplateInputSchema = z.object({
  taskKey: CloseTaskKeySchema,
  title: z.string().trim().min(1).max(160),
  category: CloseTaskCategorySchema,
  ownerRole: CloseOwnerRoleSchema,
  dueDayOffset: z.number().int().min(-30).max(60),
  prerequisiteKeys: z.array(CloseTaskKeySchema).default([]),
  requiresReconciliation: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(1000),
});
export type CloseTaskTemplateInput = z.infer<typeof CloseTaskTemplateInputSchema>;

export const CloseTaskTemplateSummarySchema = CloseTaskTemplateInputSchema.extend({
  id: z.string().uuid(),
  active: z.boolean(),
});
export type CloseTaskTemplateSummary = z.infer<typeof CloseTaskTemplateSummarySchema>;

export const UpsertCloseTemplatesRequestSchema = z.object({
  templates: z.array(CloseTaskTemplateInputSchema).min(1).max(50),
});
export type UpsertCloseTemplatesRequest = z.infer<typeof UpsertCloseTemplatesRequestSchema>;

export const UpsertCloseTemplatesResponseSchema = z.object({
  companyId: z.string().uuid(),
  templates: z.array(CloseTaskTemplateSummarySchema),
});
export type UpsertCloseTemplatesResponse = z.infer<typeof UpsertCloseTemplatesResponseSchema>;

export const InitializeCloseCycleRequestSchema = z.object({
  fiscalYear: z.number().int().min(1900).max(2200),
  periodCode: z.string().trim().min(1).max(16),
});
export type InitializeCloseCycleRequest = z.infer<typeof InitializeCloseCycleRequestSchema>;

export const TransitionCloseTaskRequestSchema = z.object({
  action: z.enum(['start', 'sign_off', 'reopen']),
  expectedVersion: z.number().int().min(1),
  note: z.string().trim().max(500).optional(),
});
export type TransitionCloseTaskRequest = z.infer<typeof TransitionCloseTaskRequestSchema>;

export const TransitionPeriodLockRequestSchema = z.object({
  action: z.enum(['soft_close', 'hard_close', 'unlock']),
  reason: z.string().trim().min(5).max(500),
});
export type TransitionPeriodLockRequest = z.infer<typeof TransitionPeriodLockRequestSchema>;

export const CloseReconciliationSummarySchema = z.object({
  passed: z.boolean(),
  trialBalanceBalanced: z.boolean(),
  unmappedOrQuarantinedCount: z.number().int().nonnegative(),
  statementArticulationValid: z.boolean(),
  hasActualsInPeriod: z.boolean(),
  issues: z.array(z.string()),
});
export type CloseReconciliationSummary = z.infer<typeof CloseReconciliationSummarySchema>;

export const CloseTaskSummarySchema = z.object({
  id: z.string().uuid(),
  taskKey: CloseTaskKeySchema,
  title: z.string(),
  category: CloseTaskCategorySchema,
  ownerRole: CloseOwnerRoleSchema,
  dueDate: PeriodDateSchema,
  prerequisiteKeys: z.array(CloseTaskKeySchema),
  requiresReconciliation: z.boolean(),
  status: CloseTaskStatusSchema,
  sortOrder: z.number().int().nonnegative(),
  signedOffBy: z.string().uuid().nullable(),
  signedOffByEmail: z.string().nullable(),
  signedOffAt: z.string().nullable(),
  signoffNote: z.string().nullable(),
  version: z.number().int().min(1),
  isUnlocked: z.boolean(),
  blockingPrerequisites: z.array(CloseTaskKeySchema),
  blockingReasons: z.array(z.string()),
});
export type CloseTaskSummary = z.infer<typeof CloseTaskSummarySchema>;

export const DerivedCloseStatusSummarySchema = z.object({
  derivedStatus: CloseDerivedStatusSchema,
  lockStatus: PeriodLockStatusSchema,
  totalTasks: z.number().int().nonnegative(),
  signedOffCount: z.number().int().nonnegative(),
  inProgressCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  reopenedCount: z.number().int().nonnegative(),
  completionPct: z.string(),
  reconciliationPassed: z.boolean(),
  readyForHardClose: z.boolean(),
  incompleteTaskKeys: z.array(z.string()),
});
export type DerivedCloseStatusSummary = z.infer<typeof DerivedCloseStatusSummarySchema>;

export const CloseCycleSummarySchema = z.object({
  id: z.string().uuid(),
  periodId: z.string().uuid(),
  periodCode: z.string(),
  fiscalYear: z.number().int(),
  createdAt: z.string(),
});
export type CloseCycleSummary = z.infer<typeof CloseCycleSummarySchema>;

export const PeriodCloseOverviewItemSchema = z.object({
  periodId: z.string().uuid(),
  fiscalYear: z.number().int(),
  periodNo: z.number().int(),
  periodCode: z.string(),
  label: z.string(),
  startDate: PeriodDateSchema,
  endDate: PeriodDateSchema,
  lockStatus: PeriodLockStatusSchema,
  lockUpdatedAt: z.string().nullable(),
  hasCycle: z.boolean(),
  derivedStatus: CloseDerivedStatusSchema,
  completionPct: z.string(),
  signedOffCount: z.number().int().nonnegative(),
  totalTasks: z.number().int().nonnegative(),
});
export type PeriodCloseOverviewItem = z.infer<typeof PeriodCloseOverviewItemSchema>;

export const PeriodLockEventSummarySchema = z.object({
  id: z.string().uuid(),
  periodId: z.string().uuid(),
  periodCode: z.string(),
  fiscalYear: z.number().int(),
  fromStatus: PeriodLockStatusSchema,
  toStatus: PeriodLockStatusSchema,
  action: z.enum(['soft_close', 'hard_close', 'unlock']),
  reason: z.string(),
  actorId: z.string().uuid(),
  actorEmail: z.string(),
  auditEntryId: z.string().uuid(),
  createdAt: z.string(),
});
export type PeriodLockEventSummary = z.infer<typeof PeriodLockEventSummarySchema>;

export const CloseWorkspaceResponseSchema = z.object({
  companyId: z.string().uuid(),
  actorRole: z.enum(['owner', 'editor', 'reviewer', 'viewer']),
  selectedFiscalYear: z.number().int(),
  selectedPeriodCode: z.string(),
  selectedPeriodId: z.string().uuid(),
  periods: z.array(PeriodCloseOverviewItemSchema),
  templates: z.array(CloseTaskTemplateSummarySchema),
  cycle: CloseCycleSummarySchema.nullable(),
  statusSummary: DerivedCloseStatusSummarySchema,
  reconciliation: CloseReconciliationSummarySchema,
  tasks: z.array(CloseTaskSummarySchema),
  lockEvents: z.array(PeriodLockEventSummarySchema),
});
export type CloseWorkspaceResponse = z.infer<typeof CloseWorkspaceResponseSchema>;
