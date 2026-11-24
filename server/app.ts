import express, { type NextFunction, type Request, type Response } from 'express';
import { generateFiscalYears, type CalendarGenerateOptions } from '../core/calendar/index.js';
import { evaluateMessyGlCsv } from '../core/import/index.js';
import { serialize } from '../core/money/index.js';
import { AppError } from '../shared/errors.js';
import { CalendarPreviewRequestSchema, ImportPreviewRequestSchema } from '../shared/spine.js';

export function createSpineApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({
      ok: true,
      service: 'onefpa-api',
      milestone: 'M0',
    });
  });

  app.get('/readyz', (_req: Request, res: Response) => {
    const dbConfigured = Boolean(process.env['DATABASE_URL']);
    res.status(200).json({
      ok: true,
      database: dbConfigured ? 'configured' : 'pglite-sandbox',
    });
  });

  app.get('/api/session/workspace', (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.header('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      next(new AppError('SESSION_REQUIRED'));
      return;
    }
    const token = authHeader.slice('Bearer '.length).trim();
    if (token.length === 0) {
      next(new AppError('TOKEN_INVALID'));
      return;
    }
    res.status(200).json({
      authenticated: true,
      company: null,
      feedState: 'empty',
    });
  });

  app.post('/api/calendar/preview', (req: Request, res: Response, next: NextFunction) => {
    const parsed = CalendarPreviewRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      next(
        new AppError('VALIDATION_FAILED', {
          details: { issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
        }),
      );
      return;
    }

    try {
      const opts: CalendarGenerateOptions = {
        kind: parsed.data.kind,
        startYear: parsed.data.startYear,
        yearCount: parsed.data.yearCount,
        ...(parsed.data.startMonth !== undefined ? { startMonth: parsed.data.startMonth } : {}),
        ...(parsed.data.week53Rule !== undefined ? { week53Rule: parsed.data.week53Rule } : {}),
        ...(parsed.data.includeAdjustmentPeriod !== undefined
          ? { includeAdjustmentPeriod: parsed.data.includeAdjustmentPeriod }
          : {}),
      };
      const years = generateFiscalYears(opts);
      res.status(200).json({ years });
    } catch (err) {
      next(
        new AppError('CALENDAR_CONFLICT', {
          userMessage: err instanceof Error ? err.message : 'Invalid fiscal calendar configuration.',
        }),
      );
    }
  });

  app.post('/api/import/preview', (req: Request, res: Response, next: NextFunction) => {
    const parsed = ImportPreviewRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      next(
        new AppError('VALIDATION_FAILED', {
          details: { issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
        }),
      );
      return;
    }

    const result = evaluateMessyGlCsv({
      csvText: parsed.data.csvText,
      knownAccountCodes: new Set(parsed.data.knownAccountCodes),
      locale: parsed.data.locale,
    });

    res.status(200).json({
      rowsIn: result.rowsIn,
      importedCount: result.imported.length,
      quarantinedCount: result.quarantined.length,
      duplicatesDetected: result.duplicatesDetected,
      totalDebits: serialize(result.totalDebits, 2),
      totalCredits: serialize(result.totalCredits, 2),
      imported: result.imported.map((r) => ({
        rowNo: r.rowNo,
        entryRef: r.entryRef,
        postingDate: r.postingDate,
        accountCode: r.accountCode,
        description: r.description,
        debit: serialize(r.debit, 2),
        credit: serialize(r.credit, 2),
      })),
      quarantined: result.quarantined,
    });
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
