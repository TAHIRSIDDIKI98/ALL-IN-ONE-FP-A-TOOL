// Pure chart-of-accounts CSV parser & validator (§9.3.4 CoA Mapper, Spine Gate G1).
// No IO, no framework imports: the server feeds it text and persists the result atomically.

import { parseCsvRecords, type ParsedCsvGrid } from '../import/index.js';
import {
  STATEMENT_LINE_MAP,
  expectedNormalSideForType,
  normalizeCode,
  type AccountType,
  type NormalSide,
} from '../statements/index.js';

const ACCOUNT_TYPES: readonly AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];
const NORMAL_SIDES: readonly NormalSide[] = ['debit', 'credit'];

export interface ChartCsvIssue {
  /** 1-based source row (1 = the header row) so the operator can open the file and look. */
  readonly rowNo: number;
  readonly reason: string;
}

export interface ChartCsvAccount {
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly normalSide: NormalSide;
  readonly parentCode: string | null;
  readonly isPostable: boolean;
  readonly statementLineKey: string;
}

export interface ChartCsvParseResult {
  readonly accounts: readonly ChartCsvAccount[];
  readonly issues: readonly ChartCsvIssue[];
  readonly rowCount: number;
}

const HEADER_ALIASES: Readonly<Record<string, readonly string[]>> = {
  code: ['code', 'account_code', 'account code', 'account'],
  name: ['name', 'account_name', 'account name'],
  type: ['type', 'account_type', 'account type'],
  normalSide: ['normal_side', 'normal side', 'side'],
  statementLineKey: ['statement_line_key', 'statement line key', 'statement_line', 'statement line'],
  parentCode: ['parent_code', 'parent code', 'parent'],
  isPostable: ['is_postable', 'postable', 'is_postable?'],
};

function findColumn(headers: readonly string[], aliases: readonly string[]): number {
  for (const alias of aliases) {
    const index = headers.indexOf(alias);
    if (index !== -1) return index;
  }
  return -1;
}

function cell(cells: readonly string[], index: number): string {
  if (index < 0) return '';
  return (cells[index] ?? '').trim();
}

/**
 * Parses a chart-of-accounts CSV. The whole file is validated before anything is written: every
 * rejected row is reported with its row number and a stable reason code, and the caller refuses the
 * entire import when `issues` is non-empty (an all-or-nothing chart, §1.6-7).
 */
