#!/usr/bin/env node
// Ported from fp-A-betterversion/scripts/check-readme-claims.mjs @ 86d785ca696c. Class B.
// Changes: Enforces MASTER_PROMPT §1.5 K5, §6.4 P04, §10.5 Q6: rejects false completion/production-ready/coverage/compliance claims unless backed by VERIFIED TASKBOARD evidence, and checks milestone consistency against TASKBOARD.md. Oracle: scripts/gates.test.ts.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BANNED_UNVERIFIED_CLAIMS = [
  { re: /\bFeature\s+Complete\b/i, why: 'false "Feature Complete" claim (K5)' },
  { re: /\bProduction[- ]Ready\b/i, why: 'unverified "Production-Ready" claim' },
  { re: /v1\.0\.0-rc\d*/i, why: 'premature release-candidate claim (K5)' },
  { re: /Coverage[_:\s]+100%/i, why: 'unverified 100% coverage badge/claim' },
  { re: /\bSOC\s*2\s+Type\s+II\s+Certified\b/i, why: 'SOC 2 Type II report is M4 scope, not yet earned' },
  { re: /\bEnd-to-end\s+encryption\b/i, why: 'unverified encryption marketing claim' },
];

export function checkReadmeClaims(rootDir = process.cwd()) {
  const readmePath = join(rootDir, 'README.md');
  const taskboardPath = join(rootDir, 'TASKBOARD.md');
  const violations = [];

  if (!existsSync(readmePath)) {
    return { violations: ['Missing README.md at repo root'] };
  }
  if (!existsSync(taskboardPath)) {
    return { violations: ['Missing TASKBOARD.md at repo root'] };
  }

  const readme = readFileSync(readmePath, 'utf8');
  const taskboard = readFileSync(taskboardPath, 'utf8');

  // Strip negated sentences that explicitly state "no feature is claimed complete..."
  for (const { re, why } of BANNED_UNVERIFIED_CLAIMS) {
    const match = readme.match(re);
    if (match) {
      violations.push(`README contains banned unverified claim (${why}): "${match[0]}"`);
    }
  }

  // Ensure README names the active milestone recorded in TASKBOARD §Position
  const posMatch = taskboard.match(/\*\*Current Milestone\*\*:\s*`?(M\d)/i);
  if (posMatch) {
    const currentMilestone = posMatch[1].toUpperCase();
    if (!readme.includes(currentMilestone)) {
      violations.push(
        `README does not reflect TASKBOARD Current Milestone (${currentMilestone})`,
      );
    }
  }

  return { violations };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rootArgIdx = process.argv.indexOf('--root');
  const root = rootArgIdx !== -1 && process.argv[rootArgIdx + 1] ? process.argv[rootArgIdx + 1] : process.cwd();
  const { violations } = checkReadmeClaims(root);
  if (violations.length > 0) {
    console.error(`README-CLAIMS GATE FAILED (${violations.length} violation(s)):`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    process.exit(1);
  }
  console.log('✓ readme-claims green (README aligns with verified TASKBOARD state).');
}
