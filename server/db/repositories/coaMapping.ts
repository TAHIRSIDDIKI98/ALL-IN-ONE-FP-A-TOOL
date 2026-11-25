import {
  buildMappingReport,
  planMappingVersions,
  type DiscoveredSourceCode,
  type MappingQuarantineReason,
  type MappingStatus,
  type MappingVersionRow,
} from '../../../core/mapping/index.js';
import type {
  CoaMappingCommitResult,
  CoaMappingEdit,
  CoaMappingReport,
} from '../../../shared/coaMapping.js';
import { AppError } from '../../../shared/errors.js';
import { appendAuditLog } from '../../audit/index.js';
import type { SqlExecutor } from '../migrate.js';

/**
 * Versioned source→account mapping repository (MASTER_PROMPT §4.3, §9.3.4; SPEC §3.6f).
 *
 * Source codes are discovered only from retained import rows, never invented by the UI or the
 * server. A real edit writes a new immutable row, never an in-place UPDATE, and the audit payload
 * is committed in the same transaction as the version rows (G10).
 */

interface MappingRowDb extends Record<string, unknown> {
  source_code: string;
  account_code: string | null;
  mapping_version: number;
  effective_from: string | Date;
  status: string;
  quarantine_reason: string | null;
}

interface DiscoveryRowDb extends Record<string, unknown> {
  source_code: string;
  row_count: string;
  samples: string[] | null;
}

interface AccountRowDb extends Record<string, unknown> {
  id: string;
  code: string;
  name: string;
}

function asIsoDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function toVersionRow(row: MappingRowDb): MappingVersionRow {
  return {
    sourceCode: row.source_code,
    accountCode: row.account_code,
    mappingVersion: row.mapping_version,
    effectiveFrom: asIsoDate(row.effective_from),
    status: row.status as MappingStatus,
    quarantineReason: row.quarantine_reason as MappingQuarantineReason | null,
  };
}

const VERSION_PROJECTION = `m.source_code,
         target.code AS account_code,
         m.mapping_version,
         m.effective_from,
         m.status,
         m.quarantine_reason`;
const VERSION_FROM = `FROM coa_mapping m
    LEFT JOIN account target
      ON target.company_id = m.company_id AND target.id = m.account_id
   WHERE m.company_id = $1 AND m.source_system = 'csv'`;

/** All mapping rows, including future-dated versions, for strict version-number planning. */
export async function listAllMappingVersions(
  db: SqlExecutor,
  companyId: string,
): Promise<readonly MappingVersionRow[]> {
  const res = await db.query<MappingRowDb>(
    `SELECT ${VERSION_PROJECTION} ${VERSION_FROM} ORDER BY m.source_code ASC, m.mapping_version DESC`,
    [companyId],
  );
  return res.rows.map(toVersionRow);
}

/** The newest EFFECTIVE version per source as of `asOfDate`; future versions are invisible. */
export async function listCoaMappings(
  db: SqlExecutor,
  companyId: string,
  asOfDate: string,
): Promise<readonly MappingVersionRow[]> {
  const res = await db.query<MappingRowDb>(
    `SELECT DISTINCT ON (m.source_code) ${VERSION_PROJECTION}
      ${VERSION_FROM} AND m.effective_from <= $2::date
     ORDER BY m.source_code ASC, m.mapping_version DESC, m.created_at DESC, m.id DESC`,
    [companyId, asOfDate],
  );
  return res.rows.map(toVersionRow);
}

/** Real source codes in the RETAINED import rows, with counts and honest sample values. */
export async function discoverSourceCodes(
  db: SqlExecutor,
  companyId: string,
): Promise<readonly DiscoveredSourceCode[]> {
  const res = await db.query<DiscoveryRowDb>(
    `SELECT source_code,
            COUNT(*)::text AS row_count,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT COALESCE(sample, '')), '') AS samples
       FROM (
         SELECT CASE
                  WHEN parsed_fields->>'accountCode' IS NOT NULL
                    THEN parsed_fields->>'accountCode'
                  ELSE substring(parsed_fields->>'reason' from 'UNMAPPED_ACCOUNT:(.*)')
                END AS source_code,
                parsed_fields->>'description' AS sample
           FROM import_row_raw
          WHERE company_id = $1
       ) discovered
      WHERE source_code IS NOT NULL AND btrim(source_code) <> ''
      GROUP BY source_code
      ORDER BY source_code ASC`,
    [companyId],
  );
  return res.rows.map((row) => ({
    sourceCode: row.source_code,
    rowCount: Number(row.row_count),
    sampleValues: (row.samples ?? []).slice(0, 5),
  }));
}

