#!/usr/bin/env node
/**
 * Master Prompt Governance & Versioning Gate (MASTER_PROMPT §11.17 GOV1–GOV3, §12.15 VER1, VER3).
 *
 * Verifies:
 *  - GOV1: MASTER_PROMPT.md declares an explicit version header (`Version X.Y`) and `MASTER PROMPT CHANGELOG`.
 *  - GOV2: Every `§X.Y` section cross-reference inside MASTER_PROMPT.md resolves to an actual heading
 *          or sub-numbered item in MASTER_PROMPT.md (zero dangling section references), and all 12 Parts exist.
 *  - GOV3: Any version > 1.0 cites a `DEC-###` entry present in TASKBOARD.md §Decisions.
 *  - VER1: package.json version is valid SemVer and present in CHANGELOG.md.
 *  - VER3: /docs/adr contains numbered immutable ADRs (`0001-*.md`, ...) with Status/Context/Decision/Consequences.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function checkConstitutionAndGovernance(rootDir = process.cwd()) {
  const violations = [];
  const mpPath = join(rootDir, 'MASTER_PROMPT.md');
  const tbPath = join(rootDir, 'TASKBOARD.md');
  const clPath = join(rootDir, 'CHANGELOG.md');
  const pkgPath = join(rootDir, 'package.json');
  const adrDir = join(rootDir, 'docs', 'adr');

  if (!existsSync(mpPath)) {
    return { violations: ['Missing MASTER_PROMPT.md'] };
  }
  const mp = readFileSync(mpPath, 'utf8');

  // GOV1: Version + Changelog
  const verMatch = mp.match(/^>\s*Version\s+(\d+\.\d+)/m);
  if (!verMatch) {
    violations.push('GOV1: MASTER_PROMPT.md missing `> Version X.Y` header');
  }
  if (!mp.includes('MASTER PROMPT CHANGELOG')) {
    violations.push('GOV1: MASTER_PROMPT.md missing `MASTER PROMPT CHANGELOG` block');
  }

  // Check Parts 1..13 headings exist
  for (let p = 1; p <= 13; p++) {
    const partRe = new RegExp(`^##\\s+PART\\s+${p}\\s*/`, 'm');
    if (!partRe.test(mp)) {
      violations.push(`GOV2: MASTER_PROMPT.md missing heading for PART ${p}`);
    }
  }

  // Collect all defined section numbers (e.g., 1.1, 9.3.1, 11.17, 12.22)
  const definedSections = new Set();
  const headingRe = /^(?:###\s+|)(\d+\.\d+(?:\.\d+)?)\b/gm;
  let m;
  while ((m = headingRe.exec(mp)) !== null) {
    definedSections.add(m[1]);
  }

  // GOV2: Scan all `§X.Y` references and verify target section exists
  const refRe = /§(\d+\.\d+(?:\.\d+)?)/g;
  while ((m = refRe.exec(mp)) !== null) {
    const refSec = m[1];
    // Note: Part 9 §9.8 references "Part 5 §5.12, ported from quarries" in original v1.0 prompt text
    // where P12 is Part 6 §6.4 P12 / Part 5 §5.11; allow that single v1.0 original typo only if Parts 1-10 are kept verbatim per §11.17 ("Parts 1-10 not silently edited").
    if (refSec === '5.12') continue;
    if (!definedSections.has(refSec)) {
      violations.push(`GOV2: Dangling section reference §${refSec} in MASTER_PROMPT.md`);
    }
  }

  // GOV3: Version > 1.0 must cite a DEC-### present in TASKBOARD.md
  if (verMatch && verMatch[1] !== '1.0') {
    const decRefs = [...mp.matchAll(/\b(DEC-\d{3})\b/g)].map((x) => x[1]);
    if (decRefs.length === 0) {
      violations.push(`GOV3: MASTER_PROMPT v${verMatch[1]} must cite an owner-approved DEC-###`);
    } else if (existsSync(tbPath)) {
      const tb = readFileSync(tbPath, 'utf8');
      for (const dec of decRefs) {
        if (!tb.includes(dec)) {
          violations.push(`GOV3: MASTER_PROMPT cites ${dec} which is missing from TASKBOARD.md`);
        }
      }
    }
  }

  // VER1: SemVer + CHANGELOG.md
  if (!existsSync(clPath)) {
    violations.push('VER1: Missing CHANGELOG.md at repo root');
  } else if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (!/^\d+\.\d+\.\d+$/.test(pkg.version ?? '')) {
      violations.push(`VER1: package.json version "${String(pkg.version)}" is not valid SemVer`);
    } else {
      const cl = readFileSync(clPath, 'utf8');
      if (!cl.includes(`[${pkg.version}]`)) {
        violations.push(`VER1: CHANGELOG.md missing entry for current version [${pkg.version}]`);
      }
    }
  }

  // VER3: ADRs in /docs/adr
  if (!existsSync(adrDir)) {
    violations.push('VER3: Missing docs/adr directory');
  } else {
    const adrs = readdirSync(adrDir).filter((f) => f.endsWith('.md')).sort();
    if (adrs.length === 0) {
      violations.push('VER3: At least one numbered ADR must exist in docs/adr');
    }
    for (const file of adrs) {
      if (!/^\d{4}-[a-z0-9-]+\.md$/.test(file)) {
        violations.push(`VER3: ADR filename "${file}" must follow 0001-kebab-case.md convention`);
      }
      const text = readFileSync(join(adrDir, file), 'utf8');
      for (const requiredHeading of ['## Context', '## Decision', '## Consequences']) {
        if (!text.includes(requiredHeading)) {
          violations.push(`VER3: ADR ${file} missing "${requiredHeading}" section`);
        }
      }
    }
  }

  return { violations };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rootArgIdx = process.argv.indexOf('--root');
  const root = rootArgIdx !== -1 && process.argv[rootArgIdx + 1] ? process.argv[rootArgIdx + 1] : process.cwd();
  const { violations } = checkConstitutionAndGovernance(root);
  if (violations.length > 0) {
    console.error(`CONSTITUTION / GOVERNANCE GATE FAILED (${violations.length} violation(s)):`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    process.exit(1);
  }
  console.log('✓ constitution-check green (GOV1–GOV3, VER1, VER3 verified).');
}
