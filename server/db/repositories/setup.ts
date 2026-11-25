import { generateFiscalYears, type CalendarGenerateOptions } from '../../../core/calendar/index.js';
import { scaleForCurrency } from '../../../core/money/index.js';
import { STATEMENT_LINE_CATALOG } from '../../../core/statements/index.js';
import { AppError } from '../../../shared/errors.js';
import type {
  CompanySetupRequest,
  CompanyWorkspace,
  EntitySummary,
  FiscalPeriodSummary,
} from '../../../shared/setup.js';
import { appendAuditLog } from '../../audit/index.js';
import type { SqlExecutor } from '../migrate.js';
import { isUniqueViolation } from '../client.js';

/**
 * Spine setup repositories (MASTER_PROMPT §2.2, §3.4, §4.6).
 *
 * Every write path here:
 *  - runs inside the caller's transaction (atomicity is the caller's BEGIN/COMMIT),
 *  - writes its audit row in the SAME transaction (§3.4, D7),
 *  - derives periods exclusively from `/core/calendar` (§4.6 — never hand-inserted),
 *  - maps driver errors to the typed error catalog (`/shared/errors.ts`) with no raw SQL text
 *    leaking to the client (§9.8, §10.2).
 */

export interface AppUserIdentity {
  readonly firebaseUid: string;
  readonly email: string;
  readonly displayName: string;
}

interface IdRow extends Record<string, unknown> {
  id: string;
}

interface PeriodRow extends Record<string, unknown> {
  id: string;
  fiscal_year: number;
  period_no: number;
  code: string;
  label: string;
  quarter: number;
  start_date: string | Date;
  end_date: string | Date;
  is_53rd_week: boolean;
  is_adjustment: boolean;
}

interface EntityRow extends Record<string, unknown> {
  id: string;
  code: string;
  name: string;
  currency: string;
}

interface CompanyRow extends Record<string, unknown> {
  id: string;
  name: string;
  base_currency: string;
  fiscal_calendar_id: string | null;
  calendar_kind: string | null;
}

export interface CompanySetupParams {
  readonly actor: AppUserIdentity;
  readonly request: CompanySetupRequest;
  readonly occurredAt: string;
}

function toIsoDate(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value.slice(0, 10);
}

/**
 * Seeds the canonical statement_line catalog (global vocabulary, §4.5).
 * Idempotent: existing keys are never modified, so a released key cannot drift.
 */
export async function ensureStatementLineCatalog(tx: SqlExecutor): Promise<number> {
  let inserted = 0;
  for (const line of STATEMENT_LINE_CATALOG) {
    const res = await tx.query<IdRow>(
      `INSERT INTO statement_line (key, statement, label, sort_order, sign_rule)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key) DO NOTHING
       RETURNING key AS id`,
      [line.key, line.statement, line.label, line.sortOrder, line.signRule],
    );
    inserted += res.rows.length;
  }
  return inserted;
}

/** Idempotent identity upsert: the Firebase UID is the stable key (§3.5). */
export async function ensureAppUser(tx: SqlExecutor, identity: AppUserIdentity): Promise<string> {
  const res = await tx.query<IdRow>(
    `INSERT INTO app_user (firebase_uid, email, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (firebase_uid) DO UPDATE
       SET email = EXCLUDED.email,
           display_name = EXCLUDED.display_name
     RETURNING id`,
    [identity.firebaseUid, identity.email, identity.displayName],
  );
  const id = res.rows[0]?.id;
  if (id === undefined) {
    throw new AppError('INTERNAL_ERROR', {
      userMessage: 'The signed-in identity could not be persisted.',
    });
  }
  return id;
}

/**
 * Adds one reporting entity. Codes are company-scoped and unique; a duplicate is a typed
 * DUPLICATE_CODE conflict rather than a raw driver error.
 */
export async function addEntity(
  tx: SqlExecutor,
  params: {
    readonly companyId: string;
    readonly code: string;
    readonly name: string;
    readonly currency: string;
  },
): Promise<EntitySummary> {
  try {
    const res = await tx.query<EntityRow>(
      `INSERT INTO entity (company_id, code, name, currency)
       VALUES ($1, $2, $3, $4)
       RETURNING id, code, name, currency`,
      [params.companyId, params.code, params.name, params.currency],
    );
    const row = res.rows[0];
    if (row === undefined) {
      throw new AppError('INTERNAL_ERROR', {
        userMessage: 'The reporting entity could not be persisted.',
      });
    }
    return { id: row.id, code: row.code, name: row.name, currency: row.currency };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError('DUPLICATE_CODE', {
        userMessage: `Entity code "${params.code}" already exists in this company.`,
        details: { code: params.code },
      });
    }
    throw error;
  }
}

