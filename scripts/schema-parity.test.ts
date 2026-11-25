import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { diffSnapshots, type SchemaSnapshot } from './schema-parity.js';

const tempDirs: string[] = [];

function makeSnapshot(overrides: Partial<SchemaSnapshot> = {}): SchemaSnapshot {
  return {
    schemaVersion: '0001_test',
    migration: 'db/migrations/0001_test.sql',
    tableCount: 1,
    tables: ['account'],
    moneyColumns: [{ table: 'account', column: 'balance', type: 'NUMERIC(28,6)' }],
    deferredTriggers: [],
    immutabilityTriggers: [],
    columns: [
      { table: 'account', column: 'id', type: 'uuid', nullable: false, default: 'gen_random_uuid()' },
      { table: 'account', column: 'code', type: 'text', nullable: false, default: null },
    ],
    constraints: [
      { table: 'account', name: 'account_pkey', type: 'PRIMARY KEY', columns: ['id'], references: null },
    ],
    indexes: [{ table: 'account', name: 'account_pkey', unique: true, columns: ['id'] }],
    triggers: [],
    ...overrides,
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('WI-0014 schema parity & drift gate (D1, §3.4)', () => {
  it('reports equality for identical structures and names every class of drift', () => {
    const base = makeSnapshot();
    expect(diffSnapshots(base, base)).toEqual({ equal: true, differences: [] });

    const drifted = makeSnapshot({
      tables: ['account', 'employee'],
      columns: [
        { table: 'account', column: 'id', type: 'uuid', nullable: true, default: 'gen_random_uuid()' },
        { table: 'account', column: 'code', type: 'varchar', nullable: false, default: null },
        { table: 'employee', column: 'salary', type: 'numeric(28,6)', nullable: false, default: null },
      ],
      indexes: [],
      constraints: [],
    });

    const result = diffSnapshots(base, drifted);
    expect(result.equal).toBe(false);
    const joined = result.differences.join('\n');
    expect(joined).toContain('unexpected table employee');
    expect(joined).toContain('unexpected column employee.salary');
    expect(joined).toContain('column account.id nullability changed');
    expect(joined).toContain('column account.code type text -> varchar');
    expect(joined).toContain('missing constraint account::PRIMARY KEY::account_pkey');
    expect(joined).toContain('missing index account::account_pkey::unique::id');
    expect(result.differences.length).toBeGreaterThanOrEqual(5);
  });

  it('fails with exit code 1 when a migration is added without regenerating the snapshot', () => {
    const root = mkdtempSync(join(tmpdir(), 'onefpa-schema-parity-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'db', 'migrations'), { recursive: true });
    copyFileSync(
      join(process.cwd(), 'db', 'migrations', '0001_m1_spine.sql'),
      join(root, 'db', 'migrations', '0001_m1_spine.sql'),
    );
    copyFileSync(join(process.cwd(), 'db', 'schema.snapshot.json'), join(root, 'db', 'schema.snapshot.json'));
    writeFileSync(
      join(root, 'db', 'migrations', '0002_drift.sql'),
      'ALTER TABLE account ADD COLUMN unapproved_flag boolean NOT NULL DEFAULT false;\n',
    );

    const result = spawnSync('npx', ['tsx', join(process.cwd(), 'scripts', 'schema-parity.ts'), '--root', root], {
      encoding: 'utf8',
      env: { ...process.env, NEON_PARITY_DATABASE_URL: '' },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SCHEMA PARITY GATE FAILED');
    expect(result.stderr).toContain('unexpected column account.unapproved_flag');
    expect(result.stderr).toContain('--update');
  }, 60_000);
});
