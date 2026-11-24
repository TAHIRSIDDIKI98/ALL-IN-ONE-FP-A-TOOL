import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

const SANDBOX_HOME_DOTDIRS = new Set(['.npm', '.cache', '.local', '.arena', '.vite', '.playwright-cli']);

const ALLOWED_ROOT_ENTRIES = new Set([
  '.env.example',
  '.git',
  '.github',
  '.gitignore',
  'AGENTS.md',
  'CHANGELOG.md',
  'CLAUDE.md',
  'GEMINI.md',
  'LICENSE',
  'MASTER_PROMPT.md',
  'README.md',
  'SPEC.md',
  'TASKBOARD.md',
  'THIRD_PARTY_LICENSES.md',
  'core',
  'db',
  'dist',
  'docs',
  'e2e',
  'fixtures',
  'index.html',
  'node_modules',
  'package-lock.json',
  'package.json',
  'playwright-report',
  'scripts',
  'server',
  'shared',
  'src',
  'test-results',
  'tsconfig.json',
  'vite.config.ts',
]);

const BANNED_TRACKERS = [
  'KANBAN.json',
  'remediation-ledger.json',
  'compliance-evidence.json',
  'PROGRESS_TRACKER.html',
];

describe('WI-0001 Repository Layout & Constitutional Artifacts (S1, PR1, PR5)', () => {
  it('contains all required root documents and directories with zero stray trackers', () => {
    const entries = readdirSync(ROOT);
    for (const entry of entries) {
      if (SANDBOX_HOME_DOTDIRS.has(entry)) continue;
      expect(
        ALLOWED_ROOT_ENTRIES.has(entry),
        `Unexpected root entry "${entry}" violates MASTER_PROMPT §3.3 / §8.1`,
      ).toBe(true);
    }
    for (const req of [
      'MASTER_PROMPT.md',
      'SPEC.md',
      'TASKBOARD.md',
      'README.md',
      'AGENTS.md',
      'GEMINI.md',
      'CLAUDE.md',
      '.env.example',
      '.gitignore',
      'package.json',
      'tsconfig.json',
      'vite.config.ts',
      '.github/workflows/ci.yml',
      'core',
      'shared',
      'server',
      'src',
      'db',
      'fixtures',
      'e2e',
      'scripts',
    ]) {
      expect(existsSync(join(ROOT, req)), `Missing required path: ${req}`).toBe(true);
    }
    for (const banned of BANNED_TRACKERS) {
      expect(existsSync(join(ROOT, banned))).toBe(false);
    }
  });

  it('enforces exact pointer content in AGENTS.md, GEMINI.md, and CLAUDE.md (§1.1)', () => {
    const expected = 'Read MASTER_PROMPT.md fully before any action.';
    for (const file of ['AGENTS.md', 'GEMINI.md', 'CLAUDE.md']) {
      const text = readFileSync(join(ROOT, file), 'utf8').trim();
      expect(text).toBe(expected);
    }
  });

  it('pins exact dependency versions with no caret/tilde/latest ranges (§3.7)', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, version] of Object.entries(allDeps)) {
      expect(version, `${name} must use exact version, got ${version}`).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('configures CI to always upload diagnostic artifacts even on failure (PR5)', () => {
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain('if: always()');
    expect(ci).toContain('actions/upload-artifact@v4');
    expect(ci).toContain("node-version: '22'");
  });
});
