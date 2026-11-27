// Ported from fp-A-betterversion/src/engines/ConsolidationEngine.ts, FXEngine.ts, IntercompanyMatchingEngine.ts @ 86d785ca696c. Class B.
// Changes: Re-implemented as pure functions with zero static mutable state, zero JS float math,
// zero Math.abs/.abs()/Number()/.toFixed() on money, strict MissingFxRateError (never 0/1 fallback),
// ASC 830 / IAS 21 computed CTA (A7, never plugged), realized/unrealized FX revaluation (FX2),
// zero-net IC eliminations with unmatched residual quarantine (FX3), and NCI + balanced consolidated BS (FX4).
// Oracle: fixtures/oracles/consolidation/consolidation_oracle.json.

import Decimal from 'decimal.js';
import {
  add,
  compare,
  div,
  eq,
  money,
  mul,
  negate,
  round,
  scaleForCurrency,
  serialize,
  sub,
} from '../money/index.js';
import { normalizeCode, type AccountType, type NormalSide } from '../statements/index.js';

export type FxRateType = 'closing' | 'average' | 'historical';
export type FxRateSource = 'manual' | 'ecb' | 'fed' | 'bloomberg' | 'erp_feed';
export type ConsolidationMethod = 'full' | 'equity' | 'cost';
export type IntercompanyRuleType =
  | 'ic_receivable_payable'
  | 'ic_revenue_expense'
  | 'ic_investment_equity'
  | 'ic_dividend'
  | 'ic_loan';

export interface FxRateRecord {
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  readonly rateType: FxRateType;
  readonly asOfDate: string;
  readonly rate: string;
  readonly source: FxRateSource;
}

export interface ConsolidationEntityAccountLine {
  readonly accountCode: string;
  readonly accountName: string;
  readonly accountType: AccountType;
  readonly normalSide: NormalSide;
  readonly statementLineKey: string;
  readonly debit: string;
  readonly credit: string;
}

export interface ConsolidationEntityInput {
  readonly entityId: string;
  readonly entityCode: string;
  readonly entityName: string;
  readonly functionalCurrency: string;
  readonly lines: readonly ConsolidationEntityAccountLine[];
}

export interface EntityOwnershipInput {
  readonly parentEntityId: string;
  readonly childEntityId: string;
  readonly ownershipPct: string;
  readonly method: ConsolidationMethod;
}

export interface IntercompanyRuleInput {
  readonly ruleId: string;
  readonly fromEntityId: string;
  readonly fromEntityCode: string;
  readonly fromAccountCode: string;
  readonly toEntityId: string;
  readonly toEntityCode: string;
  readonly toAccountCode: string;
  readonly ruleType: IntercompanyRuleType;
  readonly description: string;
}

export interface ConsolidationInput {
  readonly reportingCurrency: string;
  readonly asOfDate: string;
  readonly entities: readonly ConsolidationEntityInput[];
  readonly ownerships: readonly EntityOwnershipInput[];
  readonly fxRates: readonly FxRateRecord[];
  readonly icRules: readonly IntercompanyRuleInput[];
  readonly ctaAccountCode?: string;
  readonly ctaAccountName?: string;
}

export interface EntityTranslationSummary {
  readonly entityId: string;
  readonly entityCode: string;
  readonly entityName: string;
  readonly functionalCurrency: string;
  readonly reportingCurrency: string;
  readonly method: ConsolidationMethod;
  readonly ownershipPct: string;
  readonly closingRate: string;
  readonly averageRate: string;
  readonly historicalRate: string;
  readonly localTotalDebit: string;
  readonly localTotalCredit: string;
  readonly translatedAssets: string;
  readonly translatedLiabilities: string;
  readonly translatedOpeningEquity: string;
  readonly translatedRevenue: string;
  readonly translatedExpenses: string;
  readonly translatedNetIncome: string;
  readonly openingEquityRateEffect: string;
  readonly netIncomeRateEffect: string;
  readonly roundingResidual: string;
  readonly totalCta: string;
}

export interface MinorityInterestDetail {
  readonly entityId: string;
  readonly entityCode: string;
  readonly entityName: string;
  readonly ownershipPct: string;
  readonly minorityPct: string;
  readonly subsidiaryNetEquity: string;
  readonly subsidiaryNetIncome: string;
  readonly nciNetIncomeShare: string;
  readonly nciEquityShare: string;
  readonly nciTotalBalance: string;
}

export interface IntercompanyEliminationItem {
  readonly ruleId: string;
  readonly ruleType: IntercompanyRuleType;
  readonly fromEntityCode: string;
  readonly fromAccountCode: string;
  readonly toEntityCode: string;
  readonly toAccountCode: string;
  readonly fromTranslatedBalance: string;
  readonly toTranslatedBalance: string;
  readonly eliminatedAmount: string;
  readonly unmatchedDifference: string;
  readonly status: 'matched' | 'unmatched_difference';
  readonly quarantineReason: string | null;
  readonly description: string;
}

