// Pure budget/plan CSV parser (MASTER_PROMPT §5.7, Spine Gate G4).
// No IO, no framework imports: the server feeds it text, resolves account/period ids and persists
// the lines atomically. Budget amounts NEVER become GL postings — they live in plan_line only.

import { parseCsvRecords, type ParsedCsvGrid } from '../import/index.js';
import { money, parse, serialize, sum, STORAGE_SCALE } from '../money/index.js';
import { normalizeCode } from '../statements/index.js';

export interface BudgetCsvIssue {
  /** 1-based source row (1 = the header row) so the operator can open the file and look. */
  readonly rowNo: number;
  readonly reason: string;
}

export interface BudgetCsvLine {
  /** 1-based source row (1 = the header row) so a repository-level rejection can name the file row. */
  readonly rowNo: number;
  readonly accountCode: string;
  /** Canonical `P01`..`P13` period code inside the fiscal year supplied by the caller. */
  readonly periodCode: string;
  /** Canonical amount at the storage scale (6 dp), sign preserved exactly as supplied. */
  readonly amount: string;
}

export interface BudgetCsvParseResult {
  readonly lines: readonly BudgetCsvLine[];
  readonly issues: readonly BudgetCsvIssue[];
  readonly rowCount: number;
}

const HEADER_ALIASES: Readonly<Record<string, readonly string[]>> = {
  accountCode: ['account_code', 'account code', 'account', 'code'],
  periodCode: ['period', 'period_code', 'period code', 'month'],
  amount: ['amount', 'budget', 'budget_amount', 'budget amount', 'plan', 'plan_amount', 'value'],
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
 * Normalizes a period cell to the canonical `Pnn` form that `/core/calendar` generates.
 * Accepts `P1`, `p01`, `1`, `01`; rejects anything else with `INVALID_PERIOD:<raw>` rather than
 * guessing which period the operator meant.
 */
export function normalizePeriodCode(raw: string): string | null {
  const match = /^[Pp]?0*(\d{1,2})$/.exec(raw.trim());
  if (match === null) return null;
  const periodNo = Number(match[1]);
  if (!Number.isInteger(periodNo) || periodNo < 1 || periodNo > 13) return null;
  return `P${String(periodNo).padStart(2, '0')}`;
}

/**
 * Parses an account × period budget CSV:
 *
 *   account_code,period,amount
 *   4000,P01,12500.00
 *   5000,P01,4200
 *
 * The whole file is validated before anything is written. Every rejected row carries its row number
 * and a stable reason code, and the caller refuses the entire import when `issues` is non-empty
 * (all-or-nothing, §1.6-7). A row is only added to `lines` when it produced no issue at all.
 */
export function parseBudgetCsv(csvText: string): BudgetCsvParseResult {
  if (csvText.trim().length === 0) {
    return { lines: [], issues: [{ rowNo: 1, reason: 'EMPTY_FILE' }], rowCount: 0 };
  }
  const grid: ParsedCsvGrid = parseCsvRecords(csvText);
  if (grid.headers.length === 0) {
    return { lines: [], issues: [{ rowNo: 1, reason: 'EMPTY_FILE' }], rowCount: 0 };
  }

  const idx = {
    accountCode: findColumn(grid.headers, HEADER_ALIASES['accountCode'] ?? []),
    periodCode: findColumn(grid.headers, HEADER_ALIASES['periodCode'] ?? []),
    amount: findColumn(grid.headers, HEADER_ALIASES['amount'] ?? []),
  };

  const missing: string[] = [];
  if (idx.accountCode === -1) missing.push('account_code');
  if (idx.periodCode === -1) missing.push('period');
  if (idx.amount === -1) missing.push('amount');
  if (missing.length > 0) {
    return {
      lines: [],
      issues: missing.map((column) => ({ rowNo: 1, reason: `MISSING_COLUMN:${column}` })),
      rowCount: grid.rows.length,
    };
  }

  const lines: BudgetCsvLine[] = [];
  const issues: BudgetCsvIssue[] = [];
  const seen = new Set<string>();

  for (const row of grid.rows) {
    const issuesBefore = issues.length;
    const isBlank = row.cells.every((value) => value.trim().length === 0);
    if (isBlank) {
      issues.push({ rowNo: row.rowNo, reason: 'BLANK_ROW' });
      continue;
    }

    const rawCode = cell(row.cells, idx.accountCode);
    const rawPeriod = cell(row.cells, idx.periodCode);
    const rawAmount = cell(row.cells, idx.amount);

    let accountCode: string | null = null;
    if (rawCode.length === 0) {
      issues.push({ rowNo: row.rowNo, reason: 'EMPTY_ACCOUNT_CODE' });
    } else {
      try {
        accountCode = normalizeCode(rawCode);
      } catch {
        issues.push({ rowNo: row.rowNo, reason: 'EMPTY_ACCOUNT_CODE' });
      }
    }

    const periodCode = normalizePeriodCode(rawPeriod);
    if (periodCode === null) {
      issues.push({ rowNo: row.rowNo, reason: `INVALID_PERIOD:${rawPeriod}` });
    }

    // Only an ACCEPTED row reserves its (account, period) key: a row that is already rejected must
    // not push a second, misleading DUPLICATE_LINE error onto a later row that is otherwise fine.
    const key =
      accountCode === null || periodCode === null ? null : `${accountCode}|${periodCode}`;
    if (key !== null && seen.has(key)) {
      issues.push({ rowNo: row.rowNo, reason: `DUPLICATE_LINE:${accountCode}/${periodCode}` });
    }

    let amount: string | null = null;
    const parsedAmount = parse(rawAmount, 'unknown');
    if (parsedAmount.kind === 'null') {
      // A blank budget cell is NOT "no plan": refusing it keeps a missing number visible instead of
      // silently planning zero.
      issues.push({ rowNo: row.rowNo, reason: 'NULL_AMOUNT' });
    } else if (parsedAmount.kind === 'quarantine') {
      issues.push({ rowNo: row.rowNo, reason: parsedAmount.reason });
    } else {
      amount = serialize(parsedAmount.value, STORAGE_SCALE);
    }

    if (accountCode === null || periodCode === null || amount === null) continue;
    if (issues.length !== issuesBefore) continue;

    if (key !== null) seen.add(key);
    lines.push({ rowNo: row.rowNo, accountCode, periodCode, amount });
  }

  issues.sort((a, b) => a.rowNo - b.rowNo);
  return { lines, issues, rowCount: grid.rows.length };
}

/** Sums plan amounts as Decimals for callers that need a total (never float math, §5.2). */
export function sumBudgetAmounts(amounts: readonly string[]): string {
  return serialize(sum(amounts.map((amount) => money(amount))), STORAGE_SCALE);
}