export function parseChartCsv(csvText: string): ChartCsvParseResult {
  if (csvText.trim().length === 0) {
    return { accounts: [], issues: [{ rowNo: 1, reason: 'EMPTY_FILE' }], rowCount: 0 };
  }
  const grid: ParsedCsvGrid = parseCsvRecords(csvText);
  if (grid.headers.length === 0) {
    return { accounts: [], issues: [{ rowNo: 1, reason: 'EMPTY_FILE' }], rowCount: 0 };
  }

  const idx = {
    code: findColumn(grid.headers, HEADER_ALIASES['code'] ?? []),
    name: findColumn(grid.headers, HEADER_ALIASES['name'] ?? []),
    type: findColumn(grid.headers, HEADER_ALIASES['type'] ?? []),
    normalSide: findColumn(grid.headers, HEADER_ALIASES['normalSide'] ?? []),
    statementLineKey: findColumn(grid.headers, HEADER_ALIASES['statementLineKey'] ?? []),
    parentCode: findColumn(grid.headers, HEADER_ALIASES['parentCode'] ?? []),
    isPostable: findColumn(grid.headers, HEADER_ALIASES['isPostable'] ?? []),
  };

  const missing: string[] = [];
  if (idx.code === -1) missing.push('code');
  if (idx.name === -1) missing.push('name');
  if (idx.type === -1) missing.push('type');
  if (idx.normalSide === -1) missing.push('normal_side');
  if (idx.statementLineKey === -1) missing.push('statement_line_key');
  if (missing.length > 0) {
    return {
      accounts: [],
      issues: missing.map((column) => ({ rowNo: 1, reason: `MISSING_COLUMN:${column}` })),
      rowCount: grid.rows.length,
    };
  }

  const accounts: ChartCsvAccount[] = [];
  const issues: ChartCsvIssue[] = [];
  const seen = new Set<string>();

  for (const row of grid.rows) {
    // A row is accepted only when it produces no issue at all: the file is all-or-nothing, so an
    // invalid row must never leak a partially-valid account into `accounts`.
    const issuesBefore = issues.length;
    const rawCode = cell(row.cells, idx.code);
    const rawName = cell(row.cells, idx.name);
    const rawType = cell(row.cells, idx.type).toLowerCase();
    const rawSide = cell(row.cells, idx.normalSide).toLowerCase();
    const rawLine = cell(row.cells, idx.statementLineKey);
    const rawParent = cell(row.cells, idx.parentCode);
    const rawPostable = cell(row.cells, idx.isPostable);

    const isBlank = row.cells.every((value) => value.trim().length === 0);
    if (isBlank) {
      issues.push({ rowNo: row.rowNo, reason: 'BLANK_ROW' });
      continue;
    }

    let code: string | null = null;
    if (rawCode.length === 0) {
      issues.push({ rowNo: row.rowNo, reason: 'EMPTY_CODE' });
    } else {
      try {
        code = normalizeCode(rawCode);
      } catch {
        issues.push({ rowNo: row.rowNo, reason: 'EMPTY_CODE' });
      }
    }
    if (code !== null) {
      if (seen.has(code)) {
        issues.push({ rowNo: row.rowNo, reason: `DUPLICATE_CODE:${code}` });
        code = null;
      } else {
        seen.add(code);
      }
    }

    if (rawName.length === 0) issues.push({ rowNo: row.rowNo, reason: 'EMPTY_NAME' });

    if (!ACCOUNT_TYPES.includes(rawType as AccountType)) {
      issues.push({ rowNo: row.rowNo, reason: `INVALID_TYPE:${rawType}` });
    }
    if (!NORMAL_SIDES.includes(rawSide as NormalSide)) {
      issues.push({ rowNo: row.rowNo, reason: `INVALID_NORMAL_SIDE:${rawSide}` });
    }
    if (!STATEMENT_LINE_MAP.has(rawLine)) {
      issues.push({ rowNo: row.rowNo, reason: `UNKNOWN_STATEMENT_LINE:${rawLine}` });
    }

    let parentCode: string | null = null;
    if (rawParent.length > 0) {
      try {
        parentCode = normalizeCode(rawParent);
      } catch {
        issues.push({ rowNo: row.rowNo, reason: 'EMPTY_PARENT_CODE' });
      }
      if (parentCode !== null && code !== null && parentCode === code) {
        issues.push({ rowNo: row.rowNo, reason: `SELF_PARENT:${code}` });
      }
    }

    let isPostable = true;
    if (rawPostable.length > 0) {
      const normalized = rawPostable.toLowerCase();
      if (['true', 'yes', 'y', '1'].includes(normalized)) isPostable = true;
      else if (['false', 'no', 'n', '0'].includes(normalized)) isPostable = false;
      else issues.push({ rowNo: row.rowNo, reason: `INVALID_IS_POSTABLE:${rawPostable}` });
    }

    if (code === null || issues.length !== issuesBefore) continue;

    // The normal side is accepted as given (a mismatch with the type makes the account contra, which
    // the schema records explicitly), so a legitimate contra account is never rejected.
    accounts.push({
      code,
      name: rawName,
      type: rawType as AccountType,
      normalSide: rawSide as NormalSide,
      parentCode,
      isPostable,
      statementLineKey: rawLine,
    });
  }

  issues.sort((a, b) => a.rowNo - b.rowNo);
  return { accounts, issues, rowCount: grid.rows.length };
}

/** Convenience for callers that need the canonical side implied by a type (documentation/tests). */
export function canonicalNormalSide(type: AccountType): NormalSide {
  return expectedNormalSideForType(type);
}
