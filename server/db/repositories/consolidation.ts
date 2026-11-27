import {
  computeFxRevaluation,
  consolidateGroup,
  ConsolidationError,
  type ConsolidationEntityAccountLine,
  type ConsolidationEntityInput,
  type ConsolidationMethod,
  type ConsolidationResult,
  type EntityOwnershipInput,
  type FxRateRecord,
  type FxRateType,
  type IntercompanyRuleInput,
  type IntercompanyRuleType,
  type MonetaryRevaluationItemInput,
} from '../../../core/consolidation/index.js';
import { money } from '../../../core/money/index.js';
import type { AccountType, NormalSide } from '../../../core/statements/index.js';
import { AppError } from '../../../shared/errors.js';
import type {
  ConsolidationEntitySummary,
  ConsolidationRunSummary,
  ConsolidationWorkspaceResponse,
  CreateEntityRequest,
  CreateIntercompanyRuleRequest,
  EntityOwnershipSummary,
  FxRateSummary,
  MonetaryRevaluationRequest,
  MonetaryRevaluationResponse,
  RunConsolidationRequest,
  UpsertEntityOwnershipRequest,
  UpsertFxRateRequest,
} from '../../../shared/consolidation.js';
import type { UtcInstant } from '../../../shared/temporal.js';
import { appendAuditLog } from '../../audit/index.js';
import type { DatabaseHandle } from '../client.js';
import type { SqlExecutor } from '../migrate.js';
import { activeBatchPredicate } from './import.js';
import { addEntity } from './setup.js';

interface CompanyRow extends Record<string, unknown> {
  id: string;
  base_currency: string;
}

interface EntityRow extends Record<string, unknown> {
  id: string;
  code: string;
  name: string;
  currency: string;
  parent_id: string | null;
  active: boolean;
}

interface OwnershipRow extends Record<string, unknown> {
  id: string;
  parent_entity_id: string;
  parent_entity_code: string;
  child_entity_id: string;
  child_entity_code: string;
  ownership_pct: string;
  consolidation_method: ConsolidationMethod;
  effective_from: string | Date;
}

interface FxRateRow extends Record<string, unknown> {
  id: string;
  base_currency: string;
  quote_currency: string;
  rate_type: FxRateType;
  as_of_date: string | Date;
  rate: string;
  source: FxRateSummary['source'];
  created_at: string | Date;
}

interface IcRuleRow extends Record<string, unknown> {
  id: string;
  from_entity_id: string;
  from_entity_code: string;
  from_account_code: string;
  to_entity_id: string;
  to_entity_code: string;
  to_account_code: string;
  rule_type: IntercompanyRuleType;
  description: string;
  active: boolean;
}

interface PeriodRow extends Record<string, unknown> {
  id: string;
  fiscal_year: number;
  period_no: number;
  code: string;
  end_date: string | Date;
}

interface EntityAccountBalanceRow extends Record<string, unknown> {
  entity_id: string;
  account_code: string;
  account_name: string;
  account_type: AccountType;
  normal_side: NormalSide;
  statement_line_key: string;
  debit: string;
  credit: string;
}

interface ConsolidationRunRow extends Record<string, unknown> {
  id: string;
  fiscal_year: number;
  period_id: string;
  period_code: string;
  reporting_currency: string;
  status: 'completed' | 'quarantined_residuals' | 'failed';
  snapshot_json: ConsolidationRunSummary;
  created_at: string | Date;
}

function toIsoDate(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toIsoTimestamp(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

async function loadCompany(db: SqlExecutor, companyId: string): Promise<CompanyRow> {
  const res = await db.query<CompanyRow>(
    `SELECT id, base_currency FROM company WHERE id = $1`,
    [companyId],
  );
  const company = res.rows[0];
  if (company === undefined) {
    throw new AppError('NOT_FOUND', { userMessage: 'The company could not be found.' });
  }
  return company;
}

async function listEntities(
  db: SqlExecutor,
  companyId: string,
): Promise<ConsolidationEntitySummary[]> {
  const res = await db.query<EntityRow>(
    `SELECT id, code, name, currency, parent_id, active
       FROM entity
      WHERE company_id = $1
      ORDER BY code ASC`,
    [companyId],
  );
  return res.rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    currency: row.currency,
    parentId: row.parent_id,
    active: row.active,
  }));
}

