// Pure M2 Customer Onboarding & Data Migration Pipeline Kernel (MASTER_PROMPT §11.12, ONB1–ONB3).
//
// Zero LLM calls, zero JS number money arithmetic, zero external I/O (Core Purity S4).
// Serves validation, deterministic assisted CoA matching (human-approval required), gap/anomaly
// detection, synthetic partner fixture generation, and canonical rehearsal fingerprinting.

import Decimal from 'decimal.js';
import { sha256Hex } from '../audit/sha256.js';
import type { GeneratedPeriod } from '../calendar/index.js';
import { parseCsvRecords } from '../import/index.js';
import type { MappingVersionRow } from '../mapping/index.js';
import { add, compare, isZero, money, mul, serialize } from '../money/index.js';
import { normalizeCode } from '../statements/index.js';

export type OnboardingMatchRule =
  | 'already_mapped'
  | 'already_quarantined'
  | 'exact_code'
  | 'leading_zero_alias'
  | 'token_name_match'
  | 'ambiguous_leading_zero'
  | 'ambiguous_token_match'
  | 'unmatched';

export interface OnboardingChartAccountInput {
  readonly code: string;
  readonly name: string;
  readonly type: string;
  readonly statementLineKey: string;
  readonly active: boolean;
  readonly isPostable: boolean;
}

export interface OnboardingDiscoveredSource {
  readonly sourceCode: string;
  readonly rowCount: number;
  readonly sampleValues: readonly string[];
}

export interface OnboardingMappingSuggestion {
  readonly sourceCode: string;
  readonly rowCount: number;
  readonly sampleValues: readonly string[];
  readonly currentStatus: 'mapped' | 'quarantined' | 'unmapped';
  readonly currentAccountCode: string | null;
  readonly suggestedAccountCode: string | null;
  readonly suggestedAccountName: string | null;
  readonly matchRule: OnboardingMatchRule;
  readonly confidenceScore: number;
  readonly reason: string;
  readonly requiresHumanApproval: true;
}

const TOKEN_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  acct: ['account'],
  ap: ['accounts', 'payable'],
  ar: ['accounts', 'receivable'],
  bank: ['cash', 'operating'],
  cash: ['cash', 'bank'],
  cogs: ['cost', 'goods', 'sold', 'direct'],
  cos: ['cost', 'sales'],
  cust: ['accounts', 'receivable', 'customer'],
  depr: ['depreciation'],
  amort: ['amortization'],
  eq: ['equity'],
  exp: ['expense'],
  ga: ['general', 'administrative'],
  inv: ['inventory'],
  liab: ['liability'],
  opex: ['operating', 'expense'],
  ops: ['operating', 'cash'],
  pay: ['payroll', 'expense'],
  payroll: ['payroll', 'salaries', 'benefits'],
  ppe: ['property', 'plant', 'equipment'],
  rd: ['research', 'development'],
  rec: ['receivable'],
  rev: ['revenue'],
  saas: ['subscription', 'revenue', 'product'],
  sal: ['payroll', 'salaries'],
  sales: ['revenue', 'sales'],
  sm: ['sales', 'marketing'],
  sub: ['subscription', 'revenue'],
  tax: ['tax', 'income'],
  vend: ['accounts', 'payable', 'vendor'],
};

const STOP_TOKENS = new Set(['the', 'and', 'for', 'of', 'in', 'to', 'on', 'with', 'account', 'other']);

function tokenizeForMatching(input: string): Set<string> {
  const tokens = new Set<string>();
  const rawParts = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  for (const part of rawParts) {
    if (!STOP_TOKENS.has(part)) {
      tokens.add(part);
    }
    const expanded = TOKEN_SYNONYMS[part];
    if (expanded !== undefined) {
      for (const syn of expanded) {
        if (!STOP_TOKENS.has(syn)) tokens.add(syn);
      }
    }
  }
  return tokens;
}

function stripLeadingZerosIfNumeric(code: string): string | null {
  const trimmed = normalizeCode(code);
  if (!/^\d+$/.test(trimmed)) return null;
  const stripped = trimmed.replace(/^0+/, '');
  return stripped.length === 0 ? '0' : stripped;
}

