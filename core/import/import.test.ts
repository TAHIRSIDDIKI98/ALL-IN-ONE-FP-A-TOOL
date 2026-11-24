import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serialize } from '../money/index.js';
import { evaluateMessyGlCsv, parseCsvRecords, parseStrictDate } from './index.js';

interface MessyManifest {
  readonly rows_in: number;
  readonly imported: number;
  readonly quarantined: ReadonlyArray<{ readonly row_no: number; readonly reason: string }>;
  readonly duplicates_detected: number;
  readonly tb_debits: string;
  readonly tb_credits: string;
  readonly locale: 'unknown' | 'us' | 'eu';
}

describe('Core Import & Messy CSV Parser (§5.2, §7.6, C6)', () => {
  it('strips UTF-8 BOM, handles RFC-4180 quotes/newlines, and auto-detects delimiters', () => {
    const bomCsv = '\uFEFFentry_ref,date,account_code,description,debit,credit\n"JE-1",2026-01-10,001200,"Note, ""quoted""",100.00,\n';
    const parsed = parseCsvRecords(bomCsv);
    expect(parsed.delimiter).toBe(',');
    expect(parsed.headers).toEqual(['entry_ref', 'date', 'account_code', 'description', 'debit', 'credit']);
    expect(parsed.rows.length).toBe(1);
    expect(parsed.rows[0]!.cells[2]).toBe('001200');
    expect(parsed.rows[0]!.cells[3]).toBe('Note, "quoted"');

    const semi = parseCsvRecords('a;b;c\n1;2;3\n');
    expect(semi.delimiter).toBe(';');
    expect(semi.rows[0]!.cells).toEqual(['1', '2', '3']);
  });

  it('distinguishes ISO and unambiguous slash dates while quarantining ambiguous dates', () => {
    expect(parseStrictDate('2026-01-15')).toEqual({ kind: 'valid', isoDate: '2026-01-15' });
    expect(parseStrictDate('25/01/2026')).toEqual({ kind: 'valid', isoDate: '2026-01-25' });
    expect(parseStrictDate('01/25/2026')).toEqual({ kind: 'valid', isoDate: '2026-01-25' });
    expect(parseStrictDate('03/04/2026').kind).toBe('quarantine');
    expect(parseStrictDate('2026-13-01').kind).toBe('quarantine');
    expect(parseStrictDate('').kind).toBe('quarantine');
  });

  it('satisfies exact imported + quarantined == rows_in on committed messy-export fixtures', () => {
    const knownCodes = new Set(['1000', '001200', '2000', '4000', '6000', '6100', '6200']);

    for (const fixtureName of ['erp_mixed_gl', 'semicolon_eu_gl']) {
      const csvText = readFileSync(join(process.cwd(), 'fixtures/messy-exports', `${fixtureName}.csv`), 'utf8');
      const manifest = JSON.parse(
        readFileSync(join(process.cwd(), 'fixtures/messy-exports', `${fixtureName}.manifest.json`), 'utf8'),
      ) as MessyManifest;

      const res = evaluateMessyGlCsv({
        csvText,
        knownAccountCodes: knownCodes,
        locale: manifest.locale,
      });

      expect(res.rowsIn).toBe(manifest.rows_in);
      expect(res.imported.length).toBe(manifest.imported);
      expect(res.quarantined.length).toBe(manifest.quarantined.length);
      expect(res.imported.length + res.quarantined.length).toBe(manifest.rows_in);
      expect(res.quarantined.map((q) => ({ row_no: q.rowNo, reason: q.reason }))).toEqual(manifest.quarantined);
      expect(res.duplicatesDetected).toBe(manifest.duplicates_detected);
      expect(serialize(res.totalDebits, 2)).toBe(manifest.tb_debits);
      expect(serialize(res.totalCredits, 2)).toBe(manifest.tb_credits);
    }
  });
});
