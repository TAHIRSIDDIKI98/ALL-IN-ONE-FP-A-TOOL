import { sha256Hex } from '../../../core/audit/sha256.js';
import {
  normalizeConnectorPayload,
  normalizedEntriesToImportCsv,
  reconcileNormalizedBatch,
  type ConnectorSyncInput,
  type NormalizedJournalEntry as CoreNormalizedJournalEntry,
} from '../../../core/integrations/index.js';
import { STORAGE_SCALE, money, scaleForCurrency, serialize } from '../../../core/money/index.js';
import { canActorCreateTask } from '../../../core/workflow/index.js';
import { AppError } from '../../../shared/errors.js';
import type {
  ConnectorConfigSummary,
  ConnectorRunsResponse,
  ConnectorSourceSystem,
  ConnectorStatus,
  ConnectorsOverviewResponse,
  CreateConnectorRequest,
  ReconciliationStatus,
  SyncConnectorRequest,
  SyncConnectorResponse,
  SyncMode,
  SyncRunStatus,
  SyncRunSummary,
} from '../../../shared/integrations.js';
import type { MembershipRole } from '../../../shared/workflow.js';
import { appendAuditLog } from '../../audit/index.js';
import { isUniqueViolation } from '../client.js';
import type { SqlExecutor } from '../migrate.js';
import { commitImport } from './import.js';

/**
 * Connectors & Sync Ledger Repository (MASTER_PROMPT §11.1, CON1–CON5, WI-0040).
 *
 * - Stores ONLY a SHA-256 vault reference (`vault:sha256:<64-hex>`) for connector credentials and
 *   NEVER selects or returns secrets or `credential_ref` in API responses or audit payloads (CON4).
 * - Projects matched batches into the ONE canonical `commitImport` pipeline — never a second GL
 *   ingestion path (CON1).
 * - Quarantines out-of-balance, currency-mismatched, or row-count-mismatched payloads in `sync_run`
 *   with `import_batch_id = NULL` (CON3).
 * - Atomic replacement for `full_repull` and matching-hash incremental re-sync (CON2).
 */

interface RoleDbRow extends Record<string, unknown> {
  role: MembershipRole;
}

interface CompanyCurrencyRow extends Record<string, unknown> {
  base_currency: string;
}

