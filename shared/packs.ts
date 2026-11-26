import { z } from 'zod';
import { AccountTypeSchema, NormalSideSchema } from './index.js';
import { ChartAccountRowSchema } from './chart.js';
import { StatementLineKeySchema } from './spine.js';

export const M2_INDUSTRY_PACK_KEYS = ['saas', 'retail', 'manufacturing'] as const;
export const IndustryPackKeySchema = z.enum(M2_INDUSTRY_PACK_KEYS);
export type IndustryPackKey = z.infer<typeof IndustryPackKeySchema>;

export const PackCalendarKindSchema = z.enum(['12month', '454', '445', '544', '3334']);
export const PackAccountTypeSchema = z.enum([
  'revenue',
  'cogs',
  'opex',
  'asset',
  'liability',
  'equity',
]);

export const PackCompiledAccountSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  packType: PackAccountTypeSchema,
  section: z.string().min(1),
  type: AccountTypeSchema,
  normalSide: NormalSideSchema,
  statementLineKey: StatementLineKeySchema,
  isControl: z.boolean(),
  isPostable: z.boolean(),
});

export type PackCompiledAccount = z.infer<typeof PackCompiledAccountSchema>;

export const PackDriverTemplateSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  unit: z.string().min(1),
  low: z.string().min(1),
  high: z.string().min(1),
  defaultMethod: z.string().min(1),
  links: z.array(z.string()),
});

export const PackKpiTemplateSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  unit: z.string().min(1),
  formula: z.string().min(1),
  targetValue: z.string().min(1),
  targetDirection: z.string().min(1),
  definition: z.string().min(1),
  goodThreshold: z.string().min(1),
  watchThreshold: z.string().min(1),
});

export const PackLayoutTemplateSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  rows: z.array(z.string()),
  columns: z.array(
    z.object({
      type: z.string().min(1),
      compare: z.string().optional(),
    }),
  ),
});

export const IndustryPackDetailSchema = z.object({
  key: IndustryPackKeySchema,
  name: z.string().min(2),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(10),
  defaultCalendar: PackCalendarKindSchema,
  defaultCurrencyHint: z.string().regex(/^[A-Z]{3}$/),
  localeHint: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/),
  dataOnly: z.literal(true),
  sha256ManifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  accounts: z.array(PackCompiledAccountSchema),
  drivers: z.array(PackDriverTemplateSchema),
  kpis: z.array(PackKpiTemplateSchema),
  layouts: z.array(PackLayoutTemplateSchema),
});

export type IndustryPackDetail = z.infer<typeof IndustryPackDetailSchema>;

export const IndustryPackCatalogResponseSchema = z.object({
  companyId: z.string().uuid(),
  packs: z.array(IndustryPackDetailSchema),
});

export type IndustryPackCatalogResponse = z.infer<typeof IndustryPackCatalogResponseSchema>;

export const ApplyIndustryPackResponseSchema = z.object({
  companyId: z.string().uuid(),
  packKey: IndustryPackKeySchema,
  packVersion: z.string().min(1),
  inserted: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  accounts: z.array(ChartAccountRowSchema),
});

export type ApplyIndustryPackResponse = z.infer<typeof ApplyIndustryPackResponseSchema>;
