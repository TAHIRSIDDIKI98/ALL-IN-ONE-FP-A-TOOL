import type { PageId, Scope } from './data'

// Fictional operating context only. These are review prompts, not measured
// sector inputs, verified explanations, or drivers of a financial model.
export type BusinessId = Exclude<Scope, 'group'>
export const businessProfiles: Record<BusinessId, {
  sector: string; description: string; example: string;
  drivers: { name: string; context: string; question: string }[];
}> = {
  packaging: {
    sector: 'Packaging & manufacturing',
    description: 'A fictional producer of transit cartons and protective packaging for a mix of short-run and recurring orders.',
    example: 'Review a shift toward smaller, higher-frequency packaging orders. This narrative is illustrative, not a verified explanation of the revenue variance.',
    drivers: [
      { name: 'Order volume & mix', context: 'Recurring carton orders and short production runs.', question: 'Has the mix of recurring and short-run orders changed?' },
      { name: 'Board & resin costs', context: 'Illustrative material-price and purchasing assumptions.', question: 'Which material-cost assumptions would need supporting inputs?' },
      { name: 'Production yield', context: 'Setup time, material waste, and usable output.', question: 'Would higher setup frequency affect the operating plan?' },
    ],
  },
  metals: {
    sector: 'Metals & fabrication',
    description: 'A fictional fabricator producing made-to-order metal components in a small batch production environment.',
    example: 'Explore the timing of completed fabrication orders and the mix of standard and custom work. No order book or commodity feed is connected.',
    drivers: [
      { name: 'Shipment timing', context: 'The timing and mix of fictional customer deliveries.', question: 'Does the reporting period align with the delivery schedule?' },
      { name: 'Material & energy', context: 'Separate material-cost and energy-use assumptions.', question: 'What supporting inputs would distinguish price from usage?' },
      { name: 'Capacity utilisation', context: 'Machine hours, maintenance, and production scheduling.', question: 'Where would capacity constraints affect the next plan?' },
    ],
  },
  property: {
    sector: 'Property operations',
    description: 'A fictional property operation managing a small portfolio of lettable spaces and shared facilities.',
    example: 'Review occupancy, lease timing, and maintenance schedules. Occupancy and lease-level values are not provided; the financial comparison does not establish the cause of a variance.',
    drivers: [
      { name: 'Occupancy & space', context: 'Lettable area and occupied-space assumptions.', question: 'Which occupancy inputs would support a rental forecast?' },
      { name: 'Lease renewals', context: 'Fictional renewal timing and rental mix.', question: 'Are renewals concentrated in a particular planning month?' },
      { name: 'Maintenance timing', context: 'Planned facilities work and recurring service costs.', question: 'What maintenance timing should be reviewed before planning?' },
    ],
  },
}

export type ExtendedSectorId = 'foods' | 'development' | 'mobility' | 'infrastructure' | 'investments'

export type ExtendedSectorProfile = {
  id: ExtendedSectorId
  name: string
  code: string
  short: string
  color: 'amber' | 'indigo' | 'emerald' | 'slate' | 'rose'
  portfolioRef: string
  sector: string
  description: string
  unitNote: string
  boundaryNote: string
  drivers: { name: string; context: string; question: string }[]
}

