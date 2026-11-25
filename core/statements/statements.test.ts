import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertInvariant,
  InvariantViolationError,
  verifyArticulation,
} from '../invariants.js';
import { fromMinorUnits, money } from '../money/index.js';
import {
  allocateDisplayUnits,
  buildArticulatingStatements,
  buildTrialBalance,
  computeBalanceSheet,
  computeIndirectCashFlow,
  computeNaturalActivity,
  computePnlStatement,
  computeSheetContribution,
  evaluateCoaImport,
  evaluateCoaMerge,
  normalizeCode,
  STATEMENT_LINE_MAP,
  validateAccountCoherence,
  type CoaAccountRecord,
  type StatementAccountDef,
} from './index.js';

interface ChecksumManifest {
  readonly files: Readonly<Record<string, string>>;
}

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function readJson<T>(relPath: string): T {
  const full = join(process.cwd(), relPath);
  return JSON.parse(readFileSync(full, 'utf8')) as T;
}

describe('Class A Oracle Integrity (P15 CoA & P18 Statements)', () => {
  it('verifies every P15 CoA fixture file matches CHECKSUMS.json SHA-256', () => {
    const manifest = readJson<ChecksumManifest>('fixtures/oracles/coa/CHECKSUMS.json');
    const entries = Object.entries(manifest.files);
    expect(entries.length).toBe(11);
    for (const [name, expectedHash] of entries) {
      const actualHash = sha256Hex(readFileSync(join(process.cwd(), 'fixtures/oracles/coa', name)));
      expect(actualHash, `Checksum mismatch on fixtures/oracles/coa/${name}`).toBe(expectedHash);
    }
  });

  it('verifies every P18 Statements fixture file matches CHECKSUMS.json SHA-256', () => {
    const manifest = readJson<ChecksumManifest>('fixtures/oracles/statements/CHECKSUMS.json');
    const entries = Object.entries(manifest.files);
    expect(entries.length).toBe(9);
    for (const [name, expectedHash] of entries) {
      const actualHash = sha256Hex(readFileSync(join(process.cwd(), 'fixtures/oracles/statements', name)));
      expect(actualHash, `Checksum mismatch on fixtures/oracles/statements/${name}`).toBe(expectedHash);
    }
  });
});

