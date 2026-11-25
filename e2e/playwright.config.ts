import { defineConfig } from '@playwright/test';

const PORT = 3000;
const SANDBOX_SECRET = 'e2e-sandbox-secret-long-enough-for-hmac';

/**
 * The harness drives the REAL spine application (Express + Vite middleware + PGlite), not a static
 * preview of the shell: since WI-0019/0020 the screens call the API, so an E2E run without a server
 * and without SANDBOX_AUTH_SECRET could only ever fail. One server instance, one in-memory database.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 45_000,
  fullyParallel: false,
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: '../playwright-report', open: 'never' }]],
  outputDir: '../test-results',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx tsx server/index.ts`,
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
    env: {
      CI: process.env['CI'] ?? 'false',
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: String(PORT),
      SANDBOX_AUTH_SECRET: SANDBOX_SECRET,
    },
  },
});
