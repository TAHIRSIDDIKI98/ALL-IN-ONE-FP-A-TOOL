#!/usr/bin/env node
/**
 * Master Sandbox Verification Runner (`npm run verify`)
 * MASTER_PROMPT §3.6, §3.8, §8.7, §10.1.
 *
 * Runs every sandbox gate with zero external secrets and zero network credentials,
 * enforcing STOP-THE-LINE on any failure and asserting total elapsed time < 60s.
 */
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';

const BUDGET_MS = 60_000;
const CAN_OVERLAP_TYPECHECK = cpus().length >= 4;

const STATIC_READONLY_STEPS = [
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
];

const POST_TEST_STEPS = [
  { id: 'build', cmd: './node_modules/.bin/vite', args: ['build'] },
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

function runStepAsync(step) {
  return new Promise((resolve) => {
    const stepStart = Date.now();
    const child = spawn(step.cmd, step.args, {
      cwd: process.cwd(),
      env: cleanEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('close', (code) => {
      resolve({
        id: step.id,
        ok: code === 0,
        exitCode: code ?? 1,
        durationMs: Date.now() - stepStart,
        stdout,
        stderr,
      });
    });
  });
}

function printResult(res) {
  const mark = res.ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${res.id.padEnd(16)} (${res.durationMs}ms)`);
  if (!res.ok) {
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
  }
}

const summary = [];
let failed = false;

// Phase 1: run read-only static AST checks + schema-parity alongside the isolated dist/ build chain
// (build -> bundle-size -> secret-scan) BEFORE Vitest starts so dist/ is built and quiescent.
// On <4 vCPU hosts, typecheck also runs in Phase 1 so Vitest never competes for CPU during timing assertions.
const phase1Tasks = [
  runStepAsync({ id: 'schema-parity', cmd: './node_modules/.bin/tsx', args: ['scripts/schema-parity.ts'] }),
  (async () => {
    const out = [];
    for (const step of STATIC_READONLY_STEPS) {
      const res = await runStepAsync(step);
      out.push(res);
      if (!res.ok) break;
    }
    return out;
  })(),
  (async () => {
    const out = [];
    for (const step of POST_TEST_STEPS) {
      const res = await runStepAsync(step);
      out.push(res);
      if (!res.ok) break;
    }
    return out;
  })(),
];
if (!CAN_OVERLAP_TYPECHECK) {
  phase1Tasks.push(runStepAsync({ id: 'typecheck', cmd: './node_modules/.bin/tsc', args: ['--noEmit'] }));
}

const [schemaParityRes, staticResults, buildChainResults, phase1TypecheckRes] = await Promise.all(phase1Tasks);

const phase1Ordered = [
  ...(phase1TypecheckRes ? [phase1TypecheckRes] : []),
  ...staticResults,
  schemaParityRes,
  ...buildChainResults,
];
for (const res of phase1Ordered) {
  summary.push(res);
  printResult(res);
  if (!res.ok) {
    failed = true;
    break;
  }
}

// Phase 2: Vitest (on >=4 vCPU hosts, 3 Vitest forks + 1 typecheck = 4 cores, zero oversubscription).
if (!failed) {
  const phase2Tasks = [runStepAsync({ id: 'vitest', cmd: './node_modules/.bin/vitest', args: ['run'] })];
  if (CAN_OVERLAP_TYPECHECK) {
    phase2Tasks.unshift(runStepAsync({ id: 'typecheck', cmd: './node_modules/.bin/tsc', args: ['--noEmit'] }));
  }
  const phase2Results = await Promise.all(phase2Tasks);
  for (const res of phase2Results) {
    summary.push(res);
    printResult(res);
    if (!res.ok) {
      failed = true;
      break;
    }
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

console.log(`\nVERIFY GREEN: ${summary.length}/16 gates passed in ${totalMs}ms (<60000ms budget, 0 secrets).`);