describe('CoA Normalization, Coherence & P15 Fixture Suite', () => {
  it('preserves leading zeros and normalizes whitespace without numeric parsing', () => {
    expect(normalizeCode('  001200  ')).toBe('001200');
    expect(normalizeCode('001200')).not.toBe(normalizeCode('1200'));
    expect(normalizeCode(' 4000   REV ')).toBe('4000 REV');
    expect(() => normalizeCode('   ')).toThrow('INVALID_EMPTY_CODE');
  });

  it('enforces account type and normal_side coherence with contra exemption', () => {
    expect(validateAccountCoherence('asset', 'debit').valid).toBe(true);
    expect(validateAccountCoherence('expense', 'debit').valid).toBe(true);
    expect(validateAccountCoherence('revenue', 'credit').valid).toBe(true);
    expect(validateAccountCoherence('liability', 'credit').valid).toBe(true);
    expect(validateAccountCoherence('equity', 'credit').valid).toBe(true);

    const invalidRev = validateAccountCoherence('revenue', 'debit', false);
    expect(invalidRev.valid).toBe(false);
    expect(validateAccountCoherence('asset', 'credit', true).valid).toBe(true);
    expect(validateAccountCoherence('equity', 'debit', true).valid).toBe(true);
  });

  it('passes P15 import-pack-coa, import-update, duplicate-code, referenced-account, and merge-remap fixtures', () => {
    interface RawFixtureAccount {
      code: string;
      name: string;
      type: string;
      section: string;
      parent_code?: string | null;
      is_control?: boolean;
    }

    const toIncoming = (items: readonly RawFixtureAccount[]) =>
      items.map((a) => ({
        code: a.code,
        name: a.name,
        type: a.type,
        section: a.section,
        parentCode: a.parent_code ?? null,
        ...(a.is_control !== undefined ? { isControl: a.is_control } : {}),
      }));

    const toExisting = (items: readonly RawFixtureAccount[]): CoaAccountRecord[] =>
      toIncoming(items).map((a) => ({ ...a, version: 1, active: true }));

    // 1. import-pack-coa
    const packIn = readJson<{ accounts: RawFixtureAccount[] }>('fixtures/oracles/coa/import-pack-coa.json');
    const packExp = readJson<{ created: number; updated: number }>('fixtures/oracles/coa/import-pack-coa.expected.json');
    const packOut = evaluateCoaImport([], toIncoming(packIn.accounts));
    expect(packOut.ok).toBe(true);
    expect(packOut.created).toBe(packExp.created);
    expect(packOut.updated).toBe(packExp.updated);

    // 2. import-update
    const updIn = readJson<{ existing: RawFixtureAccount[]; accounts: RawFixtureAccount[] }>(
      'fixtures/oracles/coa/import-update.json',
    );
    const updExp = readJson<{
      created: number;
      updated: number;
      code_4000_version: number;
      code_4000_name: string;
    }>('fixtures/oracles/coa/import-update.expected.json');
    const updOut = evaluateCoaImport(toExisting(updIn.existing), toIncoming(updIn.accounts));
    expect(updOut.ok).toBe(true);
    expect(updOut.created).toBe(updExp.created);
    expect(updOut.updated).toBe(updExp.updated);
    const code4000 = updOut.accounts.find((a) => a.code === '4000');
    expect(code4000?.version).toBe(updExp.code_4000_version);
    expect(code4000?.name).toBe(updExp.code_4000_name);

    // 3. duplicate-code (type mismatch -> 409 COA_DUPLICATE_CODE)
    const dupIn = readJson<{ existing: RawFixtureAccount[]; accounts: RawFixtureAccount[] }>(
      'fixtures/oracles/coa/duplicate-code.json',
    );
    const dupExp = readJson<{ error: string; http_status: number; code: string }>(
      'fixtures/oracles/coa/duplicate-code.expected.json',
    );
    const dupOut = evaluateCoaImport(toExisting(dupIn.existing), toIncoming(dupIn.accounts));
    expect(dupOut.ok).toBe(false);
    expect(dupOut.errorCode).toBe(dupExp.error);
    expect(dupOut.httpStatus).toBe(dupExp.http_status);
    expect(dupOut.conflictCode).toBe(dupExp.code);

    // 4. referenced-account (GL reference blocks overwrite -> 409 COA_REFERENCED)
    const refIn = readJson<{
      existing: RawFixtureAccount[];
      gl_lines: Array<{ account_code: string; debit_minor: number; credit_minor: number }>;
      accounts: RawFixtureAccount[];
    }>('fixtures/oracles/coa/referenced-account.json');
    const refExp = readJson<{ error: string; http_status: number; count: number }>(
      'fixtures/oracles/coa/referenced-account.expected.json',
    );
    const glCountMap = new Map<string, number>();
    for (const line of refIn.gl_lines) {
      glCountMap.set(line.account_code, (glCountMap.get(line.account_code) ?? 0) + 1);
    }
    const refOut = evaluateCoaImport(toExisting(refIn.existing), toIncoming(refIn.accounts), glCountMap);
    expect(refOut.ok).toBe(false);
    expect(refOut.errorCode).toBe(refExp.error);
    expect(refOut.httpStatus).toBe(refExp.http_status);
    expect(refOut.glLineCount).toBe(refExp.count);

    // 5. merge-remap
    const mergeIn = readJson<{
      existing: RawFixtureAccount[];
      gl_lines: Array<{ account_code: string; debit_minor: number; credit_minor: number }>;
      from_code: string;
      to_code: string;
    }>('fixtures/oracles/coa/merge-remap.json');
    const mergeExp = readJson<{
      remapped: number;
      from_active: number;
      from_version: number;
      child_code: string;
      child_new_parent_code: string;
    }>('fixtures/oracles/coa/merge-remap.expected.json');
    const mergeOut = evaluateCoaMerge(
      toExisting(mergeIn.existing),
      mergeIn.gl_lines.map((l) => ({
        accountCode: l.account_code,
        debitMinor: l.debit_minor,
        creditMinor: l.credit_minor,
      })),
      mergeIn.from_code,
      mergeIn.to_code,
    );
    expect(mergeOut.remappedLinesCount).toBe(mergeExp.remapped);
    const mergedFrom = mergeOut.accounts.find((a) => a.code === mergeIn.from_code);
    expect(mergedFrom?.active).toBe(mergeExp.from_active === 1);
    expect(mergedFrom?.version).toBe(mergeExp.from_version);
    const reparentedChild = mergeOut.accounts.find((a) => a.code === mergeExp.child_code);
    expect(reparentedChild?.parentCode).toBe(mergeExp.child_new_parent_code);
  });
});