/**
 * Extract all discovered account/source codes from a raw GL CSV text using the single
 * canonical CSV record parser (§2.4 One-Engine Law). Used both standalone and during validation
 * so unmapped partner codes produce deterministic suggestions before any commit.
 */
export function extractSourceCodesFromCsv(csvText: string): readonly OnboardingDiscoveredSource[] {
  const grid = parseCsvRecords(csvText);
  if (grid.headers.length === 0) return [];

  const colIndex = new Map<string, number>();
  grid.headers.forEach((h, idx) => colIndex.set(h, idx));
  const idxCode = colIndex.get('account_code') ?? colIndex.get('account') ?? 2;
  const idxDesc = colIndex.get('description') ?? colIndex.get('memo') ?? 3;
  const expectedCols = grid.headers.length;

  const grouped = new Map<string, { rowCount: number; samples: string[]; seenSamples: Set<string> }>();
  for (const row of grid.rows) {
    if (row.cells.every((c) => c.trim().length === 0)) continue;
    const firstNonEmpty = row.cells.find((c) => c.trim().length > 0)?.trim() ?? '';
    if (/^(?:grand\s+)?totals?\b/i.test(firstNonEmpty)) continue;
    if (row.cells.length !== expectedCols) continue;

    const rawCode = (row.cells[idxCode] ?? '').trim();
    if (rawCode.length === 0) continue;
    const sourceCode = normalizeCode(rawCode);
    const description = (row.cells[idxDesc] ?? '').replace(/\s+/g, ' ').trim();

    let bucket = grouped.get(sourceCode);
    if (bucket === undefined) {
      bucket = { rowCount: 0, samples: [], seenSamples: new Set<string>() };
      grouped.set(sourceCode, bucket);
    }
    bucket.rowCount += 1;
    if (description.length > 0 && !bucket.seenSamples.has(description) && bucket.samples.length < 5) {
      bucket.seenSamples.add(description);
      bucket.samples.push(description);
    }
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([sourceCode, info]) => ({
      sourceCode,
      rowCount: info.rowCount,
      sampleValues: info.samples,
    }));
}

/**
 * Deterministic assisted CoA matching (ONB1, §11.12).
 *
 * Rules:
 *  - Zero LLM inference at M2 (§2.3 cut line).
 *  - Preserves existing human-confirmed mappings and quarantines untouched.
 *  - Exact case-insensitive match takes precedence (preserving exact leading zeros).
 *  - Leading-zero numeric stripping ONLY suggests when target numeric form is unique in CoA;
 *    collisions like '001400' vs '1400' report `ambiguous_leading_zero` so humans decide.
 *  - Every suggestion requires explicit human confirmation before persisting to `coa_mapping`.
 */