export interface EliminationJournalLine {
  readonly ruleId: string;
  readonly entityCode: string;
  readonly accountCode: string;
  readonly debit: string;
  readonly credit: string;
  readonly description: string;
}

export interface ConsolidatedTrialBalanceLine {
  readonly accountCode: string;
  readonly accountName: string;
  readonly accountType: AccountType;
  readonly normalSide: NormalSide;
  readonly preEliminationNatural: string;
  readonly eliminationNatural: string;
  readonly consolidatedNatural: string;
  readonly debit: string;
  readonly credit: string;
}

export interface ConsolidationResult {
  readonly reportingCurrency: string;
  readonly asOfDate: string;
  readonly status: 'completed' | 'quarantined_residuals';
  readonly ctaAccountCode: string;
  readonly ctaAccountName: string;
  readonly entityTranslations: readonly EntityTranslationSummary[];
  readonly minorityInterests: readonly MinorityInterestDetail[];
  readonly icReconciliations: readonly IntercompanyEliminationItem[];
  readonly eliminationLines: readonly EliminationJournalLine[];
  readonly consolidatedTrialBalance: readonly ConsolidatedTrialBalanceLine[];
  readonly totalAssets: string;
  readonly totalLiabilities: string;
  readonly totalEquityBeforeNci: string;
  readonly controllingEquity: string;
  readonly minorityInterest: string;
  readonly totalGroupEquity: string;
  readonly totalCta: string;
  readonly totalRevenue: string;
  readonly totalExpenses: string;
  readonly consolidatedNetIncome: string;
  readonly controllingNetIncome: string;
  readonly nciNetIncome: string;
  readonly totalEliminations: string;
  readonly unmatchedIcCount: number;
  readonly hasUnmatchedIc: boolean;
  readonly groupTbTotalDebit: string;
  readonly groupTbTotalCredit: string;
  readonly groupTbBalanced: boolean;
  readonly accountingEquationImbalance: string;
  readonly groupBsBalanced: boolean;
}

export interface MonetaryRevaluationItemInput {
  readonly itemKey: string;
  readonly entityCode: string;
  readonly accountCode: string;
  readonly accountType: 'asset' | 'liability';
  readonly foreignCurrency: string;
  readonly functionalCurrency: string;
  readonly foreignAmount: string;
  readonly bookingRate: string;
  readonly periodEndRate: string;
  readonly settled: boolean;
  readonly settlementRate?: string;
}

export interface MonetaryRevaluationItemResult {
  readonly itemKey: string;
  readonly entityCode: string;
  readonly accountCode: string;
  readonly foreignCurrency: string;
  readonly functionalCurrency: string;
  readonly foreignAmount: string;
  readonly bookingAmountFunctional: string;
  readonly valuationRate: string;
  readonly revaluedAmountFunctional: string;
  readonly classification: 'realized' | 'unrealized';
  readonly gainLossFunctional: string;
}

export interface RevaluationJournalLine {
  readonly entityCode: string;
  readonly accountCode: string;
  readonly debit: string;
  readonly credit: string;
  readonly memo: string;
}

export interface MonetaryRevaluationResult {
  readonly reportingOrFunctionalCurrency: string;
  readonly items: readonly MonetaryRevaluationItemResult[];
  readonly realizedTotal: string;
  readonly unrealizedTotal: string;
  readonly netRevaluationTotal: string;
  readonly journalLines: readonly RevaluationJournalLine[];
  readonly journalBalanced: boolean;
}

export class ConsolidationError extends Error {
  public readonly code: string;
  public readonly details: Readonly<Record<string, string>>;

  constructor(code: string, message: string, details: Readonly<Record<string, string>> = {}) {
    super(`${code}: ${message}`);
    this.name = 'ConsolidationError';
    this.code = code;
    this.details = details;
  }
}

function absDecimal(value: Decimal): Decimal {
  return value.isNegative() ? negate(value) : value;
}

function minDecimal(a: Decimal, b: Decimal): Decimal {
  return compare(a, b) <= 0 ? a : b;
}

function parsePositiveDecimal(raw: string, code: string, label: string): Decimal {
  let d: Decimal;
  try {
    d = money(raw);
  } catch {
    throw new ConsolidationError(code, `Invalid decimal value for ${label}: "${raw}".`);
  }
  if (!d.isPositive()) {
    throw new ConsolidationError(code, `${label} must be strictly positive (got "${raw}").`);
  }
  return d;
}

function normalizeCurrency(code: string): string {
  const norm = code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(norm)) {
    throw new ConsolidationError('INVALID_CURRENCY', `Invalid ISO currency code "${code}".`);
  }
  scaleForCurrency(norm);
  return norm;
}

/**
 * Latest-on-or-before FX lookup (Q1 FXEngine policy, FX5).
 * Never substitutes 0 or 1 when a rate is missing.
 */
