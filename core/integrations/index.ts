// Pure Integration & Connector Normalization Kernel (§11.1, CON1–CON5).
// Normalizes Google Sheets, QuickBooks Online, and Xero payloads into ONE canonical shape,
// reconciles entry & batch balance/currency/row counts, and projects matched batches into CSV
// for the single existing import pipeline (CON1 — never a second GL ingestion engine).

import Decimal from 'decimal.js';
import { canonicalJson, sha256Hex } from '../audit/index.js';
import { parseStrictDate } from '../import/index.js';
import {
  add,
  compare,
  money,
  negate,
  parse,
  scaleForCurrency,
  serialize,
  sum,
} from '../money/index.js';
import { normalizeCode } from '../statements/index.js';

export type ConnectorSourceSystem = 'google_sheets' | 'quickbooks_online' | 'xero';

export interface NormalizedEntryLine {
  readonly account_code: string;
  readonly description: string;
  readonly debit: string;
  readonly credit: string;
  readonly dims: Readonly<Record<string, string>>;
}

export interface NormalizedJournalEntry {
  readonly source_system: ConnectorSourceSystem;
  readonly entry_ref: string;
  readonly entry_date: string;
  readonly period: string;
  readonly currency: string;
  readonly lines: readonly NormalizedEntryLine[];
  readonly source_row_hash: string;
}

export interface GoogleSheetsRowInput {
  readonly entryRef: string;
  readonly date: string;
  readonly period?: string;
  readonly accountCode: string;
  readonly description?: string;
  readonly debit?: string;
  readonly credit?: string;
  readonly dims?: Readonly<Record<string, string>>;
}

export interface GoogleSheetsSyncInput {
  readonly sourceSystem: 'google_sheets';
  readonly currency?: string;
  readonly expectedRowCount?: number;
  readonly rows: readonly GoogleSheetsRowInput[];
}

export interface QuickBooksJournalLineInput {
  readonly Description?: string;
  readonly Amount: string;
  readonly DetailType?: 'JournalEntryLineDetail';
  readonly JournalEntryLineDetail: {
    readonly PostingType: 'Debit' | 'Credit';
    readonly AccountRef: {
      readonly value: string;
      readonly name?: string;
    };
    readonly DepartmentRef?: {
      readonly name: string;
    };
    readonly ClassRef?: {
      readonly name: string;
    };
  };
}

export interface QuickBooksJournalEntryInput {
  readonly Id: string;
  readonly DocNumber?: string;
  readonly TxnDate: string;
  readonly Period?: string;
  readonly CurrencyRef: {
    readonly value: string;
  };
  readonly PrivateNote?: string;
  readonly Line: readonly QuickBooksJournalLineInput[];
}

export interface QuickBooksSyncInput {
  readonly sourceSystem: 'quickbooks_online';
  readonly currency?: string;
  readonly expectedRowCount?: number;
  readonly journalEntries: readonly QuickBooksJournalEntryInput[];
}

export interface XeroJournalLineInput {
  readonly AccountCode: string;
  readonly Description?: string;
  readonly LineAmount: string;
  readonly Tracking?: readonly {
    readonly Name: string;
    readonly Option: string;
  }[];
}

export interface XeroManualJournalInput {
  readonly ManualJournalID: string;
  readonly Narration?: string;
  readonly Date: string;
  readonly Period?: string;
  readonly CurrencyCode: string;
  readonly JournalLines: readonly XeroJournalLineInput[];
}

export interface XeroSyncInput {
  readonly sourceSystem: 'xero';
  readonly currency?: string;
  readonly expectedRowCount?: number;
  readonly manualJournals: readonly XeroManualJournalInput[];
}

export type ConnectorSyncInput =
  | GoogleSheetsSyncInput
  | QuickBooksSyncInput
  | XeroSyncInput;

export interface NormalizedConnectorBatch {
  readonly sourceSystem: ConnectorSourceSystem;
  readonly currency: string;
  readonly expectedRowCount: number | null;
  readonly entries: readonly NormalizedJournalEntry[];
  readonly lineCount: number;
  readonly totalDebits: string;
  readonly totalCredits: string;
  readonly batchHash: string;
}

export interface ReconciliationResult {
  readonly status: 'matched' | 'mismatch_quarantined';
  readonly reasons: readonly string[];
  readonly reasonSummary: string | null;
  readonly totalDebits: string;
  readonly totalCredits: string;
  readonly lineCount: number;
}

