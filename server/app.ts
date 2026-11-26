import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { generateFiscalYears, type CalendarGenerateOptions } from '../core/calendar/index.js';
import { evaluateMessyGlCsv } from '../core/import/index.js';
import { serialize } from '../core/money/index.js';
import { AppError } from '../shared/errors.js';
import {
  CalendarPreviewRequestSchema,
  ImportPreviewRequestSchema,
  SandboxTokenRequestSchema,
  type SandboxTokenResponse,
} from '../shared/spine.js';
import {
  ChartImportRequestSchema,
  ChartImportResultSchema,
  ChartOfAccountsReportSchema,
} from '../shared/chart.js';
import {
  BudgetImportRequestSchema,
  BudgetImportResultSchema,
  BudgetReportSchema,
} from '../shared/budget.js';
import {
  CompanySetupRequestSchema,
  SessionWorkspaceResponseSchema,
  type SessionWorkspaceResponse,
} from '../shared/setup.js';
import {
  createSessionMiddleware,
  issueSandboxToken,
  requireSession,
  type TokenVerifier,
} from './auth/session.js';
import type { DatabaseHandle } from './db/client.js';
import {
  ImportCommitRequestSchema,
  ImportCommitResultSchema,
  ImportPreviewReportSchema,
  CompanyImportPreviewRequestSchema,
} from '../shared/import.js';
import {
  AccountDrilldownSchema,
  FinancialStatementsSchema,
  TrialBalanceReportSchema,
} from '../shared/reports.js';
import { commitImport, previewImport } from './db/repositories/import.js';
import { importChart, listChartAccounts } from './db/repositories/chart.js';
import { commitCoaMappings, getCoaMappingReport } from './db/repositories/coaMapping.js';
import { getBudget, importBudget } from './db/repositories/budget.js';
import { getBvaReport } from './db/repositories/bva.js';
import { BvaReportSchema } from '../shared/bva.js';
import {
  CoaMappingCommitRequestSchema,
  CoaMappingCommitResultSchema,
  CoaMappingReportSchema,
} from '../shared/coaMapping.js';
import { BoardPackExportFormatSchema, BoardPackReportSchema } from '../shared/boardPack.js';
import {
  DriverPlanCommitRequestSchema,
  DriverPlanCommitResponseSchema,
  DriverPlanPreviewRequestSchema,
  DriverPlanPreviewResponseSchema,
  RollingForecastResponseSchema,
  ScenarioComparisonResponseSchema,
  ScenarioListResponseSchema,
} from '../shared/planning.js';
import { buildBoardPackReport, renderBoardPack } from './export/boardPack.js';
import {
  commitDriverPlan,
  getRollingForecast,
  getScenarioComparison,
  listScenarios,
  previewDriverPlan,
} from './db/repositories/planning.js';
import { getAccountDrilldown, getFinancialStatements, getTrialBalance } from './db/repositories/reports.js';
import {
  AddCompanyMemberRequestSchema,
  ApprovalTaskSummarySchema,
  CompanyMemberSchema,
  CreateApprovalTaskRequestSchema,
  CreateWorkflowCommentRequestSchema,
  TransitionApprovalTaskRequestSchema,
  WorkflowCommentSummarySchema,
  WorkflowNotificationSummarySchema,
  WorkflowOverviewResponseSchema,
} from '../shared/workflow.js';
import {
  addCompanyMember,
  createApprovalTask,
  createWorkflowComment,
  listWorkflowOverview,
  markWorkflowNotificationRead,
  transitionApprovalTaskRecord,
} from './db/repositories/workflow.js';
import {
  WorkforceCommitRequestSchema,
  WorkforceCommitResponseSchema,
  WorkforcePreviewRequestSchema,
  WorkforcePreviewResponseSchema,
  WorkforceSavePositionsRequestSchema,
  WorkforceWorkspaceResponseSchema,
} from '../shared/workforce.js';
import {
  FluxAnalysisResponseSchema,
  PvmBridgeRequestSchema,
  PvmBridgeResponseSchema,
} from '../shared/variance.js';
import {
  commitWorkforcePlan,
  getWorkforceWorkspace,
  previewWorkforcePlan,
  saveWorkforcePositions,
} from './db/repositories/workforce.js';
import { computeCompanyPvmBridge, getFluxAnalysis } from './db/repositories/variance.js';
import {
  DashboardReportTemplateIdSchema,
  DashboardSummaryResponseSchema,
} from '../shared/dashboards.js';
import { getDashboardSummary } from './db/repositories/dashboards.js';
import {
  ApplyIndustryPackResponseSchema,
  IndustryPackCatalogResponseSchema,
  IndustryPackKeySchema,
} from '../shared/packs.js';
import { applyIndustryPackToCompany, listIndustryPacks } from './db/repositories/packs.js';
import {
  ConnectorConfigSummarySchema,
  ConnectorRunsResponseSchema,
  ConnectorsOverviewResponseSchema,
  CreateConnectorRequestSchema,
  SyncConnectorRequestSchema,
  SyncConnectorResponseSchema,
} from '../shared/integrations.js';
import {
  createConnectorConfig,
  listConnectorRuns,
  listConnectorsOverview,
  syncConnector,
} from './db/repositories/connectors.js';
import {
  OnboardingApproveMappingsRequestSchema,
  OnboardingApproveMappingsResponseSchema,
  OnboardingRehearseRequestSchema,
  OnboardingRehearseResponseSchema,
  OnboardingValidateRequestSchema,
  OnboardingValidationReportSchema,
} from '../shared/onboarding.js';
import {
  approveOnboardingMappings,
  rehearseCompanyOnboarding,
  validateCompanyOnboarding,
} from './db/repositories/onboarding.js';
import {
  createCompanyWorkspace,
  findAppUserByFirebaseUid,
  getCompanyWorkspace,
  isActorMember,
  listActorCompanies,
} from './db/repositories/setup.js';