interface ConnectorConfigDbRow extends Record<string, unknown> {
  id: string;
  company_id: string;
  source_system: ConnectorSourceSystem;
  name: string;
  external_ref: string;
  sync_cursor: string | null;
  status: ConnectorStatus;
  last_synced_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface SyncRunDbRow extends Record<string, unknown> {
  id: string;
  company_id: string;
  connector_id: string;
  source_system: ConnectorSourceSystem;
  connector_name: string;
  mode: SyncMode;
  status: SyncRunStatus;
  cursor_before: string | null;
  cursor_after: string | null;
  source_hash: string;
  rows_pulled: number;
  rows_imported: number;
  rows_quarantined: number;
  total_debits: string;
  total_credits: string;
  reconciliation_status: ReconciliationStatus;
  reconciliation_reason: string | null;
  import_batch_id: string | null;
  replaced_run_id: string | null;
  started_at: Date | string;
  completed_at: Date | string | null;
}

interface PriorSyncBatchRow extends Record<string, unknown> {
  id: string;
  import_batch_id: string | null;
}

interface BatchHashRow extends Record<string, unknown> {
  id: string;
  source_hash: string;
  status: string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toIsoNullable(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function mapConnectorRow(row: ConnectorConfigDbRow): ConnectorConfigSummary {
  return {
    id: row.id,
    companyId: row.company_id,
    sourceSystem: row.source_system,
    name: row.name,
    externalRef: row.external_ref,
    syncCursor: row.sync_cursor,
    status: row.status,
    lastSyncedAt: toIsoNullable(row.last_synced_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapSyncRunRow(row: SyncRunDbRow, currencyScale: number): SyncRunSummary {
  return {
    id: row.id,
    companyId: row.company_id,
    connectorId: row.connector_id,
    sourceSystem: row.source_system,
    connectorName: row.connector_name,
    mode: row.mode,
    status: row.status,
    cursorBefore: row.cursor_before,
    cursorAfter: row.cursor_after,
    sourceHash: row.source_hash,
    rowsPulled: row.rows_pulled,
    rowsImported: row.rows_imported,
    rowsQuarantined: row.rows_quarantined,
    totalDebits: serialize(money(row.total_debits), currencyScale),
    totalCredits: serialize(money(row.total_credits), currencyScale),
    reconciliationStatus: row.reconciliation_status,
    reconciliationReason: row.reconciliation_reason,
    importBatchId: row.import_batch_id,
    replacedRunId: row.replaced_run_id,
    startedAt: toIso(row.started_at),
    completedAt: toIsoNullable(row.completed_at),
  };
}

async function requireCompanyCurrency(db: SqlExecutor, companyId: string): Promise<string> {
  const res = await db.query<CompanyCurrencyRow>(
    `SELECT base_currency FROM company WHERE id = $1`,
    [companyId],
  );
  const currency = res.rows[0]?.base_currency;
  if (currency === undefined) {
    throw new AppError('NOT_FOUND', { userMessage: 'The company workspace could not be found.' });
  }
  return currency;
}

async function requireConnectorWriterRole(
  db: SqlExecutor,
  companyId: string,
  actorId: string,
): Promise<MembershipRole> {
  const res = await db.query<RoleDbRow>(
    `SELECT role FROM membership WHERE company_id = $1 AND user_id = $2`,
    [companyId, actorId],
  );
  const role = res.rows[0]?.role;
  if (role === undefined || !canActorCreateTask(role)) {
    throw new AppError('TENANT_FORBIDDEN', {
      userMessage: 'Only workspace owners or editors may configure or run external connectors.',
    });
  }
  return role;
}

async function loadCompanyConnector(
  db: SqlExecutor,
  companyId: string,
  connectorId: string,
): Promise<ConnectorConfigDbRow> {
  const res = await db.query<ConnectorConfigDbRow>(
    `SELECT id, company_id, source_system, name, external_ref, sync_cursor, status,
            last_synced_at, created_at, updated_at
       FROM connector_config
      WHERE company_id = $1 AND id = $2`,
    [companyId, connectorId],
  );
  const row = res.rows[0];
  if (row === undefined) {
    throw new AppError('NOT_FOUND', { userMessage: 'The requested connector does not exist in this company.' });
  }
  return row;
}

async function loadSyncRunById(
  db: SqlExecutor,
  companyId: string,
  runId: string,
  currencyScale: number,
): Promise<SyncRunSummary> {
  const res = await db.query<SyncRunDbRow>(
    `SELECT r.id, r.company_id, r.connector_id, c.source_system, c.name AS connector_name,
            r.mode, r.status, r.cursor_before, r.cursor_after, r.source_hash,
            r.rows_pulled, r.rows_imported, r.rows_quarantined,
            r.total_debits::text AS total_debits, r.total_credits::text AS total_credits,
            r.reconciliation_status, r.reconciliation_reason,
            r.import_batch_id, r.replaced_run_id, r.started_at, r.completed_at
       FROM sync_run r
       JOIN connector_config c ON c.company_id = r.company_id AND c.id = r.connector_id
      WHERE r.company_id = $1 AND r.id = $2`,
    [companyId, runId],
  );
  const row = res.rows[0];
  if (row === undefined) {
    throw new AppError('INTERNAL_ERROR', { userMessage: 'The sync run could not be loaded.' });
  }
  return mapSyncRunRow(row, currencyScale);
}

export async function listConnectorsOverview(
  db: SqlExecutor,
  companyId: string,
): Promise<ConnectorsOverviewResponse> {
  const baseCurrency = await requireCompanyCurrency(db, companyId);
  const scale = scaleForCurrency(baseCurrency);

  const connectorsRes = await db.query<ConnectorConfigDbRow>(
    `SELECT id, company_id, source_system, name, external_ref, sync_cursor, status,
            last_synced_at, created_at, updated_at
       FROM connector_config
      WHERE company_id = $1
      ORDER BY created_at ASC, id ASC`,
    [companyId],
  );

  const runsRes = await db.query<SyncRunDbRow>(
    `SELECT r.id, r.company_id, r.connector_id, c.source_system, c.name AS connector_name,
            r.mode, r.status, r.cursor_before, r.cursor_after, r.source_hash,
            r.rows_pulled, r.rows_imported, r.rows_quarantined,
            r.total_debits::text AS total_debits, r.total_credits::text AS total_credits,
            r.reconciliation_status, r.reconciliation_reason,
            r.import_batch_id, r.replaced_run_id, r.started_at, r.completed_at
       FROM sync_run r
       JOIN connector_config c ON c.company_id = r.company_id AND c.id = r.connector_id
      WHERE r.company_id = $1
      ORDER BY r.started_at DESC, r.id DESC
      LIMIT 50`,
    [companyId],
  );

  return {
    companyId,
    baseCurrency,
    connectors: connectorsRes.rows.map(mapConnectorRow),
    recentRuns: runsRes.rows.map((row) => mapSyncRunRow(row, scale)),
  };
}

export async function listConnectorRuns(
  db: SqlExecutor,
  params: { readonly companyId: string; readonly connectorId: string },
): Promise<ConnectorRunsResponse> {
  const baseCurrency = await requireCompanyCurrency(db, params.companyId);
  const scale = scaleForCurrency(baseCurrency);
  const connectorRow = await loadCompanyConnector(db, params.companyId, params.connectorId);

  const runsRes = await db.query<SyncRunDbRow>(
    `SELECT r.id, r.company_id, r.connector_id, c.source_system, c.name AS connector_name,
            r.mode, r.status, r.cursor_before, r.cursor_after, r.source_hash,
            r.rows_pulled, r.rows_imported, r.rows_quarantined,
            r.total_debits::text AS total_debits, r.total_credits::text AS total_credits,
            r.reconciliation_status, r.reconciliation_reason,
            r.import_batch_id, r.replaced_run_id, r.started_at, r.completed_at
       FROM sync_run r
       JOIN connector_config c ON c.company_id = r.company_id AND c.id = r.connector_id
      WHERE r.company_id = $1 AND r.connector_id = $2
      ORDER BY r.started_at DESC, r.id DESC`,
    [params.companyId, params.connectorId],
  );

  return {
    companyId: params.companyId,
    connector: mapConnectorRow(connectorRow),
    runs: runsRes.rows.map((row) => mapSyncRunRow(row, scale)),
  };
}

export async function createConnectorConfig(
  tx: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly request: CreateConnectorRequest;
    readonly occurredAt: string;
  },
): Promise<ConnectorConfigSummary> {
  await requireCompanyCurrency(tx, params.companyId);
  await requireConnectorWriterRole(tx, params.companyId, params.actorId);

  // Hash credential reference server-side only; zero plaintext secret or credential_ref ever returned/logged (CON4)
  const credentialRef = `vault:sha256:${sha256Hex(params.request.credentialSecret)}`;

  let insertedRow: ConnectorConfigDbRow | undefined;
  try {
    const res = await tx.query<ConnectorConfigDbRow>(
      `INSERT INTO connector_config (
         company_id, source_system, name, external_ref, credential_ref, status, created_by, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7::timestamptz, $7::timestamptz)
       RETURNING id, company_id, source_system, name, external_ref, sync_cursor, status,
                 last_synced_at, created_at, updated_at`,
      [
        params.companyId,
        params.request.sourceSystem,
        params.request.name,
        params.request.externalRef,
        credentialRef,
        params.actorId,
        params.occurredAt,
      ],
    );
    insertedRow = res.rows[0];
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError('DUPLICATE_CODE', {
        userMessage: `A ${params.request.sourceSystem} connector named "${params.request.name}" already exists in this company.`,
      });
    }
    throw error;
  }

  if (insertedRow === undefined) {
    throw new AppError('INTERNAL_ERROR', { userMessage: 'The connector configuration could not be saved.' });
  }

  await appendAuditLog(tx, {
    companyId: params.companyId,
    actorId: params.actorId,
    action: 'connector.configure',
    targetTable: 'connector_config',
    targetId: insertedRow.id,
    oldPayload: null,
    newPayload: {
      sourceSystem: insertedRow.source_system,
      name: insertedRow.name,
      externalRef: insertedRow.external_ref,
      status: insertedRow.status,
    },
    occurredAt: params.occurredAt,
  });

  return mapConnectorRow(insertedRow);
}

export async function syncConnector(
  tx: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly connectorId: string;
    readonly actorId: string;
    readonly request: SyncConnectorRequest;
    readonly occurredAt: string;
  },
): Promise<SyncConnectorResponse> {
  const baseCurrency = await requireCompanyCurrency(tx, params.companyId);
  const currencyScale = scaleForCurrency(baseCurrency);
  await requireConnectorWriterRole(tx, params.companyId, params.actorId);

  const connectorRow = await loadCompanyConnector(tx, params.companyId, params.connectorId);
  if (connectorRow.status !== 'active') {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Connector "${connectorRow.name}" is ${connectorRow.status} and cannot run a sync.`,
      details: { status: connectorRow.status },
    });
  }
  if (params.request.payload.sourceSystem !== connectorRow.source_system) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Payload sourceSystem "${params.request.payload.sourceSystem}" does not match configured connector "${connectorRow.source_system}".`,
      details: {
        expectedSourceSystem: connectorRow.source_system,
        receivedSourceSystem: params.request.payload.sourceSystem,
      },
    });
  }

