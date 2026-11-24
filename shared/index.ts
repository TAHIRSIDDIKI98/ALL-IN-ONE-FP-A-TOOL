import { z } from 'zod';
import { ErrorBodySchema } from './errors.js';

/**
 * Canonical decimal string wire contract (MASTER_PROMPT §5.2 E11):
 * Money crosses every API/JSON boundary strictly as a string, never a JS number.
 */
export const MoneyStringSchema = z
  .string()
  .regex(/^-?\d+(?:\.\d{1,6})?$/, 'Money must be serialized as a canonical decimal string');

export type MoneyString = z.infer<typeof MoneyStringSchema>;

export const AccountTypeSchema = z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']);
export type AccountType = z.infer<typeof AccountTypeSchema>;

export const NormalSideSchema = z.enum(['debit', 'credit']);
export type NormalSide = z.infer<typeof NormalSideSchema>;

export const StatementKindSchema = z.enum(['pl', 'bs', 'cf']);
export type StatementKind = z.infer<typeof StatementKindSchema>;

export const CalendarKindSchema = z.enum(['12month', '445', '454', '544', '52_53', '13x4']);
export type CalendarKind = z.infer<typeof CalendarKindSchema>;

export const ScreenStateSchema = z.enum(['loading', 'empty', 'error', 'partial', 'populated']);
export type ScreenState = z.infer<typeof ScreenStateSchema>;

export const ApiErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: ErrorBodySchema,
});

export function makeSuccessEnvelopeSchema<T extends z.ZodType>(dataSchema: T) {
  return z.object({
    ok: z.literal(true),
    data: dataSchema,
  });
}

export * from './errors.js';
export * from './spine.js';
