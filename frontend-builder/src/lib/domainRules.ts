// Pure decimal-safe (BigInt scaled-integer) prototype calculators and boundary guards.
// Avoids binary f32/f64 arithmetic for financial figures, rates, and ratios.
// These implement illustrative walkthroughs from fpa-documentation/docs/11, 14, 15, and 19.
// They are NOT approved accounting policies, production engines, or tax filings.

export const UAE_VAT_DEFAULT_BPS = 500n // 5.00%
export const UAE_CT_THRESHOLD_FILS = 37_500_000n // AED 375,000.00 in fils (1/100 AED)
export const UAE_CT_RATE_BPS = 900n // 9.00%

export function divideRoundHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new Error('Division by zero')
  }
  const sign = (numerator < 0n) !== (denominator < 0n) ? -1n : 1n
  const absNum = numerator < 0n ? -numerator : numerator
  const absDen = denominator < 0n ? -denominator : denominator
  const quotient = absNum / absDen
  const remainder = absNum % absDen
  const twiceRemainder = remainder * 2n
  const rounded =
    twiceRemainder > absDen || (twiceRemainder === absDen && (quotient & 1n) === 1n)
      ? quotient + 1n
      : quotient
  return rounded * sign
}

export function parseDecimalToScaled(raw: string, scale = 2): bigint | null {
  const cleaned = raw.trim().replace(/,/g, '')
  if (!cleaned) return null
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(cleaned)
  if (!match) return null
  const [, neg, whole, frac = ''] = match
  if (frac.length > scale) return null
  const paddedFrac = frac.padEnd(scale, '0')
  const factor = 10n ** BigInt(scale)
  const magnitude = BigInt(whole) * factor + (scale > 0 ? BigInt(paddedFrac) : 0n)
  return neg ? -magnitude : magnitude
}

export function formatScaled(value: bigint, scale = 2, grouping = true): string {
  const neg = value < 0n
  const abs = neg ? -value : value
  const factor = 10n ** BigInt(scale)
  const whole = abs / factor
  const frac = abs % factor
  const wholeDigits = whole.toString()
  const formattedWhole = grouping
    ? wholeDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    : wholeDigits
  const prefix = neg ? '-' : ''
  if (scale === 0) return `${prefix}${formattedWhole}`
  return `${prefix}${formattedWhole}.${frac.toString().padStart(scale, '0')}`
}

// ---------------------------------------------------------------------------
// 1. UAE VAT Planning Estimator (docs/11 U-02)
// ---------------------------------------------------------------------------

export type VatBasis = 'exclusive' | 'inclusive' | 'exempt_or_uncertain'

export type VatEstimateResult =
  | {
      status: 'CALCULATED'
      basis: 'exclusive' | 'inclusive'
      rateBps: bigint
      taxableBaseFils: bigint
      vatFils: bigint
      grossTotalFils: bigint
      disclaimer: string
    }
  | {
      status: 'NEEDS_REVIEW'
      reason: string
      taxableBaseFils: null
      vatFils: null
      grossTotalFils: null
      disclaimer: string
    }
  | {
      status: 'INVALID_INPUT'
      error: string
      taxableBaseFils: null
      vatFils: null
      grossTotalFils: null
    }

