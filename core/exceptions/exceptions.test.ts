import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildRectificationCsv,
  evaluateExceptionRules,
  evaluateExceptionTransition,
  EXCEPTION_RULES_CATALOG,
  type ExceptionEvaluationInput,
  type ExceptionGlLineFact,
} from './index.js';
import { money, serialize, sum } from '../money/index.js';

interface ExceptionsOracle {
  readonly currency: string;
  readonly entityCode: string;
  readonly periodId: string;
  readonly periodCode: string;
  readonly periodEndDate: string;
  readonly fiscalYear: number;
  readonly periodNo: number;
  readonly openTargetPeriodId: string;
  readonly openTargetPeriodCode: string;
  readonly openTargetPeriodStartDate: string;
  readonly expectedPlantedFindings: readonly {
    readonly findingKey: string;
    readonly ruleId: string;
    readonly severity: string;
    readonly suggestionKind: string;
    readonly amount: string;
    readonly suggestedTargetAccount?: string;
    readonly decimalShiftSuspect?: boolean;
  }[];
  readonly forbiddenControlFindingKeys: readonly string[];
}

function makePriorRentHistory(): ExceptionGlLineFact[] {
  const rows: ExceptionGlLineFact[] = [];
  for (let p = 1; p <= 6; p++) {
    rows.push({
      lineId: `hist-rent-${p}`,
      entryId: `e-hist-rent-${p}`,
      batchId: 'batch-hist-1',
      batchImportedAt: '2026-06-01T00:00:00Z',
      entityCode: 'HQ-1',
      periodId: `p-${p}`,
      periodCode: `P0${p}`,
      fiscalYear: 2026,
      periodNo: p,
      entryDate: `2026-0${p}-10`,
      sourceRef: `RENT-${p}`,
      accountCode: '6200',
      accountType: 'expense',
      normalSide: 'debit',
      isContra: false,
      statementLineKey: 'pl.opex.ga',
      debit: '92500.00',
      credit: '0.00',
      description: 'Office rent Andheri premises lease',
    });
    rows.push({
      lineId: `hist-mkt-${p}`,
      entryId: `e-hist-mkt-${p}`,
      batchId: 'batch-hist-1',
      batchImportedAt: '2026-06-01T00:00:00Z',
      entityCode: 'HQ-1',
      periodId: `p-${p}`,
      periodCode: `P0${p}`,
      fiscalYear: 2026,
      periodNo: p,
      entryDate: `2026-0${p}-11`,
      sourceRef: `MKT-${p}`,
      accountCode: '6400',
      accountType: 'expense',
      normalSide: 'debit',
      isContra: false,
      statementLineKey: 'pl.opex.sm',
      debit: '15000.00',
      credit: '0.00',
      description: 'Event stall Diwali campaign',
    });
    // 6 prior vendor lines on 1400 around 48,000 median for EXC-026
    rows.push({
      lineId: `hist-cap-${p}`,
      entryId: `e-hist-cap-${p}`,
      batchId: 'batch-hist-1',
      batchImportedAt: '2026-06-01T00:00:00Z',
      entityCode: 'HQ-1',
      periodId: `p-${p}`,
      periodCode: `P0${p}`,
      fiscalYear: 2026,
      periodNo: p,
      entryDate: `2026-0${p}-12`,
      sourceRef: `CAP-${p}`,
      accountCode: '1400',
      accountType: 'asset',
      normalSide: 'debit',
      isContra: false,
      statementLineKey: 'bs.asset.fixed',
      debit: String(45500 + p * 1000) + '.00',
      credit: '0.00',
      description: 'Vendor V05 hardware invoice',
      counterpartyKey: 'V05',
    });
  }
  return rows;
}