export function resolveFxRate(params: {
  readonly fxRates: readonly FxRateRecord[];
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  readonly rateType: FxRateType;
  readonly asOfDate: string;
}): Decimal {
  const base = normalizeCurrency(params.baseCurrency);
  const quote = normalizeCurrency(params.quoteCurrency);
  if (base === quote) {
    return money('1');
  }
  let best: FxRateRecord | null = null;
  for (const r of params.fxRates) {
    if (
      r.baseCurrency.trim().toUpperCase() === base &&
      r.quoteCurrency.trim().toUpperCase() === quote &&
      r.rateType === params.rateType &&
      r.asOfDate <= params.asOfDate
    ) {
      if (best === null || r.asOfDate > best.asOfDate) {
        best = r;
      }
    }
  }
  if (best === null) {
    throw new ConsolidationError(
      'MISSING_FX_RATE',
      `Missing ${params.rateType} FX rate ${base}->${quote} on or before ${params.asOfDate}.`,
      { baseCurrency: base, quoteCurrency: quote, rateType: params.rateType, asOfDate: params.asOfDate },
    );
  }
  return parsePositiveDecimal(best.rate, 'INVALID_FX_RATE', `${base}->${quote} ${params.rateType}`);
}

function rateTypeForAccount(type: AccountType): FxRateType {
  if (type === 'revenue' || type === 'expense') return 'average';
  if (type === 'equity') return 'historical';
  return 'closing';
}

function naturalFromDebitCredit(normalSide: NormalSide, debit: Decimal, credit: Decimal): Decimal {
  return normalSide === 'debit' ? sub(debit, credit) : sub(credit, debit);
}

/**
 * Computes ASC 830 / IAS 21 translation, CTA (A7), IC eliminations + residual quarantine (FX3),
 * NCI (FX4), and consolidated Balance Sheet / Trial Balance tie-out.
 */
