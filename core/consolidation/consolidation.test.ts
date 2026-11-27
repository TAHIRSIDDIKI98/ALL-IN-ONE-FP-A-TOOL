import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  consolidateGroup,
  computeFxRevaluation,
  ConsolidationError,
  type ConsolidationInput,
  type MonetaryRevaluationItemInput,
} from './index.js';

const ORACLE = JSON.parse(
  readFileSync(join(process.cwd(), 'fixtures/oracles/consolidation/consolidation_oracle.json'), 'utf8'),
) as {
  input: ConsolidationInput;
  expected: {
    status: string;
    totalAssets: string;
    totalLiabilities: string;
    totalEquityBeforeNci: string;
    totalCta: string;
    totalGroupEquity: string;
    minorityInterest: string;
    controllingEquity: string;
    totalRevenue: string;
    totalExpenses: string;
    consolidatedNetIncome: string;
    nciNetIncome: string;
    controllingNetIncome: string;
    totalEliminations: string;
    unmatchedIcCount: number;
    groupTbBalanced: boolean;
    groupBsBalanced: boolean;
    accountingEquationImbalance: string;
    entityCta: Record<string, { totalCta: string; openingEquityRateEffect: string; netIncomeRateEffect: string }>;
    ukMinorityInterest: {
      ownershipPct: string;
      minorityPct: string;
      subsidiaryNetEquity: string;
      nciNetIncomeShare: string;
      nciEquityShare: string;
      nciTotalBalance: string;
    };
    ic: Record<string, { eliminatedAmount: string; unmatchedDifference: string; status: string }>;
  };
  revaluationInput: {
    functionalCurrency: string;
    items: readonly MonetaryRevaluationItemInput[];
  };
  revaluationExpected: {
    realizedTotal: string;
    unrealizedTotal: string;
    netRevaluationTotal: string;
    journalBalanced: boolean;
  };
};

describe('WI-0047 /core/consolidation (P25, §11.6 FX1–FX5)', () => {
  it('ties multi-entity translation, computed CTA, IC eliminations/residuals, NCI, and balanced BS to hand-computed oracle', () => {
    const result = consolidateGroup(ORACLE.input);
    const exp = ORACLE.expected;

    expect(result.status).toBe(exp.status);
    expect(result.totalAssets).toBe(exp.totalAssets);
    expect(result.totalLiabilities).toBe(exp.totalLiabilities);
    expect(result.totalEquityBeforeNci).toBe(exp.totalEquityBeforeNci);
    expect(result.totalCta).toBe(exp.totalCta);
    expect(result.totalGroupEquity).toBe(exp.totalGroupEquity);
    expect(result.minorityInterest).toBe(exp.minorityInterest);
    expect(result.controllingEquity).toBe(exp.controllingEquity);
    expect(result.totalRevenue).toBe(exp.totalRevenue);
    expect(result.totalExpenses).toBe(exp.totalExpenses);
    expect(result.consolidatedNetIncome).toBe(exp.consolidatedNetIncome);
    expect(result.nciNetIncome).toBe(exp.nciNetIncome);
    expect(result.controllingNetIncome).toBe(exp.controllingNetIncome);
    expect(result.totalEliminations).toBe(exp.totalEliminations);
    expect(result.unmatchedIcCount).toBe(exp.unmatchedIcCount);
    expect(result.groupTbBalanced).toBe(exp.groupTbBalanced);
    expect(result.groupBsBalanced).toBe(exp.groupBsBalanced);
    expect(result.accountingEquationImbalance).toBe(exp.accountingEquationImbalance);

    // FX1: CTA attribution per entity
    for (const summary of result.entityTranslations) {
      const entityExp = exp.entityCta[summary.entityCode];
      expect(entityExp).toBeDefined();
      expect(summary.totalCta).toBe(entityExp!.totalCta);
      expect(summary.openingEquityRateEffect).toBe(entityExp!.openingEquityRateEffect);
      expect(summary.netIncomeRateEffect).toBe(entityExp!.netIncomeRateEffect);
    }

    // FX4: 20% NCI on ENT-UK
    expect(result.minorityInterests).toHaveLength(1);
    const ukNci = result.minorityInterests[0]!;
    expect(ukNci.entityCode).toBe('ENT-UK');
    expect(ukNci.ownershipPct).toBe(exp.ukMinorityInterest.ownershipPct);
    expect(ukNci.minorityPct).toBe(exp.ukMinorityInterest.minorityPct);
    expect(ukNci.subsidiaryNetEquity).toBe(exp.ukMinorityInterest.subsidiaryNetEquity);
    expect(ukNci.nciNetIncomeShare).toBe(exp.ukMinorityInterest.nciNetIncomeShare);
    expect(ukNci.nciEquityShare).toBe(exp.ukMinorityInterest.nciEquityShare);
    expect(ukNci.nciTotalBalance).toBe(exp.ukMinorityInterest.nciTotalBalance);

    // FX3: matched IC elimination vs quarantined residual
    for (const ic of result.icReconciliations) {
      const icExp = exp.ic[ic.ruleId];
      expect(icExp).toBeDefined();
      expect(ic.eliminatedAmount).toBe(icExp!.eliminatedAmount);
      expect(ic.unmatchedDifference).toBe(icExp!.unmatchedDifference);
      expect(ic.status).toBe(icExp!.status);
    }
    expect(result.eliminationLines).toHaveLength(4);
    expect(result.groupTbTotalDebit).toBe(result.groupTbTotalCredit);
  });

  it('FX2 splits realized vs unrealized monetary FX revaluation with balanced journal lines', () => {
    const rev = computeFxRevaluation(ORACLE.revaluationInput);
    expect(rev.realizedTotal).toBe(ORACLE.revaluationExpected.realizedTotal);
    expect(rev.unrealizedTotal).toBe(ORACLE.revaluationExpected.unrealizedTotal);
    expect(rev.netRevaluationTotal).toBe(ORACLE.revaluationExpected.netRevaluationTotal);
    expect(rev.journalBalanced).toBe(ORACLE.revaluationExpected.journalBalanced);
    expect(rev.journalLines).toHaveLength(4);
    expect(rev.items[0]?.classification).toBe('unrealized');
    expect(rev.items[0]?.gainLossFunctional).toBe('200.00');
    expect(rev.items[1]?.classification).toBe('realized');
    expect(rev.items[1]?.gainLossFunctional).toBe('-150.00');
  });

  it('rejects missing FX rates (never 0/1 fallback), unbalanced entity TB, and empty entity lists', () => {
    const missingRatesInput: ConsolidationInput = {
      ...ORACLE.input,
      fxRates: ORACLE.input.fxRates.filter((r) => !(r.baseCurrency === 'EUR' && r.rateType === 'historical')),
    };
    expect(() => consolidateGroup(missingRatesInput)).toThrow(ConsolidationError);
    try {
      consolidateGroup(missingRatesInput);
    } catch (err) {
      expect((err as ConsolidationError).code).toBe('MISSING_FX_RATE');
    }

    const unbalancedInput: ConsolidationInput = {
      ...ORACLE.input,
      entities: [
        {
          ...ORACLE.input.entities[0]!,
          lines: [ORACLE.input.entities[0]!.lines[0]!],
        },
      ],
    };
    try {
      consolidateGroup(unbalancedInput);
    } catch (err) {
      expect((err as ConsolidationError).code).toBe('UNBALANCED_ENTITY_TRIAL_BALANCE');
    }

    expect(() =>
      consolidateGroup({
        ...ORACLE.input,
        entities: [],
      }),
    ).toThrow('NO_ENTITIES');
  });
});
