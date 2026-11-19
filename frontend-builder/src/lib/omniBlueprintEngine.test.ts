import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ERP_UNIVERSAL_ADAPTERS,
  INDUSTRY_BLUEPRINT_PACKS,
  LANGUAGE_RUNTIME_CONTRACTS,
  MASTER_EXECUTION_ROADMAP,
  allocateLargestRemainder,
  buildAuditChainFixture,
  calculateCapexDepreciationRollForward,
  calculatePriceVolumeMixBridge,
  calculateUaeWorkforceEosb,
  createInitialXllCommandLedger,
  estimateHyperblockFootprint,
  evaluate13WeekCashForecast,
  evaluateExcelXllFormula,
  evaluateIngestionBatch,
  evaluateStatementPolicyMatrix,
  formatCanonicalFindingKey,
  generateGoldenContractBundle,
  normalizeErpSampleRecord,
  processExcelWriteCommand,
  runAllInvariantsSuite,
  sha256HexSync,
  topologicalSortFormulaDag,
  validateAllErpAdapters,
  validateAllIndustryPacks,
  verifyAuditChain,
} from './omniBlueprintEngine'

test('All 10 industry blueprint packs pass validation with 0 warnings and deterministic BigInt metrics', () => {
  const result = validateAllIndustryPacks()
  assert.equal(result.totalPacks, 10)
  assert.equal(result.totalWarnings, 0)
  assert.equal(INDUSTRY_BLUEPRINT_PACKS.length, 10)

  const saas = result.reports.find(r => r.packId === 'saas')
  assert.ok(saas)
  const closingArr = saas.evaluatedMetrics.find(m => m.id === 'closing_arr')
  const nrr = saas.evaluatedMetrics.find(m => m.id === 'nrr_pct')
  assert.equal(closingArr?.rawScaled, 1245000n) // 12,450.00 AED k
  assert.equal(nrr?.rawScaled, 1100n) // 110.0%

  const re = result.reports.find(r => r.packId === 'real_estate')
  assert.ok(re)
  assert.equal(
    re.evaluatedMetrics.find(m => m.id === 'weighted_occupancy_pct')?.rawScaled,
    275n // 27.5%
  )

  const construction = result.reports.find(r => r.packId === 'construction')
  assert.ok(construction)
  assert.equal(construction.evaluatedMetrics.find(m => m.id === 'poc_pct')?.rawScaled, 500n) // 50.0%
  assert.equal(construction.evaluatedMetrics.find(m => m.id === 'net_cie_bie')?.rawScaled, 50000000n) // +500,000.00 AED CIE
})

test('Largest-Remainder exact-sum allocator guarantees zero penny drift and deterministic tie-break', () => {
  const split = allocateLargestRemainder({
    sourcePoolRaw: '100.00',
    targets: [
      { id: 'c', label: 'Unit C', weightRaw: '33.33' },
      { id: 'a', label: 'Unit A', weightRaw: '33.33' },
      { id: 'b', label: 'Unit B', weightRaw: '33.33' },
    ],
  })

  assert.equal(split.status, 'ALLOCATED')
  assert.equal(split.reconciliationDeltaFils, 0n)
  assert.equal(split.sumAllocatedFils, 10000n)
  assert.equal(split.pennyUnitsDistributed, 1n)
  assert.equal(split.rows.find(r => r.id === 'a')?.finalAllocatedFils, 3334n)
  assert.equal(split.rows.find(r => r.id === 'b')?.finalAllocatedFils, 3333n)
  assert.equal(split.rows.find(r => r.id === 'c')?.finalAllocatedFils, 3333n)
})

test('Largest-Remainder allocator explicitly rejects negative/mixed weights and zero weight bases (I05)', () => {
  const neg = allocateLargestRemainder({
    sourcePoolRaw: '1000.00',
    targets: [
      { id: 'a', label: 'Dept A', weightRaw: '80' },
      { id: 'b', label: 'Dept B', weightRaw: '-10' },
    ],
  })
  assert.equal(neg.status, 'ERROR')
  assert.equal(neg.code, 'MIXED_OR_NEGATIVE_WEIGHTS')

  const zero = allocateLargestRemainder({
    sourcePoolRaw: '1000.00',
    targets: [
      { id: 'a', label: 'Dept A', weightRaw: '0' },
      { id: 'b', label: 'Dept B', weightRaw: '0' },
    ],
  })
  assert.equal(zero.status, 'ERROR')
  assert.equal(zero.code, 'ZERO_WEIGHT_BASE')
})