export function suggestCoaMappings(params: {
  readonly sources: readonly OnboardingDiscoveredSource[];
  readonly accounts: readonly OnboardingChartAccountInput[];
  readonly existingMappings: readonly MappingVersionRow[];
  readonly asOfDate: string;
}): readonly OnboardingMappingSuggestion[] {
  const postableAccounts = params.accounts
    .filter((acc) => acc.active && acc.isPostable)
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  const accountByUpper = new Map<string, OnboardingChartAccountInput>();
  const byStrippedDigits = new Map<string, OnboardingChartAccountInput[]>();
  const accountTokens = new Map<string, Set<string>>();

  for (const acc of postableAccounts) {
    const normCode = normalizeCode(acc.code);
    accountByUpper.set(normCode.toUpperCase(), acc);
    const stripped = stripLeadingZerosIfNumeric(normCode);
    if (stripped !== null) {
      const list = byStrippedDigits.get(stripped);
      if (list === undefined) byStrippedDigits.set(stripped, [acc]);
      else list.push(acc);
    }
    const lineWords = acc.statementLineKey.replace(/\./g, ' ');
    accountTokens.set(acc.code, tokenizeForMatching(`${acc.name} ${lineWords}`));
  }

  const latestBySource = new Map<string, MappingVersionRow>();
  for (const row of params.existingMappings) {
    if (row.effectiveFrom > params.asOfDate) continue;
    const key = normalizeCode(row.sourceCode).toUpperCase();
    const current = latestBySource.get(key);
    if (current === undefined || row.mappingVersion > current.mappingVersion) {
      latestBySource.set(key, row);
    }
  }

  const sortedSources = [...params.sources].sort((a, b) =>
    a.sourceCode < b.sourceCode ? -1 : a.sourceCode > b.sourceCode ? 1 : 0,
  );

  return sortedSources.map((src) => {
    const normSource = normalizeCode(src.sourceCode);
    const sourceKey = normSource.toUpperCase();
    const existing = latestBySource.get(sourceKey);

    if (existing !== undefined) {
      if (existing.status === 'quarantined') {
        return {
          sourceCode: normSource,
          rowCount: src.rowCount,
          sampleValues: src.sampleValues,
          currentStatus: 'quarantined',
          currentAccountCode: null,
          suggestedAccountCode: null,
          suggestedAccountName: null,
          matchRule: 'already_quarantined',
          confidenceScore: 0,
          reason: `Explicitly quarantined (${existing.quarantineReason ?? 'MANUAL_QUARANTINE'}).`,
          requiresHumanApproval: true,
        };
      }
      if (existing.accountCode !== null) {
        const target = accountByUpper.get(normalizeCode(existing.accountCode).toUpperCase());
        if (target !== undefined) {
          return {
            sourceCode: normSource,
            rowCount: src.rowCount,
            sampleValues: src.sampleValues,
            currentStatus: 'mapped',
            currentAccountCode: target.code,
            suggestedAccountCode: target.code,
            suggestedAccountName: target.name,
            matchRule: 'already_mapped',
            confidenceScore: 100,
            reason: `Mapped by coa_mapping v${existing.mappingVersion} effective ${existing.effectiveFrom}.`,
            requiresHumanApproval: true,
          };
        }
      }
    }

    // 1. Exact code match (case-insensitive, preserves leading zeros strictly)
    const exactMatch = accountByUpper.get(sourceKey);
    if (exactMatch !== undefined) {
      return {
        sourceCode: normSource,
        rowCount: src.rowCount,
        sampleValues: src.sampleValues,
        currentStatus: 'unmapped',
        currentAccountCode: null,
        suggestedAccountCode: exactMatch.code,
        suggestedAccountName: exactMatch.name,
        matchRule: 'exact_code',
        confidenceScore: 100,
        reason: `Exact chart code match (${exactMatch.code} — ${exactMatch.name}).`,
        requiresHumanApproval: true,
      };
    }

    // 2. Leading-zero numeric alias (only when stripped numeric target is unique)
    const strippedSource = stripLeadingZerosIfNumeric(normSource);
    if (strippedSource !== null) {
      const numericMatches = byStrippedDigits.get(strippedSource) ?? [];
      if (numericMatches.length === 1) {
        const target = numericMatches[0]!;
        return {
          sourceCode: normSource,
          rowCount: src.rowCount,
          sampleValues: src.sampleValues,
          currentStatus: 'unmapped',
          currentAccountCode: null,
          suggestedAccountCode: target.code,
          suggestedAccountName: target.name,
          matchRule: 'leading_zero_alias',
          confidenceScore: 85,
          reason: `Unique numeric match to ${target.code} (${target.name}) differing only by leading zeros; confirm before saving.`,
          requiresHumanApproval: true,
        };
      }
      if (numericMatches.length > 1) {
        return {
          sourceCode: normSource,
          rowCount: src.rowCount,
          sampleValues: src.sampleValues,
          currentStatus: 'unmapped',
          currentAccountCode: null,
          suggestedAccountCode: null,
          suggestedAccountName: null,
          matchRule: 'ambiguous_leading_zero',
          confidenceScore: 0,
          reason: `Ambiguous leading-zero match: ${numericMatches.map((m) => m.code).join(', ')} share digits "${strippedSource}". Select target manually.`,
          requiresHumanApproval: true,
        };
      }
    }

    // 3. Deterministic token overlap on source code + row descriptions
    const srcTokens = tokenizeForMatching(`${normSource} ${src.sampleValues.join(' ')}`);
    let bestAcc: OnboardingChartAccountInput | null = null;
    let bestScore = 0;
    let tiedTop = false;

    for (const acc of postableAccounts) {
      const targetTokens = accountTokens.get(acc.code);
      if (targetTokens === undefined) continue;
      let shared = 0;
      for (const token of srcTokens) {
        if (targetTokens.has(token)) shared += 1;
      }
      if (shared > bestScore) {
        bestScore = shared;
        bestAcc = acc;
        tiedTop = false;
      } else if (shared > 0 && shared === bestScore) {
        tiedTop = true;
      }
    }

    if (bestScore >= 1 && bestAcc !== null && !tiedTop) {
      return {
        sourceCode: normSource,
        rowCount: src.rowCount,
        sampleValues: src.sampleValues,
        currentStatus: 'unmapped',
        currentAccountCode: null,
        suggestedAccountCode: bestAcc.code,
        suggestedAccountName: bestAcc.name,
        matchRule: 'token_name_match',
        confidenceScore: Math.min(82, 58 + bestScore * 8),
        reason: `Deterministic keyword match (${bestScore} shared accounting token(s)) with ${bestAcc.code} — ${bestAcc.name}; review before approving.`,
        requiresHumanApproval: true,
      };
    }

    if (bestScore >= 1 && tiedTop) {
      return {
        sourceCode: normSource,
        rowCount: src.rowCount,
        sampleValues: src.sampleValues,
        currentStatus: 'unmapped',
        currentAccountCode: null,
        suggestedAccountCode: null,
        suggestedAccountName: null,
        matchRule: 'ambiguous_token_match',
        confidenceScore: 0,
        reason: 'Multiple chart accounts tie on keyword overlap; select target manually.',
        requiresHumanApproval: true,
      };
    }

    return {
      sourceCode: normSource,
      rowCount: src.rowCount,
      sampleValues: src.sampleValues,
      currentStatus: 'unmapped',
      currentAccountCode: null,
      suggestedAccountCode: null,
      suggestedAccountName: null,
      matchRule: 'unmatched',
      confidenceScore: 0,
      reason: 'No deterministic match in the active postable chart; map manually or quarantine.',
      requiresHumanApproval: true,
    };
  });
}

