import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];

function makeTempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'onefpa-gate-test-'));
  tempDirs.push(dir);
  return dir;
}

function runGate(scriptRelPath: string, rootDir: string) {
  return spawnSync('node', [join(process.cwd(), scriptRelPath), '--root', rootDir], {
    encoding: 'utf8',
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const d = tempDirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

describe('WI-0002 Gate Integrity & Salvage Ports P01–P04 (PR3, P5, S4, S8)', () => {
  it('core-purity fails on node:fs import or `any` in /core and passes on pure Decimal code', () => {
    const ws = makeTempWorkspace();
    mkdirSync(join(ws, 'core'), { recursive: true });
    writeFileSync(
      join(ws, 'core', 'bad.ts'),
      `import { readFileSync } from 'node:fs';\nexport const leak: any = readFileSync;\n`,
    );
    const red = runGate('scripts/core-purity.mjs', ws);
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('forbidden import in /core: "node:fs"');
    expect(red.stderr).toContain('banned `any` type in /core');

    rmSync(join(ws, 'core', 'bad.ts'));
    writeFileSync(
      join(ws, 'core', 'good.ts'),
      `import Decimal from 'decimal.js';\nexport const zero = new Decimal('0');\n`,
    );
    const green = runGate('scripts/core-purity.mjs', ws);
    expect(green.status).toBe(0);
  });

  it('verify log digest surfaces the failing gate before passing gates', () => {
    const ws = makeTempWorkspace();
    const log = join(ws, 'verify-output.log');
    writeFileSync(
      log,
      [
        '[PASS] typecheck (100ms)',
        '[FAIL] work-integrity (200ms)',
        'WORK-INTEGRITY GATE FAILED (1 violation(s)):',
        '  ✗ S-COMMIT abc1234: commit body must cite its single WI-#### work item',
        'VERIFY RED: 15/16 gates passed',
        '[PASS] build (300ms)',
      ].join('\n'),
    );
    const digest = spawnSync('node', [join(process.cwd(), 'scripts/publish-e2e-failure.mjs'), log, 'Sandbox verify'], {
      encoding: 'utf8',
    });
    expect(digest.status).toBe(0);
    expect(digest.stdout).toContain('::error title=Sandbox verify::[FAIL] work-integrity (200ms)');
    expect(digest.stdout).toContain('commit body must cite its single WI-#### work item');
    expect(digest.stdout.indexOf('[FAIL] work-integrity')).toBeLessThan(digest.stdout.indexOf('[PASS] typecheck'));
  });

  it('P01 money-ast fails on raw float arithmetic, Math.abs, Number(), and .toFixed() on money', () => {
    const ws = makeTempWorkspace();
    mkdirSync(join(ws, 'core', 'statements'), { recursive: true });
    writeFileSync(
      join(ws, 'core', 'statements', 'bad.ts'),
      [
        'export function badCalc(revenueAmount: number, expenseAmount: number) {',
        '  const netIncome = revenueAmount - expenseAmount;',
        '  const flipped = Math.abs(netIncome);',
        '  const coerced = Number(revenueAmount);',
        '  return flipped.toFixed(2) + String(coerced);',
        '}',
      ].join('\n'),
    );
    const red = runGate('scripts/money-ast.mjs', ws);
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('arithmetic -');
    expect(red.stderr).toContain('math-abs-banned');
    expect(red.stderr).toContain('float-coercion');

    const cleanRepo = runGate('scripts/money-ast.mjs', process.cwd());
    expect(cleanRepo.status).toBe(0);
  });

  it('P02 tautology fails on constant tautology and self-recomputing engine expectations', () => {
    const ws = makeTempWorkspace();
    mkdirSync(join(ws, 'core'), { recursive: true });
    // Build test content via charCode/concat so our own gate test file does not match literal tautology regex
    const fnCall = String.fromCharCode(101, 120, 112, 101, 99, 116);
    const constTaut = `${fnCall}(true).toBe(true);`;
    const selfRecompute = `${fnCall}(computeVariance(100, 80)).toEqual(computeVariance(100, 80));`;
    writeFileSync(
      join(ws, 'core', 'planted.test.ts'),
      `function computeVariance(a: number, b: number) { return a - b; }\n${constTaut}\n${selfRecompute}\n`,
    );

    const red = runGate('scripts/tautology.mjs', ws);
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('self-recomputing assertion');

    const cleanRepo = runGate('scripts/tautology.mjs', process.cwd());
    expect(cleanRepo.status).toBe(0);
  });

  it('P03 fabrication fails on hardcoded currency KPI, coming-soon chrome, and banned seed names', () => {
    const ws = makeTempWorkspace();
    mkdirSync(join(ws, 'src', 'pages'), { recursive: true });
    const fakeDollar = '$' + '12.4M';
    const comingSoon = 'Coming' + ' soon';
    writeFileSync(
      join(ws, 'src', 'pages', 'FakeBoard.tsx'),
      `export const kpi = { revenue: '${fakeDollar}' };\nexport const label = '${comingSoon}';\n`,
    );
    const red = runGate('scripts/fabrication.mjs', ws);
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('currency-literal');
    expect(red.stderr).toContain('coming-soon-chrome');

    const cleanRepo = runGate('scripts/fabrication.mjs', process.cwd());
    expect(cleanRepo.status).toBe(0);
  });

  it('P04 readme-claims fails on planted "Feature Complete v1.0.0-rc2" claim', () => {
    const ws = makeTempWorkspace();
    writeFileSync(join(ws, 'TASKBOARD.md'), '**Current Milestone**: `M0 FOUNDATION`\n');
    writeFileSync(join(ws, 'README.md'), '# OneFP&A\nStatus: Feature Complete v1.0.0-rc2 (M0)\n');
    const red = runGate('scripts/readme-claims.mjs', ws);
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('Feature Complete');

    const cleanRepo = runGate('scripts/readme-claims.mjs', process.cwd());
    expect(cleanRepo.status).toBe(0);
  });

  it('secret-scan fails on committed .env or leaked GEMINI_API_KEY in client src/', () => {
    const ws = makeTempWorkspace();
    mkdirSync(join(ws, 'src'), { recursive: true });
    writeFileSync(join(ws, '.env.example'), 'PORT=3001\n');
    writeFileSync(join(ws, '.gitignore'), '.env\n');
    const keyName = 'GEMINI_' + 'API_KEY';
    writeFileSync(join(ws, 'src', 'leak.ts'), `export const k = process.env.${keyName};\n`);

    const red = runGate('scripts/secret-scan.mjs', ws);
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('server-only secret identifier');

    const cleanRepo = runGate('scripts/secret-scan.mjs', process.cwd());
    expect(cleanRepo.status).toBe(0);
  });

  it('no-native-deps fails on bcrypt / caret version range and passes on clean repo', () => {
    const ws = makeTempWorkspace();
    writeFileSync(
      join(ws, 'package.json'),
      JSON.stringify({ dependencies: { bcrypt: '^5.1.0' } }),
    );
    writeFileSync(join(ws, 'package-lock.json'), JSON.stringify({ packages: {} }));
    const red = runGate('scripts/no-native-deps.mjs', ws);
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('bcrypt');

    const cleanRepo = runGate('scripts/no-native-deps.mjs', process.cwd());
    expect(cleanRepo.status).toBe(0);
  });

  it('schema-scope fails on unapproved M2/M3 table or float8 column', () => {
    const ws = makeTempWorkspace();
    mkdirSync(join(ws, 'db', 'migrations'), { recursive: true });
    writeFileSync(
      join(ws, 'db', 'migrations', '0001_bad.sql'),
      'CREATE TABLE employee (id uuid PRIMARY KEY, salary float8);\n',
    );
    const red = runGate('scripts/schema-scope.mjs', ws);
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('unapproved table "employee"');
    expect(red.stderr).toContain('floating-point SQL column type');
  });

  it('GOV1-GOV3 / VER1 / VER3 constitution-check fails on dangling § reference or missing ADR and passes on clean repo', () => {
    const ws = makeTempWorkspace();
    writeFileSync(
      join(ws, 'MASTER_PROMPT.md'),
      '> Version 1.3\nMASTER PROMPT CHANGELOG (DEC-004)\n## PART 1 / 13\n### 1.1 Intro\nSee §99.99 for missing ref.\n',
    );
    writeFileSync(join(ws, 'TASKBOARD.md'), 'DEC-004\n');
    writeFileSync(join(ws, 'package.json'), JSON.stringify({ version: '0.1.0' }));
    writeFileSync(join(ws, 'CHANGELOG.md'), '## [0.1.0]\n');

    const red = runGate('scripts/constitution-check.mjs', ws);
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('Dangling section reference §99.99');

    const cleanRepo = runGate('scripts/constitution-check.mjs', process.cwd());
    expect(cleanRepo.status).toBe(0);
  });

  it('LIC1-LIC3 license-check fails on disallowed AGPL-3.0 dependency and passes on clean repo', () => {
    const ws = makeTempWorkspace();
    writeFileSync(join(ws, 'LICENSE'), 'Proprietary\n');
    writeFileSync(
      join(ws, 'package-lock.json'),
      JSON.stringify({
        packages: {
          'node_modules/copyleft-pkg': { version: '1.0.0', license: 'AGPL-3.0-only' },
        },
      }),
    );
    const red = runGate('scripts/license-check.mjs', ws);
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('AGPL-3.0-only');

    const cleanRepo = runGate('scripts/license-check.mjs', process.cwd());
    expect(cleanRepo.status).toBe(0);
  });

  it('S-COMMIT enforces conventional subjects + WI citation after the recorded boundary and rejects a boundary that hides a violation', () => {
    const repo = (
      commits: readonly { readonly subject: string; readonly body?: string }[],
    ): { readonly ws: string; readonly hashes: readonly string[] } => {
      const ws = makeTempWorkspace();
      writeFileSync(
        join(ws, 'TASKBOARD.md'),
        '## \u00a7Decisions\n| DEC-007 | 2026-11-25 | s-commit enforcement boundary | ratified | \u2014 | Y |\n',
      );
      const run = (args: string[]) => spawnSync('git', args, { cwd: ws, encoding: 'utf8' });
      expect(run(['init', '-q']).status).toBe(0);
      const hashes: string[] = [];
      for (const commit of commits) {
        const args = [
          '-c',
          'user.email=gate@test.local',
          '-c',
          'user.name=Gate Test',
          'commit',
          '--allow-empty',
          '-m',
          commit.subject,
        ];
        if (commit.body !== undefined) args.push('-m', commit.body);
        expect(run(args).status).toBe(0);
        hashes.push(run(['rev-parse', 'HEAD']).stdout.trim());
      }
      return { ws, hashes };
    };
    const writeBaseline = (ws: string, body: unknown): void => {
      mkdirSync(join(ws, 'scripts'), { recursive: true });
      writeFileSync(join(ws, 'scripts', 'commit-baseline.json'), JSON.stringify(body));
    };
    const BOUNDARY_REASON =
      'Pre-codex history predates S-COMMIT and is published history that \u00a78.9 forbids rewriting.';

    // 1. A compliant history with a compliant boundary is green.
    const clean = repo([
      { subject: 'chore(integrity): enforce the work-integrity codex', body: 'WI-0005C evidence' },
      { subject: 'feat(spine): add persistence', body: 'WI-0012 evidence' },
    ]);
    writeBaseline(clean.ws, {
      decision: 'DEC-007',
      enforcedFrom: clean.hashes[0],
      note: BOUNDARY_REASON,
    });
    expect(runGate('scripts/work-integrity.mjs', clean.ws).status).toBe(0);

    // 2. A commit AFTER the boundary that breaks either rule is red.
    const dirty = repo([
      { subject: 'chore(integrity): enforce the work-integrity codex', body: 'WI-0005C evidence' },
      { subject: 'REFRESH' },
    ]);
    writeBaseline(dirty.ws, {
      decision: 'DEC-007',
      enforcedFrom: dirty.hashes[0],
      note: BOUNDARY_REASON,
    });
    const red = runGate('scripts/work-integrity.mjs', dirty.ws);
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('commit subject must follow conventional format');
    expect(red.stderr).toContain('commit body must cite its single WI-#### work item');

    // 3. Pointing the boundary AT the violating commit cannot hide it: the boundary must comply.
    writeBaseline(dirty.ws, {
      decision: 'DEC-007',
      enforcedFrom: dirty.hashes[1],
      note: BOUNDARY_REASON,
    });
    const selfBoundary = runGate('scripts/work-integrity.mjs', dirty.ws);
    expect(selfBoundary.status).toBe(1);
    expect(selfBoundary.stderr).toContain('S-COMMIT boundary');
    expect(selfBoundary.stderr).toContain('commit subject must follow conventional format');

    // 4. A boundary that is not an ancestor of HEAD is red (history rewritten under the gate).
    writeBaseline(clean.ws, {
      decision: 'DEC-007',
      enforcedFrom: 'f'.repeat(40),
      note: BOUNDARY_REASON,
    });
    const stale = runGate('scripts/work-integrity.mjs', clean.ws);
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain('is not an ancestor of HEAD');

    // 5. A malformed boundary hash, a missing rationale, or an undecided boundary are all red.
    writeBaseline(clean.ws, { decision: 'DEC-007', enforcedFrom: 'abc', note: BOUNDARY_REASON });
    expect(runGate('scripts/work-integrity.mjs', clean.ws).stderr).toContain(
      'must declare a full 40-character lowercase enforcedFrom commit hash',
    );
    writeBaseline(clean.ws, { decision: 'DEC-007', enforcedFrom: clean.hashes[0], note: 'short' });
    expect(runGate('scripts/work-integrity.mjs', clean.ws).stderr).toContain(
      'must record why the enforcement boundary starts there',
    );

    // 6. A boundary citing a decision that is absent from TASKBOARD.md is red.
    const undecided = repo([
      { subject: 'chore(integrity): enforce the work-integrity codex', body: 'WI-0005C evidence' },
    ]);
    writeBaseline(undecided.ws, {
      decision: 'DEC-777',
      enforcedFrom: undecided.hashes[0],
      note: BOUNDARY_REASON,
    });
    const unknownDecision = runGate('scripts/work-integrity.mjs', undecided.ws);
    expect(unknownDecision.status).toBe(1);
    expect(unknownDecision.stderr).toContain('does not appear in TASKBOARD.md');

    // 7. A GitHub pull-request merge commit is platform-generated and out of scope; a hand-made
    //    merge commit is authored and must still comply.
    const mergeRepo = (mergeMessage: string): string => {
      const ws = makeTempWorkspace();
      writeFileSync(
        join(ws, 'TASKBOARD.md'),
        '## \u00a7Decisions\n| DEC-007 | 2026-11-25 | s-commit enforcement boundary | ratified | \u2014 | Y |\n',
      );
      const run = (args: string[]) => spawnSync('git', args, { cwd: ws, encoding: 'utf8' });
      expect(run(['init', '-q']).status).toBe(0);
      const commit = (subject: string) =>
        run([
          '-c',
          'user.email=gate@test.local',
          '-c',
          'user.name=Gate Test',
          'commit',
          '--allow-empty',
          '-m',
          subject,
          '-m',
          'WI-0005C evidence',
        ]);
      expect(commit('chore(integrity): enforce the work-integrity codex').status).toBe(0);
      const boundary = run(['rev-parse', 'HEAD']).stdout.trim();
      expect(run(['checkout', '-q', '-b', 'topic']).status).toBe(0);
      expect(commit('feat(spine): add a topic branch').status).toBe(0);
      expect(run(['checkout', '-q', '-']).status).toBe(0);
      expect(
        run([
          '-c',
          'user.email=gate@test.local',
          '-c',
          'user.name=Gate Test',
          'merge',
          '--no-ff',
          '-q',
          '-m',
          mergeMessage,
          'topic',
        ]).status,
      ).toBe(0);
      mkdirSync(join(ws, 'scripts'), { recursive: true });
      writeFileSync(
        join(ws, 'scripts', 'commit-baseline.json'),
        JSON.stringify({ decision: 'DEC-007', enforcedFrom: boundary, note: BOUNDARY_REASON }),
      );
      return ws;
    };
    expect(runGate('scripts/work-integrity.mjs', mergeRepo('Merge pull request #7 from owner/topic')).status).toBe(0);
    // GitHub's PR check run checks out a synthetic `Merge <sha> into <sha>` commit; it is
    // platform-generated in exactly the same way as the `Merge pull request #N` commit.
    expect(
      runGate('scripts/work-integrity.mjs', mergeRepo(`Merge ${'a'.repeat(40)} into ${'b'.repeat(40)}`)).status,
    ).toBe(0);

    const authoredMerge = runGate('scripts/work-integrity.mjs', mergeRepo('Merge branch topic'));
    expect(authoredMerge.status).toBe(1);
    expect(authoredMerge.stderr).toContain('commit subject must follow conventional format');

    // 8. In a repository whose entire history is compliant, no baseline is needed and the gate is green.
    const cleanWs = makeTempWorkspace();
    writeFileSync(join(cleanWs, 'TASKBOARD.md'), '## \u00a7Decisions\n| DEC-007 | 2026-11-25 | s-commit enforcement boundary | ratified | \u2014 | Y |\n');
    const cleanGit = (args: string[]) => {
      const res = spawnSync('git', args, { cwd: cleanWs, encoding: 'utf8' });
      expect(res.status).toBe(0);
    };
    cleanGit(['init', '-q']);
    cleanGit(['-c', 'user.email=gate@test.local', '-c', 'user.name=Gate Test', 'commit', '--allow-empty', '-m', 'feat(spine): add persistence', '-m', 'WI-0012 evidence']);
    const cleanHistory = runGate('scripts/work-integrity.mjs', cleanWs);
    expect(cleanHistory.status).toBe(0);
  });

  it('INT1-INT13 work-integrity fails on TODO placeholder, dead button, empty catch, console.log, assertionless test, cut-line breach, or missing attestation', () => {
    const ws = makeTempWorkspace();
    mkdirSync(join(ws, 'src'), { recursive: true });
    mkdirSync(join(ws, 'core', 'consolidation'), { recursive: true });

    // Construct tokens dynamically so our test file stays clean
    const todoWord = 'TO' + 'DO';
    const consoleLog = 'console.' + 'log("leak")';
    const emptyCatch = 'try { JSON.parse("{}"); } catch {}';
    const deadBtn = 'export function Btn() { return <button>Dead</button>; }';
    writeFileSync(
      join(ws, 'src', 'Bad.tsx'),
      `// ${todoWord}: finish\n${consoleLog};\n${emptyCatch}\n${deadBtn}\n`,
    );

    const testCall = 'i' + 't';
    writeFileSync(join(ws, 'src', 'bad.test.ts'), `${testCall}('asserts nothing', () => { const x = 1 + 1; void x; });\n`);
    writeFileSync(
      join(ws, 'TASKBOARD.md'),
      '## §Work Items\n| WI-9999 | M0 | x | — | §1 | 1. ok [x] | x | x | Y | VERIFIED | verified output tail here |\n## §Attestations\n',
    );

    const red = runGate('scripts/work-integrity.mjs', ws);
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('S-PLACEHOLDER');
    expect(red.stderr).toContain('S-DEBUG');
    expect(red.stderr).toContain('S-SWALLOW');
    expect(red.stderr).toContain('S-DEAD-CONTROL');
    expect(red.stderr).toContain('S-TEST-INTEGRITY');
    expect(red.stderr).toContain('S-CUTLINE');
    expect(red.stderr).toContain('INT1: WI-9999');

    const cleanRepo = runGate('scripts/work-integrity.mjs', process.cwd());
    expect(cleanRepo.status).toBe(0);
  });
});
