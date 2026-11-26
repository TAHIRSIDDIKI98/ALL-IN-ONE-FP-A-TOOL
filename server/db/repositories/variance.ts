import { scaleForCurrency } from '../../../core/money/index.js';
import { analyzeFlux, buildPvmBridge } from '../../../core/variance/index.js';
import { AppError } from '../../../shared/errors.js';
import type {
  FluxAnalysisResponse,
  PvmBridgeRequest,
  PvmBridgeResponse,
} from '../../../shared/variance.js';
import type { SqlExecutor } from '../migrate.js';
import { getBvaReport } from './bva.js';

interface CompanyRow extends Record<string, unknown> {
  base_currency: string;
}

interface PeriodRow extends Record<string, unknown> {
  code: string;
  fiscal_year: number;
}

interface ScenarioRow extends Record<string, unknown> {
  id: string;
  name: string;
}

async function resolveCompanyPeriod(
  db: SqlExecutor,
  companyId: string,
  periodCode: string,
  fiscalYear: number | null | undefined,
): Promise<PeriodRow> {
  const scoped = fiscalYear !== undefined && fiscalYear !== null;
  const res = await db.query<PeriodRow>(
    `SELECT code, fiscal_year
       FROM fiscal_period
      WHERE company_id = $1 AND code = $2${scoped ? ' AND fiscal_year = $3' : ''}
      ORDER BY fiscal_year ASC`,
    scoped ? [companyId, periodCode, fiscalYear] : [companyId, periodCode],
  );
  const first = res.rows[0];
  if (first === undefined) {
    throw new AppError('PERIOD_NOT_FOUND', {
      userMessage: `Period ${periodCode} does not exist in this company calendar.`,
      details: { periodCode, fiscalYear: fiscalYear ?? null },
    });
  }
  if (res.rows.length > 1) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Period code ${periodCode} exists in more than one fiscal year; pass the fiscal year to disambiguate.`,
      details: { periodCode, fiscalYears: res.rows.map((r) => r.fiscal_year) },
    });
  }
  return first;
}

/**
 * Flux Analysis read model (MASTER_PROMPT §2.6, §5.7).
 * Consumes `getBvaReport` so Flux totals tie identically to BvA and Statements, then delegates
 * materiality ranking and waterfall reconciliation strictly to `/core/variance#analyzeFlux`.
 */
export async function getFluxAnalysis(
  db: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly throughPeriodCode: string;
    readonly fiscalYear?: number | null;
    readonly minAbsVariance?: string;
    readonly topN?: number;
  },
): Promise<FluxAnalysisResponse> {
  const bva = await getBvaReport(db, {
    companyId: params.companyId,
    throughPeriodCode: params.throughPeriodCode,
    ...(params.fiscalYear === undefined || params.fiscalYear === null
      ? {}
      : { fiscalYear: params.fiscalYear }),
  });

  const companyRes = await db.query<CompanyRow>(
    'SELECT base_currency FROM company WHERE id = $1',
    [params.companyId],
  );
  const currency = companyRes.rows[0]?.base_currency;
  if (currency === undefined) {
    throw new AppError('NOT_FOUND', { userMessage: 'The company could not be found.' });
  }
  const scale = scaleForCurrency(currency);

  const outcome = analyzeFlux({
    rows: bva.rows,
    ...(params.minAbsVariance !== undefined ? { minAbsVariance: params.minAbsVariance } : {}),
    ...(params.topN !== undefined ? { topN: params.topN } : {}),
    scale,
  });

  if (!outcome.ok) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Invalid flux materiality threshold or top-N filter.',
      details: { issues: [...outcome.issues] },
    });
  }

  return {
    companyId: bva.companyId,
    fiscalYear: bva.fiscalYear,
    throughPeriodCode: bva.throughPeriodCode,
    scenarioId: bva.scenarioId,
    scenarioName: bva.scenarioName,
    planVersionId: bva.planVersionId,
    versionNo: bva.versionNo,
    hasPlan: bva.hasPlan,
    minAbsVariance: outcome.result.minAbsVariance,
    topN: outcome.result.topN,
    totalPlannedAccounts: outcome.result.totalPlannedAccounts,
    materialCount: outcome.result.materialCount,
    otherPlannedCount: outcome.result.otherPlannedCount,
    drivers: [...outcome.result.drivers],
    unplannedAccounts: [...outcome.result.unplannedAccounts],
    bridge: outcome.result.bridge,
  };
}

/**
 * Price-Volume-Mix (PVM) Decomposition Bridge (MASTER_PROMPT §5.7).
 * Validates company calendar + optional tenant-owned scenario, delegates all arithmetic to
 * `/core/variance#buildPvmBridge` with exact residual allocation and invariant proof.
 */
export async function computeCompanyPvmBridge(
  db: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly request: PvmBridgeRequest;
  },
): Promise<PvmBridgeResponse> {
  const companyRes = await db.query<CompanyRow>(
    'SELECT base_currency FROM company WHERE id = $1',
    [params.companyId],
  );
  const currency = companyRes.rows[0]?.base_currency;
  if (currency === undefined) {
    throw new AppError('NOT_FOUND', { userMessage: 'The company could not be found.' });
  }
  const scale = scaleForCurrency(currency);

  const period = await resolveCompanyPeriod(
    db,
    params.companyId,
    params.request.periodCode,
    params.request.fiscalYear,
  );

  let scenarioName: string | null = null;
  if (params.request.scenarioId !== undefined && params.request.scenarioId !== null) {
    const scenRes = await db.query<ScenarioRow>(
      'SELECT id, name FROM scenario WHERE company_id = $1 AND id = $2',
      [params.companyId, params.request.scenarioId],
    );
    const scen = scenRes.rows[0];
    if (scen === undefined) {
      throw new AppError('NOT_FOUND', {
        userMessage: 'The selected scenario could not be found for this company.',
      });
    }
    scenarioName = scen.name;
  }

  const outcome = buildPvmBridge({
    items: params.request.items,
    basis: {
      scenarioId: params.request.scenarioId ?? 'ad-hoc',
      planVersionId: 'pvm-bridge',
      periodCode: period.code,
    },
    scale,
  });

  if (!outcome.ok) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `PVM bridge inputs could not be verified: ${outcome.issues[0] ?? 'invalid input'}`,
      details: { issues: [...outcome.issues] },
    });
  }

  return {
    companyId: params.companyId,
    fiscalYear: period.fiscal_year,
    periodCode: period.code,
    baseCurrency: currency,
    scenarioName,
    totalPlanUnits: outcome.bridge.totalPlanUnits,
    totalActualUnits: outcome.bridge.totalActualUnits,
    totalPlanRevenue: outcome.bridge.totalPlanRevenue,
    totalActualRevenue: outcome.bridge.totalActualRevenue,
    totalVariance: outcome.bridge.totalVariance,
    variancePct: outcome.bridge.variancePct,
    variancePctStatus: outcome.bridge.variancePctStatus,
    priceVariance: outcome.bridge.priceVariance,
    volumeVariance: outcome.bridge.volumeVariance,
    mixVariance: outcome.bridge.mixVariance,
    invariantPassed: outcome.bridge.invariantPassed,
    invariantDelta: outcome.bridge.invariantDelta,
    items: [...outcome.bridge.items],
  };
}
