#!/usr/bin/env node
/**
 * Promotes Playwright failure output to GitHub check-run annotations.
 *
 * Why this exists: the workflow already uploads `playwright-report/` and `test-results/` as
 * artifacts (PR5), but artifact blobs are served from a storage host that is not reachable from
 * every build environment, which makes a red E2E job undiagnosable. Check-run annotations are
 * served by the API itself, so on failure we re-emit the harness's own error lines here.
 *
 * Usage: node scripts/publish-e2e-failure.mjs [logfile]
 * Writes `::error::` workflow commands to stdout (no network access, no secrets).
 */
import { readFileSync } from 'node:fs';

const MAX_ANNOTATIONS = 8;
const MAX_MESSAGE = 900;

const escapeCommand = (value) =>
  value
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, ' ');

const path = process.argv[2] ?? 'playwright-output.log';
let raw = '';
try {
  raw = readFileSync(path, 'utf8');
} catch (error) {
  console.log(`::error title=E2E log missing::${escapeCommand(String(error?.message ?? error))}`);
  process.exit(0);
}

const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');
const lines = raw.replace(ansi, '').split('\n').map((line) => line.trimEnd());
const nonEmpty = lines.filter((line) => line.trim().length > 0);

const interesting = /(\bError\b|\bExpected\b|\bReceived\b|Timeout \d|Process from config|not able to start|exited early|page\.|locator|waiting for|at .*\.spec\.ts:|›.*›|\bexpect\()/i;
const signal = nonEmpty.filter((line) => interesting.test(line));
const picked = [];
for (const line of signal) {
  const trimmed = line.trim();
  if (picked.includes(trimmed)) continue;
  picked.push(trimmed);
  if (picked.length >= MAX_ANNOTATIONS) break;
}
if (picked.length === 0) {
  for (const line of nonEmpty.slice(-MAX_ANNOTATIONS)) picked.push(line.trim());
}

console.log('::group::Playwright failure digest');
for (const line of picked) {
  console.log(line);
}
console.log('::endgroup::');

for (const line of picked) {
  console.log(`::error title=Playwright E2E::${escapeCommand(line.slice(0, MAX_MESSAGE))}`);
}
