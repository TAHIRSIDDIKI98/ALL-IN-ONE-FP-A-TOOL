// Pure versioned source→account mapping kernel (MASTER_PROMPT §4.2/§4.3, §9.3.4; SPEC §3.6f).
// One resolver serves both import preview and commit (K3: one canonical definition), and every
// edit is a NEW immutable version. No floating-point or financial arithmetic lives here.

import { normalizeCode } from '../statements/index.js';

export type MappingStatus = 'mapped' | 'quarantined';
export type MappingQuarantineReason =
  | 'MANUAL_QUARANTINE'
  | 'NO_TARGET_ACCOUNT'
  | 'AMBIGUOUS_TARGET';

export interface MappingVersionRow {
  readonly sourceCode: string;
  readonly accountCode: string | null;
  readonly mappingVersion: number;
  readonly effectiveFrom: string;
  readonly status: MappingStatus;
  readonly quarantineReason: MappingQuarantineReason | null;
}

export type MappingResolution =
  | { readonly kind: 'mapped'; readonly accountCode: string }
  | { readonly kind: 'quarantine'; readonly reason: string };

function normalizedSourceCode(rawCode: string): string {
  return normalizeCode(rawCode);
}

function canonicalByUpper(codes: Iterable<string>): Map<string, string> {
  const result = new Map<string, string>();
  for (const rawCode of codes) {
    const code = normalizeCode(rawCode);
    result.set(code.toUpperCase(), code);
  }
  return result;
}

/**
 * Resolve ONE source code as of a date.
 *
 * Precedence is fixed: newest effective mapping version → explicit quarantine → explicit target →
 * exact chart-code match → named `UNMAPPED_ACCOUNT` quarantine. A future-dated version is invisible
 * to an earlier `asOfDate`. An explicit target that is no longer in the chart is never guessed.
 */
export function resolveSourceAccountCode(params: {
  readonly sourceCode: string;
  readonly mappings: readonly MappingVersionRow[];
  readonly chartCodes: ReadonlySet<string>;
  readonly asOfDate: string;
}): MappingResolution {
  const sourceKey = normalizedSourceCode(params.sourceCode).toUpperCase();
  const chartByUpper = canonicalByUpper(params.chartCodes);

  let best: MappingVersionRow | undefined;
  for (const row of params.mappings) {
    if (normalizedSourceCode(row.sourceCode).toUpperCase() !== sourceKey) continue;
    if (row.effectiveFrom > params.asOfDate) continue;
    if (best === undefined || row.mappingVersion > best.mappingVersion) best = row;
  }

  if (best !== undefined) {
    if (best.status === 'quarantined') {
      return { kind: 'quarantine', reason: `QUARANTINED_BY_MAPPING:${best.quarantineReason ?? 'MANUAL_QUARANTINE'}` };
    }
    if (best.accountCode === null) {
      return { kind: 'quarantine', reason: `NO_TARGET_ACCOUNT:${sourceKey}` };
    }
    const target = chartByUpper.get(best.accountCode.toUpperCase());
    if (target === undefined) {
      return { kind: 'quarantine', reason: `NO_TARGET_ACCOUNT:${best.accountCode}` };
    }
    return { kind: 'mapped', accountCode: target };
  }

  const exact = chartByUpper.get(sourceKey);
  if (exact !== undefined) return { kind: 'mapped', accountCode: exact };
  return { kind: 'quarantine', reason: `UNMAPPED_ACCOUNT:${sourceKey}` };
}

export interface MappingEdit {
  readonly sourceCode: string;
  readonly status: MappingStatus;
  readonly accountCode: string | null;
  readonly quarantineReason: MappingQuarantineReason | null;
}

/** A planned new version, before it is written by the repository. */
export interface PlannedMappingVersion extends MappingVersionRow {}

/**
 * Validate a whole edit batch and plan the versions to write. The batch is all-or-nothing: any
 * issue returns ZERO versions, so one bad row cannot leave a half-applied mapping set. An edit whose
 * payload is identical to the current effective version is a deliberate no-op (idempotency).
 */
