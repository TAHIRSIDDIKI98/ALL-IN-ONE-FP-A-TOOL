import { z } from 'zod';
import { ImportCommitResultSchema } from './import.js';

/**
 * Connectors & Integration Framework Contracts (MASTER_PROMPT §11.1, CON1–CON5, WI-0040).
 *
 * - Supported M2 source systems: 'google_sheets', 'quickbooks_online', 'xero'
 *   (NetSuite/D365 remain M3; SAP/Oracle remain M5).
 * - All monetary values cross the wire strictly as canonical decimal strings (§5.2 E11).
 * - Credentials are write-only on connector creation and NEVER appear in any response schema (CON4).
 */

export const CONNECTOR_SOURCE_SYSTEMS = [
  'google_sheets',
  'quickbooks_online',
  'xero',
] as const;

export const ConnectorSourceSystemSchema = z.enum(CONNECTOR_SOURCE_SYSTEMS);
export type ConnectorSourceSystem = z.infer<typeof ConnectorSourceSystemSchema>;

export const CONNECTOR_STATUSES = ['active', 'paused', 'revoked'] as const;
export const ConnectorStatusSchema = z.enum(CONNECTOR_STATUSES);
export type ConnectorStatus = z.infer<typeof ConnectorStatusSchema>;

export const SYNC_MODES = ['incremental', 'full_repull'] as const;
export const SyncModeSchema = z.enum(SYNC_MODES);
export type SyncMode = z.infer<typeof SyncModeSchema>;

export const SYNC_RUN_STATUSES = ['completed', 'replaced', 'quarantined', 'failed'] as const;
export const SyncRunStatusSchema = z.enum(SYNC_RUN_STATUSES);
export type SyncRunStatus = z.infer<typeof SyncRunStatusSchema>;

export const RECONCILIATION_STATUSES = ['matched', 'mismatch_quarantined'] as const;
export const ReconciliationStatusSchema = z.enum(RECONCILIATION_STATUSES);
export type ReconciliationStatus = z.infer<typeof ReconciliationStatusSchema>;

/**
 * CON1 Canonical Normalized Shape (§11.1):
 * { source_system, entry_ref, entry_date, period, currency,
 *   lines: [{ account_code, description, debit, credit, dims }], source_row_hash }
 */
export const NormalizedEntryLineSchema = z.object({
  account_code: z.string().min(1).max(32),
  description: z.string(),
  debit: z.string(),
  credit: z.string(),
  dims: z.record(z.string(), z.string()),
});

export type NormalizedEntryLine = z.infer<typeof NormalizedEntryLineSchema>;

export const NormalizedJournalEntrySchema = z.object({
  source_system: ConnectorSourceSystemSchema,
  entry_ref: z.string().min(1).max(120),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period: z.string().min(1).max(32),
  currency: z.string().regex(/^[A-Z]{3}$/),
  lines: z.array(NormalizedEntryLineSchema).min(1),
  source_row_hash: z.string().regex(/^[0-9a-f]{64}$/),
});

export type NormalizedJournalEntry = z.infer<typeof NormalizedJournalEntrySchema>;

/** Adapter-specific raw payloads normalized into CON1 canonical entries in /core/integrations */
export const GoogleSheetsRowPayloadSchema = z.object({
  entryRef: z.string().trim().min(1).max(120),
  date: z.string().trim().min(1).max(32),
  period: z.string().trim().min(1).max(32).optional(),
  accountCode: z.string().trim().min(1).max(32),
  description: z.string().max(400).default(''),
  debit: z.string().trim().default(''),
  credit: z.string().trim().default(''),
  dims: z.record(z.string(), z.string()).default({}),
});

export const GoogleSheetsSyncPayloadSchema = z.object({
  sourceSystem: z.literal('google_sheets'),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).optional(),
  expectedRowCount: z.number().int().nonnegative().optional(),
  rows: z.array(GoogleSheetsRowPayloadSchema).min(1),
});

export const QuickBooksJournalLineSchema = z.object({
  Description: z.string().max(400).default(''),
  Amount: z.string().trim().min(1),
  DetailType: z.literal('JournalEntryLineDetail').default('JournalEntryLineDetail'),
  JournalEntryLineDetail: z.object({
    PostingType: z.enum(['Debit', 'Credit']),
    AccountRef: z.object({
      value: z.string().trim().min(1).max(32),
      name: z.string().optional(),
    }),
    DepartmentRef: z
      .object({
        name: z.string().trim().min(1),
      })
      .optional(),
    ClassRef: z
      .object({
        name: z.string().trim().min(1),
      })
      .optional(),
  }),
});

export const QuickBooksJournalEntrySchema = z.object({
  Id: z.string().trim().min(1).max(120),
  DocNumber: z.string().trim().min(1).max(120).optional(),
  TxnDate: z.string().trim().min(1).max(32),
  Period: z.string().trim().min(1).max(32).optional(),
  CurrencyRef: z.object({
    value: z.string().trim().regex(/^[A-Z]{3}$/),
  }),
  PrivateNote: z.string().max(400).default(''),
  Line: z.array(QuickBooksJournalLineSchema).min(1),
});

