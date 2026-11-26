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

import {
  DEFAULT_M2_CORPUS_CONFIG,
  DEFAULT_M2_CORPUS_SEED,
  generateM2Corpus,
  type GeneratedM2Corpus,
} from './m2_generator.js';
import {
  buildRollingForecast,
  compareScenarios,
  computeDriverPlan,
} from '../../core/planning/index.js';
import { compileWorkforceModuleToDrivers } from '../../core/workforce/index.js';
import { computeIndependentM2CorpusOracle } from '../../scripts/generate-independent-oracles.js';

function readCommittedM2Corpus(): { raw: string; parsed: GeneratedM2Corpus } {
  const raw = readFileSync(join(process.cwd(), 'fixtures/corpus/m2_corpus.json'), 'utf8');
  return { raw, parsed: JSON.parse(raw) as GeneratedM2Corpus };
}

describe('M2 Coherent Corpus v2 — Tenant B, Rolling Forecast, Scenarios & Workforce (§7.8, C1–C4, C8–C9)', () => {
  it('C1 (M2): satisfies byte-reproducible determinism for committed m2_corpus.json and m2_answer_key.json', () => {
    const { raw: committedRaw, parsed: committed } = readCommittedM2Corpus();
    const regenerated = generateM2Corpus(DEFAULT_M2_CORPUS_SEED, DEFAULT_M2_CORPUS_CONFIG);
    const regeneratedJson = `${JSON.stringify(regenerated, null, 2)}\n`;

    expect(regeneratedJson).toBe(committedRaw);
    expect(committed.tenantB.company.name).toBe('Northstar Manufacturing — DEMO — SYNTHETIC DATA');
    expect(committed.tenantB.company.calendarKind).toBe('454');
    // Distinct CoA preserving leading zeros ("001400" alongside "1400")
    expect(committed.tenantB.coa.some((a) => a.code === '001400')).toBe(true);
    expect(committed.tenantB.coa.some((a) => a.code === '1400')).toBe(true);
    expect(committed.workforceCorpus.positions).toHaveLength(6);
  });

  it('C2 & C8 (M2): proves zero unregistered Tenant B noise and full M2 answer_key recall across scenarios & workforce', () => {
    const { parsed: corpus } = readCommittedM2Corpus();
    const answerKeyFile = JSON.parse(
      readFileSync(join(process.cwd(), 'fixtures/corpus/m2_answer_key.json'), 'utf8'),
    ) as { items: GeneratedM2Corpus['answerKey'] };

    expect(answerKeyFile.items).toEqual(corpus.answerKey);

    const registeredByGrain = new Map<string, ReturnType<typeof money>>();
    for (const d of corpus.tenantB.deviations) {
      const key = `${d.grain.account_code}::${d.grain.period}`;
      const prev = registeredByGrain.get(key) ?? money('0');
      registeredByGrain.set(key, add(prev, money(d.amount)));
    }

    const validCodes = new Set(corpus.tenantB.coa.map((a) => a.code));
    for (const line of corpus.tenantB.actuals) {
      const grainKey = `${line.accountCode}::${line.periodCode}`;
      const actualDiff = sub(money(line.actualAmount), money(line.budgetAmount));
      const expectedDiff = registeredByGrain.get(grainKey) ?? money('0');
      expect(actualDiff.eq(expectedDiff), `Unregistered Tenant B variance at ${grainKey}`).toBe(true);
    }

    for (const item of corpus.answerKey) {
      expect(validCodes.has(item.grain.account_code)).toBe(true);
      expect(item.statement_line_key.length).toBeGreaterThan(0);
    }

    // Required M2 answer key domains: Tenant B variance, rolling forecast, scenarios, ramp, attrition, inactive, isolation
    const domains = new Set(corpus.answerKey.map((i) => i.domain));
    expect(domains).toEqual(
      new Set([
        'tenant_b_variance',
        'rolling_forecast',
        'scenario_delta',
        'workforce_ramp',
        'workforce_attrition',
        'workforce_inactive_excluded',
        'tenant_isolation',
      ]),
    );
  });

  it('C3 & C4 (M2): ties Tenant B A1–A5 statements, rolling forecast, scenario comparison & workforce payroll to independent BigInt oracle', () => {
    const { parsed: corpus } = readCommittedM2Corpus();
    const oracleExpected = JSON.parse(
      readFileSync(join(process.cwd(), 'fixtures/oracles/expected/m2_corpus_expected.json'), 'utf8'),
    ) as ReturnType<typeof computeIndependentM2CorpusOracle>;

    const recomputedOracle = computeIndependentM2CorpusOracle(corpus);
    expect(recomputedOracle).toEqual(oracleExpected);

    // 1. Tenant B statements & A1-A5 tie-out
    const openingMap = new Map<string, ReturnType<typeof money>>();
    for (const [key, cents] of Object.entries(corpus.tenantB.openingBalanceSheetMinor)) {
      openingMap.set(key, fromMinorUnits(cents, 2));
    }
    const acctByCode = new Map(corpus.tenantB.coa.map((a) => [a.code, a]));
    const tbBundle = buildArticulatingStatements({
      accounts: corpus.tenantB.coa,
      openingBalancesByKey: openingMap,
      periodGlLines: corpus.tenantB.glLines.map((l) => ({
        entryId: l.entryId,
        accountId: acctByCode.get(l.accountCode)!.id,
        periodId: l.periodCode,
        debit: fromMinorUnits(l.debitMinor, 2),
        credit: fromMinorUnits(l.creditMinor, 2),
      })),
    });

    expect(tbBundle.articulation.valid).toBe(true);
    expect(serialize(tbBundle.trialBalance.totalDebit, 2)).toBe(oracleExpected.tenantB.trialBalance.totalDebits);
    expect(serialize(tbBundle.trialBalance.totalCredit, 2)).toBe(oracleExpected.tenantB.trialBalance.totalCredits);
    expect(serialize(tbBundle.pnl.netIncome, 2)).toBe(oracleExpected.tenantB.pnl.netIncome);
    expect(serialize(tbBundle.balanceSheet.totalAssets, 2)).toBe(oracleExpected.tenantB.balanceSheet.totalAssets);
    expect(serialize(tbBundle.cashFlow.endingCash, 2)).toBe(oracleExpected.tenantB.cashFlow.endingCash);

    // 2. Rolling forecast & scenario comparison tie-out
    const basePlan = computeDriverPlan({
      periods: corpus.scenarioCorpus.periods,
      drivers: corpus.scenarioCorpus.scenarios.base.drivers,
      currencyScale: 2,
    });
    const upsidePlan = computeDriverPlan({
      periods: corpus.scenarioCorpus.periods,
      drivers: corpus.scenarioCorpus.scenarios.upside.drivers,
      currencyScale: 2,
    });
    const downsidePlan = computeDriverPlan({
      periods: corpus.scenarioCorpus.periods,
      drivers: corpus.scenarioCorpus.scenarios.downside.drivers,
      currencyScale: 2,
    });
    expect(basePlan.ok && upsidePlan.ok && downsidePlan.ok).toBe(true);
    if (!basePlan.ok || !upsidePlan.ok || !downsidePlan.ok) return;

    expect(basePlan.grandTotal).toBe(oracleExpected.scenarios.baseGrandTotal);
    expect(upsidePlan.grandTotal).toBe(oracleExpected.scenarios.upsideGrandTotal);
    expect(downsidePlan.grandTotal).toBe(oracleExpected.scenarios.downsideGrandTotal);

    const rf = buildRollingForecast({
      periods: corpus.rollingForecastCorpus.periods,
      cutoffPeriod: corpus.rollingForecastCorpus.cutoffPeriod,
      actuals: corpus.rollingForecastCorpus.actualFacts,
      forecast: upsidePlan.lines.map((l) => ({
        accountCode: l.accountCode,
        periodCode: l.periodCode,
        amount: l.amount,
      })),
      currencyScale: 2,
    });
    expect(rf.ok).toBe(true);
    if (!rf.ok) return;
    expect(rf.totalActual).toBe(oracleExpected.rollingForecast.totalActual);
    expect(rf.totalForecast).toBe(oracleExpected.rollingForecast.totalForecast);
    expect(rf.totalFullHorizon).toBe(oracleExpected.rollingForecast.totalFullHorizon);
    expect(rf.totalMissingCells).toBe(oracleExpected.rollingForecast.totalMissingCells);

    const cmpUpside = compareScenarios({
      baseScenarioName: 'Base Budget',
      targetScenarioName: 'Upside Forecast',
      baseLines: basePlan.lines,
      targetLines: upsidePlan.lines,
      currencyScale: 2,
    });
    const cmpDownside = compareScenarios({
      baseScenarioName: 'Base Budget',
      targetScenarioName: 'Downside Case',
      baseLines: basePlan.lines,
      targetLines: downsidePlan.lines,
      currencyScale: 2,
    });
    expect(cmpUpside.totalDelta).toBe(oracleExpected.scenarios.baseVsUpsideTotalDelta);
    expect(cmpDownside.totalDelta).toBe(oracleExpected.scenarios.baseVsDownsideTotalDelta);
    expect(cmpUpside.rows.find((r) => r.accountCode === '4200')?.deltaPctStatus).toBe('nm');
    expect(cmpUpside.rows.find((r) => r.accountCode === '4900')?.deltaPctStatus).toBe('zero');
    expect(cmpDownside.rows.find((r) => r.accountCode === '6400')?.baseTotal).toBeNull();

    // 3. Workforce corpus (ramp, merit, attrition, inactive excluded) tie-out
    const wf = compileWorkforceModuleToDrivers({
      periods: corpus.workforceCorpus.periods,
      positions: corpus.workforceCorpus.positions,
      currencyScale: 2,
      periodsInYear: 12,
    });
    expect(wf.ok).toBe(true);
    if (!wf.ok) return;
    expect(wf.grandTotalFteMonths).toBe(oracleExpected.workforce.grandTotalFteMonths);
    expect(wf.grandTotalCost).toBe(oracleExpected.workforce.grandTotalCost);
    expect(wf.positionSummaries).toHaveLength(oracleExpected.workforce.activePositionCount);
    expect(
      wf.positionPeriodRows.find((r) => r.positionCode === 'WF-CSM-03' && r.periodCode === 'P04')?.totalCost,
    ).toBe(oracleExpected.workforce.rampP04Cost);
    expect(
      wf.positionPeriodRows.find((r) => r.positionCode === 'WF-FIN-05' && r.periodCode === 'P06')?.totalCost,
    ).toBe(oracleExpected.workforce.attritionP06Cost);
    for (const expPos of oracleExpected.workforce.positionSummaries) {
      const actualPos = wf.positionSummaries.find((p) => p.positionCode === expPos.positionCode);
      expect(actualPos?.fteMonths).toBe(expPos.fteMonths);
      expect(actualPos?.totalBasePay).toBe(expPos.totalBasePay);
      expect(actualPos?.totalBenefits).toBe(expPos.totalBenefits);
      expect(actualPos?.totalBonus).toBe(expPos.totalBonus);
      expect(actualPos?.totalCost).toBe(expPos.totalCost);
    }
  });
});
