import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateUaeCorporateTax,
  calculateUaeVat,
  calculateUnitDriverRevenue,
  calculateWeightedOccupancy,
  computeConsolidationWalkthrough,
  divideRoundHalfEven,
  formatScaled,
  parseDecimalToScaled,
} from './domainRules'

test('scaled integer parsing, formatting, and half-even rounding avoid f64 drift', () => {
  assert.equal(parseDecimalToScaled('1,000.50', 2), 100050n)
  assert.equal(parseDecimalToScaled('0.1', 2), 10n)
  assert.equal(parseDecimalToScaled('12.345', 2), null)
  assert.equal(formatScaled(1125000n, 2, true), '11,250.00')

  // Half-even tie breaking checks
  assert.equal(divideRoundHalfEven(5n, 2n), 2n) // 2.5 -> 2 (even)
  assert.equal(divideRoundHalfEven(7n, 2n), 4n) // 3.5 -> 4 (even)
})

test('UAE VAT U-02: matches documented exclusive, inclusive half-even, and NEEDS_REVIEW rules', () => {
  const exclusive = calculateUaeVat({
    amountRaw: '1000',
    basis: 'exclusive',
    ratePercentRaw: '5',
    taxTreatmentConfirmed: true,
  })
  assert.equal(exclusive.status, 'CALCULATED')
  if (exclusive.status === 'CALCULATED') {
    assert.equal(formatScaled(exclusive.taxableBaseFils), '1,000.00')
    assert.equal(formatScaled(exclusive.vatFils), '50.00')
    assert.equal(formatScaled(exclusive.grossTotalFils), '1,050.00')
  }

  // Documented docs/11 example: AED 1,000 tax-inclusive @ 5% => base 952.38, VAT 47.62
  const inclusive = calculateUaeVat({
    amountRaw: '1000',
    basis: 'inclusive',
    ratePercentRaw: '5',
    taxTreatmentConfirmed: true,
  })
  assert.equal(inclusive.status, 'CALCULATED')
  if (inclusive.status === 'CALCULATED') {
    assert.equal(formatScaled(inclusive.taxableBaseFils), '952.38')
    assert.equal(formatScaled(inclusive.vatFils), '47.62')
    assert.equal(formatScaled(inclusive.grossTotalFils), '1,000.00')
  }

  // Exempt or uncertain supplies must flag NEEDS_REVIEW, never silently default to 5% or 0%
  const uncertain = calculateUaeVat({
    amountRaw: '1000',
    basis: 'exempt_or_uncertain',
    taxTreatmentConfirmed: true,
  })
  assert.equal(uncertain.status, 'NEEDS_REVIEW')
  assert.equal(uncertain.vatFils, null)

  // Unconfirmed tax status also stops calculation
  const unconfirmed = calculateUaeVat({
    amountRaw: '1000',
    basis: 'exclusive',
    taxTreatmentConfirmed: false,
  })
  assert.equal(unconfirmed.status, 'NEEDS_REVIEW')
})

test('UAE Corporate Tax U-03: matches AED 500,000 standard scenario and blocks Free Zone/unconfirmed', () => {
  // Documented docs/11 example: 500,000 taxable income -> (500,000 - 375,000) * 9% = 11,250.00
  const standard = calculateUaeCorporateTax({
    taxableIncomeRaw: '500000',
    regime: 'standard_confirmed',
    specialReliefsOrGroupApply: false,
  })
  assert.equal(standard.status, 'CALCULATED_ILLUSTRATIVE')
  if (standard.status === 'CALCULATED_ILLUSTRATIVE') {
    assert.equal(formatScaled(standard.zeroBandAppliedFils), '375,000.00')
    assert.equal(formatScaled(standard.excessTaxableFils), '125,000.00')
    assert.equal(formatScaled(standard.estimatedTaxFils), '11,250.00')
  }

  const belowThreshold = calculateUaeCorporateTax({
    taxableIncomeRaw: '375000',
    regime: 'standard_confirmed',
    specialReliefsOrGroupApply: false,
  })
  assert.equal(belowThreshold.status, 'CALCULATED_ILLUSTRATIVE')
  if (belowThreshold.status === 'CALCULATED_ILLUSTRATIVE') {
    assert.equal(formatScaled(belowThreshold.estimatedTaxFils), '0.00')
  }

  // Free Zone / QFZP must never auto-apply the 375k standard threshold
  const freeZone = calculateUaeCorporateTax({
    taxableIncomeRaw: '500000',
    regime: 'free_zone_qfzp',
    specialReliefsOrGroupApply: false,
  })
  assert.equal(freeZone.status, 'NEEDS_REVIEW')
  assert.equal(freeZone.estimatedTaxFils, null)

  // Tax grouping or reliefs block simplified formula
  const grouped = calculateUaeCorporateTax({
    taxableIncomeRaw: '500000',
    regime: 'standard_confirmed',
    specialReliefsOrGroupApply: true,
  })
  assert.equal(grouped.status, 'NEEDS_REVIEW')
})

