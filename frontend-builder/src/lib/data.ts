export const APP_NAME = 'Atlas FP&A'
export const DEFAULT_WORKSPACE = 'Aster Vale Group'
export const REVISION = 'DEMO-03'

export type PageId = 'overview' | 'statements' | 'planning' | 'consolidation' | 'imports' | 'excel' | 'activity' | 'settings'
export type Scope = 'group' | 'packaging' | 'metals' | 'property'
export type Scenario = 'actual' | 'budget' | 'forecast'
export type Period = 'nov' | 'dec' | 'jan'
export type StatementTab = 'income' | 'balance' | 'cash'
export type Preset = -5 | 0 | 5
export type Measure = 'revenue' | 'expenses' | 'result' | 'cash'
export type Figures = { revenue: number; expenses: number; result: number; cash: null }

export const pageNames: Record<PageId, string> = {
  overview: 'Overview', statements: 'Financial statements', planning: 'Planning & scenarios',
  consolidation: 'Group consolidation', imports: 'Data imports', excel: 'Excel integration',
  activity: 'Audit & activity', settings: 'Settings',
}
export const businesses: { id: Exclude<Scope, 'group'>; name: string; code: string; short: string; color: string }[] = [
  { id: 'packaging', name: 'Synthetic Packaging', code: 'ENT-01', short: 'SP', color: 'teal' },
  { id: 'metals', name: 'Synthetic Metals', code: 'ENT-02', short: 'SM', color: 'blue' },
  { id: 'property', name: 'Synthetic Property', code: 'ENT-03', short: 'SY', color: 'purple' },
]
export const scopeNames: Record<Scope, string> = { group: 'All businesses', packaging: 'Synthetic Packaging', metals: 'Synthetic Metals', property: 'Synthetic Property' }
export const periods: Record<Period, { label: string; full: string; index: number }> = {
  nov: { label: 'Nov 2025', full: 'November 2025', index: 3 },
  dec: { label: 'Dec 2025', full: 'December 2025', index: 4 },
  jan: { label: 'Jan 2026', full: 'January 2026', index: 5 },
}
export const scenarioNames: Record<Scenario, string> = { actual: 'Actual', budget: 'Budget', forecast: 'Forecast' }
export const monthNames = ['Aug 25', 'Sep 25', 'Oct 25', 'Nov 25', 'Dec 25', 'Jan 26']

// Entirely fictional, bundled fixtures. Integers are in AED thousands.
// These are unadjusted management inputs, not linked accounting statements.
type Series = { revenue: number[]; expenses: number[] }
export const history: Record<Exclude<Scope, 'group'>, Record<Scenario, Series>> = {
  packaging: {
    actual: { revenue: [780, 850, 810, 930, 960, 1000], expenses: [620, 660, 650, 710, 730, 750] },
    budget: { revenue: [800, 820, 850, 890, 920, 950], expenses: [610, 630, 650, 680, 700, 720] },
    forecast: { revenue: [800, 860, 880, 940, 980, 1000], expenses: [630, 670, 680, 710, 740, 750] },
  },
  metals: {
    actual: { revenue: [1300, 1420, 1350, 1480, 1530, 1600], expenses: [1090, 1180, 1140, 1220, 1260, 1300] },
    budget: { revenue: [1330, 1380, 1400, 1450, 1500, 1550], expenses: [1100, 1130, 1160, 1200, 1240, 1280] },
    forecast: { revenue: [1340, 1440, 1450, 1510, 1570, 1640], expenses: [1120, 1190, 1180, 1240, 1280, 1300] },
  },
  property: {
    actual: { revenue: [390, 420, 430, 450, 480, 500], expenses: [170, 180, 180, 190, 190, 200] },
    budget: { revenue: [400, 420, 440, 460, 480, 500], expenses: [170, 180, 180, 190, 190, 200] },
    forecast: { revenue: [400, 440, 450, 480, 500, 500], expenses: [180, 180, 190, 190, 200, 200] },
  },
}

// Simple integer summaries for presentation only. No adjustments, eliminations,
// conversions, ownership percentages, or accounting policies are inferred.
export function getFigures(scope: Scope, period: Period, scenario: Scenario): Figures {
  const entries = scope === 'group' ? businesses.map(b => b.id) : [scope]
  const index = periods[period].index
  const revenue = entries.reduce((sum, id) => sum + history[id][scenario].revenue[index], 0)
  const expenses = entries.reduce((sum, id) => sum + history[id][scenario].expenses[index], 0)
  return { revenue, expenses, result: revenue - expenses, cash: null }
}
export function getTrend(scope: Scope, period: Period, scenario: Scenario, metric: 'revenue' | 'expenses') {
  const entries = scope === 'group' ? businesses.map(b => b.id) : [scope]
  return monthNames.slice(0, periods[period].index + 1).map((month, i) => ({
    month, value: entries.reduce((sum, id) => sum + history[id][scenario][metric][i], 0),
    comparison: entries.reduce((sum, id) => sum + history[id][scenario === 'budget' ? 'actual' : 'budget'][metric][i], 0),
  }))
}
export function formatNumber(value: number | null | undefined, grouping = true): string {
  if (value === null || value === undefined) return 'Not provided'
  return new Intl.NumberFormat('en-GB', { useGrouping: grouping, maximumFractionDigits: 0 }).format(value)
}
export function signedNumber(value: number, grouping = true) { return `${value > 0 ? '+' : ''}${formatNumber(value, grouping)}` }
export function variancePercent(value: number, reference: number) {
  if (!reference) return value === 0 ? '0.0%' : 'No comparison'
  return `${value > reference ? '+' : ''}${(((value - reference) * 100) / reference).toFixed(1)}%`
}

