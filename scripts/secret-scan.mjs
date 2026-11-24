#!/usr/bin/env node
/**
 * Secret Scan Gate (MASTER_PROMPT §3.5, §10.2, Gates S8, SEC3, SEC4).
 *
 * Fails if:
 *  - `.env` (or `.env.*` other than `.env.example`) is tracked or present with real secrets
 *  - High-entropy / known credential patterns appear in source or built `dist/`
 *  - Server-only secret identifiers (`GEMINI_API_KEY`, `FIREBASE_PRIVATE_KEY`, `DATABASE_URL`)
 *    appear in `/src` or built client assets (`dist/`).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const SECRET_PATTERNS = [
  { name: 'Google/Gemini API Key', re: /AIza[0-9A-Za-z\-_]{35}/ },
  { name: 'GitHub PAT', re: /gh[pousr]_[A-Za-z0-9_]{30,}/ },
  { name: 'Slack Token', re: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
  { name: 'AWS Access Key', re: /AKIA[0-9A-Z]{16}/ },
  {
    name: 'Real PEM Private Key',
    re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----(?![\s\S]{0,80}PLACEHOLDER_ONLY_DO_NOT_USE)/,
  },
  {
    name: 'Hardcoded Postgres Password URL',
    re: /postgres(?:ql)?:\/\/(?!placeholder_user:placeholder_password)[^/\s:@]+:[^/\s@]{8,}@/,
  },
];

const SERVER_ONLY_IDENTIFIERS = [
  'GEMINI_API_KEY',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_CLIENT_EMAIL',
  'DATABASE_URL',
];

const SKIP_DIRS = new Set(['node_modules', '.git', '.npm', '.cache', '.local', '.arena', 'playwright-report', 'test-results']);
const TEXT_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.sql', '.md', '.yml', '.yaml', '.html', '.css']);

export function scanSecrets(rootDir = process.cwd()) {
  const violations = [];

  if (!existsSync(join(rootDir, '.env.example'))) {
    violations.push('Missing required .env.example at repo root (§3.9 S8)');
  }
  if (existsSync(join(rootDir, '.gitignore'))) {
    const gi = readFileSync(join(rootDir, '.gitignore'), 'utf8');
    if (!gi.split('\n').some((l) => l.trim() === '.env')) {
      violations.push('.gitignore must explicitly ignore .env (§3.9 S8)');
    }
  } else {
    violations.push('Missing .gitignore at repo root');
  }

  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      const rel = relative(rootDir, full).replace(/\\/g, '/');
      if (entry === '.env' || (entry.startsWith('.env.') && entry !== '.env.example')) {
        violations.push(`${rel}: forbidden .env file present in workspace`);
        continue;
      }
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (TEXT_EXTS.has(extname(entry)) || entry === '.env.example') {
        if (rel === 'scripts/secret-scan.mjs' || rel === 'scripts/gates.test.ts') continue;
        const content = readFileSync(full, 'utf8');
        for (const { name, re } of SECRET_PATTERNS) {
          if (re.test(content)) {
            violations.push(`${rel}: detected ${name}`);
          }
        }
        if ((rel.startsWith('src/') || rel.startsWith('dist/')) && !rel.endsWith('.test.ts') && !rel.endsWith('.test.tsx')) {
          for (const key of SERVER_ONLY_IDENTIFIERS) {
            if (content.includes(key)) {
              violations.push(`${rel}: server-only secret identifier "${key}" leaked into client source/bundle`);
            }
          }
        }
      }
    }
  };

  walk(rootDir);
  return { violations };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rootArgIdx = process.argv.indexOf('--root');
  const root = rootArgIdx !== -1 && process.argv[rootArgIdx + 1] ? process.argv[rootArgIdx + 1] : process.cwd();
  const { violations } = scanSecrets(root);
  if (violations.length > 0) {
    console.error(`SECRET SCAN FAILED (${violations.length} violation(s)):`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    process.exit(1);
  }
  console.log('✓ secret-scan green (0 leaks, .env.example present, client bundle clean).');
}
