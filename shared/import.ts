import { z } from 'zod';
import { AccountTypeSchema, NormalSideSchema } from './index.js';
import { StatementLineKeySchema } from './spine.js';

/**
 * Import-layer contracts (MASTER_PROMPT §3.4, §7.6; Spine Gate G1).
 * Money fields are canonical decimal strings — never JS numbers (§5.2 E11).
 */

export const CoaSeedAccountSchema = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(160),
  type: AccountTypeSchema,
  normalSide: NormalSideSchema,
  parentCode: z.string().min(1).max(32).nullable(),
  isPostable: z.boolean(),
  statementLineKey: StatementLineKeySchema,
  active: z.boolean(),
});

export type CoaSeedAccount = z.infer<typeof CoaSeedAccountSchema>;

export const QuarantineRecordSchema = z.object({
  rowNo: z.number().int().positive(),
  reason: z.string().min(1),
});

export type QuarantineRecord = z.infer<typeof QuarantineRecordSchema>;

export const ImportCommitRequestSchema = z.object({
  kind: z.enum(['actuals', 'budget']),
  sourceFilename: z.string().trim().min(1).max(200),
  /**
   * Transport ceiling only. The business limit (5 MB, §4.4) is enforced by the route with a typed
   * IMPORT_FILE_TOO_LARGE, so an over-limit file never reports as a generic validation failure.
   */
  csvText: z.string().min(1).max(6_000_000),
});

export type ImportCommitRequest = z.infer<typeof ImportCommitRequestSchema>;

export const ImportCommitResultSchema = z.object({
  batchId: z.string().uuid(),
  replacedBatchId: z.string().uuid().nullable(),
  rowsIn: z.number().int().nonnegative(),
  importedCount: z.number().int().nonnegative(),
  quarantinedCount: z.number().int().nonnegative(),
  duplicatesDetected: z.number().int().nonnegative(),
  totalDebits: z.string(),
  totalCredits: z.string(),
  entryCount: z.number().int().nonnegative(),
  sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
  quarantined: z.array(QuarantineRecordSchema),
});

export type ImportCommitResult = z.infer<typeof ImportCommitResultSchema>;

/**
 * Read-only import PREVIEW (Spine Gate G1/C6). It is produced by the SAME classifier the commit
 * uses — including the journal-balance gate — so `importedCount` here is exactly what a commit of
 * the same text would post, and `importedCount + quarantinedCount === rowsIn` always holds.
 */
export const CompanyImportPreviewRequestSchema = z.object({
  /** Same transport ceiling as the commit request; the 5 MB business limit is enforced by the route. */
  csvText: z.string().min(1).max(6_000_000),
});

export const ImportPreviewRowSchema = z.object({
  rowNo: z.number().int().positive(),
  entryRef: z.string(),
  postingDate: z.string(),
  accountCode: z.string(),
  description: z.string(),
  debit: z.string(),
  credit: z.string(),
});

export const ImportPreviewReportSchema = z.object({
  companyId: z.string().uuid(),
  rowsIn: z.number().int().nonnegative(),
  importedCount: z.number().int().nonnegative(),
  quarantinedCount: z.number().int().nonnegative(),
  duplicatesDetected: z.number().int().nonnegative(),
  entryCount: z.number().int().nonnegative(),
  totalDebits: z.string(),
  totalCredits: z.string(),
  imported: z.array(ImportPreviewRowSchema),
  quarantined: z.array(QuarantineRecordSchema),
});

export type ImportPreviewReport = z.infer<typeof ImportPreviewReportSchema>;