test('100M+ cell adaptive Block-Hybrid estimator stays under 2.2 GB budget at default sparsity and flags spill at extreme density', () => {
  const baseline = estimateHyperblockFootprint({
    populatedCellsMillions: 100,
    denseRatioPct: 35,
    workingSetBudgetMb: 2200,
  })
  assert.equal(baseline.populatedCells, 100_000_000)
  assert.equal(baseline.blockCountActive, 24_415)
  assert.equal(baseline.spillRequired, false)
  assert.ok(baseline.totalFootprintMb < 2200)

  const heavy = estimateHyperblockFootprint({
    populatedCellsMillions: 220,
    denseRatioPct: 85,
    workingSetBudgetMb: 2200,
  })
  assert.equal(heavy.spillRequired, true)
  assert.ok(heavy.spilledColdMb > 0)
})

test('Source-scoped ingestion gate (IMP-GL vs IMP-SUB) fixes OQ-025 sub-ledger drop, K2 future leak, and K3 canonical key', () => {
  const legacy = evaluateIngestionBatch('LEGACY_UNSCOPED_BUG')
  assert.equal(legacy.totalLoaded, 1420)
  assert.equal(legacy.batches.find(b => b.sourceKind === 'BANK_SUBLEDGER')?.rowsAccepted, 0)
  assert.equal(legacy.batches.find(b => b.sourceKind === 'PAYROLL_REGISTER')?.rowsAccepted, 0)

  const scoped = evaluateIngestionBatch('COHERENT_SCOPED')
  assert.equal(scoped.totalLoaded, 1420 + 499 + 399 + 180)
  assert.equal(scoped.falseAlertCount, 0)

  const futureLeak = evaluateIngestionBatch('FUTURE_DATE_LEAK')
  assert.equal(futureLeak.batches.find(b => b.sourceKind === 'PROPERTY_RENT_ROLL')?.status, 'BLOCKED')
  assert.equal(
    formatCanonicalFindingKey({
      ruleId: 'exc-011',
      entityCode: 'ent-03',
      accountCode: '4200-rent',
      periodCode: '2026-12',
      grain: 'unit_lease',
    }),
    'EXC-011|ENT-03|4200-RENT|2026-12|UNIT_LEASE'
  )
})

test('All 5 language runtime contracts and all 36 blocking invariants (I01..I36) pass cleanly with or without Rust fallbacks', () => {
  assert.equal(LANGUAGE_RUNTIME_CONTRACTS.length, 5)
  const fullRun = runAllInvariantsSuite([])
  assert.equal(fullRun.total, 36)
  assert.equal(fullRun.passedCount, 36)
  assert.equal(fullRun.failedCount, 0)

  const fallbackRun = runAllInvariantsSuite(['go', 'elixir', 'java'])
  assert.equal(fallbackRun.passedCount, 36)
  assert.equal(fallbackRun.failedCount, 0)
})

