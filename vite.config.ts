import { cpus } from 'node:os';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const VITEST_MAX_FORKS = Math.min(3, Math.max(2, cpus().length - 1));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/scheduler/') ||
            id.includes('commonjsHelpers')
          ) {
            return 'react-vendor';
          }
          if (id.includes('ag-grid')) return 'ag-grid';
          if (id.includes('exceljs') || id.includes('pdfmake')) return 'exports';
          if (id.includes('firebase')) return 'firebase';
          return undefined;
        },
      },
    },
  },
  test: {
    include: [
      'core/**/*.test.ts',
      'shared/**/*.test.ts',
      'server/**/*.test.ts',
      'db/**/*.test.ts',
      'fixtures/**/*.test.ts',
      'scripts/**/*.test.ts',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
    ],
    exclude: ['node_modules/**', 'dist/**', 'e2e/**'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    // Scale fork pool to available vCPUs (2 on 2-vCPU CI runners, up to 4 on 4-vCPU sandboxes).
    pool: 'forks',
    poolOptions: { forks: { maxForks: VITEST_MAX_FORKS, minForks: 1 } },
  },
});
