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

  it('S-COMMIT requires conventional subjects + WI citation, and honours exactly one reason-recorded imported-history baseline', () => {
    const ws = makeTempWorkspace();
    writeFileSync(join(ws, 'TASKBOARD.md'), '## §Decisions\n| DEC-005 | 2026-11-25 | imported baseline | x | x | Y |\n');

    const git = (args: string[]) => {
      const res = spawnSync('git', args, { cwd: ws, encoding: 'utf8' });
      expect(res.status).toBe(0);
    };
    git(['init', '-q']);
    git(['-c', 'user.email=gate@test.local', '-c', 'user.name=Gate Test', 'commit', '--allow-empty', '-m', 'chore: integrate Vite middleware into custom server']);
    const badHash = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ws, encoding: 'utf8' }).stdout.trim();

    // 1. A non-conventional commit with no WI citation is red.
    const red = runGate('scripts/work-integrity.mjs', ws);
    expect(red.status).toBe(1);
    expect(red.stderr).toContain('commit subject must follow conventional format');
    expect(red.stderr).toContain('commit body must cite its single WI-#### work item');

    // 2. The single reason-recorded baseline entry (citing a real DEC) turns it green.
    mkdirSync(join(ws, 'scripts'), { recursive: true });
    const baselinePath = join(ws, 'scripts', 'commit-baseline.json');
    writeFileSync(
      baselinePath,
      JSON.stringify({
        decision: 'DEC-005',
        exempt: [{ hash: badHash, reason: 'Repository import commit predating S-COMMIT enforcement.' }],
      }),
    );
    const green = runGate('scripts/work-integrity.mjs', ws);
    expect(green.status).toBe(0);

    // 3. Baseline citing a decision absent from TASKBOARD.md is red.
    writeFileSync(
      baselinePath,
      JSON.stringify({
        decision: 'DEC-777',
        exempt: [{ hash: badHash, reason: 'Repository import commit predating S-COMMIT enforcement.' }],
      }),
    );
    const unknownDecision = runGate('scripts/work-integrity.mjs', ws);
    expect(unknownDecision.status).toBe(1);
    expect(unknownDecision.stderr).toContain('does not appear in TASKBOARD.md');

    // 4. A stale (non-ancestor) exemption is red.
    writeFileSync(
      baselinePath,
      JSON.stringify({
        decision: 'DEC-005',
        exempt: [
          {
            hash: 'f'.repeat(40),
            reason: 'Repository import commit predating S-COMMIT enforcement.',
          },
        ],
      }),
    );
    const stale = runGate('scripts/work-integrity.mjs', ws);
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain('is not an ancestor of HEAD');

    // 5. Bulk exemptions are rejected: future work must fix forward.
    mkdirSync(join(ws, 'src'), { recursive: true });
    writeFileSync(join(ws, 'src', 'a.ts'), 'export const a = 1;\n');
    const compliant = (subject: string) =>
      spawnSync(
        'git',
        ['-c', 'user.email=gate@test.local', '-c', 'user.name=Gate Test', 'commit', '--allow-empty', '-m', subject, '-m', 'WI-0001 evidence'],
        { cwd: ws, encoding: 'utf8' },
      );
    expect(
      spawnSync('git', ['add', '.'], { cwd: ws, encoding: 'utf8' }).status,
    ).toBe(0);
    expect(compliant('fix(integrity): widen the commit hygiene gate').status).toBe(0);
    const secondHash = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ws, encoding: 'utf8' }).stdout.trim();

    writeFileSync(
      baselinePath,
      JSON.stringify({
        decision: 'DEC-005',
        exempt: [
          { hash: badHash, reason: 'Repository import commit predating S-COMMIT enforcement.' },
          { hash: secondHash, reason: 'Repository import commit predating S-COMMIT enforcement.' },
        ],
      }),
    );
    const bulk = runGate('scripts/work-integrity.mjs', ws);
    expect(bulk.status).toBe(1);
    expect(bulk.stderr).toContain('at most 1 imported commit may be exempted');

    // 6. In a repository whose entire history is compliant, no baseline is needed and the gate is green.
    const cleanWs = makeTempWorkspace();
    writeFileSync(join(cleanWs, 'TASKBOARD.md'), '## §Decisions\n| DEC-005 | 2026-11-25 | imported baseline | x | x | Y |\n');
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
