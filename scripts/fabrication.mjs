#!/usr/bin/env node
// Ported from fp-A-betterversion/scripts/fabrication-detector.mjs @ 86d785ca696c. Class B.
// Changes: Zero-tolerance threshold (baseline = 0, no debt file); scans /core, /server, /src; adds detection for banned anti-patterns in MASTER_PROMPT §9.9 ("coming soon" chrome, `(0%)` / `—%` zero-for-absence, "Acme Corp" / "Metro Plaza" seed strings, INITIAL_RATES). Oracle: scripts/gates.test.ts.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const SCAN_DIRS = ['core', 'server', 'src'];

const DISPLAY_VALUE_NAMES = new Set([
  'value', 'val', 'amount', 'sales', 'revenue', 'income', 'profit', 'ebitda',
  'cash', 'variance', 'dividend', 'netincome', 'kpi', 'delta', 'total',
]);

const CURRENCY_COMPACT = /\$\s*\d[\d,]*(?:\.\d+)?\s*[KMBTkbmt]\b/;
const CURRENCY_GROUPED = /\$\s*\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/;
const CURRENCY_DECIMAL = /\$\s*\d+\.\d+\b/;
const PERCENT = /^[+\-]?\d+(?:\.\d+)?\s*%$/;
const ZERO_ABSENCE_PERCENT = /^(?:\(0(?:\.0+)?%\)|—%|--%)$/;
const BANNED_SEEDS = /\b(?:Acme\s+Corp|Metro\s+Plaza|INITIAL_RATES)\b/i;
const COMING_SOON = /\bcoming\s+soon\b/i;

function classifyDisplayLiteral(text) {
  const trimmed = text.trim();
  if (CURRENCY_COMPACT.test(trimmed) || CURRENCY_GROUPED.test(trimmed) || CURRENCY_DECIMAL.test(trimmed)) {
    return 'currency-literal';
  }
  if (ZERO_ABSENCE_PERCENT.test(trimmed)) {
    return 'zero-for-absence-percent';
  }
  if (PERCENT.test(trimmed)) {
    return 'percent-literal';
  }
  return null;
}

function propName(node) {
  if (!node) return '';
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return '';
}

function collectStringLiterals(node, out) {
  if (!node) return;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    out.push(node);
    return;
  }
  if (ts.isJsxExpression(node)) {
    collectStringLiterals(node.expression, out);
    return;
  }
  ts.forEachChild(node, (child) => collectStringLiterals(child, out));
}

export function analyseFabricationSource(filePath, text) {
  const sf = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(filePath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const findings = [];
  const at = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const snippet = (node) => node.getText(sf).replace(/\s+/g, ' ').trim().slice(0, 90);
  const add = (node, kind, op) => findings.push({ line: at(node), kind, op, code: snippet(node) });

  const inUi = filePath.replace(/\\/g, '/').includes('/src/');

  const inspectDisplayValue = (nameNode, valueNode) => {
    const name = propName(nameNode).replace(/[_-]/g, '').toLowerCase();
    if (!DISPLAY_VALUE_NAMES.has(name) || !valueNode) return;
    const lits = [];
    collectStringLiterals(valueNode, lits);
    for (const lit of lits) {
      const kind = classifyDisplayLiteral(lit.text);
      if (kind) add(lit, kind, lit.text);
    }
  };

  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && BANNED_SEEDS.test(node.name.text)) {
      add(node, 'banned-seed-identifier', node.name.text);
    }

    if (ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node)) {
      inspectDisplayValue(node.name, node.initializer);
      if (
        inUi &&
        propName(node.name).toLowerCase() === 'taxrate' &&
        node.initializer &&
        ts.isNumericLiteral(node.initializer)
      ) {
        add(node.initializer, 'hardcoded-rate', node.initializer.getText(sf));
      }
    }

    if (ts.isJsxAttribute(node)) {
      const attrName = propName(node.name).toLowerCase();
      if (attrName !== 'placeholder' && attrName !== 'aria-label' && attrName !== 'title') {
        inspectDisplayValue(node.name, node.initializer);
      }
    }

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) {
      const raw = node.text;
      if (BANNED_SEEDS.test(raw)) {
        add(node, 'banned-seed-literal', raw.trim());
      }
      if (inUi && COMING_SOON.test(raw)) {
        add(node, 'coming-soon-chrome', raw.trim());
      }
      if (inUi && ZERO_ABSENCE_PERCENT.test(raw.trim())) {
        add(node, 'zero-for-absence-percent', raw.trim());
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);
  return findings;
}

export function runFabricationScan(rootDir = process.cwd()) {
  const isTest = (f) => /\.(test|bench|spec)\.[tj]sx?$/.test(f);
  const files = [];

  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (['.ts', '.tsx'].includes(extname(full)) && !isTest(basename(full))) {
        files.push(full);
      }
    }
  };

  for (const d of SCAN_DIRS) walk(join(rootDir, d));

  const violations = [];
  for (const f of files) {
    const rel = relative(rootDir, f).replace(/\\/g, '/');
    const findings = analyseFabricationSource(f, readFileSync(f, 'utf8'));
    for (const hit of findings) {
      violations.push(`${rel}:${hit.line} [${hit.kind}] "${hit.op}" -> ${hit.code}`);
    }
  }

  return { scanned: files.length, violations };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rootArgIdx = process.argv.indexOf('--root');
  const root = rootArgIdx !== -1 && process.argv[rootArgIdx + 1] ? process.argv[rootArgIdx + 1] : process.cwd();
  const { scanned, violations } = runFabricationScan(root);
  if (violations.length > 0) {
    console.error(`FABRICATION GATE FAILED (${violations.length} violation(s) across ${scanned} file(s)):`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    process.exit(1);
  }
  console.log(`✓ fabrication green (${scanned} module(s) scanned, 0 fabricated literals/dead chrome).`);
}