function cleanText(raw: string | undefined): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim();
}

function cleanDims(raw: Readonly<Record<string, string>> | undefined): Readonly<Record<string, string>> {
  if (!raw) return {};
  const sortedKeys = Object.keys(raw)
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
    .sort();
  const out: Record<string, string> = {};
  for (const key of sortedKeys) {
    const val = (raw[key] ?? '').trim();
    if (val.length > 0) out[key] = val;
  }
  return out;
}

function requireValidDate(rawDate: string, contextLabel: string): string {
  const res = parseStrictDate(rawDate);
  if (res.kind === 'quarantine') {
    throw new Error(`CONNECTOR_INVALID_DATE:${contextLabel}:${res.reason}`);
  }
  return res.isoDate;
}

function parseStrictMoneyOrZero(raw: string | undefined, contextLabel: string): Decimal {
  const parsed = parse(raw ?? '', 'unknown');
  if (parsed.kind === 'quarantine') {
    throw new Error(`CONNECTOR_INVALID_AMOUNT:${contextLabel}:${parsed.reason}`);
  }
  return parsed.kind === 'null' ? money('0') : parsed.value;
}

function parseStrictNonNullMoney(raw: string, contextLabel: string): Decimal {
  const parsed = parse(raw, 'unknown');
  if (parsed.kind === 'quarantine') {
    throw new Error(`CONNECTOR_INVALID_AMOUNT:${contextLabel}:${parsed.reason}`);
  }
  if (parsed.kind === 'null') {
    throw new Error(`CONNECTOR_NULL_AMOUNT:${contextLabel}`);
  }
  return parsed.value;
}

function resolveCurrencyScale(currency: string): number {
  const upper = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(upper)) {
    throw new Error(`CONNECTOR_INVALID_CURRENCY:${currency}`);
  }
  return scaleForCurrency(upper);
}

function buildEntryWithHash(params: {
  readonly sourceSystem: ConnectorSourceSystem;
  readonly entryRef: string;
  readonly entryDate: string;
  readonly period: string;
  readonly currency: string;
  readonly lines: readonly NormalizedEntryLine[];
}): NormalizedJournalEntry {
  const base = {
    source_system: params.sourceSystem,
    entry_ref: params.entryRef,
    entry_date: params.entryDate,
    period: params.period,
    currency: params.currency,
    lines: params.lines,
  };
  return {
    ...base,
    source_row_hash: sha256Hex(canonicalJson(base)),
  };
}

function normalizeGoogleSheets(
  payload: GoogleSheetsSyncInput,
  defaultCurrency: string,
): {
  readonly currency: string;
  readonly entries: readonly NormalizedJournalEntry[];
  readonly lineCount: number;
} {
  if (payload.rows.length === 0) {
    throw new Error('CONNECTOR_EMPTY_PAYLOAD:google_sheets');
  }
  const currency = (payload.currency ?? defaultCurrency).trim().toUpperCase();
  const scale = resolveCurrencyScale(currency);

  interface GroupedSheetsEntry {
    readonly entryRef: string;
    readonly entryDate: string;
    readonly period: string;
    readonly lines: NormalizedEntryLine[];
  }

  const grouped = new Map<string, GroupedSheetsEntry>();
  let lineCount = 0;

  for (let i = 0; i < payload.rows.length; i += 1) {
    const row = payload.rows[i]!;
    const rowLabel = `google_sheets.row[${i + 1}]`;
    const entryRef = cleanText(row.entryRef);
    if (entryRef.length === 0) {
      throw new Error(`CONNECTOR_MISSING_REF:${rowLabel}`);
    }
    const entryDate = requireValidDate(row.date, rowLabel);
    const period = cleanText(row.period) || entryDate.slice(0, 7);
    const accountCode = normalizeCode(row.accountCode);
    if (accountCode.length === 0) {
      throw new Error(`CONNECTOR_MISSING_ACCOUNT:${rowLabel}`);
    }

    const rawDebit = parseStrictMoneyOrZero(row.debit, `${rowLabel}.debit`);
    const rawCredit = parseStrictMoneyOrZero(row.credit, `${rowLabel}.credit`);

    let debit = money('0');
    let credit = money('0');
    if (rawDebit.isNegative()) {
      credit = add(credit, negate(rawDebit));
    } else {
      debit = add(debit, rawDebit);
    }
    if (rawCredit.isNegative()) {
      debit = add(debit, negate(rawCredit));
    } else {
      credit = add(credit, rawCredit);
    }

    const normalizedLine: NormalizedEntryLine = {
      account_code: accountCode,
      description: cleanText(row.description),
      debit: serialize(debit, scale),
      credit: serialize(credit, scale),
      dims: cleanDims(row.dims),
    };
    lineCount += 1;

    const existing = grouped.get(entryRef);
    if (!existing) {
      grouped.set(entryRef, {
        entryRef,
        entryDate,
        period,
        lines: [normalizedLine],
      });
    } else {
      if (existing.entryDate !== entryDate) {
        throw new Error(
          `CONNECTOR_MIXED_ENTRY_DATE:${entryRef}:${existing.entryDate}:${entryDate}`,
        );
      }
      existing.lines.push(normalizedLine);
    }
  }

  const entries: NormalizedJournalEntry[] = [];
  for (const group of grouped.values()) {
    entries.push(
      buildEntryWithHash({
        sourceSystem: 'google_sheets',
        entryRef: group.entryRef,
        entryDate: group.entryDate,
        period: group.period,
        currency,
        lines: group.lines,
      }),
    );
  }

  return { currency, entries, lineCount };
}

