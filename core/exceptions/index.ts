// Extracted from FPA-modular/docs/07_EXCEPTION_RULES_CATALOG.md @ cbaf0e44dbf8a51d4b7732e471d48262f3dc8c69. Class C.
// Rule catalog (EXC-001..EXC-028), canonical finding keys, "Potential exception — review" wording,
// explicit not_run disclosures, <=90-day waiver lifecycle, and balanced reversal-only rectification
// suggestions implemented strictly via /core/money Decimal arithmetic and /core/audit SHA-256.

import Decimal from 'decimal.js';
import { sha256Hex } from '../audit/index.js';
import {
  add,
  compare,
  div,
  eq,
  isZero,
  money,
  mul,
  negate,
  round,
  scaleForCurrency,
  serialize,
  STORAGE_SCALE,
  sub,
  sum,
} from '../money/index.js';

export type ExceptionSeverity = 'high' | 'medium' | 'low';

export type ExceptionStatus =
  | 'new'
  | 'acknowledged'
  | 'explained'
  | 'corrected'
  | 'verified'
  | 'closed'
  | 'waived';

export type ExceptionTransitionAction =
  | 'assign'
  | 'acknowledge'
  | 'explain'
  | 'verify'
  | 'close'
  | 'waive';

export type RectificationSuggestionKind =
  | 'reverse'
  | 'repost'
  | 'reverse_and_repost'
  | 'reclass'
  | 'reclass_dimension'
  | 'accrue'
  | 'release_accrual'
  | 'clear_suspense'
  | 'move_period'
  | 'investigate'
  | 'commentary'
  | 'none';

export type RectificationConfidence = 'high' | 'medium' | 'low';

export interface ExceptionRuleDefinition {
  readonly ruleId: string;
  readonly name: string;
  readonly category: 'control' | 'cutoff' | 'variance' | 'pattern' | 'hygiene';
  readonly defaultSeverity: ExceptionSeverity;
  readonly grainKind: string;
  readonly suggestionKind: RectificationSuggestionKind;
  readonly summary: string;
}

export const EXCEPTION_RULES_CATALOG: readonly ExceptionRuleDefinition[] = [
  { ruleId: 'EXC-001', name: 'Duplicate voucher', category: 'control', defaultSeverity: 'high', grainKind: 'source_ref', suggestionKind: 'reverse', summary: 'Identical entity, voucher reference, and amount posted in distinct batches or repeated in one batch.' },
  { ruleId: 'EXC-002', name: 'Re-import overlap', category: 'control', defaultSeverity: 'medium', grainKind: 'source_ref|account', suggestionKind: 'investigate', summary: 'Voucher/account/amount/date tuple repeated across prior and current active batches.' },
  { ruleId: 'EXC-003', name: 'Control-total mismatch', category: 'control', defaultSeverity: 'high', grainKind: 'batch_id', suggestionKind: 'none', summary: 'Batch row accounting or posted debit/credit totals diverge from committed source rows.' },
  { ruleId: 'EXC-004', name: 'Unbalanced voucher', category: 'control', defaultSeverity: 'high', grainKind: 'source_ref', suggestionKind: 'repost', summary: 'Journal voucher debits and credits do not net to zero.' },
  { ruleId: 'EXC-005', name: 'Posting to locked period', category: 'cutoff', defaultSeverity: 'high', grainKind: 'source_ref', suggestionKind: 'move_period', summary: 'Import committed into a soft-closed or locked fiscal period.' },
  { ruleId: 'EXC-006', name: 'Vendor concentration spike', category: 'pattern', defaultSeverity: 'medium', grainKind: 'vendor', suggestionKind: 'investigate', summary: 'Single vendor >= 40% of period spend above spike threshold.' },
  { ruleId: 'EXC-007', name: 'Suspense/clearing ageing', category: 'control', defaultSeverity: 'high', grainKind: 'account', suggestionKind: 'clear_suspense', summary: 'Suspense/clearing account holds material or aged un-cleared balance.' },
  { ruleId: 'EXC-008', name: 'Large one-off journal', category: 'pattern', defaultSeverity: 'medium', grainKind: 'source_ref', suggestionKind: 'commentary', summary: 'Single P&L journal above one-off threshold with no prior 3-period recurrence.' },
  { ruleId: 'EXC-009', name: 'Unusual poster/time', category: 'control', defaultSeverity: 'low', grainKind: 'source_ref', suggestionKind: 'investigate', summary: 'Poster outside account history or posted off-hours/weekend.' },
  { ruleId: 'EXC-010', name: 'Cut-off risk', category: 'cutoff', defaultSeverity: 'medium', grainKind: 'source_ref', suggestionKind: 'move_period', summary: 'Document date and posting date cross fiscal period boundary above materiality.' },
  { ruleId: 'EXC-011', name: 'Stale accrual not reversed', category: 'cutoff', defaultSeverity: 'medium', grainKind: 'source_ref', suggestionKind: 'release_accrual', summary: 'Accrual voucher lacks reversing offset in following period.' },
  { ruleId: 'EXC-012', name: 'Contra-normal postings', category: 'control', defaultSeverity: 'medium', grainKind: 'account', suggestionKind: 'investigate', summary: 'Non-contra account net postings run opposite normal debit/credit side above materiality.' },
  { ruleId: 'EXC-013', name: 'Account spike', category: 'pattern', defaultSeverity: 'medium', grainKind: 'account', suggestionKind: 'commentary', summary: 'Period net activity exceeds trailing 3-period average on both absolute and percentage thresholds.' },
  { ruleId: 'EXC-014', name: 'Vendor to new account', category: 'pattern', defaultSeverity: 'low', grainKind: 'vendor|account', suggestionKind: 'reclass', summary: 'Vendor posts to an account unused in prior 6 periods.' },
  { ruleId: 'EXC-015', name: 'Missing recurring charge', category: 'pattern', defaultSeverity: 'medium', grainKind: 'vendor|account', suggestionKind: 'accrue', summary: 'Vendor/account active in >= 5 of prior 6 periods is absent this period.' },
  { ruleId: 'EXC-016', name: 'Accrual pattern break', category: 'pattern', defaultSeverity: 'medium', grainKind: 'account', suggestionKind: 'accrue', summary: 'Recurring monthly accrual missing or < 50% of prior 6-period median.' },
  { ruleId: 'EXC-017', name: 'Material unbudgeted spend', category: 'variance', defaultSeverity: 'medium', grainKind: 'account', suggestionKind: 'commentary', summary: 'Material P&L actual activity where current plan has zero or no planned budget.' },
  { ruleId: 'EXC-018', name: 'Material BvA variance', category: 'variance', defaultSeverity: 'medium', grainKind: 'account', suggestionKind: 'commentary', summary: 'Account variance meets both absolute and percentage materiality thresholds (AND-test).' },
  { ruleId: 'EXC-019', name: 'Cumulative overrun trend', category: 'variance', defaultSeverity: 'medium', grainKind: 'account', suggestionKind: 'commentary', summary: 'YTD actual exceeds YTD budget and overrun widened across 3 consecutive periods.' },
  { ruleId: 'EXC-020', name: 'Round-amount clustering', category: 'pattern', defaultSeverity: 'low', grainKind: 'account', suggestionKind: 'investigate', summary: '>= 5 exact round-multiple vouchers representing >= 30% of account activity.' },
  { ruleId: 'EXC-021', name: 'Threshold splitting', category: 'control', defaultSeverity: 'high', grainKind: 'vendor', suggestionKind: 'investigate', summary: '>= 3 vouchers to same vendor within 7 days each below approval limit summing >= 1.5x limit.' },
  { ruleId: 'EXC-022', name: 'Round-tripping', category: 'pattern', defaultSeverity: 'medium', grainKind: 'account|amount', suggestionKind: 'investigate', summary: 'Offsetting debit and credit of equal amount on same account within 5 days across distinct vouchers.' },
  { ruleId: 'EXC-023', name: 'Single-line voucher risk', category: 'control', defaultSeverity: 'low', grainKind: 'source_ref', suggestionKind: 'repost', summary: 'Voucher contains a single GL leg above materiality.' },
  { ruleId: 'EXC-024', name: 'Dormant/new account activity', category: 'pattern', defaultSeverity: 'low', grainKind: 'account', suggestionKind: 'commentary', summary: 'Account inactive across prior 6 periods shows material current-period postings.' },
  { ruleId: 'EXC-025', name: 'Account-narration mismatch', category: 'hygiene', defaultSeverity: 'medium', grainKind: 'source_ref', suggestionKind: 'reclass', summary: 'Description signal tokens >= 90% associated with a different P&L account over prior 12 periods.' },
  { ruleId: 'EXC-026', name: 'Amount outlier / decimal shift', category: 'hygiene', defaultSeverity: 'medium', grainKind: 'source_ref', suggestionKind: 'reverse_and_repost', summary: 'Line amount deviates >= 5x from historical median on same account/counterparty.' },
  { ruleId: 'EXC-027', name: 'Unusual cost centre', category: 'hygiene', defaultSeverity: 'low', grainKind: 'source_ref', suggestionKind: 'reclass_dimension', summary: 'Cost centre differs from >= 90% dominant historical distribution.' },
  { ruleId: 'EXC-028', name: 'Near-duplicate charge', category: 'hygiene', defaultSeverity: 'medium', grainKind: 'source_ref', suggestionKind: 'reverse', summary: 'Same entity, account, counterparty/memo, and amount on a distinct voucher within 30 days.' },
];

