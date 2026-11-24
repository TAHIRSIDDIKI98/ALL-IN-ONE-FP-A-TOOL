import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Request, type Response } from 'express';
import { createSpineApp } from './app.js';

async function startServer(): Promise<void> {
  const port = Number.parseInt(process.env['PORT'] ?? '3000', 10);
  const host = process.env['HOST'] ?? '0.0.0.0';
  const isProd = process.env['NODE_ENV'] === 'production';

  const app = createSpineApp();

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
      `${JSON.stringify({ event: 'server_started', host, port, milestone: 'M0', mode: isProd ? 'production' : 'development' })}\n`,
    );
  });
}

startServer().catch((err: unknown) => {
  process.stderr.write(`Server startup failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
