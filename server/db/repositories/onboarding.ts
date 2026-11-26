import type { GeneratedPeriod } from '../../../core/calendar/index.js';
import { planMappingVersions } from '../../../core/mapping/index.js';
import { add, compare, isZero, money, serialize } from '../../../core/money/index.js';
import {
  analyzeOnboardingValidation,
  computeRehearsalFingerprint,
  extractSourceCodesFromCsv,
  suggestCoaMappings,
} from '../../../core/onboarding/index.js';
import { canActorCreateTask } from '../../../core/workflow/index.js';
import { AppError } from '../../../shared/errors.js';
import type {
  OnboardingApproveMappingsRequest,
  OnboardingApproveMappingsResponse,
  OnboardingRehearseRequest,
  OnboardingRehearseResponse,
  OnboardingTrialBalanceSummary,
  OnboardingValidateRequest,
  OnboardingValidationReport,
} from '../../../shared/onboarding.js';
import type { MembershipRole } from '../../../shared/workflow.js';
import { appendAuditLog } from '../../audit/index.js';
import type { SqlExecutor } from '../migrate.js';
import { listAllMappingVersions, listCoaMappings } from './coaMapping.js';
import { activeBatchPredicate, classifyImport, commitImport } from './import.js';
import { getTrialBalance } from './reports.js';

/**
 * M2 Customer Onboarding & Data Migration Pipeline Repository (§11.12, ONB1–ONB3).
 *
 * - Reuses the ONE canonical `classifyImport`, `planMappingVersions`, `commitImport`, and
 *   `getTrialBalance` paths (§2.4 One-Engine Law).
 * - CoA suggestions never auto-commit; only explicit human approvals write immutable `coa_mapping`
 *   versions paired with an audit log entry.
 * - `dry_run` performs zero DB writes; `stage_commit` executes atomic idempotent replacement and
 *   proves deterministic `rehearsalHash` repeatability across runs (ONB3).
 */

interface RoleDbRow extends Record<string, unknown> {
  role: MembershipRole;
}

interface ChartAccountDbRow extends Record<string, unknown> {
  id: string;
  code: string;
  name: string;
  type: string;
  statement_line_key: string;
  active: boolean;
  is_postable: boolean;
}

interface PeriodDbRow extends Record<string, unknown> {
  code: string;
  fiscal_year: number;
  period_no: number;
  quarter: number;
  label: string;
  start_date: string | Date;
  end_date: string | Date;
  is_adjustment: boolean;
  is_53rd_week: boolean;
}

interface ExistingGlLineDbRow extends Record<string, unknown> {
  account_code: string;
  debit: string;
  credit: string;
}

function toIsoDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

async function requireOnboardingEditorRole(
  db: SqlExecutor,
  companyId: string,
  actorId: string,
): Promise<MembershipRole> {
  const res = await db.query<RoleDbRow>(
    `SELECT role FROM company_member WHERE company_id = $1 AND user_id = $2`,
    [companyId, actorId],
  );
  const role = res.rows[0]?.role;
  if (role === undefined || !canActorCreateTask(role)) {
    throw new AppError('TENANT_FORBIDDEN', {
      userMessage: 'Only workspace owners or editors may run customer onboarding or migration rehearsals.',
    });
  }
  return role;
}

async function loadChartAccounts(db: SqlExecutor, companyId: string): Promise<readonly ChartAccountDbRow[]> {
  const res = await db.query<ChartAccountDbRow>(
    `SELECT id, code, name, type, statement_line_key, active, is_postable
       FROM account
      WHERE company_id = $1
      ORDER BY code ASC`,
    [companyId],
  );
  return res.rows;
}

async function loadFiscalPeriods(db: SqlExecutor, companyId: string): Promise<readonly GeneratedPeriod[]> {
  const res = await db.query<PeriodDbRow>(
    `SELECT code, fiscal_year, period_no, quarter, label, start_date, end_date, is_adjustment, is_53rd_week
       FROM fiscal_period
      WHERE company_id = $1
      ORDER BY fiscal_year ASC, period_no ASC`,
    [companyId],
  );
  return res.rows.map((row) => ({
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
  }));
}

