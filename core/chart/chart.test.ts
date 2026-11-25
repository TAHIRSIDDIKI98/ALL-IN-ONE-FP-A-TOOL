import { describe, expect, it } from 'vitest';
import { canonicalNormalSide, parseChartCsv } from './index.js';

const HEADER = 'code,name,type,normal_side,statement_line_key,parent_code,is_postable';

describe('chart-of-accounts CSV parser (§9.3.4, Spine Gate G1)', () => {
  it('parses a clean chart, preserving leading zeros, parents and quoted commas', () => {
    const csv = [
      HEADER,
      '1000,Cash,asset,debit,bs.asset.cash,,true',
      '001200,Operating bank,asset,debit,bs.asset.cash,1000,true',
      '1200,"Inventory, net",asset,debit,bs.asset.inventory,,true',
      '4000,Service revenue,revenue,credit,pl.revenue.service,,true',
      '9999,Header only,asset,debit,bs.asset.other_current,,false',
    ].join('\n');

    const result = parseChartCsv(csv);

    expect(result.issues).toEqual([]);
    expect(result.rowCount).toBe(5);
    expect(result.accounts.map((account) => account.code)).toEqual([
      '1000',
      '001200',
      '1200',
      '4000',
      '9999',
    ]);
    // Leading zeros are preserved: "001200" is a different account from "1200".
    expect(result.accounts[1]?.code).toBe('001200');
    expect(result.accounts[2]?.name).toBe('Inventory, net');
    expect(result.accounts[1]?.parentCode).toBe('1000');
    expect(result.accounts[4]?.isPostable).toBe(false);
    expect(canonicalNormalSide('revenue')).toBe('credit');
  });

  it('reports every rejected row with its row number and a stable reason, and rejects nothing silently', () => {
    const csv = [
      HEADER,
      '1000,Cash,asset,debit,bs.asset.cash,,true',
      ',No code,asset,debit,bs.asset.cash,,true',
      '2000,,liability,credit,bs.liability.ap,,true',
      '3000,Bad type,bank,credit,bs.equity.common_stock,,true',
      '3100,Bad side,equity,upside,bs.equity.common_stock,,true',
      '3200,Bad line,equity,credit,bs.equity.nope,,true',
      '3300,Self parent,equity,credit,bs.equity.common_stock,3300,true',
      '3400,Bad postable,equity,credit,bs.equity.common_stock,,maybe',
      '1000,Duplicate,asset,debit,bs.asset.cash,,true',
      ',,,,,,',
    ].join('\n');

    const result = parseChartCsv(csv);

    expect(result.accounts.map((account) => account.code)).toEqual(['1000']);
    const reasons = result.issues.map((issue) => `${issue.rowNo}:${issue.reason}`);
    expect(reasons).toEqual([
      '3:EMPTY_CODE',
      '4:EMPTY_NAME',
      '5:INVALID_TYPE:bank',
      '6:INVALID_NORMAL_SIDE:upside',
      '7:UNKNOWN_STATEMENT_LINE:bs.equity.nope',
      '8:SELF_PARENT:3300',
      '9:INVALID_IS_POSTABLE:maybe',
      '10:DUPLICATE_CODE:1000',
      '11:BLANK_ROW',
    ]);
    // Every data row is accounted for: 10 data rows, 1 accepted, 9 rejected with named reasons.
    expect(result.rowCount).toBe(10);
    expect(result.accounts.length + new Set(result.issues.map((issue) => issue.rowNo)).size).toBe(10);
  });

  it('rejects a file that is missing required columns, is empty, or is not a chart at all', () => {
    const missing = parseChartCsv('code,name,type\n1000,Cash,asset');
    expect(missing.issues.map((issue) => issue.reason)).toEqual([
      'MISSING_COLUMN:normal_side',
      'MISSING_COLUMN:statement_line_key',
    ]);
    expect(missing.accounts).toEqual([]);

    const empty = parseChartCsv('   \n');
    expect(empty.issues).toEqual([{ rowNo: 1, reason: 'EMPTY_FILE' }]);
    expect(empty.accounts).toEqual([]);

    const headerOnly = parseChartCsv(HEADER);
    expect(headerOnly.issues).toEqual([]);
    expect(headerOnly.accounts).toEqual([]);
    expect(headerOnly.rowCount).toBe(0);
  });

  it('accepts header aliases, CRLF line endings and a BOM without corrupting the first code', () => {
    const csv =
      '\uFEFFAccount Code,Account Name,Account Type,Normal Side,Statement Line,Parent,Postable\r\n' +
      '001200,Operating bank,asset,debit,bs.asset.cash,,\r\n' +
      '4000,Service revenue,revenue,credit,pl.revenue.service,,no\r\n';

    const result = parseChartCsv(csv);

    expect(result.issues).toEqual([]);
    expect(result.accounts).toEqual([
      {
        code: '001200',
        name: 'Operating bank',
        type: 'asset',
        normalSide: 'debit',
        parentCode: null,
        isPostable: true,
        statementLineKey: 'bs.asset.cash',
      },
      {
        code: '4000',
        name: 'Service revenue',
        type: 'revenue',
        normalSide: 'credit',
        parentCode: null,
        isPostable: false,
        statementLineKey: 'pl.revenue.service',
      },
    ]);
  });
});
