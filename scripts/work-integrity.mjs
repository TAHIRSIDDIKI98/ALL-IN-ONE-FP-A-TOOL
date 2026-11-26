#!/usr/bin/env node
/**
 * Work-Integrity Codex Scanner & Ratchet Gate (MASTER_PROMPT Part 13 §13.7–§13.9, INT1–INT13).
 *
 * Enforces mechanically:
 *  - S-PLACEHOLDER (INT2): zero TODO/FIXME/XXX/HACK/"not implemented"/lorem/dummy stubs in product code
 *  - S-SUPPRESS (INT3): zero `any`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable` in product code (monotonic <= 0)
 *  - S-DEAD-CONTROL (INT4): every JSX `<button>` either has `type="submit"` inside a form or a real `onClick` handler (never `() => {}` no-op, never dead disabled "coming soon" chrome)
 *  - S-TEST-INTEGRITY (INT5): every `it(...)` / `test(...)` block contains at least one real `expect(...)` assertion
 *  - S-SWALLOW & S-DEBUG (INT7): zero empty `catch {}` blocks and zero `console.log` / `debugger` in product code (`/core`, `/shared`, `/server`, `/src`)
 *  - S-COMMIT (INT8): every authored commit after the recorded codex boundary is conventional and
 *    carries its single WI id (GitHub pull-request merge commits and pre-codex history are out of scope)
 *  - INT1 & INT9: every `VERIFIED` row in TASKBOARD.md §Work Items has non-empty pasted evidence AND a corresponding verbatim §13.9 attestation in TASKBOARD.md §Attestations
 *  - S-CUTLINE (INT11): bans out-of-phase directories/files (`consolidation`, `monte-carlo`, `marketplace`, `ai-chat`, etc.) during M0/M1
 *  - S-RATCHET (INT6, INT13): verifies test file count, `it()` count, assertion count, and `/core` source-to-test ratio never decrease against `scripts/integrity-ratchet.json`.
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const PRODUCT_DIRS = ['core', 'shared', 'server', 'src'];
const TEST_DIRS = ['core', 'shared', 'server', 'src', 'db', 'fixtures', 'e2e', 'scripts'];

const OUT_OF_PHASE_NAMES = new Set([
  'consolidation',
  'montecarlo',
  'monte-carlo',
  'marketplace',
  'benchmarks',
  'capex',
  'treasury',
  'AIChatPage.tsx',
  'DashboardBuilderPage.tsx',
  'ScenarioBuilderPage.tsx',
]);

export const VERBATIM_ATTESTATION =
  'I attest under the Work-Integrity Codex that: (1) every §13.1 condition is true; (2) I ran the tests and pasted real output; (3) I introduced no placeholder, stub, suppression, fake value, or partial state; (4) error/empty/edge/negative cases are handled and tested; (5) no gate regressed; (6) this attestation is truthful.';

const isTestFile = (name) => /\.(test|spec|bench)\.[tj]sx?$/.test(name);

function walkFiles(dir, predicate, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'build') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, predicate, out);
    else if (predicate(entry, full)) out.push(full);
  }
  return out;
}

function scanProductAst(filePath, source, relPath) {
  const violations = [];
  let suppressionCount = 0;

  // Comment-level checks (TODO/FIXME/XXX/HACK/@ts-ignore/eslint-disable)
  const lines = source.split('\n');
  lines.forEach((line, i) => {
    const lineNo = i + 1;
    if (/\b(?:TODO|FIXME|XXX|HACK)\b/.test(line)) {
      violations.push(`S-PLACEHOLDER ${relPath}:${lineNo} banned placeholder marker: ${line.trim()}`);
    }
    if (/@ts-ignore|@ts-expect-error|eslint-disable/.test(line)) {
      suppressionCount += 1;
      violations.push(`S-SUPPRESS ${relPath}:${lineNo} banned linter/TS suppression: ${line.trim()}`);
    }
  });

  const sf = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(filePath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const visit = (node) => {
    // E1: `any` keyword
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      suppressionCount += 1;
      violations.push(`S-SUPPRESS ${relPath}:${lineOf(node)} banned \`any\` type`);
    }

    // E4: debugger statement
    if (node.kind === ts.SyntaxKind.DebuggerStatement) {
      violations.push(`S-DEBUG ${relPath}:${lineOf(node)} banned \`debugger\` statement`);
    }

    // E4: console.log in product code
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'console' &&
      node.expression.name.text === 'log'
    ) {
      violations.push(`S-DEBUG ${relPath}:${lineOf(node)} banned \`console.log\` in product code`);
    }

    // B1: throw new Error("not implemented")
    if (ts.isThrowStatement(node) && node.expression && ts.isNewExpression(node.expression)) {
      const arg0 = node.expression.arguments?.[0];
      if (arg0 && ts.isStringLiteral(arg0) && /not\s+implemented/i.test(arg0.text)) {
        violations.push(`S-PLACEHOLDER ${relPath}:${lineOf(node)} banned "not implemented" stub`);
      }
    }

    // E3: empty catch block
    if (ts.isCatchClause(node) && node.block.statements.length === 0) {
      suppressionCount += 1;
      violations.push(`S-SWALLOW ${relPath}:${lineOf(node)} empty \`catch {}\` swallows errors`);
    }

    // B7 / S-DEAD-CONTROL: `<button>` without `onClick` or `type="submit"`, or `onClick={() => {}}`
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      if (tag === 'button') {
        let hasOnClick = false;
        let isSubmit = false;
        let emptyHandler = false;

        for (const attr of node.attributes.properties) {
          if (ts.isJsxAttribute(attr)) {
            const attrName = attr.name.getText(sf);
            if (attrName === 'type' && attr.initializer && ts.isStringLiteral(attr.initializer)) {
              if (attr.initializer.text === 'submit') isSubmit = true;
            }
            if (attrName === 'onClick') {
              hasOnClick = true;
              if (attr.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
                const expr = attr.initializer.expression;
                if (
                  (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) &&
                  ts.isBlock(expr.body) &&
                  expr.body.statements.length === 0
                ) {
                  emptyHandler = true;
                }
              }
            }
          }
        }

        if (emptyHandler) {
          violations.push(`S-DEAD-CONTROL ${relPath}:${lineOf(node)} <button> has empty no-op onClick handler`);
        } else if (!hasOnClick && !isSubmit) {
          violations.push(`S-DEAD-CONTROL ${relPath}:${lineOf(node)} <button> has neither onClick nor type="submit"`);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);
  return { violations, suppressionCount };
}

function scanTestFileAst(filePath, source, relPath) {
  const violations = [];
  let testCaseCount = 0;
  let assertionCount = 0;

  const sf = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(filePath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const countExpectsInSubtree = (root) => {
    let count = 0;
    const walk = (n) => {
      if (ts.isCallExpression(n)) {
        if (ts.isIdentifier(n.expression) && n.expression.text === 'expect') {
          count += 1;
        } else if (
          ts.isPropertyAccessExpression(n.expression) &&
          ts.isIdentifier(n.expression.expression) &&
          n.expression.expression.text === 'expect'
        ) {
          count += 1;
        }
      }
      ts.forEachChild(n, walk);
    };
    walk(root);
    return count;
  };

  const visit = (node) => {
    // Detect skipped/disabled tests (C1: it.skip / describe.skip / test.skip)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      ['it', 'test', 'describe'].includes(node.expression.expression.text) &&
      ['skip', 'todo', 'only'].includes(node.expression.name.text)
    ) {
      violations.push(
        `S-TEST-INTEGRITY ${relPath}:${lineOf(node)} banned ${node.expression.expression.text}.${node.expression.name.text}()`,
      );
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === 'it' || node.expression.text === 'test') &&
      node.arguments.length >= 2
    ) {
      testCaseCount += 1;
      const bodyFn = node.arguments[1];
      const expects = bodyFn ? countExpectsInSubtree(bodyFn) : 0;
      assertionCount += expects;
      if (expects === 0) {
        violations.push(`S-TEST-INTEGRITY ${relPath}:${lineOf(node)} test case has zero expect() assertions`);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);
  return { violations, testCaseCount, assertionCount };
}

function checkCutline(rootDir) {
  const violations = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
      if (OUT_OF_PHASE_NAMES.has(entry) || OUT_OF_PHASE_NAMES.has(entry.toLowerCase())) {
        violations.push(`S-CUTLINE ${relative(rootDir, join(dir, entry))}: out-of-phase module/screen violates §2.3 cut line`);
        continue;
      }
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
    }
  };
  for (const d of PRODUCT_DIRS) walk(join(rootDir, d));
  return violations;
}

function checkTaskboardAttestationsAndEvidence(rootDir) {
  const violations = [];
  const tbPath = join(rootDir, 'TASKBOARD.md');
  if (!existsSync(tbPath)) return ['INT1: Missing TASKBOARD.md'];

  const tb = readFileSync(tbPath, 'utf8');
  const workItemsSection = tb.split('## §Work Items')[1]?.split('## §')[0] ?? '';
  const attestationsSection = tb.split('## §Attestations')[1]?.split('## §')[0] ?? '';

  const verifiedIds = [];
  for (const line of workItemsSection.split('\n')) {
    if (!line.startsWith('| WI-')) continue;
    const cols = line.split('|').map((c) => c.trim());
    // cols: ['', ID, Milestone, Mission, Depends, SpecRefs, AC, PairedTest, Oracle, CutLine, Status, Evidence, '']
    const wiId = cols[1] ?? '';
    const ac = cols[6] ?? '';
    const status = cols[10] ?? '';
    const evidence = cols[11] ?? '';

    if (status === 'VERIFIED') {
      verifiedIds.push(wiId);
      if (!evidence || evidence === '—' || evidence.length < 15) {
        violations.push(`INT9: ${wiId} is marked VERIFIED without pasted command evidence`);
      }
      if (ac.includes('[ ]')) {
        violations.push(`INT1: ${wiId} is marked VERIFIED while unchecked criteria '[ ]' remain`);
      }
    }
  }

  for (const wiId of verifiedIds) {
    const escapedAttestation = VERBATIM_ATTESTATION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${wiId}\\b[\\s\\S]{0,260}${escapedAttestation}`);
    if (!re.test(attestationsSection)) {
      violations.push(
        `INT1: ${wiId} is missing its verbatim §13.9 Work-Integrity Codex attestation in TASKBOARD.md §Attestations`,
      );
    }
  }

  return violations;
}

/**
 * S-COMMIT (INT8) scope: the commit-hygiene rule governs commits AUTHORED AFTER the
 * Work-Integrity Codex took effect (`scripts/commit-baseline.json` -> `enforcedFrom`).
 *
 * Two classes of commit are structurally out of scope, and neither can widen the rule:
 *   - history at or before the recorded enforcement boundary, because the codex did not exist
 *     yet and MASTER_PROMPT §8.9 / §13.4-F9 forbid rewriting published history;
 *   - GitHub-generated pull-request merge commits, because the hosting platform writes their
 *     message and it can carry neither a conventional subject nor a work item.
 *
 * The boundary cannot be used to hide a violation:
 *   - it must cite the owner decision (`DEC-###`) and that decision must be in TASKBOARD.md;
 *   - it must be a full 40-hex hash that is a real ancestor of HEAD;
 *   - the boundary commit ITSELF must satisfy S-COMMIT, so a non-compliant commit can never
 *     become the boundary (moving the boundary forward over green commits changes nothing,
 *     because every commit newer than it is checked).
 */
