import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STATEMENT_LINE_MAP } from '../statements/index.js';
import {
  compilePackToChartAccounts,
  validateIndustryPackBundle,
  type RawPackBundle,
} from './index.js';

const PACKS_DIR = join(process.cwd(), 'fixtures', 'packs');

interface PackChecksumsManifest {
  readonly source: string;
  readonly commit: string;
  readonly portClass: string;
  readonly files: Readonly<Record<string, string>>;
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(PACKS_DIR, relativePath), 'utf8')) as T;
}

function loadRawBundle(packKey: 'saas' | 'retail' | 'manufacturing'): RawPackBundle {
  return {
    manifest: readJson(`${packKey}/pack.json`),
    coa: readJson(`${packKey}/coa.json`),
    drivers: readJson(`${packKey}/drivers.json`),
    kpis: readJson(`${packKey}/kpis.json`),
    layouts: readJson(`${packKey}/layouts.json`),
    glTemplate: readJson(`${packKey}/gl_template.json`),
    rollup: readJson(`${packKey}/rollup.json`),
  };
}

describe('Data-Only Industry Packs Kernel (§2.4, §6.6, WI-0039)', () => {
  it('verifies Class A byte-for-byte SHA-256 checksums for schema and first 3 M2 packs', () => {
    const manifest = readJson<PackChecksumsManifest>('CHECKSUMS.json');
    expect(manifest.portClass).toBe('A');
    const entries = Object.entries(manifest.files);
    expect(entries.length).toBe(22);

    for (const [relPath, expectedSha] of entries) {
      const bytes = readFileSync(join(PACKS_DIR, relPath));
      const actualSha = createHash('sha256').update(bytes).digest('hex');
      expect(actualSha, `Checksum mismatch on ${relPath}`).toBe(expectedSha);
    }
  });

  it('validates and compiles saas, retail, and manufacturing packs onto canonical STATEMENT_LINE_MAP rows', () => {
    const expectedCounts: Record<'saas' | 'retail' | 'manufacturing', number> = {
      saas: 7,
      retail: 7,
      manufacturing: 8,
    };

    for (const packKey of ['saas', 'retail', 'manufacturing'] as const) {
      const validation = validateIndustryPackBundle(loadRawBundle(packKey));
      expect(validation.ok).toBe(true);
      if (!validation.ok) continue;

      expect(validation.pack.key).toBe(packKey);
      expect(validation.pack.dataOnly).toBe(true);
      expect(validation.pack.drivers.length).toBe(3);
      expect(validation.pack.kpis.length).toBe(4);
      expect(validation.pack.layouts.length).toBe(1);

      const compiled = compilePackToChartAccounts(validation.pack);
      expect(compiled.length).toBe(expectedCounts[packKey]);
      for (const account of compiled) {
        expect(STATEMENT_LINE_MAP.has(account.statementLineKey)).toBe(true);
        expect(account.isPostable).toBe(true);
        if (account.type === 'asset' || account.type === 'expense') {
          expect(account.normalSide).toBe('debit');
        } else {
          expect(account.normalSide).toBe('credit');
        }
      }
    }

    const saas = validateIndustryPackBundle(loadRawBundle('saas'));
    expect(saas.ok).toBe(true);
    if (saas.ok) {
      const compiledSaas = compilePackToChartAccounts(saas.pack);
      expect(compiledSaas.find((a) => a.code === '4000')?.statementLineKey).toBe('pl.revenue.product');
      expect(compiledSaas.find((a) => a.code === '4100')?.statementLineKey).toBe('pl.revenue.service');
      expect(compiledSaas.find((a) => a.code === '5000')?.statementLineKey).toBe('pl.opex.rd');
      expect(compiledSaas.find((a) => a.code === '5100')?.statementLineKey).toBe('pl.opex.sm');
      expect(compiledSaas.find((a) => a.code === '5300')?.statementLineKey).toBe('pl.opex.ga');
      expect(compiledSaas.find((a) => a.code === '1200')?.statementLineKey).toBe('bs.asset.ar');
      expect(compiledSaas.find((a) => a.code === '2300')?.statementLineKey).toBe('bs.liability.deferred_rev');
    }

    const retail = validateIndustryPackBundle(loadRawBundle('retail'));
    expect(retail.ok).toBe(true);
    if (retail.ok) {
      const compiledRetail = compilePackToChartAccounts(retail.pack);
      expect(compiledRetail.find((a) => a.code === '4100')?.statementLineKey).toBe('pl.cogs.direct');
      expect(compiledRetail.find((a) => a.code === '4300')?.statementLineKey).toBe('pl.cogs.other');
      expect(compiledRetail.find((a) => a.code === '1300')?.statementLineKey).toBe('bs.asset.inventory');
    }
  });

  it('rejects malformed packs, duplicate CoA codes, and executable seed_sql payloads', () => {
    const base = loadRawBundle('saas');
    const withSeedSql: RawPackBundle = {
      ...base,
      manifest: {
        ...(base.manifest as Record<string, unknown>),
        seed_sql: 'DELETE FROM account;',
      },
    };
    const sqlRes = validateIndustryPackBundle(withSeedSql);
    expect(sqlRes.ok).toBe(false);
    if (!sqlRes.ok) {
      expect(sqlRes.issues).toContain('PACK_EXECUTABLE_DISALLOWED:manifest.seed_sql');
    }

    const badSchema: RawPackBundle = {
      ...base,
      manifest: {
        ...(base.manifest as Record<string, unknown>),
        schema_version: '2.0.0',
        extra_field: 'disallowed',
      },
      coa: {
        accounts: [
          { code: '001200', name: 'Cash One', type: 'asset', section: 'Current Assets', dimensions: [], is_control: false },
          { code: '001200', name: 'Cash Dup', type: 'asset', section: 'Current Assets', dimensions: [], is_control: false },
        ],
      },
    };
    const schemaRes = validateIndustryPackBundle(badSchema);
    expect(schemaRes.ok).toBe(false);
    if (!schemaRes.ok) {
      expect(schemaRes.issues).toContain('PACK_SCHEMA_INVALID:manifest.schema_version');
      expect(schemaRes.issues).toContain('PACK_SCHEMA_INVALID:manifest.extra_field');
      expect(schemaRes.issues).toContain('PACK_DUPLICATE_ACCOUNT_CODE:001200');
    }
  });
});
