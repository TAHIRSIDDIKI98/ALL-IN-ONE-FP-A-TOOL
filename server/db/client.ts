import { AppError } from '../../shared/errors.js';
import type { SqlExecutor } from '../db/migrate.js';

/**
 * Database handle for the OneFP&A spine (MASTER_PROMPT §3.1, §3.4).
 *
 * Two drivers, one contract:
 *  - `pglite`  — real Postgres (WASM) for the sandbox and unit/integration tests.
 *  - `postgres` — the locked production driver (`postgres` / postgres.js) against Neon.
 *
 * Transactions are issued as explicit BEGIN/COMMIT/ROLLBACK on a single connection, so the
 * transaction semantics are identical for both drivers and are proven in-sandbox on PGLite.
 * The production client therefore pins `max: 1` (one connection per handle); pooled
 * multi-connection writing is an M2 concern and is recorded as DEFERRED in TASKBOARD, not
 * silently assumed here.
 */
export type DatabaseDriver = 'pglite' | 'postgres';

export interface SqlTransactionRunner {
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

export interface DatabaseHandle extends SqlExecutor, SqlTransactionRunner {
  readonly driver: DatabaseDriver;
  close(): Promise<void>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Structural view of a Postgres error (`code` is the SQLSTATE). Kept structural — no `any`,
 * no runtime dependency on a driver-specific error class.
 */
export function pgErrorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { readonly code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

export function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === '23505';
}

export function withTransactions(
  driver: DatabaseDriver,
  executor: SqlExecutor,
  close: () => Promise<void>,
): DatabaseHandle {
  return {
    driver,
    close,
    exec: (sql: string) => executor.exec(sql),
    query: (sql: string, params?: readonly unknown[]) => executor.query(sql, params),

    async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      await executor.exec('BEGIN');
      try {
        const value = await fn(executor);
        await executor.exec('COMMIT');
        return value;
      } catch (error) {
        let rollbackFailure: unknown = null;
        try {
          await executor.exec('ROLLBACK');
        } catch (rbError) {
          rollbackFailure = rbError;
        }
        if (rollbackFailure !== null) {
          throw new AppError('INTERNAL_ERROR', {
            userMessage: 'The database transaction could not be rolled back cleanly.',
            details: {
              rollbackError: messageOf(rollbackFailure),
              originalError: messageOf(error),
            },
          });
        }
        throw error;
      }
    },
  };
}

/**
 * Sandbox driver: real Postgres compiled to WASM (`@electric-sql/pglite`).
 * Loaded dynamically so production installs never require the dev dependency.
 */
export async function openSandboxDatabase(dataDir?: string): Promise<DatabaseHandle> {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = dataDir === undefined ? new PGlite() : new PGlite(dataDir);
  await pg.waitReady;

  const executor: SqlExecutor = {
    async exec(sql: string) {
      await pg.exec(sql);
    },
    async query<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []) {
      const result = await pg.query<T>(sql, [...params]);
      return { rows: result.rows };
    },
  };

  return withTransactions('pglite', executor, async () => {
    await pg.close();
  });
}

/**
 * Structural view of the postgres.js surface this module uses. Declared locally so the
 * driver stays swappable and the call sites remain fully typed without `any`.
 */
interface PostgresRunner {
  unsafe(query: string, params?: readonly unknown[]): Promise<unknown>;
  end(options?: { readonly timeout?: number }): Promise<void>;
}

/**
 * Production driver: `postgres` (postgres.js) against Neon Postgres.
 * Pinned to a single connection so BEGIN/COMMIT semantics match the sandbox driver exactly.
 * Exercised by the Neon parity job in CI (`.github/workflows/ci.yml`) because the sandbox has
 * no Postgres server — recorded as EXISTS_UNVERIFIED in TASKBOARD until CI proves it.
 */
export async function openPostgresDatabase(databaseUrl: string): Promise<DatabaseHandle> {
  if (databaseUrl.trim().length === 0) {
    throw new AppError('INTERNAL_ERROR', {
      userMessage: 'DATABASE_URL is empty; the production database handle cannot be created.',
    });
  }

  const { default: postgres } = await import('postgres');
  const client = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  const runner = client as unknown as PostgresRunner;

  const executor: SqlExecutor = {
    async exec(sql: string) {
      await runner.unsafe(sql);
    },
    async query<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []) {
      const rows = await runner.unsafe(sql, params);
      return { rows: rows as T[] };
    },
  };

  return withTransactions('postgres', executor, async () => {
    await runner.end({ timeout: 5 });
  });
}

export interface DatabaseEnvironment {
  readonly DATABASE_URL?: string | undefined;
}

/**
 * Environment dispatch (SPEC §1.1): a configured DATABASE_URL selects Neon Postgres,
 * otherwise the sandbox PGLite driver is used. Never silently swaps providers (§3.5).
 */
export async function openDatabase(env: DatabaseEnvironment): Promise<DatabaseHandle> {
  const url = env.DATABASE_URL;
  if (url !== undefined && url.trim().length > 0) {
    return openPostgresDatabase(url);
  }
  return openSandboxDatabase();
}
