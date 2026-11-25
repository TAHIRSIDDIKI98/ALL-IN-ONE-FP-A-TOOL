import { z } from 'zod';
import { AccountTypeSchema } from './index.js';

/**
 * Budget-vs-Actual read model (MASTER_PROMPT §3.5, §5.7; Spine Gate G5).
 *
 * `varianceAmount = actual - plan`. A row with no plan line reports `plan: null` and
 * `varianceAmount: null` — never an invented zero plan. Money crosses the wire as canonical
 * decimal strings at the company's currency scale.
 */

export const BvaVariancePctKindSchema = z.enum(['computed', 'zero', 'nm', 'null']);
export const BvaFavorabilitySchema = z.enum(['favorable', 'unfavorable', 'neutral', 'na']);

export const BvaRowSchema = z.object({
  accountCode: z.string(),
  accountName: z.string(),
  accountType: AccountTypeSchema,
  actual: z.string().nullable(),
  plan: z.string().nullable(),
  varianceAmount: z.string().nullable(),
  variancePctKind: BvaVariancePctKindSchema,
  variancePctFormatted: z.string().nullable(),
  favorability: BvaFavorabilitySchema,
});

export type BvaRow = z.infer<typeof BvaRowSchema>;

export const BvaTotalsSchema = z.object({
  actual: z.string(),
  plan: z.string(),
  unplannedActual: z.string(),
  varianceAmount: z.string(),
  plannedRows: z.number().int().nonnegative(),
  unplannedRows: z.number().int().nonnegative(),
  favorable: z.number().int().nonnegative(),
  unfavorable: z.number().int().nonnegative(),
  neutral: z.number().int().nonnegative(),
  na: z.number().int().nonnegative(),
});

export const BvaTypeTotalSchema = z.object({
  accountType: AccountTypeSchema,
  actual: z.string(),
  plan: z.string(),
  varianceAmount: z.string(),
});

export const BvaReportSchema = z.object({
  companyId: z.string().uuid(),
  fiscalYear: z.number().int(),
  throughPeriodCode: z.string(),
  scenarioId: z.string().uuid().nullable(),
  scenarioName: z.string().nullable(),
  planVersionId: z.string().uuid().nullable(),
  versionNo: z.number().int().positive().nullable(),
  hasPlan: z.boolean(),
  rows: z.array(BvaRowSchema),
  totals: BvaTotalsSchema,
  byType: z.array(BvaTypeTotalSchema),
});

export type BvaReport = z.infer<typeof BvaReportSchema>;