export const QuickBooksSyncPayloadSchema = z.object({
  sourceSystem: z.literal('quickbooks_online'),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).optional(),
  expectedRowCount: z.number().int().nonnegative().optional(),
  journalEntries: z.array(QuickBooksJournalEntrySchema).min(1),
});

export const XeroJournalLineSchema = z.object({
  AccountCode: z.string().trim().min(1).max(32),
  Description: z.string().max(400).default(''),
  LineAmount: z.string().trim().min(1),
  Tracking: z
    .array(
      z.object({
        Name: z.string().trim().min(1),
        Option: z.string().trim().min(1),
      }),
    )
    .default([]),
});

export const XeroManualJournalSchema = z.object({
  ManualJournalID: z.string().trim().min(1).max(120),
  Narration: z.string().max(400).default(''),
  Date: z.string().trim().min(1).max(32),
  Period: z.string().trim().min(1).max(32).optional(),
  CurrencyCode: z.string().trim().regex(/^[A-Z]{3}$/),
  JournalLines: z.array(XeroJournalLineSchema).min(1),
});

export const XeroSyncPayloadSchema = z.object({
  sourceSystem: z.literal('xero'),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).optional(),
  expectedRowCount: z.number().int().nonnegative().optional(),
  manualJournals: z.array(XeroManualJournalSchema).min(1),
});

export const ConnectorSyncPayloadSchema = z.discriminatedUnion('sourceSystem', [
  GoogleSheetsSyncPayloadSchema,
  QuickBooksSyncPayloadSchema,
  XeroSyncPayloadSchema,
]);

export type ConnectorSyncPayload = z.infer<typeof ConnectorSyncPayloadSchema>;

export const CreateConnectorRequestSchema = z.object({
  sourceSystem: ConnectorSourceSystemSchema,
  name: z.string().trim().min(2).max(120),
  externalRef: z.string().trim().min(1).max(180),
  /** Write-only credential input; server hashes before storage and NEVER returns or logs it (CON4). */
  credentialSecret: z.string().trim().min(8).max(512),
});

export type CreateConnectorRequest = z.infer<typeof CreateConnectorRequestSchema>;

export const SyncConnectorRequestSchema = z.object({
  mode: SyncModeSchema.default('incremental'),
  cursor: z.string().trim().min(1).max(180).optional(),
  payload: ConnectorSyncPayloadSchema,
});

export type SyncConnectorRequest = z.infer<typeof SyncConnectorRequestSchema>;

/** Zero credentialSecret / credential_ref fields exist on ConnectorConfigSummary (CON4). */
export const ConnectorConfigSummarySchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  sourceSystem: ConnectorSourceSystemSchema,
  name: z.string(),
  externalRef: z.string(),
  syncCursor: z.string().nullable(),
  status: ConnectorStatusSchema,
  lastSyncedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ConnectorConfigSummary = z.infer<typeof ConnectorConfigSummarySchema>;

export const SyncRunSummarySchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  connectorId: z.string().uuid(),
  sourceSystem: ConnectorSourceSystemSchema,
  connectorName: z.string(),
  mode: SyncModeSchema,
  status: SyncRunStatusSchema,
  cursorBefore: z.string().nullable(),
  cursorAfter: z.string().nullable(),
  sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
  rowsPulled: z.number().int().nonnegative(),
  rowsImported: z.number().int().nonnegative(),
  rowsQuarantined: z.number().int().nonnegative(),
  totalDebits: z.string(),
  totalCredits: z.string(),
  reconciliationStatus: ReconciliationStatusSchema,
  reconciliationReason: z.string().nullable(),
  importBatchId: z.string().uuid().nullable(),
  replacedRunId: z.string().uuid().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
});

export type SyncRunSummary = z.infer<typeof SyncRunSummarySchema>;

export const ConnectorsOverviewResponseSchema = z.object({
  companyId: z.string().uuid(),
  baseCurrency: z.string().regex(/^[A-Z]{3}$/),
  connectors: z.array(ConnectorConfigSummarySchema),
  recentRuns: z.array(SyncRunSummarySchema),
});

export type ConnectorsOverviewResponse = z.infer<typeof ConnectorsOverviewResponseSchema>;

export const ConnectorRunsResponseSchema = z.object({
  companyId: z.string().uuid(),
  connector: ConnectorConfigSummarySchema,
  runs: z.array(SyncRunSummarySchema),
});

export type ConnectorRunsResponse = z.infer<typeof ConnectorRunsResponseSchema>;

export const SyncConnectorResponseSchema = z.object({
  companyId: z.string().uuid(),
  connector: ConnectorConfigSummarySchema,
  run: SyncRunSummarySchema,
  normalizedEntries: z.array(NormalizedJournalEntrySchema),
  importResult: ImportCommitResultSchema.nullable(),
});

export type SyncConnectorResponse = z.infer<typeof SyncConnectorResponseSchema>;