export interface ExceptionThresholds {
  readonly materialAbs: string;
  readonly materialPct: string;
  readonly spikeAbs: string;
  readonly spikePct: string;
  readonly oneOffAbs: string;
  readonly suspenseAgeDays: number;
  readonly minAbs: string;
  readonly outlierFactor: string;
  readonly shiftTolerancePct: string;
  readonly dominancePct: string;
  readonly minSignalTokens: number;
  readonly minHistoryCount: number;
  readonly nearDuplicateWindowDays: number;
}

export const DEFAULT_EXCEPTION_THRESHOLDS: ExceptionThresholds = {
  materialAbs: '100000.00',
  materialPct: '5.00',
  spikeAbs: '250000.00',
  spikePct: '50.00',
  oneOffAbs: '1000000.00',
  suspenseAgeDays: 30,
  minAbs: '25000.00',
  outlierFactor: '5.00',
  shiftTolerancePct: '2.00',
  dominancePct: '90.00',
  minSignalTokens: 2,
  minHistoryCount: 6,
  nearDuplicateWindowDays: 30,
};

export interface ExceptionGlLineFact {
  readonly lineId: string;
  readonly entryId: string;
  readonly batchId: string;
  readonly batchImportedAt: string;
  readonly entityCode: string;
  readonly periodId: string;
  readonly periodCode: string;
  readonly fiscalYear: number;
  readonly periodNo: number;
  readonly entryDate: string;
  readonly sourceRef: string;
  readonly accountCode: string;
  readonly accountType: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  readonly normalSide: 'debit' | 'credit';
  readonly isContra: boolean;
  readonly isSuspense?: boolean;
  readonly statementLineKey: string;
  readonly debit: string;
  readonly credit: string;
  readonly description: string;
  readonly counterpartyKey?: string | null;
}

export interface ExceptionQuarantinedFact {
  readonly rowNo: number;
  readonly batchId: string;
  readonly periodCode: string;
  readonly entityCode: string;
  readonly sourceRef: string | null;
  readonly accountCode: string | null;
  readonly reason: string;
  readonly debit: string | null;
  readonly credit: string | null;
}

export interface ExceptionBvaFact {
  readonly accountCode: string;
  readonly accountType: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  readonly statementLineKey: string;
  readonly actual: string;
  readonly plan: string | null;
  readonly variance: string | null;
  readonly variancePct: string | null;
}

export interface ExceptionSoftCloseWriteFact {
  readonly batchId: string;
  readonly periodCode: string;
  readonly entityCode: string;
  readonly sourceRef: string;
  readonly amount: string;
  readonly accountCode: string;
  readonly occurredAt: string;
}

export interface ExceptionEvaluationInput {
  readonly companyId: string;
  readonly currency: string;
  readonly entityCode: string;
  readonly periodId: string;
  readonly periodCode: string;
  readonly periodEndDate: string;
  readonly fiscalYear: number;
  readonly periodNo: number;
  readonly openTargetPeriodId: string;
  readonly openTargetPeriodCode: string;
  readonly openTargetPeriodStartDate: string;
  readonly glLines: readonly ExceptionGlLineFact[];
  readonly quarantinedRows: readonly ExceptionQuarantinedFact[];
  readonly bvaRows: readonly ExceptionBvaFact[];
  readonly softCloseWrites?: readonly ExceptionSoftCloseWriteFact[];
  readonly thresholds?: Partial<ExceptionThresholds>;
  readonly optionalColumnsPresent?: {
    readonly vendor?: boolean;
    readonly posterTime?: boolean;
    readonly documentDate?: boolean;
    readonly costCentre?: boolean;
    readonly accrualTag?: boolean;
  };
}

export interface RectificationJournalLineSpec {
  readonly entityCode: string;
  readonly accountCode: string;
  readonly debit: string;
  readonly credit: string;
  readonly memo: string;
}

export interface RectificationSuggestion {
  readonly kind: RectificationSuggestionKind;
  readonly targetPeriodId: string;
  readonly targetPeriodCode: string;
  readonly basis: string;
  readonly erpHint: string;
  readonly confidence: RectificationConfidence;
  readonly lines: readonly RectificationJournalLineSpec[];
  readonly totalDebit: string;
  readonly totalCredit: string;
}

export interface EvaluatedExceptionFinding {
  readonly findingKey: string;
  readonly findingIdHash: string;
  readonly ruleId: string;
  readonly title: string;
  readonly severity: ExceptionSeverity;
  readonly periodId: string;
  readonly periodCode: string;
  readonly accountCode: string | null;
  readonly statementLineKey: string | null;
  readonly grainKey: string;
  readonly amount: string;
  readonly dueDate: string;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly suggestion: RectificationSuggestion;
}

export interface NotRunExceptionRule {
  readonly ruleId: string;
  readonly reason: string;
}

export interface ExceptionEvaluationResult {
  readonly evaluatedRuleIds: readonly string[];
  readonly notRunRules: readonly NotRunExceptionRule[];
  readonly findings: readonly EvaluatedExceptionFinding[];
}

function absMoney(d: Decimal): Decimal {
  return d.isNegative() ? negate(d) : d;
}

function addDaysIso(isoDate: string, days: number): string {
  const parts = isoDate.split('-');
  const y = Number.parseInt(parts[0] ?? '2026', 10);
  const m = Number.parseInt(parts[1] ?? '1', 10);
  const d = Number.parseInt(parts[2] ?? '1', 10);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function daysBetweenIso(earlierIso: string, laterIso: string): number {
  const ep = earlierIso.split('-');
  const lp = laterIso.split('-');
  const t1 = Date.UTC(
    Number.parseInt(ep[0] ?? '2026', 10),
    Number.parseInt(ep[1] ?? '1', 10) - 1,
    Number.parseInt(ep[2] ?? '1', 10),
  );
  const t2 = Date.UTC(
    Number.parseInt(lp[0] ?? '2026', 10),
    Number.parseInt(lp[1] ?? '1', 10) - 1,
    Number.parseInt(lp[2] ?? '1', 10),
  );
  return Math.trunc((t2 - t1) / 86_400_000);
}

function buildFindingKey(
  ruleId: string,
  entityCode: string,
  accountCode: string | null,
  periodCode: string,
  grainKey: string,
): string {
  return `${ruleId}|${entityCode}|${accountCode ?? '-'}|${periodCode}|${grainKey}`;
}

function computeDueDate(periodEndDate: string, severity: ExceptionSeverity): string {
  if (severity === 'high') return addDaysIso(periodEndDate, 3);
  if (severity === 'medium') return addDaysIso(periodEndDate, 7);
  return addDaysIso(periodEndDate, 14);
}

function buildBalancedLines(
  rawLines: readonly RectificationJournalLineSpec[],
  scale: number,
): { lines: RectificationJournalLineSpec[]; totalDebit: string; totalCredit: string } {
  if (rawLines.length === 0) {
    const zero = serialize(money('0'), scale);
    return { lines: [], totalDebit: zero, totalCredit: zero };
  }
  const debits = sum(rawLines.map((l) => money(l.debit)));
  const credits = sum(rawLines.map((l) => money(l.credit)));
  if (!eq(debits, credits)) {
    throw new Error(
      `UNBALANCED_RECTIFICATION_SUGGESTION: debit ${serialize(debits, scale)} != credit ${serialize(credits, scale)}`,
    );
  }
  return {
    lines: rawLines.map((l) => ({
      ...l,
      debit: serialize(money(l.debit), scale),
      credit: serialize(money(l.credit), scale),
    })),
    totalDebit: serialize(debits, scale),
    totalCredit: serialize(credits, scale),
  };
}

function tokenizeDescription(text: string): string[] {
  const stop = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !stop.has(t));
}

