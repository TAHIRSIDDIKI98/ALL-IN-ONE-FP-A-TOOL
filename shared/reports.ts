import { z } from 'zod';
import { AccountTypeSchema, NormalSideSchema } from './index.js';
import { StatementLineKeySchema } from './spine.js';

/**
 * Read-model contracts for the reports that the spine screens render
 * (MASTER_PROMPT §5.2, §7.6; Spine Gates G2/G3/G6).
 *
 * Money crosses this boundary ONLY as canonical decimal strings (§5.2 E11). Every row can be
 * drilled back to the import file, batch, and source row number that produced it (§7.6 G6).
 */

export const TrialBalanceRowSchema = z.object({
  accountId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  type: AccountTypeSchema,
  normalSide: NormalSideSchema,
  statementLineKey: StatementLineKeySchema,
  totalDebit: z.string(),
  totalCredit: z.string(),
  naturalActivity: z.string(),
  sheetContribution: z.string(),
});

export type TrialBalanceRow = z.infer<typeof TrialBalanceRowSchema>;

export const TrialBalanceSourceSchema = z.object({
  batchId: z.string().uuid(),
  sourceFilename: z.string(),
  sourceHash: z.string(),
  importedAt: z.string(),
});

export type TrialBalanceSource = z.infer<typeof TrialBalanceSourceSchema>;

export const TrialBalanceReportSchema = z.object({
  companyId: z.string().uuid(),
  throughPeriodCode: z.string().nullable(),
  rows: z.array(TrialBalanceRowSchema),
  totalDebit: z.string(),
  totalCredit: z.string(),
  isBalanced: z.boolean(),
  unbalancedEntryIds: z.array(z.string().uuid()),
  sources: z.array(TrialBalanceSourceSchema),
});

export type TrialBalanceReport = z.infer<typeof TrialBalanceReportSchema>;

export const AccountDrillRowSchema = z.object({
  entryId: z.string().uuid(),
  entryDate: z.string(),
  sourceRef: z.string().nullable(),
  periodCode: z.string(),
  debit: z.string(),
  credit: z.string(),
  batchId: z.string().uuid(),
  sourceFilename: z.string(),
  sourceHash: z.string(),
  rowNo: z.number().int().positive(),
  rawCells: z.array(z.string()),
});

export type AccountDrillRow = z.infer<typeof AccountDrillRowSchema>;

export const AccountDrilldownSchema = z.object({
  companyId: z.string().uuid(),
  accountCode: z.string(),
  accountName: z.string(),
  throughPeriodCode: z.string().nullable(),
  rows: z.array(AccountDrillRowSchema),
  totalDebit: z.string(),
  totalCredit: z.string(),
  naturalActivity: z.string(),
});

export type AccountDrilldown = z.infer<typeof AccountDrilldownSchema>;
