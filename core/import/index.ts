// Pure messy-export CSV parser & row-accounting validator (§5.2, §7.6, D5).
// Handles BOM, RFC-4180 quoting/newlines, mixed delimiters, ragged rows, blank/summary rows,
// mixed vs ambiguous dates, messy amount strings, leading-zero codes, duplicates, and unmapped accounts.

import Decimal from 'decimal.js';
import { add, money, negate, parse, serialize, sum, type ParseLocale } from '../money/index.js';
import type { MappingResolution } from '../mapping/index.js';
import { normalizeCode } from '../statements/index.js';

export interface ParsedCsvGrid {
  readonly delimiter: ',' | ';' | '\t';
  readonly headers: readonly string[];
  readonly rows: readonly { readonly rowNo: number; readonly cells: readonly string[] }[];
}

export function detectDelimiter(firstLine: string): ',' | ';' | '\t' {
  const counts: Array<{ delim: ',' | ';' | '\t'; count: number }> = [
    { delim: ',', count: (firstLine.match(/,/g) ?? []).length },
    { delim: ';', count: (firstLine.match(/;/g) ?? []).length },
    { delim: '\t', count: (firstLine.match(/\t/g) ?? []).length },
  ];
  counts.sort((a, b) => b.count - a.count);
  return counts[0]!.delim;
}

export function parseCsvRecords(rawInput: string, forcedDelimiter?: ',' | ';' | '\t'): ParsedCsvGrid {
  // Strip UTF-8 BOM if present
  const text = rawInput.startsWith('\uFEFF') ? rawInput.slice(1) : rawInput;
  const firstBreak = text.search(/\r?\n/);
  const firstLine = firstBreak === -1 ? text : text.slice(0, firstBreak);
  const delimiter = forcedDelimiter ?? detectDelimiter(firstLine);

  const records: Array<{ rowNo: number; cells: string[] }> = [];
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let recordStartRow = 1;
  let currentLineIdx = 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') currentLineIdx += 1;
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      cells.push(field);
      field = '';
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') {
        i += 1;
      }
      cells.push(field);
      records.push({ rowNo: recordStartRow, cells });
      cells = [];
      field = '';
      currentLineIdx += 1;
      recordStartRow = currentLineIdx;
      continue;
    }
    field += ch;
  }

  if (field.length > 0 || cells.length > 0) {
    cells.push(field);
    records.push({ rowNo: recordStartRow, cells });
  }

  if (records.length === 0) {
    return { delimiter, headers: [], rows: [] };
  }

  const headerCells = records[0]!.cells.map((h) => h.trim().toLowerCase());
  const dataRows = records.slice(1);
  return {
    delimiter,
    headers: headerCells,
    rows: dataRows,
  };
}

export type ParsedDateResult =
  | { readonly kind: 'valid'; readonly isoDate: string }
  | { readonly kind: 'quarantine'; readonly reason: string };

export function parseStrictDate(raw: string): ParsedDateResult {
  const s = raw.trim();
  if (s.length === 0) {
    return { kind: 'quarantine', reason: 'EMPTY_DATE' };
  }

  // Unambiguous ISO YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(s);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const monthNum = Number.parseInt(m!, 10);
    const dayNum = Number.parseInt(d!, 10);
    if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) {
      return { kind: 'quarantine', reason: `INVALID_DATE_RANGE:${s}` };
    }
    return { kind: 'valid', isoDate: `${y}-${m}-${d}` };
  }

  // Slash date MM/DD/YYYY vs DD/MM/YYYY: unambiguous only if one component > 12
  const slashMatch = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (slashMatch) {
    const first = Number.parseInt(slashMatch[1]!, 10);
    const second = Number.parseInt(slashMatch[2]!, 10);
    const year = slashMatch[3]!;
    if (first > 12 && second >= 1 && second <= 12) {
      return {
        kind: 'valid',
        isoDate: `${year}-${String(second).padStart(2, '0')}-${String(first).padStart(2, '0')}`,
      };
    }
    if (second > 12 && first >= 1 && first <= 12) {
      return {
        kind: 'valid',
        isoDate: `${year}-${String(first).padStart(2, '0')}-${String(second).padStart(2, '0')}`,
      };
    }
    if (first === second && first >= 1 && first <= 12) {
      return {
        kind: 'valid',
        isoDate: `${year}-${String(first).padStart(2, '0')}-${String(second).padStart(2, '0')}`,
      };
    }
    return { kind: 'quarantine', reason: `AMBIGUOUS_DATE:${s}` };
  }

  return { kind: 'quarantine', reason: `UNSUPPORTED_DATE_FORMAT:${s}` };
}