function computeMedianDecimal(values: readonly Decimal[]): Decimal {
  const sorted = [...values].sort((a, b) => compare(a, b));
  const mid = Math.trunc((sorted.length - 1) / 2);
  return sorted[mid] ?? money('0');
}

function isPowerOfTenShift(ratio: Decimal, tolPct: Decimal): { shifted: boolean; factor: Decimal | null } {
  const powers = [money('10'), money('100'), money('1000')];
  const hundred = money('100');
  for (const p of powers) {
    const diff = absMoney(sub(ratio, p));
    const rel = div(mul(diff, hundred), p, 4, 'HALF_UP');
    if (rel !== null && compare(rel, tolPct) <= 0) {
      return { shifted: true, factor: p };
    }
  }
  return { shifted: false, factor: null };
}

function isSuspenseAccount(code: string, flag?: boolean): boolean {
  if (flag === true) return true;
  return code.startsWith('1999');
}

function naturalActivityFromLine(line: ExceptionGlLineFact): Decimal {
  const dr = money(line.debit);
  const cr = money(line.credit);
  if (line.normalSide === 'debit') {
    return sub(dr, cr);
  }
  return sub(cr, dr);
}

function escalateByThreshold(
  baseSeverity: ExceptionSeverity,
  magnitude: Decimal,
  escalationBase: Decimal,
): ExceptionSeverity {
  if (baseSeverity === 'high') return 'high';
  const threeX = mul(escalationBase, '3');
  if (compare(magnitude, threeX) >= 0) {
    return 'high';
  }
  return baseSeverity;
}

