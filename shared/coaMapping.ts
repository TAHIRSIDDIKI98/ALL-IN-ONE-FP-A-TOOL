import { z } from 'zod';

/**
 * Versioned source→account mapping contracts (MASTER_PROMPT §4.3, §9.3.4; SPEC §3.6f).
 *
 * The wire model carries only data the server read from `import_row_raw`, `coa_mapping` and the
 * live chart. Source codes and account codes are strings: leading zeros are meaningful and a code
 * is never parsed as a number (§4.2).
 */

export const CoaMappingSourceSystemSchema = z.literal('csv');
export type CoaMappingSourceSystem = z.infer<typeof CoaMappingSourceSystemSchema>;

export const CoaMappingStatusSchema = z.enum(['mapped', 'quarantined']);
export type CoaMappingStatus = z.infer<typeof CoaMappingStatusSchema>;

/** Display adds the honest third state for a discovered source with no mapping row yet. */
export const CoaMappingDisplayStatusSchema = z.enum(['mapped', 'quarantined', 'unmapped']);
export type CoaMappingDisplayStatus = z.infer<typeof CoaMappingDisplayStatusSchema>;

/** The closed M1 reason vocabulary for an explicit mapping quarantine. */
export const CoaMappingQuarantineReasonSchema = z.enum([
  'MANUAL_QUARANTINE',
  'NO_TARGET_ACCOUNT',
  'AMBIGUOUS_TARGET',
]);
export type CoaMappingQuarantineReason = z.infer<typeof CoaMappingQuarantineReasonSchema>;

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected an ISO YYYY-MM-DD date');

export const CoaMappingEntrySchema = z.object({
  sourceSystem: CoaMappingSourceSystemSchema,
  sourceCode: z.string().min(1).max(64),
  accountCode: z.string().min(1).max(32).nullable(),
  accountName: z.string().nullable(),
  /** 0 is the honest display token for a discovered source with no stored mapping version. */
  mappingVersion: z.number().int().nonnegative(),
  effectiveFrom: IsoDateSchema,
  status: CoaMappingDisplayStatusSchema,
  quarantineReason: CoaMappingQuarantineReasonSchema.nullable(),
  targetConflict: z.boolean(),
  rowCount: z.number().int().nonnegative(),
  sampleValues: z.array(z.string().max(160)).max(5),
});
export type CoaMappingEntry = z.infer<typeof CoaMappingEntrySchema>;

export const AvailableMappingAccountSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
});
export type AvailableMappingAccount = z.infer<typeof AvailableMappingAccountSchema>;

export const CoaMappingReportSchema = z.object({
  companyId: z.string().uuid(),
  sourceSystem: CoaMappingSourceSystemSchema,
  effectiveFrom: IsoDateSchema,
  mappings: z.array(CoaMappingEntrySchema),
  availableAccounts: z.array(AvailableMappingAccountSchema),
  mappedCount: z.number().int().nonnegative(),
  quarantinedCount: z.number().int().nonnegative(),
  unmappedCount: z.number().int().nonnegative(),
  conflictCount: z.number().int().nonnegative(),
});
export type CoaMappingReport = z.infer<typeof CoaMappingReportSchema>;

export const CoaMappingEditSchema = z
  .object({
    sourceCode: z.string().min(1).max(64),
    status: CoaMappingStatusSchema,
    accountCode: z.string().min(1).max(32).nullable(),
    quarantineReason: CoaMappingQuarantineReasonSchema.nullable(),
  })
  .superRefine((edit, ctx) => {
    if (edit.status === 'mapped' && edit.accountCode === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A mapped entry requires accountCode' });
    }
    if (edit.status === 'mapped' && edit.quarantineReason !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A mapped entry cannot carry a quarantine reason',
      });
    }
    if (edit.status === 'quarantined' && edit.accountCode !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A quarantined entry cannot name a target account',
      });
    }
    if (edit.status === 'quarantined' && edit.quarantineReason === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A quarantined entry requires a reason' });
    }
  });
export type CoaMappingEdit = z.infer<typeof CoaMappingEditSchema>;

export const CoaMappingCommitRequestSchema = z.object({
  entries: z.array(CoaMappingEditSchema).min(1).max(500),
});
export type CoaMappingCommitRequest = z.infer<typeof CoaMappingCommitRequestSchema>;

export const CoaMappingCommitResultSchema = z.object({
  companyId: z.string().uuid(),
  effectiveFrom: IsoDateSchema,
  written: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  report: CoaMappingReportSchema,
});
export type CoaMappingCommitResult = z.infer<typeof CoaMappingCommitResultSchema>;