export interface ImportedGlRow {
  readonly rowNo: number;
  readonly entryRef: string;
  readonly postingDate: string;
  readonly accountCode: string;
  readonly entityCode?: string;
  readonly description: string;
  readonly debit: Decimal;
  readonly credit: Decimal;
}

export interface QuarantinedImportRow {
  readonly rowNo: number;
  readonly reason: string;
}

export interface MessyImportResult {
  readonly rowsIn: number;
  readonly imported: readonly ImportedGlRow[];
  readonly quarantined: readonly QuarantinedImportRow[];
  readonly duplicatesDetected: number;
  readonly totalDebits: Decimal;
  readonly totalCredits: Decimal;
}

export function evaluateMessyGlCsv(params: {
  readonly csvText: string;
  readonly knownAccountCodes: ReadonlySet<string>;
  readonly locale?: ParseLocale;
  /**
   * Optional versioned source→account resolver (SPEC §3.6f). When the server supplies it, the
   * preview and commit share exactly the same resolution; without it the pure parser keeps the
   * original exact-chart-code behaviour used by standalone core tests.
   */
  readonly resolveSourceCode?: (sourceCode: string) => MappingResolution;
}): MessyImportResult {
  const grid = parseCsvRecords(params.csvText);
  const locale = params.locale ?? 'unknown';

  // Build normalized case-insensitive lookup of CoA codes while preserving canonical leading-zero code
  const canonicalByUpper = new Map<string, string>();
  for (const rawCode of params.knownAccountCodes) {
    const norm = normalizeCode(rawCode);
    canonicalByUpper.set(norm.toUpperCase(), norm);
  }

  const colIndex = new Map<string, number>();
  grid.headers.forEach((h, idx) => colIndex.set(h, idx));

  const idxRef = colIndex.get('entry_ref') ?? colIndex.get('ref') ?? 0;
  const idxDate = colIndex.get('date') ?? colIndex.get('posting_date') ?? 1;
  const idxCode = colIndex.get('account_code') ?? colIndex.get('account') ?? 2;
  const idxDesc = colIndex.get('description') ?? colIndex.get('memo') ?? 3;
  const idxEntity = colIndex.get('entity_code') ?? colIndex.get('entity');
  const idxDebit = colIndex.get('debit');
  const idxCredit = colIndex.get('credit');
  const idxSigned = colIndex.get('amount');

  const expectedCols = grid.headers.length;
  const imported: ImportedGlRow[] = [];
  const quarantined: QuarantinedImportRow[] = [];
  const seenRowFingerprints = new Set<string>();
  let duplicatesDetected = 0;

  for (const row of grid.rows) {
    const cells = row.cells;

    // 1. Blank row check
    if (cells.every((c) => c.trim().length === 0)) {
      quarantined.push({ rowNo: row.rowNo, reason: 'BLANK_ROW' });
      continue;
    }

    // 2. Trailing summary / total row check
    const firstNonEmpty = cells.find((c) => c.trim().length > 0)?.trim() ?? '';
    if (/^(?:grand\s+)?totals?\b/i.test(firstNonEmpty)) {
      quarantined.push({ rowNo: row.rowNo, reason: 'SUMMARY_TOTAL_ROW' });
      continue;
    }

    // 3. Ragged / short row check
    if (cells.length !== expectedCols) {
      quarantined.push({
        rowNo: row.rowNo,
        reason: `RAGGED_ROW:expected=${expectedCols}:got=${cells.length}`,
      });
      continue;
    }

    const entryRef = (cells[idxRef] ?? '').trim();
    const rawDate = (cells[idxDate] ?? '').trim();
    const rawCode = (cells[idxCode] ?? '').trim();
    const rawEntity = idxEntity === undefined ? '' : (cells[idxEntity] ?? '').trim();
    const entityCode = rawEntity.length === 0 ? undefined : normalizeCode(rawEntity);
    const description = (cells[idxDesc] ?? '').replace(/\s+/g, ' ').trim();

    if (entryRef.length === 0) {
      quarantined.push({ rowNo: row.rowNo, reason: 'MISSING_ENTRY_REF' });
      continue;
    }

    const dateRes = parseStrictDate(rawDate);
    if (dateRes.kind === 'quarantine') {
      quarantined.push({ rowNo: row.rowNo, reason: dateRes.reason });
      continue;
    }

    if (rawCode.length === 0) {
      quarantined.push({ rowNo: row.rowNo, reason: 'MISSING_ACCOUNT_CODE' });
      continue;
    }
    const normInputCode = normalizeCode(rawCode);
    const resolution: MappingResolution = params.resolveSourceCode?.(normInputCode) ?? (() => {
      const exact = canonicalByUpper.get(normInputCode.toUpperCase());
      return exact === undefined
        ? ({ kind: 'quarantine', reason: `UNMAPPED_ACCOUNT:${normInputCode}` } as const)
        : ({ kind: 'mapped', accountCode: exact } as const);
    })();
    if (resolution.kind === 'quarantine') {
      quarantined.push({ rowNo: row.rowNo, reason: resolution.reason });
      continue;
    }
    const canonicalCode = resolution.accountCode;

    let debit = money('0');
    let credit = money('0');

    if (idxDebit !== undefined && idxCredit !== undefined) {
      const parsedDebit = parse(cells[idxDebit], locale);
      const parsedCredit = parse(cells[idxCredit], locale);

      if (parsedDebit.kind === 'quarantine') {
        quarantined.push({ rowNo: row.rowNo, reason: parsedDebit.reason });
        continue;
      }
      if (parsedCredit.kind === 'quarantine') {
        quarantined.push({ rowNo: row.rowNo, reason: parsedCredit.reason });
        continue;
      }

      if (parsedDebit.kind === 'value') {
        if (parsedDebit.value.isNegative()) {
          // Negative value in debit column is flipped to credit unless zero
          credit = add(credit, negate(parsedDebit.value));
        } else {
          debit = add(debit, parsedDebit.value);
        }
      }
      if (parsedCredit.kind === 'value') {
        if (parsedCredit.value.isNegative()) {
          debit = add(debit, negate(parsedCredit.value));
        } else {
          credit = add(credit, parsedCredit.value);
        }
      }
    } else if (idxSigned !== undefined) {
      const parsedSigned = parse(cells[idxSigned], locale);
      if (parsedSigned.kind === 'quarantine') {
        quarantined.push({ rowNo: row.rowNo, reason: parsedSigned.reason });
        continue;
      }
      if (parsedSigned.kind === 'null') {
        quarantined.push({ rowNo: row.rowNo, reason: 'NULL_AMOUNT' });
        continue;
      }
      if (parsedSigned.value.isNegative()) {
        credit = negate(parsedSigned.value);
      } else {
        debit = parsedSigned.value;
      }
    } else {
      quarantined.push({ rowNo: row.rowNo, reason: 'MISSING_AMOUNT_COLUMNS' });
      continue;
    }

    if (debit.isZero() === credit.isZero()) {
      quarantined.push({ rowNo: row.rowNo, reason: 'INVALID_DEBIT_CREDIT_SIDES' });
      continue;
    }

    const fingerprint = [
      entryRef,
      dateRes.isoDate,
      entityCode ?? '',
      canonicalCode,
      serialize(debit, 2),
      serialize(credit, 2),
    ].join('|');

    if (seenRowFingerprints.has(fingerprint)) {
      duplicatesDetected += 1;
      quarantined.push({ rowNo: row.rowNo, reason: `DUPLICATE_ROW:${entryRef}` });
      continue;
    }
    seenRowFingerprints.add(fingerprint);

    imported.push({
      rowNo: row.rowNo,
      entryRef,
      postingDate: dateRes.isoDate,
      accountCode: canonicalCode,
      ...(entityCode === undefined ? {} : { entityCode }),
      description,
      debit,
      credit,
    });
  }

  return {
    rowsIn: grid.rows.length,
    imported,
    quarantined,
    duplicatesDetected,
    totalDebits: sum(imported.map((r) => r.debit)),
    totalCredits: sum(imported.map((r) => r.credit)),
  };
}
