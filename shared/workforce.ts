import { z } from 'zod';
import {
  DriverPlanCommitResponseSchema,
  DriverPlanPreviewResponseSchema,
  FixedDriverSchema,
  ScenarioKindSchema,
} from './planning.js';
import { MembershipRoleSchema } from './workflow.js';

const DecimalStringSchema = z.string().regex(/^[+-]?\d+(?:\.\d+)?$/, 'Expected canonical decimal string');
const NonEmptyTextSchema = z.string().trim().min(1);

export const WorkforcePositionStatusSchema = z.enum(['active', 'inactive']);
export type WorkforcePositionStatus = z.infer<typeof WorkforcePositionStatusSchema>;

export const WorkforcePositionInputSchema = z.object({
  positionCode: NonEmptyTextSchema.max(64),
  title: NonEmptyTextSchema.max(160),
  departmentName: NonEmptyTextSchema.max(120),
  accountCode: NonEmptyTextSchema.max(64),
  startPeriodCode: NonEmptyTextSchema.max(32),
  endPeriodCode: NonEmptyTextSchema.max(32).nullable(),
  fte: DecimalStringSchema,
  annualSalary: DecimalStringSchema,
  burdenRate: DecimalStringSchema,
  bonusRate: DecimalStringSchema,
  rampFirstPeriodPct: DecimalStringSchema,
  meritPeriodCode: NonEmptyTextSchema.max(32).nullable(),
  meritIncreasePct: DecimalStringSchema,
  status: WorkforcePositionStatusSchema,
});
export type WorkforcePositionPayload = z.infer<typeof WorkforcePositionInputSchema>;

export const WorkforcePositionRecordSchema = WorkforcePositionInputSchema.extend({
  id: z.string().uuid(),
  accountName: NonEmptyTextSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkforcePositionRecord = z.infer<typeof WorkforcePositionRecordSchema>;

export const WorkforceModuleSpecSchema = z.object({
  moduleKey: z.literal('workforce'),
  moduleName: z.string(),
  version: z.string(),
  dimensions: z.array(z.string()),
  driverKinds: z.tuple([z.literal('fixed')]),
  recommendedStatementLineKeys: z.array(z.string()),
  inputColumns: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      valueKind: z.enum(['code', 'text', 'period', 'decimal', 'money', 'status']),
      required: z.boolean(),
    }),
  ),
  reportPackSections: z.array(z.string()),
});
export type WorkforceModuleSpecPayload = z.infer<typeof WorkforceModuleSpecSchema>;

export const WorkforceWorkspaceResponseSchema = z.object({
  companyId: z.string().uuid(),
  fiscalYear: z.number().int(),
  currency: NonEmptyTextSchema,
  currencyScale: z.union([z.literal(0), z.literal(2), z.literal(3)]),
  actorRole: MembershipRoleSchema,
  moduleSpec: WorkforceModuleSpecSchema,
  periods: z.array(NonEmptyTextSchema),
  accounts: z.array(
    z.object({
      code: NonEmptyTextSchema,
      name: NonEmptyTextSchema,
      type: NonEmptyTextSchema,
    }),
  ),
  positions: z.array(WorkforcePositionRecordSchema),
});
export type WorkforceWorkspaceResponse = z.infer<typeof WorkforceWorkspaceResponseSchema>;

export const WorkforceSavePositionsRequestSchema = z.object({
  fiscalYear: z.number().int().min(2000).max(2100).optional(),
  positions: z.array(WorkforcePositionInputSchema),
});
export type WorkforceSavePositionsRequest = z.infer<typeof WorkforceSavePositionsRequestSchema>;

export const WorkforcePreviewRequestSchema = z.object({
  fiscalYear: z.number().int().min(2000).max(2100),
  periods: z.array(NonEmptyTextSchema).min(1).optional(),
  positions: z.array(WorkforcePositionInputSchema).optional(),
});
export type WorkforcePreviewRequest = z.infer<typeof WorkforcePreviewRequestSchema>;

export const WorkforcePositionPeriodCellSchema = z.object({
  positionCode: NonEmptyTextSchema,
  title: NonEmptyTextSchema,
  departmentName: NonEmptyTextSchema,
  accountCode: NonEmptyTextSchema,
  periodCode: NonEmptyTextSchema,
  activeInPeriod: z.boolean(),
  effectiveFte: DecimalStringSchema,
  basePay: DecimalStringSchema,
  benefits: DecimalStringSchema,
  bonus: DecimalStringSchema,
  totalCost: DecimalStringSchema,
});
export type WorkforcePositionPeriodCellPayload = z.infer<typeof WorkforcePositionPeriodCellSchema>;

export const WorkforcePositionSummarySchema = z.object({
  positionCode: NonEmptyTextSchema,
  title: NonEmptyTextSchema,
  departmentName: NonEmptyTextSchema,
  accountCode: NonEmptyTextSchema,
  status: WorkforcePositionStatusSchema,
  fteMonths: DecimalStringSchema,
  totalBasePay: DecimalStringSchema,
  totalBenefits: DecimalStringSchema,
  totalBonus: DecimalStringSchema,
  totalCost: DecimalStringSchema,
});
export type WorkforcePositionSummaryPayload = z.infer<typeof WorkforcePositionSummarySchema>;

export const WorkforceDepartmentSummarySchema = z.object({
  departmentName: NonEmptyTextSchema,
  fteMonths: DecimalStringSchema,
  totalCost: DecimalStringSchema,
});
export type WorkforceDepartmentSummaryPayload = z.infer<typeof WorkforceDepartmentSummarySchema>;

export const WorkforcePreviewResponseSchema = z.object({
  companyId: z.string().uuid(),
  fiscalYear: z.number().int(),
  currency: NonEmptyTextSchema,
  currencyScale: z.union([z.literal(0), z.literal(2), z.literal(3)]),
  periods: z.array(NonEmptyTextSchema),
  positionPeriodRows: z.array(WorkforcePositionPeriodCellSchema),
  positionSummaries: z.array(WorkforcePositionSummarySchema),
  departmentSummaries: z.array(WorkforceDepartmentSummarySchema),
  fteByPeriod: z.record(NonEmptyTextSchema, DecimalStringSchema),
  costByPeriod: z.record(NonEmptyTextSchema, DecimalStringSchema),
  grandTotalFteMonths: DecimalStringSchema,
  grandTotalCost: DecimalStringSchema,
  compiledDrivers: z.array(FixedDriverSchema),
  driverPlan: DriverPlanPreviewResponseSchema,
});
export type WorkforcePreviewResponse = z.infer<typeof WorkforcePreviewResponseSchema>;

export const WorkforceCommitRequestSchema = z.object({
  fiscalYear: z.number().int().min(2000).max(2100),
  scenarioName: NonEmptyTextSchema.max(120),
  scenarioKind: ScenarioKindSchema.default('forecast'),
  periods: z.array(NonEmptyTextSchema).min(1).optional(),
  positions: z.array(WorkforcePositionInputSchema).optional(),
  saveRoster: z.boolean().default(true),
});
export type WorkforceCommitRequest = z.infer<typeof WorkforceCommitRequestSchema>;

export const WorkforceCommitResponseSchema = z.object({
  preview: WorkforcePreviewResponseSchema,
  commit: DriverPlanCommitResponseSchema,
});
export type WorkforceCommitResponse = z.infer<typeof WorkforceCommitResponseSchema>;
