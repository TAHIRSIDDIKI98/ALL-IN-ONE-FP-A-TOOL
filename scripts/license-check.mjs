#!/usr/bin/env node
/**
 * License & Dependency Compliance Gate (MASTER_PROMPT §12.16 LIC1–LIC3).
 *
 * Scans package-lock.json + installed package manifests:
 *  - LIC1: Every dependency resolves to an allow-listed permissive/weak-copyleft license
 *  - LIC2: THIRD_PARTY_LICENSES.md exists and matches exact dependency count & hashes
 *  - LIC3: Fails on disallowed strong-copyleft (GPL/AGPL/SSPL without permissive dual-OR) or unknown licenses.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED_LICENSES = new Set([
  'MIT',
  'MIT/X11',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Unlicense',
  'BlueOak-1.0.0',
  'MPL-2.0',
  'CC-BY-4.0',
  'CC0-1.0',
  'Python-2.0',
  'Zlib',
  '(MIT AND Zlib)',
  '(MIT OR Apache-2.0)',
  '(MIT OR CC0-1.0)',
  '(BSD-2-Clause OR MIT OR Apache-2.0)',
  '(MIT OR GPL-3.0-or-later)', // Dual-licensed: elected under MIT
]);

// Verified legacy npm packages whose `package.json` uses legacy `licenses` array or public-domain/MIT README
const VERIFIED_LEGACY_OVERRIDES = {
  'buffers@0.1.1': 'MIT/X11 (James Halliday — verified legacy npm package)',
  'limiter@1.1.5': 'MIT (legacy `licenses` array field in package.json)',
};

function resolvePackageLicense(pkgKey, meta, rootDir) {
  if (typeof meta.license === 'string' && meta.license.trim().length > 0) {
    return meta.license.trim();
  }
  const name = pkgKey.replace(/^.*node_modules\//, '');
  const id = `${name}@${meta.version ?? ''}`;
  if (VERIFIED_LEGACY_OVERRIDES[id]) {
    return 'MIT';
  }
  const diskPkgPath = join(rootDir, pkgKey, 'package.json');
  if (existsSync(diskPkgPath)) {
    const diskPkg = JSON.parse(readFileSync(diskPkgPath, 'utf8'));
    if (typeof diskPkg.license === 'string' && diskPkg.license.trim()) {
      return diskPkg.license.trim();
    }
    if (Array.isArray(diskPkg.licenses) && diskPkg.licenses[0]?.type) {
      return String(diskPkg.licenses[0].type).trim();
    }
  }
  return 'UNKNOWN';
}

export function generateAttributionMarkdown(entries) {
  const digest = createHash('sha256')
    .update(JSON.stringify(entries))
    .digest('hex')
    .slice(0, 16);

  const lines = [
    '# Third-Party Dependency Licenses',
    '',
    `> Generated deterministically from \`package-lock.json\` (\`MASTER_PROMPT §12.16 LIC2\`).`,
    `> Packages: **${entries.length}** · Manifest Digest: \`${digest}\``,
    '',
    '| Package | Version | License |',
    '|---|---|---|',
    ...entries.map((e) => `| \`${e.name}\` | \`${e.version}\` | \`${e.license}\` |`),
    '',
  ];
  return lines.join('\n');
}

export function checkLicenses(rootDir = process.cwd(), { writeAttribution = false } = {}) {
  const violations = [];
  const repoLicensePath = join(rootDir, 'LICENSE');
  const lockPath = join(rootDir, 'package-lock.json');
  const attrPath = join(rootDir, 'THIRD_PARTY_LICENSES.md');

  if (!existsSync(repoLicensePath)) {
    violations.push('LIC1: Missing root LICENSE file');
  }
  if (!existsSync(lockPath)) {
    return { count: 0, violations: [...violations, 'LIC1: Missing package-lock.json'] };
  }

  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const packages = lock.packages ?? {};
  const map = new Map();

  for (const [pkgKey, meta] of Object.entries(packages)) {
    if (!pkgKey) continue; // skip root ''
    const name = pkgKey.replace(/^.*node_modules\//, '');
    const version = String(meta.version ?? '0.0.0');
    const license = resolvePackageLicense(pkgKey, meta, rootDir);

    if (!ALLOWED_LICENSES.has(license)) {
      violations.push(`LIC3: Disallowed or unknown license "${license}" on ${name}@${version}`);
    }
    map.set(`${name}@${version}`, { name, version, license });
  }

  const sortedEntries = [...map.values()].sort((a, b) =>
    a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name),
  );
  const expectedMd = generateAttributionMarkdown(sortedEntries);

  if (writeAttribution) {
    writeFileSync(attrPath, expectedMd);
  } else if (!existsSync(attrPath)) {
    violations.push('LIC2: Missing THIRD_PARTY_LICENSES.md (run `node scripts/license-check.mjs --write`)');
  } else {
    const actualMd = readFileSync(attrPath, 'utf8');
    if (actualMd !== expectedMd) {
      violations.push('LIC2: THIRD_PARTY_LICENSES.md is out of sync with package-lock.json');
    }
  }

  return { count: sortedEntries.length, violations };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rootArgIdx = process.argv.indexOf('--root');
  const root = rootArgIdx !== -1 && process.argv[rootArgIdx + 1] ? process.argv[rootArgIdx + 1] : process.cwd();
  const writeAttribution = process.argv.includes('--write');
  const { count, violations } = checkLicenses(root, { writeAttribution });
  if (violations.length > 0) {
    console.error(`LICENSE COMPLIANCE GATE FAILED (${violations.length} violation(s)):`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    process.exit(1);
  }
  console.log(`✓ license-check green (${count} unique dependency versions verified, attribution current).`);
}