export function evaluateExceptionRules(input: ExceptionEvaluationInput): ExceptionEvaluationResult {
  const scale = scaleForCurrency(input.currency);
  const th: ExceptionThresholds = {
    ...DEFAULT_EXCEPTION_THRESHOLDS,
    ...input.thresholds,
  };
  const materialAbs = money(th.materialAbs);
  const materialPct = money(th.materialPct);
  const spikeAbs = money(th.spikeAbs);
  const spikePct = money(th.spikePct);
  const oneOffAbs = money(th.oneOffAbs);
  const minAbs = money(th.minAbs);
  const outlierFactor = money(th.outlierFactor);
  const shiftTolerancePct = money(th.shiftTolerancePct);
  const dominancePct = money(th.dominancePct);

  const findings: EvaluatedExceptionFinding[] = [];
  const seenKeys = new Set<string>();
  const evaluatedRuleIds: string[] = [];
  const notRunRules: NotRunExceptionRule[] = [];

  const pushFinding = (f: Omit<EvaluatedExceptionFinding, 'findingKey' | 'findingIdHash' | 'dueDate'>) => {
    const findingKey = buildFindingKey(
      f.ruleId,
      input.entityCode,
      f.accountCode,
      f.periodCode,
      f.grainKey,
    );
    if (seenKeys.has(findingKey)) return;
    seenKeys.add(findingKey);
    findings.push({
      ...f,
      findingKey,
      findingIdHash: sha256Hex(findingKey).slice(0, 32),
      dueDate: computeDueDate(input.periodEndDate, f.severity),
    });
  };

  const currentPeriodLines = input.glLines.filter(
    (l) => l.fiscalYear === input.fiscalYear && l.periodNo === input.periodNo,
  );
  const priorLines = input.glLines.filter(
    (l) =>
      l.fiscalYear < input.fiscalYear ||
      (l.fiscalYear === input.fiscalYear && l.periodNo < input.periodNo),
  );

  // Track optional-dimension rules explicitly
  const opt = input.optionalColumnsPresent ?? {};
  if (!opt.vendor) {
    notRunRules.push(
      { ruleId: 'EXC-006', reason: 'Vendor column not mapped in GL source.' },
      { ruleId: 'EXC-014', reason: 'Vendor column not mapped in GL source.' },
      { ruleId: 'EXC-015', reason: 'Vendor column not mapped in GL source.' },
      { ruleId: 'EXC-021', reason: 'Vendor column not mapped in GL source.' },
    );
  }
  if (!opt.posterTime) {
    notRunRules.push({ ruleId: 'EXC-009', reason: 'Poster user and timestamp columns not present in import source.' });
  }
  if (!opt.documentDate) {
    notRunRules.push({ ruleId: 'EXC-010', reason: 'Separate document_date column not present in import source.' });
  }
  if (!opt.accrualTag) {
    notRunRules.push(
      { ruleId: 'EXC-011', reason: 'Accrual reversal metadata tag not configured.' },
      { ruleId: 'EXC-016', reason: 'Recurring accrual schedule tag not configured.' },
    );
  }
  if (!opt.costCentre) {
    notRunRules.push({ ruleId: 'EXC-027', reason: 'Cost centre dimension column not present on GL lines.' });
  }

  // Group current lines by entry (sourceRef + entryId)
  const entriesById = new Map<string, ExceptionGlLineFact[]>();
  for (const line of currentPeriodLines) {
    const arr = entriesById.get(line.entryId) ?? [];
    arr.push(line);
    entriesById.set(line.entryId, arr);
  }

  // EXC-001: Duplicate voucher (same entity + sourceRef + |amount| across >=2 batches or repeated identical non-reversal entries)
  evaluatedRuleIds.push('EXC-001');
  const entriesByRef = new Map<string, { entryId: string; batchId: string; totalDebit: Decimal; lines: ExceptionGlLineFact[] }[]>();
  for (const [entryId, lines] of entriesById.entries()) {
    const first = lines[0];
    if (!first || first.sourceRef.trim().length === 0) continue;
    const totalDebit = sum(lines.map((l) => money(l.debit)));
    const arr = entriesByRef.get(first.sourceRef) ?? [];
    arr.push({ entryId, batchId: first.batchId, totalDebit, lines });
    entriesByRef.set(first.sourceRef, arr);
  }
  for (const [sourceRef, group] of entriesByRef.entries()) {
    if (group.length < 2) continue;
    const distinctBatches = new Set(group.map((g) => g.batchId));
    const latest = group[group.length - 1]!;
    const first = group[0]!;
    if (distinctBatches.size >= 2 || eq(latest.totalDebit, first.totalDebit)) {
      const mirrorLines = latest.lines.map((l) => ({
        entityCode: l.entityCode,
        accountCode: l.accountCode,
        debit: l.credit,
        credit: l.debit,
        memo: `Reversal of duplicate voucher ${sourceRef} [FPA EXC-001 ${sourceRef}]`,
      }));
      const balanced = buildBalancedLines(mirrorLines, scale);
      pushFinding({
        ruleId: 'EXC-001',
        title: `Potential exception — review: Duplicate voucher ${sourceRef} posted ${group.length} times`,
        severity: 'high',
        periodId: input.periodId,
        periodCode: input.periodCode,
        accountCode: latest.lines[0]?.accountCode ?? null,
        statementLineKey: latest.lines[0]?.statementLineKey ?? null,
        grainKey: sourceRef,
        amount: serialize(latest.totalDebit, STORAGE_SCALE),
        evidence: {
          sourceRef,
          occurrenceCount: group.length,
          distinctBatchCount: distinctBatches.size,
          entryIds: group.map((g) => g.entryId),
          amount: serialize(latest.totalDebit, scale),
        },
        suggestion: {
          kind: 'reverse',
          targetPeriodId: input.openTargetPeriodId,
          targetPeriodCode: input.openTargetPeriodCode,
          basis: `Voucher ${sourceRef} appears ${group.length} times for ${serialize(latest.totalDebit, scale)} ${input.currency}.`,
          erpHint: `Post a reversal entry for duplicate voucher ${sourceRef} in ${input.openTargetPeriodCode}.`,
          confidence: 'high',
          ...balanced,
        },
      });
    }
  }

  // EXC-004: Unbalanced voucher (from quarantined import rows tagged UNBALANCED_ENTRY)
  evaluatedRuleIds.push('EXC-004');
  const unbalByRef = new Map<string, ExceptionQuarantinedFact[]>();
  for (const q of input.quarantinedRows) {
    if (q.periodCode !== input.periodCode) continue;
    if (!q.reason.startsWith('UNBALANCED_ENTRY')) continue;
    const ref = q.sourceRef ?? `ROW-${q.rowNo}`;
    const arr = unbalByRef.get(ref) ?? [];
    arr.push(q);
    unbalByRef.set(ref, arr);
  }
  for (const [ref, rows] of unbalByRef.entries()) {
    const sumDr = sum(rows.map((r) => (r.debit ? money(r.debit) : money('0'))));
    const sumCr = sum(rows.map((r) => (r.credit ? money(r.credit) : money('0'))));
    const diff = sub(sumDr, sumCr);
    const mag = absMoney(diff);
    if (isZero(mag)) continue;
    const firstAcct = rows[0]?.accountCode ?? '1999';
    const suspAcct = '1999';
    const rawLines: RectificationJournalLineSpec[] =
      compare(diff, money('0')) > 0
        ? [
            { entityCode: input.entityCode, accountCode: firstAcct, debit: serialize(mag, scale), credit: serialize(money('0'), scale), memo: `Unbalanced voucher ${ref} leg [FPA EXC-004 ${ref}]` },
            { entityCode: input.entityCode, accountCode: suspAcct, debit: serialize(money('0'), scale), credit: serialize(mag, scale), memo: `Suspense clearing for unbalanced voucher ${ref} [FPA EXC-004 ${ref}]` },
          ]
        : [
            { entityCode: input.entityCode, accountCode: suspAcct, debit: serialize(mag, scale), credit: serialize(money('0'), scale), memo: `Suspense clearing for unbalanced voucher ${ref} [FPA EXC-004 ${ref}]` },
            { entityCode: input.entityCode, accountCode: firstAcct, debit: serialize(money('0'), scale), credit: serialize(mag, scale), memo: `Unbalanced voucher ${ref} leg [FPA EXC-004 ${ref}]` },
          ];
    const balanced = buildBalancedLines(rawLines, scale);
    pushFinding({
      ruleId: 'EXC-004',
      title: `Potential exception — review: Unbalanced voucher ${ref} (imbalance ${serialize(mag, scale)})`,
      severity: 'high',
      periodId: input.periodId,
      periodCode: input.periodCode,
      accountCode: rows[0]?.accountCode ?? null,
      statementLineKey: null,
      grainKey: ref,
      amount: serialize(mag, STORAGE_SCALE),
      evidence: {
        sourceRef: ref,
        quarantinedRowNos: rows.map((r) => r.rowNo),
        totalDebit: serialize(sumDr, scale),
        totalCredit: serialize(sumCr, scale),
        imbalance: serialize(mag, scale),
      },
      suggestion: {
        kind: 'repost',
        targetPeriodId: input.openTargetPeriodId,
        targetPeriodCode: input.openTargetPeriodCode,
        basis: `Quarantined voucher ${ref} has debits ${serialize(sumDr, scale)} vs credits ${serialize(sumCr, scale)} (delta ${serialize(mag, scale)}).`,
        erpHint: `Correct unbalanced voucher ${ref} in the source ERP or post via suspense ${suspAcct}.`,
        confidence: 'low',
        ...balanced,
      },
    });
  }

  // EXC-005: Posting to soft-closed/locked period
  evaluatedRuleIds.push('EXC-005');
  for (const w of input.softCloseWrites ?? []) {
    if (w.periodCode !== input.periodCode) continue;
    const amt = absMoney(money(w.amount));
    const balanced = buildBalancedLines(
      [
        { entityCode: input.entityCode, accountCode: w.accountCode, debit: serialize(money('0'), scale), credit: serialize(amt, scale), memo: `Move post-soft-close entry ${w.sourceRef} out of ${w.periodCode} [FPA EXC-005 ${w.sourceRef}]` },
        { entityCode: input.entityCode, accountCode: w.accountCode, debit: serialize(amt, scale), credit: serialize(money('0'), scale), memo: `Repost ${w.sourceRef} into open period ${input.openTargetPeriodCode} [FPA EXC-005 ${w.sourceRef}]` },
      ],
      scale,
    );
    pushFinding({
      ruleId: 'EXC-005',
      title: `Potential exception — review: Posting ${w.sourceRef} committed during soft-closed ${w.periodCode}`,
      severity: 'high',
      periodId: input.periodId,
      periodCode: input.periodCode,
      accountCode: w.accountCode,
      statementLineKey: null,
      grainKey: w.sourceRef,
      amount: serialize(amt, STORAGE_SCALE),
      evidence: {
        batchId: w.batchId,
        sourceRef: w.sourceRef,
        occurredAt: w.occurredAt,
      },
      suggestion: {
        kind: 'move_period',
        targetPeriodId: input.openTargetPeriodId,
        targetPeriodCode: input.openTargetPeriodCode,
        basis: `Entry ${w.sourceRef} (${serialize(amt, scale)}) was posted after ${w.periodCode} entered soft-close.`,
        erpHint: `Confirm controller approval for ${w.periodCode} or re-date to open period ${input.openTargetPeriodCode}.`,
        confidence: 'medium',
        ...balanced,
      },
    });
  }

  // Account-level aggregations for current period & prior periods
  const currentByAccount = new Map<string, ExceptionGlLineFact[]>();
  for (const l of currentPeriodLines) {
    const arr = currentByAccount.get(l.accountCode) ?? [];
    arr.push(l);
    currentByAccount.set(l.accountCode, arr);
  }

  // EXC-007: Suspense/clearing ageing
  evaluatedRuleIds.push('EXC-007');
  for (const [acctCode, acctLines] of currentByAccount.entries()) {
    const sample = acctLines[0];
    if (!sample || !isSuspenseAccount(acctCode, sample.isSuspense)) continue;
    const allAcctLines = input.glLines.filter(
      (l) =>
        l.accountCode === acctCode &&
        (l.fiscalYear < input.fiscalYear ||
          (l.fiscalYear === input.fiscalYear && l.periodNo <= input.periodNo)),
    );
    const netBalance = sum(allAcctLines.map(naturalActivityFromLine));
    const mag = absMoney(netBalance);
    const oldestDate = allAcctLines.reduce(
      (min, l) => (l.entryDate < min ? l.entryDate : min),
      input.periodEndDate,
    );
    const ageDays = daysBetweenIso(oldestDate, input.periodEndDate);
    if (!isZero(mag) && (compare(mag, materialAbs) >= 0 || ageDays > th.suspenseAgeDays)) {
      const zeroBal = buildBalancedLines([], scale);
      pushFinding({
        ruleId: 'EXC-007',
        title: `Potential exception — review: Suspense account ${acctCode} holds uncleared balance ${serialize(mag, scale)}`,
        severity: 'high',
        periodId: input.periodId,
        periodCode: input.periodCode,
        accountCode: acctCode,
        statementLineKey: sample.statementLineKey,
        grainKey: acctCode,
        amount: serialize(mag, STORAGE_SCALE),
        evidence: {
          accountCode: acctCode,
          netBalance: serialize(netBalance, scale),
          oldestEntryDate: oldestDate,
          ageDays,
        },
        suggestion: {
          kind: 'clear_suspense',
          targetPeriodId: input.openTargetPeriodId,
          targetPeriodCode: input.openTargetPeriodCode,
          basis: `Suspense account ${acctCode} carries ${serialize(mag, scale)} aged ${ageDays} days (threshold ${th.suspenseAgeDays} days).`,
          erpHint: `Investigate and reclassify balance out of suspense account ${acctCode}.`,
          confidence: 'medium',
          ...zeroBal,
        },
      });
    }
  }

  // EXC-008: Large one-off journal on P&L account
  evaluatedRuleIds.push('EXC-008');
  for (const [entryId, lines] of entriesById.entries()) {
    const plLines = lines.filter((l) => l.accountType === 'revenue' || l.accountType === 'expense');
    if (plLines.length === 0) continue;
    for (const l of plLines) {
      const amt = absMoney(sub(money(l.debit), money(l.credit)));
      if (compare(amt, oneOffAbs) < 0) continue;
      const priorSimilar = priorLines.filter(
        (p) =>
          p.accountCode === l.accountCode &&
          compare(absMoney(sub(money(p.debit), money(p.credit))), mul(oneOffAbs, '0.5')) >= 0,
      );
      if (priorSimilar.length === 0) {
        const zeroBal = buildBalancedLines([], scale);
        pushFinding({
          ruleId: 'EXC-008',
          title: `Potential exception — review: Large one-off P&L journal ${l.sourceRef} (${serialize(amt, scale)})`,
          severity: 'medium',
          periodId: input.periodId,
          periodCode: input.periodCode,
          accountCode: l.accountCode,
          statementLineKey: l.statementLineKey,
          grainKey: l.sourceRef || entryId,
          amount: serialize(amt, STORAGE_SCALE),
          evidence: {
            entryId,
            sourceRef: l.sourceRef,
            accountCode: l.accountCode,
            amount: serialize(amt, scale),
            threshold: serialize(oneOffAbs, scale),
          },
          suggestion: {
            kind: 'commentary',
            targetPeriodId: input.openTargetPeriodId,
            targetPeriodCode: input.openTargetPeriodCode,
            basis: `Single journal ${l.sourceRef} posted ${serialize(amt, scale)} to ${l.accountCode} with no prior similar postings.`,
            erpHint: `Attach supporting contract/invoice documentation and confirm period allocation.`,
            confidence: 'medium',
            ...zeroBal,
          },
        });
      }
    }
  }

  // EXC-012: Contra-normal postings on non-contra revenue/expense accounts
  evaluatedRuleIds.push('EXC-012');
  for (const [acctCode, acctLines] of currentByAccount.entries()) {
    const sample = acctLines[0];
    if (!sample || sample.isContra) continue;
    if (sample.accountType !== 'revenue' && sample.accountType !== 'expense') continue;
    const netNatural = sum(acctLines.map(naturalActivityFromLine));
    if (compare(netNatural, money('0')) < 0) {
      const mag = absMoney(netNatural);
      if (compare(mag, materialAbs) >= 0) {
        const sev = escalateByThreshold('medium', mag, materialAbs);
        const zeroBal = buildBalancedLines([], scale);
        pushFinding({
          ruleId: 'EXC-012',
          title: `Potential exception — review: Contra-normal net balance on ${acctCode} (${serialize(netNatural, scale)})`,
          severity: sev,
          periodId: input.periodId,
          periodCode: input.periodCode,
          accountCode: acctCode,
          statementLineKey: sample.statementLineKey,
          grainKey: acctCode,
          amount: serialize(mag, STORAGE_SCALE),
          evidence: {
            accountCode: acctCode,
            accountType: sample.accountType,
            normalSide: sample.normalSide,
            netNaturalActivity: serialize(netNatural, scale),
          },
          suggestion: {
            kind: 'investigate',
            targetPeriodId: input.openTargetPeriodId,
            targetPeriodCode: input.openTargetPeriodCode,
            basis: `Non-contra ${sample.accountType} account ${acctCode} netted ${serialize(netNatural, scale)} against its normal ${sample.normalSide} side.`,
            erpHint: `Verify whether credit memos/reversals on ${acctCode} belong in another period or contra account.`,
            confidence: 'low',
            ...zeroBal,
          },
        });
      }
    }
  }

  // EXC-013: Account spike (AND-test against trailing-3-period average) & EXC-024 Dormant account
  evaluatedRuleIds.push('EXC-013', 'EXC-024');
  for (const [acctCode, acctLines] of currentByAccount.entries()) {
    const sample = acctLines[0];
    if (!sample) continue;
    const currNet = sum(acctLines.map(naturalActivityFromLine));
    const currMag = absMoney(currNet);
    const priorForAcct = priorLines.filter((p) => p.accountCode === acctCode);
    if (priorForAcct.length === 0) {
      if (compare(currMag, materialAbs) >= 0) {
        const zeroBal = buildBalancedLines([], scale);
        pushFinding({
          ruleId: 'EXC-024',
          title: `Potential exception — review: Activity on previously inactive account ${acctCode} (${serialize(currMag, scale)})`,
          severity: 'low',
          periodId: input.periodId,
          periodCode: input.periodCode,
          accountCode: acctCode,
          statementLineKey: sample.statementLineKey,
          grainKey: acctCode,
          amount: serialize(currMag, STORAGE_SCALE),
          evidence: {
            accountCode: acctCode,
            currentActivity: serialize(currNet, scale),
            priorLineCount: 0,
          },
          suggestion: {
            kind: 'commentary',
            targetPeriodId: input.openTargetPeriodId,
            targetPeriodCode: input.openTargetPeriodCode,
            basis: `Account ${acctCode} had zero prior history and posted ${serialize(currMag, scale)} in ${input.periodCode}.`,
            erpHint: `Confirm intentional reactivation of account ${acctCode}.`,
            confidence: 'low',
            ...zeroBal,
          },
        });
      }
      continue;
    }

    const byPriorPeriod = new Map<string, Decimal>();
    for (const p of priorForAcct) {
      const key = `${p.fiscalYear}-${String(p.periodNo).padStart(2, '0')}`;
      byPriorPeriod.set(key, add(byPriorPeriod.get(key) ?? money('0'), naturalActivityFromLine(p)));
    }
    const recentPeriods = [...byPriorPeriod.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-3);
    if (recentPeriods.length > 0) {
      const avg = div(
        sum(recentPeriods.map((r) => r[1])),
        money(String(recentPeriods.length)),
        STORAGE_SCALE,
        'HALF_UP',
      );
      if (avg !== null && !isZero(avg)) {
        const delta = sub(currNet, avg);
        const absDelta = absMoney(delta);
        const pct = div(mul(absDelta, '100'), absMoney(avg), 2, 'HALF_UP');
        if (
          pct !== null &&
          compare(absDelta, spikeAbs) >= 0 &&
          compare(pct, spikePct) >= 0
        ) {
          const is3xAbs = compare(absDelta, mul(spikeAbs, '3')) >= 0;
          const is3xPct = compare(pct, mul(spikePct, '3')) >= 0;
          const sev: ExceptionSeverity = is3xAbs && is3xPct ? 'high' : 'medium';
          const zeroBal = buildBalancedLines([], scale);
          pushFinding({
            ruleId: 'EXC-013',
            title: `Potential exception — review: Account ${acctCode} spike (${serialize(pct, 2)}% vs trailing average)`,
            severity: sev,
            periodId: input.periodId,
            periodCode: input.periodCode,
            accountCode: acctCode,
            statementLineKey: sample.statementLineKey,
            grainKey: acctCode,
            amount: serialize(absDelta, STORAGE_SCALE),
            evidence: {
              accountCode: acctCode,
              currentNet: serialize(currNet, scale),
              trailingAverage: serialize(avg, scale),
              delta: serialize(delta, scale),
              deltaPct: serialize(pct, 2),
            },
            suggestion: {
              kind: 'commentary',
              targetPeriodId: input.openTargetPeriodId,
              targetPeriodCode: input.openTargetPeriodCode,
              basis: `${acctCode} posted ${serialize(currNet, scale)} vs trailing average ${serialize(avg, scale)} (+${serialize(pct, 2)}%).`,
              erpHint: `Review underlying entries on ${acctCode} and document operational driver.`,
              confidence: 'medium',
              ...zeroBal,
            },
          });
        }
      }
    }
  }

  // EXC-017 & EXC-018: Unbudgeted material spend & Material BvA variance (strict AND-test!)
  evaluatedRuleIds.push('EXC-017', 'EXC-018');
  for (const row of input.bvaRows) {
    if (row.accountType !== 'revenue' && row.accountType !== 'expense') continue;
    const actual = money(row.actual);
    const actualMag = absMoney(actual);
    if (row.plan === null || isZero(money(row.plan))) {
      if (compare(actualMag, materialAbs) >= 0) {
        const sev = escalateByThreshold('medium', actualMag, materialAbs);
        const zeroBal = buildBalancedLines([], scale);
        pushFinding({
          ruleId: 'EXC-017',
          title: `Potential exception — review: Material unbudgeted activity on ${row.accountCode} (${serialize(actualMag, scale)})`,
          severity: sev,
          periodId: input.periodId,
          periodCode: input.periodCode,
          accountCode: row.accountCode,
          statementLineKey: row.statementLineKey,
          grainKey: row.accountCode,
          amount: serialize(actualMag, STORAGE_SCALE),
          evidence: {
            accountCode: row.accountCode,
            actual: serialize(actual, scale),
            plan: row.plan,
          },
          suggestion: {
            kind: 'commentary',
            targetPeriodId: input.openTargetPeriodId,
            targetPeriodCode: input.openTargetPeriodCode,
            basis: `Account ${row.accountCode} has ${serialize(actualMag, scale)} actuals against no planned budget.`,
            erpHint: `Explain unbudgeted ${row.accountCode} activity or update forecast scenario.`,
            confidence: 'medium',
            ...zeroBal,
          },
        });
      }
      continue;
    }

    if (row.variance !== null && row.variancePct !== null) {
      const absVar = absMoney(money(row.variance));
      const absPct = absMoney(money(row.variancePct));
      if (compare(absVar, materialAbs) >= 0 && compare(absPct, materialPct) >= 0) {
        const is3xAbs = compare(absVar, mul(materialAbs, '3')) >= 0;
        const is3xPct = compare(absPct, mul(materialPct, '3')) >= 0;
        const sev: ExceptionSeverity = is3xAbs && is3xPct ? 'high' : 'medium';
        const zeroBal = buildBalancedLines([], scale);
        pushFinding({
          ruleId: 'EXC-018',
          title: `Potential exception — review: Material BvA variance on ${row.accountCode} (${serialize(absVar, scale)} / ${serialize(absPct, 2)}%)`,
          severity: sev,
          periodId: input.periodId,
          periodCode: input.periodCode,
          accountCode: row.accountCode,
          statementLineKey: row.statementLineKey,
          grainKey: row.accountCode,
          amount: serialize(absVar, STORAGE_SCALE),
          evidence: {
            accountCode: row.accountCode,
            plan: row.plan,
            actual: row.actual,
            variance: row.variance,
            variancePct: row.variancePct,
            materialAbs: th.materialAbs,
            materialPct: th.materialPct,
          },
          suggestion: {
            kind: 'commentary',
            targetPeriodId: input.openTargetPeriodId,
            targetPeriodCode: input.openTargetPeriodCode,
            basis: `${row.accountCode} variance is ${row.variance} (${row.variancePct}%) vs plan ${row.plan}.`,
            erpHint: `Provide variance commentary for ${row.accountCode} before period close sign-off.`,
            confidence: 'medium',
            ...zeroBal,
          },
        });
      }
    }
  }

  // EXC-022: Round-tripping (equal |amount| debit and credit on same account within 5 days, distinct sourceRef)
  evaluatedRuleIds.push('EXC-022');
  for (const [acctCode, acctLines] of currentByAccount.entries()) {
    const debits = acctLines.filter((l) => compare(money(l.debit), money('0')) > 0);
    const credits = acctLines.filter((l) => compare(money(l.credit), money('0')) > 0);
    for (const d of debits) {
      const dAmt = money(d.debit);
      if (compare(dAmt, minAbs) < 0) continue;
      for (const c of credits) {
        if (d.sourceRef === c.sourceRef) continue;
        const cAmt = money(c.credit);
        if (!eq(dAmt, cAmt)) continue;
        const rawGap = daysBetweenIso(d.entryDate, c.entryDate);
        const gap = rawGap < 0 ? -rawGap : rawGap;
        if (gap <= 5) {
          const amtText = serialize(dAmt, scale);
          const zeroBal = buildBalancedLines([], scale);
          pushFinding({
            ruleId: 'EXC-022',
            title: `Potential exception — review: Offsetting debit/credit round-trip on ${acctCode} (${amtText})`,
            severity: 'medium',
            periodId: input.periodId,
            periodCode: input.periodCode,
            accountCode: acctCode,
            statementLineKey: d.statementLineKey,
            grainKey: `${acctCode}|${amtText}`,
            amount: serialize(dAmt, STORAGE_SCALE),
            evidence: {
              accountCode: acctCode,
              debitRef: d.sourceRef,
              creditRef: c.sourceRef,
              amount: amtText,
              daysApart: gap,
            },
            suggestion: {
              kind: 'investigate',
              targetPeriodId: input.openTargetPeriodId,
              targetPeriodCode: input.openTargetPeriodCode,
              basis: `${d.sourceRef} debited ${amtText} and ${c.sourceRef} credited ${amtText} on ${acctCode} within ${gap} day(s).`,
              erpHint: `Confirm business justification for offsetting entries ${d.sourceRef} and ${c.sourceRef}.`,
              confidence: 'low',
              ...zeroBal,
            },
          });
        }
      }
    }
  }

  // EXC-023: Single-line voucher risk
  evaluatedRuleIds.push('EXC-023');
  for (const [entryId, lines] of entriesById.entries()) {
    if (lines.length !== 1) continue;
    const only = lines[0]!;
    const amt = absMoney(sub(money(only.debit), money(only.credit)));
    if (compare(amt, materialAbs) >= 0) {
      const zeroBal = buildBalancedLines([], scale);
      pushFinding({
        ruleId: 'EXC-023',
        title: `Potential exception — review: Single-line voucher ${only.sourceRef} (${serialize(amt, scale)})`,
        severity: 'low',
        periodId: input.periodId,
        periodCode: input.periodCode,
        accountCode: only.accountCode,
        statementLineKey: only.statementLineKey,
        grainKey: only.sourceRef || entryId,
        amount: serialize(amt, STORAGE_SCALE),
        evidence: {
          entryId,
          sourceRef: only.sourceRef,
          accountCode: only.accountCode,
          amount: serialize(amt, scale),
        },
        suggestion: {
          kind: 'investigate',
          targetPeriodId: input.openTargetPeriodId,
          targetPeriodCode: input.openTargetPeriodCode,
          basis: `Voucher ${only.sourceRef} contains only 1 GL leg for ${serialize(amt, scale)}.`,
          erpHint: `Verify offsetting leg was not dropped from source export.`,
          confidence: 'low',
          ...zeroBal,
        },
      });
    }
  }

  // EXC-025: Account-narration mismatch (prior token dominance >= dominancePct & <=2% on posted account, >= minSignalTokens)
  evaluatedRuleIds.push('EXC-025');
  const tokenAccountCounts = new Map<string, Map<string, number>>();
  const tokenTotalCounts = new Map<string, number>();
  for (const p of priorLines) {
    if (p.accountType !== 'revenue' && p.accountType !== 'expense') continue;
    const tokens = new Set(tokenizeDescription(p.description));
    for (const tok of tokens) {
      tokenTotalCounts.set(tok, (tokenTotalCounts.get(tok) ?? 0) + 1);
      const perAcct = tokenAccountCounts.get(tok) ?? new Map<string, number>();
      perAcct.set(p.accountCode, (perAcct.get(p.accountCode) ?? 0) + 1);
      tokenAccountCounts.set(tok, perAcct);
    }
  }

  for (const line of currentPeriodLines) {
    if (line.accountType !== 'revenue' && line.accountType !== 'expense') continue;
    const amt = absMoney(sub(money(line.debit), money(line.credit)));
    if (compare(amt, minAbs) < 0) continue;
    const tokens = new Set(tokenizeDescription(line.description));
    const votesByTarget = new Map<string, string[]>();
    for (const tok of tokens) {
      const total = tokenTotalCounts.get(tok) ?? 0;
      if (total < 3) continue;
      const perAcct = tokenAccountCounts.get(tok);
      if (!perAcct) continue;
      const postedCount = perAcct.get(line.accountCode) ?? 0;
      const postedShare = div(mul(money(String(postedCount)), '100'), money(String(total)), 2, 'HALF_UP');
      if (postedShare === null || compare(postedShare, money('2.00')) > 0) continue;

      for (const [candAcct, candCount] of perAcct.entries()) {
        if (candAcct === line.accountCode) continue;
        const candShare = div(mul(money(String(candCount)), '100'), money(String(total)), 2, 'HALF_UP');
        if (candShare !== null && compare(candShare, dominancePct) >= 0) {
          const list = votesByTarget.get(candAcct) ?? [];
          list.push(tok);
          votesByTarget.set(candAcct, list);
        }
      }
    }

    for (const [targetAcct, signalTokens] of votesByTarget.entries()) {
      if (signalTokens.length < th.minSignalTokens) continue;
      const sev = escalateByThreshold('medium', amt, materialAbs);
      const isDebit = compare(money(line.debit), money('0')) > 0;
      const reclassLines: RectificationJournalLineSpec[] = isDebit
        ? [
            { entityCode: line.entityCode, accountCode: targetAcct, debit: serialize(amt, scale), credit: serialize(money('0'), scale), memo: `Reclass ${line.sourceRef} to ${targetAcct} [FPA EXC-025 ${line.sourceRef}]` },
            { entityCode: line.entityCode, accountCode: line.accountCode, debit: serialize(money('0'), scale), credit: serialize(amt, scale), memo: `Reverse misposted ${line.accountCode} on ${line.sourceRef} [FPA EXC-025 ${line.sourceRef}]` },
          ]
        : [
            { entityCode: line.entityCode, accountCode: line.accountCode, debit: serialize(amt, scale), credit: serialize(money('0'), scale), memo: `Reverse misposted ${line.accountCode} on ${line.sourceRef} [FPA EXC-025 ${line.sourceRef}]` },
            { entityCode: line.entityCode, accountCode: targetAcct, debit: serialize(money('0'), scale), credit: serialize(amt, scale), memo: `Reclass ${line.sourceRef} to ${targetAcct} [FPA EXC-025 ${line.sourceRef}]` },
          ];
      const balanced = buildBalancedLines(reclassLines, scale);
      pushFinding({
        ruleId: 'EXC-025',
        title: `Potential exception — review: Narration on ${line.sourceRef} matches ${targetAcct} rather than ${line.accountCode}`,
        severity: sev,
        periodId: input.periodId,
        periodCode: input.periodCode,
        accountCode: line.accountCode,
        statementLineKey: line.statementLineKey,
        grainKey: line.sourceRef || line.lineId,
        amount: serialize(amt, STORAGE_SCALE),
        evidence: {
          sourceRef: line.sourceRef,
          postedAccount: line.accountCode,
          suggestedAccount: targetAcct,
          signalTokens,
          amount: serialize(amt, scale),
        },
        suggestion: {
          kind: 'reclass',
          targetPeriodId: input.openTargetPeriodId,
          targetPeriodCode: input.openTargetPeriodCode,
          basis: `Tokens [${signalTokens.join(', ')}] appear >= ${th.dominancePct}% in ${targetAcct} across prior history and <= 2% in ${line.accountCode}.`,
          erpHint: `Reclassify ${serialize(amt, scale)} from ${line.accountCode} to ${targetAcct}.`,
          confidence: signalTokens.length >= 3 ? 'high' : 'medium',
          ...balanced,
        },
      });
      break;
    }
  }

  // EXC-026: Amount outlier / decimal-shift suspect
  evaluatedRuleIds.push('EXC-026');
  const priorByAccountKey = new Map<string, Decimal[]>();
  for (const p of priorLines) {
    const key = `${p.accountCode}|${(p.counterpartyKey ?? '').trim().toLowerCase()}`;
    const arr = priorByAccountKey.get(key) ?? [];
    arr.push(absMoney(sub(money(p.debit), money(p.credit))));
    priorByAccountKey.set(key, arr);
  }
  for (const line of currentPeriodLines) {
    const key = `${line.accountCode}|${(line.counterpartyKey ?? '').trim().toLowerCase()}`;
    const hist = priorByAccountKey.get(key);
    if (!hist || hist.length < th.minHistoryCount) continue;
    const med = computeMedianDecimal(hist);
    if (isZero(med)) continue;
    const amt = absMoney(sub(money(line.debit), money(line.credit)));
    const diff = absMoney(sub(amt, med));
    if (compare(diff, minAbs) < 0) continue;
    const ratio = div(amt, med, 4, 'HALF_UP');
    if (ratio === null || isZero(ratio)) continue;
    const invRatio = div(med, amt, 4, 'HALF_UP');
    const isHighOutlier = compare(ratio, outlierFactor) >= 0;
    const isLowOutlier = invRatio !== null && compare(invRatio, outlierFactor) >= 0;
    if (!isHighOutlier && !isLowOutlier) continue;

    const shiftInfo = isHighOutlier
      ? isPowerOfTenShift(ratio, shiftTolerancePct)
      : { shifted: false, factor: null };
    const is100x = compare(ratio, money('100')) >= 0;
    const sev: ExceptionSeverity =
      is100x || compare(amt, mul(materialAbs, '3')) >= 0 ? 'high' : 'medium';
    const suggestedAmt =
      shiftInfo.shifted && shiftInfo.factor !== null
        ? round(div(amt, shiftInfo.factor, scale, 'HALF_UP') ?? med, scale, 'HALF_UP')
        : round(med, scale, 'HALF_UP');
    const isDebit = compare(money(line.debit), money('0')) > 0;
    const revRepostLines: RectificationJournalLineSpec[] = [];
    if (isDebit) {
      revRepostLines.push(
        { entityCode: line.entityCode, accountCode: line.accountCode, debit: serialize(money('0'), scale), credit: serialize(amt, scale), memo: `Reverse outlier ${line.sourceRef} [FPA EXC-026 ${line.sourceRef}]` },
        { entityCode: line.entityCode, accountCode: line.accountCode, debit: serialize(suggestedAmt, scale), credit: serialize(money('0'), scale), memo: `Repost ${line.sourceRef} at expected magnitude [FPA EXC-026 ${line.sourceRef}]` },
      );
      const netOffset = sub(amt, suggestedAmt);
      if (compare(netOffset, money('0')) > 0) {
        revRepostLines.push({ entityCode: line.entityCode, accountCode: '1999', debit: serialize(netOffset, scale), credit: serialize(money('0'), scale), memo: `Suspense offset for decimal shift ${line.sourceRef} [FPA EXC-026 ${line.sourceRef}]` });
      } else if (compare(netOffset, money('0')) < 0) {
        revRepostLines.push({ entityCode: line.entityCode, accountCode: '1999', debit: serialize(money('0'), scale), credit: serialize(absMoney(netOffset), scale), memo: `Suspense offset for decimal shift ${line.sourceRef} [FPA EXC-026 ${line.sourceRef}]` });
      }
    }
    const balanced = buildBalancedLines(revRepostLines, scale);
    pushFinding({
      ruleId: 'EXC-026',
      title: `Potential exception — review: Amount outlier on ${line.sourceRef} (${serialize(amt, scale)} vs median ${serialize(med, scale)})`,
      severity: sev,
      periodId: input.periodId,
      periodCode: input.periodCode,
      accountCode: line.accountCode,
      statementLineKey: line.statementLineKey,
      grainKey: line.sourceRef || line.lineId,
      amount: serialize(amt, STORAGE_SCALE),
      evidence: {
        sourceRef: line.sourceRef,
        accountCode: line.accountCode,
        amount: serialize(amt, scale),
        historicalMedian: serialize(med, scale),
        ratio: serialize(ratio, 2),
        decimalShiftSuspect: shiftInfo.shifted,
        historyCount: hist.length,
      },
      suggestion: {
        kind: 'reverse_and_repost',
        targetPeriodId: input.openTargetPeriodId,
        targetPeriodCode: input.openTargetPeriodCode,
        basis: `${hist.length} prior lines on ${line.accountCode} have median ${serialize(med, scale)}; ${line.sourceRef} is ${serialize(amt, scale)} (${serialize(ratio, 2)}x).`,
        erpHint: `Confirm invoice for ${line.sourceRef}; reverse ${serialize(amt, scale)} and repost at ${serialize(suggestedAmt, scale)} if decimal slip.`,
        confidence: shiftInfo.shifted ? 'medium' : 'low',
        ...balanced,
      },
    });
  }

  // EXC-028: Near-duplicate charge (different sourceRef, same account + counterparty/memo + |amount| >= minAbs within windowDays)
  evaluatedRuleIds.push('EXC-028');
  const sortedForDup = [...input.glLines]
    .filter((l) => l.fiscalYear < input.fiscalYear || (l.fiscalYear === input.fiscalYear && l.periodNo <= input.periodNo))
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.sourceRef.localeCompare(b.sourceRef));
  const anchors = new Map<string, { entryDate: string; sourceRef: string }>();
  const flaggedAsDup = new Set<string>();
  for (const l of sortedForDup) {
    const amt = absMoney(sub(money(l.debit), money(l.credit)));
    if (compare(amt, minAbs) < 0) continue;
    const side = compare(money(l.debit), money('0')) > 0 ? 'D' : 'C';
    const descNorm = (l.counterpartyKey ?? l.description).trim().toLowerCase();
    if (descNorm.length === 0) continue;
    const dupKey = `${l.entityCode}|${l.accountCode}|${descNorm}|${side}|${serialize(amt, scale)}`;
    const anchor = anchors.get(dupKey);
    const inCurrentPeriod = l.fiscalYear === input.fiscalYear && l.periodNo === input.periodNo;
    if (anchor === undefined) {
      anchors.set(dupKey, { entryDate: l.entryDate, sourceRef: l.sourceRef });
    } else if (anchor.sourceRef !== l.sourceRef) {
      const gap = daysBetweenIso(anchor.entryDate, l.entryDate);
      if (gap >= 0 && gap <= th.nearDuplicateWindowDays) {
        flaggedAsDup.add(l.lineId);
        if (inCurrentPeriod) {
          const entryLines = entriesById.get(l.entryId) ?? [l];
          const rawMirror = entryLines.map((el) => ({
            entityCode: el.entityCode,
            accountCode: el.accountCode,
            debit: el.credit,
            credit: el.debit,
            memo: `Reverse near-duplicate ${l.sourceRef} (matches ${anchor.sourceRef}) [FPA EXC-028 ${l.sourceRef}]`,
          }));
          const mirrorDr = sum(rawMirror.map((m) => money(m.debit)));
          const mirrorCr = sum(rawMirror.map((m) => money(m.credit)));
          if (!eq(mirrorDr, mirrorCr)) {
            const diff = sub(mirrorCr, mirrorDr);
            if (compare(diff, money('0')) > 0) {
              rawMirror.push({
                entityCode: l.entityCode,
                accountCode: '1999',
                debit: serialize(diff, scale),
                credit: serialize(money('0'), scale),
                memo: `Suspense offset for ${l.sourceRef} [FPA EXC-028 ${l.sourceRef}]`,
              });
            } else {
              rawMirror.push({
                entityCode: l.entityCode,
                accountCode: '1999',
                debit: serialize(money('0'), scale),
                credit: serialize(absMoney(diff), scale),
                memo: `Suspense offset for ${l.sourceRef} [FPA EXC-028 ${l.sourceRef}]`,
              });
            }
          }
          const balanced = buildBalancedLines(rawMirror, scale);
          pushFinding({
            ruleId: 'EXC-028',
            title: `Potential exception — review: Near-duplicate charge ${l.sourceRef} matches ${anchor.sourceRef}`,
            severity: escalateByThreshold('medium', amt, materialAbs),
            periodId: input.periodId,
            periodCode: input.periodCode,
            accountCode: l.accountCode,
            statementLineKey: l.statementLineKey,
            grainKey: l.sourceRef || l.lineId,
            amount: serialize(amt, STORAGE_SCALE),
            evidence: {
              sourceRef: l.sourceRef,
              anchorSourceRef: anchor.sourceRef,
              anchorDate: anchor.entryDate,
              entryDate: l.entryDate,
              daysApart: gap,
              amount: serialize(amt, scale),
            },
            suggestion: {
              kind: 'reverse',
              targetPeriodId: input.openTargetPeriodId,
              targetPeriodCode: input.openTargetPeriodCode,
              basis: `${l.sourceRef} (${l.entryDate}) repeats ${serialize(amt, scale)} on ${l.accountCode} within ${gap} day(s) of ${anchor.sourceRef}.`,
              erpHint: `Verify invoice numbers for ${l.sourceRef} vs ${anchor.sourceRef} and reverse if double-billed.`,
              confidence: 'medium',
              ...balanced,
            },
          });
        }
      } else if (!flaggedAsDup.has(l.lineId)) {
        anchors.set(dupKey, { entryDate: l.entryDate, sourceRef: l.sourceRef });
      }
    }
  }

  return {
    evaluatedRuleIds,
    notRunRules,
    findings,
  };
}

