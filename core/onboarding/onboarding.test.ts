import { describe, expect, it } from 'vitest';
import { generateFiscalYears } from '../calendar/index.js';
import {
  analyzeOnboardingValidation,
  buildSyntheticPartnerDataset,
  computeRehearsalFingerprint,
  extractSourceCodesFromCsv,
  suggestCoaMappings,
  type OnboardingChartAccountInput,
} from './index.js';

const SAMPLE_CHART: readonly OnboardingChartAccountInput[] = [
  {
    code: '1000',
    name: 'Operating bank account',
    type: 'asset',
    statementLineKey: 'bs.asset.cash',
    active: true,
    isPostable: true,
  },
  {
    code: '1100',
    name: 'Accounts receivable',
    type: 'asset',
    statementLineKey: 'bs.asset.ar',
    active: true,
    isPostable: true,
  },
  {
    code: '001400',
    name: 'Cash Reserve Account',
    type: 'asset',
    statementLineKey: 'bs.asset.cash',
    active: true,
    isPostable: true,
  },
  {
    code: '1400',
    name: 'Prepaid Software & Insurance',
    type: 'asset',
    statementLineKey: 'bs.asset.other_current',
    active: true,
    isPostable: true,
  },
  {
    code: '4000',
    name: 'Subscription Revenue',
    type: 'revenue',
    statementLineKey: 'pl.revenue.product',
    active: true,
    isPostable: true,
  },
  {
    code: '6000',
    name: 'Payroll expense',
    type: 'expense',
    statementLineKey: 'pl.opex.payroll',
    active: true,
    isPostable: true,
  },
];