describe('Permanent EBITDA +300 Oracle & P18 Financial Statement Fixtures', () => {
  it('computes EBITDA +300.00 on Revenue 1000, COGS 400, OpEx 300 with natural signs', () => {
    const revNat = computeNaturalActivity('credit', money('0'), money('1000'));
    const cogsNat = computeNaturalActivity('debit', money('400'), money('0'));
    const opexNat = computeNaturalActivity('debit', money('300'), money('0'));

    const pnl = computePnlStatement([
      { statementLineKey: 'pl.revenue.product', naturalAmount: revNat },
      { statementLineKey: 'pl.cogs.direct', naturalAmount: cogsNat },
      { statementLineKey: 'pl.opex.ga', naturalAmount: opexNat },
    ]);

    expect(pnl.revenue.toFixed(2)).toBe('1000.00');
    expect(pnl.cogs.toFixed(2)).toBe('400.00');
    expect(pnl.grossProfit.toFixed(2)).toBe('600.00');
    expect(pnl.opex.toFixed(2)).toBe('300.00');
    expect(pnl.ebitda.toFixed(2)).toBe('300.00');
    expect(pnl.netIncome.toFixed(2)).toBe('300.00');
  });

  it('matches P18 pl_basic, bs_basic, cf_basic, and rounding_oracle exact expected outputs', () => {
    // 1. pl_basic
    const plIn = readJson<{
      lines: Array<{ section: string; amount_decimal: string }>;
    }>('fixtures/oracles/statements/pl_basic.json');
    const plExp = readJson<{
      revenue: string;
      cogs: string;
      gross_profit: string;
      opex: string;
      ebitda: string;
      depreciation: string;
      ebit: string;
      tax: string;
      net_income: string;
    }>('fixtures/oracles/statements/pl_basic.expected.json');

    const sectionToKey: Record<string, string> = {
      revenue: 'pl.revenue.product',
      cogs: 'pl.cogs.direct',
      opex: 'pl.opex.other',
      depreciation: 'pl.da.depreciation',
      tax: 'pl.tax.income_tax',
    };
    const plRes = computePnlStatement(
      plIn.lines.map((l) => {
        const raw = money(l.amount_decimal);
        // pl_basic stores expenses as negative signed numbers; convert expense lines to natural debit amounts
        const nat = l.section === 'revenue' ? raw : raw.negated();
        return {
          statementLineKey: sectionToKey[l.section]!,
          naturalAmount: nat,
        };
      }),
    );

    expect(plRes.revenue.toFixed(2)).toBe(plExp.revenue);
    expect(plRes.cogs.toFixed(2)).toBe(plExp.cogs);
    expect(plRes.grossProfit.toFixed(2)).toBe(plExp.gross_profit);
    expect(plRes.opex.toFixed(2)).toBe(plExp.opex);
    expect(plRes.ebitda.toFixed(2)).toBe(plExp.ebitda);
    expect(plRes.depreciation.toFixed(2)).toBe(plExp.depreciation);
    expect(plRes.ebit.toFixed(2)).toBe(plExp.ebit);
    expect(plRes.tax.toFixed(2)).toBe(plExp.tax);
    expect(plRes.netIncome.toFixed(2)).toBe(plExp.net_income);

    // 2. bs_basic
    const bsIn = readJson<{
      assets: Array<{ account_code: string; amount_decimal: string }>;
      liabilities: Array<{ account_code: string; amount_decimal: string }>;
      equity: Array<{ account_code: string; amount_decimal: string }>;
    }>('fixtures/oracles/statements/bs_basic.json');
    const bsExp = readJson<{
      current_assets: string;
      non_current_assets: string;
      total_assets: string;
      current_liabilities: string;
      non_current_liabilities: string;
      total_liabilities: string;
      total_equity: string;
      total_liabilities_and_equity: string;
    }>('fixtures/oracles/statements/bs_basic.expected.json');

    const bsKeyByCode: Record<string, string> = {
      '1000': 'bs.asset.cash',
      '1100': 'bs.asset.ar',
      '1200': 'bs.asset.inventory',
      '1500': 'bs.asset.ppe_gross',
      '2000': 'bs.liability.ap',
      '2500': 'bs.liability.long_term_debt',
      '3000': 'bs.equity.common_stock',
    };
    const bsRes = computeBalanceSheet([
      ...bsIn.assets.map((a) => ({ statementLineKey: bsKeyByCode[a.account_code]!, amount: money(a.amount_decimal) })),
      ...bsIn.liabilities.map((l) => ({ statementLineKey: bsKeyByCode[l.account_code]!, amount: money(l.amount_decimal) })),
      ...bsIn.equity.map((e) => ({ statementLineKey: bsKeyByCode[e.account_code]!, amount: money(e.amount_decimal) })),
    ]);

    expect(bsRes.isBalanced).toBe(true);
    expect(bsRes.currentAssets.toFixed(2)).toBe(bsExp.current_assets);
    expect(bsRes.nonCurrentAssets.toFixed(2)).toBe(bsExp.non_current_assets);
    expect(bsRes.totalAssets.toFixed(2)).toBe(bsExp.total_assets);
    expect(bsRes.currentLiabilities.toFixed(2)).toBe(bsExp.current_liabilities);
    expect(bsRes.nonCurrentLiabilities.toFixed(2)).toBe(bsExp.non_current_liabilities);
    expect(bsRes.totalLiabilities.toFixed(2)).toBe(bsExp.total_liabilities);
    expect(bsRes.totalEquity.toFixed(2)).toBe(bsExp.total_equity);
    expect(bsRes.totalLiabilitiesAndEquity.toFixed(2)).toBe(bsExp.total_liabilities_and_equity);

    // 3. cf_basic
    const cfIn = readJson<{
      operating_activities: Array<{ label: string; amount_decimal: string }>;
      investing_activities: Array<{ label: string; amount_decimal: string }>;
      financing_activities: Array<{ label: string; amount_decimal: string }>;
      balance_sheet_cash_reference: {
        beginning_cash_minor: number;
        ending_cash_minor: number;
      };
    }>('fixtures/oracles/statements/cf_basic.json');
    const cfExp = readJson<{
      operating_cash_flow: string;
      investing_cash_flow: string;
      free_cash_flow: string;
      financing_cash_flow: string;
      net_cash_change: string;
    }>('fixtures/oracles/statements/cf_basic.expected.json');

    // Working capital inflow of +535800 means deltaCL - deltaNonCashCA = +535800
    const cfRes = computeIndirectCashFlow({
      netIncome: money(cfIn.operating_activities[0]!.amount_decimal),
      depreciationAndAmortization: money(cfIn.operating_activities[1]!.amount_decimal),
      beginningNonCashCurrentAssets: money('1000000.00'),
      endingNonCashCurrentAssets: money('1000000.00'),
      beginningCurrentLiabilities: money('0.00'),
      endingCurrentLiabilities: money(cfIn.operating_activities[2]!.amount_decimal),
      capexCashOutflow: money(cfIn.investing_activities[0]!.amount_decimal),
      debtNetCashFlow: money(cfIn.financing_activities[0]!.amount_decimal),
      equityIssuanceCashFlow: money('0.00'),
      distributionsCashFlow: money('0.00'),
      beginningCash: fromMinorUnits(cfIn.balance_sheet_cash_reference.beginning_cash_minor, 2),
    });

    expect(cfRes.operatingCashFlow.toFixed(2)).toBe(cfExp.operating_cash_flow);
    expect(cfRes.investingCashFlow.toFixed(2)).toBe(cfExp.investing_cash_flow);
    expect(cfRes.freeCashFlow.toFixed(2)).toBe(cfExp.free_cash_flow);
    expect(cfRes.financingCashFlow.toFixed(2)).toBe(cfExp.financing_cash_flow);
    expect(cfRes.netCashChange.toFixed(2)).toBe(cfExp.net_cash_change);
    expect(cfRes.endingCash.eq(fromMinorUnits(cfIn.balance_sheet_cash_reference.ending_cash_minor, 2))).toBe(true);

    // 4. rounding_oracle (all 5 cases)
    const roundIn = readJson<{
      cases: Array<{ id: string; unit: string; exact_lines: string[] }>;
    }>('fixtures/oracles/statements/rounding_oracle.json');
    const roundExp = readJson<{
      results: Record<string, { displayed: string[]; displayed_total: string }>;
    }>('fixtures/oracles/statements/rounding_oracle.expected.json');

    for (const c of roundIn.cases) {
      const exp = roundExp.results[c.id]!;
      const actual = allocateDisplayUnits(
        c.exact_lines.map((s) => money(s)),
        money(c.unit),
      );
      expect(actual.displayed.map((d) => d.toFixed()), `Displayed mismatch on ${c.id}`).toEqual(exp.displayed);
      expect(actual.displayedTotal.toFixed(), `Total mismatch on ${c.id}`).toBe(exp.displayed_total);
    }
  });
});

