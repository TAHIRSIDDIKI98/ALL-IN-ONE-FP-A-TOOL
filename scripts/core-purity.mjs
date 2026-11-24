#!/usr/bin/env node
/**
 * Core Purity Gate (MASTER_PROMPT §3.3, Gate S4).
 *
 * Law: /core may import ONLY from relative /core modules and `decimal.js`.
 * It must never import server, client, db, network, node:fs, or framework code,
 * nor contain `any` annotations (§3.2).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

export function checkCorePurity(rootDir = process.cwd()) {
  const coreDir = join(rootDir, 'core');
  const violations = [];
  if (!existsSync(coreDir)) {
    return { scanned: 0, violations };
  }

  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (['.ts', '.tsx'].includes(extname(full))) files.push(full);
    }
  };
  walk(coreDir);

  for (const file of files) {
    const rel = relative(rootDir, file).replace(/\\/g, '/');
    const isTestFile = /\.test\.ts$/.test(rel);
    const source = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

    const checkSpecifier = (spec, node) => {
      if (spec === 'decimal.js') return;
      if (
        isTestFile &&
        (spec === 'vitest' ||
          spec === 'node:fs' ||
          spec === 'node:path' ||
          spec === 'node:crypto' ||
          spec.startsWith('../../fixtures/'))
      ) {
        return;
      }
      if (spec.startsWith('./') || spec.startsWith('../')) {
        // Ensure relative import stays inside /core
        const resolved = join(file, '..', spec).replace(/\\/g, '/');
        const normalizedCore = coreDir.replace(/\\/g, '/');
        if (!resolved.startsWith(normalizedCore)) {
          violations.push(`${rel}:${lineOf(node)} forbidden relative escape outside /core: "${spec}"`);
        }
        return;
      }
      violations.push(`${rel}:${lineOf(node)} forbidden import in /core: "${spec}"`);
    };

    const visit = (node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        checkSpecifier(node.moduleSpecifier.text, node);
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        checkSpecifier(node.moduleSpecifier.text, node);
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length > 0 &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        checkSpecifier(node.arguments[0].text, node);
      }
      if (node.kind === ts.SyntaxKind.AnyKeyword) {
        violations.push(`${rel}:${lineOf(node)} banned \`any\` type in /core (§3.2)`);
      }
      ts.forEachChild(node, visit);
    };

    visit(sf);
  }

  return { scanned: files.length, violations };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rootArgIdx = process.argv.indexOf('--root');
  const root = rootArgIdx !== -1 && process.argv[rootArgIdx + 1] ? process.argv[rootArgIdx + 1] : process.cwd();
  const { scanned, violations } = checkCorePurity(root);
  if (violations.length > 0) {
    console.error(`CORE PURITY FAILED (${violations.length} violation(s) across ${scanned} file(s)):`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    process.exit(1);
  }
  console.log(`✓ core-purity green (${scanned} file(s) scanned, 0 violations).`);
}