// Illustrative sector templates for the remaining target verticals documented in
// fpa-documentation/docs/14-al-ghurair-group-pilot.md. Financial inputs are Not provided.
export const extendedSectorProfiles: ExtendedSectorProfile[] = [
  {
    id: 'foods',
    name: 'Synthetic Foods',
    code: 'TPL-04',
    short: 'SF',
    color: 'amber',
    portfolioRef: 'AG-B1 · Portfolio B',
    sector: 'Foods & ingredients',
    description: 'An illustrative template for food manufacturing and ingredient processing with plant utilization, input commodities, and inventory assumptions.',
    unitNote: 'Metric tonnes / kg (explicit conversion required) · AED thousands',
    boundaryNote: 'Template preview only. Sales volumes, commodity input costs, and inventory balances are Not provided and are excluded from management totals.',
    drivers: [
      { name: 'Production & sales volume', context: 'Monthly throughput by product line with declared kg-to-tonne conversion.', question: 'Are volume units consistent across production and sales inputs?' },
      { name: 'Raw commodity inputs', context: 'Grain, ingredient, and packaging cost assumptions per unit.', question: 'Which input price assumptions require updated supplier quotes?' },
      { name: 'Plant utilization & yield', context: 'Line capacity, processing loss, and finished-goods inventory.', question: 'How does capacity utilization affect unit conversion cost?' },
    ],
  },
  {
    id: 'development',
    name: 'Synthetic Development',
    code: 'TPL-05',
    short: 'SD',
    color: 'indigo',
    portfolioRef: 'AG-A9 / AG-B2',
    sector: 'Real estate development',
    description: 'An illustrative template for multi-period development projects tracking land/build budgets, milestone collections, and work-in-progress.',
    unitNote: 'Project milestones / sq ft · AED thousands',
    boundaryNote: 'Revenue recognition, WIP capitalization, and milestone timing require expert-approved accounting policy. No project cash flow is fabricated here.',
    drivers: [
      { name: 'Project phasing & WIP', context: 'Land acquisition, construction drawdowns, and cost-to-complete.', question: 'Are cost-to-complete updates reconciled with the latest engineering schedule?' },
      { name: 'Milestone sales & collections', context: 'Contracted milestone billing versus cash receipt timing.', question: 'Which collection milestones shift across quarters under sensitivity?' },
      { name: 'Recognition policy boundary', context: 'Point-in-time versus over-time revenue recognition rules.', question: 'Has finance confirmed the applicable recognition policy per project?' },
    ],
  },
  {
    id: 'mobility',
    name: 'Synthetic Mobility',
    code: 'TPL-06',
    short: 'MB',
    color: 'emerald',
    portfolioRef: 'AG-B3 · Portfolio B',
    sector: 'Mobility & fleet',
    description: 'An illustrative template for vehicle distribution, fleet operations, and after-sales service utilization.',
    unitNote: 'Vehicle units / active fleet days · AED thousands',
    boundaryNote: 'Template preview only. Fleet counts, residual values, and service margins are Not provided and require approved entity inputs.',
    drivers: [
      { name: 'Fleet & vehicle volume', context: 'Active fleet size, unit deliveries, and disposal cadence.', question: 'How do delivery schedules align with the monthly planning calendar?' },
      { name: 'Service bay utilization', context: 'Workshop hours, recurring maintenance contracts, and parts mix.', question: 'What portion of revenue comes from recurring service versus unit sales?' },
      { name: 'Acquisition & upkeep cost', context: 'Vehicle financing, depreciation assumptions, and fleet upkeep.', question: 'Are fleet maintenance reserves tracked separately from operating cost?' },
    ],
  },
  {
    id: 'infrastructure',
    name: 'Synthetic Infrastructure',
    code: 'TPL-07',
    short: 'SI',
    color: 'slate',
    portfolioRef: 'AG-B4 · Portfolio B',
    sector: 'Infrastructure & construction',
    description: 'An illustrative template for infrastructure contracting, order backlog, resource capacity, and materials scheduling.',
    unitNote: 'Project hours / tonnes / contract value · AED thousands',
    boundaryNote: 'Template preview only. Contract backlog, subcontractor accruals, and retention balances are Not provided.',
    drivers: [
      { name: 'Order backlog & award timing', context: 'Confirmed contract pipeline and mobilization start dates.', question: 'Which awarded projects enter active execution during Q1?' },
      { name: 'Resource & equipment capacity', context: 'Crew deployment, heavy plant utilization, and subcontractor mix.', question: 'Where do equipment bottlenecks limit monthly revenue burn?' },
      { name: 'Materials & cost escalation', context: 'Structural materials, freight, and variation-order tracking.', question: 'Are unapproved variation orders excluded from baseline revenue?' },
    ],
  },
  {
    id: 'investments',
    name: 'Synthetic Investments',
    code: 'TPL-08',
    short: 'IV',
    color: 'rose',
    portfolioRef: 'AG-A10 / AG-A11',
    sector: 'Strategic & portfolio investments',
    description: 'An illustrative holding-level register for minority stakes, public/private market assets, declared dividends, and liquidity assumptions.',
    unitNote: 'Ownership % (decimal) · Carrying value & dividends in AED thousands',
    boundaryNote: 'Critical boundary: Dividends and fair-value movements must remain separate below operating result and are never silently combined into operating revenue or EBITDA. Minority stakes do not imply consolidation.',
    drivers: [
      { name: 'Ownership & control perimeter', context: 'Manual holding % and classification (associate, FVOCI, FVTPL).', question: 'Has group finance verified whether each holding is excluded from consolidation?' },
      { name: 'Dividends & distributions', context: 'Expected cash dividends tracked outside operating revenue/EBITDA.', question: 'Are declared dividends separated from operating business-unit KPIs?' },
      { name: 'Carrying value & liquidity', context: 'Opening/closing carrying value, capital calls, and disposal cash.', question: 'Which valuation sources are approved for period-end reporting?' },
    ],
  },
]

export const importMappingFixture = [
  { column: 'business', sample: 'Synthetic Packaging', target: 'Business' },
  { column: 'period', sample: '2026-01', target: 'Reporting period' },
  { column: 'currency', sample: 'AED', target: 'Currency' },
  { column: 'revenue_thousands', sample: '1,000', target: 'Revenue' },
  { column: 'operating_expenses_thousands', sample: '750', target: 'Operating expenses' },
  { column: 'operating_result_thousands', sample: '250', target: 'Operating result' },
  { column: 'cash_thousands', sample: 'Blank', target: 'Cash balance' },
]
export type ImportDraft = {
  step: number; type: 'csv' | 'excel'; filename: string; customFile: boolean;
  mapping: string[]; previousMapping: string[] | null; validated: boolean;
}
export function initialImportDraft(): ImportDraft {
  return { step: 0, type: 'csv', filename: '', customFile: false,
    mapping: importMappingFixture.map(field => field.target), previousMapping: null, validated: false }
}
export type DemoIssueId = 'fx' | 'intercompany'
export const activityDestinations: Record<string, { page: PageId; label: string; scope: Scope; step?: number }> = {
  'MOCK-006': { page: 'overview', label: 'Open management overview', scope: 'group' },
  'MOCK-005': { page: 'planning', label: 'Explore planning scenarios', scope: 'group' },
  'MOCK-004': { page: 'consolidation', label: 'Inspect intercompany example', scope: 'group', step: 3 },
  'MOCK-003': { page: 'excel', label: 'Open Excel preview', scope: 'packaging' },
  'MOCK-002': { page: 'consolidation', label: 'Inspect missing FX reference', scope: 'group', step: 2 },
  'MOCK-001': { page: 'imports', label: 'Open synthetic import preview', scope: 'group' },
}