export function planMappingVersions(params: {
  readonly existing: readonly MappingVersionRow[];
  readonly edits: readonly MappingEdit[];
  readonly effectiveFrom: string;
  readonly knownAccountCodes: ReadonlySet<string>;
  readonly discoveredCodes: ReadonlySet<string>;
}): { readonly versions: readonly PlannedMappingVersion[]; readonly issues: readonly string[] } {
  const issues: string[] = [];
  const chartByUpper = canonicalByUpper(params.knownAccountCodes);
  const discoveredByUpper = new Set(
    [...params.discoveredCodes].map((code) => normalizedSourceCode(code).toUpperCase()),
  );
  const latestBySource = new Map<string, MappingVersionRow>();
  for (const row of params.existing) {
    const key = normalizedSourceCode(row.sourceCode).toUpperCase();
    const current = latestBySource.get(key);
    if (current === undefined || row.mappingVersion > current.mappingVersion) {
      latestBySource.set(key, row);
    }
  }

  const seen = new Set<string>();
  params.edits.forEach((edit, index) => {
    const prefix = `row ${index + 1}: `;
    let code: string;
    try {
      code = normalizedSourceCode(edit.sourceCode);
    } catch {
      issues.push(`${prefix}EMPTY_SOURCE_CODE`);
      return;
    }
    const key = code.toUpperCase();
    if (seen.has(key)) issues.push(`${prefix}DUPLICATE_SOURCE_CODE:${code}`);
    seen.add(key);
    if (!discoveredByUpper.has(key)) issues.push(`${prefix}UNKNOWN_SOURCE_CODE:${code}`);
    if (edit.status === 'mapped') {
      if (edit.accountCode === null) {
        issues.push(`${prefix}MISSING_ACCOUNT:${code}`);
      } else if (chartByUpper.get(edit.accountCode.toUpperCase()) === undefined) {
        issues.push(`${prefix}UNKNOWN_ACCOUNT:${edit.accountCode}`);
      }
    } else if (edit.quarantineReason === null) {
      issues.push(`${prefix}MISSING_QUARANTINE_REASON:${code}`);
    }
  });
  if (issues.length > 0) return { versions: [], issues };

  const versions: PlannedMappingVersion[] = [];
  for (const edit of params.edits) {
    const code = normalizedSourceCode(edit.sourceCode);
    const key = code.toUpperCase();
    const current = latestBySource.get(key);
    const target = edit.accountCode === null ? null : chartByUpper.get(edit.accountCode.toUpperCase()) ?? edit.accountCode;
    if (
      current !== undefined &&
      current.status === edit.status &&
      current.accountCode === target &&
      current.quarantineReason === edit.quarantineReason
    ) {
      continue;
    }
    versions.push({
      sourceCode: code,
      accountCode: edit.status === 'mapped' ? target : null,
      mappingVersion: (current?.mappingVersion ?? 0) + 1,
      effectiveFrom: params.effectiveFrom,
      status: edit.status,
      quarantineReason: edit.status === 'quarantined' ? edit.quarantineReason : null,
    });
  }
  return { versions, issues };
}

export interface DiscoveredSourceCode {
  readonly sourceCode: string;
  readonly rowCount: number;
  readonly sampleValues: readonly string[];
}

export interface MappingReportInput {
  readonly companyId: string;
  readonly effectiveFrom: string;
  readonly discovered: readonly DiscoveredSourceCode[];
  readonly mappings: readonly MappingVersionRow[];
  readonly accounts: readonly { readonly code: string; readonly name: string }[];
}

/**
 * Project stored versions and discovered source codes into the mapper's wire report. Conflict is a
 * WARNING (two different sources target the same account); it does not silently reject or rewrite a
 * mapping that the operator made explicitly.
 */
export function buildMappingReport(params: MappingReportInput) {
  const accountByCode = new Map(params.accounts.map((account) => [account.code, account]));
  const discovered = [...params.discovered].sort((a, b) =>
    a.sourceCode < b.sourceCode ? -1 : a.sourceCode > b.sourceCode ? 1 : 0,
  );

  const latestBySource = new Map<string, MappingVersionRow>();
  for (const row of params.mappings) {
    if (row.effectiveFrom > params.effectiveFrom) continue;
    const key = row.sourceCode.toUpperCase();
    const current = latestBySource.get(key);
    if (current === undefined || row.mappingVersion > current.mappingVersion) {
      latestBySource.set(key, row);
    }
  }

  const targetCounts = new Map<string, number>();
  for (const row of latestBySource.values()) {
    if (row.status !== 'mapped' || row.accountCode === null) continue;
    targetCounts.set(row.accountCode, (targetCounts.get(row.accountCode) ?? 0) + 1);
  }

  const mappings = discovered.map((source) => {
    const row = latestBySource.get(source.sourceCode.toUpperCase());
    const accountCode = row?.accountCode ?? null;
    return {
      sourceSystem: 'csv' as const,
      sourceCode: source.sourceCode,
      accountCode,
      accountName: accountCode === null ? null : (accountByCode.get(accountCode)?.name ?? null),
      mappingVersion: row?.mappingVersion ?? 0,
      effectiveFrom: row?.effectiveFrom ?? params.effectiveFrom,
      status: row?.status ?? ('unmapped' as const),
      quarantineReason: row?.quarantineReason ?? null,
      targetConflict: accountCode !== null && (targetCounts.get(accountCode) ?? 0) > 1,
      rowCount: source.rowCount,
      sampleValues: [...source.sampleValues].slice(0, 5),
    };
  });

  // 'unmapped' is an honest DISPLAY state (zero versions), never a database row (SPEC §3.6f).
  return {
    companyId: params.companyId,
    sourceSystem: 'csv' as const,
    effectiveFrom: params.effectiveFrom,
    mappings,
    availableAccounts: params.accounts.map((account) => ({ code: account.code, name: account.name })),
    mappedCount: mappings.filter((entry) => entry.status === 'mapped').length,
    quarantinedCount: mappings.filter((entry) => entry.status === 'quarantined').length,
    unmappedCount: mappings.filter((entry) => entry.status === 'unmapped').length,
    conflictCount: mappings.filter((entry) => entry.targetConflict).length,
  };
}
