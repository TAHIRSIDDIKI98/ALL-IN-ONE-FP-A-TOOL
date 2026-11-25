import { sha256Hex } from '../../../core/audit/sha256.js';
import { resolvePeriodForDate, type GeneratedPeriod } from '../../../core/calendar/index.js';
import { evaluateMessyGlCsv, parseCsvRecords, type ImportedGlRow } from '../../../core/import/index.js';
import { STORAGE_SCALE, compare, scaleForCurrency, serialize, sum } from '../../../core/money/index.js';
import { expectedNormalSideForType, normalizeCode } from '../../../core/statements/index.js';
import { AppError } from '../../../shared/errors.js';
import type {
  CoaSeedAccount,
  ImportCommitResult,
  ImportPreviewReport,
  QuarantineRecord,
} from '../../../shared/import.js';
import { appendAuditLog } from '../../audit/index.js';
import type { SqlExecutor } from '../migrate.js';

/**
 * Chart-of-accounts seeding and the atomic, idempotent import commit
 * (MASTER_PROMPT §3.4, §4.6, §5.2, §7.6; Spine Gate G1/G2, Schema Gates D3–D5, Corpus Gate C6/C7).
 *
 * Ground rules implemented here:
 *  - ONE transaction: batch, raw rows, entries, lines and the audit row commit together or not at all.
 *  - NOTHING SILENTLY DISCARDED (§1.6-7): every source row is written to `import_row_raw` as
 *    either `imported` or `quarantined` with a reason, and `imported + quarantined == row_count`
 *    is additionally enforced by the database's deferred row-accounting trigger (D5).
 *  - IDEMPOTENT REPLACE (G1/C7): `(company_id, kind, source_hash)` identifies a source. A second
 *    commit of the SAME source flips the previous batch to `replaced` and links it, so exactly one
 *    *active* batch exists per source while different sources (opening balances, monthly actuals)
 *    stay active side by side. Financial rows are NEVER hard-deleted (§4.2):
 *    the replaced batch keeps every raw row and every posting as immutable history, and every
 *    read (trial balance, statements) filters to active batches, so re-import can never
 *    double-count.
 *  - DOUBLE ENTRY (G2/D3/D4): unbalanced journal refs are quarantined whole rather than posted;
 *    balanced refs become one `gl_entry` + its `gl_line` rows, and the DB's deferred trigger
 *    re-proves balance at COMMIT.
 */

interface IdRow extends Record<string, unknown> {
  id: string;
}

interface AccountRow extends Record<string, unknown> {
  id: string;
  code: string;
}

interface PeriodRow extends Record<string, unknown> {
  id: string;
  code: string;
  start_date: string | Date;
  end_date: string | Date;
  is_adjustment: boolean;
  is_53rd_week: boolean;
  fiscal_year: number;
  period_no: number;
  quarter: number;
  label: string;
}

interface CurrencyRow extends Record<string, unknown> {
  base_currency: string;
}

function toIsoDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

/**
 * Seeds a company chart of accounts. Idempotent on `(company_id, code)`: re-seeding the same
 * codes updates name/statement-line and never duplicates accounts. Parent codes are resolved
 * after insertion so ordering in the input file does not matter.
 */