async function listOwnerships(
  db: SqlExecutor,
  companyId: string,
): Promise<EntityOwnershipSummary[]> {
  const res = await db.query<OwnershipRow>(
    `SELECT eo.id, eo.parent_entity_id, p.code AS parent_entity_code,
            eo.child_entity_id, c.code AS child_entity_code,
            eo.ownership_pct::text AS ownership_pct, eo.consolidation_method, eo.effective_from
       FROM entity_ownership eo
       JOIN entity p ON p.id = eo.parent_entity_id
       JOIN entity c ON c.id = eo.child_entity_id
      WHERE eo.company_id = $1
      ORDER BY p.code ASC, c.code ASC, eo.effective_from DESC`,
    [companyId],
  );
  return res.rows.map((row) => ({
    id: row.id,
    parentEntityId: row.parent_entity_id,
    parentEntityCode: row.parent_entity_code,
    childEntityId: row.child_entity_id,
    childEntityCode: row.child_entity_code,
    ownershipPct: row.ownership_pct,
    method: row.consolidation_method,
    effectiveFrom: toIsoDate(row.effective_from),
  }));
}

async function listFxRates(db: SqlExecutor, companyId: string): Promise<FxRateSummary[]> {
  const res = await db.query<FxRateRow>(
    `SELECT id, base_currency, quote_currency, rate_type, as_of_date, rate::text AS rate, source, created_at
       FROM fx_rate
      WHERE company_id = $1
      ORDER BY as_of_date DESC, base_currency ASC, quote_currency ASC, rate_type ASC`,
    [companyId],
  );
  return res.rows.map((row) => ({
    id: row.id,
    baseCurrency: row.base_currency,
    quoteCurrency: row.quote_currency,
    rateType: row.rate_type,
    asOfDate: toIsoDate(row.as_of_date),
    rate: row.rate,
    source: row.source,
    createdAt: toIsoTimestamp(row.created_at),
  }));
}

type IntercompanyRuleSummaryRow = {
  id: string;
  fromEntityId: string;
  fromEntityCode: string;
  fromAccountCode: string;
  toEntityId: string;
  toEntityCode: string;
  toAccountCode: string;
  ruleType: IntercompanyRuleType;
  description: string;
  active: boolean;
};

async function listIcRules(db: SqlExecutor, companyId: string): Promise<IntercompanyRuleSummaryRow[]> {
  const res = await db.query<IcRuleRow>(
    `SELECT ir.id, ir.from_entity_id, fe.code AS from_entity_code, fa.code AS from_account_code,
            ir.to_entity_id, te.code AS to_entity_code, ta.code AS to_account_code,
            ir.rule_type, ir.description, ir.active
       FROM intercompany_rule ir
       JOIN entity fe ON fe.id = ir.from_entity_id
       JOIN entity te ON te.id = ir.to_entity_id
       JOIN account fa ON fa.id = ir.from_account_id
       JOIN account ta ON ta.id = ir.to_account_id
      WHERE ir.company_id = $1
      ORDER BY fe.code ASC, fa.code ASC, te.code ASC, ta.code ASC`,
    [companyId],
  );
  return res.rows.map((row) => ({
    id: row.id,
    fromEntityId: row.from_entity_id,
    fromEntityCode: row.from_entity_code,
    fromAccountCode: row.from_account_code,
    toEntityId: row.to_entity_id,
    toEntityCode: row.to_entity_code,
    toAccountCode: row.to_account_code,
    ruleType: row.rule_type,
    description: row.description,
    active: row.active,
  }));
}

