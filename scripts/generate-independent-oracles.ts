/**
 * Independent BigInt minor-unit oracle verifier/generator (MASTER_PROMPT §7.5, C4).
 * STRICT RULE: Zero imports from /core, /shared, /server, or decimal.js.
 * Arithmetic is implemented strictly with native JS BigInt integer cents.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

interface RawCorpusAccount {
  readonly code: string;
  readonly type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  readonly normalSide: 'debit' | 'credit';
  readonly statementLineKey: string;
}

interface RawCorpusGlLine {
  readonly entryId: string;
  readonly accountCode: string;
  readonly statementLineKey: string;
  readonly debitMinor: number;
  readonly creditMinor: number;
}

interface RawCorpus {
  readonly meta: {
    readonly generatorVersion: string;
    readonly seed: number;
    readonly demoLabel: string;
  };
  readonly coa: readonly RawCorpusAccount[];
  readonly openingBalanceSheetMinor: Readonly<Record<string, number>>;
  readonly glLines: readonly RawCorpusGlLine[];
}

function formatCents(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${neg ? '-' : ''}${whole.toString()}.${frac}`;
}

export function computeIndependentCorpusOracle(corpus: RawCorpus) {
  const acctByCode = new Map<string, RawCorpusAccount>(corpus.coa.map((a) => [a.code, a]));

  let totalDebits = 0n;
  let totalCredits = 0n;
  const entryDebits = new Map<string, bigint>();
  const entryCredits = new Map<string, bigint>();
  const acctDebits = new Map<string, bigint>();
  const acctCredits = new Map<string, bigint>();

  for (const line of corpus.glLines) {
    const d = BigInt(line.debitMinor);
    const c = BigInt(line.creditMinor);
    if (d < 0n || c < 0n) {
      throw new Error(`ORACLE_NEGATIVE_SIDE: entry=${line.entryId}`);
    }
    if ((d === 0n) === (c === 0n)) {
      throw new Error(`ORACLE_INVALID_SIDES: entry=${line.entryId}`);
    }
    totalDebits += d;
    totalCredits += c;
    entryDebits.set(line.entryId, (entryDebits.get(line.entryId) ?? 0n) + d);
    entryCredits.set(line.entryId, (entryCredits.get(line.entryId) ?? 0n) + c);
    acctDebits.set(line.accountCode, (acctDebits.get(line.accountCode) ?? 0n) + d);
    acctCredits.set(line.accountCode, (acctCredits.get(line.accountCode) ?? 0n) + c);
  }

  for (const [eid, d] of entryDebits.entries()) {
    const c = entryCredits.get(eid) ?? 0n;
    if (d !== c) {
      throw new Error(`ORACLE_UNBALANCED_ENTRY: ${eid} debit=${d} credit=${c}`);
    }
  }

  // P&L natural sums by statement_line_key
  const pnlByKey = new Map<string, bigint>();
  const bsPeriodDeltas = new Map<string, bigint>();

  for (const acct of corpus.coa) {
    const d = acctDebits.get(acct.code) ?? 0n;
    const c = acctCredits.get(acct.code) ?? 0n;
    const nat = acct.normalSide === 'debit' ? d - c : c - d;
    const sheetContrib = acct.type === 'asset' || acct.type === 'expense' ? d - c : c - d;

    if (acct.statementLineKey.startsWith('pl.')) {
      pnlByKey.set(acct.statementLineKey, (pnlByKey.get(acct.statementLineKey) ?? 0n) + nat);
    } else if (acct.statementLineKey.startsWith('bs.')) {
      bsPeriodDeltas.set(acct.statementLineKey, (bsPeriodDeltas.get(acct.statementLineKey) ?? 0n) + sheetContrib);
    }
  }

  let revenue = 0n;
  let cogs = 0n;
  let opex = 0n;
  let depreciation = 0n;
  let nonOperatingNet = 0n;
  let tax = 0n;

  for (const [key, val] of pnlByKey.entries()) {
    if (key.startsWith('pl.revenue.')) revenue += val;
    else if (key.startsWith('pl.cogs.')) cogs += val;
    else if (key.startsWith('pl.opex.')) opex += val;
    else if (key.startsWith('pl.da.')) depreciation += val;
    else if (key === 'pl.nonop.interest_income') nonOperatingNet += val;
    else if (key.startsWith('pl.nonop.')) nonOperatingNet -= val;
    else if (key.startsWith('pl.tax.')) tax += val;
  }

  const grossProfit = revenue - cogs;
  const ebitda = grossProfit - opex;
  const ebit = ebitda - depreciation;
  const ebt = ebit + nonOperatingNet;
  const netIncome = ebt - tax;

  // Closing Balance Sheet
  const bsKeys = new Set<string>([
    ...Object.keys(corpus.openingBalanceSheetMinor),
    ...bsPeriodDeltas.keys(),
  ]);
  const bsClosing = new Map<string, bigint>();
  for (const key of bsKeys) {
    if (key === 'bs.equity.current_net_income') continue;
    const open = BigInt(corpus.openingBalanceSheetMinor[key] ?? 0);
    const delta = bsPeriodDeltas.get(key) ?? 0n;
    bsClosing.set(key, open + delta);
  }
  bsClosing.set('bs.equity.current_net_income', netIncome);

  const CURRENT_ASSETS = new Set(['bs.asset.cash', 'bs.asset.ar', 'bs.asset.inventory', 'bs.asset.other_current']);
  const CURRENT_LIAB = new Set(['bs.liability.ap', 'bs.liability.accrued', 'bs.liability.deferred_rev', 'bs.liability.short_term_debt']);

  let currentAssets = 0n;
  let nonCurrentAssets = 0n;
  let currentLiabilities = 0n;
  let nonCurrentLiabilities = 0n;
  let totalEquity = 0n;

  for (const [key, val] of bsClosing.entries()) {
    if (key.startsWith('bs.asset.')) {
      if (CURRENT_ASSETS.has(key)) currentAssets += val;
      else nonCurrentAssets += val;
    } else if (key.startsWith('bs.liability.')) {
      if (CURRENT_LIAB.has(key)) currentLiabilities += val;
      else nonCurrentLiabilities += val;
    } else if (key.startsWith('bs.equity.')) {
      totalEquity += val;
    }
  }

  const totalAssets = currentAssets + nonCurrentAssets;
  const totalLiabilities = currentLiabilities + nonCurrentLiabilities;
  const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;
  const bsCash = bsClosing.get('bs.asset.cash') ?? 0n;

  // Indirect Cash Flow (BigInt)
  const openCash = BigInt(corpus.openingBalanceSheetMinor['bs.asset.cash'] ?? 0);
  const openNonCashCa =
    BigInt(corpus.openingBalanceSheetMinor['bs.asset.ar'] ?? 0) +
    BigInt(corpus.openingBalanceSheetMinor['bs.asset.inventory'] ?? 0) +
    BigInt(corpus.openingBalanceSheetMinor['bs.asset.other_current'] ?? 0);
  const endNonCashCa =
    (bsClosing.get('bs.asset.ar') ?? 0n) +
    (bsClosing.get('bs.asset.inventory') ?? 0n) +
    (bsClosing.get('bs.asset.other_current') ?? 0n);

  const openCl =
    BigInt(corpus.openingBalanceSheetMinor['bs.liability.ap'] ?? 0) +
    BigInt(corpus.openingBalanceSheetMinor['bs.liability.accrued'] ?? 0) +
    BigInt(corpus.openingBalanceSheetMinor['bs.liability.deferred_rev'] ?? 0) +
    BigInt(corpus.openingBalanceSheetMinor['bs.liability.short_term_debt'] ?? 0);
  const endCl = currentLiabilities;

  const daAddback = -(bsPeriodDeltas.get('bs.asset.ppe_accum_depr') ?? 0n);
  const deltaWc = (endCl - openCl) - (endNonCashCa - openNonCashCa);
  const cfo = netIncome + daAddback + deltaWc;
  const cfi = -((bsPeriodDeltas.get('bs.asset.ppe_gross') ?? 0n) + (bsPeriodDeltas.get('bs.asset.other_noncurrent') ?? 0n));
  const distributionsDelta = bsPeriodDeltas.get('bs.equity.distributions') ?? 0n;
  const cff =
    (bsPeriodDeltas.get('bs.liability.long_term_debt') ?? 0n) +
    (bsPeriodDeltas.get('bs.liability.other_noncurrent') ?? 0n) +
    (bsPeriodDeltas.get('bs.equity.common_stock') ?? 0n) +
    distributionsDelta;
  const cfEndingCash = openCash + cfo + cfi + cff;

  const openRe = BigInt(corpus.openingBalanceSheetMinor['bs.equity.retained_earnings'] ?? 0);
  const distributionsMag = -distributionsDelta;
  const closingReTotal =
    (bsClosing.get('bs.equity.retained_earnings') ?? 0n) +
    (bsClosing.get('bs.equity.current_net_income') ?? 0n) -
    distributionsMag;

  void acctByCode;

  return {
    derivationMethod: 'Independent JS BigInt minor-unit integer summation with zero /core imports',
    approvedDate: '2026-11-24',
    generatorVersion: corpus.meta.generatorVersion,
    seed: corpus.meta.seed,
    trialBalance: {
      totalDebits: formatCents(totalDebits),
      totalCredits: formatCents(totalCredits),
      balanced: totalDebits === totalCredits,
    },
    pnl: {
      revenue: formatCents(revenue),
      cogs: formatCents(cogs),
      grossProfit: formatCents(grossProfit),
      opex: formatCents(opex),
      ebitda: formatCents(ebitda),
      depreciation: formatCents(depreciation),
      ebit: formatCents(ebit),
      nonOperatingNet: formatCents(nonOperatingNet),
      ebt: formatCents(ebt),
      tax: formatCents(tax),
      netIncome: formatCents(netIncome),
    },
    balanceSheet: {
      currentAssets: formatCents(currentAssets),
      nonCurrentAssets: formatCents(nonCurrentAssets),
      totalAssets: formatCents(totalAssets),
      currentLiabilities: formatCents(currentLiabilities),
      nonCurrentLiabilities: formatCents(nonCurrentLiabilities),
      totalLiabilities: formatCents(totalLiabilities),
      totalEquity: formatCents(totalEquity),
      totalLiabilitiesAndEquity: formatCents(totalLiabilitiesAndEquity),
      cashBalance: formatCents(bsCash),
      balanced: totalAssets === totalLiabilitiesAndEquity,
    },
    cashFlow: {
      beginningCash: formatCents(openCash),
      operatingCashFlow: formatCents(cfo),
      investingCashFlow: formatCents(cfi),
      financingCashFlow: formatCents(cff),
      endingCash: formatCents(cfEndingCash),
      tiesToBsCash: cfEndingCash === bsCash,
    },
    retainedEarnings: {
      opening: formatCents(openRe),
      netIncome: formatCents(netIncome),
      distributions: formatCents(distributionsMag),
      closingTotal: formatCents(closingReTotal),
      rollForwardValid: closingReTotal === openRe + netIncome - distributionsMag,
    },
  };
}

export function writeIndependentOracle(rootDir = process.cwd()): string {
  const corpusPath = join(rootDir, 'fixtures/corpus/corpus.json');
  const outPath = join(rootDir, 'fixtures/oracles/expected/corpus_expected.json');
  const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as RawCorpus;
  const oracle = computeIndependentCorpusOracle(corpus);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(oracle, null, 2)}\n`, 'utf8');
  return outPath;
}

interface RawDriverDef {
  readonly kind: 'fixed' | 'growth_rate' | 'percent_of_account' | 'price_times_volume';
  readonly driverKey: string;
  readonly accountCode: string;
  readonly amount?: string;
  readonly baseAmount?: string;
  readonly ratePerPeriod?: string;
  readonly sourceAccountCode?: string;
  readonly ratio?: string;
  readonly unitPriceByPeriod?: Readonly<Record<string, string>>;
  readonly volumeByPeriod?: Readonly<Record<string, string>>;
  readonly periodOverrides?: Readonly<Record<string, string>>;
}

interface RawWorkforcePosition {
  readonly positionCode: string;
  readonly title: string;
  readonly departmentName: string;
  readonly accountCode: string;
  readonly startPeriodCode: string;
  readonly endPeriodCode: string | null;
  readonly fte: string;
  readonly annualSalary: string;
  readonly burdenRate: string;
  readonly bonusRate: string;
  readonly rampFirstPeriodPct: string;
  readonly meritPeriodCode: string | null;
  readonly meritIncreasePct: string;
  readonly status: 'active' | 'inactive';
}

interface RawM2Corpus {
  readonly meta: {
    readonly generatorVersion: string;
    readonly seed: number;
    readonly demoLabel: string;
  };
  readonly tenantB: {
    readonly company: {
      readonly id: string;
      readonly name: string;
      readonly calendarKind: string;
      readonly entityCode: string;
      readonly currency: string;
    };
    readonly coa: readonly RawCorpusAccount[];
    readonly openingBalanceSheetMinor: Readonly<Record<string, number>>;
    readonly glLines: readonly RawCorpusGlLine[];
  };
  readonly rollingForecastCorpus: {
    readonly cutoffPeriod: string;
    readonly periods: readonly string[];
    readonly forecastDrivers: readonly RawDriverDef[];
    readonly actualFacts: readonly { readonly accountCode: string; readonly periodCode: string; readonly amount: string }[];
  };
  readonly scenarioCorpus: {
    readonly periods: readonly string[];
    readonly scenarios: {
      readonly base: { readonly name: string; readonly drivers: readonly RawDriverDef[] };
      readonly upside: { readonly name: string; readonly drivers: readonly RawDriverDef[] };
      readonly downside: { readonly name: string; readonly drivers: readonly RawDriverDef[] };
    };
  };
  readonly workforceCorpus: {
    readonly periods: readonly string[];
    readonly positions: readonly RawWorkforcePosition[];
  };
}

function parseScaledBigInt(raw: string, scale: number): bigint {
  const trimmed = raw.trim();
  const neg = trimmed.startsWith('-');
  const unsigned = neg || trimmed.startsWith('+') ? trimmed.slice(1) : trimmed;
  const parts = unsigned.split('.');
  const wholePart = parts[0] ?? '0';
  const fracPart = (parts[1] ?? '').padEnd(scale, '0').slice(0, scale);
  const val = BigInt(wholePart) * 10n ** BigInt(scale) + (scale > 0 ? BigInt(fracPart) : 0n);
  return neg ? -val : val;
}

function divRoundHalfUp(num: bigint, den: bigint): bigint {
  if (den <= 0n) {
    throw new Error('ORACLE_NON_POSITIVE_DENOMINATOR');
  }
  const neg = num < 0n;
  const absNum = neg ? -num : num;
  const q = absNum / den;
  const r = absNum % den;
  const rounded = r * 2n >= den ? q + 1n : q;
  return neg ? -rounded : rounded;
}

function evalDriversBigInt(
  periods: readonly string[],
  drivers: readonly RawDriverDef[],
): {
  readonly lines: Map<string, Map<string, bigint>>;
  readonly accountTotals: Record<string, string>;
  readonly grandTotalCents: bigint;
} {
  // Kahn topological order without /core imports
  const byAccount = new Map<string, RawDriverDef>(drivers.map((d) => [d.accountCode.trim(), d]));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const code of byAccount.keys()) {
    inDegree.set(code, 0);
    dependents.set(code, []);
  }
  for (const [code, drv] of byAccount.entries()) {
    if (drv.kind === 'percent_of_account' && drv.sourceAccountCode) {
      const src = drv.sourceAccountCode.trim();
      inDegree.set(code, (inDegree.get(code) ?? 0) + 1);
      dependents.get(src)?.push(code);
    }
  }
  const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([c]) => c).sort();
  const ordered: RawDriverDef[] = [];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    ordered.push(byAccount.get(cur)!);
    for (const dep of dependents.get(cur) ?? []) {
      const next = (inDegree.get(dep) ?? 1) - 1;
      inDegree.set(dep, next);
      if (next === 0) {
        queue.push(dep);
        queue.sort();
      }
    }
  }

  const linesCents = new Map<string, Map<string, bigint>>();
  for (const drv of ordered) {
    const accountMap = new Map<string, bigint>();
    linesCents.set(drv.accountCode.trim(), accountMap);
    let runningStorageMicro = 0n;
    let hasRunning = false;

    for (let i = 0; i < periods.length; i += 1) {
      const periodCode = periods[i]!;
      const override = drv.periodOverrides?.[periodCode];
      let rawMicro = 0n;

      if (override !== undefined) {
        rawMicro = parseScaledBigInt(override, 6);
        if (drv.kind === 'growth_rate') {
          runningStorageMicro = rawMicro;
          hasRunning = true;
        }
      } else if (drv.kind === 'fixed') {
        rawMicro = parseScaledBigInt(drv.amount ?? '0', 6);
      } else if (drv.kind === 'growth_rate') {
        if (i === 0 || !hasRunning) {
          rawMicro = parseScaledBigInt(drv.baseAmount ?? '0', 6);
        } else {
          const factorMicro = 1_000_000n + parseScaledBigInt(drv.ratePerPeriod ?? '0', 6);
          rawMicro = divRoundHalfUp(runningStorageMicro * factorMicro, 1_000_000n);
        }
        runningStorageMicro = rawMicro;
        hasRunning = true;
      } else if (drv.kind === 'percent_of_account') {
        const srcCents = linesCents.get((drv.sourceAccountCode ?? '').trim())?.get(periodCode) ?? 0n;
        const srcMicro = srcCents * 10_000n;
        const ratioMicro = parseScaledBigInt(drv.ratio ?? '0', 6);
        rawMicro = divRoundHalfUp(srcMicro * ratioMicro, 1_000_000n);
      } else {
        const priceMicro = parseScaledBigInt(drv.unitPriceByPeriod?.[periodCode] ?? '0', 6);
        const volMicro = parseScaledBigInt(drv.volumeByPeriod?.[periodCode] ?? '0', 6);
        rawMicro = divRoundHalfUp(priceMicro * volMicro, 1_000_000n);
      }

      const cellCents = divRoundHalfUp(rawMicro, 10_000n);
      accountMap.set(periodCode, cellCents);
    }
  }

  let grandTotalCents = 0n;
  const accountTotals: Record<string, string> = {};
  for (const [code, pMap] of [...linesCents.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    let accSum = 0n;
    for (const p of periods) {
      accSum += pMap.get(p) ?? 0n;
    }
    accountTotals[code] = formatCents(accSum);
    grandTotalCents += accSum;
  }

  return { lines: linesCents, accountTotals, grandTotalCents };
}

export function computeIndependentM2CorpusOracle(corpus: RawM2Corpus) {
  const tenantB = computeIndependentCorpusOracle({
    meta: {
      generatorVersion: corpus.meta.generatorVersion,
      seed: corpus.meta.seed,
      demoLabel: corpus.tenantB.company.name,
    },
    coa: corpus.tenantB.coa,
    openingBalanceSheetMinor: corpus.tenantB.openingBalanceSheetMinor,
    glLines: corpus.tenantB.glLines,
  });

  // Scenario BigInt evaluation
  const baseEval = evalDriversBigInt(corpus.scenarioCorpus.periods, corpus.scenarioCorpus.scenarios.base.drivers);
  const upsideEval = evalDriversBigInt(corpus.scenarioCorpus.periods, corpus.scenarioCorpus.scenarios.upside.drivers);
  const downsideEval = evalDriversBigInt(corpus.scenarioCorpus.periods, corpus.scenarioCorpus.scenarios.downside.drivers);

  // Rolling Forecast BigInt verification (actual P01..cutoff + upside forecast > cutoff)
  const rfPeriods = corpus.rollingForecastCorpus.periods;
  const cutoffIdx = rfPeriods.indexOf(corpus.rollingForecastCorpus.cutoffPeriod);
  const actualByKey = new Map<string, bigint>();
  const rollingAccounts = new Set<string>();
  for (const a of corpus.rollingForecastCorpus.actualFacts) {
    actualByKey.set(`${a.accountCode}::${a.periodCode}`, parseScaledBigInt(a.amount, 2));
    rollingAccounts.add(a.accountCode);
  }
  for (const code of upsideEval.lines.keys()) {
    rollingAccounts.add(code);
  }
  let rfTotalActualCents = 0n;
  let rfTotalForecastCents = 0n;
  let rfMissingCells = 0;
  for (const code of [...rollingAccounts].sort()) {
    for (let idx = 0; idx < rfPeriods.length; idx += 1) {
      const pCode = rfPeriods[idx]!;
      if (idx <= cutoffIdx) {
        const v = actualByKey.get(`${code}::${pCode}`);
        if (v === undefined) rfMissingCells += 1;
        else rfTotalActualCents += v;
      } else {
        const v = upsideEval.lines.get(code)?.get(pCode);
        if (v === undefined) rfMissingCells += 1;
        else rfTotalForecastCents += v;
      }
    }
  }

  // Workforce BigInt exact cent calculation
  const wfPeriods = corpus.workforceCorpus.periods;
  const periodIdxMap = new Map<string, number>(wfPeriods.map((p, i) => [p, i]));
  const positionSummaries: {
    readonly positionCode: string;
    readonly accountCode: string;
    readonly fteMonths: string;
    readonly totalBasePay: string;
    readonly totalBenefits: string;
    readonly totalBonus: string;
    readonly totalCost: string;
  }[] = [];
  let wfGrandFteHundredths = 0n;
  let wfGrandCostCents = 0n;
  let rampP04Cost = '0.00';
  let attritionP06Cost = '0.00';

  const activePositions = [...corpus.workforceCorpus.positions]
    .filter((p) => p.status === 'active')
    .sort((a, b) => a.positionCode.localeCompare(b.positionCode));

  for (const pos of activePositions) {
    const startIdx = periodIdxMap.get(pos.startPeriodCode)!;
    const endIdx = pos.endPeriodCode ? periodIdxMap.get(pos.endPeriodCode)! : wfPeriods.length - 1;
    const meritIdx = pos.meritPeriodCode ? periodIdxMap.get(pos.meritPeriodCode)! : -1;

    const salaryMicro = parseScaledBigInt(pos.annualSalary, 6);
    const fteMicro = parseScaledBigInt(pos.fte, 6);
    const burdenMicro = parseScaledBigInt(pos.burdenRate, 6);
    const bonusMicro = parseScaledBigInt(pos.bonusRate, 6);
    const rampMicro = parseScaledBigInt(pos.rampFirstPeriodPct, 6);
    const meritPctMicro = parseScaledBigInt(pos.meritIncreasePct, 6);

    const annualForFteMicro = divRoundHalfUp(salaryMicro * fteMicro, 1_000_000n);
    const monthlyBaseMicro = divRoundHalfUp(annualForFteMicro, 12n);

    let posFteHundredths = 0n;
    let posBaseCents = 0n;
    let posBenCents = 0n;
    let posBonCents = 0n;
    let posTotalCents = 0n;

    for (let idx = 0; idx < wfPeriods.length; idx += 1) {
      const pCode = wfPeriods[idx]!;
      const active = idx >= startIdx && idx <= endIdx;
      if (!active) {
        if (pos.positionCode === 'WF-FIN-05' && pCode === 'P06') attritionP06Cost = '0.00';
        continue;
      }
      const effRampMicro = idx === startIdx ? rampMicro : 1_000_000n;
      const effMeritMicro = meritIdx !== -1 && idx >= meritIdx ? 1_000_000n + meritPctMicro : 1_000_000n;

      const effFteHundredths = divRoundHalfUp(fteMicro * effRampMicro, 10_000_000_000n);
      const baseCents = divRoundHalfUp(monthlyBaseMicro * effRampMicro * effMeritMicro, 10_000_000_000_000_000n);
      const benCents = divRoundHalfUp(baseCents * burdenMicro, 1_000_000n);
      const bonCents = divRoundHalfUp(baseCents * bonusMicro, 1_000_000n);
      const cellTotal = baseCents + benCents + bonCents;

      if (pos.positionCode === 'WF-CSM-03' && pCode === 'P04') rampP04Cost = formatCents(cellTotal);

      posFteHundredths += effFteHundredths;
      posBaseCents += baseCents;
      posBenCents += benCents;
      posBonCents += bonCents;
      posTotalCents += cellTotal;
    }

    wfGrandFteHundredths += posFteHundredths;
    wfGrandCostCents += posTotalCents;
    positionSummaries.push({
      positionCode: pos.positionCode,
      accountCode: pos.accountCode,
      fteMonths: formatCents(posFteHundredths),
      totalBasePay: formatCents(posBaseCents),
      totalBenefits: formatCents(posBenCents),
      totalBonus: formatCents(posBonCents),
      totalCost: formatCents(posTotalCents),
    });
  }

  return {
    derivationMethod: 'Independent JS BigInt minor-unit integer arithmetic with zero /core imports (M2 Corpus v2)',
    approvedDate: '2026-11-26',
    generatorVersion: corpus.meta.generatorVersion,
    seed: corpus.meta.seed,
    tenantBCompanyId: corpus.tenantB.company.id,
    tenantBCompanyName: corpus.tenantB.company.name,
    tenantB,
    rollingForecast: {
      cutoffPeriod: corpus.rollingForecastCorpus.cutoffPeriod,
      totalActual: formatCents(rfTotalActualCents),
      totalForecast: formatCents(rfTotalForecastCents),
      totalFullHorizon: formatCents(rfTotalActualCents + rfTotalForecastCents),
      totalMissingCells: rfMissingCells,
    },
    scenarios: {
      baseGrandTotal: formatCents(baseEval.grandTotalCents),
      upsideGrandTotal: formatCents(upsideEval.grandTotalCents),
      downsideGrandTotal: formatCents(downsideEval.grandTotalCents),
      baseVsUpsideTotalDelta: formatCents(upsideEval.grandTotalCents - baseEval.grandTotalCents),
      baseVsDownsideTotalDelta: formatCents(downsideEval.grandTotalCents - baseEval.grandTotalCents),
      baseAccountTotals: baseEval.accountTotals,
      upsideAccountTotals: upsideEval.accountTotals,
      downsideAccountTotals: downsideEval.accountTotals,
    },
    workforce: {
      activePositionCount: activePositions.length,
      inactiveExcludedCount: corpus.workforceCorpus.positions.length - activePositions.length,
      grandTotalFteMonths: formatCents(wfGrandFteHundredths),
      grandTotalCost: formatCents(wfGrandCostCents),
      rampP04Cost,
      attritionP06Cost,
      positionSummaries,
    },
  };
}

export function writeIndependentM2Oracle(rootDir = process.cwd()): string {
  const corpusPath = join(rootDir, 'fixtures/corpus/m2_corpus.json');
  const outPath = join(rootDir, 'fixtures/oracles/expected/m2_corpus_expected.json');
  const m2Corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as RawM2Corpus;
  const oracle = computeIndependentM2CorpusOracle(m2Corpus);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(oracle, null, 2)}\n`, 'utf8');
  return outPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = writeIndependentOracle(process.cwd());
  const outM2 = writeIndependentM2Oracle(process.cwd());
  process.stdout.write(`✓ Wrote independent BigInt oracles at ${out} and ${outM2}\n`);
}