export async function seedChartOfAccounts(
  tx: SqlExecutor,
  params: { readonly companyId: string; readonly accounts: readonly CoaSeedAccount[] },
): Promise<{ readonly inserted: number; readonly updated: number }> {
  let inserted = 0;
  let updated = 0;

  for (const account of params.accounts) {
    const code = normalizeCode(account.code);
    if (code.length === 0) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Chart of accounts contains an empty code.' });
    }
    const expectedSide = expectedNormalSideForType(account.type);
    const isContra = account.normalSide !== expectedSide;

    const res = await tx.query<IdRow>(
      `INSERT INTO account (
         company_id, code, name, type, normal_side, is_contra, is_postable, statement_line_key, version, active
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9)
       ON CONFLICT (company_id, code) DO UPDATE
         SET name = EXCLUDED.name,
             type = EXCLUDED.type,
             normal_side = EXCLUDED.normal_side,
             is_contra = EXCLUDED.is_contra,
             is_postable = EXCLUDED.is_postable,
             statement_line_key = EXCLUDED.statement_line_key,
             active = EXCLUDED.active,
             version = account.version + 1
       RETURNING id, (xmax = 0) AS inserted`,
      [
        params.companyId,
        code,
        account.name,
        account.type,
        account.normalSide,
        isContra,
        account.isPostable,
        account.statementLineKey,
        account.active,
      ],
    );
    const row = res.rows[0] as IdRow & { inserted?: boolean } | undefined;
    if (row === undefined) {
      throw new AppError('INTERNAL_ERROR', { userMessage: `Account ${code} could not be persisted.` });
    }
    if (row.inserted === true) inserted += 1;
    else updated += 1;
  }

  for (const account of params.accounts) {
    if (account.parentCode === null) continue;
    const code = normalizeCode(account.code);
    const parentCode = normalizeCode(account.parentCode);
    const res = await tx.query(
      `UPDATE account child
          SET parent_id = parent.id
         FROM account parent
        WHERE child.company_id = $1
          AND parent.company_id = $1
          AND child.code = $2
          AND parent.code = $3
        RETURNING child.id`,
      [params.companyId, code, parentCode],
    );
    if (res.rows.length === 0) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Account ${code} references parent ${parentCode}, which is not in the chart of accounts.`,
        details: { code, parentCode },
      });
    }
  }

  return { inserted, updated };
}

/**
 * The ACTIVE batch for one SOURCE — `(company_id, kind, source_hash)` — which is the identity the
 * idempotency contract keys on (G1/C7). A different file (e.g. the opening balance sheet and then
 * the monthly actuals) is a different source and stays active: only a re-commit of the SAME source
 * replaces the earlier batch.
 */
async function loadActiveBatch(
  db: SqlExecutor,
  companyId: string,
  kind: 'actuals' | 'budget',
  sourceHash: string,
): Promise<string | null> {
  const res = await db.query<IdRow>(
    `SELECT id
       FROM import_batch
      WHERE company_id = $1 AND kind = $2 AND source_hash = $3 AND status IN ('staged', 'committed')
      ORDER BY imported_at DESC, id DESC
      LIMIT 1`,
    [companyId, kind, sourceHash],
  );
  return res.rows[0]?.id ?? null;
}

/**
 * Batches whose postings are current. Every financial read must filter through this predicate
 * so a replaced batch can never be double-counted (§4.2 append-only replacement).
 */
export function activeBatchPredicate(entryAlias = 'gl_entry'): string {
  // Status AND kind: only an active ACTUALS batch may reach a trial balance, statement or drill, so
  // a batch of another kind could never be counted as actuals even if one were written (§4.2).
  return `EXISTS (
  SELECT 1 FROM import_batch active_batch
   WHERE active_batch.id = ${entryAlias}.batch_id
     AND active_batch.status IN ('staged', 'committed')
     AND active_batch.kind = 'actuals'
)`;
}

export interface ImportCommitParams {
  readonly companyId: string;
  readonly actorId: string;
  readonly kind: 'actuals' | 'budget';
  readonly sourceFilename: string;
  readonly csvText: string;
  readonly occurredAt: string;
}

/**
 * The ONE import classifier (K3: one canonical definition).
 *
 * Both `previewImport` and `commitImport` call this, so the preview can never disagree with the
 * commit about which rows will post: the read-only preview route reports exactly the accounting a
 * commit of the same text would produce (Spine Gate G1, Corpus Gate C6).
 */
export interface PostableImportRow {
  readonly row: ImportedGlRow;
  readonly periodCode: string;
  readonly periodId: string;
}

export interface PostableGroup {
  readonly ref: string;
  readonly rows: readonly PostableImportRow[];
}

export interface ImportClassification {
  readonly rowsIn: number;
  readonly parsedImported: readonly ImportedGlRow[];
  readonly quarantined: readonly QuarantineRecord[];
  readonly duplicatesDetected: number;
  readonly totalDebits: string;
  readonly totalCredits: string;
  readonly entryCount: number;
  readonly sourceHash: string;
  readonly currency: string;
  readonly currencyScale: number;
  readonly entityId: string;
  readonly accountIdByCode: ReadonlyMap<string, string>;
  readonly postable: readonly PostableGroup[];
  readonly rawCellsByRow: ReadonlyMap<number, readonly string[]>;
}

export interface ImportClassificationParams {
  readonly companyId: string;
  readonly csvText: string;
}

export async function classifyImport(
  db: SqlExecutor,
  params: ImportClassificationParams,
): Promise<ImportClassification> {
  if (params.csvText.trim().length === 0) {
    throw new AppError('IMPORT_FILE_UNREADABLE', {
      userMessage: 'The import file is empty.',
    });
  }

  const companyRes = await db.query<CurrencyRow>(
    `SELECT base_currency FROM company WHERE id = $1`,
    [params.companyId],
  );
  const currency = companyRes.rows[0]?.base_currency;
  if (currency === undefined) {
    throw new AppError('NOT_FOUND', { userMessage: 'The company could not be found.' });
  }

  const entityRes = await db.query<IdRow>(
    `SELECT id FROM entity WHERE company_id = $1 AND active = true ORDER BY code ASC LIMIT 1`,
    [params.companyId],
  );
  const entityId = entityRes.rows[0]?.id;
  if (entityId === undefined) {
    throw new AppError('NOT_FOUND', {
      userMessage: 'Add a reporting entity to this company before importing actuals.',
    });
  }

  const accountRes = await db.query<AccountRow>(
    `SELECT id, code FROM account WHERE company_id = $1 AND active = true`,
    [params.companyId],
  );
  const accountIdByCode = new Map(accountRes.rows.map((row) => [row.code, row.id]));

  const periodRes = await db.query<PeriodRow>(
    `SELECT id, code, start_date, end_date, is_adjustment, is_53rd_week, fiscal_year, period_no, quarter, label
       FROM fiscal_period
      WHERE company_id = $1
      ORDER BY fiscal_year ASC, period_no ASC`,
    [params.companyId],
  );
  if (periodRes.rows.length === 0) {
    throw new AppError('PERIOD_NOT_FOUND', {
      userMessage: 'This company has no fiscal periods; complete company setup first.',
    });
  }
  /**
   * Periods are kept PAIRED with their row id. A 12-month calendar reuses `P01`…`P12` in every
   * fiscal year, so resolving a date to a code and then looking the id up by that code silently
   * posts into the wrong year (found by WI-0018: an opening journal dated 2025-12-31 landed in
   * FY2026 P12). Resolution therefore stays positional.
   */
  const periodEntries = periodRes.rows.map((row) => ({
    id: row.id,
    period: {
      fiscalYear: row.fiscal_year,
      fyLabel: `FY${row.fiscal_year}`,
      periodNo: row.period_no,
      code: row.code,
      label: row.label,
      quarter: row.quarter as 1 | 2 | 3 | 4,
      startDate: toIsoDate(row.start_date),
      endDate: toIsoDate(row.end_date),
      is53rdWeek: row.is_53rd_week,
      isAdjustment: row.is_adjustment,
    } satisfies GeneratedPeriod,
  }));
  const periods: GeneratedPeriod[] = periodEntries.map((entry) => entry.period);

  const parsed = evaluateMessyGlCsv({
    csvText: params.csvText,
    knownAccountCodes: new Set(accountIdByCode.keys()),
    locale: 'unknown',
  });

  const rawCellsByRow = new Map<number, readonly string[]>();
  for (const record of parseCsvRecords(params.csvText).rows) {
    rawCellsByRow.set(record.rowNo, record.cells);
  }

  const quarantined: QuarantineRecord[] = parsed.quarantined.map((row) => ({
    rowNo: row.rowNo,
    reason: row.reason,
  }));

  // 1. Every imported row must resolve to a fiscal period of THIS company's calendar (§4.6).
  const rowsWithPeriod: PostableImportRow[] = [];
  for (const row of parsed.imported) {
    const period = resolvePeriodForDate(periods, row.postingDate);
    const matchIndex = period === null ? -1 : periods.indexOf(period);
    const periodId = matchIndex < 0 ? undefined : periodEntries[matchIndex]?.id;
    if (period === null || periodId === undefined) {
      quarantined.push({ rowNo: row.rowNo, reason: `PERIOD_NOT_FOUND:${row.postingDate}` });
      continue;
    }
    rowsWithPeriod.push({ row, periodCode: period.code, periodId });
  }

  // 2. Double-entry gate: a journal ref posts only if it balances to the cent. An unbalanced ref
  //    is quarantined whole — never posted unbalanced, never partially posted.
  const byRef = new Map<string, PostableImportRow[]>();
  for (const entry of rowsWithPeriod) {
    const bucket = byRef.get(entry.row.entryRef);
    if (bucket === undefined) byRef.set(entry.row.entryRef, [entry]);
    else bucket.push(entry);
  }

  const postable: PostableGroup[] = [];
  for (const [ref, rows] of byRef) {
    const debits = sum(rows.map((r) => r.row.debit));
    const credits = sum(rows.map((r) => r.row.credit));
    if (compare(debits, credits) !== 0) {
      for (const entry of rows) {
        quarantined.push({ rowNo: entry.row.rowNo, reason: `UNBALANCED_ENTRY:${ref}` });
      }
      continue;
    }
    postable.push({ ref, rows });
  }

  quarantined.sort((a, b) => a.rowNo - b.rowNo);

  // Totals describe what was actually POSTED, never what was merely parsed — a quarantined
  // journal must not inflate the reported debit/credit totals (§1.6-1).
  const postedRows = postable.flatMap((group) => group.rows.map((entry) => entry.row));
  const totalDebits = sum(postedRows.map((row) => row.debit));
  const totalCredits = sum(postedRows.map((row) => row.credit));
  return {
    rowsIn: parsed.rowsIn,
    parsedImported: parsed.imported,
    quarantined,
    duplicatesDetected: parsed.duplicatesDetected,
    totalDebits: serialize(totalDebits, scaleForCurrency(currency)),
    totalCredits: serialize(totalCredits, scaleForCurrency(currency)),
    entryCount: postable.length,
    sourceHash: sha256Hex(params.csvText),
    currency,
    currencyScale: scaleForCurrency(currency),
    entityId,
    accountIdByCode,
    postable,
    rawCellsByRow,
  };
}

export async function commitImport(
  tx: SqlExecutor,
  params: ImportCommitParams,
): Promise<ImportCommitResult> {
  /**
   * G4 is not implemented yet: a budget belongs in `plan_version`/`plan_line`, which the read models
   * do not consume. Posting a budget file as journals here would silently mix plan numbers into the
   * trial balance and every statement, so the commit refuses it and writes nothing (§1.4-1, §13.3).
   */
  if (params.kind !== 'actuals') {
    throw new AppError('VALIDATION_FAILED', {
      userMessage:
        'Only actuals can be committed in this build. A budget is stored as plan lines (a later spine item), and posting it as a journal would corrupt the trial balance.',
      details: { kind: params.kind, supportedKinds: ['actuals'] },
    });
  }

  const classification = await classifyImport(tx, {
    companyId: params.companyId,
    csvText: params.csvText,
  });
  const {
    rowsIn,
    parsedImported,
    quarantined,
    duplicatesDetected,
    sourceHash,
    currency,
    currencyScale,
    entityId,
    accountIdByCode,
    postable,
    rawCellsByRow,
  } = classification;
  const priorBatchId = await loadActiveBatch(tx, params.companyId, params.kind, sourceHash);

  if (priorBatchId !== null) {
    await tx.query(
      `UPDATE import_batch SET status = 'replaced' WHERE company_id = $1 AND id = $2`,
      [params.companyId, priorBatchId],
    );
  }

  const batchRes = await tx.query<IdRow>(
    `INSERT INTO import_batch (
       company_id, kind, source_filename, source_hash, row_count, status, replaced_batch_id, imported_by
     )
     VALUES ($1, $2, $3, $4, $5, 'staged', $6, $7)
     RETURNING id`,
    [
      params.companyId,
      params.kind,
      params.sourceFilename,
      sourceHash,
      rowsIn,
      priorBatchId,
      params.actorId,
    ],
  );
  const batchId = batchRes.rows[0]?.id;
  if (batchId === undefined) {
    throw new AppError('INTERNAL_ERROR', { userMessage: 'The import batch could not be created.' });
  }

  const importedRowIds = new Map<number, string>();
  const postableRowNos = new Set<number>();
  for (const group of postable) for (const entry of group.rows) postableRowNos.add(entry.row.rowNo);
  const quarantineByRow = new Map(quarantined.map((q) => [q.rowNo, q.reason]));

  const rowNos = [...rawCellsByRow.keys()].sort((a, b) => a - b);
  for (const rowNo of rowNos) {
    const cells = rawCellsByRow.get(rowNo) ?? [];
    const isPostable = postableRowNos.has(rowNo);
    const reason = quarantineByRow.get(rowNo);
    if (!isPostable && reason === undefined) {
      throw new AppError('IMPORT_TIE_OUT_FAILED', {
        userMessage: `Import row ${rowNo} was neither posted nor quarantined; the batch is unsafe to commit.`,
        details: { rowNo },
      });
    }
    const importedRow = parsedImported.find((r) => r.rowNo === rowNo);
    const parsedFields =
      importedRow === undefined
        ? { reason: reason ?? 'UNKNOWN' }
        : {
            entryRef: importedRow.entryRef,
            postingDate: importedRow.postingDate,
            accountCode: importedRow.accountCode,
            description: importedRow.description,
            debit: serialize(importedRow.debit, STORAGE_SCALE),
            credit: serialize(importedRow.credit, STORAGE_SCALE),
            ...(isPostable ? {} : { reason: reason ?? 'UNKNOWN' }),
          };

    const insertedRow = await tx.query<IdRow>(
      `INSERT INTO import_row_raw (
         company_id, batch_id, row_no, raw_payload, parsed_fields, status, quarantine_reason
       )
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
       RETURNING id`,
      [
        params.companyId,
        batchId,
        rowNo,
        JSON.stringify({ cells }),
        JSON.stringify(parsedFields),
        isPostable ? 'imported' : 'quarantined',
        isPostable ? null : (reason ?? 'QUARANTINED'),
      ],
    );
    const rowId = insertedRow.rows[0]?.id;
    if (rowId === undefined) {
      throw new AppError('INTERNAL_ERROR', { userMessage: `Import row ${rowNo} could not be persisted.` });
    }
    if (isPostable) importedRowIds.set(rowNo, rowId);
  }

  let entryCreated = 0;
  for (const group of postable) {
    const debits = sum(group.rows.map((r) => r.row.debit));
    const credits = sum(group.rows.map((r) => r.row.credit));
    const first = group.rows[0];
    if (first === undefined) continue;

    const entryRes = await tx.query<IdRow>(
      `INSERT INTO gl_entry (
         company_id, batch_id, period_id, entity_id, entry_date, source_ref, currency, total_debit, total_credit
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        params.companyId,
        batchId,
        first.periodId,
        entityId,
        first.row.postingDate,
        group.ref,
        currency,
        serialize(debits, STORAGE_SCALE),
        serialize(credits, STORAGE_SCALE),
      ],
    );
    const entryId = entryRes.rows[0]?.id;
    if (entryId === undefined) {
      throw new AppError('INTERNAL_ERROR', {
        userMessage: `Journal entry ${group.ref} could not be persisted.`,
      });
    }
    entryCreated += 1;

    for (const entry of group.rows) {
      const accountId = accountIdByCode.get(entry.row.accountCode);
      const sourceRowId = importedRowIds.get(entry.row.rowNo);
      if (accountId === undefined || sourceRowId === undefined) {
        throw new AppError('INTERNAL_ERROR', {
          userMessage: `Journal line ${entry.row.rowNo} could not be resolved to an account.`,
        });
      }
      await tx.query(
        `INSERT INTO gl_line (
           company_id, entry_id, account_id, period_id, entity_id, debit, credit, source_row_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          params.companyId,
          entryId,
          accountId,
          entry.periodId,
          entityId,
          serialize(entry.row.debit, STORAGE_SCALE),
          serialize(entry.row.credit, STORAGE_SCALE),
          sourceRowId,
        ],
      );
    }
  }

  await tx.query(`UPDATE import_batch SET status = 'committed' WHERE company_id = $1 AND id = $2`, [
    params.companyId,
    batchId,
  ]);

  await appendAuditLog(tx, {
    companyId: params.companyId,
    actorId: params.actorId,
    action: 'import.commit',
    targetTable: 'import_batch',
    targetId: batchId,
    oldPayload: priorBatchId === null ? null : { replacedBatchId: priorBatchId },
    newPayload: {
      kind: params.kind,
      sourceFilename: params.sourceFilename,
      sourceHash,
      rowsIn,
      imported: importedRowIds.size,
      quarantined: quarantined.length,
      entries: entryCreated,
      totalDebits: classification.totalDebits,
      totalCredits: classification.totalCredits,
    },
    occurredAt: params.occurredAt,
  });

  return {
    batchId,
    replacedBatchId: priorBatchId,
    rowsIn,
    importedCount: importedRowIds.size,
    quarantinedCount: quarantined.length,
    duplicatesDetected,
    totalDebits: classification.totalDebits,
    totalCredits: classification.totalCredits,
    entryCount: entryCreated,
    sourceHash,
    quarantined: [...quarantined],
  };
}

/**
 * Read-only preview over the SAME classifier the commit uses (§9.3.3, Spine Gate G1). Nothing is
 * written: no batch, no raw row, no posting, no audit entry. The counts reported here are exactly
 * the counts a commit of the same text would produce, which is what makes the wizard's row
 * accounting honest before and after the commit.
 */
export async function previewImport(
  db: SqlExecutor,
  params: ImportClassificationParams,
): Promise<ImportPreviewReport> {
  const classification = await classifyImport(db, params);
  const postedRows = classification.postable.flatMap((group) => group.rows);
  return {
    companyId: params.companyId,
    rowsIn: classification.rowsIn,
    importedCount: postedRows.length,
    quarantinedCount: classification.quarantined.length,
    duplicatesDetected: classification.duplicatesDetected,
    entryCount: classification.postable.length,
    totalDebits: classification.totalDebits,
    totalCredits: classification.totalCredits,
    imported: postedRows.map((entry) => ({
      rowNo: entry.row.rowNo,
      entryRef: entry.row.entryRef,
      postingDate: entry.row.postingDate,
      accountCode: entry.row.accountCode,
      description: entry.row.description,
      debit: serialize(entry.row.debit, classification.currencyScale),
      credit: serialize(entry.row.credit, classification.currencyScale),
    })),
    quarantined: [...classification.quarantined],
  };
}
