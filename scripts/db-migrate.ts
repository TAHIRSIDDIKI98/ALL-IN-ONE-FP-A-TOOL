import postgres from 'postgres';
import { applyMigrations, type SqlExecutor } from '../server/db/migrate.js';

async function main() {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    process.stderr.write('DATABASE_URL is required to run db:migrate.\n');
    process.exit(1);
  }

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const executor: SqlExecutor = {
      async exec(rawSql: string) {
        await sql.unsafe(rawSql);
      },
      async query<T extends Record<string, unknown>>(
        rawSql: string,
        params: readonly unknown[] = [],
      ) {
        const rows = await sql.unsafe<T[]>(rawSql, params as never[]);
        return { rows };
      },
    };
    const applied = await applyMigrations(executor);
    process.stdout.write(`Applied migrations: ${applied.length === 0 ? 'none (up to date)' : applied.join(', ')}\n`);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`Migration failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
