import { z } from 'zod';
import { PeriodWriteAdvisorySchema } from './import.js';
import { PeriodDateSchema, UtcInstantSchema } from './temporal.js';

const ExceptionMoneyStringSchema = z
  .string()
  .regex(/^-?\d+(?:\.\d{1,6})?$/, 'Money must cross the wire strictly as a decimal string.');

export const ExceptionSeveritySchema = z.enum(['high', 'medium', 'low']);
export type ExceptionSeverityWire = z.infer<typeof ExceptionSeveritySchema>;

export const ExceptionStatusSchema = z.enum([
  'new',
  'acknowledged',
  'explained',
  'corrected',
  'verified',
  'closed',
  'waived',
]);
export type ExceptionStatusWire = z.infer<typeof ExceptionStatusSchema>;

export const ExceptionTransitionActionSchema = z.enum([
  'assign',
  'acknowledge',
  'explain',
  'verify',
  'close',
  'waive',
]);
export type ExceptionTransitionActionWire = z.infer<typeof ExceptionTransitionActionSchema>;

export const RectificationModeSchema = z.enum(['post_reversal', 'export_csv', 'dismiss']);
export type RectificationModeWire = z.infer<typeof RectificationModeSchema>;

export const RectificationSuggestionKindSchema = z.enum([
  'reverse',
  'repost',
  'reverse_and_repost',
  'reclass',
  'reclass_dimension',
  'accrue',
  'release_accrual',
  'clear_suspense',
  'move_period',
  'investigate',
  'commentary',
  'none',
]);

export const RectificationJournalLineSpecSchema = z.object({
  entityCode: z.string().min(1),
  accountCode: z.string().min(1),
  debit: ExceptionMoneyStringSchema,
  credit: ExceptionMoneyStringSchema,
  memo: z.string().min(1),
});

export const RectificationSuggestionSchema = z.object({
  kind: RectificationSuggestionKindSchema,
  targetPeriodId: z.string().uuid(),
  targetPeriodCode: z.string().min(1),
  basis: z.string().min(1),
  erpHint: z.string().min(1),
  confidence: z.enum(['high', 'medium', 'low']),
  lines: z.array(RectificationJournalLineSpecSchema),
  totalDebit: ExceptionMoneyStringSchema,
  totalCredit: ExceptionMoneyStringSchema,
});

export const ExceptionRuleCatalogEntrySchema = z.object({
  ruleId: z.string().regex(/^EXC-\d{3}$/),
  name: z.string().min(1),
  category: z.enum(['control', 'cutoff', 'variance', 'pattern', 'hygiene']),
  defaultSeverity: ExceptionSeveritySchema,
  grainKind: z.string().min(1),
  suggestionKind: RectificationSuggestionKindSchema,
  summary: z.string().min(1),
});

export const NotRunExceptionRuleSchema = z.object({
  ruleId: z.string().regex(/^EXC-\d{3}$/),
  reason: z.string().min(1),
});

export const ExceptionFindingEventSummarySchema = z.object({
  id: z.string().uuid(),
  fromStatus: ExceptionStatusSchema.nullable(),
  toStatus: ExceptionStatusSchema,
  action: z.enum([
    'detected',
    'reopened',
    'assign',
    'acknowledge',
    'explain',
    'correct',
    'verify',
    'close',
    'waive',
  ]),
  note: z.string().nullable(),
  actorEmail: z.string().nullable(),
  createdAt: UtcInstantSchema,
});

export const RectificationJournalSummarySchema = z.object({
  id: z.string().uuid(),
  findingId: z.string().uuid(),
  targetPeriodId: z.string().uuid(),
  targetPeriodCode: z.string().min(1),
  mode: RectificationModeSchema,
  suggestionKind: RectificationSuggestionKindSchema,
  basis: z.string().min(1),
  erpHint: z.string().min(1),
  lines: z.array(RectificationJournalLineSpecSchema),
  totalDebit: ExceptionMoneyStringSchema,
  totalCredit: ExceptionMoneyStringSchema,
  postedBatchId: z.string().uuid().nullable(),
  csvPayload: z.string().nullable(),
  note: z.string().nullable(),
  createdByEmail: z.string().nullable(),
  createdAt: UtcInstantSchema,
});

