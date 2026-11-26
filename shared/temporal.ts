import { z } from 'zod';

/**
 * M2 Temporal & Timezone Contracts (MASTER_PROMPT §12.1, TMP1–TMP4).
 *
 * - `PeriodDateSchema`: pure calendar `YYYY-MM-DD` date string (period buckets, posting dates, effective dates).
 * - `UtcInstantSchema`: strict UTC ISO-8601 timestamp ending in `Z` (audit logs, sync cursors, cutoffs).
 * - `DisplayTimeZoneSchema`: valid IANA timezone identifier for UI/export presentation only; never shifts ledger dates.
 */

const PERIOD_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const UTC_INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?Z$/;

export function isValidPeriodDate(value: string): boolean {
  const match = PERIOD_DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ts = Date.UTC(year, month - 1, day);
  const dt = new Date(ts);
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

export function isValidUtcInstant(value: string): boolean {
  const match = UTC_INSTANT_RE.exec(value);
  if (!match) return false;
  const datePart = `${match[1]}-${match[2]}-${match[3]}`;
  if (!isValidPeriodDate(datePart)) return false;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) return false;
  return Number.isFinite(Date.parse(value));
}

export function isValidDisplayTimeZone(value: string): boolean {
  if (value.trim().length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const PeriodDateSchema = z
  .string()
  .refine(isValidPeriodDate, {
    message: 'Period date must be a valid calendar YYYY-MM-DD string with no time or offset.',
  })
  .brand<'period_date'>();
export type PeriodDate = z.infer<typeof PeriodDateSchema>;

export const UtcInstantSchema = z
  .string()
  .refine(isValidUtcInstant, {
    message: 'Instant must be a strict UTC ISO-8601 timestamp ending in Z (YYYY-MM-DDTHH:MM:SSZ).',
  })
  .brand<'utc_instant'>();
export type UtcInstant = z.infer<typeof UtcInstantSchema>;

export const DisplayTimeZoneSchema = z.string().refine(isValidDisplayTimeZone, {
  message: 'Display timezone must be a valid IANA timezone identifier (e.g. UTC, America/New_York).',
});
export type DisplayTimeZone = z.infer<typeof DisplayTimeZoneSchema>;