function normalizeQuickBooks(
  payload: QuickBooksSyncInput,
  defaultCurrency: string,
): {
  readonly currency: string;
  readonly entries: readonly NormalizedJournalEntry[];
  readonly lineCount: number;
} {
  if (payload.journalEntries.length === 0) {
    throw new Error('CONNECTOR_EMPTY_PAYLOAD:quickbooks_online');
  }
  const batchCurrency = (
    payload.currency ??
    payload.journalEntries[0]?.CurrencyRef.value ??
    defaultCurrency
  )
    .trim()
    .toUpperCase();
  resolveCurrencyScale(batchCurrency);

  const entries: NormalizedJournalEntry[] = [];
  let lineCount = 0;

  for (let i = 0; i < payload.journalEntries.length; i += 1) {
    const je = payload.journalEntries[i]!;
    const entryLabel = `quickbooks_online.je[${i + 1}]`;
    const entryRef = cleanText(je.DocNumber ?? je.Id);
    if (entryRef.length === 0) {
      throw new Error(`CONNECTOR_MISSING_REF:${entryLabel}`);
    }
    const entryDate = requireValidDate(je.TxnDate, entryLabel);
    const period = cleanText(je.Period) || entryDate.slice(0, 7);
    const entryCurrency = je.CurrencyRef.value.trim().toUpperCase();
    const scale = resolveCurrencyScale(entryCurrency);

    const lines: NormalizedEntryLine[] = [];
    for (let j = 0; j < je.Line.length; j += 1) {
      const line = je.Line[j]!;
      const lineLabel = `${entryLabel}.line[${j + 1}]`;
      const accountCode = normalizeCode(line.JournalEntryLineDetail.AccountRef.value);
      if (accountCode.length === 0) {
        throw new Error(`CONNECTOR_MISSING_ACCOUNT:${lineLabel}`);
      }
      const parsedVal = parseStrictNonNullMoney(line.Amount, lineLabel);
      let debit = money('0');
      let credit = money('0');
      if (line.JournalEntryLineDetail.PostingType === 'Debit') {
        if (parsedVal.isNegative()) {
          credit = negate(parsedVal);
        } else {
          debit = parsedVal;
        }
      } else {
        if (parsedVal.isNegative()) {
          debit = negate(parsedVal);
        } else {
          credit = parsedVal;
        }
      }

      const rawDims: Record<string, string> = {};
      if (line.JournalEntryLineDetail.DepartmentRef?.name) {
        rawDims['department'] = line.JournalEntryLineDetail.DepartmentRef.name;
      }
      if (line.JournalEntryLineDetail.ClassRef?.name) {
        rawDims['class'] = line.JournalEntryLineDetail.ClassRef.name;
      }

      lines.push({
        account_code: accountCode,
        description: cleanText(line.Description ?? je.PrivateNote),
        debit: serialize(debit, scale),
        credit: serialize(credit, scale),
        dims: cleanDims(rawDims),
      });
      lineCount += 1;
    }

    entries.push(
      buildEntryWithHash({
        sourceSystem: 'quickbooks_online',
        entryRef,
        entryDate,
        period,
        currency: entryCurrency,
        lines,
      }),
    );
  }

  return { currency: batchCurrency, entries, lineCount };
}

