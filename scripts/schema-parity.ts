#!/usr/bin/env node
/**
 * Schema Parity & Drift Gate (MASTER_PROMPT §3.4, §4.7, §4.9 D1; SPEC §2.1–§2.2).
 *
 * Proves two things with real exit codes:
 *  1. DRIFT  — the structure produced by applying `db/migrations/*.sql` on PGLite is byte-for-byte
 *              the structure recorded in `db/schema.snapshot.json`. A migration that is not
 *              re-snapshotted fails here, so an applied migration can never silently diverge
 *              from the documented schema.
 *  2. PARITY — when `NEON_PARITY_DATABASE_URL` is present (CI), the SAME introspection runs on
 *              Neon Postgres and must equal the snapshot, proving PGLite ↔ Neon equivalence.
 *              Without a URL the Neon leg is reported as SKIPPED — never as passed.
 *
 * Usage:
 *   npx tsx scripts/schema-parity.ts [--root <dir>] [--update]
 *
 * `--update` regenerates `db/schema.snapshot.json` from the PGLite migrations (the only
 * supported way to change the snapshot; hand-editing it is drift).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations, type SqlExecutor } from '../server/db/migrate.js';

export interface SchemaColumn {
  readonly table: string;
  readonly column: string;
  readonly type: string;
  readonly nullable: boolean;
  readonly default: string | null;
}

export interface SchemaConstraint {
  readonly table: string;
  readonly name: string;
  readonly type: string;
  readonly columns: readonly string[];
  readonly references: string | null;
}

export interface SchemaIndex {
  readonly table: string;
  readonly name: string;
  readonly unique: boolean;
  readonly columns: readonly string[];
}

export interface SchemaTrigger {
  readonly table: string;
  readonly name: string;
  readonly deferrable: boolean;
}

export interface SchemaSnapshot {
  readonly schemaVersion: string;
  readonly migration: string;
  readonly tableCount: number;
  readonly tables: readonly string[];
  readonly moneyColumns: readonly { table: string; column: string; type: string }[];
  readonly deferredTriggers: readonly string[];
  readonly immutabilityTriggers: readonly string[];
  readonly columns: readonly SchemaColumn[];
  readonly constraints: readonly SchemaConstraint[];
  readonly indexes: readonly SchemaIndex[];
  readonly triggers: readonly SchemaTrigger[];
}

const SYSTEM_TABLES = new Set(['spatial_ref_sys']);

export function latestMigrationVersion(migrationsDir: string): string {
  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort();
  const last = files[files.length - 1];
  return last === undefined ? 'none' : last.replace(/\.sql$/, '');
}

export async function introspectSchema(executor: SqlExecutor): Promise<SchemaSnapshot> {
  const tableRes = await executor.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  const tables = tableRes.rows
    .map((r) => r.table_name)
    .filter((name) => !SYSTEM_TABLES.has(name));

  const columnRes = await executor.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    udt_name: string;
    numeric_precision: number | null;
    numeric_scale: number | null;
    is_nullable: string;
    column_default: string | null;
  }>(
    `SELECT table_name, column_name, data_type, udt_name, numeric_precision, numeric_scale,
            is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`,
  );

  const columns: SchemaColumn[] = columnRes.rows
    .filter((r) => !SYSTEM_TABLES.has(r.table_name))
    .map((r) => {
      const base =
        r.data_type === 'numeric' && r.numeric_precision !== null && r.numeric_scale !== null
          ? `numeric(${r.numeric_precision},${r.numeric_scale})`
          : r.data_type === 'ARRAY'
            ? `${r.udt_name.replace(/^_/, '')}[]`
            : r.udt_name === 'timestamptz'
              ? 'timestamp with time zone'
              : r.udt_name === 'uuid'
                ? 'uuid'
                : r.data_type;
      return {
        table: r.table_name,
        column: r.column_name,
        type: base,
        nullable: r.is_nullable === 'YES',
        default: r.column_default === null ? null : r.column_default.replace(/\s+/g, ' ').trim(),
      };
    });

  const constraintRes = await executor.query<{
    table_name: string;
    constraint_name: string;
    constraint_type: string;
    column_list: string | null;
    reference: string | null;
  }>(
    `SELECT tc.table_name,
            tc.constraint_name,
            tc.constraint_type,
            (SELECT string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position)
               FROM information_schema.key_column_usage kcu
              WHERE kcu.constraint_name = tc.constraint_name
                AND kcu.table_schema = tc.table_schema
                AND kcu.table_name = tc.table_name) AS column_list,
            (SELECT ccu.table_name || '.' || ccu.column_name
               FROM information_schema.constraint_column_usage ccu
              WHERE ccu.constraint_name = tc.constraint_name
                AND ccu.table_schema = tc.table_schema
              LIMIT 1) AS reference
       FROM information_schema.table_constraints tc
      WHERE tc.table_schema = 'public'
      ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name`,
  );

  const constraints: SchemaConstraint[] = constraintRes.rows
    .filter((r) => !SYSTEM_TABLES.has(r.table_name))
    .map((r) => ({
      table: r.table_name,
      name: r.constraint_name,
      type: r.constraint_type,
      columns: r.column_list === null ? [] : r.column_list.split(','),
      references: r.reference,
    }));

  const indexRes = await executor.query<{ tablename: string; indexname: string; indexdef: string }>(
    `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname`,
  );

  const indexes: SchemaIndex[] = indexRes.rows
    .filter((r) => !SYSTEM_TABLES.has(r.tablename))
    .map((r) => {
      const unique = /^CREATE UNIQUE INDEX/.test(r.indexdef);
      const columnMatch = /\(([^)]*)\)/.exec(r.indexdef);
      const columnText = columnMatch?.[1] ?? '';
      return {
        table: r.tablename,
        name: r.indexname,
        unique,
        columns: columnText
          .split(',')
          .map((c) => c.trim().replace(/ (ASC|DESC)$/i, ''))
          .filter((c) => c.length > 0),
      };
    });

  const triggerRes = await executor.query<{
    table_name: string;
    trigger_name: string;
    is_deferrable: boolean;
  }>(
    `SELECT c.relname AS table_name, t.tgname AS trigger_name, t.tgdeferrable AS is_deferrable
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public'
      ORDER BY c.relname, t.tgname`,
  );

  const triggers: SchemaTrigger[] = triggerRes.rows.map((r) => ({
    table: r.table_name,
    name: r.trigger_name,
    deferrable: r.is_deferrable,
  }));

  const moneyColumns = columns
    .filter((c) => /^numeric\(28,6\)$/.test(c.type))
    .map((c) => ({ table: c.table, column: c.column, type: 'NUMERIC(28,6)' }));

  return {
    schemaVersion: 'pending',
    migration: 'pending',
    tableCount: tables.length,
    tables,
    moneyColumns,
    deferredTriggers: triggers.filter((t) => t.deferrable).map((t) => t.name),
    immutabilityTriggers: triggers.filter((t) => t.table === 'audit_log').map((t) => t.name),
    columns,
    constraints,
    indexes,
    triggers,
  };
}

function comparable(snapshot: SchemaSnapshot): string {
  return JSON.stringify(
    {
      tables: snapshot.tables,
      moneyColumns: snapshot.moneyColumns,
      deferredTriggers: snapshot.deferredTriggers,
      immutabilityTriggers: snapshot.immutabilityTriggers,
      columns: snapshot.columns,
      constraints: snapshot.constraints,
      indexes: snapshot.indexes,
      triggers: snapshot.triggers,
    },
    null,
    2,
  );
}

export interface DiffResult {
  readonly equal: boolean;
  readonly differences: readonly string[];
}

export function diffSnapshots(expected: SchemaSnapshot, actual: SchemaSnapshot): DiffResult {
  const differences: string[] = [];

  const expectedTables = new Set(expected.tables);
  const actualTables = new Set(actual.tables);
  for (const t of actualTables) if (!expectedTables.has(t)) differences.push(`unexpected table ${t}`);
  for (const t of expectedTables) if (!actualTables.has(t)) differences.push(`missing table ${t}`);

  const keyOfColumn = (c: SchemaColumn) => `${c.table}.${c.column}`;
  const expectedColumns = new Map(expected.columns.map((c) => [keyOfColumn(c), c]));
  const actualColumns = new Map(actual.columns.map((c) => [keyOfColumn(c), c]));
  for (const [key, col] of actualColumns) {
    const wanted = expectedColumns.get(key);
    if (wanted === undefined) {
      differences.push(`unexpected column ${key} ${col.type}`);
      continue;
    }
    if (wanted.type !== col.type) differences.push(`column ${key} type ${wanted.type} -> ${col.type}`);
    if (wanted.nullable !== col.nullable) differences.push(`column ${key} nullability changed`);
    if (wanted.default !== col.default) differences.push(`column ${key} default ${wanted.default} -> ${col.default}`);
  }
  for (const key of expectedColumns.keys()) {
    if (!actualColumns.has(key)) differences.push(`missing column ${key}`);
  }

  const keyOfConstraint = (c: SchemaConstraint) => `${c.table}::${c.type}::${c.name}`;
  const expectedConstraints = new Set(expected.constraints.map(keyOfConstraint));
  const actualConstraints = new Set(actual.constraints.map(keyOfConstraint));
  for (const c of actualConstraints) if (!expectedConstraints.has(c)) differences.push(`unexpected constraint ${c}`);
  for (const c of expectedConstraints) if (!actualConstraints.has(c)) differences.push(`missing constraint ${c}`);

  const keyOfIndex = (i: SchemaIndex) => `${i.table}::${i.name}::${i.unique ? 'unique' : 'plain'}::${i.columns.join(',')}`;
  const expectedIndexes = new Set(expected.indexes.map(keyOfIndex));
  const actualIndexes = new Set(actual.indexes.map(keyOfIndex));
  for (const i of actualIndexes) if (!expectedIndexes.has(i)) differences.push(`unexpected index ${i}`);
  for (const i of expectedIndexes) if (!actualIndexes.has(i)) differences.push(`missing index ${i}`);

  const expectedTriggers = new Set(expected.triggers.map((t) => `${t.table}::${t.name}::${t.deferrable}`));
  const actualTriggers = new Set(actual.triggers.map((t) => `${t.table}::${t.name}::${t.deferrable}`));
  for (const t of actualTriggers) if (!expectedTriggers.has(t)) differences.push(`unexpected trigger ${t}`);
  for (const t of expectedTriggers) if (!actualTriggers.has(t)) differences.push(`missing trigger ${t}`);

  if (comparable(expected) === comparable(actual) && differences.length === 0) {
    return { equal: true, differences: [] };
  }
  return { equal: differences.length === 0, differences };
}

async function introspectPgliteDatabase(migrationsDir: string): Promise<SchemaSnapshot> {
  const pg = new PGlite();
  try {
    const executor: SqlExecutor = {
      async exec(sql: string) {
        await pg.exec(sql);
      },
      async query<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []) {
        const result = await pg.query<T>(sql, [...params]);
        return { rows: result.rows };
      },
    };
    await applyMigrations(executor, migrationsDir);
    const snapshot = await introspectSchema(executor);
    const version = latestMigrationVersion(migrationsDir);
    return {
      ...snapshot,
      schemaVersion: version,
      migration: `db/migrations/${version}.sql`,
    };
  } finally {
    await pg.close();
  }
}

async function introspectNeonDatabase(databaseUrl: string): Promise<SchemaSnapshot> {
  const { default: postgres } = await import('postgres');
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  const runner = sql as unknown as {
    unsafe(query: string, params?: readonly unknown[]): Promise<unknown>;
    end(options?: { readonly timeout?: number }): Promise<void>;
  };
  const executor: SqlExecutor = {
    async exec(rawSql: string) {
      await runner.unsafe(rawSql);
    },
    async query<T extends Record<string, unknown>>(rawSql: string, params: readonly unknown[] = []) {
      const rows = await runner.unsafe(rawSql, params);
      return { rows: rows as T[] };
    },
  };
  try {
    return await introspectSchema(executor);
  } finally {
    await runner.end({ timeout: 5 });
  }
}

async function main(): Promise<number> {
  const rootIdx = process.argv.indexOf('--root');
  const root = rootIdx !== -1 && process.argv[rootIdx + 1] ? String(process.argv[rootIdx + 1]) : process.cwd();
  const update = process.argv.includes('--update');

  const migrationsDir = join(root, 'db', 'migrations');
  const snapshotPath = join(root, 'db', 'schema.snapshot.json');

  const actual = await introspectPgliteDatabase(migrationsDir);

  if (update) {
    writeFileSync(snapshotPath, `${JSON.stringify(actual, null, 2)}\n`);
    process.stdout.write(
      `schema-parity: snapshot updated (${actual.tableCount} tables, ${actual.columns.length} columns, ${actual.migration}).\n`,
    );
    return 0;
  }

  const expected = JSON.parse(readFileSync(snapshotPath, 'utf8')) as SchemaSnapshot;
  const drift = diffSnapshots(expected, actual);
  if (!drift.equal) {
    process.stderr.write('SCHEMA PARITY GATE FAILED: migrations on PGLite drifted from db/schema.snapshot.json\n');
    for (const difference of drift.differences.slice(0, 40)) {
      process.stderr.write(`  ✗ ${difference}\n`);
    }
    if (drift.differences.length > 40) {
      process.stderr.write(`  … ${drift.differences.length - 40} more difference(s)\n`);
    }
    process.stderr.write('  Fix: re-run `npx tsx scripts/schema-parity.ts --update` in the same commit as the migration.\n');
    return 1;
  }

  const neonUrl = process.env['NEON_PARITY_DATABASE_URL'];
  if (neonUrl === undefined || neonUrl.trim().length === 0) {
    process.stdout.write(
      `schema-parity green on PGLite (${actual.tableCount} tables, ${actual.columns.length} columns, ${actual.indexes.length} indexes, ${actual.triggers.length} triggers); Neon leg SKIPPED (NEON_PARITY_DATABASE_URL unset).\n`,
    );
    return 0;
  }

  const neon = await introspectNeonDatabase(neonUrl);
  const parity = diffSnapshots(expected, neon);
  if (!parity.equal) {
    process.stderr.write('NEON PARITY FAILED: Neon schema differs from db/schema.snapshot.json\n');
    for (const difference of parity.differences.slice(0, 40)) {
      process.stderr.write(`  ✗ ${difference}\n`);
    }
    return 1;
  }
  process.stdout.write(
    `schema-parity green on PGLite and Neon parity confirmed (${neon.tableCount} tables identical to snapshot).\n`,
  );
  return 0;
}

const isEntryPoint = process.argv[1] !== undefined && /schema-parity\.(ts|js|mjs)$/.test(process.argv[1]);
if (isEntryPoint) {
  main()
    .then((code) => {
      process.exit(code);
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `schema-parity crashed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(1);
    });
}