export function calculateUaeVat(params: {
  amountRaw: string
  basis: VatBasis
  ratePercentRaw?: string
  taxTreatmentConfirmed: boolean
}): VatEstimateResult {
  const disclaimer = 'Planning estimate only — review applicability with a qualified UAE tax adviser.'

  if (params.basis === 'exempt_or_uncertain' || !params.taxTreatmentConfirmed) {
    return {
      status: 'NEEDS_REVIEW',
      reason:
        params.basis === 'exempt_or_uncertain'
          ? 'Exempt, zero-rated, reverse-charge, or uncertain supplies are flagged NEEDS_REVIEW and never silently taxed at 5% or 0%.'
          : 'Confirm that VAT treatment and recovery eligibility have been reviewed before computing an illustrative estimate.',
      taxableBaseFils: null,
      vatFils: null,
      grossTotalFils: null,
      disclaimer,
    }
  }

  const amountFils = parseDecimalToScaled(params.amountRaw, 2)
  if (amountFils === null || amountFils < 0n) {
    return {
      status: 'INVALID_INPUT',
      error: 'Enter a valid non-negative AED amount with at most 2 decimal places.',
      taxableBaseFils: null,
      vatFils: null,
      grossTotalFils: null,
    }
  }

  let rateBps = UAE_VAT_DEFAULT_BPS
  if (params.ratePercentRaw !== undefined) {
    const parsedRate = parseDecimalToScaled(params.ratePercentRaw, 2)
    if (parsedRate === null || parsedRate < 0n || parsedRate > 10000n) {
      return {
        status: 'INVALID_INPUT',
        error: 'Enter a user-reviewed VAT rate between 0.00% and 100.00%.',
        taxableBaseFils: null,
        vatFils: null,
        grossTotalFils: null,
      }
    }
    rateBps = parsedRate
  }

  if (params.basis === 'exclusive') {
    const vatFils = divideRoundHalfEven(amountFils * rateBps, 10000n)
    return {
      status: 'CALCULATED',
      basis: 'exclusive',
      rateBps,
      taxableBaseFils: amountFils,
      vatFils,
      grossTotalFils: amountFils + vatFils,
      disclaimer,
    }
  }

  // Inclusive basis: base = gross / (1 + rate), VAT = gross - base (half-even 2-decimal rounding)
  const taxableBaseFils = divideRoundHalfEven(amountFils * 10000n, 10000n + rateBps)
  const vatFils = amountFils - taxableBaseFils
  return {
    status: 'CALCULATED',
    basis: 'inclusive',
    rateBps,
    taxableBaseFils,
    vatFils,
    grossTotalFils: amountFils,
    disclaimer,
  }
}

// ---------------------------------------------------------------------------
// 2. UAE Corporate Tax Planning Scenario (docs/11 U-03)
// ---------------------------------------------------------------------------

export type CorporateTaxRegime = 'standard_confirmed' | 'free_zone_qfzp' | 'unconfirmed'

export type CorporateTaxResult =
  | {
      status: 'CALCULATED_ILLUSTRATIVE'
      taxableIncomeFils: bigint
      zeroBandAppliedFils: bigint
      excessTaxableFils: bigint
      estimatedTaxFils: bigint
      disclaimer: string
    }
  | {
      status: 'NEEDS_REVIEW'
      reason: string
      estimatedTaxFils: null
      disclaimer: string
    }
  | {
      status: 'INVALID_INPUT'
      error: string
      estimatedTaxFils: null
    }

export function calculateUaeCorporateTax(params: {
  taxableIncomeRaw: string
  regime: CorporateTaxRegime
  specialReliefsOrGroupApply: boolean
}): CorporateTaxResult {
  const disclaimer =
    'Illustrative planning scenario only — not a statutory Corporate Tax calculation or FTA return.'

  if (params.regime !== 'standard_confirmed') {
    return {
      status: 'NEEDS_REVIEW',
      reason:
        params.regime === 'free_zone_qfzp'
          ? 'Free Zone / Qualifying Free Zone Person (QFZP) eligibility, de minimis thresholds, and qualifying income rules cannot be inferred automatically (NEEDS_REVIEW).'
          : 'Entity tax regime is unconfirmed. Standard 0% / 9% thresholds are blocked until confirmed by qualified finance review.',
      estimatedTaxFils: null,
      disclaimer,
    }
  }

  if (params.specialReliefsOrGroupApply) {
    return {
      status: 'NEEDS_REVIEW',
      reason:
        'Tax grouping, Small Business Relief, loss carry-forwards, or interest limitations apply; enter a manually reviewed provision instead of the simplified single-entity scenario.',
      estimatedTaxFils: null,
      disclaimer,
    }
  }

  const taxableIncomeFils = parseDecimalToScaled(params.taxableIncomeRaw, 2)
  if (taxableIncomeFils === null || taxableIncomeFils < 0n) {
    return {
      status: 'INVALID_INPUT',
      error: 'Enter a valid non-negative taxable income in AED (up to 2 decimals).',
      estimatedTaxFils: null,
    }
  }

  const zeroBandAppliedFils =
    taxableIncomeFils > UAE_CT_THRESHOLD_FILS ? UAE_CT_THRESHOLD_FILS : taxableIncomeFils
  const excessTaxableFils =
    taxableIncomeFils > UAE_CT_THRESHOLD_FILS ? taxableIncomeFils - UAE_CT_THRESHOLD_FILS : 0n
  const estimatedTaxFils = divideRoundHalfEven(excessTaxableFils * UAE_CT_RATE_BPS, 10000n)

  return {
    status: 'CALCULATED_ILLUSTRATIVE',
    taxableIncomeFils,
    zeroBandAppliedFils,
    excessTaxableFils,
    estimatedTaxFils,
    disclaimer,
  }
}

