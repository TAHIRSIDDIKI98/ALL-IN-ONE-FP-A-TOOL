import { describe, expect, it } from 'vitest';
import workforceOracle from '../../fixtures/oracles/workforce/workforce_oracle.json' with { type: 'json' };
import {
  compileWorkforceModuleToDrivers,
  WORKFORCE_MODULE_SPEC,
  type WorkforcePositionInput,
} from './index.js';

function parseCentsBigInt(canonical: string): bigint {
  const trimmed = canonical.trim();
  const neg = trimmed.startsWith('-');
  const unsigned = neg ? trimmed.slice(1) : trimmed;
  const [whole = '0', frac = ''] = unsigned.split('.');
  const cents = BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0').slice(0, 2));
  return neg ? -cents : cents;
}

describe('WI-0035 M2 Workforce Module & §2.4 One-Engine Framework (/core/workforce)', () => {
  it('exposes a schema-validated module spec and compiles the golden oracle fixture matching independent hand-computed totals and BigInt sums', () => {
    expect(WORKFORCE_MODULE_SPEC.moduleKey).toBe('workforce');
    expect(WORKFORCE_MODULE_SPEC.dimensions).toEqual(['department', 'position', 'account']);
    expect(WORKFORCE_MODULE_SPEC.recommendedStatementLineKeys).toContain('pl.opex.payroll');
    expect(WORKFORCE_MODULE_SPEC.recommendedStatementLineKeys).toContain('pl.cogs.direct');

    const result = compileWorkforceModuleToDrivers({
      periods: workforceOracle.periods,
      positions: workforceOracle.positions as readonly WorkforcePositionInput[],
      currencyScale: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.grandTotalCost).toBe(workforceOracle.expected.grandTotalCost);
    expect(result.grandTotalFteMonths).toBe(workforceOracle.expected.grandTotalFteMonths);
    expect(result.fteByPeriod).toEqual(workforceOracle.expected.fteByPeriod);
    expect(result.costByPeriod).toEqual(workforceOracle.expected.costByPeriod);

    for (const pos of result.positionSummaries) {
      expect(pos.totalCost).toBe(
        workforceOracle.expected.totalsByPosition[
          pos.positionCode as keyof typeof workforceOracle.expected.totalsByPosition
        ],
      );
    }

    for (const dept of result.departmentSummaries) {
      expect(dept.totalCost).toBe(
        workforceOracle.expected.totalsByDepartment[
          dept.departmentName as keyof typeof workforceOracle.expected.totalsByDepartment
        ],
      );
    }

    // One-engine tie-out: Workforce compiles directly into /core/planning drivers and matches cent-for-cent
    expect(result.driverPlan.grandTotal).toBe(workforceOracle.expected.grandTotalCost);
    expect(result.driverPlan.totalsByAccount).toEqual(workforceOracle.expected.totalsByAccount);
    expect(result.driverPlan.totalsByPeriod).toEqual(workforceOracle.expected.costByPeriod);

    // Independent BigInt integer-cent reconciliation across every position-period cell
    let cellSumCents = 0n;
    for (const cell of result.positionPeriodRows) {
      const rowComponents =
        parseCentsBigInt(cell.basePay) +
        parseCentsBigInt(cell.benefits) +
        parseCentsBigInt(cell.bonus);
      expect(rowComponents).toBe(parseCentsBigInt(cell.totalCost));
      cellSumCents += parseCentsBigInt(cell.totalCost);
    }
    let driverLineSumCents = 0n;
    for (const line of result.driverPlan.lines) {
      driverLineSumCents += parseCentsBigInt(line.amount);
    }
    expect(cellSumCents).toBe(parseCentsBigInt(workforceOracle.expected.grandTotalCost));
    expect(driverLineSumCents).toBe(cellSumCents);
  });

  it('excludes inactive positions from payroll cost while preserving exact rounding tie-out for 0-decimal currencies (JPY)', () => {
    const outcome = compileWorkforceModuleToDrivers({
      periods: ['P01', 'P02', 'P03'],
      currencyScale: 0,
      periodsInYear: 12,
      positions: [
        {
          positionCode: 'TOKYO-01',
          title: 'Tokyo Lead',
          departmentName: 'Engineering',
          accountCode: '5100',
          startPeriodCode: 'P01',
          endPeriodCode: null,
          fte: '1',
          annualSalary: '1000000',
          burdenRate: '0.15',
          bonusRate: '0',
          rampFirstPeriodPct: '1',
          meritPeriodCode: null,
          meritIncreasePct: '0',
          status: 'active',
        },
        {
          positionCode: 'PAUSED-02',
          title: 'Paused Role',
          departmentName: 'Engineering',
          accountCode: '5100',
          startPeriodCode: 'P01',
          endPeriodCode: null,
          fte: '1',
          annualSalary: '1200000',
          burdenRate: '0.20',
          bonusRate: '0',
          rampFirstPeriodPct: '1',
          meritPeriodCode: null,
          meritIncreasePct: '0',
          status: 'inactive',
        },
      ],
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // 1000000 / 12 = 83333.333333 -> 83333 JPY base + 15% = 12500 JPY benefits = 95833 / mo * 3 = 287499 JPY
    expect(outcome.positionSummaries).toHaveLength(1);
    expect(outcome.positionSummaries[0]?.totalBasePay).toBe('249999');
    expect(outcome.positionSummaries[0]?.totalBenefits).toBe('37500');
    expect(outcome.grandTotalCost).toBe('287499');
    expect(outcome.driverPlan.grandTotal).toBe('287499');
    expect(outcome.driverPlan.currencyScale).toBe(0);
  });

  it('rejects duplicate position codes, inverted period ranges, unknown periods, out-of-range ramp, negative salary, and all-inactive rosters with zero partial output', () => {
    const basePosition: WorkforcePositionInput = {
      positionCode: 'EMP-1',
      title: 'Analyst',
      departmentName: 'Finance',
      accountCode: '6100',
      startPeriodCode: 'P01',
      endPeriodCode: 'P03',
      fte: '1.00',
      annualSalary: '60000.00',
      burdenRate: '0.20',
      bonusRate: '0.00',
      rampFirstPeriodPct: '1.00',
      meritPeriodCode: null,
      meritIncreasePct: '0.00',
      status: 'active',
    };

    const dup = compileWorkforceModuleToDrivers({
      periods: ['P01', 'P02', 'P03'],
      positions: [basePosition, { ...basePosition }],
    });
    expect(dup).toEqual({ ok: false, issues: ['DUPLICATE_POSITION_CODE:EMP-1'] });

    const inverted = compileWorkforceModuleToDrivers({
      periods: ['P01', 'P02', 'P03'],
      positions: [{ ...basePosition, startPeriodCode: 'P03', endPeriodCode: 'P01' }],
    });
    expect(inverted).toEqual({ ok: false, issues: ['END_BEFORE_START:EMP-1'] });

    const badFields = compileWorkforceModuleToDrivers({
      periods: ['P01', 'P02', 'P03'],
      positions: [
        {
          ...basePosition,
          annualSalary: '-1000',
          rampFirstPeriodPct: '1.25',
          meritPeriodCode: 'P99',
        },
      ],
    });
    expect(badFields.ok).toBe(false);
    if (!badFields.ok) {
      expect(badFields.issues).toContain('UNKNOWN_MERIT_PERIOD:EMP-1/P99');
      expect(badFields.issues).toContain('NEGATIVE_VALUE:EMP-1.annualSalary');
      expect(badFields.issues).toContain('RAMP_OUT_OF_RANGE:EMP-1');
    }

    const noActive = compileWorkforceModuleToDrivers({
      periods: ['P01', 'P02', 'P03'],
      positions: [{ ...basePosition, status: 'inactive' }],
    });
    expect(noActive).toEqual({ ok: false, issues: ['NO_ACTIVE_POSITIONS'] });

    const emptyPeriods = compileWorkforceModuleToDrivers({
      periods: [],
      positions: [basePosition],
    });
    expect(emptyPeriods).toEqual({ ok: false, issues: ['EMPTY_PERIODS'] });
  });
});