export interface OnboardingImportedLineInput {
  readonly rowNo: number;
  readonly entryRef: string;
  readonly postingDate: string;
  readonly accountCode: string;
  readonly description: string;
  readonly periodCode: string;
  readonly debit: string;
  readonly credit: string;
}

export interface OnboardingQuarantineInput {
  readonly rowNo: number;
  readonly reason: string;
}

export interface OnboardingAnomalyItem {
  readonly kind:
    | 'unmapped_source_codes'
    | 'unbalanced_entries'
    | 'period_not_found'
    | 'calendar_gap'
    | 'leading_zero_collision'
    | 'quarantined_rows'
    | 'outlier_amount';
  readonly severity: 'blocker' | 'review';
  readonly title: string;
  readonly detail: string;
}

export interface OnboardingQuarantineCategory {
  readonly category: string;
  readonly count: number;
}

export interface OnboardingValidationAnalysis {
  readonly rowsIn: number;
  readonly importableCount: number;
  readonly quarantinedCount: number;
  readonly rowAccountingTies: boolean;
  readonly duplicatesDetected: number;
  readonly entryCount: number;
  readonly totalDebits: string;
  readonly totalCredits: string;
  readonly coveredPeriods: readonly string[];
  readonly missingInteriorPeriods: readonly string[];
  readonly leadingZeroCollisions: readonly string[];
  readonly quarantineBreakdown: readonly OnboardingQuarantineCategory[];
  readonly anomalies: readonly OnboardingAnomalyItem[];
  readonly suggestions: readonly OnboardingMappingSuggestion[];
  readonly goLiveStatus: 'ready' | 'ready_with_warnings' | 'blocked';
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
}

function quarantineCategoryOf(reason: string): string {
  const colonIdx = reason.indexOf(':');
  return colonIdx === -1 ? reason : reason.slice(0, colonIdx);
}