export interface ExceptionTransitionDecision {
  readonly ok: boolean;
  readonly nextStatus?: ExceptionStatus;
  readonly waiverExpiresAt?: string | null;
  readonly errorCode?: 'MODEL_VERSION_LOCKED' | 'TENANT_FORBIDDEN' | 'VALIDATION_FAILED';
  readonly reason?: string;
}

export function evaluateExceptionTransition(params: {
  readonly currentStatus: ExceptionStatus;
  readonly currentVersion: number;
  readonly expectedVersion: number;
  readonly action: ExceptionTransitionAction;
  readonly actorRole: 'owner' | 'editor' | 'reviewer' | 'viewer';
  readonly note?: string | null;
  readonly ownerUserId?: string | null;
  readonly waiverReason?: string | null;
  readonly waiverExpiryDays?: number | null;
  readonly nowIso: string;
}): ExceptionTransitionDecision {
  if (params.actorRole === 'viewer') {
    return {
      ok: false,
      errorCode: 'TENANT_FORBIDDEN',
      reason: 'Viewers have read-only access and cannot modify exception findings.',
    };
  }
  if (params.expectedVersion !== params.currentVersion) {
    return {
      ok: false,
      errorCode: 'MODEL_VERSION_LOCKED',
      reason: `Finding version ${params.currentVersion} does not match expected version ${params.expectedVersion}.`,
    };
  }
  if ((params.action === 'waive' || params.action === 'close') && params.actorRole === 'editor') {
    return {
      ok: false,
      errorCode: 'TENANT_FORBIDDEN',
      reason: `Only workspace owners or reviewers may ${params.action} an exception finding.`,
    };
  }
  if (params.action === 'assign') {
    return { ok: true, nextStatus: params.currentStatus, waiverExpiresAt: null };
  }
  if (params.action === 'acknowledge') {
    if (params.currentStatus !== 'new') {
      return {
        ok: false,
        errorCode: 'VALIDATION_FAILED',
        reason: `Cannot acknowledge a finding in status "${params.currentStatus}".`,
      };
    }
    return { ok: true, nextStatus: 'acknowledged', waiverExpiresAt: null };
  }
  if (params.action === 'explain') {
    if (!params.note || params.note.trim().length === 0) {
      return {
        ok: false,
        errorCode: 'VALIDATION_FAILED',
        reason: 'Explaining a finding requires a non-empty explanation note.',
      };
    }
    if (params.currentStatus === 'closed' || params.currentStatus === 'verified') {
      return {
        ok: false,
        errorCode: 'VALIDATION_FAILED',
        reason: `Cannot explain a finding that is already "${params.currentStatus}".`,
      };
    }
    return { ok: true, nextStatus: 'explained', waiverExpiresAt: null };
  }
  if (params.action === 'verify') {
    if (params.currentStatus !== 'corrected' && params.currentStatus !== 'explained') {
      return {
        ok: false,
        errorCode: 'VALIDATION_FAILED',
        reason: 'A finding must be corrected or explained before verification.',
      };
    }
    return { ok: true, nextStatus: 'verified', waiverExpiresAt: null };
  }
  if (params.action === 'close') {
    if (params.currentStatus !== 'verified' && params.currentStatus !== 'explained') {
      return {
        ok: false,
        errorCode: 'VALIDATION_FAILED',
        reason: 'Only verified or explained findings can be closed.',
      };
    }
    return { ok: true, nextStatus: 'closed', waiverExpiresAt: null };
  }

  // waive
  if (!params.waiverReason || params.waiverReason.trim().length === 0) {
    return {
      ok: false,
      errorCode: 'VALIDATION_FAILED',
      reason: 'Waiving a finding requires a non-empty waiver reason.',
    };
  }
  const days = params.waiverExpiryDays ?? 30;
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    return {
      ok: false,
      errorCode: 'VALIDATION_FAILED',
      reason: 'Waiver expiry must be between 1 and 90 days.',
    };
  }
  const baseDate = new Date(params.nowIso);
  if (Number.isNaN(baseDate.getTime())) {
    return {
      ok: false,
      errorCode: 'VALIDATION_FAILED',
      reason: 'Invalid UTC timestamp for waiver expiration calculation.',
    };
  }
  const expires = new Date(baseDate.getTime() + days * 86_400_000).toISOString();
  return { ok: true, nextStatus: 'waived', waiverExpiresAt: expires };
}

export function buildRectificationCsv(params: {
  readonly entryDate: string;
  readonly entryRef: string;
  readonly lines: readonly RectificationJournalLineSpec[];
}): string {
  const header = 'date,entry_ref,account_code,debit,credit,memo';
  const rows = params.lines.map((l) => {
    const safeMemo = `"${l.memo.replace(/"/g, '""')}"`;
    return `${params.entryDate},${params.entryRef},${l.accountCode},${l.debit},${l.credit},${safeMemo}`;
  });
  return [header, ...rows].join('\n');
}