test('Consolidation golden walkthrough (docs/19 & T-AG-01): balanced elimination vs IC mismatch & dividend separation', () => {
  const matched = computeConsolidationWalkthrough({
    parentIcReceivable: 10n,
    hasOwnershipEvidence: true,
  })
  assert.equal(matched.status, 'ILLUSTRATIVE_BALANCED')
  assert.deepEqual(matched.consolidated, {
    cashAndAssets: 120n,
    liabilities: 0n,
    parentEquity: 100n,
    nciEquity: 20n,
    totalEquity: 120n,
  })
  assert.equal(matched.dividendBoundary.operatingUnitsEbitdaThousands, 850n)
  assert.equal(matched.dividendBoundary.investmentDividendThousands, 100n)
  assert.equal(matched.dividendBoundary.combinedOperatingEbitdaThousands, 850n)

  // Negative case from docs/19: Parent IC receivable 11 (Cash 9) vs Sub payable 10 -> blocked diff AED 1
  const mismatched = computeConsolidationWalkthrough({
    parentIcReceivable: 11n,
    hasOwnershipEvidence: true,
  })
  assert.equal(mismatched.status, 'BLOCKED')
  assert.equal(mismatched.blockerCode, 'UNMATCHED_INTERCOMPANY')
  assert.equal(mismatched.icDifference, 1n)
  assert.equal(mismatched.consolidated, null)

  // Negative case: missing ownership/control evidence blocks consolidation
  const noOwnership = computeConsolidationWalkthrough({
    parentIcReceivable: 10n,
    hasOwnershipEvidence: false,
  })
  assert.equal(noOwnership.status, 'BLOCKED')
  assert.equal(noOwnership.blockerCode, 'MISSING_OWNERSHIP_EVIDENCE')
  assert.equal(noOwnership.consolidated, null)
})

test('Sector KPI guards (docs/15 T-AG-07, T-AG-08): weighted occupancy & unit mismatch', () => {
  // T-AG-07 unequal-area fixture: 80/100 + 30/300 = 110/400 = 27.5%, NOT 45.0%
  const occupancy = calculateWeightedOccupancy([
    { name: 'Asset A', leasedArea: 80n, leasableArea: 100n, unit: 'sq ft' },
    { name: 'Asset B', leasedArea: 30n, leasableArea: 300n, unit: 'sq ft' },
  ])
  assert.equal(occupancy.status, 'CALCULATED')
  if (occupancy.status === 'CALCULATED') {
    assert.equal(formatScaled(occupancy.weightedPercentTenths, 1), '27.5')
    assert.equal(formatScaled(occupancy.naiveUnweightedAverageTenths, 1), '45.0')
  }

  const zeroDenom = calculateWeightedOccupancy([
    { name: 'Bad asset', leasedArea: 0n, leasableArea: 0n, unit: 'sq ft' },
  ])
  assert.equal(zeroDenom.status, 'ERROR')
  if (zeroDenom.status === 'ERROR') {
    assert.equal(zeroDenom.code, 'ZERO_DENOMINATOR')
  }

  // T-AG-08: 2 tonnes @ 500 AED/tonne = 1,000.00 AED; 2000 kg = 1,000.00 AED; pallet -> UNIT_MISMATCH
  const tonnes = calculateUnitDriverRevenue({
    quantity: 2n,
    quantityUnit: 'tonne',
    pricePerTonneFils: 50000n,
  })
  assert.equal(tonnes.status, 'CALCULATED')
  if (tonnes.status === 'CALCULATED') {
    assert.equal(formatScaled(tonnes.revenueFils, 2), '1,000.00')
  }

  const kg = calculateUnitDriverRevenue({
    quantity: 2000n,
    quantityUnit: 'kg',
    pricePerTonneFils: 50000n,
  })
  assert.equal(kg.status, 'CALCULATED')
  if (kg.status === 'CALCULATED') {
    assert.equal(formatScaled(kg.revenueFils, 2), '1,000.00')
  }

  const palletMismatch = calculateUnitDriverRevenue({
    quantity: 4n,
    quantityUnit: 'pallet',
    pricePerTonneFils: 50000n,
  })
  assert.equal(palletMismatch.status, 'UNIT_MISMATCH')
})