async function postableAccounts(
  db: SqlExecutor,
  companyId: string,
): Promise<readonly AccountRowDb[]> {
  const res = await db.query<AccountRowDb>(
    `SELECT id, code, name FROM account
      WHERE company_id = $1 AND active = true AND is_postable = true
      ORDER BY code ASC`,
    [companyId],
  );
  return res.rows;
}

export async function getCoaMappingReport(
  db: SqlExecutor,
  companyId: string,
  asOfDate: string,
): Promise<CoaMappingReport> {
  const [mappings, discovered, accounts] = await Promise.all([
    listCoaMappings(db, companyId, asOfDate),
    discoverSourceCodes(db, companyId),
    postableAccounts(db, companyId),
  ]);

  // A source that was explicitly quarantined may have no posted row; its code still comes from a
  // stored mapping version and must remain visible for review (§1.6-7, nothing silently discarded).
  const byCode = new Map(discovered.map((entry) => [entry.sourceCode.toUpperCase(), entry]));
  for (const row of mappings) {
    const key = row.sourceCode.toUpperCase();
    if (!byCode.has(key)) {
      byCode.set(key, { sourceCode: row.sourceCode, rowCount: 0, sampleValues: [] });
    }
  }
  return buildMappingReport({
    companyId,
    effectiveFrom: asOfDate,
    discovered: [...byCode.values()],
    mappings,
    accounts: accounts.map((account) => ({ code: account.code, name: account.name })),
  });
}

export interface CommitCoaMappingsParams {
  readonly companyId: string;
  readonly actorId: string;
  readonly entries: readonly CoaMappingEdit[];
  readonly effectiveFrom: string;
  readonly occurredAt: string;
}

export async function commitCoaMappings(
  tx: SqlExecutor,
  params: CommitCoaMappingsParams,
): Promise<CoaMappingCommitResult> {
  const [existing, discovered, accounts] = await Promise.all([
    listAllMappingVersions(tx, params.companyId),
    discoverSourceCodes(tx, params.companyId),
    postableAccounts(tx, params.companyId),
  ]);
  const accountByCode = new Map(accounts.map((account) => [account.code.toUpperCase(), account]));
  const discoveredCodes = new Set(discovered.map((entry) => entry.sourceCode));
  for (const row of existing) discoveredCodes.add(row.sourceCode);

  const { versions, issues } = planMappingVersions({
    existing,
    edits: params.entries,
    effectiveFrom: params.effectiveFrom,
    knownAccountCodes: new Set(accounts.map((account) => account.code)),
    discoveredCodes,
  });
  if (issues.length > 0) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `The mapping batch has ${issues.length} rejected row(s); nothing was written.`,
      details: { issues: [...issues] },
    });
  }

  let written = 0;
  for (const version of versions) {
    const accountId = version.accountCode === null
      ? null
      : accountByCode.get(version.accountCode.toUpperCase())?.id ?? null;
    const res = await tx.query<{ id: string }>(
      `INSERT INTO coa_mapping (
         company_id, source_system, source_code, account_id, mapping_version,
         effective_from, status, quarantine_reason
       )
       VALUES ($1, 'csv', $2, $3, $4, $5::date, $6, $7)
       RETURNING id`,
      [
        params.companyId,
        version.sourceCode,
        accountId,
        version.mappingVersion,
        version.effectiveFrom,
        version.status,
        version.quarantineReason,
      ],
    );
    if (res.rows[0]?.id === undefined) {
      throw new AppError('INTERNAL_ERROR', {
        userMessage: `Mapping version for ${version.sourceCode} could not be persisted.`,
      });
    }
    written += 1;
  }

  await appendAuditLog(tx, {
    companyId: params.companyId,
    actorId: params.actorId,
    action: 'coa_mapping.commit',
    targetTable: 'coa_mapping',
    targetId: params.companyId,
    oldPayload: null,
    newPayload: {
      effectiveFrom: params.effectiveFrom,
      written,
      unchanged: params.entries.length - written,
      versions: versions.map((version) => ({
        sourceCode: version.sourceCode,
        mappingVersion: version.mappingVersion,
        status: version.status,
        accountCode: version.accountCode,
        quarantineReason: version.quarantineReason,
      })),
    },
    occurredAt: params.occurredAt,
  });

  return {
    companyId: params.companyId,
    effectiveFrom: params.effectiveFrom,
    written,
    unchanged: params.entries.length - written,
    report: await getCoaMappingReport(tx, params.companyId, params.effectiveFrom),
  };
}
