import { z } from 'zod';
import { AccountTypeSchema, NormalSideSchema } from './index.js';

/**
 * Budget (plan) contracts (MASTER_PROMPT §5.7; Spine Gate G4).
 *
 * A budget is stored as `scenario(kind='budget') → plan_version → plan_line`. It is deliberately
 * NOT a GL posting: budget amounts never enter `gl_entry`, so they can never inflate actuals.
 * Money crosses this boundary as canonical decimal strings (§5.2 E11) at the company's currency
 * scale.
 */

export const BudgetLineSchema = z.object({
  accountCode: z.string(),
  accountName: z.string(),
  accountType: AccountTypeSchema,
  periodCode: z.string(),
  periodNo: z.number().int(),
  amount: z.string(),
});

export type BudgetLine = z.infer<typeof BudgetLineSchema>;

/** Year-to-date plan per account, derived by summing plan lines in /core (never in SQL). */
export const BudgetAccountTotalSchema = z.object({
  accountCode: z.string(),
  accountName: z.string(),
  accountType: AccountTypeSchema,
  normalSide: NormalSideSchema,
  amount: z.string(),
});

export type BudgetAccountTotal = z.infer<typeof BudgetAccountTotalSchema>;

export const BudgetReportSchema = z.object({
  companyId: z.string().uuid(),
  fiscalYear: z.number().int(),
  scenarioId: z.string().uuid().nullable(),
  scenarioName: z.string().nullable(),
  planVersionId: z.string().uuid().nullable(),
  versionNo: z.number().int().positive().nullable(),
  lineCount: z.number().int().nonnegative(),
  totalAmount: z.string(),
  lines: z.array(BudgetLineSchema),
  accounts: z.array(BudgetAccountTotalSchema),
});

export type BudgetReport = z.infer<typeof BudgetReportSchema>;

export const BudgetImportRequestSchema = z.object({
  csvText: z.string().min(1).max(2_000_000),
  fiscalYear: z.number().int().min(1900).max(2200),
  sourceFilename: z.string().min(1).max(255).optional(),
});

export type BudgetImportRequest = z.infer<typeof BudgetImportRequestSchema>;

export const BudgetImportResultSchema = BudgetReportSchema.extend({
  rowCount: z.number().int().nonnegative(),
});

export type BudgetImportResult = z.infer<typeof BudgetImportResultSchema>;
