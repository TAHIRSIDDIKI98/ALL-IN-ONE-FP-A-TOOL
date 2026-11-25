import { describe, expect, it } from 'vitest';
import { normalizePeriodCode, parseBudgetCsv, sumBudgetAmounts } from './index.js';

describe('budget CSV parser (§5.7, Spine Gate G4)', () => {
  it('parses a clean budget, preserving leading zeros and canonicalizing period codes', () => {
    const result = parseBudgetCsv(
      [
        'account_code,period,amount',
        '4000,P01,12500.00',
        '001200,p2,"4,200.50"',
        '5000,03,(75.25)',
        '6000,P12,0',
      ].join('\n'),
    );

    expect(result.issues).toEqual([]);
    expect(result.rowCount).toBe(4);
    expect(result.lines).toEqual([
      { rowNo: 2, accountCode: '4000', periodCode: 'P01', amount: '12500.000000' },
      { rowNo: 3, accountCode: '001200', periodCode: 'P02', amount: '4200.500000' },
      { rowNo: 4, accountCode: '5000', periodCode: 'P03', amount: '-75.250000' },
      { rowNo: 5, accountCode: '6000', periodCode: 'P12', amount: '0.000000' },
    ]);
  });

  it('accepts header aliases, a BOM and CRLF line endings', () => {
    const result = parseBudgetCsv('\uFEFFCode;Month;Budget\r\n4000;1;100\r\n4000;2;200\r\n');
    expect(result.issues).toEqual([]);
    expect(result.lines.map((line) => `${line.accountCode}/${line.periodCode}/${line.amount}`)).toEqual([
      '4000/P01/100.000000',
      '4000/P02/200.000000',
    ]);
  });

  it('rejects the whole file when a required column is missing, is empty, or is blank', () => {
    expect(parseBudgetCsv('   \n  ').issues).toEqual([{ rowNo: 1, reason: 'EMPTY_FILE' }]);
    expect(parseBudgetCsv('account_code,period\n4000,P01\n').issues).toEqual([
      { rowNo: 1, reason: 'MISSING_COLUMN:amount' },
    ]);
    expect(parseBudgetCsv('account_code,period,amount\n,,\n').issues).toEqual([
      { rowNo: 2, reason: 'BLANK_ROW' },
    ]);
  });

  it('reports every rejected row with its row number and a stable reason, never silently', () => {
    const result = parseBudgetCsv(
      [
        'account_code,period,amount',
        '4000,P01,100',
        '4000,P01,100',
        ',P02,100',
        '4000,P00,100',
        '4000,P13,100',
        '4000,P02,',
        '4000,P02,4x2',
        '4000,P02,250',
        '4000,P03,100',
      ].join('\n'),
    );

    expect(result.lines.map((line) => `${line.accountCode}/${line.periodCode}`)).toEqual([
      '4000/P01',
      '4000/P13',
      '4000/P02',
      '4000/P03',
    ]);
    expect(result.issues).toEqual([
      { rowNo: 3, reason: 'DUPLICATE_LINE:4000/P01' },
      { rowNo: 4, reason: 'EMPTY_ACCOUNT_CODE' },
      { rowNo: 5, reason: 'INVALID_PERIOD:P00' },
      { rowNo: 7, reason: 'NULL_AMOUNT' },
      { rowNo: 8, reason: 'AMOUNT_INVALID_CHARACTERS' },
    ]);
  });

  it('normalizes only real period codes and refuses to guess the rest', () => {
    expect(normalizePeriodCode('P01')).toBe('P01');
    expect(normalizePeriodCode('p1')).toBe('P01');
    expect(normalizePeriodCode(' 12 ')).toBe('P12');
    expect(normalizePeriodCode('P13')).toBe('P13');
    expect(normalizePeriodCode('P00')).toBeNull();
    expect(normalizePeriodCode('P14')).toBeNull();
    expect(normalizePeriodCode('2026-01')).toBeNull();
    expect(normalizePeriodCode('')).toBeNull();
  });

  it('sums plan amounts with exact Decimal arithmetic at the storage scale', () => {
    expect(sumBudgetAmounts(['0.100000', '0.200000'])).toBe('0.300000');
    expect(sumBudgetAmounts([])).toBe('0.000000');
    expect(sumBudgetAmounts(['-75.250000', '75.250000'])).toBe('0.000000');
  });
});
