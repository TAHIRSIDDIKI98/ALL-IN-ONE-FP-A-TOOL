import { describe, expect, it } from 'vitest';
import { CURRENCY_SCALES } from '../core/money/index.js';
import { CompanySetupRequestSchema, SUPPORTED_CURRENCY_CODES, SupportedCurrencySchema } from './setup.js';

describe('shared setup contracts (K3 single source of truth)', () => {
  it('ties the shared ISO-4217 list out against the kernel currency-scale table — no drift', () => {
    const kernelCodes = Object.keys(CURRENCY_SCALES).slice().sort();
    const sharedCodes = [...SUPPORTED_CURRENCY_CODES].slice().sort();
    expect(sharedCodes).toEqual(kernelCodes);
  });

  it('normalizes currency case and rejects codes without a locked display scale', () => {
    expect(SupportedCurrencySchema.parse(' usd ')).toBe('USD');
    expect(SupportedCurrencySchema.safeParse('ZZZ').success).toBe(false);
    expect(SupportedCurrencySchema.safeParse('US').success).toBe(false);
  });

  it('normalizes company/entity text, preserves leading-zero entity codes, and rejects blank names', () => {
    const parsed = CompanySetupRequestSchema.parse({
      companyName: '  Sample Co  ',
      baseCurrency: 'jpy',
      calendarKind: '12month',
      fiscalYear: 2026,
      entityCode: '  001200  ',
      entityName: 'HQ',
    });
    expect(parsed.companyName).toBe('Sample Co');
    expect(parsed.baseCurrency).toBe('JPY');
    expect(parsed.entityCode).toBe('001200');
    expect(parsed.yearCount).toBe(1);

    expect(
      CompanySetupRequestSchema.safeParse({
        companyName: '   ',
        baseCurrency: 'USD',
        calendarKind: '12month',
        fiscalYear: 2026,
        entityCode: 'ENT',
        entityName: 'HQ',
      }).success,
    ).toBe(false);
  });
});
