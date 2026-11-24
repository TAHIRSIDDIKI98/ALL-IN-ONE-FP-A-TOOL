#!/usr/bin/env node
// Ported from fp-A-betterversion/scripts/check-tautological-tests.mjs @ 86d785ca696c. Class B.
// Changes: Expanded scan across /core, /shared, /server, /src, /db, /fixtures, /e2e, /scripts; added AST detection for self-recomputing tautological assertions (`expect(fn(x)).toEqual(fn(x))` where expected value calls the same function under test — MASTER_PROMPT §1.6-5, §6.4 P02). Oracle: scripts/gates.test.ts.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const SCAN_DIRS = ['core', 'shared', 'server', 'src', 'db', 'fixtures', 'e2e', 'scripts'];

const CONSTANT_TAUTOLOGIES = [
  { re: /expect\(\s*true\s*\)\s*\.\s*toBe\(\s*true\s*\)/, why: 'expect(true).toBe(true)' },
  { re: /expect\(\s*true\s*\)\s*\.\s*toBeTruthy\(\s*\)/, why: 'expect(true).toBeTruthy()' },
  { re: /expect\(\s*false\s*\)\s*\.\s*toBe\(\s*false\s*\)/, why: 'expect(false).toBe(false)' },
  { re: /expect\(\s*(\d+)\s*\)\s*\.\s*toBe\(\s*\1\s*\)/, why: 'expect(N).toBe(N)' },
  { re: /expect\(\s*(['"`])(.*?)\1\s*\)\s*\.\s*toBe\(\s*\1\2\1\s*\)/, why: 'expect("x").toBe("x")' },
  {
    re: /expect\(\s*container\s*\)\s*\.\s*(?:toBeTruthy\(\s*\)|toBeDefined\(\s*\)|not\s*\.\s*toBeNull\(\s*\))/,
    why: 'expect(container).toBeTruthy() — empty render tautology',
  },
];

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, p1) => p1);
}

function detectSelfRecomputingAssertions(filePath, source) {
  const sf = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(filePath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const hits = [];
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const norm = (n) => n.getText(sf).replace(/\s+/g, '');

  // Track simple `const actual = someFn(a, b)` bindings inside blocks so
  // `const actual = computeX(a); expect(actual).toBe(computeX(a))` is caught too.
  const callBindings = new Map();

  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
      callBindings.set(node.name.text, norm(node.initializer));
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ['toBe', 'toEqual', 'toStrictEqual'].includes(node.expression.name.text) &&
      node.arguments.length === 1 &&
      ts.isCallExpression(node.expression.expression) &&
      ts.isIdentifier(node.expression.expression.expression) &&
      node.expression.expression.expression.text === 'expect' &&
      node.expression.expression.arguments.length >= 1
    ) {
      const actualNode = node.expression.expression.arguments[0];
      const expectedNode = node.arguments[0];

      const actualText = ts.isIdentifier(actualNode) && callBindings.has(actualNode.text)
        ? callBindings.get(actualNode.text)
        : norm(actualNode);
      const expectedText = ts.isIdentifier(expectedNode) && callBindings.has(expectedNode.text)
        ? callBindings.get(expectedNode.text)
        : norm(expectedNode);

      // Flag identical non-literal expressions or expected side calling the exact same function
      if (actualText === expectedText && ts.isCallExpression(expectedNode)) {
        hits.push({
          line: lineOf(node),
          why: `self-recomputing assertion: expect(${actualText}).${node.expression.name.text}(${expectedText})`,
        });
      } else if (ts.isCallExpression(actualNode) && ts.isCallExpression(expectedNode)) {
        const actCallee = norm(actualNode.expression);
        const expCallee = norm(expectedNode.expression);
        // Determinism tests explicitly compare two distinct runs with identical seed in corpus.test.ts;
        // disallow computing expected value with the same function on identical inline literal args
        if (actCallee === expCallee && norm(actualNode) === norm(expectedNode)) {
          hits.push({
            line: lineOf(node),
            why: `self-recomputing assertion calling ${actCallee} on both sides`,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);
  return hits;
}

export function scanTautologicalTests(rootDir = process.cwd()) {
  const files = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) files.push(full);
    }
  };

  for (const d of SCAN_DIRS) walk(join(rootDir, d));

  const violations = [];
  for (const file of files) {
    const rel = relative(rootDir, file).replace(/\\/g, '/');
    const raw = readFileSync(file, 'utf8');
    const code = stripComments(raw);
    const lines = code.split('\n');
    lines.forEach((line, idx) => {
      for (const { re, why } of CONSTANT_TAUTOLOGIES) {
        if (re.test(line)) {
          violations.push(`${rel}:${idx + 1} ${why}`);
          break;
        }
      }
    });

    for (const hit of detectSelfRecomputingAssertions(file, raw)) {
      violations.push(`${rel}:${hit.line} ${hit.why}`);
    }
  }

  return { scanned: files.length, violations };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rootArgIdx = process.argv.indexOf('--root');
  const root = rootArgIdx !== -1 && process.argv[rootArgIdx + 1] ? process.argv[rootArgIdx + 1] : process.cwd();
  const { scanned, violations } = scanTautologicalTests(root);
  if (violations.length > 0) {
    console.error(`TAUTOLOGY GATE FAILED (${violations.length} violation(s) across ${scanned} test file(s)):`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    process.exit(1);
  }
  console.log(`✓ tautology green (${scanned} test file(s) scanned, 0 tautological assertions).`);
}
