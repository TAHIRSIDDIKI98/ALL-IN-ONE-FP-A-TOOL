import { z } from 'zod';
import { CalendarKindSchema } from './spine.js';

/**
 * Canonical ISO-4217 codes with a locked display scale (MASTER_PROMPT §5.2, SPEC §3.1).
 * Kept as a literal here so `/shared` contracts stay free of kernel imports on the client
 * path; `shared/setup.test.ts` tie-outs this list against `/core/money` CURRENCY_SCALES so
 * the two can never drift (K3).
 */
export const SUPPORTED_CURRENCY_CODES = [
  'JPY',
  'KRW',
  'VND',
  'USD',
  'EUR',
  'GBP',
  'INR',
  'AUD',
  'CAD',
  'SGD',
  'CHF',
  'AED',
  'SAR',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'BRL',
  'MXN',
  'NZD',
  'HKD',
  'ZAR',
  'KWD',
  'BHD',
  'OMR',
  'JOD',
  'TND',
] as const;

export type SupportedCurrencyCode = (typeof SUPPORTED_CURRENCY_CODES)[number];

export const SupportedCurrencySchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine(
    (value) => (SUPPORTED_CURRENCY_CODES as readonly string[]).includes(value),
    'Currency must be an ISO-4217 code with a locked display scale (§5.2).',
  );

/**
 * Entity codes follow §4.2: trimmed, internal whitespace collapsed, leading zeros preserved,
 * never number-parsed.
 */
export const EntityCodeSchema = z
  .string()
  .transform((value) => value.trim().replace(/\s+/g, ' '))
  .refine((value) => value.length >= 1 && value.length <= 32, 'Entity code must be 1–32 characters.')
  .refine((value) => /^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(value), 'Entity code has unsupported characters.');

export const CompanySetupRequestSchema = z.object({
  companyName: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length >= 2 && value.length <= 120, 'Company name must be 2–120 characters.'),
  baseCurrency: SupportedCurrencySchema,
  calendarKind: CalendarKindSchema,
  fiscalYear: z.number().int().min(2000).max(2100),
  yearCount: z.number().int().min(1).max(5).default(1),
  startMonth: z.number().int().min(1).max(12).optional(),
  week53Rule: z.enum(['nrf4day', 'fullweek']).optional(),
  includeAdjustmentPeriod: z.boolean().optional(),
  entityCode: EntityCodeSchema,
  entityName: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length >= 1 && value.length <= 120, 'Entity name must be 1–120 characters.'),
});

export type CompanySetupRequest = z.infer<typeof CompanySetupRequestSchema>;

export const EntitySummarySchema = z.object({
  id: z.string().uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  currency: z.string().length(3),
});

export type EntitySummary = z.infer<typeof EntitySummarySchema>;

export const FiscalPeriodSummarySchema = z.object({
  id: z.string().uuid(),
  fiscalYear: z.number().int(),
  periodNo: z.number().int().min(1).max(14),
  code: z.string().min(1),
  label: z.string().min(1),
  quarter: z.number().int().min(1).max(4),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  is53rdWeek: z.boolean(),
  isAdjustment: z.boolean(),
});

export type FiscalPeriodSummary = z.infer<typeof FiscalPeriodSummarySchema>;

export const CompanyWorkspaceSchema = z.object({
  companyId: z.string().uuid(),
  companyName: z.string().min(1),
  baseCurrency: z.string().length(3),
  currencyScale: z.union([z.literal(0), z.literal(2), z.literal(3)]),
  calendarKind: CalendarKindSchema,
  fiscalCalendarId: z.string().uuid(),
  entities: z.array(EntitySummarySchema).min(1),
  periods: z.array(FiscalPeriodSummarySchema).min(1),
});

export type CompanyWorkspace = z.infer<typeof CompanyWorkspaceSchema>;
