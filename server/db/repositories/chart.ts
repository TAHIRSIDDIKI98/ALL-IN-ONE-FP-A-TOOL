import { parseChartCsv } from '../../../core/chart/index.js';
import type { ChartAccountRow, ChartImportResult } from '../../../shared/chart.js';
import { AppError } from '../../../shared/errors.js';
import { appendAuditLog } from '../../audit/index.js';
import type { SqlExecutor } from '../migrate.js';
import { seedChartOfAccounts } from './import.js';

/**
 * Chart-of-accounts read model and import (MASTER_PROMPT §9.3.4; Spine Gates G1/G10).
 *
 * - The CSV is parsed and validated by the PURE `/core/chart` parser before any write, so a chart
 *   with one bad row is rejected whole and nothing is persisted (§1.6-7, all-or-nothing).
 * - `seedChartOfAccounts` upserts on `(company_id, code)`, derives `is_contra` from the type/normal
 *   side pair and resolves parents after insertion, so a chart can be re-imported to add accounts or
 *   rename them without duplicating rows.
 * - The audit row is written in the SAME transaction as the accounts (G10).
 */

interface AccountRowDb extends Record<string, unknown> {
  code: string;
  name: string;
  type: string;
  normal_side: string;
  is_contra: boolean;
  is_postable: boolean;
  statement_line_key: string;
  parent_code: string | null;
  active: boolean;
  version: number;
}

export async function listChartAccounts(
  db: SqlExecutor,
  companyId: string,
): Promise<ChartAccountRow[]> {
  const res = await db.query<AccountRowDb>(
    `SELECT a.code,
            a.name,
            a.type,
            a.normal_side,
            a.is_contra,
            a.is_postable,
            a.statement_line_key,
            parent.code AS parent_code,
            a.active,
            a.version
       FROM account a
       LEFT JOIN account parent
         ON parent.company_id = a.company_id AND parent.id = a.parent_id
      WHERE a.company_id = $1
      ORDER BY a.code ASC`,
    [companyId],
  );
  return res.rows.map((row) => ({
    code: row.code,
    name: row.name,
    type: row.type as ChartAccountRow['type'],
    normalSide: row.normal_side as ChartAccountRow['normalSide'],
    isContra: row.is_contra,
    isPostable: row.is_postable,
    statementLineKey: row.statement_line_key as ChartAccountRow['statementLineKey'],
    parentCode: row.parent_code,
    active: row.active,
    version: row.version,
  }));
}

export interface ChartImportParams {
  readonly companyId: string;
  readonly actorId: string;
  readonly csvText: string;
  readonly occurredAt: string;
}

export async function importChart(
  tx: SqlExecutor,
  params: ChartImportParams,
): Promise<ChartImportResult> {
  const parsed = parseChartCsv(params.csvText);
  if (parsed.issues.length > 0) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `The chart file has ${parsed.issues.length} rejected row(s); nothing was written.`,
      details: {
        issues: parsed.issues.map((issue) => `row ${issue.rowNo}: ${issue.reason}`),
      },
    });
  }
  if (parsed.accounts.length === 0) {
    throw new AppError('IMPORT_FILE_UNREADABLE', {
      userMessage: 'The chart file contains no account rows.',
    });
  }

  const { inserted, updated } = await seedChartOfAccounts(tx, {
    companyId: params.companyId,
    accounts: parsed.accounts.map((account) => ({
      code: account.code,
      name: account.name,
      type: account.type,
      normalSide: account.normalSide,
      parentCode: account.parentCode,
      isPostable: account.isPostable,
      statementLineKey: account.statementLineKey as ChartAccountRow['statementLineKey'],
      active: true,
    })),
  });

  await appendAuditLog(tx, {
    companyId: params.companyId,
    actorId: params.actorId,
    action: 'chart.import',
    targetTable: 'account',
    targetId: params.companyId,
    oldPayload: null,
    newPayload: {
      rowsAccepted: parsed.accounts.length,
      rowsRejected: 0,
      inserted,
      updated,
      codes: parsed.accounts.map((account) => account.code),
    },
    occurredAt: params.occurredAt,
  });

  return {
    companyId: params.companyId,
    rowCount: parsed.rowCount,
    inserted,
    updated,
    accounts: await listChartAccounts(tx, params.companyId),
  };
}