export const ExceptionFindingSummarySchema = z.object({
  id: z.string().uuid(),
  findingKey: z.string().min(1),
  findingIdHash: z.string().regex(/^[0-9a-f]{32}$/),
  ruleId: z.string().regex(/^EXC-\d{3}$/),
  title: z.string().min(1),
  severity: ExceptionSeveritySchema,
  status: ExceptionStatusSchema,
  periodId: z.string().uuid(),
  periodCode: z.string().min(1),
  accountCode: z.string().nullable(),
  statementLineKey: z.string().nullable(),
  grainKey: z.string().min(1),
  amount: ExceptionMoneyStringSchema,
  ownerUserId: z.string().uuid().nullable(),
  ownerDisplayName: z.string().nullable(),
  dueDate: PeriodDateSchema,
  explanationNote: z.string().nullable(),
  waiverReason: z.string().nullable(),
  waiverExpiresAt: UtcInstantSchema.nullable(),
  evidence: z.record(z.string(), z.unknown()),
  suggestion: RectificationSuggestionSchema,
  rectification: RectificationJournalSummarySchema.nullable(),
  version: z.number().int().min(1),
  detectedAt: UtcInstantSchema,
  updatedAt: UtcInstantSchema,
});
export type ExceptionFindingSummary = z.infer<typeof ExceptionFindingSummarySchema>;

export const ExceptionInboxMetricsSchema = z.object({
  totalFindings: z.number().int().min(0),
  openCount: z.number().int().min(0),
  highSeverityOpenCount: z.number().int().min(0),
  unassignedOpenCount: z.number().int().min(0),
  correctedPendingVerifyCount: z.number().int().min(0),
  waivedCount: z.number().int().min(0),
  closedOrVerifiedCount: z.number().int().min(0),
});

export const ExceptionScanSummarySchema = z.object({
  evaluatedRuleCount: z.number().int().min(0),
  notRunRules: z.array(NotRunExceptionRuleSchema),
  newFindingsCount: z.number().int().min(0),
  existingFindingsCount: z.number().int().min(0),
  resurfacedWaiversCount: z.number().int().min(0),
});

export const ExceptionWorkspaceResponseSchema = z.object({
  companyId: z.string().uuid(),
  actorRole: z.enum(['owner', 'editor', 'reviewer', 'viewer']),
  selectedFiscalYear: z.number().int().min(2000).max(2100),
  selectedPeriodCode: z.string().min(1),
  selectedPeriodId: z.string().uuid(),
  periods: z.array(
    z.object({
      periodId: z.string().uuid(),
      fiscalYear: z.number().int(),
      periodNo: z.number().int(),
      periodCode: z.string().min(1),
      label: z.string().min(1),
      lockStatus: z.enum(['open', 'soft_closed', 'hard_closed']),
    }),
  ),
  members: z.array(
    z.object({
      userId: z.string().uuid(),
      email: z.string().email(),
      displayName: z.string().min(1),
      role: z.enum(['owner', 'editor', 'reviewer', 'viewer']),
    }),
  ),
  catalog: z.array(ExceptionRuleCatalogEntrySchema),
  metrics: ExceptionInboxMetricsSchema,
  lastScan: ExceptionScanSummarySchema.nullable(),
  findings: z.array(ExceptionFindingSummarySchema),
  recentEvents: z.array(ExceptionFindingEventSummarySchema),
  periodAdvisories: z.array(PeriodWriteAdvisorySchema).optional(),
});
export type ExceptionWorkspaceResponse = z.infer<typeof ExceptionWorkspaceResponseSchema>;

export const ExceptionScanRequestSchema = z.object({
  fiscalYear: z.number().int().min(2000).max(2100).optional(),
  periodCode: z.string().trim().min(1).max(32).optional(),
});
export type ExceptionScanRequest = z.infer<typeof ExceptionScanRequestSchema>;

export const ExceptionTransitionRequestSchema = z.object({
  action: ExceptionTransitionActionSchema,
  expectedVersion: z.number().int().min(1),
  note: z.string().trim().max(2000).optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  waiverReason: z.string().trim().max(2000).optional(),
  waiverExpiryDays: z.number().int().min(1).max(90).optional(),
});
export type ExceptionTransitionRequest = z.infer<typeof ExceptionTransitionRequestSchema>;

export const RectifyExceptionRequestSchema = z.object({
  mode: RectificationModeSchema,
  expectedVersion: z.number().int().min(1),
  targetPeriodCode: z.string().trim().min(1).max(32).optional(),
  note: z.string().trim().max(2000).optional(),
});
export type RectifyExceptionRequest = z.infer<typeof RectifyExceptionRequestSchema>;
