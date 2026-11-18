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
