import {
  add,
  div,
  money,
  mul,
  round,
  serialize,
  STORAGE_SCALE,
  type Money,
} from '../money/index.js';
import {
  computeDriverPlan,
  type DriverPlanResult,
  type FixedDriverDefinition,
} from '../planning/index.js';

function normalizeCode(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

function isCanonicalDecimal(raw: string): boolean {
  return /^[+-]?\d+(?:\.\d+)?$/.test(raw.trim());
}

/**
 * Schema-validated module metadata contract proving MASTER_PROMPT §2.4 (One-Engine Law):
 * a business module is expressed as declarative dimensions, input fields, driver mappings,
 * and report-pack sections that compile cleanly into `/core/planning` — never a parallel engine.
 */
export interface WorkforceModuleSpec {
  readonly moduleKey: 'workforce';
  readonly moduleName: string;
  readonly version: string;
  readonly dimensions: readonly string[];
  readonly driverKinds: readonly ['fixed'];
  readonly recommendedStatementLineKeys: readonly string[];
  readonly inputColumns: readonly {
    readonly key: string;
    readonly label: string;
    readonly valueKind: 'code' | 'text' | 'period' | 'decimal' | 'money' | 'status';
    readonly required: boolean;
  }[];
  readonly reportPackSections: readonly string[];
}

export const WORKFORCE_MODULE_SPEC: WorkforceModuleSpec = {
  moduleKey: 'workforce',
  moduleName: 'Workforce & Headcount Compensation',
  version: '2.0.0',
  dimensions: ['department', 'position', 'account'],
  driverKinds: ['fixed'],
  recommendedStatementLineKeys: [
    'pl.opex.payroll',
    'pl.cogs.direct',
    'pl.opex.rd',
    'pl.opex.sm',
    'pl.opex.ga',
  ],
  inputColumns: [
    { key: 'positionCode', label: 'Position code', valueKind: 'code', required: true },
    { key: 'title', label: 'Role title', valueKind: 'text', required: true },
    { key: 'departmentName', label: 'Department', valueKind: 'text', required: true },
    { key: 'accountCode', label: 'GL expense account', valueKind: 'code', required: true },
    { key: 'startPeriodCode', label: 'Start period', valueKind: 'period', required: true },
    { key: 'endPeriodCode', label: 'End period', valueKind: 'period', required: false },
    { key: 'fte', label: 'FTE', valueKind: 'decimal', required: true },
    { key: 'annualSalary', label: 'Annual salary', valueKind: 'money', required: true },
    { key: 'burdenRate', label: 'Employer burden ratio', valueKind: 'decimal', required: true },
    { key: 'bonusRate', label: 'Bonus ratio', valueKind: 'decimal', required: true },
    { key: 'rampFirstPeriodPct', label: 'First-period ramp ratio', valueKind: 'decimal', required: true },
    { key: 'meritPeriodCode', label: 'Merit effective period', valueKind: 'period', required: false },
    { key: 'meritIncreasePct', label: 'Merit increase ratio', valueKind: 'decimal', required: true },
    { key: 'status', label: 'Status', valueKind: 'status', required: true },
  ],
  reportPackSections: ['headcount_fte', 'compensation_breakdown', 'account_tie_out'],
};

export interface WorkforcePositionInput {
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

export interface WorkforcePositionPeriodCell {
  readonly positionCode: string;
  readonly title: string;
  readonly departmentName: string;
  readonly accountCode: string;
  readonly periodCode: string;
  readonly activeInPeriod: boolean;
  readonly effectiveFte: string;
  readonly basePay: string;
  readonly benefits: string;
  readonly bonus: string;
  readonly totalCost: string;
}

export interface WorkforcePositionSummary {
  readonly positionCode: string;
  readonly title: string;
  readonly departmentName: string;
  readonly accountCode: string;
  readonly status: 'active' | 'inactive';
  readonly fteMonths: string;
  readonly totalBasePay: string;
  readonly totalBenefits: string;
  readonly totalBonus: string;
  readonly totalCost: string;
}

export interface WorkforceDepartmentSummary {
  readonly departmentName: string;
  readonly fteMonths: string;
  readonly totalCost: string;
}

export interface WorkforceCompileSuccess {
  readonly ok: true;
  readonly moduleKey: 'workforce';
  readonly currencyScale: 0 | 2 | 3;
  readonly periods: readonly string[];
  readonly positionPeriodRows: readonly WorkforcePositionPeriodCell[];
  readonly positionSummaries: readonly WorkforcePositionSummary[];
  readonly departmentSummaries: readonly WorkforceDepartmentSummary[];
  readonly fteByPeriod: Readonly<Record<string, string>>;
  readonly costByPeriod: Readonly<Record<string, string>>;
  readonly grandTotalFteMonths: string;
  readonly grandTotalCost: string;
  readonly compiledDrivers: readonly FixedDriverDefinition[];
  readonly driverPlan: DriverPlanResult;
}

export interface WorkforceCompileError {
  readonly ok: false;
  readonly issues: readonly string[];
}

export type WorkforceCompileOutcome = WorkforceCompileSuccess | WorkforceCompileError;

function parseNonNegativeMoney(raw: string, fieldLabel: string, issues: string[]): Money | null {
  if (!isCanonicalDecimal(raw)) {
    issues.push(`INVALID_DECIMAL:${fieldLabel}`);
    return null;
  }
  const value = money(raw);
  if (value.isNegative()) {
    issues.push(`NEGATIVE_VALUE:${fieldLabel}`);
    return null;
  }
  return value;
}

/**
 * Pure Workforce compensation compiler (§2.4 One-Engine Proof).
 *
 * Computes position-level monthly base pay, employer burden, and bonus strictly via `/core/money`,
 * sums costs per target GL account & fiscal period, compiles them into canonical `FixedDriverDefinition[]`,
 * and runs `/core/planning#computeDriverPlan` so `plan_line` rows tie to payroll breakdowns to the cent.
 */
export function compileWorkforceModuleToDrivers(params: {
  readonly periods: readonly string[];
  readonly positions: readonly WorkforcePositionInput[];
  readonly currencyScale?: 0 | 2 | 3;
  readonly periodsInYear?: number;
}): WorkforceCompileOutcome {
  const currencyScale: 0 | 2 | 3 = params.currencyScale ?? 2;
  const periodsInYear = params.periodsInYear ?? 12;

  if (!Number.isInteger(periodsInYear) || periodsInYear <= 0) {
    return { ok: false, issues: ['INVALID_PERIODS_IN_YEAR'] };
  }

  const periods = params.periods.map((p) => p.trim()).filter((p) => p.length > 0);
  if (periods.length === 0) {
    return { ok: false, issues: ['EMPTY_PERIODS'] };
  }

  const periodIndexMap = new Map<string, number>();
  for (let i = 0; i < periods.length; i += 1) {
    const p = periods[i]!;
    if (periodIndexMap.has(p)) {
      return { ok: false, issues: [`DUPLICATE_PERIOD:${p}`] };
    }
    periodIndexMap.set(p, i);
  }

  const issues: string[] = [];
  const seenPositionCodes = new Set<string>();

  interface ParsedPosition {
    readonly positionCode: string;
    readonly title: string;
    readonly departmentName: string;
    readonly accountCode: string;
    readonly startIndex: number;
    readonly endIndex: number;
    readonly meritIndex: number;
    readonly fte: Money;
    readonly annualSalary: Money;
    readonly burdenRate: Money;
    readonly bonusRate: Money;
    readonly rampFirstPeriodPct: Money;
    readonly meritIncreasePct: Money;
  }

  const activePositions: ParsedPosition[] = [];

  for (let idx = 0; idx < params.positions.length; idx += 1) {
    const rawPos = params.positions[idx]!;
    const code = normalizeCode(rawPos.positionCode);
    const title = rawPos.title.trim();
    const departmentName = rawPos.departmentName.trim();
    const accountCode = normalizeCode(rawPos.accountCode);

    if (code.length === 0) {
      issues.push(`EMPTY_POSITION_CODE:row ${String(idx + 1)}`);
      continue;
    }
    if (seenPositionCodes.has(code)) {
      issues.push(`DUPLICATE_POSITION_CODE:${code}`);
      continue;
    }
    seenPositionCodes.add(code);

    if (title.length === 0) {
      issues.push(`EMPTY_TITLE:${code}`);
    }
    if (departmentName.length === 0) {
      issues.push(`EMPTY_DEPARTMENT:${code}`);
    }
    if (accountCode.length === 0) {
      issues.push(`EMPTY_ACCOUNT_CODE:${code}`);
    }

    const startCode = rawPos.startPeriodCode.trim();
    const startIndex = periodIndexMap.get(startCode);
    if (startIndex === undefined) {
      issues.push(`UNKNOWN_START_PERIOD:${code}/${startCode}`);
    }

    let endIndex = periods.length - 1;
    if (rawPos.endPeriodCode !== null && rawPos.endPeriodCode.trim().length > 0) {
      const endCode = rawPos.endPeriodCode.trim();
      const resolvedEnd = periodIndexMap.get(endCode);
      if (resolvedEnd === undefined) {
        issues.push(`UNKNOWN_END_PERIOD:${code}/${endCode}`);
      } else {
        endIndex = resolvedEnd;
      }
    }
    if (startIndex !== undefined && endIndex < startIndex) {
      issues.push(`END_BEFORE_START:${code}`);
    }

    let meritIndex = -1;
    if (rawPos.meritPeriodCode !== null && rawPos.meritPeriodCode.trim().length > 0) {
      const meritCode = rawPos.meritPeriodCode.trim();
      const resolvedMerit = periodIndexMap.get(meritCode);
      if (resolvedMerit === undefined) {
        issues.push(`UNKNOWN_MERIT_PERIOD:${code}/${meritCode}`);
      } else {
        meritIndex = resolvedMerit;
      }
    }

    const fte = parseNonNegativeMoney(rawPos.fte, `${code}.fte`, issues);
    const annualSalary = parseNonNegativeMoney(rawPos.annualSalary, `${code}.annualSalary`, issues);
    const burdenRate = parseNonNegativeMoney(rawPos.burdenRate, `${code}.burdenRate`, issues);
    const bonusRate = parseNonNegativeMoney(rawPos.bonusRate, `${code}.bonusRate`, issues);
    const ramp = parseNonNegativeMoney(
      rawPos.rampFirstPeriodPct,
      `${code}.rampFirstPeriodPct`,
      issues,
    );
    const meritPct = parseNonNegativeMoney(
      rawPos.meritIncreasePct,
      `${code}.meritIncreasePct`,
      issues,
    );

    if (ramp !== null && ramp.gt(money('1'))) {
      issues.push(`RAMP_OUT_OF_RANGE:${code}`);
    }

    if (
      rawPos.status === 'active' &&
      title.length > 0 &&
      departmentName.length > 0 &&
      accountCode.length > 0 &&
      startIndex !== undefined &&
      endIndex >= startIndex &&
      fte !== null &&
      annualSalary !== null &&
      burdenRate !== null &&
      bonusRate !== null &&
      ramp !== null &&
      meritPct !== null
    ) {
      activePositions.push({
        positionCode: code,
        title,
        departmentName,
        accountCode,
        startIndex,
        endIndex,
        meritIndex,
        fte,
        annualSalary,
        burdenRate,
        bonusRate,
        rampFirstPeriodPct: ramp,
        meritIncreasePct: meritPct,
      });
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  if (activePositions.length === 0) {
    return { ok: false, issues: ['NO_ACTIVE_POSITIONS'] };
  }

  activePositions.sort((a, b) => a.positionCode.localeCompare(b.positionCode));

  const periodsDivisor = money(String(periodsInYear));
  const one = money('1');
  const zero = money('0');

  const positionPeriodRows: WorkforcePositionPeriodCell[] = [];
  const positionSummaries: WorkforcePositionSummary[] = [];

  const deptTotals = new Map<string, { fteMonths: Money; totalCost: Money }>();
  const fteAccumByPeriod = new Map<string, Money>();
  const costAccumByPeriod = new Map<string, Money>();
  const accountPeriodTotals = new Map<string, Map<string, Money>>();
  const accountPositionCounts = new Map<string, number>();

  for (const periodCode of periods) {
    fteAccumByPeriod.set(periodCode, zero);
    costAccumByPeriod.set(periodCode, zero);
  }

  let grandFteMonths = zero;
  let grandTotalCost = zero;

  for (const pos of activePositions) {
    accountPositionCounts.set(
      pos.accountCode,
      (accountPositionCounts.get(pos.accountCode) ?? 0) + 1,
    );

    const annualForFte = mul(pos.annualSalary, pos.fte);
    const monthlyBaseRaw = div(annualForFte, periodsDivisor, STORAGE_SCALE, 'HALF_UP') ?? zero;

    let posFteMonths = zero;
    let posBasePay = zero;
    let posBenefits = zero;
    let posBonus = zero;
    let posTotalCost = zero;

    let acctMap = accountPeriodTotals.get(pos.accountCode);
    if (acctMap === undefined) {
      acctMap = new Map<string, Money>();
      for (const p of periods) {
        acctMap.set(p, zero);
      }
      accountPeriodTotals.set(pos.accountCode, acctMap);
    }

    for (let pIdx = 0; pIdx < periods.length; pIdx += 1) {
      const periodCode = periods[pIdx]!;
      const activeInPeriod = pIdx >= pos.startIndex && pIdx <= pos.endIndex;

      if (!activeInPeriod) {
        positionPeriodRows.push({
          positionCode: pos.positionCode,
          title: pos.title,
          departmentName: pos.departmentName,
          accountCode: pos.accountCode,
          periodCode,
          activeInPeriod: false,
          effectiveFte: serialize(zero, 2),
          basePay: serialize(zero, currencyScale),
          benefits: serialize(zero, currencyScale),
          bonus: serialize(zero, currencyScale),
          totalCost: serialize(zero, currencyScale),
        });
        continue;
      }

      const rampFactor = pIdx === pos.startIndex ? pos.rampFirstPeriodPct : one;
      const meritFactor =
        pos.meritIndex !== -1 && pIdx >= pos.meritIndex
          ? add(one, pos.meritIncreasePct)
          : one;

      const effectiveFte = round(mul(pos.fte, rampFactor), 2, 'HALF_UP');
      const baseRaw = mul(mul(monthlyBaseRaw, rampFactor), meritFactor);
      const basePay = round(baseRaw, currencyScale, 'HALF_UP');
      const benefits = round(mul(basePay, pos.burdenRate), currencyScale, 'HALF_UP');
      const bonus = round(mul(basePay, pos.bonusRate), currencyScale, 'HALF_UP');
      const totalCost = add(add(basePay, benefits), bonus);

      posFteMonths = add(posFteMonths, effectiveFte);
      posBasePay = add(posBasePay, basePay);
      posBenefits = add(posBenefits, benefits);
      posBonus = add(posBonus, bonus);
      posTotalCost = add(posTotalCost, totalCost);

      fteAccumByPeriod.set(
        periodCode,
        add(fteAccumByPeriod.get(periodCode) ?? zero, effectiveFte),
      );
      costAccumByPeriod.set(
        periodCode,
        add(costAccumByPeriod.get(periodCode) ?? zero, totalCost),
      );
      acctMap.set(periodCode, add(acctMap.get(periodCode) ?? zero, totalCost));

      positionPeriodRows.push({
        positionCode: pos.positionCode,
        title: pos.title,
        departmentName: pos.departmentName,
        accountCode: pos.accountCode,
        periodCode,
        activeInPeriod: true,
        effectiveFte: serialize(effectiveFte, 2),
        basePay: serialize(basePay, currencyScale),
        benefits: serialize(benefits, currencyScale),
        bonus: serialize(bonus, currencyScale),
        totalCost: serialize(totalCost, currencyScale),
      });
    }

    positionSummaries.push({
      positionCode: pos.positionCode,
      title: pos.title,
      departmentName: pos.departmentName,
      accountCode: pos.accountCode,
      status: 'active',
      fteMonths: serialize(posFteMonths, 2),
      totalBasePay: serialize(posBasePay, currencyScale),
      totalBenefits: serialize(posBenefits, currencyScale),
      totalBonus: serialize(posBonus, currencyScale),
      totalCost: serialize(posTotalCost, currencyScale),
    });

    const deptEntry = deptTotals.get(pos.departmentName) ?? { fteMonths: zero, totalCost: zero };
    deptTotals.set(pos.departmentName, {
      fteMonths: add(deptEntry.fteMonths, posFteMonths),
      totalCost: add(deptEntry.totalCost, posTotalCost),
    });

    grandFteMonths = add(grandFteMonths, posFteMonths);
    grandTotalCost = add(grandTotalCost, posTotalCost);
  }

  const departmentSummaries: WorkforceDepartmentSummary[] = [...deptTotals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([departmentName, agg]) => ({
      departmentName,
      fteMonths: serialize(agg.fteMonths, 2),
      totalCost: serialize(agg.totalCost, currencyScale),
    }));

  const fteByPeriod: Record<string, string> = {};
  const costByPeriod: Record<string, string> = {};
  for (const periodCode of periods) {
    fteByPeriod[periodCode] = serialize(fteAccumByPeriod.get(periodCode) ?? zero, 2);
    costByPeriod[periodCode] = serialize(
      costAccumByPeriod.get(periodCode) ?? zero,
      currencyScale,
    );
  }

  const compiledDrivers: FixedDriverDefinition[] = [...accountPeriodTotals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([accountCode, periodMap]) => {
      const baseAmount = serialize(periodMap.get(periods[0]!) ?? zero, currencyScale);
      const periodOverrides: Record<string, string> = {};
      for (const periodCode of periods) {
        const periodValue = serialize(periodMap.get(periodCode) ?? zero, currencyScale);
        if (periodValue !== baseAmount) {
          periodOverrides[periodCode] = periodValue;
        }
      }
      const posCount = accountPositionCounts.get(accountCode) ?? 0;
      const sanitizedKey = accountCode.replace(/[^a-zA-Z0-9_-]/g, '_');
      return {
        kind: 'fixed',
        driverKey: `wf_${sanitizedKey}`,
        accountCode,
        assumptionLabel: `Workforce module (${String(posCount)} active position(s))`,
        amount: baseAmount,
        ...(Object.keys(periodOverrides).length > 0 ? { periodOverrides } : {}),
      };
    });

  const driverPlan = computeDriverPlan({
    periods,
    drivers: compiledDrivers,
    currencyScale,
  });

  if (!driverPlan.ok) {
    return { ok: false, issues: driverPlan.issues };
  }

  return {
    ok: true,
    moduleKey: 'workforce',
    currencyScale,
    periods,
    positionPeriodRows,
    positionSummaries,
    departmentSummaries,
    fteByPeriod,
    costByPeriod,
    grandTotalFteMonths: serialize(grandFteMonths, 2),
    grandTotalCost: serialize(grandTotalCost, currencyScale),
    compiledDrivers,
    driverPlan,
  };
}