export function consolidateGroup(input: ConsolidationInput): ConsolidationResult {
  const reportingCurrency = normalizeCurrency(input.reportingCurrency);
  const scale = scaleForCurrency(reportingCurrency);
  const ctaAccountCode = normalizeCode(input.ctaAccountCode ?? '3900');
  const ctaAccountName = (input.ctaAccountName ?? 'Cumulative Translation Adjustment').trim();

  if (input.entities.length === 0) {
    throw new ConsolidationError('NO_ENTITIES', 'At least one reporting entity is required to consolidate.');
  }

  const ownershipByChild = new Map<string, EntityOwnershipInput>();
  for (const rel of input.ownerships) {
    if (rel.parentEntityId === rel.childEntityId) {
      throw new ConsolidationError('INVALID_OWNERSHIP', 'Parent and child entity cannot be identical.');
    }
    const pct = parsePositiveDecimal(rel.ownershipPct, 'INVALID_OWNERSHIP_PCT', 'ownershipPct');
    if (compare(pct, money('100')) > 0) {
      throw new ConsolidationError('INVALID_OWNERSHIP_PCT', 'Ownership percentage cannot exceed 100.');
    }
    ownershipByChild.set(rel.childEntityId, rel);
  }

  const entityTranslations: EntityTranslationSummary[] = [];
  const minorityInterests: MinorityInterestDetail[] = [];

  // Per-(entityId, accountCode) translated debit-minus-credit balance for IC matching
  const translatedLegBalance = new Map<string, Decimal>();

  interface TbAccumulator {
    accountCode: string;
    accountName: string;
    accountType: AccountType;
    normalSide: NormalSide;
    preElimDebit: Decimal;
    preElimCredit: Decimal;
    elimDebit: Decimal;
    elimCredit: Decimal;
  }
  const tbMap = new Map<string, TbAccumulator>();

  function addTbLeg(params: {
    accountCode: string;
    accountName: string;
    accountType: AccountType;
    normalSide: NormalSide;
    debit: Decimal;
    credit: Decimal;
    isElimination: boolean;
  }): void {
    const existing = tbMap.get(params.accountCode);
    if (existing === undefined) {
      tbMap.set(params.accountCode, {
        accountCode: params.accountCode,
        accountName: params.accountName,
        accountType: params.accountType,
        normalSide: params.normalSide,
        preElimDebit: params.isElimination ? money('0') : params.debit,
        preElimCredit: params.isElimination ? money('0') : params.credit,
        elimDebit: params.isElimination ? params.debit : money('0'),
        elimCredit: params.isElimination ? params.credit : money('0'),
      });
      return;
    }
    if (params.isElimination) {
      existing.elimDebit = add(existing.elimDebit, params.debit);
      existing.elimCredit = add(existing.elimCredit, params.credit);
    } else {
      existing.preElimDebit = add(existing.preElimDebit, params.debit);
      existing.preElimCredit = add(existing.preElimCredit, params.credit);
    }
  }

  let groupTotalAssets = money('0');
  let groupTotalLiabilities = money('0');
  let groupTotalOpeningEquity = money('0');
  let groupTotalRevenue = money('0');
  let groupTotalExpenses = money('0');
  let groupTotalCta = money('0');
  let groupNciTotal = money('0');
  let groupNciNetIncome = money('0');

  for (const entity of input.entities) {
    const funcCurrency = normalizeCurrency(entity.functionalCurrency);
    const funcScale = scaleForCurrency(funcCurrency);
    const ownership = ownershipByChild.get(entity.entityId);
    const method: ConsolidationMethod = ownership?.method ?? 'full';
    const ownershipPctDec = ownership === undefined ? money('100') : money(ownership.ownershipPct);

    const closingRate = resolveFxRate({
      fxRates: input.fxRates,
      baseCurrency: funcCurrency,
      quoteCurrency: reportingCurrency,
      rateType: 'closing',
      asOfDate: input.asOfDate,
    });
    const averageRate = resolveFxRate({
      fxRates: input.fxRates,
      baseCurrency: funcCurrency,
      quoteCurrency: reportingCurrency,
      rateType: 'average',
      asOfDate: input.asOfDate,
    });
    const historicalRate = resolveFxRate({
      fxRates: input.fxRates,
      baseCurrency: funcCurrency,
      quoteCurrency: reportingCurrency,
      rateType: 'historical',
      asOfDate: input.asOfDate,
    });

    let localDebitSum = money('0');
    let localCreditSum = money('0');
    let localOpeningEquity = money('0');
    let localRevenue = money('0');
    let localExpenses = money('0');

    let translatedAssets = money('0');
    let translatedLiabilities = money('0');
    let translatedOpeningEquity = money('0');
    let translatedRevenue = money('0');
    let translatedExpenses = money('0');

    for (const line of entity.lines) {
      const code = normalizeCode(line.accountCode);
      const localDebit = money(line.debit);
      const localCredit = money(line.credit);
      localDebitSum = add(localDebitSum, localDebit);
      localCreditSum = add(localCreditSum, localCredit);

      const rType = rateTypeForAccount(line.accountType);
      const rate =
        rType === 'closing' ? closingRate : rType === 'average' ? averageRate : historicalRate;

      const trDebit = round(mul(localDebit, rate), scale, 'HALF_UP');
      const trCredit = round(mul(localCredit, rate), scale, 'HALF_UP');

      // Record translated debit-minus-credit leg for IC matching even before method split
      const legKey = `${entity.entityId}|${code}`;
      const prevLeg = translatedLegBalance.get(legKey) ?? money('0');
      translatedLegBalance.set(legKey, add(prevLeg, sub(trDebit, trCredit)));

      // Natural balance in local & translated currency
      const localNatural = naturalFromDebitCredit(line.normalSide, localDebit, localCredit);
      const localSheetDir =
        line.accountType === 'asset' || line.accountType === 'expense'
          ? sub(localDebit, localCredit)
          : sub(localCredit, localDebit);
      const trSheetDir =
        line.accountType === 'asset' || line.accountType === 'expense'
          ? sub(trDebit, trCredit)
          : sub(trCredit, trDebit);

      if (line.accountType === 'asset') {
        translatedAssets = add(translatedAssets, trSheetDir);
      } else if (line.accountType === 'liability') {
        translatedLiabilities = add(translatedLiabilities, trSheetDir);
      } else if (line.accountType === 'equity') {
        localOpeningEquity = add(localOpeningEquity, localSheetDir);
        translatedOpeningEquity = add(translatedOpeningEquity, trSheetDir);
      } else if (line.accountType === 'revenue') {
        localRevenue = add(localRevenue, localNatural);
        translatedRevenue = add(translatedRevenue, naturalFromDebitCredit(line.normalSide, trDebit, trCredit));
      } else if (line.accountType === 'expense') {
        localExpenses = add(localExpenses, localNatural);
        translatedExpenses = add(translatedExpenses, naturalFromDebitCredit(line.normalSide, trDebit, trCredit));
      }

      if (method === 'full') {
        addTbLeg({
          accountCode: code,
          accountName: line.accountName,
          accountType: line.accountType,
          normalSide: line.normalSide,
          debit: trDebit,
          credit: trCredit,
          isElimination: false,
        });
      }
    }

    if (!eq(round(localDebitSum, funcScale, 'HALF_UP'), round(localCreditSum, funcScale, 'HALF_UP'))) {
      throw new ConsolidationError(
        'UNBALANCED_ENTITY_TRIAL_BALANCE',
        `Entity ${entity.entityCode} trial balance is unbalanced in ${funcCurrency} (debit=${serialize(localDebitSum, funcScale)}, credit=${serialize(localCreditSum, funcScale)}).`,
        { entityCode: entity.entityCode },
      );
    }

    const localNetIncome = sub(localRevenue, localExpenses);
    const translatedNetIncome = sub(translatedRevenue, translatedExpenses);

    // Computed CTA (A7 — never plugged): Assets - Liabilities - OpeningEquity - NetIncome
    const totalCta = sub(
      translatedAssets,
      add(translatedLiabilities, add(translatedOpeningEquity, translatedNetIncome)),
    );
    const openingEquityRateEffect = round(
      mul(localOpeningEquity, sub(closingRate, historicalRate)),
      scale,
      'HALF_UP',
    );
    const netIncomeRateEffect = round(
      mul(localNetIncome, sub(closingRate, averageRate)),
      scale,
      'HALF_UP',
    );
    const roundingResidual = sub(totalCta, add(openingEquityRateEffect, netIncomeRateEffect));

    entityTranslations.push({
      entityId: entity.entityId,
      entityCode: entity.entityCode,
      entityName: entity.entityName,
      functionalCurrency: funcCurrency,
      reportingCurrency,
      method,
      ownershipPct: serialize(ownershipPctDec, 2),
      closingRate: serialize(closingRate, 6),
      averageRate: serialize(averageRate, 6),
      historicalRate: serialize(historicalRate, 6),
      localTotalDebit: serialize(localDebitSum, funcScale),
      localTotalCredit: serialize(localCreditSum, funcScale),
      translatedAssets: serialize(translatedAssets, scale),
      translatedLiabilities: serialize(translatedLiabilities, scale),
      translatedOpeningEquity: serialize(translatedOpeningEquity, scale),
      translatedRevenue: serialize(translatedRevenue, scale),
      translatedExpenses: serialize(translatedExpenses, scale),
      translatedNetIncome: serialize(translatedNetIncome, scale),
      openingEquityRateEffect: serialize(openingEquityRateEffect, scale),
      netIncomeRateEffect: serialize(netIncomeRateEffect, scale),
      roundingResidual: serialize(roundingResidual, scale),
      totalCta: serialize(totalCta, scale),
    });

    if (method === 'full') {
      groupTotalAssets = add(groupTotalAssets, translatedAssets);
      groupTotalLiabilities = add(groupTotalLiabilities, translatedLiabilities);
      groupTotalOpeningEquity = add(groupTotalOpeningEquity, translatedOpeningEquity);
      groupTotalRevenue = add(groupTotalRevenue, translatedRevenue);
      groupTotalExpenses = add(groupTotalExpenses, translatedExpenses);
      groupTotalCta = add(groupTotalCta, totalCta);

      if (!totalCta.isZero()) {
        addTbLeg({
          accountCode: ctaAccountCode,
          accountName: ctaAccountName,
          accountType: 'equity',
          normalSide: 'credit',
          debit: totalCta.isNegative() ? negate(totalCta) : money('0'),
          credit: totalCta.isNegative() ? money('0') : totalCta,
          isElimination: false,
        });
      }

      if (compare(ownershipPctDec, money('100')) < 0) {
        const minorityPct = sub(money('100'), ownershipPctDec);
        const minorityFraction = div(minorityPct, money('100'), 12, 'HALF_UP') ?? money('0');
        const subNetEquity = add(translatedOpeningEquity, add(translatedNetIncome, totalCta));
        const nciTotalBalance = round(mul(subNetEquity, minorityFraction), scale, 'HALF_UP');
        const nciNiShare = round(mul(translatedNetIncome, minorityFraction), scale, 'HALF_UP');
        const nciEquityShare = sub(nciTotalBalance, nciNiShare);

        groupNciTotal = add(groupNciTotal, nciTotalBalance);
        groupNciNetIncome = add(groupNciNetIncome, nciNiShare);

        minorityInterests.push({
          entityId: entity.entityId,
          entityCode: entity.entityCode,
          entityName: entity.entityName,
          ownershipPct: serialize(ownershipPctDec, 2),
          minorityPct: serialize(minorityPct, 2),
          subsidiaryNetEquity: serialize(subNetEquity, scale),
          subsidiaryNetIncome: serialize(translatedNetIncome, scale),
          nciNetIncomeShare: serialize(nciNiShare, scale),
          nciEquityShare: serialize(nciEquityShare, scale),
          nciTotalBalance: serialize(nciTotalBalance, scale),
        });
      }
    } else if (method === 'equity') {
      const ownerFraction = div(ownershipPctDec, money('100'), 12, 'HALF_UP') ?? money('0');
      const equityPickup = round(mul(translatedNetIncome, ownerFraction), scale, 'HALF_UP');
      groupTotalAssets = add(groupTotalAssets, equityPickup);
      groupTotalRevenue = add(groupTotalRevenue, equityPickup);
      if (!equityPickup.isZero()) {
        addTbLeg({
          accountCode: '1850',
          accountName: `Equity Method Investment (${entity.entityCode})`,
          accountType: 'asset',
          normalSide: 'debit',
          debit: equityPickup.isNegative() ? money('0') : equityPickup,
          credit: equityPickup.isNegative() ? negate(equityPickup) : money('0'),
          isElimination: false,
        });
        addTbLeg({
          accountCode: '4850',
          accountName: `Equity Method Earnings (${entity.entityCode})`,
          accountType: 'revenue',
          normalSide: 'credit',
          debit: equityPickup.isNegative() ? negate(equityPickup) : money('0'),
          credit: equityPickup.isNegative() ? money('0') : equityPickup,
          isElimination: false,
        });
      }
    }
  }

  // Intercompany Matching & Zero-Net Eliminations (FX3)
  const icReconciliations: IntercompanyEliminationItem[] = [];
  const eliminationLines: EliminationJournalLine[] = [];
  let totalEliminations = money('0');
  let unmatchedIcCount = 0;

  // Map account metadata for TB elimination reflection
  const accountMetaByCode = new Map<string, { name: string; type: AccountType; normalSide: NormalSide }>();
  for (const entity of input.entities) {
    for (const line of entity.lines) {
      const code = normalizeCode(line.accountCode);
      if (!accountMetaByCode.has(code)) {
        accountMetaByCode.set(code, {
          name: line.accountName,
          type: line.accountType,
          normalSide: line.normalSide,
        });
      }
    }
  }

  for (const rule of input.icRules) {
    const fromCode = normalizeCode(rule.fromAccountCode);
    const toCode = normalizeCode(rule.toAccountCode);
    const fromBal = translatedLegBalance.get(`${rule.fromEntityId}|${fromCode}`) ?? money('0');
    const toBal = translatedLegBalance.get(`${rule.toEntityId}|${toCode}`) ?? money('0');

    // Offsetting IC legs have opposite signs in debit-minus-credit terms
    const oppositeSigns =
      (fromBal.isPositive() && toBal.isNegative()) || (fromBal.isNegative() && toBal.isPositive());

    let eliminated = money('0');
    if (oppositeSigns) {
      eliminated = minDecimal(absDecimal(fromBal), absDecimal(toBal));
    }

    const residual = absDecimal(add(fromBal, toBal));
    const hasResidual = !residual.isZero();
    if (hasResidual) {
      unmatchedIcCount += 1;
    }

    if (!eliminated.isZero()) {
      totalEliminations = add(totalEliminations, eliminated);
      // Reverse each leg up to `eliminated` so Σ elimination debits == Σ elimination credits
      const fromMeta = accountMetaByCode.get(fromCode);
      const toMeta = accountMetaByCode.get(toCode);

      const fromDebit = fromBal.isNegative() ? eliminated : money('0');
      const fromCredit = fromBal.isPositive() ? eliminated : money('0');
      const toDebit = toBal.isNegative() ? eliminated : money('0');
      const toCredit = toBal.isPositive() ? eliminated : money('0');

      eliminationLines.push(
        {
          ruleId: rule.ruleId,
          entityCode: rule.fromEntityCode,
          accountCode: fromCode,
          debit: serialize(fromDebit, scale),
          credit: serialize(fromCredit, scale),
          description: `${rule.description} (elim ${rule.fromEntityCode})`,
        },
        {
          ruleId: rule.ruleId,
          entityCode: rule.toEntityCode,
          accountCode: toCode,
          debit: serialize(toDebit, scale),
          credit: serialize(toCredit, scale),
          description: `${rule.description} (elim ${rule.toEntityCode})`,
        },
      );

      if (fromMeta !== undefined) {
        addTbLeg({
          accountCode: fromCode,
          accountName: fromMeta.name,
          accountType: fromMeta.type,
          normalSide: fromMeta.normalSide,
          debit: fromDebit,
          credit: fromCredit,
          isElimination: true,
        });
        if (fromMeta.type === 'asset') {
          groupTotalAssets = sub(groupTotalAssets, sub(fromCredit, fromDebit));
        } else if (fromMeta.type === 'liability') {
          groupTotalLiabilities = sub(groupTotalLiabilities, sub(fromDebit, fromCredit));
        } else if (fromMeta.type === 'revenue') {
          groupTotalRevenue = sub(groupTotalRevenue, sub(fromDebit, fromCredit));
        } else if (fromMeta.type === 'expense') {
          groupTotalExpenses = sub(groupTotalExpenses, sub(fromCredit, fromDebit));
        }
      }

      if (toMeta !== undefined) {
        addTbLeg({
          accountCode: toCode,
          accountName: toMeta.name,
          accountType: toMeta.type,
          normalSide: toMeta.normalSide,
          debit: toDebit,
          credit: toCredit,
          isElimination: true,
        });
        if (toMeta.type === 'asset') {
          groupTotalAssets = sub(groupTotalAssets, sub(toCredit, toDebit));
        } else if (toMeta.type === 'liability') {
          groupTotalLiabilities = sub(groupTotalLiabilities, sub(toDebit, toCredit));
        } else if (toMeta.type === 'revenue') {
          groupTotalRevenue = sub(groupTotalRevenue, sub(toDebit, toCredit));
        } else if (toMeta.type === 'expense') {
          groupTotalExpenses = sub(groupTotalExpenses, sub(toCredit, toDebit));
        }
      }
    }

    icReconciliations.push({
      ruleId: rule.ruleId,
      ruleType: rule.ruleType,
      fromEntityCode: rule.fromEntityCode,
      fromAccountCode: fromCode,
      toEntityCode: rule.toEntityCode,
      toAccountCode: toCode,
      fromTranslatedBalance: serialize(fromBal, scale),
      toTranslatedBalance: serialize(toBal, scale),
      eliminatedAmount: serialize(eliminated, scale),
      unmatchedDifference: serialize(residual, scale),
      status: hasResidual ? 'unmatched_difference' : 'matched',
      quarantineReason: hasResidual
        ? `UNMATCHED_IC_RESIDUAL:${rule.fromEntityCode}:${fromCode}<->${rule.toEntityCode}:${toCode}:delta=${serialize(residual, scale)}`
        : null,
      description: rule.description,
    });
  }

  const consolidatedTrialBalance: ConsolidatedTrialBalanceLine[] = [];
  let tbTotalDebit = money('0');
  let tbTotalCredit = money('0');

  const sortedCodes = [...tbMap.keys()].sort((a, b) => a.localeCompare(b));
  for (const code of sortedCodes) {
    const row = tbMap.get(code)!;
    const preNat = naturalFromDebitCredit(row.normalSide, row.preElimDebit, row.preElimCredit);
    const elimNat = naturalFromDebitCredit(row.normalSide, row.elimDebit, row.elimCredit);
    const consDebit = add(row.preElimDebit, row.elimDebit);
    const consCredit = add(row.preElimCredit, row.elimCredit);
    const netSide = sub(consDebit, consCredit);
    const netDebit = netSide.isPositive() ? netSide : money('0');
    const netCredit = netSide.isNegative() ? negate(netSide) : money('0');
    const consNat = add(preNat, elimNat);

    tbTotalDebit = add(tbTotalDebit, netDebit);
    tbTotalCredit = add(tbTotalCredit, netCredit);

    consolidatedTrialBalance.push({
      accountCode: row.accountCode,
      accountName: row.accountName,
      accountType: row.accountType,
      normalSide: row.normalSide,
      preEliminationNatural: serialize(preNat, scale),
      eliminationNatural: serialize(elimNat, scale),
      consolidatedNatural: serialize(consNat, scale),
      debit: serialize(netDebit, scale),
      credit: serialize(netCredit, scale),
    });
  }

  const consolidatedNetIncome = sub(groupTotalRevenue, groupTotalExpenses);
  const controllingNetIncome = sub(consolidatedNetIncome, groupNciNetIncome);
  const totalEquityBeforeNci = add(groupTotalOpeningEquity, consolidatedNetIncome);
  const totalGroupEquity = add(totalEquityBeforeNci, groupTotalCta);
  const controllingEquity = sub(totalGroupEquity, groupNciTotal);

  const lPlusGroupEquity = add(groupTotalLiabilities, add(controllingEquity, groupNciTotal));
  const accountingEquationImbalance = sub(groupTotalAssets, lPlusGroupEquity);

  const groupTbBalanced = eq(tbTotalDebit, tbTotalCredit);
  const groupBsBalanced = accountingEquationImbalance.isZero();

  return {
    reportingCurrency,
    asOfDate: input.asOfDate,
    status: unmatchedIcCount > 0 ? 'quarantined_residuals' : 'completed',
    ctaAccountCode,
    ctaAccountName,
    entityTranslations,
    minorityInterests,
    icReconciliations,
    eliminationLines,
    consolidatedTrialBalance,
    totalAssets: serialize(groupTotalAssets, scale),
    totalLiabilities: serialize(groupTotalLiabilities, scale),
    totalEquityBeforeNci: serialize(totalEquityBeforeNci, scale),
    controllingEquity: serialize(controllingEquity, scale),
    minorityInterest: serialize(groupNciTotal, scale),
    totalGroupEquity: serialize(totalGroupEquity, scale),
    totalCta: serialize(groupTotalCta, scale),
    totalRevenue: serialize(groupTotalRevenue, scale),
    totalExpenses: serialize(groupTotalExpenses, scale),
    consolidatedNetIncome: serialize(consolidatedNetIncome, scale),
    controllingNetIncome: serialize(controllingNetIncome, scale),
    nciNetIncome: serialize(groupNciNetIncome, scale),
    totalEliminations: serialize(totalEliminations, scale),
    unmatchedIcCount,
    hasUnmatchedIc: unmatchedIcCount > 0,
    groupTbTotalDebit: serialize(tbTotalDebit, scale),
    groupTbTotalCredit: serialize(tbTotalCredit, scale),
    groupTbBalanced,
    accountingEquationImbalance: serialize(accountingEquationImbalance, scale),
    groupBsBalanced,
  };
}