export type PlanningMonth = 'jan' | 'feb' | 'mar'
export const planningMonths: Record<PlanningMonth, string> = { jan: 'January 2026', feb: 'February 2026', mar: 'March 2026' }
// Fixed illustrative outputs for three predefined sensitivity previews.
// Users cannot enter arbitrary assumptions and trigger a financial model.
export const planningFixtures: Record<Exclude<Scope, 'group'>, Record<PlanningMonth, { budget: [number, number]; forecast: Record<Preset, [number, number]> }>> = {
  packaging: {
    jan: { budget: [950, 720], forecast: { '-5': [950, 750], 0: [1000, 750], 5: [1050, 750] } },
    feb: { budget: [1000, 750], forecast: { '-5': [1007, 770], 0: [1060, 770], 5: [1113, 770] } },
    mar: { budget: [1060, 770], forecast: { '-5': [1045, 800], 0: [1100, 800], 5: [1155, 800] } },
  },
  metals: {
    jan: { budget: [1550, 1280], forecast: { '-5': [1558, 1300], 0: [1640, 1300], 5: [1722, 1300] } },
    feb: { budget: [1600, 1300], forecast: { '-5': [1539, 1320], 0: [1620, 1320], 5: [1701, 1320] } },
    mar: { budget: [1620, 1320], forecast: { '-5': [1596, 1350], 0: [1680, 1350], 5: [1764, 1350] } },
  },
  property: {
    jan: { budget: [500, 200], forecast: { '-5': [475, 200], 0: [500, 200], 5: [525, 200] } },
    feb: { budget: [500, 200], forecast: { '-5': [494, 210], 0: [520, 210], 5: [546, 210] } },
    mar: { budget: [520, 210], forecast: { '-5': [513, 220], 0: [540, 220], 5: [567, 220] } },
  },
}
export function getPlan(scope: Scope, month: PlanningMonth, preset: Preset) {
  const entries = scope === 'group' ? businesses.map(b => b.id) : [scope]
  const budgetRevenue = entries.reduce((s, id) => s + planningFixtures[id][month].budget[0], 0)
  const budgetExpenses = entries.reduce((s, id) => s + planningFixtures[id][month].budget[1], 0)
  const revenue = entries.reduce((s, id) => s + planningFixtures[id][month].forecast[preset][0], 0)
  const expenses = entries.reduce((s, id) => s + planningFixtures[id][month].forecast[preset][1], 0)
  return { budget: { revenue: budgetRevenue, expenses: budgetExpenses, result: budgetRevenue - budgetExpenses, cash: null } as Figures,
    forecast: { revenue, expenses, result: revenue - expenses, cash: null } as Figures }
}
export const activityEntries = [
  { id: 'MOCK-006', time: '31 Jan 2026, 17:15', actor: 'Jamie Demo', initials: 'JD', action: 'Viewed management overview', category: 'Review', scope: 'All businesses', revision: 'DEMO-03', result: 'Preview only', detail: 'Illustrates opening the unadjusted management overview. This is a bundled fictional entry, not a record of your activity.' },
  { id: 'MOCK-005', time: '31 Jan 2026, 16:42', actor: 'Jamie Demo', initials: 'JD', action: 'Previewed an upside scenario', category: 'Preview', scope: 'All businesses', revision: 'DEMO-03', result: 'Preview only', detail: 'Illustrates a +5% revenue sensitivity using fixed demo outputs. No budget, forecast, or financial record was saved.' },
  { id: 'MOCK-004', time: '31 Jan 2026, 15:30', actor: 'Casey Sample', initials: 'CS', action: 'Reviewed intercompany difference', category: 'Issue', scope: 'Packaging / Metals', revision: 'DEMO-02', result: 'Issue shown', detail: 'The example shows a receivable of 120 and a payable of 110 in AED thousands. No elimination was calculated or posted.' },
  { id: 'MOCK-003', time: '31 Jan 2026, 14:10', actor: 'Jamie Demo', initials: 'JD', action: 'Opened an Excel write preview', category: 'Preview', scope: 'Synthetic Packaging', revision: 'DEMO-02', result: 'No data written', detail: 'Illustrates reviewing a proposed write-back. There is no native add-in, connected workbook, or external write operation.' },
  { id: 'MOCK-002', time: '30 Jan 2026, 11:25', actor: 'Casey Sample', initials: 'CS', action: 'Inspected a missing reference rate', category: 'Issue', scope: 'Reference FX template', revision: 'DEMO-01', result: 'Issue shown', detail: 'A separate illustrative USD to AED reference template is missing a rate. All management values remain unconverted AED inputs.' },
  { id: 'MOCK-001', time: '30 Jan 2026, 09:00', actor: 'Jamie Demo', initials: 'JD', action: 'Reviewed the synthetic CSV example', category: 'Review', scope: 'All businesses', revision: 'DEMO-01', result: 'Preview only', detail: 'Illustrates a mapping preview for the bundled synthetic CSV. No source file was processed or financial data committed.' },
]