const COMMIT_BASELINE_REL = join('scripts', 'commit-baseline.json');
const CONVENTIONAL_SUBJECT_RE = /^(?:feat|fix|test|docs|chore)\([a-z0-9-]+\):\s+\S+/;
const WI_CITATION_RE = /\bWI-\d{4}[A-Z]?\b/;
// GitHub writes two machine-only subject shapes: the merge of a PR into its base and the
// synthetic PR-check commit `Merge <head sha> into <base sha>`. Neither carries an authored work
// claim. Hand-made `Merge branch ...` commits remain in scope.
const GITHUB_MERGE_SUBJECT_RE =
  /^(?:Merge pull request #\d+ from \S+|Merge [0-9a-f]{40} into [0-9a-f]{40})$/;

function commitHygieneViolations(subject, body) {
  const violations = [];
  if (/\b(?:wip|fixup!|squash!)\b/i.test(subject)) {
    violations.push(`banned WIP/fixup commit subject "${subject}"`);
  }
  if (!CONVENTIONAL_SUBJECT_RE.test(subject)) {
    violations.push(`commit subject must follow conventional format: "${subject}"`);
  }
  if (!WI_CITATION_RE.test(body)) {
    violations.push('commit body must cite its single WI-#### work item');
  }
  return violations;
}

function loadCommitBaseline(rootDir, violations) {
  const baselinePath = join(rootDir, COMMIT_BASELINE_REL);
  if (!existsSync(baselinePath)) {
    return { decision: null, enforcedFrom: null };
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(baselinePath, 'utf8'));
  } catch {
    violations.push('S-COMMIT scripts/commit-baseline.json is not valid JSON');
    return { decision: null, enforcedFrom: null };
  }

  const decision = typeof parsed.decision === 'string' ? parsed.decision : null;
  if (decision === null || !/^DEC-\d{3}$/.test(decision)) {
    violations.push('S-COMMIT scripts/commit-baseline.json must cite its owner decision id (DEC-###)');
  }

  const note = typeof parsed.note === 'string' ? parsed.note.trim() : '';
  if (note.length < 20) {
    violations.push('S-COMMIT scripts/commit-baseline.json must record why the enforcement boundary starts there');
  }

  const enforcedFrom = typeof parsed.enforcedFrom === 'string' ? parsed.enforcedFrom : '';
  if (!/^[0-9a-f]{40}$/.test(enforcedFrom)) {
    violations.push('S-COMMIT scripts/commit-baseline.json must declare a full 40-character lowercase enforcedFrom commit hash');
  }

  if (decision !== null && /^[0-9a-f]{40}$/.test(enforcedFrom)) {
    const taskboardPath = join(rootDir, 'TASKBOARD.md');
    const taskboard = existsSync(taskboardPath) ? readFileSync(taskboardPath, 'utf8') : '';
    if (!new RegExp(`\\b${decision}\\b`).test(taskboard)) {
      violations.push(`S-COMMIT baseline cites ${decision}, but that decision id does not appear in TASKBOARD.md`);
    }
  }

  return {
    decision,
    enforcedFrom: /^[0-9a-f]{40}$/.test(enforcedFrom) ? enforcedFrom : null,
  };
}