async function buildValidationBundle(
  db: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly csvText: string;
    readonly asOfDate: string;
  },
) {
  const [classification, accounts, existingMappings, calendarPeriods] = await Promise.all([
    classifyImport(db, {
      companyId: params.companyId,
      csvText: params.csvText,
      asOfDate: params.asOfDate,
    }),
    loadChartAccounts(db, params.companyId),
    listCoaMappings(db, params.companyId, params.asOfDate),
    loadFiscalPeriods(db, params.companyId),
  ]);

  const discoveredSources = extractSourceCodesFromCsv(params.csvText);
  const suggestions = suggestCoaMappings({
    sources: discoveredSources,
    accounts: accounts.map((acc) => ({
      code: acc.code,
      name: acc.name,
      type: acc.type,
      statementLineKey: acc.statement_line_key,
      active: acc.active,
      isPostable: acc.is_postable,
    })),
    existingMappings,
    asOfDate: params.asOfDate,
  });

  const postedRows = classification.postable.flatMap((group) => group.rows);
  const analysis = analyzeOnboardingValidation({
    rowsIn: classification.rowsIn,
    importedRows: postedRows.map((entry) => ({
      rowNo: entry.row.rowNo,
      entryRef: entry.row.entryRef,
      postingDate: entry.row.postingDate,
      accountCode: entry.row.accountCode,
      description: entry.row.description,
      periodCode: entry.periodCode,
      debit: serialize(entry.row.debit, classification.currencyScale),
      credit: serialize(entry.row.credit, classification.currencyScale),
    })),
    quarantined: classification.quarantined,
    duplicatesDetected: classification.duplicatesDetected,
    entryCount: classification.entryCount,
    totalDebits: classification.totalDebits,
    totalCredits: classification.totalCredits,
    currencyScale: classification.currencyScale,
    calendarPeriods,
    accounts: accounts.map((acc) => ({
      code: acc.code,
      name: acc.name,
      type: acc.type,
      statementLineKey: acc.statement_line_key,
      active: acc.active,
      isPostable: acc.is_postable,
    })),
    suggestions,
  });

  const report: OnboardingValidationReport = {
    companyId: params.companyId,
    sourceHash: classification.sourceHash,
    asOfDate: params.asOfDate,
    rowsIn: analysis.rowsIn,
    importableCount: analysis.importableCount,
    quarantinedCount: analysis.quarantinedCount,
    rowAccountingTies: analysis.rowAccountingTies,
    duplicatesDetected: analysis.duplicatesDetected,
    entryCount: analysis.entryCount,
    totalDebits: analysis.totalDebits,
    totalCredits: analysis.totalCredits,
    coveredPeriods: [...analysis.coveredPeriods],
    missingInteriorPeriods: [...analysis.missingInteriorPeriods],
    leadingZeroCollisions: [...analysis.leadingZeroCollisions],
    quarantineBreakdown: [...analysis.quarantineBreakdown],
    quarantined: [...classification.quarantined],
    anomalies: [...analysis.anomalies],
    suggestions: [...analysis.suggestions],
    availableAccounts: accounts
      .filter((acc) => acc.active && acc.is_postable)
      .map((acc) => ({ code: acc.code, name: acc.name })),
    goLiveStatus: analysis.goLiveStatus,
    blockers: [...analysis.blockers],
    warnings: [...analysis.warnings],
  };

  return { report, classification, postedRows };
}

export async function validateCompanyOnboarding(
  db: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly request: OnboardingValidateRequest;
    readonly defaultAsOfDate: string;
  },
): Promise<OnboardingValidationReport> {
  await requireOnboardingEditorRole(db, params.companyId, params.actorId);
  const asOfDate = params.request.asOfDate ?? params.defaultAsOfDate;
  const { report } = await buildValidationBundle(db, {
    companyId: params.companyId,
    csvText: params.request.csvText,
    asOfDate,
  });
  return report;
}

