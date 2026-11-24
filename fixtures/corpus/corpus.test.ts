import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyArticulation } from '../../core/invariants.js';
import { add, fromMinorUnits, money, negate, serialize, sub, sum } from '../../core/money/index.js';
import { buildArticulatingStatements } from '../../core/statements/index.js';
import { computeVariance } from '../../core/variance/index.js';
import { computeIndependentCorpusOracle } from '../../scripts/generate-independent-oracles.js';
import {
  DEFAULT_CORPUS_CONFIG,
  DEFAULT_CORPUS_SEED,
  generateCorpus,
  type GeneratedCorpus,
} from './generator.js';

function readCommittedCorpus(): { raw: string; parsed: GeneratedCorpus } {
  const raw = readFileSync(join(process.cwd(), 'fixtures/corpus/corpus.json'), 'utf8');
  return { raw, parsed: JSON.parse(raw) as GeneratedCorpus };
}

describe('Coherent Sample Corpus v1 & Independent BigInt Oracles (C1–C4, C8–C9)', () => {
  it('C1: satisfies byte-reproducible determinism (committed corpus.json == freshly regenerated)', () => {
    const { raw: committedRaw, parsed: committed } = readCommittedCorpus();
    const regenerated = generateCorpus(DEFAULT_CORPUS_SEED, DEFAULT_CORPUS_CONFIG);
    const regeneratedJson = `${JSON.stringify(regenerated, null, 2)}\n`;

    expect(regeneratedJson).toBe(committedRaw);
    expect(committed.company.name).toBe('Sample Co — DEMO — SYNTHETIC DATA');
    expect(committed.coa.length).toBeGreaterThanOrEqual(40);
    expect(committed.coa.length).toBeLessThanOrEqual(60);
    expect(committed.glLines.length).toBeGreaterThanOrEqual(500);
    expect(committed.glLines.length).toBeLessThanOrEqual(800);
    // Leading-zero account preservation verified on CoA ("001200" alongside "1200")
    expect(committed.coa.some((a) => a.code === '001200')).toBe(true);
    expect(committed.coa.some((a) => a.code === '1200')).toBe(true);
  });

  it('C2 & C8: proves zero unregistered plan-to-actual noise and canonical answer_key keys', () => {
    const { parsed: corpus } = readCommittedCorpus();
    const answerKeyFile = JSON.parse(
      readFileSync(join(process.cwd(), 'fixtures/corpus/answer_key.json'), 'utf8'),
    ) as { items: GeneratedCorpus['answerKey'] };

    // Every plan-to-actual difference by (accountCode, periodCode) must equal the exact sum of registered deviations
    const registeredByGrain = new Map<string, ReturnType<typeof money>>();
    for (const d of corpus.deviations) {
      const key = `${d.grain.account_code}::${d.grain.period}`;
      const prev = registeredByGrain.get(key) ?? money('0');
      registeredByGrain.set(key, add(prev, money(d.amount)));
    }

    const validCodes = new Set(corpus.coa.map((a) => a.code));
    for (const line of corpus.actuals) {
      const grainKey = `${line.accountCode}::${line.periodCode}`;
      const actualDiff = sub(money(line.actualAmount), money(line.budgetAmount));
      const expectedDiff = registeredByGrain.get(grainKey) ?? money('0');
      expect(actualDiff.eq(expectedDiff), `Unregistered variance noise at ${grainKey}`).toBe(true);
    }

    // Validate answer_key.json matches corpus.answerKey with canonical statement_line keys
    expect(answerKeyFile.items).toEqual(corpus.answerKey);
    const varianceDeviations = corpus.deviations.filter((d) => !d.kind.startsWith('structural_'));
    for (const dev of varianceDeviations) {
      expect(validCodes.has(dev.grain.account_code)).toBe(true);
      expect(dev.statement_line_key.startsWith('pl.')).toBe(true);
    }

    // Verify edge-case variance outputs on corpus P01..P12 grains
    const getGrain = (code: string, period: string) =>
      corpus.actuals.find((a) => a.accountCode === code && a.periodCode === period)!;

    // zero_plan_non_zero_actual -> "n/m"
    const nmGrain = getGrain('4200', 'P10');
    const nmVar = computeVariance({
      accountType: 'revenue',
      actual: money(nmGrain.actualAmount),
      plan: money(nmGrain.budgetAmount),
      basis: { scenarioId: 'bva', planVersionId: 'v1', periodCode: 'P10' },
    });
    expect(nmVar.variancePctKind).toBe('nm');
    expect(nmVar.variancePctFormatted).toBe('n/m');

    // zero_plan_zero_actual -> "0.00%"
    const zeroGrain = getGrain('4900', 'P01');
    const zeroVar = computeVariance({
      accountType: 'revenue',
      actual: money(zeroGrain.actualAmount),
      plan: money(zeroGrain.budgetAmount),
      basis: { scenarioId: 'bva', planVersionId: 'v1', periodCode: 'P01' },
    });
    expect(zeroVar.variancePctKind).toBe('zero');
    expect(zeroVar.variancePctFormatted).toBe('0.00%');

    // negative_plan -> 4090 in P07: actual -3500 vs plan -5000 => +1500 (+30.00% fav)
    const negGrain = getGrain('4090', 'P07');
    const negVar = computeVariance({
      accountType: 'revenue',
      actual: money(negGrain.actualAmount),
      plan: money(negGrain.budgetAmount),
      basis: { scenarioId: 'bva', planVersionId: 'v1', periodCode: 'P07' },
    });
    expect(negVar.varianceAmount?.toFixed(2)).toBe('1500.00');
    expect(negVar.variancePctFormatted).toBe('30.00%');
    expect(negVar.favorability).toBe('favorable');
  });

  it('C3 & C4: satisfies full A1–A5 articulation in /core AND ties 100% identically to independent BigInt oracle', () => {
    const { parsed: corpus } = readCommittedCorpus();
    const oracleExpected = JSON.parse(
      readFileSync(join(process.cwd(), 'fixtures/oracles/expected/corpus_expected.json'), 'utf8'),
    ) as ReturnType<typeof computeIndependentCorpusOracle>;

    const independentRecompute = computeIndependentCorpusOracle(corpus);
    expect(independentRecompute).toEqual(oracleExpected);

    const openingMap = new Map<string, ReturnType<typeof money>>();
    for (const [key, cents] of Object.entries(corpus.openingBalanceSheetMinor)) {
      openingMap.set(key, fromMinorUnits(cents, 2));
    }
    const acctByCode = new Map(corpus.coa.map((a) => [a.code, a]));

    const bundle = buildArticulatingStatements({
      accounts: corpus.coa,
      openingBalancesByKey: openingMap,
      periodGlLines: corpus.glLines.map((l) => ({
        entryId: l.entryId,
        accountId: acctByCode.get(l.accountCode)!.id,
        periodId: l.periodCode,
        debit: fromMinorUnits(l.debitMinor, 2),
        credit: fromMinorUnits(l.creditMinor, 2),
      })),
    });

    expect(bundle.articulation.valid).toBe(true);
    for (const check of bundle.articulation.checks) {
      expect(check.passed, `Corpus invariant ${check.id} failed`).toBe(true);
    }

    // Verify /core statement numbers match independent non-/core BigInt oracle down to the exact cent
    expect(serialize(bundle.trialBalance.totalDebit, 2)).toBe(oracleExpected.trialBalance.totalDebits);
    expect(serialize(bundle.trialBalance.totalCredit, 2)).toBe(oracleExpected.trialBalance.totalCredits);
    expect(serialize(bundle.pnl.revenue, 2)).toBe(oracleExpected.pnl.revenue);
    expect(serialize(bundle.pnl.cogs, 2)).toBe(oracleExpected.pnl.cogs);
    expect(serialize(bundle.pnl.grossProfit, 2)).toBe(oracleExpected.pnl.grossProfit);
    expect(serialize(bundle.pnl.opex, 2)).toBe(oracleExpected.pnl.opex);
    expect(serialize(bundle.pnl.ebitda, 2)).toBe(oracleExpected.pnl.ebitda);
    expect(serialize(bundle.pnl.depreciation, 2)).toBe(oracleExpected.pnl.depreciation);
    expect(serialize(bundle.pnl.ebit, 2)).toBe(oracleExpected.pnl.ebit);
    expect(serialize(bundle.pnl.netIncome, 2)).toBe(oracleExpected.pnl.netIncome);

    expect(serialize(bundle.balanceSheet.totalAssets, 2)).toBe(oracleExpected.balanceSheet.totalAssets);
    expect(serialize(bundle.balanceSheet.totalLiabilities, 2)).toBe(oracleExpected.balanceSheet.totalLiabilities);
    expect(serialize(bundle.balanceSheet.totalEquity, 2)).toBe(oracleExpected.balanceSheet.totalEquity);
    expect(serialize(bundle.balanceSheet.cashBalance, 2)).toBe(oracleExpected.balanceSheet.cashBalance);

    expect(serialize(bundle.cashFlow.beginningCash, 2)).toBe(oracleExpected.cashFlow.beginningCash);
    expect(serialize(bundle.cashFlow.operatingCashFlow, 2)).toBe(oracleExpected.cashFlow.operatingCashFlow);
    expect(serialize(bundle.cashFlow.investingCashFlow, 2)).toBe(oracleExpected.cashFlow.investingCashFlow);
    expect(serialize(bundle.cashFlow.financingCashFlow, 2)).toBe(oracleExpected.cashFlow.financingCashFlow);
    expect(serialize(bundle.cashFlow.endingCash, 2)).toBe(oracleExpected.cashFlow.endingCash);

    // Cross-check A1-A5 explicitly with verifyArticulation using opening RE and total expense
    const pnlExpenseTotal = add(
      bundle.pnl.cogs,
      add(bundle.pnl.opex, add(bundle.pnl.depreciation, add(negate(bundle.pnl.nonOperatingNet), bundle.pnl.tax))),
    );
    const dist = negate(sum([bundle.balanceSheet.byKey.get('bs.equity.distributions') ?? money('0')]));
    const artCheck = verifyArticulation({
      totalDebits: bundle.trialBalance.totalDebit,
      totalCredits: bundle.trialBalance.totalCredit,
      pnlRevenue: bundle.pnl.revenue,
      pnlExpense: pnlExpenseTotal,
      pnlNetIncome: bundle.pnl.netIncome,
      bsAssets: bundle.balanceSheet.totalAssets,
      bsLiabilities: bundle.balanceSheet.totalLiabilities,
      bsEquity: bundle.balanceSheet.totalEquity,
      openingRetainedEarnings: money(oracleExpected.retainedEarnings.opening),
      distributions: dist,
      closingRetainedEarnings: money(oracleExpected.retainedEarnings.closingTotal),
      cfBeginningCash: bundle.cashFlow.beginningCash,
      cfOperating: bundle.cashFlow.operatingCashFlow,
      cfInvesting: bundle.cashFlow.investingCashFlow,
      cfFinancing: bundle.cashFlow.financingCashFlow,
      cfEndingCash: bundle.cashFlow.endingCash,
      bsCash: bundle.balanceSheet.cashBalance,
    });
    expect(artCheck.valid).toBe(true);
  });
});
