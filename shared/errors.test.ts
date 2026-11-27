import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AppError,
  DisplayTimeZoneSchema,
  ERROR_CATALOG,
  ERROR_CODES,
  ErrorBodySchema,
  MoneyStringSchema,
  PeriodDateSchema,
  UtcInstantSchema,
  formatUtcInstantForDisplay,
} from './index.js';

describe('WI-0003 Typed Error Catalog & Shared Contracts (Port P12, §3.2, §5.2)', () => {
  it('defines non-empty user message, hint, and valid 4xx/5xx HTTP status for all 27 error codes', () => {
    expect(ERROR_CODES.length).toBe(27);
    for (const code of ERROR_CODES) {
      const err = new AppError(code, { details: { probe: 'ok' } });
      const parsed = ErrorBodySchema.parse(err.toBody());
      expect(parsed.code).toBe(code);
      expect(parsed.httpStatus).toBe(ERROR_CATALOG[code].httpStatus);
      expect(parsed.userMessage.length).toBeGreaterThan(10);
      expect(parsed.hint.length).toBeGreaterThan(10);
      expect(parsed.details['probe']).toBe('ok');
    }
  });

  it('rejects numeric money payloads and accepts canonical decimal strings (E11)', () => {
    expect(MoneyStringSchema.safeParse('1234.56').success).toBe(true);
    expect(MoneyStringSchema.safeParse('-0.005000').success).toBe(true);
    expect(MoneyStringSchema.safeParse(1234.56).success).toBe(false);
    expect(MoneyStringSchema.safeParse('$1,234.56').success).toBe(false);
  });

  it('contains zero `any` type keywords in /shared (§3.2)', () => {
    for (const f of ['errors.ts', 'index.ts', 'temporal.ts', 'guidance.ts']) {
      const text = readFileSync(join(process.cwd(), 'shared', f), 'utf8');
      expect(/:\s*any\b|<any>|as\s+any\b/.test(text)).toBe(false);
    }
  });

  it('enforces strict PeriodDate vs UtcInstant separation and display-only timezone formatting (WI-0043 TMP3, TMP4)', () => {
    expect(PeriodDateSchema.safeParse('2026-02-28').success).toBe(true);
    expect(PeriodDateSchema.safeParse('2026-02-29').success).toBe(false);
    expect(PeriodDateSchema.safeParse('2026-02-28T00:00:00Z').success).toBe(false);

    expect(UtcInstantSchema.safeParse('2026-11-26T00:00:00Z').success).toBe(true);
    expect(UtcInstantSchema.safeParse('2026-11-26T00:00:00.123Z').success).toBe(true);
    expect(UtcInstantSchema.safeParse('2026-11-26').success).toBe(false);
    expect(UtcInstantSchema.safeParse('2026-11-26T00:00:00+05:30').success).toBe(false);

    expect(DisplayTimeZoneSchema.safeParse('America/New_York').success).toBe(true);
    expect(DisplayTimeZoneSchema.safeParse('Mars/Olympus').success).toBe(false);

    const nyDisplay = formatUtcInstantForDisplay('2026-11-26T02:00:00Z', 'en-US', 'America/New_York');
    const tokyoDisplay = formatUtcInstantForDisplay('2026-11-26T02:00:00Z', 'en-US', 'Asia/Tokyo');
    expect(nyDisplay).toContain('Nov 25');
    expect(tokyoDisplay).toContain('Nov 26');
    expect(nyDisplay).not.toBe(tokyoDisplay);
  });
});