function calendarOptions(request: CompanySetupRequest): CalendarGenerateOptions {
  const isMonthBased = request.calendarKind === '12month';
  return {
    kind: request.calendarKind,
    startYear: request.fiscalYear,
    yearCount: request.yearCount,
    startMonth: request.startMonth ?? (isMonthBased ? 1 : 2),
    ...(request.week53Rule !== undefined ? { week53Rule: request.week53Rule } : {}),
    ...(request.includeAdjustmentPeriod !== undefined
      ? { includeAdjustmentPeriod: request.includeAdjustmentPeriod }
      : {}),
  };
}

/**
 * Full company workspace creation in one atomic unit: identity → company → fiscal calendar →
 * generated periods → entity → owner membership → audit row. Any failure rolls the whole unit
 * back, so a partially configured company can never exist.
 */
export async function createCompanyWorkspace(
  tx: SqlExecutor,
  params: CompanySetupParams,
): Promise<CompanyWorkspace> {
  const { actor, request, occurredAt } = params;

  let currencyScale: 0 | 2 | 3;
  try {
    currencyScale = scaleForCurrency(request.baseCurrency);
  } catch {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Currency "${request.baseCurrency}" has no locked display scale.`,
      details: { field: 'baseCurrency', value: request.baseCurrency },
    });
  }

  let years;
  try {
    years = generateFiscalYears(calendarOptions(request));
  } catch (error) {
    throw new AppError('CALENDAR_CONFLICT', {
      userMessage:
        error instanceof Error ? error.message : 'The fiscal calendar configuration is invalid.',
    });
  }
  if (years.length === 0) {
    throw new AppError('CALENDAR_CONFLICT', {
      userMessage: 'The fiscal calendar produced zero years for the requested configuration.',
    });
  }

  await ensureStatementLineCatalog(tx);
  const actorId = await ensureAppUser(tx, actor);

  const companyRes = await tx.query<IdRow>(
    `INSERT INTO company (name, base_currency, coa_version)
     VALUES ($1, $2, 1)
     RETURNING id`,
    [request.companyName, request.baseCurrency],
  );
  const companyId = companyRes.rows[0]?.id;
  if (companyId === undefined) {
    throw new AppError('INTERNAL_ERROR', { userMessage: 'The company could not be persisted.' });
  }

  const calendarRes = await tx.query<IdRow>(
    `INSERT INTO fiscal_calendar (company_id, kind, year_start_month, week_anchor, w53_rule, include_adjustment)
     VALUES ($1, $2, $3, 'sunday-nearest', $4, $5)
     RETURNING id`,
    [
      companyId,
      request.calendarKind,
      request.startMonth ?? (request.calendarKind === '12month' ? 1 : 2),
      request.week53Rule ?? 'nrf4day',
      request.includeAdjustmentPeriod ?? false,
    ],
  );
  const fiscalCalendarId = calendarRes.rows[0]?.id;
  if (fiscalCalendarId === undefined) {
    throw new AppError('INTERNAL_ERROR', {
      userMessage: 'The fiscal calendar could not be persisted.',
    });
  }

  await tx.query(`UPDATE company SET fiscal_calendar_id = $1 WHERE id = $2`, [
    fiscalCalendarId,
    companyId,
  ]);

  const periodIds: string[] = [];
  for (const year of years) {
    for (const period of year.periods) {
      const periodRes = await tx.query<IdRow>(
        `INSERT INTO fiscal_period (
           company_id, fiscal_calendar_id, fiscal_year, period_no, code, label,
           quarter, start_date, end_date, is_53rd_week, is_adjustment
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          companyId,
          fiscalCalendarId,
          period.fiscalYear,
          period.periodNo,
          period.code,
          period.label,
          period.quarter,
          period.startDate,
          period.endDate,
          period.is53rdWeek,
          period.isAdjustment,
        ],
      );
      const periodId = periodRes.rows[0]?.id;
      if (periodId === undefined) {
        throw new AppError('INTERNAL_ERROR', {
          userMessage: 'A fiscal period could not be persisted.',
        });
      }
      periodIds.push(periodId);
    }
  }

  const entity = await addEntity(tx, {
    companyId,
    code: request.entityCode,
    name: request.entityName,
    currency: request.baseCurrency,
  });

  await tx.query(`INSERT INTO membership (company_id, user_id, role) VALUES ($1, $2, 'owner')`, [
    companyId,
    actorId,
  ]);

  await appendAuditLog(tx, {
    companyId,
    actorId,
    action: 'company.create',
    targetTable: 'company',
    targetId: companyId,
    oldPayload: null,
    newPayload: {
      name: request.companyName,
      baseCurrency: request.baseCurrency,
      calendarKind: request.calendarKind,
      fiscalYear: request.fiscalYear,
      yearCount: request.yearCount,
      entityCode: entity.code,
      periodsCreated: periodIds.length,
    },
    occurredAt,
  });

  const workspace = await getCompanyWorkspace(tx, companyId);
  if (workspace === null) {
    throw new AppError('INTERNAL_ERROR', {
      userMessage: 'The created workspace could not be read back.',
    });
  }
  return workspace;
}

