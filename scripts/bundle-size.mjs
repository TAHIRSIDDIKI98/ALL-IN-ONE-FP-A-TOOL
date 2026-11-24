#!/usr/bin/env node
/**
 * Bundle Size Gate (MASTER_PROMPT §3.8, Gate Q5).
 *
 * Enforces initial entry JS bundle < 250 KB gzip.
 * AG Grid, export libraries, and heavy routes must remain lazy-loaded.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const MAX_INITIAL_GZIP_BYTES = 250 * 1024;

export function checkBundleSize(rootDir = process.cwd()) {
  const indexHtmlPath = join(rootDir, 'dist', 'index.html');
  const assetsDir = join(rootDir, 'dist', 'assets');
  const violations = [];

  if (!existsSync(indexHtmlPath) || !existsSync(assetsDir)) {
    return { initialGzipBytes: 0, violations: ['dist/ build output not found; run `npm run build` first'] };
  }

  const html = readFileSync(indexHtmlPath, 'utf8');
  const entryRefs = [];
  const scriptRe = /src="\/?assets\/([^"]+\.js)"/g;
  const preloadRe = /rel="modulepreload"[^>]*href="\/?assets\/([^"]+\.js)"/g;

  let m;
  while ((m = scriptRe.exec(html)) !== null) entryRefs.push(m[1]);
  while ((m = preloadRe.exec(html)) !== null) entryRefs.push(m[1]);

  const uniqueInitialFiles = [...new Set(entryRefs)];
  if (uniqueInitialFiles.length === 0) {
    // Fallback: check all index-*.js files
    for (const f of readdirSync(assetsDir)) {
      if (f.startsWith('index-') && f.endsWith('.js')) uniqueInitialFiles.push(f);
    }
  }

  let initialGzipBytes = 0;
  for (const file of uniqueInitialFiles) {
    const full = join(assetsDir, file);
    if (!existsSync(full)) {
      violations.push(`Referenced asset missing in dist/assets: ${file}`);
      continue;
    }
    const gz = gzipSync(readFileSync(full));
    initialGzipBytes += gz.byteLength;
  }

  if (initialGzipBytes > MAX_INITIAL_GZIP_BYTES) {
    violations.push(
      `Initial JS bundle is ${(initialGzipBytes / 1024).toFixed(2)} KB gzip, exceeding 250.00 KB budget (§3.8)`,
    );
  }

  return { initialGzipBytes, files: uniqueInitialFiles, violations };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rootArgIdx = process.argv.indexOf('--root');
  const root = rootArgIdx !== -1 && process.argv[rootArgIdx + 1] ? process.argv[rootArgIdx + 1] : process.cwd();
  const { initialGzipBytes, violations } = checkBundleSize(root);
  if (violations.length > 0) {
    console.error(`BUNDLE SIZE GATE FAILED:`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    process.exit(1);
  }
  console.log(
    `✓ bundle-size green (initial JS: ${(initialGzipBytes / 1024).toFixed(2)} KB gzip / 250.00 KB budget).`,
  );
}