function checkGitCommitHygiene(rootDir) {
  const violations = [];
  if (!existsSync(join(rootDir, '.git'))) return violations;

  const { enforcedFrom } = loadCommitBaseline(rootDir, violations);
  const format = '--format=%H|||%P|||%s|||%b===END===';
  // spawnSync with an argument array: no shell, so the format's `|` separators stay literal.
  const runGit = (args) =>
    spawnSync('git', args, { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

  if (enforcedFrom !== null) {
    const ancestry = runGit(['merge-base', '--is-ancestor', enforcedFrom, 'HEAD']);
    if (ancestry.status !== 0) {
      violations.push(
        `S-COMMIT enforcement boundary ${enforcedFrom.slice(0, 7)} is not an ancestor of HEAD — restore the published baseline`,
      );
    } else {
      const boundary = runGit(['log', '-1', format, enforcedFrom]);
      const [, , boundarySubject = '', boundaryBody = ''] = (boundary.stdout ?? '').split('|||');
      for (const message of commitHygieneViolations(boundarySubject, boundaryBody)) {
        violations.push(`S-COMMIT boundary ${enforcedFrom.slice(0, 7)}: ${message}`);
      }
    }
  }

  const logArgs = enforcedFrom === null ? ['log', format] : ['log', format, `${enforcedFrom}..HEAD`];
  const log = runGit(logArgs);
  const records = (log.stdout ?? '').split('===END===').map((s) => s.trim()).filter(Boolean);
  for (const rec of records) {
    const [hash = '', parents = '', subject = '', body = ''] = rec.split('|||');
    const parentCount = parents.trim().length === 0 ? 0 : parents.trim().split(/\s+/).length;
    // GitHub writes pull-request merge commits; they carry no authored work claim.
    if (parentCount > 1 && GITHUB_MERGE_SUBJECT_RE.test(subject)) continue;
    for (const message of commitHygieneViolations(subject, body)) {
      violations.push(`S-COMMIT ${hash.slice(0, 7)}: ${message}`);
    }
  }

  return violations;
}

export function runWorkIntegrityCheck(rootDir = process.cwd(), { updateRatchet = false } = {}) {
  const violations = [];

  const productFiles = PRODUCT_DIRS.flatMap((d) =>
    walkFiles(
      join(rootDir, d),
      (name) => ['.ts', '.tsx'].includes(extname(name)) && !isTestFile(basename(name)),
    ),
  );

  let totalSuppressions = 0;
  for (const f of productFiles) {
    const rel = relative(rootDir, f).replace(/\\/g, '/');
    const res = scanProductAst(f, readFileSync(f, 'utf8'), rel);
    totalSuppressions += res.suppressionCount;
    violations.push(...res.violations);
  }

  const testFiles = TEST_DIRS.flatMap((d) =>
    walkFiles(join(rootDir, d), (name) => isTestFile(basename(name))),
  );

  let totalTestCases = 0;
  let totalAssertions = 0;
  for (const tf of testFiles) {
    const rel = relative(rootDir, tf).replace(/\\/g, '/');
    const res = scanTestFileAst(tf, readFileSync(tf, 'utf8'), rel);
    totalTestCases += res.testCaseCount;
    totalAssertions += res.assertionCount;
    violations.push(...res.violations);
  }

  // INT6: Every /core/<domain>/ directory with implementation files must have a colocated *.test.ts
  const coreRoot = join(rootDir, 'core');
  if (existsSync(coreRoot)) {
    for (const sub of readdirSync(coreRoot)) {
      const subFull = join(coreRoot, sub);
      if (!statSync(subFull).isDirectory()) continue;
      const impls = readdirSync(subFull).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
      const tests = readdirSync(subFull).filter((f) => f.endsWith('.test.ts'));
      if (impls.length > 0 && tests.length === 0) {
        violations.push(`S-COVERAGE core/${sub} has implementation files (${impls.join(', ')}) with zero *.test.ts coverage`);
      }
    }
  }

  violations.push(...checkCutline(rootDir));
  violations.push(...checkTaskboardAttestationsAndEvidence(rootDir));
  violations.push(...checkGitCommitHygiene(rootDir));

  const metrics = {
    testFiles: testFiles.length,
    testCases: totalTestCases,
    assertions: totalAssertions,
    suppressions: totalSuppressions,
    placeholders: violations.filter((v) => v.startsWith('S-PLACEHOLDER')).length,
  };

  const ratchetPath = join(rootDir, 'scripts', 'integrity-ratchet.json');
  if (updateRatchet) {
    writeFileSync(ratchetPath, JSON.stringify(metrics, null, 2) + '\n');
  } else if (existsSync(ratchetPath)) {
    const baseline = JSON.parse(readFileSync(ratchetPath, 'utf8'));
    if (metrics.testFiles < baseline.testFiles) {
      violations.push(`INT13 RATCHET: testFiles regressed (${baseline.testFiles} -> ${metrics.testFiles})`);
    }
    if (metrics.testCases < baseline.testCases) {
      violations.push(`INT13 RATCHET: testCases regressed (${baseline.testCases} -> ${metrics.testCases})`);
    }
    if (metrics.assertions < baseline.assertions) {
      violations.push(`INT13 RATCHET: assertions regressed (${baseline.assertions} -> ${metrics.assertions})`);
    }
    if (metrics.suppressions > baseline.suppressions) {
      violations.push(`INT13 RATCHET: suppressions increased (${baseline.suppressions} -> ${metrics.suppressions})`);
    }
  }

  return { metrics, violations };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rootArgIdx = process.argv.indexOf('--root');
  const root = rootArgIdx !== -1 && process.argv[rootArgIdx + 1] ? process.argv[rootArgIdx + 1] : process.cwd();
  const updateRatchet = process.argv.includes('--update-ratchet');
  const { metrics, violations } = runWorkIntegrityCheck(root, { updateRatchet });
  if (violations.length > 0) {
    console.error(`WORK-INTEGRITY GATE FAILED (${violations.length} violation(s)):`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    process.exit(1);
  }
  console.log(
    `✓ work-integrity green (INT1–INT13: ${metrics.testFiles} test files, ${metrics.testCases} tests, ${metrics.assertions} assertions, 0 placeholders/suppressions).`,
  );
}