export async function approveOnboardingMappings(
  tx: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly request: OnboardingApproveMappingsRequest;
    readonly occurredAt: string;
  },
): Promise<OnboardingApproveMappingsResponse> {
  await requireOnboardingEditorRole(tx, params.companyId, params.actorId);
  const effectiveFrom = params.request.asOfDate ?? params.occurredAt.slice(0, 10);

  const [existing, accounts] = await Promise.all([
    listAllMappingVersions(tx, params.companyId),
    loadChartAccounts(tx, params.companyId),
  ]);
  const postable = accounts.filter((acc) => acc.active && acc.is_postable);
  const accountByUpper = new Map(postable.map((acc) => [acc.code.toUpperCase(), acc]));

  const discoveredFromCsv = extractSourceCodesFromCsv(params.request.csvText);
  const discoveredCodes = new Set(discoveredFromCsv.map((d) => d.sourceCode));
  for (const row of existing) discoveredCodes.add(row.sourceCode);

  const { versions, issues } = planMappingVersions({
    existing,
    edits: params.request.entries,
    effectiveFrom,
    knownAccountCodes: new Set(postable.map((acc) => acc.code)),
    discoveredCodes,
  });
  if (issues.length > 0) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `The onboarding mapping approval batch has ${issues.length} issue(s); nothing was saved.`,
      details: { issues: [...issues] },
    });
  }

  let written = 0;
  for (const version of versions) {
    const accountId =
      version.accountCode === null
        ? null
        : (accountByUpper.get(version.accountCode.toUpperCase())?.id ?? null);
    await tx.query(
      `INSERT INTO coa_mapping (
         company_id, source_system, source_code, account_id, mapping_version,
         effective_from, status, quarantine_reason
       )
       VALUES ($1, 'csv', $2, $3, $4, $5::date, $6, $7)`,
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
    written += 1;
  }

  const unchanged = params.request.entries.length - written;
  await appendAuditLog(tx, {
    companyId: params.companyId,
    actorId: params.actorId,
    action: 'onboarding.coa_mapping_approve',
    targetTable: 'coa_mapping',
    targetId: params.companyId,
    oldPayload: null,
    newPayload: {
      effectiveFrom,
      written,
      unchanged,
      versions: versions.map((v) => ({
        sourceCode: v.sourceCode,
        mappingVersion: v.mappingVersion,
        status: v.status,
        accountCode: v.accountCode,
        quarantineReason: v.quarantineReason,
      })),
    },
    occurredAt: params.occurredAt,
  });

  const { report } = await buildValidationBundle(tx, {
    companyId: params.companyId,
    csvText: params.request.csvText,
    asOfDate: effectiveFrom,
  });

  return {
    companyId: params.companyId,
    effectiveFrom,
    written,
    unchanged,
    validation: report,
  };
}

async function projectDryRunTrialBalance(
  db: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly sourceHash: string;
    readonly currencyScale: number;
    readonly stagedRows: readonly {
      readonly accountCode: string;
      readonly debit: string;
      readonly credit: string;
    }[];
  },
): Promise<OnboardingTrialBalanceSummary> {
  // Read active GL postings excluding any prior batch for this exact sourceHash so dry-run before
  // stage_commit and dry-run after stage_commit produce identical trial-balance projections (ONB3).
  const existingLines = await db.query<ExistingGlLineDbRow>(
    `SELECT a.code AS account_code,
            l.debit::text AS debit,
            l.credit::text AS credit
       FROM gl_line l
       JOIN gl_entry e ON e.company_id = l.company_id AND e.id = l.entry_id
       JOIN import_batch b ON b.id = e.batch_id
       JOIN account a ON a.company_id = l.company_id AND a.id = l.account_id
      WHERE l.company_id = $1
        AND ${activeBatchPredicate('e')}
        AND b.source_hash <> $2`,
    [params.companyId, params.sourceHash],
  );

  const accountBalances = new Map<string, { debit: ReturnType<typeof money>; credit: ReturnType<typeof money> }>();
  const accumulate = (code: string, debitStr: string, creditStr: string): void => {
    const cur = accountBalances.get(code) ?? { debit: money('0'), credit: money('0') };
    accountBalances.set(code, {
      debit: add(cur.debit, money(debitStr)),
      credit: add(cur.credit, money(creditStr)),
    });
  };

  for (const row of existingLines.rows) {
    accumulate(row.account_code, row.debit, row.credit);
  }
  for (const row of params.stagedRows) {
    accumulate(row.accountCode, row.debit, row.credit);
  }

  let totalDebit = money('0');
  let totalCredit = money('0');
  let activeAccounts = 0;

  for (const entry of accountBalances.values()) {
    totalDebit = add(totalDebit, entry.debit);
    totalCredit = add(totalCredit, entry.credit);
    if (!isZero(entry.debit) || !isZero(entry.credit)) {
      activeAccounts += 1;
    }
  }

  return {
    isBalanced: compare(totalDebit, totalCredit) === 0,
    totalDebit: serialize(totalDebit, params.currencyScale),
    totalCredit: serialize(totalCredit, params.currencyScale),
    accountCount: activeAccounts,
  };
}