/** Hard byte ceiling for an import upload (§4.4). Checked before any parsing or database work. */
const MAX_IMPORT_BYTES = 5_000_000;

export interface SpineContext {
  readonly db: DatabaseHandle;
  readonly verifier: TokenVerifier;
  /**
   * Present only for the non-production sandbox verifier: enables the sandbox token endpoint.
   * Null in production, which removes the endpoint entirely rather than disabling it (§13.3).
   */
  readonly sandboxSecret: string | null;
}

function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', {
      details: {
        issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      },
    });
  }
  return parsed.data;
}

function readUuidParam(rawValue: string | string[] | undefined): string {
  const value = Array.isArray(rawValue) ? (rawValue[0] ?? '') : (rawValue ?? '');
  if (!z.string().uuid().safeParse(value).success) {
    throw new AppError('TENANT_FORBIDDEN');
  }
  return value;
}

function readEntityUuidParam(rawValue: string | string[] | undefined, field: string): string {
  const value = Array.isArray(rawValue) ? (rawValue[0] ?? '') : (rawValue ?? '');
  if (!z.string().uuid().safeParse(value).success) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Invalid ${field} identifier.`,
      details: { issues: [`${field}: expected a UUID`] },
    });
  }
  return value;
}

function readPeriodQuery(rawValue: unknown): string | null {
  if (rawValue === undefined) return null;
  const parsed = z.string().trim().min(1).max(16).safeParse(rawValue);
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'The period query must be a single period code such as P01.',
      details: { issues: ['period: expected a non-empty period code'] },
    });
  }
  return parsed.data;
}

function readAsOfDateQuery(rawValue: unknown): string {
  if (rawValue === undefined) return new Date().toISOString().slice(0, 10);
  const parsed = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(rawValue);
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'asOfDate must be an ISO date such as 2026-11-25.',
      details: { issues: ['asOfDate: expected YYYY-MM-DD'] },
    });
  }
  return parsed.data;
}

function readFiscalYearQuery(rawValue: unknown): number | null {
  if (rawValue === undefined) return null;
  const parsed = z.coerce.number().int().min(1900).max(2200).safeParse(rawValue);
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'The year query must be a four-digit fiscal year.',
      details: { issues: ['year: expected an integer between 1900 and 2200'] },
    });
  }
  return parsed.data;
}

export function createSpineApp(context: SpineContext) {
  const { db, verifier, sandboxSecret } = context;
  const app = express();
  app.disable('x-powered-by');

  const requireAuth = createSessionMiddleware(verifier);
  // The import route is the only endpoint that may receive a large body, so it owns its parser and
  // is registered BEFORE the standard parser; every other route keeps the tight 2 MB limit (§4.4).
  const importBody = express.json({ limit: '6mb' });
  const standardJson = express.json({ limit: '2mb' });

  /**
   * Session identity AND membership of the named company, in that order: a foreign tenant gets the
   * same TENANT_FORBIDDEN it would get for a company that does not exist (§3.2, no enumeration).
   */
  async function requireCompanyActor(
    req: Request,
  ): Promise<{ readonly companyId: string; readonly userId: string }> {
    const identity = requireSession(req);
    const companyId = readUuidParam(req.params['companyId']);
    const user = await findAppUserByFirebaseUid(db, identity.firebaseUid);
    if (user === null || !(await isActorMember(db, companyId, user.id))) {
      throw new AppError('TENANT_FORBIDDEN');
    }
    return { companyId, userId: user.id };
  }

  app.post(
    '/api/companies/:companyId/import/commit',
    requireAuth,
    importBody,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId, userId } = await requireCompanyActor(req);
        const body = parseBody(ImportCommitRequestSchema, req.body);
        const bytes = Buffer.byteLength(body.csvText, 'utf8');
        if (bytes > MAX_IMPORT_BYTES) {
          throw new AppError('IMPORT_FILE_TOO_LARGE', {
            details: { bytes, maxBytes: MAX_IMPORT_BYTES },
          });
        }
        const result = await db.transaction((tx) =>
          commitImport(tx, {
            companyId,
            actorId: userId,
            kind: body.kind,
            sourceFilename: body.sourceFilename,
            csvText: body.csvText,
            occurredAt: new Date().toISOString(),
          }),
        );
        res.status(201).json(ImportCommitResultSchema.parse(result));
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * Company-scoped preview: the server classifies the rows against ITS OWN chart and applies the
   * journal-balance gate, so the browser never supplies (or invents) the set of mapped accounts.
   * Read-only — a preview can never write a batch.
   */
  app.post(
    '/api/companies/:companyId/import/preview',
    requireAuth,
    importBody,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId } = await requireCompanyActor(req);
        const body = parseBody(CompanyImportPreviewRequestSchema, req.body);
        const bytes = Buffer.byteLength(body.csvText, 'utf8');
        if (bytes > MAX_IMPORT_BYTES) {
          throw new AppError('IMPORT_FILE_TOO_LARGE', {
            details: { bytes, maxBytes: MAX_IMPORT_BYTES },
          });
        }
        const report = await previewImport(db, {
          companyId,
          csvText: body.csvText,
          ...(body.asOfDate === undefined ? {} : { asOfDate: body.asOfDate }),
        });
        res.status(200).json(ImportPreviewReportSchema.parse(report));
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * M2 Customer Onboarding & Data Migration Pipeline (MASTER_PROMPT §11.12, ONB1–ONB3):
   * deterministic assisted CoA matching, exact row-accounting validation, period-gap/anomaly
   * inspection, explicit human CoA approval, and repeatable dry-run / stage-commit rehearsal.
   */
  app.post(
    '/api/companies/:companyId/onboarding/validate',
    requireAuth,
    importBody,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId, userId } = await requireCompanyActor(req);
        const body = parseBody(OnboardingValidateRequestSchema, req.body);
        const bytes = Buffer.byteLength(body.csvText, 'utf8');
        if (bytes > MAX_IMPORT_BYTES) {
          throw new AppError('IMPORT_FILE_TOO_LARGE', {
            details: { bytes, maxBytes: MAX_IMPORT_BYTES },
          });
        }
        const report = await validateCompanyOnboarding(db, {
          companyId,
          actorId: userId,
          request: body,
          defaultAsOfDate: new Date().toISOString().slice(0, 10),
        });
        res.status(200).json(OnboardingValidationReportSchema.parse(report));
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/companies/:companyId/onboarding/mappings/approve',
    requireAuth,
    importBody,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId, userId } = await requireCompanyActor(req);
        const body = parseBody(OnboardingApproveMappingsRequestSchema, req.body);
        const bytes = Buffer.byteLength(body.csvText, 'utf8');
        if (bytes > MAX_IMPORT_BYTES) {
          throw new AppError('IMPORT_FILE_TOO_LARGE', {
            details: { bytes, maxBytes: MAX_IMPORT_BYTES },
          });
        }
        const result = await db.transaction((tx) =>
          approveOnboardingMappings(tx, {
            companyId,
            actorId: userId,
            request: body,
            occurredAt: new Date().toISOString(),
          }),
        );
        res.status(201).json(OnboardingApproveMappingsResponseSchema.parse(result));
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/companies/:companyId/onboarding/rehearse',
    requireAuth,
    importBody,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId, userId } = await requireCompanyActor(req);
        const body = parseBody(OnboardingRehearseRequestSchema, req.body);
        const bytes = Buffer.byteLength(body.csvText, 'utf8');
        if (bytes > MAX_IMPORT_BYTES) {
          throw new AppError('IMPORT_FILE_TOO_LARGE', {
            details: { bytes, maxBytes: MAX_IMPORT_BYTES },
          });
        }
        const result =
          body.mode === 'dry_run'
            ? await rehearseCompanyOnboarding(db, {
                companyId,
                actorId: userId,
                request: body,
                occurredAt: new Date().toISOString(),
              })
            : await db.transaction((tx) =>
                rehearseCompanyOnboarding(tx, {
                  companyId,
                  actorId: userId,
                  request: body,
                  occurredAt: new Date().toISOString(),
                }),
              );
        res.status(body.mode === 'dry_run' ? 200 : 201).json(OnboardingRehearseResponseSchema.parse(result));
      } catch (error) {
        next(error);
      }
    },
  );

  app.use(standardJson);

  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({ ok: true, service: 'onefpa-api', milestone: 'M1' });
  });

  app.get('/readyz', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      await db.query('SELECT 1 AS ready');
      res.status(200).json({ ok: true, database: db.driver });
    } catch {
      next(
        new AppError('INTERNAL_ERROR', {
          userMessage: 'The database is not accepting queries.',
          details: { dependency: 'database' },
        }),
      );
    }
  });

  if (sandboxSecret !== null && verifier.kind === 'sandbox-hmac') {
    app.post('/api/session/sandbox-token', (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = parseBody(SandboxTokenRequestSchema, req.body);
        const token = issueSandboxToken({
          identity: {
            firebaseUid: `sandbox:${body.email.toLowerCase()}`,
            email: body.email.toLowerCase(),
            displayName: body.displayName,
          },
          secret: sandboxSecret,
          ttlMs: body.ttlSeconds * 1000,
        });
        const payload: SandboxTokenResponse = {
          token,
          tokenType: 'sandbox-hmac',
          expiresInSeconds: body.ttlSeconds,
        };
        res.status(201).json(payload);
      } catch (error) {
        next(error);
      }
    });
  }

  app.get('/api/session/workspace', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const identity = requireSession(req);
      const user = await findAppUserByFirebaseUid(db, identity.firebaseUid);
      if (user === null) {
        const empty: SessionWorkspaceResponse = SessionWorkspaceResponseSchema.parse({
          authenticated: true,
          identity: { email: identity.email, displayName: identity.displayName },
          companies: [],
          workspace: null,
        });
        res.status(200).json(empty);
        return;
      }

      const companies = await listActorCompanies(db, user.id);
      const selected = companies[0];
      const workspace = selected === undefined ? null : await getCompanyWorkspace(db, selected.id);
      const payload: SessionWorkspaceResponse = SessionWorkspaceResponseSchema.parse({
        authenticated: true,
        identity: { email: identity.email, displayName: identity.displayName },
        companies,
        workspace,
      });
      res.status(200).json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/setup/company', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const identity = requireSession(req);
      const request = parseBody(CompanySetupRequestSchema, req.body);
      const workspace = await db.transaction((tx) =>
        createCompanyWorkspace(tx, {
          actor: {
            firebaseUid: identity.firebaseUid,
            email: identity.email,
            displayName: identity.displayName,
          },
          request,
          occurredAt: new Date().toISOString(),
        }),
      );
      res.status(201).json(workspace);
    } catch (error) {
      next(error);
    }
  });

  app.get(
    '/api/companies/:companyId/workspace',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId } = await requireCompanyActor(req);
        const workspace = await getCompanyWorkspace(db, companyId);
        if (workspace === null) {
          throw new AppError('NOT_FOUND', {
            userMessage: 'That company workspace is not configured yet.',
          });
        }
        res.status(200).json(workspace);
      } catch (error) {
        next(error);
      }
    },
  );

  app.post('/api/calendar/preview', (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = parseBody(CalendarPreviewRequestSchema, req.body);
      const opts: CalendarGenerateOptions = {
        kind: body.kind,
        startYear: body.startYear,
        ...(body.yearCount !== undefined ? { yearCount: body.yearCount } : {}),
        ...(body.startMonth !== undefined ? { startMonth: body.startMonth } : {}),
        ...(body.week53Rule !== undefined ? { week53Rule: body.week53Rule } : {}),
        ...(body.includeAdjustmentPeriod !== undefined
          ? { includeAdjustmentPeriod: body.includeAdjustmentPeriod }
          : {}),
      };
      const years = generateFiscalYears(opts);
      res.status(200).json({ years });
    } catch (error) {
      if (error instanceof AppError) {
        next(error);
        return;
      }
      next(
        new AppError('CALENDAR_CONFLICT', {
          userMessage: error instanceof Error ? error.message : 'Invalid fiscal calendar configuration.',
        }),
      );
    }
  });

  app.post('/api/import/preview', (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = parseBody(ImportPreviewRequestSchema, req.body);
      const result = evaluateMessyGlCsv({
        csvText: body.csvText,
        knownAccountCodes: new Set(body.knownAccountCodes),
        ...(body.locale !== undefined ? { locale: body.locale } : {}),
      });

      res.status(200).json({
        rowsIn: result.rowsIn,
        importedCount: result.imported.length,
        quarantinedCount: result.quarantined.length,
        duplicatesDetected: result.duplicatesDetected,
        totalDebits: serialize(result.totalDebits, 2),
        totalCredits: serialize(result.totalCredits, 2),
        imported: result.imported.map((row) => ({
          rowNo: row.rowNo,
          entryRef: row.entryRef,
          postingDate: row.postingDate,
          accountCode: row.accountCode,
          description: row.description,
          debit: serialize(row.debit, 2),
          credit: serialize(row.credit, 2),
        })),
        quarantined: result.quarantined,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get(
    '/api/companies/:companyId/accounts',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId } = await requireCompanyActor(req);
        const accounts = await listChartAccounts(db, companyId);
        res.status(200).json(ChartOfAccountsReportSchema.parse({ companyId, accounts }));
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * Chart-of-accounts import. All-or-nothing: the pure /core parser validates every row first, and
   * the accounts + their audit row commit in ONE transaction (G1/G10).
   */
  app.post(
    '/api/companies/:companyId/chart/import',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId, userId } = await requireCompanyActor(req);
        const body = parseBody(ChartImportRequestSchema, req.body);
        const result = await db.transaction((tx) =>
          importChart(tx, {
            companyId,
            actorId: userId,
            csvText: body.csvText,
            occurredAt: new Date().toISOString(),
          }),
        );
        res.status(201).json(ChartImportResultSchema.parse(result));
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * Versioned source→account mapping report (§9.3.4, SPEC §3.6f). Source codes come only from
   * retained import rows; the target list is the live chart. Read-only, tenant scoped.
   */
  app.get(
    '/api/companies/:companyId/coa-mapping',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId } = await requireCompanyActor(req);
        const asOfDate = readAsOfDateQuery(req.query['asOfDate']);
        const report = await getCoaMappingReport(db, companyId, asOfDate);
        res.status(200).json(CoaMappingReportSchema.parse(report));
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * Versioned mapping commit. Every real edit writes a NEW row and its audit payload in ONE
   * transaction; an identical re-submit writes zero new versions (G1/G10, idempotency).
   */
  app.post(
    '/api/companies/:companyId/coa-mapping/commit',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId, userId } = await requireCompanyActor(req);
        const body = parseBody(CoaMappingCommitRequestSchema, req.body);
        const asOfDate = new Date().toISOString().slice(0, 10);
        const result = await db.transaction((tx) =>
          commitCoaMappings(tx, {
            companyId,
            actorId: userId,
            entries: body.entries,
            effectiveFrom: asOfDate,
            occurredAt: new Date().toISOString(),
          }),
        );
        res.status(201).json(CoaMappingCommitResultSchema.parse(result));
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * Budget (plan) read model for one fiscal year. An absent budget reports nulls and zero lines —
   * the screen shows an honest empty state instead of an invented all-zero plan.
   */
  app.get(
    '/api/companies/:companyId/budget',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId } = await requireCompanyActor(req);
        const fiscalYear = readFiscalYearQuery(req.query['year']);
        if (fiscalYear === null) {
          throw new AppError('VALIDATION_FAILED', {
            userMessage: 'The budget endpoint requires ?year= (the fiscal year being planned).',
            details: { issues: ['year: required'] },
          });
        }
        const report = await getBudget(db, { companyId, fiscalYear });
        res.status(200).json(BudgetReportSchema.parse(report));
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * Budget import. The pure /core parser validates every row first, account/period codes are
   * resolved against this company's own chart and calendar, and the scenario + plan version + plan
   * lines + audit row commit in ONE transaction (G4/G10). Nothing here can reach `gl_entry`.
   */
  app.post(
    '/api/companies/:companyId/budget/import',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId, userId } = await requireCompanyActor(req);
        const body = parseBody(BudgetImportRequestSchema, req.body);
        const result = await db.transaction((tx) =>
          importBudget(tx, {
            companyId,
            actorId: userId,
            csvText: body.csvText,
            fiscalYear: body.fiscalYear,
            sourceFilename: body.sourceFilename ?? null,
            occurredAt: new Date().toISOString(),
          }),
        );
        res.status(201).json(BudgetImportResultSchema.parse(result));
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    '/api/companies/:companyId/trial-balance',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId } = await requireCompanyActor(req);
        const period = readPeriodQuery(req.query['period']);
        const report = await getTrialBalance(db, {
          companyId,
          ...(period === null ? {} : { throughPeriodCode: period }),
        });
        res.status(200).json(TrialBalanceReportSchema.parse(report));
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * Budget-vs-Actual for the year to date through ?period=. Plan comes from the current plan
   * version, actual from the trial-balance read model, and the join is done in /core/variance so
   * the screen can never compute a variance the engine did not (§3.5, G5).
   */
  app.get(
    '/api/companies/:companyId/bva',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId } = await requireCompanyActor(req);
        const period = readPeriodQuery(req.query['period']);
        if (period === null) {
          throw new AppError('VALIDATION_FAILED', {
            userMessage: 'The BvA endpoint requires ?period= (year-to-date through that period).',
            details: { issues: ['period: required'] },
          });
        }
        const fiscalYear = readFiscalYearQuery(req.query['year']);
        const report = await getBvaReport(db, {
          companyId,
          throughPeriodCode: period,
          fiscalYear,
        });
        res.status(200).json(BvaReportSchema.parse(report));
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    '/api/companies/:companyId/accounts/:accountCode/drill',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId } = await requireCompanyActor(req);
        const rawCode = req.params['accountCode'];
        const accountCode = Array.isArray(rawCode) ? (rawCode[0] ?? '') : (rawCode ?? '');
        const period = readPeriodQuery(req.query['period']);
        const drill = await getAccountDrilldown(db, {
          companyId,
          accountCode,
          ...(period === null ? {} : { throughPeriodCode: period }),
        });
        res.status(200).json(AccountDrilldownSchema.parse(drill));
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    '/api/companies/:companyId/statements',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId } = await requireCompanyActor(req);
        const period = readPeriodQuery(req.query['period']);
        if (period === null) {
          throw new AppError('VALIDATION_FAILED', {
            userMessage: 'The statements endpoint requires ?period= (year-to-date through that period).',
            details: { issues: ['period: required'] },
          });
        }
        const fiscalYear = readFiscalYearQuery(req.query['year']);
        const statements = await getFinancialStatements(db, {
          companyId,
          throughPeriodCode: period,
          ...(fiscalYear === null ? {} : { fiscalYear }),
        });
        res.status(200).json(FinancialStatementsSchema.parse(statements));
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * Board pack: ONE canonical report from the statements + BvA read models. The JSON preview and
   * both exports are built from this same object, so UI/XLSX/PDF cannot drift (A6, U5, G7).
   */
  app.get(
    '/api/companies/:companyId/board-pack',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId } = await requireCompanyActor(req);
        const period = readPeriodQuery(req.query['period']);
        if (period === null) {
          throw new AppError('VALIDATION_FAILED', {
            userMessage: 'The board-pack endpoint requires ?period= (year-to-date through that period).',
            details: { issues: ['period: required'] },
          });
        }
        const fiscalYear = readFiscalYearQuery(req.query['year']);
        const report = await buildBoardPackReport(db, {
          companyId,
          throughPeriodCode: period,
          ...(fiscalYear === null ? {} : { fiscalYear }),
        });
        res.status(200).json(BoardPackReportSchema.parse(report));
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    '/api/companies/:companyId/board-pack/export',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId } = await requireCompanyActor(req);
        const period = readPeriodQuery(req.query['period']);
        if (period === null) {
          throw new AppError('VALIDATION_FAILED', {
            userMessage: 'The board-pack export requires ?period= (year-to-date through that period).',
            details: { issues: ['period: required'] },
          });
        }
        const format = BoardPackExportFormatSchema.safeParse(req.query['format']);
        if (!format.success) {
          throw new AppError('VALIDATION_FAILED', {
            userMessage: 'The board-pack export requires ?format=xlsx, ?format=pdf, or ?format=pptx.',
            details: { issues: ['format: expected xlsx, pdf, or pptx'] },
          });
        }
        const fiscalYear = readFiscalYearQuery(req.query['year']);
        const report = await buildBoardPackReport(db, {
          companyId,
          throughPeriodCode: period,
          ...(fiscalYear === null ? {} : { fiscalYear }),
        });
        const bytes = await renderBoardPack(report, format.data);
        res.status(200);
        res.setHeader(
          'content-type',
          format.data === 'pdf'
            ? 'application/pdf'
            : format.data === 'pptx'
              ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
              : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
        res.setHeader('content-disposition', `attachment; filename="board-pack-${period}.${format.data}"`);
        res.send(bytes);
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * M2 Planning Suite endpoints (SPEC §3.7, DEC-014): scenarios, driver-based plan preview/commit,
   * rolling forecast (active GL actuals + forecast scenario), and scenario comparison.
   */
  app.get(
    '/api/companies/:companyId/planning/scenarios',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId } = await requireCompanyActor(req);
        const list = await listScenarios(db, companyId);
        res.status(200).json(ScenarioListResponseSchema.parse(list));
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/companies/:companyId/planning/drivers/preview',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId } = await requireCompanyActor(req);
        const body = parseBody(DriverPlanPreviewRequestSchema, req.body);
        const preview = await previewDriverPlan(db, companyId, body);
        res.status(200).json(DriverPlanPreviewResponseSchema.parse(preview));
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/companies/:companyId/planning/drivers/commit',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId, userId } = await requireCompanyActor(req);
        const body = parseBody(DriverPlanCommitRequestSchema, req.body);
        const result = await db.transaction((tx) =>
          commitDriverPlan(tx, {
            companyId,
            actorId: userId,
            input: body,
            occurredAt: new Date().toISOString(),
          }),
        );
        res.status(201).json(DriverPlanCommitResponseSchema.parse(result));
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    '/api/companies/:companyId/planning/rolling-forecast',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId } = await requireCompanyActor(req);
        const fiscalYear = readFiscalYearQuery(req.query['year']);
        if (fiscalYear === null) {
          throw new AppError('VALIDATION_FAILED', {
            userMessage: 'The rolling-forecast endpoint requires ?year=.',
            details: { issues: ['year: required'] },
          });
        }
        const scenario = typeof req.query['scenario'] === 'string' ? req.query['scenario'].trim() : '';
        if (!scenario) {
          throw new AppError('VALIDATION_FAILED', {
            userMessage: 'The rolling-forecast endpoint requires ?scenario=.',
            details: { issues: ['scenario: required'] },
          });
        }
        const cutoffRaw = req.query['cutoffPeriod'];
        const cutoffPeriod =
          typeof cutoffRaw === 'string' && cutoffRaw.trim().length > 0 ? cutoffRaw.trim() : null;
        const report = await getRollingForecast(db, {
          companyId,
          fiscalYear,
          cutoffPeriod,
          scenarioName: scenario,
        });
        res.status(200).json(RollingForecastResponseSchema.parse(report));
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    '/api/companies/:companyId/planning/compare',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId } = await requireCompanyActor(req);
        const fiscalYear = readFiscalYearQuery(req.query['year']);
        if (fiscalYear === null) {
          throw new AppError('VALIDATION_FAILED', {
            userMessage: 'The scenario compare endpoint requires ?year=.',
            details: { issues: ['year: required'] },
          });
        }
        const base = typeof req.query['base'] === 'string' ? req.query['base'].trim() : '';
        const target = typeof req.query['target'] === 'string' ? req.query['target'].trim() : '';
        if (!base || !target) {
          throw new AppError('VALIDATION_FAILED', {
            userMessage: 'The scenario compare endpoint requires ?base= and ?target=.',
            details: { issues: ['base/target: required'] },
          });
        }
        const report = await getScenarioComparison(db, {
          companyId,
          fiscalYear,
          baseScenarioName: base,
          targetScenarioName: target,
        });
        res.status(200).json(ScenarioComparisonResponseSchema.parse(report));
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * M2 Collaboration & Workflow Engine endpoints (SPEC §3.8, WI-0034):
   * role-guarded member invitations, approval task state machine, anchored comments with @mentions,
   * and job-backed inbox notifications.
   */
  app.get(
    '/api/companies/:companyId/workflow',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId, userId } = await requireCompanyActor(req);
        const scenarioName =
          typeof req.query['scenario'] === 'string' && req.query['scenario'].trim().length > 0
            ? req.query['scenario'].trim()
            : undefined;
        const overview = await listWorkflowOverview(db, {
          companyId,
          actorId: userId,
          ...(scenarioName === undefined ? {} : { scenarioName }),
        });
        res.status(200).json(WorkflowOverviewResponseSchema.parse(overview));
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/companies/:companyId/members',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId, userId } = await requireCompanyActor(req);
        const body = parseBody(AddCompanyMemberRequestSchema, req.body);
        const member = await db.transaction((tx) =>
          addCompanyMember(tx, {
            companyId,
            actorId: userId,
            request: body,
            occurredAt: new Date().toISOString(),
          }),
        );
        res.status(201).json(CompanyMemberSchema.parse(member));
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/companies/:companyId/workflow/approvals',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId, userId } = await requireCompanyActor(req);
        const body = parseBody(CreateApprovalTaskRequestSchema, req.body);
        const task = await db.transaction((tx) =>
          createApprovalTask(tx, {
            companyId,
            actorId: userId,
            request: body,
            occurredAt: new Date().toISOString(),
          }),
        );
        res.status(201).json(ApprovalTaskSummarySchema.parse(task));
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/companies/:companyId/workflow/approvals/:taskId/transition',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId, userId } = await requireCompanyActor(req);
        const taskId = readEntityUuidParam(req.params['taskId'], 'taskId');
        const body = parseBody(TransitionApprovalTaskRequestSchema, req.body);
        const task = await db.transaction((tx) =>
          transitionApprovalTaskRecord(tx, {
            companyId,
            actorId: userId,
            taskId,
            request: body,
            occurredAt: new Date().toISOString(),
          }),
        );
        res.status(200).json(ApprovalTaskSummarySchema.parse(task));
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/companies/:companyId/workflow/comments',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId, userId } = await requireCompanyActor(req);
        const body = parseBody(CreateWorkflowCommentRequestSchema, req.body);
        const comment = await db.transaction((tx) =>
          createWorkflowComment(tx, {
            companyId,
            actorId: userId,
            request: body,
            occurredAt: new Date().toISOString(),
          }),
        );
        res.status(201).json(WorkflowCommentSummarySchema.parse(comment));
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/companies/:companyId/workflow/notifications/:notificationId/read',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId, userId } = await requireCompanyActor(req);
        const notificationId = readEntityUuidParam(req.params['notificationId'], 'notificationId');
        const notification = await db.transaction((tx) =>
          markWorkflowNotificationRead(tx, {
            companyId,
            actorId: userId,
            notificationId,
            occurredAt: new Date().toISOString(),
          }),
        );
        res.status(200).json(WorkflowNotificationSummarySchema.parse(notification));
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * M2 Workforce Module endpoints (§2.4 One-Engine Framework Proof, WI-0035):
   * persistent position roster + pure /core/workforce driver compilation + commit through planning engine.
   */
  app.get(
    '/api/companies/:companyId/workforce',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId, userId } = await requireCompanyActor(req);
        const fiscalYear = readFiscalYearQuery(req.query['year']);
        const workspace = await getWorkforceWorkspace(db, {
          companyId,
          actorId: userId,
          fiscalYear,
        });
        res.status(200).json(WorkforceWorkspaceResponseSchema.parse(workspace));
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/companies/:companyId/workforce/positions',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId, userId } = await requireCompanyActor(req);
        const body = parseBody(WorkforceSavePositionsRequestSchema, req.body);
        const workspace = await db.transaction((tx) =>
          saveWorkforcePositions(tx, {
            companyId,
            actorId: userId,
            positions: body.positions,
            fiscalYear: body.fiscalYear ?? null,
            occurredAt: new Date().toISOString(),
          }),
        );
        res.status(200).json(WorkforceWorkspaceResponseSchema.parse(workspace));
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/companies/:companyId/workforce/preview',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId } = await requireCompanyActor(req);
        const body = parseBody(WorkforcePreviewRequestSchema, req.body);
        const preview = await previewWorkforcePlan(db, {
          companyId,
          request: body,
        });
        res.status(200).json(WorkforcePreviewResponseSchema.parse(preview));
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/companies/:companyId/workforce/commit',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId, userId } = await requireCompanyActor(req);
        const body = parseBody(WorkforceCommitRequestSchema, req.body);
        const result = await db.transaction((tx) =>
          commitWorkforcePlan(tx, {
            companyId,
            actorId: userId,
            request: body,
            occurredAt: new Date().toISOString(),
          }),
        );
        res.status(201).json(WorkforceCommitResponseSchema.parse(result));
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * M2 Variance Analysis endpoints (SPEC §3.10, WI-0036):
   * Flux waterfall bridge over committed BvA + exact Price-Volume-Mix (PVM) bridge.
   */
  app.get(
    '/api/companies/:companyId/variance/flux',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId } = await requireCompanyActor(req);
        const period = readPeriodQuery(req.query['period']);
        if (period === null) {
          throw new AppError('VALIDATION_FAILED', {
            userMessage: 'The flux analysis endpoint requires ?period= (year-to-date through that period).',
            details: { issues: ['period: required'] },
          });
        }
        const fiscalYear = readFiscalYearQuery(req.query['year']);
        const minAbsRaw = req.query['minAbs'];
        const minAbsVariance =
          typeof minAbsRaw === 'string' && minAbsRaw.trim().length > 0 ? minAbsRaw.trim() : undefined;
        const topNRaw = req.query['topN'];
        let topN: number | undefined;
        if (topNRaw !== undefined) {
          const parsedTopN = z.coerce.number().int().min(1).max(100).safeParse(topNRaw);
          if (!parsedTopN.success) {
            throw new AppError('VALIDATION_FAILED', {
              userMessage: 'The topN filter must be an integer between 1 and 100.',
              details: { issues: ['topN: expected integer between 1 and 100'] },
            });
          }
          topN = parsedTopN.data;
        }
        const report = await getFluxAnalysis(db, {
          companyId,
          throughPeriodCode: period,
          ...(fiscalYear === null ? {} : { fiscalYear }),
          ...(minAbsVariance === undefined ? {} : { minAbsVariance }),
          ...(topN === undefined ? {} : { topN }),
        });
        res.status(200).json(FluxAnalysisResponseSchema.parse(report));
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/companies/:companyId/variance/pvm',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId } = await requireCompanyActor(req);
        const body = parseBody(PvmBridgeRequestSchema, req.body);
        const result = await computeCompanyPvmBridge(db, {
          companyId,
          request: body,
        });
        res.status(200).json(PvmBridgeResponseSchema.parse(result));
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * M2 Dashboards v1 & KPI Library (SPEC §3.11, WI-0038):
   * Canonical KPI evaluation + multi-period trend + Report Builder with 100% citation coverage,
   * backed by a fingerprint-invalidated aggregate cache (`RPT2`).
   */
  app.get(
    '/api/companies/:companyId/dashboards',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId } = await requireCompanyActor(req);
        const period = readPeriodQuery(req.query['period']);
        if (period === null) {
          throw new AppError('VALIDATION_FAILED', {
            userMessage: 'The dashboards endpoint requires ?period= (year-to-date through that period).',
            details: { issues: ['period: required'] },
          });
        }
        const fiscalYear = readFiscalYearQuery(req.query['year']);
        const rawTemplate = req.query['template'];
        const parsedTemplate = DashboardReportTemplateIdSchema.safeParse(
          rawTemplate === undefined ? 'executive_summary' : rawTemplate,
        );
        if (!parsedTemplate.success) {
          throw new AppError('VALIDATION_FAILED', {
            userMessage: 'The template filter must be executive_summary, cash_and_runway, or plan_performance.',
            details: { issues: ['template: expected executive_summary, cash_and_runway, or plan_performance'] },
          });
        }
        const report = await getDashboardSummary(db, {
          companyId,
          throughPeriodCode: period,
          ...(fiscalYear === null ? {} : { fiscalYear }),
          templateId: parsedTemplate.data,
        });
        res.status(200).json(DashboardSummaryResponseSchema.parse(report));
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * M2 Data-Only Industry Packs (§2.6, §6.6, WI-0039):
   * Read verified Class A pack catalog and atomically apply a pack's CoA baseline to the company.
   */
  app.get(
    '/api/companies/:companyId/packs',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId } = await requireCompanyActor(req);
        const packs = listIndustryPacks();
        res.status(200).json(IndustryPackCatalogResponseSchema.parse({ companyId, packs }));
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/companies/:companyId/packs/:packKey/apply',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId, userId } = await requireCompanyActor(req);
        const rawKey = req.params['packKey'];
        const keyStr = Array.isArray(rawKey) ? (rawKey[0] ?? '') : (rawKey ?? '');
        const parsedKey = IndustryPackKeySchema.safeParse(keyStr);
        if (!parsedKey.success) {
          throw new AppError('NOT_FOUND', {
            userMessage: `Industry pack "${keyStr}" does not exist or is deferred past M2.`,
          });
        }
        const result = await db.transaction((tx) =>
          applyIndustryPackToCompany(tx, {
            companyId,
            actorId: userId,
            packKey: parsedKey.data,
            occurredAt: new Date().toISOString(),
          }),
        );
        res.status(201).json(ApplyIndustryPackResponseSchema.parse(result));
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * M2 Connectors Framework + Google Sheets, QBO, and Xero Adapters (§11.1, CON1–CON5, WI-0040):
   * Credentials stay write-only server-side; matched normalized entries feed ONE commitImport path.
   */
  app.get(
    '/api/companies/:companyId/connectors',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId } = await requireCompanyActor(req);
        const overview = await listConnectorsOverview(db, companyId);
        res.status(200).json(ConnectorsOverviewResponseSchema.parse(overview));
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/companies/:companyId/connectors',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId, userId } = await requireCompanyActor(req);
        const body = parseBody(CreateConnectorRequestSchema, req.body);
        const created = await db.transaction((tx) =>
          createConnectorConfig(tx, {
            companyId,
            actorId: userId,
            request: body,
            occurredAt: new Date().toISOString(),
          }),
        );
        res.status(201).json(ConnectorConfigSummarySchema.parse(created));
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    '/api/companies/:companyId/connectors/:connectorId/runs',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId } = await requireCompanyActor(req);
        const connectorId = readEntityUuidParam(req.params['connectorId'], 'connectorId');
        const runs = await listConnectorRuns(db, { companyId, connectorId });
        res.status(200).json(ConnectorRunsResponseSchema.parse(runs));
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/companies/:companyId/connectors/:connectorId/sync',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { companyId, userId } = await requireCompanyActor(req);
        const connectorId = readEntityUuidParam(req.params['connectorId'], 'connectorId');
        const body = parseBody(SyncConnectorRequestSchema, req.body);
        const result = await db.transaction((tx) =>
          syncConnector(tx, {
            companyId,
            connectorId,
            actorId: userId,
            request: body,
            occurredAt: new Date().toISOString(),
          }),
        );
        res.status(201).json(SyncConnectorResponseSchema.parse(result));
      } catch (error) {
        next(error);
      }
    },
  );

  app.use('/api', (_req: Request, _res: Response, next: NextFunction) => {
    next(new AppError('NOT_FOUND'));
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.httpStatus).json({ error: err.toBody() });
      return;
    }
    const bodyParserType = (err as { type?: unknown }).type;
    if (bodyParserType === 'entity.too.large') {
      const tooLarge = new AppError('IMPORT_FILE_TOO_LARGE', {
        details: { maxBytes: MAX_IMPORT_BYTES },
      });
      res.status(tooLarge.httpStatus).json({ error: tooLarge.toBody() });
      return;
    }
    if (bodyParserType === 'entity.parse.failed') {
      const malformed = new AppError('VALIDATION_FAILED', {
        userMessage: 'The request body is not valid JSON.',
      });
      res.status(malformed.httpStatus).json({ error: malformed.toBody() });
      return;
    }
    const fallback = new AppError('INTERNAL_ERROR');
    res.status(fallback.httpStatus).json({ error: fallback.toBody() });
  });

  return app;
}