function normalizeXero(
  payload: XeroSyncInput,
  defaultCurrency: string,
): {
  readonly currency: string;
  readonly entries: readonly NormalizedJournalEntry[];
  readonly lineCount: number;
} {
  if (payload.manualJournals.length === 0) {
    throw new Error('CONNECTOR_EMPTY_PAYLOAD:xero');
  }
  const batchCurrency = (
    payload.currency ??
    payload.manualJournals[0]?.CurrencyCode ??
    defaultCurrency
  )
    .trim()
    .toUpperCase();
  resolveCurrencyScale(batchCurrency);

  const entries: NormalizedJournalEntry[] = [];
  let lineCount = 0;

  for (let i = 0; i < payload.manualJournals.length; i += 1) {
    const mj = payload.manualJournals[i]!;
    const entryLabel = `xero.manualJournal[${i + 1}]`;
    const entryRef = cleanText(mj.ManualJournalID);
    if (entryRef.length === 0) {
      throw new Error(`CONNECTOR_MISSING_REF:${entryLabel}`);
    }
    const entryDate = requireValidDate(mj.Date, entryLabel);
    const period = cleanText(mj.Period) || entryDate.slice(0, 7);
    const entryCurrency = mj.CurrencyCode.trim().toUpperCase();
    const scale = resolveCurrencyScale(entryCurrency);

    const lines: NormalizedEntryLine[] = [];
    for (let j = 0; j < mj.JournalLines.length; j += 1) {
      const line = mj.JournalLines[j]!;
      const lineLabel = `${entryLabel}.line[${j + 1}]`;
      const accountCode = normalizeCode(line.AccountCode);
      if (accountCode.length === 0) {
        throw new Error(`CONNECTOR_MISSING_ACCOUNT:${lineLabel}`);
      }
      const signedVal = parseStrictNonNullMoney(line.LineAmount, lineLabel);
      let debit = money('0');
      let credit = money('0');
      if (signedVal.isNegative()) {
        credit = negate(signedVal);
      } else {
        debit = signedVal;
      }

      const rawDims: Record<string, string> = {};
      for (const track of line.Tracking ?? []) {
        const key = track.Name.trim().toLowerCase().replace(/\s+/g, '_');
        if (key.length > 0 && track.Option.trim().length > 0) {
          rawDims[key] = track.Option.trim();
        }
      }

      lines.push({
        account_code: accountCode,
        description: cleanText(line.Description ?? mj.Narration),
        debit: serialize(debit, scale),
        credit: serialize(credit, scale),
        dims: cleanDims(rawDims),
      });
      lineCount += 1;
    }

    entries.push(
      buildEntryWithHash({
        sourceSystem: 'xero',
        entryRef,
        entryDate,
        period,
        currency: entryCurrency,
        lines,
      }),
    );
  }

  return { currency: batchCurrency, entries, lineCount };
}

/**
 * Pure adapter dispatcher normalizing Google Sheets, QuickBooks Online, or Xero
 * payloads into ONE canonical CON1 batch shape with exact decimal strings and SHA-256 hashes.
 */
export function normalizeConnectorPayload(params: {
  readonly payload: ConnectorSyncInput;
  readonly baseCurrency: string;
}): NormalizedConnectorBatch {
  const defaultCurrency = params.baseCurrency.trim().toUpperCase();
  resolveCurrencyScale(defaultCurrency);

  const normalized =
    params.payload.sourceSystem === 'google_sheets'
      ? normalizeGoogleSheets(params.payload, defaultCurrency)
      : params.payload.sourceSystem === 'quickbooks_online'
        ? normalizeQuickBooks(params.payload, defaultCurrency)
        : normalizeXero(params.payload, defaultCurrency);

  const scale = resolveCurrencyScale(normalized.currency);
  const allDebitVals: Decimal[] = [];
  const allCreditVals: Decimal[] = [];

  for (const entry of normalized.entries) {
    for (const line of entry.lines) {
      allDebitVals.push(money(line.debit));
      allCreditVals.push(money(line.credit));
    }
  }

  const totalDebitsDec = sum(allDebitVals);
  const totalCreditsDec = sum(allCreditVals);
  const batchHash = sha256Hex(
    canonicalJson({
      sourceSystem: params.payload.sourceSystem,
      currency: normalized.currency,
      entries: normalized.entries,
    }),
  );

  return {
    sourceSystem: params.payload.sourceSystem,
    currency: normalized.currency,
    expectedRowCount:
      params.payload.expectedRowCount === undefined ? null : params.payload.expectedRowCount,
    entries: normalized.entries,
    lineCount: normalized.lineCount,
    totalDebits: serialize(totalDebitsDec, scale),
    totalCredits: serialize(totalCreditsDec, scale),
    batchHash,
  };
}