describe('Pure M2 Customer Onboarding & Migration Validation Kernel (§11.12, ONB1–ONB3)', () => {
  it('extracts discovered source codes accurately without counting blank or TOTAL summary rows', () => {
    const partner = buildSyntheticPartnerDataset();
    const sources = extractSourceCodesFromCsv(partner.csvText);
    expect(sources.map((s) => s.sourceCode)).toEqual([
      'CUST-AR',
      'OPS-CASH',
      'SAAS-REV',
      'SAL-PAYROLL',
    ]);
    expect(sources.find((s) => s.sourceCode === 'OPS-CASH')?.rowCount).toBe(3);
  });

  it('deterministically suggests CoA targets, preserves leading-zero ambiguity safely, and requires human approval', () => {
    const suggestions = suggestCoaMappings({
      sources: [
        { sourceCode: '1000', rowCount: 2, sampleValues: ['Wire receipt'] },
        { sourceCode: '001100', rowCount: 1, sampleValues: ['Customer invoice'] },
        { sourceCode: '01400', rowCount: 1, sampleValues: ['Reserve or prepaid'] },
        { sourceCode: 'SAAS-REV', rowCount: 2, sampleValues: ['Annual platform contract'] },
        { sourceCode: 'SAL-PAYROLL', rowCount: 1, sampleValues: ['Monthly salaries'] },
        { sourceCode: 'ZZZ-MYSTERY', rowCount: 1, sampleValues: ['Miscellaneous ref'] },
      ],
      accounts: SAMPLE_CHART,
      existingMappings: [],
      asOfDate: '2026-11-26',
    });

    const byCode = new Map(suggestions.map((s) => [s.sourceCode, s]));

    expect(byCode.get('1000')?.matchRule).toBe('exact_code');
    expect(byCode.get('1000')?.suggestedAccountCode).toBe('1000');
    expect(byCode.get('1000')?.requiresHumanApproval).toBe(true);

    // Unique leading-zero numeric target resolves cleanly to '1100'
    expect(byCode.get('001100')?.matchRule).toBe('leading_zero_alias');
    expect(byCode.get('001100')?.suggestedAccountCode).toBe('1100');

    // Ambiguous leading-zero collision between '001400' and '1400' NEVER guesses automatically
    expect(byCode.get('01400')?.matchRule).toBe('ambiguous_leading_zero');
    expect(byCode.get('01400')?.suggestedAccountCode).toBeNull();

    // Token-based deterministic matching
    expect(byCode.get('SAAS-REV')?.matchRule).toBe('token_name_match');
    expect(byCode.get('SAAS-REV')?.suggestedAccountCode).toBe('4000');
    expect(byCode.get('SAL-PAYROLL')?.matchRule).toBe('token_name_match');
    expect(byCode.get('SAL-PAYROLL')?.suggestedAccountCode).toBe('6000');

    expect(byCode.get('ZZZ-MYSTERY')?.matchRule).toBe('unmatched');
    expect(byCode.get('ZZZ-MYSTERY')?.suggestedAccountCode).toBeNull();
  });

  it('analyzes exact row accounting, interior period gaps, leading-zero collisions, and Decimal outliers', () => {
    const years = generateFiscalYears({ kind: '12month', startYear: 2026, yearCount: 1 });
    const periods = years[0]!.periods;

    const result = analyzeOnboardingValidation({
      rowsIn: 8,
      importedRows: [
        {
          rowNo: 2,
          entryRef: 'JE-1',
          postingDate: '2026-01-15',
          accountCode: '1000',
          description: 'Opening cash',
          periodCode: 'P01',
          debit: '1000.00',
          credit: '0.00',
        },
        {
          rowNo: 3,
          entryRef: 'JE-1',
          postingDate: '2026-01-15',
          accountCode: '4000',
          description: 'Revenue',
          periodCode: 'P01',
          debit: '0.00',
          credit: '1000.00',
        },
        {
          rowNo: 4,
          entryRef: 'JE-2',
          postingDate: '2026-03-10',
          accountCode: '001400',
          description: 'Reserve surge',
          periodCode: 'P03',
          debit: '50000.00',
          credit: '0.00',
        },
        {
          rowNo: 5,
          entryRef: 'JE-2',
          postingDate: '2026-03-10',
          accountCode: '4000',
          description: 'Big deal',
          periodCode: 'P03',
          debit: '0.00',
          credit: '50000.00',
        },
      ],
      quarantined: [
        { rowNo: 6, reason: 'BLANK_ROW' },
        { rowNo: 7, reason: 'SUMMARY_TOTAL_ROW' },
        { rowNo: 8, reason: 'UNMAPPED_ACCOUNT:OLD-EXP' },
        { rowNo: 9, reason: 'UNBALANCED_ENTRY:JE-BAD' },
      ],
      duplicatesDetected: 0,
      entryCount: 2,
      totalDebits: '51000.00',
      totalCredits: '51000.00',
      currencyScale: 2,
      calendarPeriods: periods,
      accounts: SAMPLE_CHART,
      suggestions: [],
    });

    expect(result.rowAccountingTies).toBe(true);
    expect(result.importableCount + result.quarantinedCount).toBe(result.rowsIn);
    expect(result.coveredPeriods).toEqual(['FY2026 P01', 'FY2026 P03']);
    expect(result.missingInteriorPeriods).toEqual(['FY2026 P02']);
    expect(result.leadingZeroCollisions).toEqual(['001400 vs 1400']);
    expect(result.goLiveStatus).toBe('blocked');
    expect(result.anomalies.some((a) => a.kind === 'outlier_amount' && a.detail.includes('Potential exception — review'))).toBe(true);
    expect(result.anomalies.some((a) => a.kind === 'calendar_gap' && a.detail.includes('FY2026 P02'))).toBe(true);
  });

  it('produces identical rehearsal fingerprints for identical inputs regardless of timing (ONB3)', () => {
    const base = {
      companyId: '11111111-1111-4111-8111-111111111111',
      sourceHash: 'a'.repeat(64),
      goLiveStatus: 'ready_with_warnings',
      rowsIn: 10,
      importableCount: 8,
      quarantinedCount: 2,
      totalDebits: '58000.00',
      totalCredits: '58000.00',
      trialBalanceTotalDebit: '58000.00',
      trialBalanceTotalCredit: '58000.00',
      importedLines: [
        {
          rowNo: 2,
          entryRef: 'PRT-101',
          postingDate: '2026-01-15',
          accountCode: '1000',
          debit: '25000.00',
          credit: '0.00',
        },
      ],
    };
    const h1 = computeRehearsalFingerprint(base);
    const h2 = computeRehearsalFingerprint(base);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});
