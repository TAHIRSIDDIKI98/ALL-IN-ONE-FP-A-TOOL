import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SqlExecutor {
  exec(sql: string): Promise<void>;
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
}

const MIGRATION_SENTINEL_CHECKS: Readonly<Record<string, string>> = {
  '0001_m1_spine.sql': "SELECT to_regclass('public.app_user') AS reg",
  '0002_m2_collaboration.sql': "SELECT to_regclass('public.approval_task') AS reg",
  '0003_m2_workforce.sql': "SELECT to_regclass('public.workforce_position') AS reg",
};

export function listMigrationFiles(migrationsDir: string): string[] {
  return readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort();
}

export async function applyMigrations(
  executor: SqlExecutor,
  migrationsDir: string = join(process.cwd(), 'db', 'migrations'),
): Promise<readonly string[]> {
  const files = listMigrationFiles(migrationsDir);
  const applied: string[] = [];

  for (const file of files) {
    const sentinel = MIGRATION_SENTINEL_CHECKS[file];
    if (sentinel) {
      const check = await executor.query<{ reg: string | null }>(sentinel);
      if (check.rows[0]?.reg !== null && check.rows[0]?.reg !== undefined) {
        continue;
      }
    }
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    await executor.exec(sql);
    applied.push(file);
  }

  return applied;
}
