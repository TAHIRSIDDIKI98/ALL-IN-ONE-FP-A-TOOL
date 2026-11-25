import { z } from 'zod';

const NonEmptyTextSchema = z.string().trim().min(1);

export const MembershipRoleSchema = z.enum(['owner', 'editor', 'reviewer', 'viewer']);
export type MembershipRole = z.infer<typeof MembershipRoleSchema>;

export const ApprovalStatusSchema = z.enum(['draft', 'submitted', 'approved', 'rejected']);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const CommentAnchorKindSchema = z.enum(['version', 'account', 'cell', 'statement_line']);
export type CommentAnchorKind = z.infer<typeof CommentAnchorKindSchema>;

export const NotificationEventKindSchema = z.enum([
  'mention',
  'approval.submitted',
  'approval.approved',
  'approval.rejected',
]);
export type NotificationEventKind = z.infer<typeof NotificationEventKindSchema>;

export const CompanyMemberSchema = z.object({
  userId: z.string().uuid(),
  email: NonEmptyTextSchema,
  displayName: NonEmptyTextSchema,
  role: MembershipRoleSchema,
});
export type CompanyMember = z.infer<typeof CompanyMemberSchema>;

export const AddCompanyMemberRequestSchema = z.object({
  email: z.string().trim().email(),
  displayName: NonEmptyTextSchema.max(120),
  role: MembershipRoleSchema,
});
export type AddCompanyMemberRequest = z.infer<typeof AddCompanyMemberRequestSchema>;

export const PlanVersionSummarySchema = z.object({
  planVersionId: z.string().uuid(),
  scenarioId: z.string().uuid(),
  scenarioName: NonEmptyTextSchema,
  scenarioKind: z.enum(['actual', 'budget', 'forecast']),
  versionNo: z.number().int().positive(),
  label: NonEmptyTextSchema,
  isCurrent: z.boolean(),
  lockedAt: z.string().nullable(),
});
export type PlanVersionSummary = z.infer<typeof PlanVersionSummarySchema>;

export const ApprovalTaskSummarySchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  scenarioId: z.string().uuid(),
  scenarioName: NonEmptyTextSchema,
  planVersionId: z.string().uuid(),
  versionNo: z.number().int().positive(),
  versionLabel: NonEmptyTextSchema,
  title: NonEmptyTextSchema,
  status: ApprovalStatusSchema,
  version: z.number().int().positive(),
  createdBy: z.string().uuid(),
  createdByName: NonEmptyTextSchema,
  assigneeId: z.string().uuid().nullable(),
  assigneeName: z.string().nullable(),
  submittedBy: z.string().uuid().nullable(),
  submittedAt: z.string().nullable(),
  decidedBy: z.string().uuid().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ApprovalTaskSummary = z.infer<typeof ApprovalTaskSummarySchema>;

export const CreateApprovalTaskRequestSchema = z.object({
  planVersionId: z.string().uuid(),
  title: NonEmptyTextSchema.max(200),
  assigneeId: z.string().uuid().nullable().optional(),
});
export type CreateApprovalTaskRequest = z.infer<typeof CreateApprovalTaskRequestSchema>;

export const TransitionApprovalTaskRequestSchema = z.object({
  targetStatus: z.enum(['submitted', 'approved', 'rejected']),
  reason: z.string().trim().max(1000).nullable().optional(),
  expectedVersion: z.number().int().positive().optional(),
});
export type TransitionApprovalTaskRequest = z.infer<typeof TransitionApprovalTaskRequestSchema>;

export const CommentAnchorInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('version') }),
  z.object({ kind: z.literal('account'), accountCode: NonEmptyTextSchema }),
  z.object({
    kind: z.literal('cell'),
    accountCode: NonEmptyTextSchema,
    periodCode: NonEmptyTextSchema,
  }),
  z.object({ kind: z.literal('statement_line'), statementLineKey: NonEmptyTextSchema }),
]);
export type CommentAnchorRequest = z.infer<typeof CommentAnchorInputSchema>;

export const CreateWorkflowCommentRequestSchema = z.object({
  planVersionId: z.string().uuid(),
  anchor: CommentAnchorInputSchema,
  body: NonEmptyTextSchema.max(4000),
});
export type CreateWorkflowCommentRequest = z.infer<typeof CreateWorkflowCommentRequestSchema>;

export const WorkflowCommentSummarySchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  planVersionId: z.string().uuid(),
  versionNo: z.number().int().positive(),
  scenarioName: NonEmptyTextSchema,
  anchorKind: CommentAnchorKindSchema,
  anchorKey: NonEmptyTextSchema,
  accountCode: z.string().nullable(),
  periodCode: z.string().nullable(),
  statementLineKey: z.string().nullable(),
  authorId: z.string().uuid(),
  authorName: NonEmptyTextSchema,
  authorEmail: NonEmptyTextSchema,
  body: NonEmptyTextSchema,
  mentionedUserIds: z.array(z.string().uuid()),
  createdAt: z.string(),
});
export type WorkflowCommentSummary = z.infer<typeof WorkflowCommentSummarySchema>;

export const WorkflowNotificationSummarySchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  recipientId: z.string().uuid(),
  jobId: z.string().uuid(),
  eventKind: NotificationEventKindSchema,
  planVersionId: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
  commentId: z.string().uuid().nullable(),
  title: NonEmptyTextSchema,
  body: NonEmptyTextSchema,
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type WorkflowNotificationSummary = z.infer<typeof WorkflowNotificationSummarySchema>;

export const WorkflowOverviewResponseSchema = z.object({
  companyId: z.string().uuid(),
  actorRole: MembershipRoleSchema,
  members: z.array(CompanyMemberSchema),
  planVersions: z.array(PlanVersionSummarySchema),
  tasks: z.array(ApprovalTaskSummarySchema),
  comments: z.array(WorkflowCommentSummarySchema),
  notifications: z.array(WorkflowNotificationSummarySchema),
});
export type WorkflowOverviewResponse = z.infer<typeof WorkflowOverviewResponseSchema>;