/**
 * Pure migration readiness & validation analyzer (ONB2, G1/C6, §1.6-6).
 *
 * Proves exact row accounting (`rowsIn === importableCount + quarantinedCount`), identifies
 * calendar period coverage + interior gaps, surfaces leading-zero collisions & extreme
 * amount outliers strictly using Decimal arithmetic (`§1.6-6: Potential exception — review`),
 * and reports whether cutover go-live is `ready`, `ready_with_warnings`, or `blocked`.
 */
export function analyzeOnboardingValidation(params: {
  readonly rowsIn: number;
  readonly importedRows: readonly OnboardingImportedLineInput[];
  readonly quarantined: readonly OnboardingQuarantineInput[];
  readonly duplicatesDetected: number;
  readonly entryCount: number;
  readonly totalDebits: string;
  readonly totalCredits: string;
  readonly currencyScale: number;
  readonly calendarPeriods: readonly GeneratedPeriod[];
  readonly accounts: readonly OnboardingChartAccountInput[];
  readonly suggestions: readonly OnboardingMappingSuggestion[];
}): OnboardingValidationAnalysis {
  const importableCount = params.importedRows.length;
  const quarantinedCount = params.quarantined.length;
  const rowAccountingTies = params.rowsIn === importableCount + quarantinedCount;

  // Quarantine category histogram
  const catCounts = new Map<string, number>();
  for (const q of params.quarantined) {
    const cat = quarantineCategoryOf(q.reason);
    catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
  }
  const quarantineBreakdown: OnboardingQuarantineCategory[] = [...catCounts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([category, count]) => ({ category, count }));

  // Period coverage & interior calendar gaps (ignore adjustment periods)
  const regularPeriods = [...params.calendarPeriods]
    .filter((p) => !p.isAdjustment)
    .sort((a, b) =>
      a.fiscalYear !== b.fiscalYear ? a.fiscalYear - b.fiscalYear : a.periodNo - b.periodNo,
    );
  const coveredSet = new Set(params.importedRows.map((row) => row.postingDate));
  const coveredIndices: number[] = [];
  const coveredPeriodKeys: string[] = [];

  regularPeriods.forEach((period, index) => {
    const hasHit = params.importedRows.some(
      (row) => row.postingDate >= period.startDate && row.postingDate <= period.endDate,
    );
    if (hasHit) {
      coveredIndices.push(index);
      coveredPeriodKeys.push(`${period.fyLabel} ${period.code}`);
    }
  });
  void coveredSet;

  const missingInteriorPeriods: string[] = [];
  if (coveredIndices.length >= 2) {
    const firstIdx = coveredIndices[0]!;
    const lastIdx = coveredIndices[coveredIndices.length - 1]!;
    const coveredIdxSet = new Set(coveredIndices);
    for (let idx = firstIdx; idx <= lastIdx; idx += 1) {
      if (!coveredIdxSet.has(idx)) {
        const missingPeriod = regularPeriods[idx]!;
        missingInteriorPeriods.push(`${missingPeriod.fyLabel} ${missingPeriod.code}`);
      }
    }
  }

  // Leading-zero collisions in active chart OR discovered codes
  const byStripped = new Map<string, Set<string>>();
  for (const acc of params.accounts) {
    const stripped = stripLeadingZerosIfNumeric(acc.code);
    if (stripped === null) continue;
    const set = byStripped.get(stripped) ?? new Set<string>();
    set.add(normalizeCode(acc.code));
    byStripped.set(stripped, set);
  }
  for (const sug of params.suggestions) {
    const stripped = stripLeadingZerosIfNumeric(sug.sourceCode);
    if (stripped === null) continue;
    const set = byStripped.get(stripped) ?? new Set<string>();
    set.add(normalizeCode(sug.sourceCode));
    byStripped.set(stripped, set);
  }
  const leadingZeroCollisions: string[] = [];
  for (const [, codes] of byStripped) {
    if (codes.size > 1) {
      const sorted = [...codes].sort();
      leadingZeroCollisions.push(sorted.join(' vs '));
    }
  }
  leadingZeroCollisions.sort();

  // Outliers using pure Decimal (row magnitude = debit + credit; non-negative because normalized)
  const rowMagnitudes: { row: OnboardingImportedLineInput; magnitude: Decimal }[] =
    params.importedRows.map((row) => ({
      row,
      magnitude: add(money(row.debit), money(row.credit)),
    }));
  const anomalies: OnboardingAnomalyItem[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!rowAccountingTies) {
    const msg = `Row accounting does not tie: rowsIn (${params.rowsIn}) != importable (${importableCount}) + quarantined (${quarantinedCount}).`;
    blockers.push(msg);
  }
  if (params.rowsIn === 0) {
    blockers.push('Dataset contains zero data rows.');
  } else if (importableCount === 0) {
    blockers.push('Zero rows can be posted; resolve unmapped accounts, periods, or balance errors.');
  }

  const unmappedCount = catCounts.get('UNMAPPED_ACCOUNT') ?? 0;
  if (unmappedCount > 0) {
    const detail = `${unmappedCount} row(s) reference unmapped source codes that require CoA mapping or explicit quarantine.`;
    blockers.push(detail);
    anomalies.push({
      kind: 'unmapped_source_codes',
      severity: 'blocker',
      title: 'Unmapped source account codes',
      detail,
    });
  }

  const unbalancedCount = catCounts.get('UNBALANCED_ENTRY') ?? 0;
  if (unbalancedCount > 0) {
    const detail = `${unbalancedCount} row(s) belong to unbalanced journal refs and will not post.`;
    blockers.push(detail);
    anomalies.push({
      kind: 'unbalanced_entries',
      severity: 'blocker',
      title: 'Unbalanced journal entries',
      detail,
    });
  }

  const outOfPeriodCount = catCounts.get('PERIOD_NOT_FOUND') ?? 0;
  if (outOfPeriodCount > 0) {
    const detail = `${outOfPeriodCount} row(s) fall outside configured fiscal calendar periods.`;
    blockers.push(detail);
    anomalies.push({
      kind: 'period_not_found',
      severity: 'blocker',
      title: 'Posting dates outside fiscal calendar',
      detail,
    });
  }

  const totalDebitDec = money(params.totalDebits);
  const totalCreditDec = money(params.totalCredits);
  if (compare(totalDebitDec, totalCreditDec) !== 0) {
    blockers.push(
      `Posted total debits (${params.totalDebits}) do not equal total credits (${params.totalCredits}).`,
    );
  }

  const nonBlockingQuarantined = quarantinedCount - unmappedCount - unbalancedCount - outOfPeriodCount;
  if (nonBlockingQuarantined > 0) {
    const detail = `Potential exception — review: ${nonBlockingQuarantined} formatting/summary/duplicate row(s) were cleanly quarantined and accounted for.`;
    warnings.push(detail);
    anomalies.push({
      kind: 'quarantined_rows',
      severity: 'review',
      title: 'Potential exception — review quarantined rows',
      detail,
    });
  }

  if (missingInteriorPeriods.length > 0) {
    const detail = `Potential exception — review: Missing interior fiscal period(s) with zero imported lines: ${missingInteriorPeriods.join(', ')}.`;
    warnings.push(detail);
    anomalies.push({
      kind: 'calendar_gap',
      severity: 'review',
      title: 'Potential exception — review calendar gap',
      detail,
    });
  }

  if (leadingZeroCollisions.length > 0) {
    const detail = `Potential exception — review: Distinct leading-zero account codes detected (${leadingZeroCollisions.join('; ')}); verify exact string codes are intentional.`;
    warnings.push(detail);
    anomalies.push({
      kind: 'leading_zero_collision',
      severity: 'review',
      title: 'Potential exception — review leading-zero distinction',
      detail,
    });
  }

  if (rowMagnitudes.length >= 4) {
    const sorted = [...rowMagnitudes].sort((a, b) => compare(a.magnitude, b.magnitude));
    const medianMagnitude = sorted[Math.floor(sorted.length / 2)]!.magnitude;
    if (!isZero(medianMagnitude)) {
      const outlierLimit = mul(medianMagnitude, money('10'));
      const outliers = rowMagnitudes.filter((entry) => compare(entry.magnitude, outlierLimit) > 0);
      if (outliers.length > 0) {
        const sample = outliers[0]!;
        const detail = `Potential exception — review: ${outliers.length} row(s) exceed 10x median line value (e.g. row ${sample.row.rowNo} ${sample.row.entryRef} = ${serialize(sample.magnitude, params.currencyScale)}).`;
        warnings.push(detail);
        anomalies.push({
          kind: 'outlier_amount',
          severity: 'review',
          title: 'Potential exception — review large line outlier',
          detail,
        });
      }
    }
  }

  const goLiveStatus: 'ready' | 'ready_with_warnings' | 'blocked' =
    blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'ready_with_warnings' : 'ready';

  return {
    rowsIn: params.rowsIn,
    importableCount,
    quarantinedCount,
    rowAccountingTies,
    duplicatesDetected: params.duplicatesDetected,
    entryCount: params.entryCount,
    totalDebits: params.totalDebits,
    totalCredits: params.totalCredits,
    coveredPeriods: coveredPeriodKeys,
    missingInteriorPeriods,
    leadingZeroCollisions,
    quarantineBreakdown,
    anomalies,
    suggestions: params.suggestions,
    goLiveStatus,
    blockers,
    warnings,
  };
}