describe('M3 Exception-Rule Catalog & Rectification Kernel (/core/exceptions)', () => {
  it('achieves 100% planted recall and 0% false-positive control hits against golden oracle', () => {
    const oraclePath = join(process.cwd(), 'fixtures', 'oracles', 'exceptions', 'exceptions_oracle.json');
    const oracle = JSON.parse(readFileSync(oraclePath, 'utf8')) as ExceptionsOracle;

    expect(EXCEPTION_RULES_CATALOG).toHaveLength(28);

    const glLines: ExceptionGlLineFact[] = [
      ...makePriorRentHistory(),
      // EXC-001 planted duplicate voucher across two active batches
      {
        lineId: 'dup-1a',
        entryId: 'e-dup-1a',
        batchId: 'batch-a',
        batchImportedAt: '2026-07-10T00:00:00Z',
        entityCode: 'HQ-1',
        periodId: oracle.periodId,
        periodCode: 'P07',
        fiscalYear: 2026,
        periodNo: 7,
        entryDate: '2026-07-10',
        sourceRef: 'JV-DUP-1',
        accountCode: '6100',
        accountType: 'expense',
        normalSide: 'debit',
        isContra: false,
        statementLineKey: 'pl.opex.ga',
        debit: '45000.00',
        credit: '0.00',
        description: 'Cloud hosting July',
      },
      {
        lineId: 'dup-1b',
        entryId: 'e-dup-1a',
        batchId: 'batch-a',
        batchImportedAt: '2026-07-10T00:00:00Z',
        entityCode: 'HQ-1',
        periodId: oracle.periodId,
        periodCode: 'P07',
        fiscalYear: 2026,
        periodNo: 7,
        entryDate: '2026-07-10',
        sourceRef: 'JV-DUP-1',
        accountCode: '1000',
        accountType: 'asset',
        normalSide: 'debit',
        isContra: false,
        statementLineKey: 'bs.asset.cash',
        debit: '0.00',
        credit: '45000.00',
        description: 'Cloud hosting July',
      },
      {
        lineId: 'dup-2a',
        entryId: 'e-dup-2a',
        batchId: 'batch-b',
        batchImportedAt: '2026-07-11T00:00:00Z',
        entityCode: 'HQ-1',
        periodId: oracle.periodId,
        periodCode: 'P07',
        fiscalYear: 2026,
        periodNo: 7,
        entryDate: '2026-07-10',
        sourceRef: 'JV-DUP-1',
        accountCode: '6100',
        accountType: 'expense',
        normalSide: 'debit',
        isContra: false,
        statementLineKey: 'pl.opex.ga',
        debit: '45000.00',
        credit: '0.00',
        description: 'Cloud hosting July',
      },
      {
        lineId: 'dup-2b',
        entryId: 'e-dup-2a',
        batchId: 'batch-b',
        batchImportedAt: '2026-07-11T00:00:00Z',
        entityCode: 'HQ-1',
        periodId: oracle.periodId,
        periodCode: 'P07',
        fiscalYear: 2026,
        periodNo: 7,
        entryDate: '2026-07-10',
        sourceRef: 'JV-DUP-1',
        accountCode: '1000',
        accountType: 'asset',
        normalSide: 'debit',
        isContra: false,
        statementLineKey: 'bs.asset.cash',
        debit: '0.00',
        credit: '45000.00',
        description: 'Cloud hosting July',
      },
      // EXC-004 Control (balanced)
      {
        lineId: 'ctrl-bal-1',
        entryId: 'e-ctrl-bal',
        batchId: 'batch-a',
        batchImportedAt: '2026-07-10T00:00:00Z',
        entityCode: 'HQ-1',
        periodId: oracle.periodId,
        periodCode: 'P07',
        fiscalYear: 2026,
        periodNo: 7,
        entryDate: '2026-07-12',
        sourceRef: 'JV-CTRL-BAL',
        accountCode: '5100',
        accountType: 'expense',
        normalSide: 'debit',
        isContra: false,
        statementLineKey: 'pl.cogs.product',
        debit: '100000.00',
        credit: '0.00',
        description: 'Balanced posting',
      },
      // EXC-025 planted (3 signal tokens: rent, premises, andheri -> 6200)
      {
        lineId: 'ex25-plant',
        entryId: 'e-ex25-plant',
        batchId: 'batch-a',
        batchImportedAt: '2026-07-15T00:00:00Z',
        entityCode: 'HQ-1',
        periodId: oracle.periodId,
        periodCode: 'P07',
        fiscalYear: 2026,
        periodNo: 7,
        entryDate: '2026-07-15',
        sourceRef: 'JV-25-0733',
        accountCode: '6400',
        accountType: 'expense',
        normalSide: 'debit',
        isContra: false,
        statementLineKey: 'pl.opex.sm',
        debit: '92500.00',
        credit: '0.00',
        description: 'Office rent Jul-26 Andheri premises',
      },
      // EXC-025 Control (C11: only 1 signal token 'rent'; event/stall/campaign match 6400)
      {
        lineId: 'ex25-ctrl',
        entryId: 'e-ex25-ctrl',
        batchId: 'batch-a',
        batchImportedAt: '2026-07-15T00:00:00Z',
        entityCode: 'HQ-1',
        periodId: oracle.periodId,
        periodCode: 'P07',
        fiscalYear: 2026,
        periodNo: 7,
        entryDate: '2026-07-16',
        sourceRef: 'JV-CTRL-ONE-TOKEN',
        accountCode: '6400',
        accountType: 'expense',
        normalSide: 'debit',
        isContra: false,
        statementLineKey: 'pl.opex.sm',
        debit: '40000.00',
        credit: '0.00',
        description: 'Event stall rent Diwali campaign',
      },
      // EXC-026 planted (100x decimal shift: 4,800,000 vs median 48,500)
      {
        lineId: 'ex26-plant',
        entryId: 'e-ex26-plant',
        batchId: 'batch-a',
        batchImportedAt: '2026-07-18T00:00:00Z',
        entityCode: 'HQ-1',
        periodId: oracle.periodId,
        periodCode: 'P07',
        fiscalYear: 2026,
        periodNo: 7,
        entryDate: '2026-07-18',
        sourceRef: 'PV-25-0866',
        accountCode: '1400',
        accountType: 'asset',
        normalSide: 'debit',
        isContra: false,
        statementLineKey: 'bs.asset.fixed',
        debit: '4800000.00',
        credit: '0.00',
        description: 'Vendor V05 hardware invoice',
        counterpartyKey: 'V05',
      },
      // EXC-026 Control (C12: 96,000 is ~1.98x < 5x -> silent)
      {
        lineId: 'ex26-ctrl',
        entryId: 'e-ex26-ctrl',
        batchId: 'batch-a',
        batchImportedAt: '2026-07-18T00:00:00Z',
        entityCode: 'HQ-1',
        periodId: oracle.periodId,
        periodCode: 'P07',
        fiscalYear: 2026,
        periodNo: 7,
        entryDate: '2026-07-19',
        sourceRef: 'PV-CTRL-2X',
        accountCode: '1400',
        accountType: 'asset',
        normalSide: 'debit',
        isContra: false,
        statementLineKey: 'bs.asset.fixed',
        debit: '96000.00',
        credit: '0.00',
        description: 'Vendor V05 hardware invoice',
        counterpartyKey: 'V05',
      },
      // EXC-028 planted near-duplicate within 30 days
      {
        lineId: 'ex28-anchor',
        entryId: 'e-ex28-anchor',
        batchId: 'batch-a',
        batchImportedAt: '2026-07-02T00:00:00Z',
        entityCode: 'HQ-1',
        periodId: oracle.periodId,
        periodCode: 'P07',
        fiscalYear: 2026,
        periodNo: 7,
        entryDate: '2026-07-02',
        sourceRef: 'PV-DUP-A',
        accountCode: '6300',
        accountType: 'expense',
        normalSide: 'debit',
        isContra: false,
        statementLineKey: 'pl.opex.ga',
        debit: '32000.00',
        credit: '0.00',
        description: 'Legal retainer Acme Law',
        counterpartyKey: 'ACME-LAW',
      },
      {
        lineId: 'ex28-plant',
        entryId: 'e-ex28-plant',
        batchId: 'batch-a',
        batchImportedAt: '2026-07-20T00:00:00Z',
        entityCode: 'HQ-1',
        periodId: oracle.periodId,
        periodCode: 'P07',
        fiscalYear: 2026,
        periodNo: 7,
        entryDate: '2026-07-20',
        sourceRef: 'PV-DUP-B',
        accountCode: '6300',
        accountType: 'expense',
        normalSide: 'debit',
        isContra: false,
        statementLineKey: 'pl.opex.ga',
        debit: '32000.00',
        credit: '0.00',
        description: 'Legal retainer Acme Law',
        counterpartyKey: 'ACME-LAW',
      },
      {
        lineId: 'ex28-plant-cr',
        entryId: 'e-ex28-plant',
        batchId: 'batch-a',
        batchImportedAt: '2026-07-20T00:00:00Z',
        entityCode: 'HQ-1',
        periodId: oracle.periodId,
        periodCode: 'P07',
        fiscalYear: 2026,
        periodNo: 7,
        entryDate: '2026-07-20',
        sourceRef: 'PV-DUP-B',
        accountCode: '1000',
        accountType: 'asset',
        normalSide: 'debit',
        isContra: false,
        statementLineKey: 'bs.asset.cash',
        debit: '0.00',
        credit: '32000.00',
        description: 'Legal retainer Acme Law',
        counterpartyKey: 'ACME-LAW',
      },
    ];

    const input: ExceptionEvaluationInput = {
      companyId: '00000000-0000-4000-8000-000000000001',
      currency: oracle.currency,
      entityCode: oracle.entityCode,
      periodId: oracle.periodId,
      periodCode: oracle.periodCode,
      periodEndDate: oracle.periodEndDate,
      fiscalYear: oracle.fiscalYear,
      periodNo: oracle.periodNo,
      openTargetPeriodId: oracle.openTargetPeriodId,
      openTargetPeriodCode: oracle.openTargetPeriodCode,
      openTargetPeriodStartDate: oracle.openTargetPeriodStartDate,
      glLines,
      quarantinedRows: [
        {
          rowNo: 10,
          batchId: 'batch-a',
          periodCode: 'P07',
          entityCode: 'HQ-1',
          sourceRef: 'JV-UNBAL-1',
          accountCode: '5100',
          reason: 'UNBALANCED_ENTRY:JV-UNBAL-1',
          debit: '100000.00',
          credit: '99999.99',
        },
      ],
      bvaRows: [
        // EXC-018 High: +300k (3x 100k) AND +30% (6x 5%) -> escalates to high
        {
          accountCode: '5100',
          accountType: 'expense',
          statementLineKey: 'pl.cogs.product',
          plan: '1000000.00',
          actual: '1300000.00',
          variance: '300000.00',
          variancePct: '30.00',
        },
        // EXC-018 Medium boundary P30: +150k (1.5x) / +15% (3x) -> must be Medium (both legs must be >= 3x for High)
        {
          accountCode: '5120',
          accountType: 'expense',
          statementLineKey: 'pl.cogs.service',
          plan: '1000000.00',
          actual: '1150000.00',
          variance: '150000.00',
          variancePct: '15.00',
        },
        // EXC-018 Control C02: +150k passes abs, +1.5% fails pct -> MUST NOT FIRE
        {
          accountCode: '5200',
          accountType: 'expense',
          statementLineKey: 'pl.opex.ga',
          plan: '10000000.00',
          actual: '10150000.00',
          variance: '150000.00',
          variancePct: '1.50',
        },
        // EXC-018 Control C09: +60k fails abs, +30% passes pct -> MUST NOT FIRE
        {
          accountCode: '5300',
          accountType: 'expense',
          statementLineKey: 'pl.opex.ga',
          plan: '200000.00',
          actual: '260000.00',
          variance: '60000.00',
          variancePct: '30.00',
        },
      ],
    };

    const result = evaluateExceptionRules(input);
    expect(result.notRunRules.length).toBeGreaterThan(0);

    const byKey = new Map(result.findings.map((f) => [f.findingKey, f]));

    // Verify zero forbidden control findings
    for (const badKey of oracle.forbiddenControlFindingKeys) {
      expect(byKey.has(badKey)).toBe(false);
    }

    // Verify 100% recall on planted items (updating 5100 expected severity note: 200k is 2x < 300k so medium; wait let's check oracle!)
    for (const exp of oracle.expectedPlantedFindings) {
      const actual = byKey.get(exp.findingKey);
      expect(actual).toBeDefined();
      expect(actual!.ruleId).toBe(exp.ruleId);
      expect(actual!.title).toMatch(/^Potential exception — review:/);
      expect(actual!.suggestion.kind).toBe(exp.suggestionKind);
      expect(actual!.amount).toBe(exp.amount);
      expect(actual!.severity).toBe(exp.severity);
      if (exp.suggestedTargetAccount) {
        expect(actual!.evidence['suggestedAccount']).toBe(exp.suggestedTargetAccount);
      }
      if (exp.decimalShiftSuspect !== undefined) {
        expect(actual!.evidence['decimalShiftSuspect']).toBe(exp.decimalShiftSuspect);
      }
      // Every journal-producing suggestion must balance strictly to zero delta
      if (actual!.suggestion.lines.length > 0) {
        const dr = sum(actual!.suggestion.lines.map((l) => money(l.debit)));
        const cr = sum(actual!.suggestion.lines.map((l) => money(l.credit)));
        expect(serialize(dr, 2)).toBe(serialize(cr, 2));
        expect(actual!.suggestion.lines[0]!.memo).toContain(`[FPA ${actual!.ruleId}`);
      }
    }
  });

  it('enforces <=90 day waiver expiry, optimistic concurrency, and RBAC on lifecycle transitions', () => {
    expect(
      evaluateExceptionTransition({
        currentStatus: 'new',
        currentVersion: 1,
        expectedVersion: 1,
        action: 'acknowledge',
        actorRole: 'viewer',
        nowIso: '2026-11-26T00:00:00Z',
      }).errorCode,
    ).toBe('TENANT_FORBIDDEN');

    expect(
      evaluateExceptionTransition({
        currentStatus: 'new',
        currentVersion: 2,
        expectedVersion: 1,
        action: 'acknowledge',
        actorRole: 'editor',
        nowIso: '2026-11-26T00:00:00Z',
      }).errorCode,
    ).toBe('MODEL_VERSION_LOCKED');

    expect(
      evaluateExceptionTransition({
        currentStatus: 'new',
        currentVersion: 1,
        expectedVersion: 1,
        action: 'waive',
        actorRole: 'editor',
        waiverReason: 'Approved by controller',
        waiverExpiryDays: 30,
        nowIso: '2026-11-26T00:00:00Z',
      }).errorCode,
    ).toBe('TENANT_FORBIDDEN');

    expect(
      evaluateExceptionTransition({
        currentStatus: 'new',
        currentVersion: 1,
        expectedVersion: 1,
        action: 'waive',
        actorRole: 'owner',
        waiverReason: 'Too long',
        waiverExpiryDays: 91,
        nowIso: '2026-11-26T00:00:00Z',
      }).errorCode,
    ).toBe('VALIDATION_FAILED');

    const waived = evaluateExceptionTransition({
      currentStatus: 'new',
      currentVersion: 1,
      expectedVersion: 1,
      action: 'waive',
      actorRole: 'reviewer',
      waiverReason: 'Known Q3 timing difference',
      waiverExpiryDays: 30,
      nowIso: '2026-11-26T00:00:00Z',
    });
    expect(waived.ok).toBe(true);
    expect(waived.nextStatus).toBe('waived');
    expect(waived.waiverExpiresAt).toBe('2026-12-26T00:00:00.000Z');
  });

  it('builds balanced canonical GL CSV payloads for reversal-only rectification', () => {
    const csv = buildRectificationCsv({
      entryDate: '2026-08-01',
      entryRef: 'RECT-EXC025-1',
      lines: [
        { entityCode: 'HQ-1', accountCode: '6200', debit: '92500.00', credit: '0.00', memo: 'Reclass [FPA EXC-025 JV-25-0733]' },
        { entityCode: 'HQ-1', accountCode: '6400', debit: '0.00', credit: '92500.00', memo: 'Reverse [FPA EXC-025 JV-25-0733]' },
      ],
    });
    expect(csv).toContain('date,entry_ref,account_code,debit,credit,memo');
    expect(csv).toContain('2026-08-01,RECT-EXC025-1,6200,92500.00,0.00');
    expect(csv).toContain('[FPA EXC-025 JV-25-0733]');
  });
});
