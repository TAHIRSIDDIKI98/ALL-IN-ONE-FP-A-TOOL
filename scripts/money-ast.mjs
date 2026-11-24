#!/usr/bin/env node
// Ported from fp-A-betterversion/scripts/money-ast-detector.mjs @ 86d785ca696c. Class B.
// Changes: Zero-tolerance threshold (no baseline ratchet debt allowed); scans /core (excluding /core/money internals where Decimal is wrapped), /shared, /server, /src; additionally flags Math.abs, parseFloat, and Number() on monetary values per MASTER_PROMPT §5.1 & §6.4 P01. Oracle: scripts/gates.test.ts.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const SCAN_DIRS = ['core', 'shared', 'server', 'src'];

const MONEY_WORDS = [
  'amount', 'balance', 'cost', 'price', 'revenue', 'expense', 'debit', 'credit',
  'cash', 'salary', 'wage', 'payroll', 'fee', 'tax', 'vat', 'payment', 'paid',
  'payable', 'receivable', 'invoice', 'budget', 'actual', 'forecast', 'variance',
  'profit', 'loss', 'income', 'earnings', 'ebitda', 'ebit', 'capex', 'opex',
  'cogs', 'margin', 'subtotal', 'total', 'gross', 'net', 'principal', 'interest',
  'accrual', 'depreciation', 'amortization', 'valuation', 'equity', 'asset',
  'liability', 'debt', 'loan', 'lease', 'rent', 'dividend', 'money', 'ledger',
];

const NON_MONEY_SUFFIX =
  /(rate|pct|percent|percentage|ratio|count|qty|quantity|index|idx|id|ids|key|keys|name|names|label|type|kind|status|state|code|flag|enabled|visible|length|size|width|height|days|day|month|months|year|years|week|weeks|hour|hours|minute|seconds|ms|duration|score|weight|rank|version|page|offset|limit|color|url|path|href|scale|mode|precision|rows|entries|batches|lines|periods)$/i;

const NON_MONEY_CONTAINS =
  /(percent|percentage|_pct|pct_|ratio|growthrate|discountrate|interestrate|taxrate|fxrate|exchangerate|isvalid|hasvalue|colspan|rowspan|timestamp|createdat|updatedat|datetime|rowcount|rowno|sortorder)/i;

const AMBIGUOUS_ALONE = new Set([
  'total', 'net', 'gross', 'value', 'cost', 'sum', 'delta', 'diff', 'change', 'base', 'current', 'previous', 'target', 'margin',
]);

export function looksMonetary(rawName) {
  if (!rawName) return false;
  const name = rawName.replace(/[_-]/g, '');
  if (NON_MONEY_CONTAINS.test(name)) return false;
  if (NON_MONEY_SUFFIX.test(name)) return false;
  if (AMBIGUOUS_ALONE.has(name.toLowerCase())) return false;
  const lower = name.toLowerCase();
  return MONEY_WORDS.some((w) => lower.includes(w));
}

const SAFE_CALLS = new Set([
  'money', 'fromMinorUnits', 'add', 'sub', 'mul', 'div', 'sum', 'negate',
  'allocate', 'round', 'compare', 'eq', 'isZero', 'format', 'parse', 'serialize',
  'Decimal',
]);

const DECIMAL_METHODS = new Set([
  'plus', 'minus', 'times', 'mul', 'div', 'dividedBy', 'neg', 'negated',
  'toDecimalPlaces', 'toDP', 'round', 'cmp', 'comparedTo', 'eq', 'gt', 'gte',
  'lt', 'lte', 'isZero', 'isNegative', 'isPositive', 'toFixed',
]);

function isDecimalExpression(node) {
  if (!node) return false;
  if (ts.isParenthesizedExpression(node)) return isDecimalExpression(node.expression);
  if (ts.isAsExpression(node)) return isDecimalExpression(node.expression);
  if (ts.isNewExpression(node)) {
    return ts.isIdentifier(node.expression) && node.expression.text === 'Decimal';
  }
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isIdentifier(callee)) return SAFE_CALLS.has(callee.text);
    if (ts.isPropertyAccessExpression(callee)) {
      const m = callee.name.text;
      if (DECIMAL_METHODS.has(m) || SAFE_CALLS.has(m)) return true;
      if (ts.isIdentifier(callee.expression) && callee.expression.text === 'Decimal') return true;
    }
  }
  return false;
}