test('FIPS 180-4 SHA-256 hash-chained audit ledger verifies clean chain and pinpoints payload tamper (I22)', () => {
  assert.equal(
    sha256HexSync('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  )

  const chain = buildAuditChainFixture()
  assert.equal(chain.length, 5)
  const cleanReport = verifyAuditChain(chain)
  assert.equal(cleanReport.valid, true)
  assert.equal(cleanReport.brokenSequence, null)

  const tamperedChain = chain.map((entry, idx) =>
    idx === 2 ? { ...entry, canonicalPayload: 'pool=100.00|tampered' } : entry
  )
  const tamperReport = verifyAuditChain(tamperedChain)
  assert.equal(tamperReport.valid, false)
  assert.equal(tamperReport.brokenSequence, 2)
  assert.equal(tamperReport.links[2].linkValid, false)
})

test('Excel XLL P0 evaluates FPA.GET safely, blocks FPA.SET, guards 15-sig-digit precision loss, and enforces I28 idempotency', () => {
  const ok = evaluateExcelXllFormula('=FPA.GET("ENT-01","REV","2026-01","ACTUAL")')
  assert.equal(ok.status, 'SAFE_EXACT')
  assert.equal(ok.excelNumericOutput, '1000000.00')

  const missing = evaluateExcelXllFormula('=FPA.GET("TPL-04","CASH","2026-01","ACTUAL")')
  assert.equal(missing.status, 'MISSING_INPUT')
  assert.equal(missing.excelNumericOutput, '#N/A (Not provided)')

  const blockedSet = evaluateExcelXllFormula('=FPA.SET("ENT-01","REV","2026-01",999)')
  assert.equal(blockedSet.status, 'BLOCKED_READ_ONLY')

  const precision = evaluateExcelXllFormula('=FPA.GET("PRECISION_TEST","MAX_SAFE","2026-01","ACTUAL")')
  assert.equal(precision.status, 'PRECISION_LOSS_BLOCKED')

  const ledger0 = createInitialXllCommandLedger()
  const c1 = processExcelWriteCommand(ledger0, {
    idempotencyKey: 'xll-batch-001',
    expectedRevision: 12,
    entityCode: 'ENT-01',
    accountCode: 'REV',
    periodCode: '2026-01',
    proposedRaw: '1050000.00',
  })
  assert.equal(c1.outcome, 'COMMITTED')
  assert.equal(c1.resultingRevision, 13)

  const replay = processExcelWriteCommand(c1.nextLedger, {
    idempotencyKey: 'xll-batch-001',
    expectedRevision: 13,
    entityCode: 'ENT-01',
    accountCode: 'REV',
    periodCode: '2026-01',
    proposedRaw: '1050000.00',
  })
  assert.equal(replay.outcome, 'IDEMPOTENT_REPLAY')
  assert.equal(replay.resultingRevision, 13)

  const conflict = processExcelWriteCommand(c1.nextLedger, {
    idempotencyKey: 'xll-batch-001',
    expectedRevision: 13,
    entityCode: 'ENT-01',
    accountCode: 'REV',
    periodCode: '2026-01',
    proposedRaw: '999999.00',
  })
  assert.equal(conflict.outcome, 'IDEMPOTENCY_CONFLICT')

  const stale = processExcelWriteCommand(c1.nextLedger, {
    idempotencyKey: 'xll-batch-002',
    expectedRevision: 12,
    entityCode: 'ENT-01',
    accountCode: 'REV',
    periodCode: '2026-01',
    proposedRaw: '1100000.00',
  })
  assert.equal(stale.outcome, 'STALE_REVISION_CONFLICT')
})

test('Statement multi-period aggregation guards STOCK_CLOSING_LAST / RATIO_OF_SUMS and rejects cyclic formula DAGs (I08/I09/I27)', () => {
  const matrix = evaluateStatementPolicyMatrix()
  assert.equal(matrix.quarterFlowRevenueThousands, 9660n)
  assert.equal(matrix.quarterFlowOperatingResultThousands, 2740n)
  assert.equal(matrix.quarterClosingArrFils, 1245000n)
  assert.notEqual(matrix.quarterClosingArrFils, matrix.naiveBrokenStockSumArrFils)
  assert.equal(matrix.quarterOperatingMarginPctTenths, 284n) // 2,740 / 9,660 = 28.36% -> 28.4%
  assert.deepEqual(matrix.dagOrder, [
    'expenses_flow',
    'revenue_flow',
    'operating_result',
    'operating_margin_pct',
  ])

  const cycle = topologicalSortFormulaDag([
    { id: 'rev', deps: [] },
    { id: 'a', deps: ['b'] },
    { id: 'b', deps: ['a'] },
  ])
  assert.equal(cycle.status, 'CYCLIC_DEPENDENCY_DETECTED')

  const bundle = generateGoldenContractBundle()
  assert.equal(bundle.schemaVersion, 'atlas-fpa-omni-v3.0')
  assert.equal(bundle.summary.packsValidated, 10)
  assert.equal(bundle.summary.erpAdaptersValidated, 12)
  assert.equal(bundle.summary.roadmapPhasesCount, 8)
  assert.equal(bundle.summary.invariantsPassed, 36)
  assert.equal(bundle.auditHashChainVector.sha256AbcCheck, sha256HexSync('abc'))
})

test('Universal Top-12 ERP Adapter Catalog normalizes all 12 ERP dialects and quarantines unmapped CoA codes (I33)', () => {
  assert.equal(ERP_UNIVERSAL_ADAPTERS.length, 12)
  const validation = validateAllErpAdapters()
  assert.equal(validation.totalAdapters, 12)
  assert.equal(validation.allPassed, true)

  const sap = normalizeErpSampleRecord('ERP-01', false)
  assert.equal(sap.signedAmountFils, -12500050n)
  assert.equal(sap.gateRoute, 'IMP-GL (Double-Entry Dr == Cr)')
  assert.equal(sap.coaStatus, 'MAPPED_SCD2_ACTIVE')

  const tally = normalizeErpSampleRecord('ERP-05', false)
  assert.equal(tally.signedAmountFils, 25000000n) // 2,50,000.00 Dr

  const workday = normalizeErpSampleRecord('ERP-08', false)
  assert.equal(workday.gateRoute, 'IMP-SUB (Control Total + Fiscal Window)') // Payroll Roster bypasses IMP-GL trial-balance gate

  const quarantined = normalizeErpSampleRecord('ERP-01', true)
  assert.equal(quarantined.coaStatus, 'QUARANTINED_UNMAPPED_COA')
  assert.equal(quarantined.canonicalAccountCode, 'UNMAPPED_SUSPENSE_9999')
})

test('One-Stop FP&A Replacement Engines: UAE Art. 51 EOSB, CapEx Roll-Forward, 13-Week Cash DSCR, and PVM Variance Bridge (I34/I35/I36)', () => {
  const eosb6Yr = calculateUaeWorkforceEosb({
    headcount: 10n,
    monthlyBasicSalaryAedRaw: '15000.00',
    monthlyAllowancesAedRaw: '5000.00',
    yearsOfServiceWhole: 6n, // 5y * 21d + 1y * 30d
  })
  assert.equal(eosb6Yr.status, 'CALCULATED')
  if (eosb6Yr.status === 'CALCULATED') {
    assert.equal(eosb6Yr.capApplied, false)
    assert.ok(eosb6Yr.totalCappedEosbLiabilityFils > 0n)
  }

  const eosb45Yr = calculateUaeWorkforceEosb({
    headcount: 2n,
    monthlyBasicSalaryAedRaw: '20000.00',
    monthlyAllowancesAedRaw: '10000.00',
    yearsOfServiceWhole: 45n,
  })
  assert.equal(eosb45Yr.status, 'CALCULATED')
  if (eosb45Yr.status === 'CALCULATED') {
    assert.equal(eosb45Yr.capApplied, true)
    assert.equal(eosb45Yr.singleEmployeeCappedEosbFils, 72000000n) // 24 * 30,000.00 AED
    assert.equal(eosb45Yr.totalCappedEosbLiabilityFils, 144000000n)
  }

  const capex = calculateCapexDepreciationRollForward({
    openingNbvFils: 500000000n,
    additionsFils: 120000000n,
    cwipTransferInFils: 30000000n,
    disposalsNbvFils: 20000000n,
    depreciationChargeFils: 45000000n,
  })
  assert.equal(capex.reconcilesToZeroDelta, true)
  assert.equal(capex.aggregationPolicy, 'STOCK_CLOSING_LAST')

  const cashBase = evaluate13WeekCashForecast('BASE_CUSHION')
  assert.equal(cashBase.covenantStatus, 'COVENANT_COMPLIANT')
  assert.equal(cashBase.revolverDrawRequiredFils, 0n)

  const cashStress = evaluate13WeekCashForecast('COLLECTION_DELAY_STRESS')
  assert.equal(cashStress.covenantStatus, 'REVOLVER_SWEEP_AND_COVENANT_ALERT')
  assert.equal(cashStress.revolverDrawRequiredFils, 70000000n)

  const pvm = calculatePriceVolumeMixBridge({
    budgetUnits: 1000n,
    actualUnits: 1150n,
    budgetPriceFils: 12000n,
    actualPriceFils: 13000n,
    mixShiftFils: 150000n,
    fxTranslationFils: -50000n,
  })
  assert.equal(pvm.reconciliationDeltaFils, 0n)
  assert.equal(MASTER_EXECUTION_ROADMAP.length, 8)
})



