import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateMessyGlCsv } from '../import/index.js';
import {
  normalizeConnectorPayload,
  normalizedEntriesToImportCsv,
  reconcileNormalizedBatch,
  type ConnectorSyncInput,
} from './index.js';

const FIXTURES_DIR = join(process.cwd(), 'fixtures', 'oracles', 'connectors');

interface ConnectorChecksums {
  readonly portClass: string;
  readonly files: Readonly<Record<string, string>>;
}

interface ConnectorsExpectedOracle {
  readonly adapters: Readonly<
    Record<
      'google_sheets' | 'quickbooks_online' | 'xero',
      {
        readonly entryCount: number;
        readonly lineCount: number;
        readonly totalDebits: string;
        readonly totalCredits: string;
        readonly reconciliationStatus: 'matched';
        readonly leadingZeroAccountPreserved?: string;
        readonly entries: readonly {
          readonly entry_ref: string;
          readonly entry_date: string;
          readonly period: string;
          readonly currency: string;
          readonly lineCount: number;
        }[];
      }
    >
  >;
  readonly mismatchCase: {
    readonly reconciliationStatus: 'mismatch_quarantined';
    readonly totalDebits: string;
    readonly totalCredits: string;
    readonly lineCount: number;
    readonly expectedReasons: readonly string[];
  };
}

function readFixtureJson<T>(filename: string): T {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, filename), 'utf8')) as T;
}

describe('Connectors & Integration Normalization Kernel (§11.1, CON1, CON3, CON5, WI-0040)', () => {
  it('verifies Class A SHA-256 checksums across all connector fixtures and expected oracles', () => {
    const manifest = readFixtureJson<ConnectorChecksums>('CHECKSUMS.json');
    expect(manifest.portClass).toBe('A');
    const entries = Object.entries(manifest.files);
    expect(entries.length).toBe(5);

    for (const [filename, expectedSha] of entries) {
      const actualSha = createHash('sha256')
        .update(readFileSync(join(FIXTURES_DIR, filename)))
        .digest('hex');
      expect(actualSha, `Checksum mismatch on ${filename}`).toBe(expectedSha);
    }
  });

  it('CON1 & CON5: normalizes Google Sheets, QBO, and Xero fixtures into one canonical shape matching independent oracles', () => {
    const oracle = readFixtureJson<ConnectorsExpectedOracle>('connectors_expected.json');
    const fixtureByAdapter: Record<'google_sheets' | 'quickbooks_online' | 'xero', string> = {
      google_sheets: 'google_sheets_gl.json',
      quickbooks_online: 'quickbooks_online_je.json',
      xero: 'xero_manual_journals.json',
    };
    const knownCodes = new Set(['001200', '1100', '2000', '4000', '5000', '6000']);

    for (const adapter of ['google_sheets', 'quickbooks_online', 'xero'] as const) {
      const raw = readFixtureJson<ConnectorSyncInput>(fixtureByAdapter[adapter]);
      const expected = oracle.adapters[adapter];

      const batch = normalizeConnectorPayload({ payload: raw, baseCurrency: 'USD' });
      expect(batch.sourceSystem).toBe(adapter);
      expect(batch.entries.length).toBe(expected.entryCount);
      expect(batch.lineCount).toBe(expected.lineCount);
      expect(batch.totalDebits).toBe(expected.totalDebits);
      expect(batch.totalCredits).toBe(expected.totalCredits);
      expect(batch.batchHash).toMatch(/^[0-9a-f]{64}$/);

      for (let i = 0; i < expected.entries.length; i += 1) {
        const actualEntry = batch.entries[i]!;
        const expectedEntry = expected.entries[i]!;
        expect(actualEntry.source_system).toBe(adapter);
        expect(actualEntry.entry_ref).toBe(expectedEntry.entry_ref);
        expect(actualEntry.entry_date).toBe(expectedEntry.entry_date);
        expect(actualEntry.period).toBe(expectedEntry.period);
        expect(actualEntry.currency).toBe(expectedEntry.currency);
        expect(actualEntry.lines.length).toBe(expectedEntry.lineCount);
        expect(actualEntry.source_row_hash).toMatch(/^[0-9a-f]{64}$/);
      }

      if (expected.leadingZeroAccountPreserved) {
        const allCodes = batch.entries.flatMap((e) => e.lines.map((l) => l.account_code));
        expect(allCodes).toContain(expected.leadingZeroAccountPreserved);
      }

      const reconciliation = reconcileNormalizedBatch({ batch, expectedCurrency: 'USD' });
      expect(reconciliation.status).toBe(expected.reconciliationStatus);
      expect(reconciliation.reasons).toEqual([]);

      // Projection feeds directly into the ONE canonical GL CSV classifier (CON1)
      const csvText = normalizedEntriesToImportCsv(batch.entries);
      const parsed = evaluateMessyGlCsv({ csvText, knownAccountCodes: knownCodes });
      expect(parsed.rowsIn).toBe(expected.lineCount);
      expect(parsed.imported.length).toBe(expected.lineCount);
      expect(parsed.quarantined).toEqual([]);
      expect(parsed.totalDebits.toFixed(2)).toBe(expected.totalDebits);
      expect(parsed.totalCredits.toFixed(2)).toBe(expected.totalCredits);
    }
  });

  it('CON3: quarantines row-count mismatches, debit/credit imbalances, and currency mismatches without posting', () => {
    const oracle = readFixtureJson<ConnectorsExpectedOracle>('connectors_expected.json');
    const mismatchPayload = readFixtureJson<ConnectorSyncInput>('reconciliation_mismatch_je.json');

    const batch = normalizeConnectorPayload({ payload: mismatchPayload, baseCurrency: 'USD' });
    const rec = reconcileNormalizedBatch({ batch, expectedCurrency: 'USD' });

    expect(rec.status).toBe(oracle.mismatchCase.reconciliationStatus);
    expect(rec.totalDebits).toBe(oracle.mismatchCase.totalDebits);
    expect(rec.totalCredits).toBe(oracle.mismatchCase.totalCredits);
    expect(rec.lineCount).toBe(oracle.mismatchCase.lineCount);
    expect(rec.reasons).toEqual(oracle.mismatchCase.expectedReasons);

    const eurRec = reconcileNormalizedBatch({
      batch: normalizeConnectorPayload({
        payload: readFixtureJson<ConnectorSyncInput>('google_sheets_gl.json'),
        baseCurrency: 'USD',
      }),
      expectedCurrency: 'EUR',
    });
    expect(eurRec.status).toBe('mismatch_quarantined');
    expect(eurRec.reasons).toContain('CURRENCY_MISMATCH:expected=EUR:got=USD');

    // Ambiguous slash date (04/05/2026) is never guessed silently
    expect(() =>
      normalizeConnectorPayload({
        payload: {
          sourceSystem: 'google_sheets',
          rows: [
            {
              entryRef: 'GS-AMB-1',
              date: '04/05/2026',
              accountCode: '001200',
              debit: '100.00',
            },
          ],
        },
        baseCurrency: 'USD',
      }),
    ).toThrow(/AMBIGUOUS_DATE/);
  });
});