function isMonetaryExpression(node, depth = 0) {
  if (!node || depth > 6) return false;
  if (ts.isParenthesizedExpression(node)) return isMonetaryExpression(node.expression, depth + 1);
  if (ts.isIdentifier(node)) return looksMonetary(node.text);
  if (ts.isPropertyAccessExpression(node)) {
    return looksMonetary(node.name.text) || isMonetaryExpression(node.expression, depth + 1);
  }
  if (ts.isElementAccessExpression(node)) {
    const arg = node.argumentExpression;
    if (arg && ts.isStringLiteral(arg) && looksMonetary(arg.text)) return true;
    return isMonetaryExpression(node.expression, depth + 1);
  }
  if (ts.isNonNullExpression(node) || ts.isAsExpression(node)) {
    return isMonetaryExpression(node.expression, depth + 1);
  }
  if (ts.isBinaryExpression(node)) {
    return isMonetaryExpression(node.left, depth + 1) || isMonetaryExpression(node.right, depth + 1);
  }
  return false;
}

function isStringContext(node) {
  const isStr = (n) =>
    n &&
    (ts.isStringLiteral(n) ||
      ts.isTemplateExpression(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      (ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.PlusToken &&
        (isStr(n.left) || isStr(n.right))));
  return isStr(node.left) || isStr(node.right);
}

const ARITH_OPS = new Map([
  [ts.SyntaxKind.PlusToken, '+'],
  [ts.SyntaxKind.MinusToken, '-'],
  [ts.SyntaxKind.AsteriskToken, '*'],
  [ts.SyntaxKind.SlashToken, '/'],
  [ts.SyntaxKind.PercentToken, '%'],
]);

const COMPOUND_OPS = new Map([
  [ts.SyntaxKind.PlusEqualsToken, '+='],
  [ts.SyntaxKind.MinusEqualsToken, '-='],
  [ts.SyntaxKind.AsteriskEqualsToken, '*='],
  [ts.SyntaxKind.SlashEqualsToken, '/='],
]);

const COMPARE_OPS = new Map([
  [ts.SyntaxKind.LessThanToken, '<'],
  [ts.SyntaxKind.GreaterThanToken, '>'],
  [ts.SyntaxKind.LessThanEqualsToken, '<='],
  [ts.SyntaxKind.GreaterThanEqualsToken, '>='],
]);

export function analyseMoneySource(filePath, text) {
  const sf = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(filePath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  // Track local variables initialized from safe Decimal/money calls or string types
  const decimalVars = new Set();
  const stringVars = new Set();

  const prepass = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (node.type) {
        const typeText = node.type.getText(sf).trim();
        if (/^Decimal\b|^Money\b/.test(typeText)) decimalVars.add(node.name.text);
        if (typeText === 'string') stringVars.add(node.name.text);
      }
      if (node.initializer && isDecimalExpression(node.initializer)) {
        decimalVars.add(node.name.text);
      }
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.type) {
      const typeText = node.type.getText(sf).trim();
      if (/^Decimal\b|^Money\b/.test(typeText)) decimalVars.add(node.name.text);
      if (typeText === 'string') stringVars.add(node.name.text);
    }
    ts.forEachChild(node, prepass);
  };
  prepass(sf);

  const isSafe = (n) => {
    if (!n) return false;
    if (isDecimalExpression(n)) return true;
    if (ts.isIdentifier(n) && (decimalVars.has(n.text) || stringVars.has(n.text))) return true;
    return false;
  };

  const findings = [];
  const at = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const snippet = (node) => node.getText(sf).replace(/\s+/g, ' ').trim().slice(0, 90);
  const add = (node, kind, op) => findings.push({ line: at(node), kind, op, code: snippet(node) });

  const visit = (node) => {
    // Ban Math.abs anywhere in /core (§5.5 EBITDA law) and on monetary operands everywhere
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'Math'
    ) {
      const fnName = node.expression.name.text;
      const inCore = filePath.replace(/\\/g, '/').includes('/core/');
      if (fnName === 'abs' && (inCore || (node.arguments[0] && isMonetaryExpression(node.arguments[0])))) {
        add(node, 'math-abs-banned', 'Math.abs()');
      } else if (
        ['round', 'floor', 'ceil'].includes(fnName) &&
        node.arguments[0] &&
        isMonetaryExpression(node.arguments[0])
      ) {
        add(node, 'math-round', `Math.${fnName}()`);
      }
    }

    // Ban .abs() on Decimal in /core (§5.5: no abs() anywhere to fix signs)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'abs' &&
      filePath.replace(/\\/g, '/').includes('/core/')
    ) {
      add(node, 'decimal-abs-banned', '.abs()');
    }

    // Ban Number(...) / parseFloat(...) on monetary expressions (§5.1)
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === 'Number' || node.expression.text === 'parseFloat') &&
      node.arguments[0] &&
      isMonetaryExpression(node.arguments[0])
    ) {
      add(node, 'float-coercion', `${node.expression.text}()`);
    }

    // Ban .toFixed(...) on non-Decimal monetary values (§5.1, §9.5)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'toFixed' &&
      isMonetaryExpression(node.expression.expression) &&
      !isSafe(node.expression.expression)
    ) {
      add(node, 'toFixed', '.toFixed()');
    }

    if (ts.isBinaryExpression(node)) {
      const kind = node.operatorToken.kind;
      if (ARITH_OPS.has(kind)) {
        if (
          !isStringContext(node) &&
          (isMonetaryExpression(node.left) || isMonetaryExpression(node.right)) &&
          !isSafe(node.left) &&
          !isSafe(node.right)
        ) {
          add(node, 'arithmetic', ARITH_OPS.get(kind));
        }
      } else if (COMPOUND_OPS.has(kind)) {
        if (isMonetaryExpression(node.left) && !isSafe(node.left) && !isSafe(node.right)) {
          add(node, 'compound-assign', COMPOUND_OPS.get(kind));
        }
      } else if (COMPARE_OPS.has(kind)) {
        if (
          isMonetaryExpression(node.left) &&
          isMonetaryExpression(node.right) &&
          !isSafe(node.left) &&
          !isSafe(node.right)
        ) {
          add(node, 'comparison', COMPARE_OPS.get(kind));
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);
  return findings;
}

export function runMoneyAstScan(rootDir = process.cwd()) {
  const isTest = (f) => /\.(test|bench|spec)\.[tj]sx?$/.test(f);
  const files = [];

  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        // /core/money wraps Decimal directly and is oracle-tested by E1-E4
        if (relative(rootDir, full).replace(/\\/g, '/') === 'core/money') continue;
        walk(full);
      } else if (['.ts', '.tsx'].includes(extname(full)) && !isTest(basename(full))) {
        files.push(full);
      }
    }
  };

  for (const d of SCAN_DIRS) walk(join(rootDir, d));

  const violations = [];
  for (const f of files) {
    const rel = relative(rootDir, f).replace(/\\/g, '/');
    const findings = analyseMoneySource(f, readFileSync(f, 'utf8'));
    for (const hit of findings) {
      violations.push(`${rel}:${hit.line} [${hit.kind} ${hit.op}] ${hit.code}`);
    }
  }

  return { scanned: files.length, violations };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rootArgIdx = process.argv.indexOf('--root');
  const root = rootArgIdx !== -1 && process.argv[rootArgIdx + 1] ? process.argv[rootArgIdx + 1] : process.cwd();
  const { scanned, violations } = runMoneyAstScan(root);
  if (violations.length > 0) {
    console.error(`MONEY-AST GATE FAILED (${violations.length} violation(s) across ${scanned} file(s)):`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    process.exit(1);
  }
  console.log(`✓ money-ast green (${scanned} module(s) scanned, 0 unsafe monetary ops).`);
}