/**
 * Canonical SHA-256 rehearsal fingerprint (ONB3). Ensures repeated dry-run and staged cutover
 * rehearsals over identical dataset + CoA mappings produce identical deterministic hashes and
 * projected trial balance totals.
 */
export function computeRehearsalFingerprint(params: {
  readonly companyId: string;
  readonly sourceHash: string;
  readonly goLiveStatus: string;
  readonly rowsIn: number;
  readonly importableCount: number;
  readonly quarantinedCount: number;
  readonly totalDebits: string;
  readonly totalCredits: string;
  readonly trialBalanceTotalDebit: string;
  readonly trialBalanceTotalCredit: string;
  readonly importedLines: readonly {
    readonly rowNo: number;
    readonly entryRef: string;
    readonly postingDate: string;
    readonly accountCode: string;
    readonly debit: string;
    readonly credit: string;
  }[];
}): string {
  const canonicalPayload = JSON.stringify({
    companyId: params.companyId,
    sourceHash: params.sourceHash,
    goLiveStatus: params.goLiveStatus,
    rowsIn: params.rowsIn,
    importableCount: params.importableCount,
    quarantinedCount: params.quarantinedCount,
    totalDebits: params.totalDebits,
    totalCredits: params.totalCredits,
    trialBalanceTotalDebit: params.trialBalanceTotalDebit,
    trialBalanceTotalCredit: params.trialBalanceTotalCredit,
    importedLines: params.importedLines,
  });
  return sha256Hex(canonicalPayload);
}

