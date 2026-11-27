#!/usr/bin/env node
/**
 * Schema Scope Gate (MASTER_PROMPT §4.1, §4.3, §4.8, Gate D9).
 *
 * Asserts that SQL migrations in /db/migrations define ONLY tables from the
 * locked 18-table M1 set (and once migrations exist, all 18 are present),
 * and never use float4/float8/double precision/real for money.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const APPROVED_M1_TABLES = [
  'app_user',
  'company',
  'membership',
  'fiscal_calendar',
  'fiscal_period',
  'statement_line',
  'account',
  'entity',
  'department',
  'coa_mapping',
  'import_batch',
  'import_row_raw',
  'gl_entry',
  'gl_line',
  'scenario',
  'plan_version',
  'plan_line',
  'audit_log',
];

/** Opened in M2 under DEC-014 & DEC-017 (§11.2, §11.9). CapEx/FX/Consolidation remain blocked. */
export const APPROVED_M2_COLLABORATION_TABLES = [
  'approval_task',
  'comment',
  'job',
  'notification',
];

/** Opened in M2 under DEC-018 (§2.4 One-Engine Module proof: Workforce). */
export const APPROVED_M2_WORKFORCE_TABLES = [
  'workforce_position',
];

/** Opened in M2 under DEC-020 (§11.1 Connectors Framework: Google Sheets, QBO, Xero). */
export const APPROVED_M2_CONNECTOR_TABLES = [
  'connector_config',
  'sync_run',
];

/** Opened in M3 under DEC-022 (§12.6 Close Management & Period Locks). CapEx/Treasury/FX/Consolidation remain blocked until their M3 WIs. */
export const APPROVED_M3_CLOSE_TABLES = [
  'close_task_template',
  'close_cycle',
  'close_task',
  'period_lock_event',
];

/** Opened in M3 under DEC-023 (§2.6, §4.1, §12.6 Exception-Rule Catalog, Owner Inbox & Reversal-Only Rectification Journal). */
export const APPROVED_M3_EXCEPTION_TABLES = [
  'exception_finding',
  'exception_finding_event',
  'rectification_journal',
];

/** Opened in M3 under DEC-024 (§2.6, §11.6 Multi-Entity, Multi-Currency & Consolidation). */
export const APPROVED_M3_CONSOLIDATION_TABLES = [
  'fx_rate',
  'entity_ownership',
  'intercompany_rule',
  'consolidation_run',
];

const APPROVED_SET = new Set([
  ...APPROVED_M1_TABLES,
  ...APPROVED_M2_COLLABORATION_TABLES,
  ...APPROVED_M2_WORKFORCE_TABLES,
  ...APPROVED_M2_CONNECTOR_TABLES,
  ...APPROVED_M3_CLOSE_TABLES,
  ...APPROVED_M3_EXCEPTION_TABLES,
  ...APPROVED_M3_CONSOLIDATION_TABLES,
]);

export function checkSchemaScope(rootDir = process.cwd(), { requireComplete = false } = {}) {
  const migDir = join(rootDir, 'db', 'migrations');
  const violations = [];
  const foundTables = new Set();

  if (!existsSync(migDir)) {
    if (requireComplete) violations.push('Missing db/migrations directory');
    return { tables: [], violations };
  }

  const sqlFiles = readdirSync(migDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of sqlFiles) {
    const sql = readFileSync(join(migDir, file), 'utf8');
    // Strip SQL comments
    const stripped = sql
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--[^\n]*/g, '');

    const tableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-zA-Z0-9_]+)/gi;
    let m;
    while ((m = tableRe.exec(stripped)) !== null) {
      const tableName = m[1].toLowerCase();
      foundTables.add(tableName);
      if (!APPROVED_SET.has(tableName)) {
        violations.push(`${file}: unapproved table "${tableName}" violates MASTER_PROMPT §4.3 / §4.8`);
      }
    }

    if (/\b(?:float4|float8|double\s+precision|\breal\b)\b/i.test(stripped)) {
      violations.push(`${file}: floating-point SQL column type detected (NUMERIC(28,6) required — §4.2)`);
    }
  }

  if ((sqlFiles.length > 0 || requireComplete) && violations.length === 0) {
    for (const expected of APPROVED_M1_TABLES) {
      if (!foundTables.has(expected)) {
        violations.push(`Missing approved M1 table "${expected}" in migrations (§4.3 requires exact 18 tables)`);
      }
    }
  }

  return { tables: [...foundTables], violations };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rootArgIdx = process.argv.indexOf('--root');
  const root = rootArgIdx !== -1 && process.argv[rootArgIdx + 1] ? process.argv[rootArgIdx + 1] : process.cwd();
  const requireComplete = process.argv.includes('--require-complete');
  const { tables, violations } = checkSchemaScope(root, { requireComplete });
  if (violations.length > 0) {
    console.error(`SCHEMA SCOPE FAILED (${violations.length} violation(s)):`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    process.exit(1);
  }
  console.log(`✓ schema-scope green (${tables.length} migration table(s) verified against M1+M2 collaboration scope).`);
}