describe('Full Accounting Articulation (A1–A5) & Negative Invariant Detection', () => {
  const accounts: readonly StatementAccountDef[] = [
    { id: 'cash', code: '1000', name: 'Cash', type: 'asset', normalSide: 'debit', statementLineKey: 'bs.asset.cash' },
    { id: 'ar', code: '1100', name: 'AR', type: 'asset', normalSide: 'debit', statementLineKey: 'bs.asset.ar' },
    { id: 'ppe', code: '1500', name: 'PP&E', type: 'asset', normalSide: 'debit', statementLineKey: 'bs.asset.ppe_gross' },
    {
      id: 'accum',
      code: '1590',
      name: 'Accum Depr',
      type: 'asset',
      normalSide: 'credit',
      isContra: true,
      statementLineKey: 'bs.asset.ppe_accum_depr',
    },
    { id: 'ap', code: '2000', name: 'AP', type: 'liability', normalSide: 'credit', statementLineKey: 'bs.liability.ap' },
    { id: 'debt', code: '2500', name: 'LT Debt', type: 'liability', normalSide: 'credit', statementLineKey: 'bs.liability.long_term_debt' },
    { id: 'stock', code: '3000', name: 'Common Stock', type: 'equity', normalSide: 'credit', statementLineKey: 'bs.equity.common_stock' },
    { id: 're', code: '3100', name: 'Retained Earnings', type: 'equity', normalSide: 'credit', statementLineKey: 'bs.equity.retained_earnings' },
    {
      id: 'dist',
      code: '3200',
      name: 'Distributions',
      type: 'equity',
      normalSide: 'debit',
      isContra: true,
      statementLineKey: 'bs.equity.distributions',
    },
    { id: 'rev', code: '4000', name: 'Revenue', type: 'revenue', normalSide: 'credit', statementLineKey: 'pl.revenue.product' },
    { id: 'cogs', code: '5000', name: 'COGS', type: 'expense', normalSide: 'debit', statementLineKey: 'pl.cogs.direct' },
    { id: 'opex', code: '6000', name: 'OpEx', type: 'expense', normalSide: 'debit', statementLineKey: 'pl.opex.payroll' },
    { id: 'depr', code: '7000', name: 'Depreciation', type: 'expense', normalSide: 'debit', statementLineKey: 'pl.da.depreciation' },
  ];

  it('maintains A1–A5 exact articulation across TB, P&L, BS, and Indirect CF including contra accounts and distributions', () => {
    const opening = new Map<string, ReturnType<typeof money>>([
      ['bs.asset.cash', money('500.00')],
      ['bs.asset.ar', money('100.00')],
      ['bs.asset.ppe_gross', money('400.00')],
      ['bs.asset.ppe_accum_depr', money('-100.00')],
      ['bs.liability.ap', money('80.00')],
      ['bs.liability.long_term_debt', money('300.00')],
      ['bs.equity.common_stock', money('320.00')],
      ['bs.equity.retained_earnings', money('200.00')],
    ]);

    const periodLines = [
      // Cash sale 600 + credit sale 400 = Revenue 1000
      { entryId: 'e1', accountId: 'cash', periodId: 'p1', debit: money('600.00'), credit: money('0') },
      { entryId: 'e1', accountId: 'ar', periodId: 'p1', debit: money('400.00'), credit: money('0') },
      { entryId: 'e1', accountId: 'rev', periodId: 'p1', debit: money('0'), credit: money('1000.00') },
      // COGS 400 paid 300 cash, 100 AP
      { entryId: 'e2', accountId: 'cogs', periodId: 'p1', debit: money('400.00'), credit: money('0') },
      { entryId: 'e2', accountId: 'cash', periodId: 'p1', debit: money('0'), credit: money('300.00') },
      { entryId: 'e2', accountId: 'ap', periodId: 'p1', debit: money('0'), credit: money('100.00') },
      // OpEx 300 paid cash (EBITDA = +300)
      { entryId: 'e3', accountId: 'opex', periodId: 'p1', debit: money('300.00'), credit: money('0') },
      { entryId: 'e3', accountId: 'cash', periodId: 'p1', debit: money('0'), credit: money('300.00') },
      // Depreciation 50 (non-cash)
      { entryId: 'e4', accountId: 'depr', periodId: 'p1', debit: money('50.00'), credit: money('0') },
      { entryId: 'e4', accountId: 'accum', periodId: 'p1', debit: money('0'), credit: money('50.00') },
      // Capex 120 cash
      { entryId: 'e5', accountId: 'ppe', periodId: 'p1', debit: money('120.00'), credit: money('0') },
      { entryId: 'e5', accountId: 'cash', periodId: 'p1', debit: money('0'), credit: money('120.00') },
      // Dividend distribution 40 cash
      { entryId: 'e6', accountId: 'dist', periodId: 'p1', debit: money('40.00'), credit: money('0') },
      { entryId: 'e6', accountId: 'cash', periodId: 'p1', debit: money('0'), credit: money('40.00') },
    ];

    const bundle = buildArticulatingStatements({
      accounts,
      openingBalancesByKey: opening,
      periodGlLines: periodLines,
    });

    expect(bundle.trialBalance.isBalanced).toBe(true);
    expect(bundle.pnl.ebitda.toFixed(2)).toBe('300.00');
    expect(bundle.pnl.netIncome.toFixed(2)).toBe('250.00');
    expect(bundle.balanceSheet.isBalanced).toBe(true);
    expect(bundle.cashFlow.endingCash.eq(bundle.balanceSheet.cashBalance)).toBe(true);
    expect(bundle.articulation.valid).toBe(true);
    expect(bundle.retainedEarnings.opening.toFixed(2)).toBe('200.00');
    expect(bundle.retainedEarnings.netIncome.toFixed(2)).toBe('250.00');
    expect(bundle.retainedEarnings.distributions.toFixed(2)).toBe('40.00');
    expect(bundle.retainedEarnings.closingTotal.toFixed(2)).toBe('410.00');
    expect(bundle.retainedEarnings.rollForwardValid).toBe(true);
    for (const c of bundle.articulation.checks) {
      expect(c.passed, `Invariant ${c.id} failed: ${c.detail}`).toBe(true);
    }

    // Also verify catalog and contra sheet contributions explicitly
    expect(STATEMENT_LINE_MAP.has('pl.revenue.product')).toBe(true);
    expect(computeSheetContribution('asset', money('0'), money('50')).toFixed(2)).toBe('-50.00');
    expect(computeSheetContribution('equity', money('40'), money('0')).toFixed(2)).toBe('-40.00');
  });

  it('rejects unbalanced GL entries, invalid GL line sides, bad display units, and detects broken A1–A5 invariants', () => {
    expect(() =>
      buildTrialBalance(accounts, [
        { entryId: 'bad1', accountId: 'cash', periodId: 'p1', debit: money('-5'), credit: money('0') },
      ]),
    ).toThrow('NEGATIVE_GL_LINE_AMOUNT');

    expect(() =>
      buildTrialBalance(accounts, [
        { entryId: 'bad2', accountId: 'cash', periodId: 'p1', debit: money('10'), credit: money('5') },
      ]),
    ).toThrow('INVALID_GL_LINE_SIDES');

    expect(() => allocateDisplayUnits([money('100')], money('0'))).toThrow('INVALID_DISPLAY_UNIT');

    const broken = verifyArticulation({
      totalDebits: money('1000'),
      totalCredits: money('999'),
      pnlRevenue: money('500'),
      pnlExpense: money('300'),
      pnlNetIncome: money('199'),
      bsAssets: money('1000'),
      bsLiabilities: money('400'),
      bsEquity: money('590'),
      openingRetainedEarnings: money('100'),
      distributions: money('0'),
      closingRetainedEarnings: money('250'),
      cfBeginningCash: money('100'),
      cfOperating: money('50'),
      cfInvesting: money('-20'),
      cfFinancing: money('0'),
      cfEndingCash: money('130'),
      bsCash: money('129'),
    });

    expect(broken.valid).toBe(false);
    expect(broken.checks.map((c) => c.passed)).toEqual([false, false, false, false, false]);
    expect(() => assertInvariant(broken.valid, 'ARTICULATION_FAILED', 'Broken A1-A5')).toThrow(InvariantViolationError);
  });
});
