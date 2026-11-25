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
const title = process.argv[3] ?? 'Playwright E2E';
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

// Ordered by how much a reader needs the line: the assertion detail first, the test titles last
// (titles are already visible in the job summary, so they must never crowd out the real message).
const TIERS = [
  /^(?:\[FAIL\]|FAIL\b|VERIFY RED|WORK-INTEGRITY GATE FAILED|✗|AssertionError|Expected|Received|Error:|Locator:|Call log:|waiting for|Timeout \d+ms|\(retry #\d+\))/i,
  /(?:Expected (?:string|value)|Received (?:string|value)|ERR_MODULE|Cannot find module|Process from config|exited early|webServer|S-COMMIT .*(?:must|failed)|Test Files|\bTests\s+\d+ failed|AssertionError|expected .* to (?:be|contain)|unhandled error)/i,
  /(?:at .*\.spec\.ts:\d+:\d+|›.*\d+:\d+)/,
  /(?:✘|✓|\[PASS\]|\bfailed\b|\bnot able to start\b)/i,
];

const picked = [];
const seen = new Set();
const push = (line) => {
  const trimmed = line.trim();
  if (!trimmed || seen.has(trimmed)) return;
  seen.add(trimmed);
  picked.push(trimmed);
};

for (const tier of TIERS) {
  for (const line of nonEmpty) {
    if (picked.length >= MAX_ANNOTATIONS) break;
    if (tier.test(line.trim())) push(line);
  }
}
if (picked.length === 0) {
  for (const line of nonEmpty.slice(-MAX_ANNOTATIONS)) push(line);
}

console.log(`::group::${title} failure digest`);
for (const line of picked) {
  console.log(line);
}
console.log('::endgroup::');

for (const line of picked) {
  console.log(`::error title=${title}::${escapeCommand(line.slice(0, MAX_MESSAGE))}`);
}