// ---------------------------------------------------------------------------
// 3. Consolidation Golden Walkthrough (docs/19 & docs/14 T-AG-01)
// ---------------------------------------------------------------------------

export type StandaloneBalance = {
  cash: bigint
  icReceivable: bigint
  investmentInSub: bigint
  totalAssets: bigint
  icPayable: bigint
  equity: bigint
  totalLiabilitiesAndEquity: bigint
}

export type ConsolidationWalkthroughResult = {
  status: 'ILLUSTRATIVE_BALANCED' | 'BLOCKED'
  blockerCode: 'NONE' | 'MISSING_OWNERSHIP_EVIDENCE' | 'UNMATCHED_INTERCOMPANY'
  blockerMessage: string | null
  parent: StandaloneBalance
  subsidiary: StandaloneBalance
  icDifference: bigint
  eliminations: { label: string; debit: string; credit: string }[]
  consolidated: {
    cashAndAssets: bigint
    liabilities: bigint
    parentEquity: bigint
    nciEquity: bigint
    totalEquity: bigint
  } | null
  dividendBoundary: {
    operatingUnitsEbitdaThousands: bigint
    investmentDividendThousands: bigint
    combinedOperatingEbitdaThousands: bigint
  }
}

export function computeConsolidationWalkthrough(params: {
  parentIcReceivable: bigint
  hasOwnershipEvidence: boolean
}): ConsolidationWalkthroughResult {
  const parentIc = params.parentIcReceivable
  // Keep standalone Parent balance sheet balanced at 100 AED by adjusting cash:
  // Baseline from docs/19: Cash 10 + IC Rec 10 + Investment 80 = 100 (Equity 100).
  // Negative case from docs/19: Cash 9 + IC Rec 11 + Investment 80 = 100 (Equity 100).
  const parentCash = 20n - parentIc
  const parent: StandaloneBalance = {
    cash: parentCash,
    icReceivable: parentIc,
    investmentInSub: 80n,
    totalAssets: parentCash + parentIc + 80n,
    icPayable: 0n,
    equity: 100n,
    totalLiabilitiesAndEquity: 100n,
  }

  const subsidiary: StandaloneBalance = {
    cash: 110n,
    icReceivable: 0n,
    investmentInSub: 0n,
    totalAssets: 110n,
    icPayable: 10n,
    equity: 100n,
    totalLiabilitiesAndEquity: 110n,
  }

  const dividendBoundary = {
    operatingUnitsEbitdaThousands: 850n, // Packaging 250 + Metals 300 + Property 300
    investmentDividendThousands: 100n, // Separate Synthetic Investments cash dividend
    combinedOperatingEbitdaThousands: 850n, // Never merges Investment dividend (100) into operating EBITDA
  }

  const icDifference = parent.icReceivable - subsidiary.icPayable

  if (!params.hasOwnershipEvidence) {
    return {
      status: 'BLOCKED',
      blockerCode: 'MISSING_OWNERSHIP_EVIDENCE',
      blockerMessage:
        'Ownership and control evidence is missing (CONS-001). Approved consolidation is blocked until legal perimeter and NCI% are confirmed.',
      parent,
      subsidiary,
      icDifference,
      eliminations: [],
      consolidated: null,
      dividendBoundary,
    }
  }

  if (icDifference !== 0n) {
    return {
      status: 'BLOCKED',
      blockerCode: 'UNMATCHED_INTERCOMPANY',
      blockerMessage: `Unmatched intercompany balance: Parent IC receivable AED ${parent.icReceivable.toString()} vs. Subsidiary IC payable AED ${subsidiary.icPayable.toString()} (difference AED ${icDifference.toString()}). Consolidation blocked — no silent plug allowed (CONS-004).`,
      parent,
      subsidiary,
      icDifference,
      eliminations: [],
      consolidated: null,
      dividendBoundary,
    }
  }

  if (parent.cash < 0n) {
    return {
      status: 'BLOCKED',
      blockerCode: 'UNMATCHED_INTERCOMPANY',
      blockerMessage: 'Invalid negative standalone cash balance.',
      parent,
      subsidiary,
      icDifference,
      eliminations: [],
      consolidated: null,
      dividendBoundary,
    }
  }

  const cashAndAssets = parent.cash + subsidiary.cash
  const parentEquity = parent.equity
  const nciEquity = 20n // 20% NCI on 100n subsidiary identifiable net assets (docs/19)

  return {
    status: 'ILLUSTRATIVE_BALANCED',
    blockerCode: 'NONE',
    blockerMessage: null,
    parent,
    subsidiary,
    icDifference: 0n,
    eliminations: [
      {
        label: '1. Eliminate IC loan',
        debit: 'IC payable 10',
        credit: 'IC receivable 10',
      },
      {
        label: '2. Eliminate investment & recognize 20% NCI',
        debit: 'Subsidiary equity 100',
        credit: 'Investment in subsidiary 80 · NCI equity 20',
      },
    ],
    consolidated: {
      cashAndAssets,
      liabilities: 0n,
      parentEquity,
      nciEquity,
      totalEquity: parentEquity + nciEquity,
    },
    dividendBoundary,
  }
}