/**
 * Deterministic Synthetic Partner Dataset for ONB1 end-to-end onboarding verification.
 * Never touches real partner exports and contains clean balanced journals alongside messy
 * export artifacts (summary row, blank row, interior gap P03, aliased source codes).
 */
export function buildSyntheticPartnerDataset(): {
  readonly partnerName: string;
  readonly sourceFilename: string;
  readonly csvText: string;
} {
  const lines = [
    'entry_ref,date,account_code,description,debit,credit',
    'PRT-101,2026-01-15,OPS-CASH,Customer subscription collection,25000.00,0.00',
    'PRT-101,2026-01-15,SAAS-REV,Annual platform contract,0.00,25000.00',
    'PRT-102,2026-02-10,SAL-PAYROLL,Engineering & G&A payroll,14000.00,0.00',
    'PRT-102,2026-02-10,OPS-CASH,Payroll settlement wire,0.00,14000.00',
    'PRT-103,2026-02-20,CUST-AR,Enterprise onboarding invoice,9500.00,0.00',
    'PRT-103,2026-02-20,SAAS-REV,Enterprise ARR recognition,0.00,9500.00',
    'PRT-104,2026-04-08,OPS-CASH,AR invoice collection,9500.00,0.00',
    'PRT-104,2026-04-08,CUST-AR,Clear enterprise receivable,0.00,9500.00',
    ',,,,,',
    'TOTAL,,,,58000.00,58000.00',
  ];
  return {
    partnerName: 'Apex Precision Tools — SYNTHETIC PARTNER',
    sourceFilename: 'apex-partner-q1-cutover.csv',
    csvText: `${lines.join('\n')}\n`,
  };
}
