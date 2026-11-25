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
  createCompanyWorkspace,
  findAppUserByFirebaseUid,
  getCompanyWorkspace,
  isActorMember,
  listActorCompanies,
} from './db/repositories/setup.js';

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

export function createSpineApp(context: SpineContext) {
  const { db, verifier, sandboxSecret } = context;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  const requireAuth = createSessionMiddleware(verifier);

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
        const identity = requireSession(req);
        const rawCompanyId = req.params['companyId'];
        const companyId = Array.isArray(rawCompanyId) ? rawCompanyId[0] ?? '' : rawCompanyId ?? '';
        if (!z.string().uuid().safeParse(companyId).success) {
          throw new AppError('TENANT_FORBIDDEN');
        }
        const user = await findAppUserByFirebaseUid(db, identity.firebaseUid);
        if (user === null || !(await isActorMember(db, companyId, user.id))) {
          throw new AppError('TENANT_FORBIDDEN');
        }
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

  app.use('/api', (_req: Request, _res: Response, next: NextFunction) => {
    next(new AppError('NOT_FOUND'));
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.httpStatus).json({ error: err.toBody() });
      return;
    }
    const fallback = new AppError('INTERNAL_ERROR');
    res.status(fallback.httpStatus).json({ error: fallback.toBody() });
  });

  return app;
}