  let batch: ReturnType<typeof normalizeConnectorPayload>;
  try {
    batch = normalizeConnectorPayload({
      payload: params.request.payload as ConnectorSyncInput,
      baseCurrency,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid connector payload.';
    throw new AppError('VALIDATION_FAILED', {
      userMessage: message,
      details: { issues: [message] },
    });
  }

  const reconciliation = reconcileNormalizedBatch({
    batch,
    expectedCurrency: baseCurrency,
  });

  // CON3: Reconciliation mismatch quarantines the sync run WITHOUT writing to import_batch/GL or advancing cursor.
  if (reconciliation.status === 'mismatch_quarantined') {
    const runRes = await tx.query<{ id: string }>(
      `INSERT INTO sync_run (
         company_id, connector_id, mode, status, cursor_before, cursor_after, source_hash,
         rows_pulled, rows_imported, rows_quarantined, total_debits, total_credits,
         reconciliation_status, reconciliation_reason, import_batch_id, replaced_run_id,
         triggered_by, started_at, completed_at
       )
       VALUES (
         $1, $2, $3, 'quarantined', $4, $4, $5,
         $6, 0, $6, $7, $8,
         'mismatch_quarantined', $9, NULL, NULL,
         $10, $11::timestamptz, $11::timestamptz
       )
       RETURNING id`,
      [
        params.companyId,
        connectorRow.id,
        params.request.mode,
        connectorRow.sync_cursor,
        batch.batchHash,
        batch.lineCount,
        serialize(money(reconciliation.totalDebits), STORAGE_SCALE),
        serialize(money(reconciliation.totalCredits), STORAGE_SCALE),
        reconciliation.reasonSummary ?? 'RECONCILIATION_MISMATCH',
        params.actorId,
        params.occurredAt,
      ],
    );
    const runId = runRes.rows[0]?.id;
    if (runId === undefined) {
      throw new AppError('INTERNAL_ERROR', { userMessage: 'Quarantined sync run could not be saved.' });
    }

    await appendAuditLog(tx, {
      companyId: params.companyId,
      actorId: params.actorId,
      action: 'connector.sync_quarantined',
      targetTable: 'sync_run',
      targetId: runId,
      oldPayload: null,
      newPayload: {
        connectorId: connectorRow.id,
        sourceSystem: connectorRow.source_system,
        mode: params.request.mode,
        sourceHash: batch.batchHash,
        rowsPulled: batch.lineCount,
        reasons: [...reconciliation.reasons],
      },
      occurredAt: params.occurredAt,
    });

    const run = await loadSyncRunById(tx, params.companyId, runId, currencyScale);
    return {
      companyId: params.companyId,
      connector: mapConnectorRow(connectorRow),
      run,
      normalizedEntries: toWireNormalizedEntries(batch.entries),
      importResult: null,
    };
  }

  // CON1: Project canonical normalized entries into the ONE existing GL import pipeline.
  const csvText = normalizedEntriesToImportCsv(batch.entries);
  const csvSourceHash = sha256Hex(csvText);

  let replacedRunId: string | null = null;
  if (params.request.mode === 'full_repull') {
    const activeRunsRes = await tx.query<PriorSyncBatchRow>(
      `SELECT id, import_batch_id
         FROM sync_run
        WHERE company_id = $1 AND connector_id = $2 AND status = 'completed'
        ORDER BY started_at DESC, id DESC`,
      [params.companyId, connectorRow.id],
    );
    if (activeRunsRes.rows.length > 0) {
      replacedRunId = activeRunsRes.rows[0]!.id;
      await tx.query(
        `UPDATE sync_run
            SET status = 'replaced'
          WHERE company_id = $1 AND connector_id = $2 AND status = 'completed'`,
        [params.companyId, connectorRow.id],
      );

      // Atomically retire prior batches from earlier pulls whose source_hash differs from the new CSV
      // (matching-hash batches are retired by commitImport itself so replacedBatchId stays populated).
      const priorBatchIds = [
        ...new Set(
          activeRunsRes.rows
            .map((r) => r.import_batch_id)
            .filter((id): id is string => id !== null),
        ),
      ];
      for (const batchId of priorBatchIds) {
        const batchRowRes = await tx.query<BatchHashRow>(
          `SELECT id, source_hash, status FROM import_batch WHERE company_id = $1 AND id = $2`,
          [params.companyId, batchId],
        );
        const priorBatch = batchRowRes.rows[0];
        if (
          priorBatch !== undefined &&
          (priorBatch.status === 'staged' || priorBatch.status === 'committed') &&
          priorBatch.source_hash !== csvSourceHash
        ) {
          await tx.query(
            `UPDATE import_batch SET status = 'replaced' WHERE company_id = $1 AND id = $2`,
            [params.companyId, batchId],
          );
        }
      }
    }
  } else {
    const matchingRunRes = await tx.query<PriorSyncBatchRow>(
      `SELECT id, import_batch_id
         FROM sync_run
        WHERE company_id = $1 AND connector_id = $2 AND source_hash = $3 AND status = 'completed'
        ORDER BY started_at DESC, id DESC
        LIMIT 1`,
      [params.companyId, connectorRow.id, batch.batchHash],
    );
    const priorRun = matchingRunRes.rows[0];
    if (priorRun !== undefined) {
      replacedRunId = priorRun.id;
      await tx.query(
        `UPDATE sync_run SET status = 'replaced' WHERE company_id = $1 AND id = $2`,
        [params.companyId, priorRun.id],
      );
    }
  }

  const cursorLabel = params.request.cursor ?? params.occurredAt.slice(0, 10);
  const safeConnectorSlug = connectorRow.name.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const sourceFilename = `${connectorRow.source_system}-${safeConnectorSlug}-${cursorLabel}.csv`.slice(0, 200);

  const importResult = await commitImport(tx, {
    companyId: params.companyId,
    actorId: params.actorId,
    kind: 'actuals',
    sourceFilename,
    csvText,
    occurredAt: params.occurredAt,
  });

  const cursorAfter = params.request.cursor ?? connectorRow.sync_cursor;
  const updatedConnRes = await tx.query<ConnectorConfigDbRow>(
    `UPDATE connector_config
        SET sync_cursor = $3,
            last_synced_at = $4::timestamptz,
            updated_at = $4::timestamptz
      WHERE company_id = $1 AND id = $2
      RETURNING id, company_id, source_system, name, external_ref, sync_cursor, status,
                last_synced_at, created_at, updated_at`,
    [params.companyId, connectorRow.id, cursorAfter, params.occurredAt],
  );
  const updatedConnector = updatedConnRes.rows[0] ?? connectorRow;

  const runInsertRes = await tx.query<{ id: string }>(
    `INSERT INTO sync_run (
       company_id, connector_id, mode, status, cursor_before, cursor_after, source_hash,
       rows_pulled, rows_imported, rows_quarantined, total_debits, total_credits,
       reconciliation_status, reconciliation_reason, import_batch_id, replaced_run_id,
       triggered_by, started_at, completed_at
     )
     VALUES (
       $1, $2, $3, 'completed', $4, $5, $6,
       $7, $8, $9, $10, $11,
       'matched', NULL, $12, $13,
       $14, $15::timestamptz, $15::timestamptz
     )
     RETURNING id`,
    [
      params.companyId,
      connectorRow.id,
      params.request.mode,
      connectorRow.sync_cursor,
      cursorAfter,
      batch.batchHash,
      batch.lineCount,
      importResult.importedCount,
      importResult.quarantinedCount,
      serialize(money(batch.totalDebits), STORAGE_SCALE),
      serialize(money(batch.totalCredits), STORAGE_SCALE),
      importResult.batchId,
      replacedRunId,
      params.actorId,
      params.occurredAt,
    ],
  );
  const runId = runInsertRes.rows[0]?.id;
  if (runId === undefined) {
    throw new AppError('INTERNAL_ERROR', { userMessage: 'The completed sync run could not be recorded.' });
  }

  await appendAuditLog(tx, {
    companyId: params.companyId,
    actorId: params.actorId,
    action: 'connector.sync',
    targetTable: 'sync_run',
    targetId: runId,
    oldPayload: replacedRunId === null ? null : { replacedRunId },
    newPayload: {
      connectorId: connectorRow.id,
      sourceSystem: connectorRow.source_system,
      mode: params.request.mode,
      sourceHash: batch.batchHash,
      importBatchId: importResult.batchId,
      rowsPulled: batch.lineCount,
      rowsImported: importResult.importedCount,
      rowsQuarantined: importResult.quarantinedCount,
      cursorAfter,
    },
    occurredAt: params.occurredAt,
  });

  const run = await loadSyncRunById(tx, params.companyId, runId, currencyScale);
  return {
    companyId: params.companyId,
    connector: mapConnectorRow(updatedConnector),
    run,
    normalizedEntries: toWireNormalizedEntries(batch.entries),
    importResult,
  };
}

function toWireNormalizedEntries(
  entries: readonly CoreNormalizedJournalEntry[],
): SyncConnectorResponse['normalizedEntries'] {
  return entries.map((entry) => ({
    ...entry,
    lines: entry.lines.map((line) => ({
      ...line,
      dims: { ...line.dims },
    })),
  }));
}