/**
 * Company-scoped read model. Returns null for an unknown company id (no cross-tenant data is
 * ever returned, D2) and never invents rows for an unconfigured company.
 */
export async function getCompanyWorkspace(
  db: SqlExecutor,
  companyId: string,
): Promise<CompanyWorkspace | null> {
  const companyRes = await db.query<CompanyRow>(
    `SELECT c.id,
            c.name,
            c.base_currency,
            c.fiscal_calendar_id,
            fc.kind AS calendar_kind
       FROM company c
       LEFT JOIN fiscal_calendar fc
         ON fc.company_id = c.id AND fc.id = c.fiscal_calendar_id
      WHERE c.id = $1`,
    [companyId],
  );
  const company = companyRes.rows[0];
  if (company === undefined || company.fiscal_calendar_id === null || company.calendar_kind === null) {
    return null;
  }

  const entityRes = await db.query<EntityRow>(
    `SELECT id, code, name, currency
       FROM entity
      WHERE company_id = $1
      ORDER BY code ASC`,
    [companyId],
  );

  const periodRes = await db.query<PeriodRow>(
    `SELECT id, fiscal_year, period_no, code, label, quarter,
            start_date, end_date, is_53rd_week, is_adjustment
       FROM fiscal_period
      WHERE company_id = $1
      ORDER BY fiscal_year ASC, period_no ASC`,
    [companyId],
  );

  const periods: FiscalPeriodSummary[] = periodRes.rows.map((row) => ({
    id: row.id,
    fiscalYear: row.fiscal_year,
    periodNo: row.period_no,
    code: row.code,
    label: row.label,
    quarter: row.quarter,
    startDate: toIsoDate(row.start_date),
    endDate: toIsoDate(row.end_date),
    is53rdWeek: row.is_53rd_week,
    isAdjustment: row.is_adjustment,
  }));

  const entities: EntitySummary[] = entityRes.rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    currency: row.currency,
  }));

  if (entities.length === 0 || periods.length === 0) {
    return null;
  }

  const currencyScale = scaleForCurrency(company.base_currency);

  return {
    companyId: company.id,
    companyName: company.name,
    baseCurrency: company.base_currency,
    currencyScale,
    calendarKind: company.calendar_kind as CompanyWorkspace['calendarKind'],
    fiscalCalendarId: company.fiscal_calendar_id,
    entities,
    periods,
  };
}

/** Companies the actor is a member of — the only companies a session may select (§3.5). */
export async function listActorCompanies(
  db: SqlExecutor,
  actorId: string,
): Promise<readonly { readonly id: string; readonly name: string; readonly baseCurrency: string }[]> {
  const res = await db.query<{ id: string; name: string; base_currency: string }>(
    `SELECT c.id, c.name, c.base_currency
       FROM company c
       JOIN membership m ON m.company_id = c.id
      WHERE m.user_id = $1
      ORDER BY c.created_at ASC, c.id ASC`,
    [actorId],
  );
  return res.rows.map((row) => ({ id: row.id, name: row.name, baseCurrency: row.base_currency }));
}