/**
 * CON3 Reconciliation Gate (§11.1):
 * Verifies currency agreement, declared source row count, single-sided line discipline,
 * per-entry double-entry balance, and overall batch balance. Any mismatch produces
 * 'mismatch_quarantined' with deterministic reasons so zero postings hit the GL.
 */
export function reconcileNormalizedBatch(params: {
  readonly batch: NormalizedConnectorBatch;
  readonly expectedCurrency: string;
}): ReconciliationResult {
  const expectedCurr = params.expectedCurrency.trim().toUpperCase();
  const scale = resolveCurrencyScale(expectedCurr);
  const reasons: string[] = [];

  if (params.batch.expectedRowCount !== null && params.batch.expectedRowCount !== params.batch.lineCount) {
    reasons.push(
      `ROW_COUNT_MISMATCH:expected=${params.batch.expectedRowCount}:got=${params.batch.lineCount}`,
    );
  }

  if (params.batch.currency !== expectedCurr) {
    reasons.push(`CURRENCY_MISMATCH:expected=${expectedCurr}:got=${params.batch.currency}`);
  }

  for (const entry of params.batch.entries) {
    if (entry.currency !== expectedCurr) {
      reasons.push(
        `CURRENCY_MISMATCH:ref=${entry.entry_ref}:expected=${expectedCurr}:got=${entry.currency}`,
      );
    }

    const entryDebits: Decimal[] = [];
    const entryCredits: Decimal[] = [];

    for (const line of entry.lines) {
      const d = money(line.debit);
      const c = money(line.credit);
      if (d.isZero() === c.isZero()) {
        reasons.push(`INVALID_DEBIT_CREDIT_SIDES:ref=${entry.entry_ref}:account=${line.account_code}`);
      }
      entryDebits.push(d);
      entryCredits.push(c);
    }

    const entryDebitSum = sum(entryDebits);
    const entryCreditSum = sum(entryCredits);
    if (compare(entryDebitSum, entryCreditSum) !== 0) {
      reasons.push(
        `RECONCILIATION_IMBALANCE:ref=${entry.entry_ref}:debit=${serialize(entryDebitSum, scale)}:credit=${serialize(entryCreditSum, scale)}`,
      );
    }
  }

  const batchDebits = money(params.batch.totalDebits);
  const batchCredits = money(params.batch.totalCredits);
  if (compare(batchDebits, batchCredits) !== 0 && reasons.every((r) => !r.startsWith('RECONCILIATION_IMBALANCE'))) {
    reasons.push(
      `RECONCILIATION_IMBALANCE:batch:debit=${params.batch.totalDebits}:credit=${params.batch.totalCredits}`,
    );
  }

  const status = reasons.length === 0 ? 'matched' : 'mismatch_quarantined';
  return {
    status,
    reasons,
    reasonSummary: reasons.length === 0 ? null : reasons.join('; '),
    totalDebits: params.batch.totalDebits,
    totalCredits: params.batch.totalCredits,
    lineCount: params.batch.lineCount,
  };
}

function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * CON1 Pipeline Projection (§11.1):
 * Projects canonical NormalizedJournalEntry rows into RFC-4180 CSV consumed by the ONE
 * existing `commitImport` GL ingestion pipeline (leading-zero codes and decimals preserved verbatim).
 */
export function normalizedEntriesToImportCsv(
  entries: readonly NormalizedJournalEntry[],
): string {
  const lines: string[] = ['entry_ref,date,account_code,description,debit,credit'];
  for (const entry of entries) {
    for (const line of entry.lines) {
      lines.push(
        [
          escapeCsvCell(entry.entry_ref),
          escapeCsvCell(entry.entry_date),
          escapeCsvCell(line.account_code),
          escapeCsvCell(line.description),
          escapeCsvCell(line.debit),
          escapeCsvCell(line.credit),
        ].join(','),
      );
    }
  }
  return lines.join('\n');
}
