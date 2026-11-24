#!/usr/bin/env node
/**
 * Master Sandbox Verification Runner (`npm run verify`)
 * MASTER_PROMPT §3.6, §3.8, §8.7, §10.1.
 *
 * Runs every sandbox gate in sequence with zero external secrets and zero
 * network credentials, asserting total elapsed time < 60s.
 */
import { spawnSync } from 'node:child_process';

const BUDGET_MS = 60_000;

const STEPS = [
  { id: 'typecheck', cmd: 'npx', args: ['tsc', '--noEmit'] },
  { id: 'core-purity', cmd: 'node', args: ['scripts/core-purity.mjs'] },
  { id: 'money-ast', cmd: 'node', args: ['scripts/money-ast.mjs'] },
  { id: 'tautology', cmd: 'node', args: ['scripts/tautology.mjs'] },
  { id: 'fabrication', cmd: 'node', args: ['scripts/fabrication.mjs'] },
  { id: 'readme-claims', cmd: 'node', args: ['scripts/readme-claims.mjs'] },
  { id: 'constitution', cmd: 'node', args: ['scripts/constitution-check.mjs'] },
  { id: 'licenses', cmd: 'node', args: ['scripts/license-check.mjs'] },
  { id: 'work-integrity', cmd: 'node', args: ['scripts/work-integrity.mjs'] },
  { id: 'no-native-deps', cmd: 'node', args: ['scripts/no-native-deps.mjs'] },
  { id: 'schema-scope', cmd: 'node', args: ['scripts/schema-scope.mjs'] },
  { id: 'vitest', cmd: 'npx', args: ['vitest', 'run'] },
  { id: 'build', cmd: 'npx', args: ['vite', 'build'] },
  { id: 'bundle-size', cmd: 'node', args: ['scripts/bundle-size.mjs'] },
  { id: 'secret-scan', cmd: 'node', args: ['scripts/secret-scan.mjs'] },
];

const startedAt = Date.now();
const cleanEnv = {
  PATH: process.env.PATH ?? '',
  HOME: process.env.HOME ?? '/home/user',
  NODE_ENV: 'test',
  CI: 'true',
};

const summary = [];
let failed = false;

for (const step of STEPS) {
  const stepStart = Date.now();
  const res = spawnSync(step.cmd, step.args, {
    cwd: process.cwd(),
    env: cleanEnv,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  const durationMs = Date.now() - stepStart;
  const ok = res.status === 0;
  summary.push({ id: step.id, ok, exitCode: res.status ?? 1, durationMs });

  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${step.id.padEnd(16)} (${durationMs}ms)`);
  if (!ok) {
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    failed = true;
    break;
  }
}

const totalMs = Date.now() - startedAt;
if (!failed && totalMs > BUDGET_MS) {
  console.error(`VERIFY BUDGET EXCEEDED: ${totalMs}ms > ${BUDGET_MS}ms (§3.8)`);
  process.exit(1);
}

if (failed) {
  console.error(`\nVERIFY FAILED after ${totalMs}ms — STOP-THE-LINE (§8.7).`);
  process.exit(1);
}

console.log(`\nVERIFY GREEN: ${summary.length}/${STEPS.length} gates passed in ${totalMs}ms (<60000ms budget, 0 secrets).`);
