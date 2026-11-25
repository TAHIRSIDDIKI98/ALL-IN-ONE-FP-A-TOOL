import { z } from 'zod';
import { AccountTypeSchema, NormalSideSchema } from './index.js';
import { StatementLineKeySchema } from './spine.js';

/**
 * Chart-of-accounts contracts (MASTER_PROMPT §9.3.4; Spine Gates G1/G10).
 *
 * The chart is the target side of every import mapping: a source account code can only post when
 * an `account` row exists for it. The file is validated in full before anything is written, so a
 * rejected chart never leaves a half-created chart behind.
 */

export const ChartAccountRowSchema = z.object({
  code: z.string(),
  name: z.string(),
  type: AccountTypeSchema,
  normalSide: NormalSideSchema,
  isContra: z.boolean(),
  isPostable: z.boolean(),
  statementLineKey: StatementLineKeySchema,
  parentCode: z.string().nullable(),
  active: z.boolean(),
  version: z.number().int(),
});

export type ChartAccountRow = z.infer<typeof ChartAccountRowSchema>;

export const ChartOfAccountsReportSchema = z.object({
  companyId: z.string().uuid(),
  accounts: z.array(ChartAccountRowSchema),
});

export type ChartOfAccountsReport = z.infer<typeof ChartOfAccountsReportSchema>;

export const ChartImportRequestSchema = z.object({
  csvText: z.string().min(1).max(2_000_000),
});

export type ChartImportRequest = z.infer<typeof ChartImportRequestSchema>;

export const ChartImportResultSchema = z.object({
  companyId: z.string().uuid(),
  rowCount: z.number().int().nonnegative(),
  inserted: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  accounts: z.array(ChartAccountRowSchema),
});

export type ChartImportResult = z.infer<typeof ChartImportResultSchema>;
