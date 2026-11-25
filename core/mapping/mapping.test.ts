import { describe, expect, it } from 'vitest';
import {
  buildMappingReport,
  planMappingVersions,
  resolveSourceAccountCode,
  type MappingVersionRow,
} from './index.js';

const CHART = new Set(['1000', '001200', '4000']);

const MAPPINGS: readonly MappingVersionRow[] = [
  {
    sourceCode: 'BANK FEED:011',
    accountCode: '1000',
    mappingVersion: 1,
    effectiveFrom: '2026-01-01',
    status: 'mapped',
    quarantineReason: null,
  },
  {
    sourceCode: 'BANK FEED:011',
    accountCode: '001200',
    mappingVersion: 2,
    effectiveFrom: '2026-03-01',
    status: 'mapped',
    quarantineReason: null,
  },
  {
    sourceCode: 'SDK-9',
    accountCode: null,
    mappingVersion: 1,
    effectiveFrom: '2026-01-01',
    status: 'quarantined',
    quarantineReason: 'MANUAL_QUARANTINE',
  },
  {
    sourceCode: 'FUTURE',
    accountCode: '4000',
    mappingVersion: 7,
    effectiveFrom: '2027-01-01',
    status: 'mapped',
    quarantineReason: null,
  },
];

describe('WI-0028 versioned CoA mapping kernel (G1, K3)', () => {
  it('uses the newest effective version, ignores future versions, and names every quarantine', () => {
    expect(resolveSourceAccountCode({
      sourceCode: 'bank feed:011',
      mappings: MAPPINGS,
      chartCodes: CHART,
      asOfDate: '2026-02-28',
    })).toEqual({ kind: 'mapped', accountCode: '1000' });

    expect(resolveSourceAccountCode({
      sourceCode: 'BANK FEED:011',
      mappings: MAPPINGS,
      chartCodes: CHART,
      asOfDate: '2026-03-01',
    })).toEqual({ kind: 'mapped', accountCode: '001200' });

    expect(resolveSourceAccountCode({
      sourceCode: 'SDK-9',
      mappings: MAPPINGS,
      chartCodes: CHART,
      asOfDate: '2026-06-01',
    })).toEqual({ kind: 'quarantine', reason: 'QUARANTINED_BY_MAPPING:MANUAL_QUARANTINE' });

    expect(resolveSourceAccountCode({
      sourceCode: 'FUTURE',
      mappings: MAPPINGS,
      chartCodes: CHART,
      asOfDate: '2026-12-31',
    })).toEqual({ kind: 'quarantine', reason: 'UNMAPPED_ACCOUNT:FUTURE' });

    expect(resolveSourceAccountCode({
      sourceCode: '1200',
      mappings: MAPPINGS,
      chartCodes: CHART,
      asOfDate: '2026-06-01',
    })).toEqual({ kind: 'quarantine', reason: 'UNMAPPED_ACCOUNT:1200' });
  });

  it('plans monotonic versions, skips identical edits, and rejects a bad batch whole', () => {
    const base = {
      existing: MAPPINGS,
      effectiveFrom: '2026-06-01',
      knownAccountCodes: CHART,
      discoveredCodes: new Set(['BANK FEED:011', 'NEW-SOURCE', 'SDK-9']),
    };

    expect(planMappingVersions({
      ...base,
      edits: [
        { sourceCode: 'BANK FEED:011', status: 'mapped', accountCode: '1000', quarantineReason: null },
        { sourceCode: 'NEW-SOURCE', status: 'mapped', accountCode: '4000', quarantineReason: null },
        { sourceCode: 'SDK-9', status: 'quarantined', accountCode: null, quarantineReason: 'MANUAL_QUARANTINE' },
      ],
    })).toEqual({
      versions: [
        {
          sourceCode: 'BANK FEED:011',
          accountCode: '1000',
          mappingVersion: 3,
          effectiveFrom: '2026-06-01',
          status: 'mapped',
          quarantineReason: null,
        },
        {
          sourceCode: 'NEW-SOURCE',
          accountCode: '4000',
          mappingVersion: 1,
          effectiveFrom: '2026-06-01',
          status: 'mapped',
          quarantineReason: null,
        },
      ],
      issues: [],
    });

    // Re-submitting the current effective state writes nothing (idempotent commit).
    expect(planMappingVersions({
      ...base,
      edits: [
        { sourceCode: 'SDK-9', status: 'quarantined', accountCode: null, quarantineReason: 'MANUAL_QUARANTINE' },
      ],
    }).versions).toEqual([]);

    const rejected = planMappingVersions({
      ...base,
      edits: [
        { sourceCode: 'NEW-SOURCE', status: 'mapped', accountCode: '9999', quarantineReason: null },
        { sourceCode: 'NEW-SOURCE', status: 'mapped', accountCode: '4000', quarantineReason: null },
        { sourceCode: 'NOT-SEEN', status: 'mapped', accountCode: '4000', quarantineReason: null },
        { sourceCode: 'SDK-9', status: 'quarantined', accountCode: null, quarantineReason: null },
      ],
    });
    expect(rejected.versions).toEqual([]);
    expect(rejected.issues).toEqual([
      'row 1: UNKNOWN_ACCOUNT:9999',
      'row 2: DUPLICATE_SOURCE_CODE:NEW-SOURCE',
      'row 3: UNKNOWN_SOURCE_CODE:NOT-SEEN',
      'row 4: MISSING_QUARANTINE_REASON:SDK-9',
    ]);
  });

  it('reports discovered sources, targets, versions, conflicts and honest unmapped counts', () => {
    const report = buildMappingReport({
      companyId: '11111111-1111-4111-8111-111111111111',
      effectiveFrom: '2026-06-01',
      discovered: [
        { sourceCode: 'BANK FEED:011', rowCount: 4, sampleValues: ['fee', 'wire'] },
        { sourceCode: 'SDK-9', rowCount: 2, sampleValues: ['refund'] },
        { sourceCode: 'ZZZ', rowCount: 1, sampleValues: ['misc'] },
      ],
      mappings: MAPPINGS,
      accounts: [
        { code: '1000', name: 'Operating bank account' },
        { code: '001200', name: 'Savings account' },
        { code: '4000', name: 'Service revenue' },
      ],
    });

    expect(report.mappedCount).toBe(1);
    expect(report.quarantinedCount).toBe(1);
    expect(report.unmappedCount).toBe(1);
    expect(report.conflictCount).toBe(0);
    expect(report.mappings.map((entry) => [entry.sourceCode, entry.status, entry.accountCode, entry.mappingVersion])).toEqual([
      ['BANK FEED:011', 'mapped', '001200', 2],
      ['SDK-9', 'quarantined', null, 1],
      ['ZZZ', 'unmapped', null, 0],
    ]);
    expect(report.mappings[0]?.accountName).toBe('Savings account');
    expect(report.mappings[0]?.rowCount).toBe(4);
    expect(report.mappings[0]?.sampleValues).toEqual(['fee', 'wire']);
  });
});