// ---------------------------------------------------------------------------
// 4. Sector KPI & Unit Conversion Boundary Guards (docs/15 T-AG-07, T-AG-08)
// ---------------------------------------------------------------------------

export type OccupancyResult =
  | {
      status: 'CALCULATED'
      totalLeased: bigint
      totalLeasable: bigint
      weightedPercentTenths: bigint // e.g. 275n => 27.5%
      naiveUnweightedAverageTenths: bigint // e.g. 450n => 45.0% (illustrative anti-pattern)
      unit: string
    }
  | {
      status: 'ERROR'
      code: 'EMPTY_PORTFOLIO' | 'ZERO_DENOMINATOR' | 'UNIT_MISMATCH' | 'INVALID_AREA'
      message: string
    }

export function calculateWeightedOccupancy(
  properties: { name: string; leasedArea: bigint; leasableArea: bigint; unit: string }[]
): OccupancyResult {
  if (properties.length === 0) {
    return {
      status: 'ERROR',
      code: 'EMPTY_PORTFOLIO',
      message: 'At least one property record is required to compute portfolio occupancy.',
    }
  }

  const baseUnit = properties[0].unit
  let totalLeased = 0n
  let totalLeasable = 0n
  let sumIndividualTenths = 0n

  for (const prop of properties) {
    if (prop.unit !== baseUnit) {
      return {
        status: 'ERROR',
        code: 'UNIT_MISMATCH',
        message: `Incompatible area units (${baseUnit} vs. ${prop.unit}). Convert explicitly before aggregating.`,
      }
    }
    if (prop.leasableArea <= 0n || prop.leasedArea < 0n || prop.leasedArea > prop.leasableArea) {
      return {
        status: 'ERROR',
        code: prop.leasableArea <= 0n ? 'ZERO_DENOMINATOR' : 'INVALID_AREA',
        message: `Property "${prop.name}" has an invalid leased/leasable area denominator.`,
      }
    }
    totalLeased += prop.leasedArea
    totalLeasable += prop.leasableArea
    sumIndividualTenths += divideRoundHalfEven(prop.leasedArea * 1000n, prop.leasableArea)
  }

  const weightedPercentTenths = divideRoundHalfEven(totalLeased * 1000n, totalLeasable)
  const naiveUnweightedAverageTenths = divideRoundHalfEven(
    sumIndividualTenths,
    BigInt(properties.length)
  )

  return {
    status: 'CALCULATED',
    totalLeased,
    totalLeasable,
    weightedPercentTenths,
    naiveUnweightedAverageTenths,
    unit: baseUnit,
  }
}

export type UnitDriverResult =
  | {
      status: 'CALCULATED'
      normalizedTonnesThousandths: bigint // 2.000 tonnes => 2000n
      revenueFils: bigint
    }
  | {
      status: 'UNIT_MISMATCH'
      message: string
    }

export function calculateUnitDriverRevenue(params: {
  quantity: bigint
  quantityUnit: 'tonne' | 'kg' | 'pallet'
  pricePerTonneFils: bigint
}): UnitDriverResult {
  if (params.quantity < 0n || params.pricePerTonneFils < 0n) {
    return {
      status: 'UNIT_MISMATCH',
      message: 'Quantities and unit prices must be non-negative.',
    }
  }
  if (params.quantityUnit === 'pallet') {
    return {
      status: 'UNIT_MISMATCH',
      message:
        'Unit mismatch: "pallet" has no approved kg/tonne conversion factor (T-AG-08). Declare tonnes or kg explicitly.',
    }
  }

  const normalizedTonnesThousandths =
    params.quantityUnit === 'tonne' ? params.quantity * 1000n : params.quantity
  const revenueFils = divideRoundHalfEven(
    normalizedTonnesThousandths * params.pricePerTonneFils,
    1000n
  )
  return {
    status: 'CALCULATED',
    normalizedTonnesThousandths,
    revenueFils,
  }
}