/**
 * FX2: Monetary item FX revaluation splitting realized (settled) vs unrealized (period-end)
 * gains/losses with balanced FX Gain/Loss journal lines.
 */
export function computeFxRevaluation(params: {
  readonly functionalCurrency: string;
  readonly fxGainLossAccountCode?: string;
  readonly items: readonly MonetaryRevaluationItemInput[];
}): MonetaryRevaluationResult {
  const functionalCurrency = normalizeCurrency(params.functionalCurrency);
  const scale = scaleForCurrency(functionalCurrency);
  const fxGainLossAccountCode = normalizeCode(params.fxGainLossAccountCode ?? '7200');

  const results: MonetaryRevaluationItemResult[] = [];
  const journalLines: RevaluationJournalLine[] = [];
  let realizedTotal = money('0');
  let unrealizedTotal = money('0');
  let journalDebits = money('0');
  let journalCredits = money('0');

  for (const item of params.items) {
    const foreignCurrency = normalizeCurrency(item.foreignCurrency);
    const itemFuncCurrency = normalizeCurrency(item.functionalCurrency);
    if (itemFuncCurrency !== functionalCurrency) {
      throw new ConsolidationError(
        'CURRENCY_MISMATCH',
        `Item ${item.itemKey} functionalCurrency ${itemFuncCurrency} does not match ${functionalCurrency}.`,
      );
    }

    const foreignAmount = parsePositiveDecimal(item.foreignAmount, 'INVALID_AMOUNT', `${item.itemKey}.foreignAmount`);
    const bookingRate = parsePositiveDecimal(item.bookingRate, 'INVALID_FX_RATE', `${item.itemKey}.bookingRate`);
    const valuationRateRaw = item.settled
      ? (item.settlementRate ?? item.periodEndRate)
      : item.periodEndRate;
    const valuationRate = parsePositiveDecimal(valuationRateRaw, 'INVALID_FX_RATE', `${item.itemKey}.valuationRate`);

    const bookingFunctional = round(mul(foreignAmount, bookingRate), scale, 'HALF_UP');
    const revaluedFunctional = round(mul(foreignAmount, valuationRate), scale, 'HALF_UP');
    const rawDelta = sub(revaluedFunctional, bookingFunctional);
    // Monetary asset: rate up => gain (+). Monetary liability: rate up => loss (-).
    const gainLoss = item.accountType === 'asset' ? rawDelta : negate(rawDelta);

    const classification = item.settled ? 'realized' : 'unrealized';
    if (classification === 'realized') {
      realizedTotal = add(realizedTotal, gainLoss);
    } else {
      unrealizedTotal = add(unrealizedTotal, gainLoss);
    }

    if (!gainLoss.isZero()) {
      const mag = absDecimal(gainLoss);
      // Adjust balance sheet monetary account (asset debit up on gain, credit down on loss; liability credit up on loss, debit down on gain)
      const bsDebit =
        (item.accountType === 'asset' && gainLoss.isPositive()) ||
        (item.accountType === 'liability' && gainLoss.isPositive())
          ? mag
          : money('0');
      const bsCredit = bsDebit.isZero() ? mag : money('0');

      const plDebit = gainLoss.isNegative() ? mag : money('0');
      const plCredit = gainLoss.isPositive() ? mag : money('0');

      journalDebits = add(journalDebits, add(bsDebit, plDebit));
      journalCredits = add(journalCredits, add(bsCredit, plCredit));

      journalLines.push(
        {
          entityCode: item.entityCode,
          accountCode: normalizeCode(item.accountCode),
          debit: serialize(bsDebit, scale),
          credit: serialize(bsCredit, scale),
          memo: `${classification} FX reval (${foreignCurrency}->${functionalCurrency}) ${item.itemKey}`,
        },
        {
          entityCode: item.entityCode,
          accountCode: fxGainLossAccountCode,
          debit: serialize(plDebit, scale),
          credit: serialize(plCredit, scale),
          memo: `${classification} FX ${gainLoss.isPositive() ? 'gain' : 'loss'} ${item.itemKey}`,
        },
      );
    }

    results.push({
      itemKey: item.itemKey,
      entityCode: item.entityCode,
      accountCode: normalizeCode(item.accountCode),
      foreignCurrency,
      functionalCurrency: itemFuncCurrency,
      foreignAmount: serialize(foreignAmount, scaleForCurrency(foreignCurrency)),
      bookingAmountFunctional: serialize(bookingFunctional, scale),
      valuationRate: serialize(valuationRate, 6),
      revaluedAmountFunctional: serialize(revaluedFunctional, scale),
      classification,
      gainLossFunctional: serialize(gainLoss, scale),
    });
  }

  return {
    reportingOrFunctionalCurrency: functionalCurrency,
    items: results,
    realizedTotal: serialize(realizedTotal, scale),
    unrealizedTotal: serialize(unrealizedTotal, scale),
    netRevaluationTotal: serialize(add(realizedTotal, unrealizedTotal), scale),
    journalLines,
    journalBalanced: eq(journalDebits, journalCredits),
  };
}
