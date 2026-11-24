import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AppError,
  ERROR_CATALOG,
  ERROR_CODES,
  ErrorBodySchema,
  MoneyStringSchema,
} from './index.js';

describe('WI-0003 Typed Error Catalog & Shared Contracts (Port P12, §3.2, §5.2)', () => {
  it('defines non-empty user message, hint, and valid 4xx/5xx HTTP status for all 26 error codes', () => {
    expect(ERROR_CODES.length).toBe(26);
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
    for (const f of ['errors.ts', 'index.ts']) {
      const text = readFileSync(join(process.cwd(), 'shared', f), 'utf8');
      expect(/:\s*any\b|<any>|as\s+any\b/.test(text)).toBe(false);
    }
  });
});
