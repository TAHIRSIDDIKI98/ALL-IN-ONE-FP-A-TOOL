#!/usr/bin/env node
/**
 * No Native Dependencies Gate (MASTER_PROMPT §3.7, Gate S8, SEC9).
 *
 * Bans native/node-gyp/Rust/Tauri/sql.js packages in package.json and package-lock.json,
 * and enforces exact version pinning in package.json.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BANNED_PACKAGES = new Set([
  'bcrypt',
  'sharp',
  'canvas',
  'sqlite3',
  'better-sqlite3',
  'node-gyp',
  'sql.js',
  '@tauri-apps/api',
  '@tauri-apps/cli',
]);

export function checkNoNativeDeps(rootDir = process.cwd()) {
  const violations = [];
  const pkgPath = join(rootDir, 'package.json');
  if (!existsSync(pkgPath)) {
    return { violations: ['Missing package.json'] };
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const allDirect = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

  for (const [name, version] of Object.entries(allDirect)) {
    if (BANNED_PACKAGES.has(name)) {
      violations.push(`package.json contains banned native/blacklisted package "${name}"`);
    }
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
      violations.push(`package.json dependency "${name}" must pin an exact x.y.z version, got "${version}"`);
    }
  }

  const lockPath = join(rootDir, 'package-lock.json');
  if (!existsSync(lockPath)) {
    violations.push('Missing package-lock.json (§3.7 requires committed lockfile)');
  } else {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    const packages = lock.packages ?? {};
    for (const [pkgKey, meta] of Object.entries(packages)) {
      if (!pkgKey) continue;
      const cleanName = pkgKey.replace(/^.*node_modules\//, '');
      if (BANNED_PACKAGES.has(cleanName)) {
        violations.push(`package-lock.json resolves banned package "${cleanName}" (${pkgKey})`);
      }
      if (meta && typeof meta === 'object' && meta.gypfile === true) {
        violations.push(`package-lock.json package "${cleanName}" requires node-gyp (gypfile: true)`);
      }
    }
  }

  return { violations };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rootArgIdx = process.argv.indexOf('--root');
  const root = rootArgIdx !== -1 && process.argv[rootArgIdx + 1] ? process.argv[rootArgIdx + 1] : process.cwd();
  const { violations } = checkNoNativeDeps(root);
  if (violations.length > 0) {
    console.error(`NO-NATIVE-DEPS FAILED (${violations.length} violation(s)):`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    process.exit(1);
  }
  console.log('✓ no-native-deps green (exact versions pinned, lockfile clean, 0 native/blacklisted modules).');
}
