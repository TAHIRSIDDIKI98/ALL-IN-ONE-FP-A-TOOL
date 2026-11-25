import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Request, type Response } from 'express';
import { createSpineApp } from './app.js';
import { resolveTokenVerifier } from './auth/session.js';
import { openDatabase } from './db/client.js';
import { applyMigrations } from './db/migrate.js';

async function startServer(): Promise<void> {
  const port = Number.parseInt(process.env['PORT'] ?? '3000', 10);
  const host = process.env['HOST'] ?? '0.0.0.0';
  const isProd = process.env['NODE_ENV'] === 'production';

  const db = await openDatabase({ DATABASE_URL: process.env['DATABASE_URL'] });
  if (db.driver === 'pglite') {
    const applied = await applyMigrations(db);
    process.stdout.write(
      `${JSON.stringify({ event: 'sandbox_migrations', applied })}\n`,
    );
  }

  const session = await resolveTokenVerifier({
    NODE_ENV: process.env['NODE_ENV'],
    FIREBASE_PROJECT_ID: process.env['FIREBASE_PROJECT_ID'],
    FIREBASE_CLIENT_EMAIL: process.env['FIREBASE_CLIENT_EMAIL'],
    FIREBASE_PRIVATE_KEY: process.env['FIREBASE_PRIVATE_KEY'],
    SANDBOX_AUTH_SECRET: process.env['SANDBOX_AUTH_SECRET'],
  });

  const app = createSpineApp({ db, verifier: session.verifier, sandboxSecret: session.sandboxSecret });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = join(process.cwd(), 'dist');
    const indexHtml = join(distDir, 'index.html');
    app.use(express.static(distDir));
    app.get('{*splat}', (_req: Request, res: Response, next) => {
      if (!existsSync(indexHtml)) {
        next();
        return;
      }
      res.sendFile(indexHtml);
    });
  }

  app.listen(port, host, () => {
    process.stdout.write(
      `${JSON.stringify({
        event: 'server_started',
        host,
        port,
        milestone: 'M1',
        mode: isProd ? 'production' : 'development',
        database: db.driver,
        session: session.note,
      })}\n`,
    );
  });
}

startServer().catch((err: unknown) => {
  process.stderr.write(`Server startup failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