async function listRecentRuns(
  db: SqlExecutor,
  companyId: string,
): Promise<ConsolidationRunSummary[]> {
  const res = await db.query<ConsolidationRunRow>(
    `SELECT cr.id, cr.fiscal_year, cr.period_id, fp.code AS period_code,
            cr.reporting_currency, cr.status, cr.snapshot_json, cr.created_at
       FROM consolidation_run cr
       JOIN fiscal_period fp ON fp.id = cr.period_id
      WHERE cr.company_id = $1
      ORDER BY cr.created_at DESC, cr.id DESC
      LIMIT 12`,
    [companyId],
  );
  return res.rows.map((row) => ({
    ...row.snapshot_json,
    runId: row.id,
    createdAt: toIsoTimestamp(row.created_at),
  }));
}

async function resolvePeriodForConsolidation(
  db: SqlExecutor,
  companyId: string,
  periodCode: string,
  fiscalYear?: number,
): Promise<PeriodRow> {
  const res = await db.query<PeriodRow>(
    `SELECT id, fiscal_year, period_no, code, end_date
       FROM fiscal_period
      WHERE company_id = $1 AND code = $2${fiscalYear === undefined ? '' : ' AND fiscal_year = $3'}
      ORDER BY fiscal_year ASC`,
    fiscalYear === undefined ? [companyId, periodCode] : [companyId, periodCode, fiscalYear],
  );
  if (res.rows.length === 0) {
    throw new AppError('NOT_FOUND', {
      userMessage: `Fiscal period "${periodCode}" does not exist in this company.`,
      details: { periodCode, ...(fiscalYear === undefined ? {} : { fiscalYear }) },
    });
  }
  if (res.rows.length > 1) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Period code "${periodCode}" matches multiple fiscal years; specify fiscalYear.`,
      details: { periodCode, years: res.rows.map((r) => r.fiscal_year) },
    });
  }
  const period = res.rows[0];
  if (period === undefined) {
    throw new AppError('NOT_FOUND', { userMessage: 'Period could not be resolved.' });
  }
  return period;
}

export async function getConsolidationWorkspace(
  db: SqlExecutor,
  companyId: string,
): Promise<ConsolidationWorkspaceResponse> {
  const company = await loadCompany(db, companyId);
  const [entities, ownerships, fxRates, icRules, recentRuns] = await Promise.all([
    listEntities(db, companyId),
    listOwnerships(db, companyId),
    listFxRates(db, companyId),
    listIcRules(db, companyId),
    listRecentRuns(db, companyId),
  ]);
  return {
    companyId: company.id,
    baseCurrency: company.base_currency,
    entities,
    ownerships,
    fxRates,
    icRules,
    latestRun: recentRuns[0] ?? null,
    recentRuns,
  };
}

export async function createCompanyEntity(
  db: DatabaseHandle,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly request: CreateEntityRequest;
    readonly occurredAt: UtcInstant;
  },
): Promise<ConsolidationEntitySummary> {
  return db.transaction(async (tx) => {
    await loadCompany(tx, params.companyId);
    let parentId: string | null = null;
    if (params.request.parentEntityCode !== undefined && params.request.parentEntityCode !== null) {
      const parentRes = await tx.query<{ id: string }>(
        `SELECT id FROM entity WHERE company_id = $1 AND code = $2 AND active = true`,
        [params.companyId, params.request.parentEntityCode],
      );
      parentId = parentRes.rows[0]?.id ?? null;
      if (parentId === null) {
        throw new AppError('NOT_FOUND', {
          userMessage: `Parent entity "${params.request.parentEntityCode}" does not exist.`,
        });
      }
    }

    const created = await addEntity(tx, {
      companyId: params.companyId,
      code: params.request.code,
      name: params.request.name,
      currency: params.request.currency,
    });

    if (parentId !== null) {
      await tx.query(`UPDATE entity SET parent_id = $1 WHERE company_id = $2 AND id = $3`, [
        parentId,
        params.companyId,
        created.id,
      ]);
    }

    await appendAuditLog(tx, {
      companyId: params.companyId,
      actorId: params.actorId,
      action: 'entity.create',
      targetTable: 'entity',
      targetId: created.id,
      oldPayload: null,
      newPayload: {
        code: created.code,
        name: created.name,
        currency: created.currency,
        parentId,
      },
      occurredAt: params.occurredAt,
    });

    return {
      id: created.id,
      code: created.code,
      name: created.name,
      currency: created.currency,
      parentId,
      active: true,
    };
  });
}

export async function upsertEntityOwnership(
  db: DatabaseHandle,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly request: UpsertEntityOwnershipRequest;
    readonly occurredAt: UtcInstant;
  },
): Promise<EntityOwnershipSummary> {
  return db.transaction(async (tx) => {
    await loadCompany(tx, params.companyId);
    const entities = await listEntities(tx, params.companyId);
    const byCode = new Map(entities.map((e) => [e.code, e]));
    const parent = byCode.get(params.request.parentEntityCode);
    const child = byCode.get(params.request.childEntityCode);
    if (parent === undefined || child === undefined) {
      throw new AppError('NOT_FOUND', {
        userMessage: 'Both parent and child entities must exist in this company.',
      });
    }
    if (parent.id === child.id) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'An entity cannot own itself.',
      });
    }
    const pctNum = money(params.request.ownershipPct);
    if (pctNum.lte(0) || pctNum.gt(100)) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Ownership percentage must be between 0 (exclusive) and 100.',
      });
    }

    const effectiveFrom = params.request.effectiveFrom ?? params.occurredAt.slice(0, 10);
    const res = await tx.query<{ id: string }>(
      `INSERT INTO entity_ownership (
         company_id, parent_entity_id, child_entity_id, ownership_pct, consolidation_method, effective_from
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (company_id, parent_entity_id, child_entity_id)
       DO UPDATE SET ownership_pct = EXCLUDED.ownership_pct,
                     consolidation_method = EXCLUDED.consolidation_method,
                     effective_from = EXCLUDED.effective_from
       RETURNING id`,
      [
        params.companyId,
        parent.id,
        child.id,
        params.request.ownershipPct,
        params.request.method,
        effectiveFrom,
      ],
    );
    const ownershipId = res.rows[0]?.id;
    if (ownershipId === undefined) {
      throw new AppError('INTERNAL_ERROR', { userMessage: 'Ownership rule could not be saved.' });
    }

    await tx.query(`UPDATE entity SET parent_id = $1 WHERE company_id = $2 AND id = $3`, [
      parent.id,
      params.companyId,
      child.id,
    ]);

    await appendAuditLog(tx, {
      companyId: params.companyId,
      actorId: params.actorId,
      action: 'entity_ownership.upsert',
      targetTable: 'entity_ownership',
      targetId: ownershipId,
      oldPayload: null,
      newPayload: {
        parentEntityCode: parent.code,
        childEntityCode: child.code,
        ownershipPct: params.request.ownershipPct,
        method: params.request.method,
        effectiveFrom,
      },
      occurredAt: params.occurredAt,
    });

    return {
      id: ownershipId,
      parentEntityId: parent.id,
      parentEntityCode: parent.code,
      childEntityId: child.id,
      childEntityCode: child.code,
      ownershipPct: params.request.ownershipPct,
      method: params.request.method,
      effectiveFrom,
    };
  });
}

export async function upsertFxRate(
  db: DatabaseHandle,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly request: UpsertFxRateRequest;
    readonly occurredAt: UtcInstant;
  },
): Promise<FxRateSummary> {
  return db.transaction(async (tx) => {
    await loadCompany(tx, params.companyId);
    if (params.request.baseCurrency === params.request.quoteCurrency) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Base currency and quote currency must differ for an explicit FX rate.',
      });
    }

    const res = await tx.query<FxRateRow>(
      `INSERT INTO fx_rate (
         company_id, base_currency, quote_currency, rate_type, as_of_date, rate, source, created_by, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (company_id, base_currency, quote_currency, rate_type, as_of_date)
       DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source
       RETURNING id, base_currency, quote_currency, rate_type, as_of_date, rate::text AS rate, source, created_at`,
      [
        params.companyId,
        params.request.baseCurrency,
        params.request.quoteCurrency,
        params.request.rateType,
        params.request.asOfDate,
        params.request.rate,
        params.request.source,
        params.actorId,
        params.occurredAt,
      ],
    );
    const row = res.rows[0];
    if (row === undefined) {
      throw new AppError('INTERNAL_ERROR', { userMessage: 'FX rate could not be saved.' });
    }

    await appendAuditLog(tx, {
      companyId: params.companyId,
      actorId: params.actorId,
      action: 'fx_rate.upsert',
      targetTable: 'fx_rate',
      targetId: row.id,
      oldPayload: null,
      newPayload: {
        pair: `${row.base_currency}/${row.quote_currency}`,
        rateType: row.rate_type,
        asOfDate: toIsoDate(row.as_of_date),
        rate: row.rate,
        source: row.source,
      },
      occurredAt: params.occurredAt,
    });

    return {
      id: row.id,
      baseCurrency: row.base_currency,
      quoteCurrency: row.quote_currency,
      rateType: row.rate_type,
      asOfDate: toIsoDate(row.as_of_date),
      rate: row.rate,
      source: row.source,
      createdAt: toIsoTimestamp(row.created_at),
    };
  });
}

export async function createIntercompanyRule(
  db: DatabaseHandle,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly request: CreateIntercompanyRuleRequest;
    readonly occurredAt: UtcInstant;
  },
): Promise<IntercompanyRuleSummaryRow> {
  return db.transaction(async (tx) => {
    await loadCompany(tx, params.companyId);
    const entities = await listEntities(tx, params.companyId);
    const byCode = new Map(entities.map((e) => [e.code, e]));
    const fromEntity = byCode.get(params.request.fromEntityCode);
    const toEntity = byCode.get(params.request.toEntityCode);
    if (fromEntity === undefined || toEntity === undefined) {
      throw new AppError('NOT_FOUND', {
        userMessage: 'Both intercompany entities must exist in this company.',
      });
    }
    if (fromEntity.id === toEntity.id) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Intercompany elimination rules require two distinct entities.',
      });
    }

    const accountRes = await tx.query<{ id: string; code: string }>(
      `SELECT id, code FROM account WHERE company_id = $1 AND active = true AND code IN ($2, $3)`,
      [params.companyId, params.request.fromAccountCode, params.request.toAccountCode],
    );
    const accountIdByCode = new Map(accountRes.rows.map((r) => [r.code, r.id]));
    const fromAccountId = accountIdByCode.get(params.request.fromAccountCode);
    const toAccountId = accountIdByCode.get(params.request.toAccountCode);
    if (fromAccountId === undefined || toAccountId === undefined) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Both intercompany account codes must exist in the active Chart of Accounts.',
      });
    }

    const res = await tx.query<{ id: string }>(
      `INSERT INTO intercompany_rule (
         company_id, from_entity_id, from_account_id, to_entity_id, to_account_id,
         rule_type, description
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (company_id, from_entity_id, from_account_id, to_entity_id, to_account_id)
       DO UPDATE SET rule_type = EXCLUDED.rule_type, description = EXCLUDED.description, active = true
       RETURNING id`,
      [
        params.companyId,
        fromEntity.id,
        fromAccountId,
        toEntity.id,
        toAccountId,
        params.request.ruleType,
        params.request.description,
      ],
    );
    const ruleId = res.rows[0]?.id;
    if (ruleId === undefined) {
      throw new AppError('INTERNAL_ERROR', { userMessage: 'Intercompany rule could not be saved.' });
    }

    await appendAuditLog(tx, {
      companyId: params.companyId,
      actorId: params.actorId,
      action: 'intercompany_rule.create',
      targetTable: 'intercompany_rule',
      targetId: ruleId,
      oldPayload: null,
      newPayload: {
        fromEntityCode: fromEntity.code,
        fromAccountCode: params.request.fromAccountCode,
        toEntityCode: toEntity.code,
        toAccountCode: params.request.toAccountCode,
        ruleType: params.request.ruleType,
      },
      occurredAt: params.occurredAt,
    });

    return {
      id: ruleId,
      fromEntityId: fromEntity.id,
      fromEntityCode: fromEntity.code,
      fromAccountCode: params.request.fromAccountCode,
      toEntityId: toEntity.id,
      toEntityCode: toEntity.code,
      toAccountCode: params.request.toAccountCode,
      ruleType: params.request.ruleType,
      description: params.request.description,
      active: true,
    };
  });
}

export async function previewFxRevaluation(
  db: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly request: MonetaryRevaluationRequest;
  },
): Promise<MonetaryRevaluationResponse> {
  await loadCompany(db, params.companyId);
  const items: MonetaryRevaluationItemInput[] = params.request.items.map((item) => ({
    itemKey: item.itemKey,
    entityCode: item.entityCode,
    accountCode: item.accountCode,
    accountType: item.accountType,
    foreignCurrency: item.foreignCurrency,
    functionalCurrency: item.functionalCurrency,
    foreignAmount: item.foreignAmount,
    bookingRate: item.bookingRate,
    periodEndRate: item.periodEndRate,
    settled: item.settled,
    ...(item.settlementRate === undefined ? {} : { settlementRate: item.settlementRate }),
  }));

  try {
    const result = computeFxRevaluation({
      functionalCurrency: params.request.functionalCurrency,
      ...(params.request.fxGainLossAccountCode === undefined
        ? {}
        : { fxGainLossAccountCode: params.request.fxGainLossAccountCode }),
      items,
    });
    return {
      reportingOrFunctionalCurrency: result.reportingOrFunctionalCurrency,
      items: [...result.items],
      realizedTotal: result.realizedTotal,
      unrealizedTotal: result.unrealizedTotal,
      netRevaluationTotal: result.netRevaluationTotal,
      journalLines: [...result.journalLines],
      journalBalanced: result.journalBalanced,
    };
  } catch (error) {
    if (error instanceof ConsolidationError) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: error.message,
        details: { code: error.code },
      });
    }
    throw error;
  }
}

function buildRunSummary(
  runId: string,
  period: PeriodRow,
  asOfDate: string,
  coreResult: ConsolidationResult,
  createdAt: string,
): ConsolidationRunSummary {
  return {
    runId,
    fiscalYear: period.fiscal_year,
    periodId: period.id,
    periodCode: period.code,
    asOfDate,
    reportingCurrency: coreResult.reportingCurrency,
    status: coreResult.status,
    groupTbBalanced: coreResult.groupTbBalanced,
    groupBsBalanced: coreResult.groupBsBalanced,
    totalAssets: coreResult.totalAssets,
    totalLiabilities: coreResult.totalLiabilities,
    totalEquityBeforeNci: coreResult.totalEquityBeforeNci,
    controllingEquity: coreResult.controllingEquity,
    minorityInterest: coreResult.minorityInterest,
    totalGroupEquity: coreResult.totalGroupEquity,
    totalCta: coreResult.totalCta,
    totalRevenue: coreResult.totalRevenue,
    totalExpenses: coreResult.totalExpenses,
    consolidatedNetIncome: coreResult.consolidatedNetIncome,
    controllingNetIncome: coreResult.controllingNetIncome,
    nciNetIncome: coreResult.nciNetIncome,
    totalEliminations: coreResult.totalEliminations,
    unmatchedIcCount: coreResult.unmatchedIcCount,
    hasUnmatchedIc: coreResult.hasUnmatchedIc,
    groupTbTotalDebit: coreResult.groupTbTotalDebit,
    groupTbTotalCredit: coreResult.groupTbTotalCredit,
    accountingEquationImbalance: coreResult.accountingEquationImbalance,
    ctaAccountCode: coreResult.ctaAccountCode,
    ctaAccountName: coreResult.ctaAccountName,
    entityTranslations: [...coreResult.entityTranslations],
    minorityInterests: [...coreResult.minorityInterests],
    icReconciliations: [...coreResult.icReconciliations],
    eliminationLines: [...coreResult.eliminationLines],
    consolidatedTrialBalance: [...coreResult.consolidatedTrialBalance],
    createdAt,
  };
}

export async function executeConsolidationRun(
  db: DatabaseHandle,
  params: {
    readonly companyId: string;
    readonly actorId: string;
    readonly request: RunConsolidationRequest;
    readonly occurredAt: UtcInstant;
  },
): Promise<ConsolidationRunSummary> {
  return db.transaction(async (tx) => {
    const company = await loadCompany(tx, params.companyId);
    const period = await resolvePeriodForConsolidation(
      tx,
      params.companyId,
      params.request.periodCode,
      params.request.fiscalYear,
    );
    const reportingCurrency = params.request.reportingCurrency ?? company.base_currency;
    const asOfDate = params.request.asOfDate ?? toIsoDate(period.end_date);

    const [entities, ownerships, fxRates, icRules, balanceRes] = await Promise.all([
      listEntities(tx, params.companyId),
      listOwnerships(tx, params.companyId),
      listFxRates(tx, params.companyId),
      listIcRules(tx, params.companyId),
      tx.query<EntityAccountBalanceRow>(
        `SELECT gl.entity_id,
                a.code AS account_code,
                a.name AS account_name,
                a.type AS account_type,
                a.normal_side,
                a.statement_line_key,
                COALESCE(SUM(gl.debit), 0)::text AS debit,
                COALESCE(SUM(gl.credit), 0)::text AS credit
           FROM gl_line gl
           JOIN gl_entry ge ON ge.id = gl.entry_id
           JOIN fiscal_period fp ON fp.id = gl.period_id
           JOIN account a ON a.id = gl.account_id
          WHERE gl.company_id = $1
            AND a.active = true
            AND ${activeBatchPredicate('ge')}
            AND (fp.fiscal_year < $2 OR (fp.fiscal_year = $2 AND fp.period_no <= $3))
          GROUP BY gl.entity_id, a.id, a.code, a.name, a.type, a.normal_side, a.statement_line_key
          ORDER BY gl.entity_id ASC, a.code ASC`,
        [params.companyId, period.fiscal_year, period.period_no],
      ),
    ]);

    const activeEntities = entities.filter((e) => e.active);
    if (activeEntities.length === 0) {
      throw new AppError('NOT_FOUND', {
        userMessage: 'No active entities exist for consolidation.',
      });
    }

    const linesByEntity = new Map<string, ConsolidationEntityAccountLine[]>();
    for (const row of balanceRes.rows) {
      const bucket = linesByEntity.get(row.entity_id) ?? [];
      bucket.push({
        accountCode: row.account_code,
        accountName: row.account_name,
        accountType: row.account_type,
        normalSide: row.normal_side,
        statementLineKey: row.statement_line_key,
        debit: row.debit,
        credit: row.credit,
      });
      linesByEntity.set(row.entity_id, bucket);
    }

    const entityInputs: ConsolidationEntityInput[] = activeEntities.map((entity) => ({
      entityId: entity.id,
      entityCode: entity.code,
      entityName: entity.name,
      functionalCurrency: entity.currency,
      lines: linesByEntity.get(entity.id) ?? [],
    }));

    const effectiveOwnerships = new Map<string, EntityOwnershipInput>();
    for (const rule of ownerships) {
      if (rule.effectiveFrom <= asOfDate && !effectiveOwnerships.has(rule.childEntityId)) {
        effectiveOwnerships.set(rule.childEntityId, {
          parentEntityId: rule.parentEntityId,
          childEntityId: rule.childEntityId,
          ownershipPct: rule.ownershipPct,
          method: rule.method,
        });
      }
    }

    const rateRecords: FxRateRecord[] = fxRates.map((r) => ({
      baseCurrency: r.baseCurrency,
      quoteCurrency: r.quoteCurrency,
      rateType: r.rateType,
      asOfDate: r.asOfDate,
      rate: r.rate,
      source: r.source,
    }));

    const icInputs: IntercompanyRuleInput[] = icRules
      .filter((r) => r.active)
      .map((r) => ({
        ruleId: r.id,
        fromEntityId: r.fromEntityId,
        fromEntityCode: r.fromEntityCode,
        fromAccountCode: r.fromAccountCode,
        toEntityId: r.toEntityId,
        toEntityCode: r.toEntityCode,
        toAccountCode: r.toAccountCode,
        ruleType: r.ruleType,
        description: r.description,
      }));

    let coreResult: ConsolidationResult;
    try {
      coreResult = consolidateGroup({
        reportingCurrency,
        asOfDate,
        entities: entityInputs,
        ownerships: [...effectiveOwnerships.values()],
        fxRates: rateRecords,
        icRules: icInputs,
        ...(params.request.ctaAccountCode === undefined
          ? {}
          : { ctaAccountCode: params.request.ctaAccountCode }),
      });
    } catch (error) {
      if (error instanceof ConsolidationError) {
        throw new AppError('VALIDATION_FAILED', {
          userMessage: error.message,
          details: { code: error.code },
        });
      }
      throw error;
    }

    const auditRecord = await appendAuditLog(tx, {
      companyId: params.companyId,
      actorId: params.actorId,
      action: 'consolidation.run',
      targetTable: 'consolidation_run',
      targetId: period.id,
      oldPayload: null,
      newPayload: {
        periodCode: period.code,
        fiscalYear: period.fiscal_year,
        asOfDate,
        reportingCurrency,
        status: coreResult.status,
        totalAssets: coreResult.totalAssets,
        totalCta: coreResult.totalCta,
        minorityInterest: coreResult.minorityInterest,
        totalEliminations: coreResult.totalEliminations,
        unmatchedIcCount: coreResult.unmatchedIcCount,
      },
      occurredAt: params.occurredAt,
    });

    const idRes = await tx.query<{ id: string }>(`SELECT gen_random_uuid()::text AS id`);
    const runId = idRes.rows[0]?.id;
    if (runId === undefined) {
      throw new AppError('INTERNAL_ERROR', { userMessage: 'Failed to allocate consolidation run ID.' });
    }

    const summary = buildRunSummary(runId, period, asOfDate, coreResult, params.occurredAt);

    await tx.query(
      `INSERT INTO consolidation_run (
         id, company_id, fiscal_year, period_id, reporting_currency, status,
         group_tb_balanced, group_bs_balanced, total_assets, total_liabilities, total_equity,
         total_cta, minority_interest, total_eliminations, unmatched_ic_count,
         snapshot_json, executed_by, audit_entry_id, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17, $18, $19)`,
      [
        runId,
        params.companyId,
        period.fiscal_year,
        period.id,
        reportingCurrency,
        coreResult.status,
        coreResult.groupTbBalanced,
        coreResult.groupBsBalanced,
        coreResult.totalAssets,
        coreResult.totalLiabilities,
        coreResult.totalGroupEquity,
        coreResult.totalCta,
        coreResult.minorityInterest,
        coreResult.totalEliminations,
        coreResult.unmatchedIcCount,
        JSON.stringify(summary),
        params.actorId,
        auditRecord.id,
        params.occurredAt,
      ],
    );

    return summary;
  });
}