export async function rehearseCompanyOnboarding(
  dbOrTx: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly request: OnboardingRehearseRequest;
    readonly occurredAt: string;
  },
): Promise<OnboardingRehearseResponse> {
  await requireOnboardingEditorRole(dbOrTx, params.companyId, params.actorId);
  const asOfDate = params.request.asOfDate ?? params.occurredAt.slice(0, 10);

  const { report, classification, postedRows } = await buildValidationBundle(dbOrTx, {
    companyId: params.companyId,
    csvText: params.request.csvText,
    asOfDate,
  });

  const canonicalLines = postedRows.map((entry) => ({
    rowNo: entry.row.rowNo,
    entryRef: entry.row.entryRef,
    postingDate: entry.row.postingDate,
    accountCode: entry.row.accountCode,
    debit: serialize(entry.row.debit, classification.currencyScale),
    credit: serialize(entry.row.credit, classification.currencyScale),
  }));

  if (params.request.mode === 'dry_run') {
    const trialBalanceAfter = await projectDryRunTrialBalance(dbOrTx, {
      companyId: params.companyId,
      sourceHash: report.sourceHash,
      currencyScale: classification.currencyScale,
      stagedRows: canonicalLines.map((line) => ({
        accountCode: line.accountCode,
        debit: line.debit,
        credit: line.credit,
      })),
    });

    const rehearsalHash = computeRehearsalFingerprint({
      companyId: params.companyId,
      sourceHash: report.sourceHash,
      goLiveStatus: report.goLiveStatus,
      rowsIn: report.rowsIn,
      importableCount: report.importableCount,
      quarantinedCount: report.quarantinedCount,
      totalDebits: report.totalDebits,
      totalCredits: report.totalCredits,
      trialBalanceTotalDebit: trialBalanceAfter.totalDebit,
      trialBalanceTotalCredit: trialBalanceAfter.totalCredit,
      importedLines: canonicalLines,
    });

    return {
      companyId: params.companyId,
      mode: 'dry_run',
      rehearsalHash,
      sourceHash: report.sourceHash,
      validation: report,
      committed: null,
      trialBalanceAfter,
      executedAt: params.occurredAt,
    };
  }

  if (report.goLiveStatus === 'blocked') {
    throw new AppError('VALIDATION_FAILED', {
      userMessage:
        'Cutover rehearsal stage-commit is blocked until migration blockers (unmapped codes, unbalanced journals, or out-of-calendar dates) are resolved.',
      details: { blockers: [...report.blockers] },
    });
  }

  const committed = await commitImport(dbOrTx, {
    companyId: params.companyId,
    actorId: params.actorId,
    kind: 'actuals',
    sourceFilename: params.request.sourceFilename,
    csvText: params.request.csvText,
    occurredAt: params.occurredAt,
  });

  const tb = await getTrialBalance(dbOrTx, { companyId: params.companyId });
  const activeAccounts = tb.rows.filter(
    (row) => !isZero(money(row.totalDebit)) || !isZero(money(row.totalCredit)),
  ).length;
  const trialBalanceAfter: OnboardingTrialBalanceSummary = {
    isBalanced: tb.isBalanced,
    totalDebit: tb.totalDebit,
    totalCredit: tb.totalCredit,
    accountCount: activeAccounts,
  };

  const rehearsalHash = computeRehearsalFingerprint({
    companyId: params.companyId,
    sourceHash: report.sourceHash,
    goLiveStatus: report.goLiveStatus,
    rowsIn: report.rowsIn,
    importableCount: report.importableCount,
    quarantinedCount: report.quarantinedCount,
    totalDebits: report.totalDebits,
    totalCredits: report.totalCredits,
    trialBalanceTotalDebit: trialBalanceAfter.totalDebit,
    trialBalanceTotalCredit: trialBalanceAfter.totalCredit,
    importedLines: canonicalLines,
  });

  await appendAuditLog(dbOrTx, {
    companyId: params.companyId,
    actorId: params.actorId,
    action: 'onboarding.cutover_rehearsal',
    targetTable: 'import_batch',
    targetId: committed.batchId,
    oldPayload: committed.replacedBatchId === null ? null : { replacedBatchId: committed.replacedBatchId },
    newPayload: {
      mode: 'stage_commit',
      rehearsalHash,
      sourceHash: committed.sourceHash,
      rowsIn: committed.rowsIn,
      importedCount: committed.importedCount,
      quarantinedCount: committed.quarantinedCount,
      trialBalanceAfter,
    },
    occurredAt: params.occurredAt,
  });

  return {
    companyId: params.companyId,
    mode: 'stage_commit',
    rehearsalHash,
    sourceHash: report.sourceHash,
    validation: report,
    committed,
    trialBalanceAfter,
    executedAt: params.occurredAt,
  };
}
