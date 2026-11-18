import { useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, ChevronRight, FileBarChart2, Layers3, Lightbulb, SlidersHorizontal } from 'lucide-react'
import { businesses, getFigures, getTrend, periods, scenarioNames, scopeNames, signedNumber, variancePercent, type Measure, type PageId, type Period, type Scenario, type Scope } from '../lib/data'
import { businessProfiles, type BusinessId } from '../lib/reviewData'
import { useWorkspace } from '../lib/workspace'
import { Badge, BusinessLabel, Button, Card, CardHeader, DefinitionList, DialogActions, Note, SourceDetail } from './ui'
import { Tabs } from './Tabs'

export function NextStep({ title, description, label, onClick, secondary }: { title: string; description: string; label: string; onClick: () => void; secondary?: ReactNode }) {
  return <nav className="next-step" aria-label={`Continue review: ${title}`}><span className="next-step-icon"><ArrowRight size={18} /></span><div><span className="eyebrow">NEXT IN YOUR REVIEW</span><h3>{title}</h3><p>{description}</p></div><div className="next-step-actions">{secondary}<Button onClick={onClick}>{label}<ArrowUpRight size={14} /></Button></div></nav>
}

export function MiniTrend({ metric, scope, period, scenario, favorable = true }: { metric: Exclude<Measure, 'cash'>; scope: Scope; period: Period; scenario: Scenario; favorable?: boolean }) {
  const revenues = getTrend(scope, period, scenario, 'revenue')
  const expenses = getTrend(scope, period, scenario, 'expenses')
  const values = metric === 'result' ? revenues.map((point, i) => point.value - expenses[i].value) : (metric === 'revenue' ? revenues : expenses).map(point => point.value)
  const min = Math.min(...values), max = Math.max(...values)
  const points = values.map((value, i) => `${3 + i * 69 / (values.length - 1)},${25 - (value - min) * 18 / (max - min || 1)}`).join(' ')
  return <svg className={`mini-trend ${favorable ? '' : 'mini-trend-adverse'}`} width="78" height="31" viewBox="0 0 78 31" aria-hidden="true"><path d="M2 28H76" stroke="currentColor" opacity=".12" /><polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><circle cx="72" cy={25 - (values[values.length - 1] - min) * 18 / (max - min || 1)} r="2.5" fill="currentColor" /></svg>
}

export function VarianceReview({ metric = 'revenue', selectedScope }: { metric?: Exclude<Measure, 'cash'>; selectedScope?: Scope }) {
  const { scope: workspaceScope, period, scenario, preferences, fmt, navigate, setScope, setStatementTab, closeDialog, openDialog } = useWorkspace()
  const [drillScope, setDrillScope] = useState<Scope | null>(null)
  const [tab, setTab] = useState<'explanation' | 'source'>('explanation')
  const scope = drillScope ?? selectedScope ?? workspaceScope
  const comparison = scenario === 'budget' ? 'actual' : 'budget'
  const figures = getFigures(scope, period, scenario), plan = getFigures(scope, period, comparison)
  const delta = figures[metric] - plan[metric]
  const label = metric === 'revenue' ? 'Revenue' : metric === 'expenses' ? 'Operating expenses' : 'Operating result'
  const favorable = metric === 'expenses' ? delta < 0 : delta > 0
  const rows = businesses.filter(b => scope === 'group' || b.id === scope).map(b => ({ ...b, delta: getFigures(b.id, period, scenario)[metric] - getFigures(b.id, period, comparison)[metric] }))
  const max = Math.max(1, ...rows.map(row => Math.abs(row.delta)))
  const go = (page: PageId) => { setScope(scope); setStatementTab('income'); closeDialog(); navigate(page) }
  return <div className="variance-review">
    <div className="review-context"><Badge tone="blue">Synthetic comparison</Badge><span>{periods[period].label} · AED thousands</span></div>
    {drillScope && <button className="back-link" onClick={() => { setDrillScope(null); setTab('explanation') }}><ArrowLeft size={13} />Back to all contributions</button>}
    <h3 className="review-scope">{scopeNames[scope]}</h3>
    <div className="variance-scorecard"><div><span>{scenarioNames[scenario]}</span><strong>{fmt(figures[metric])}</strong></div><div><span>{scenarioNames[comparison]}</span><strong>{fmt(plan[metric])}</strong></div><div className={delta === 0 ? 'variance-flat' : favorable ? 'variance-favorable' : 'variance-adverse'}><span>{label} variance</span><strong>{signedNumber(delta, preferences.grouping)}</strong><small>{delta === 0 ? 'On plan' : favorable ? 'Favorable' : 'Unfavorable'} · {variancePercent(figures[metric], plan[metric])}</small></div></div>
    <Tabs value={tab} onChange={setTab} label="Variance detail" compact items={[{ value: 'explanation', label: 'Business contributions' }, { value: 'source', label: 'Source & lineage' }]}>
      {tab === 'explanation' ? <div className="variance-tab-content"><p className="review-description">{scope === 'group' ? 'See how each business contributes to the unadjusted difference. Select a business to review its context.' : 'Compare the fictional business inputs and explore the operating questions behind a review.'}</p><div className="contribution-list">{rows.map(row => <button key={row.id} className={`contribution-row ${row.delta === 0 ? 'is-neutral' : (metric === 'expenses' ? row.delta < 0 : row.delta > 0) ? 'is-favorable' : 'is-adverse'}`} aria-label={scope === 'group' ? `Inspect ${row.name} ${label.toLowerCase()} variance` : `View ${row.name} sector profile`} onClick={() => { if (scope === 'group') setDrillScope(row.id); else openDialog({ title: row.name, eyebrow: 'FICTIONAL SECTOR PROFILE', drawer: true, content: <BusinessProfile id={row.id} /> }) }}><span><BusinessLabel id={row.id} /><span className="contribution-track"><i style={{ width: `${Math.abs(row.delta) / max * 100}%` }} /></span></span><strong>{signedNumber(row.delta, preferences.grouping)}<small>{row.delta === 0 ? 'On plan' : `${metric === 'expenses' ? row.delta < 0 ? 'Below' : 'Above' : row.delta > 0 ? 'Above' : 'Below'} ${scenarioNames[comparison].toLowerCase()}`}</small></strong><ChevronRight size={15} /></button>)}</div>
      {scope !== 'group' ? <div className="sector-context"><span className="eyebrow">FICTIONAL SECTOR CONTEXT</span><h4>{businessProfiles[scope].sector}</h4><p>{businessProfiles[scope].example}</p><div className="driver-chips">{businessProfiles[scope].drivers.map(driver => <span key={driver.name}>{driver.name}</span>)}</div></div> : <div className="review-insight"><Lightbulb size={17} /><p>The contributions sum to <strong>{signedNumber(delta, preferences.grouping)} AED thousands</strong>. They explain the arithmetic difference, not the underlying commercial causes.</p></div>}
      <Note>Operating drivers are fictional review prompts, not verified explanations or a calculated price/volume bridge. No source or financial record is changed.</Note></div> : <div className="variance-tab-content"><SourceDetail metric={metric} title={label} scopeOverride={scope} showActions={false} /></div>}
    </Tabs>
    <DialogActions><Button variant="primary" onClick={() => go('statements')}><FileBarChart2 size={14} />Compare in statements</Button><Button onClick={() => go('planning')}><SlidersHorizontal size={14} />Explore scenarios</Button></DialogActions>
  </div>
}

export function BusinessDrivers() {
  const { scope, openDialog } = useWorkspace()
  const visible = businesses.filter(business => scope === 'group' || scope === business.id)
  return <Card className="business-drivers"><CardHeader title="The businesses behind the numbers" subtitle="Fictional operating context · Review prompts, not model inputs" actions={<Badge><BookOpen size={12} />Sector guide</Badge>} /><div className={`business-driver-grid ${visible.length === 1 ? 'single-business' : ''}`}>{visible.map(business => <button className="business-driver-card" key={business.id} onClick={() => openDialog({ title: business.name, eyebrow: `${business.code} · FICTIONAL BUSINESS PROFILE`, drawer: true, content: <BusinessProfile id={business.id} /> })}><div className="driver-card-top"><BusinessLabel id={business.id} /><ArrowUpRight size={15} /></div><span className="driver-sector">{businessProfiles[business.id].sector}</span><p>{businessProfiles[business.id].description}</p><span className="driver-card-bottom">{businessProfiles[business.id].drivers.length} sector drivers<span>Explore business<ArrowRight size={13} /></span></span></button>)}</div></Card>
}

export function BusinessProfile({ id }: { id: BusinessId }) {
  const { period, scenario, fmt, navigate, setScope, setStatementTab, closeDialog } = useWorkspace()
  const profile = businessProfiles[id], figures = getFigures(id, period, scenario)
  return <div className="business-profile"><Badge tone="blue">{profile.sector} · Fictional</Badge><p className="dialog-copy">{profile.description}</p><DefinitionList items={[{ label: 'Period & scenario', value: `${periods[period].full} · ${scenarioNames[scenario]}` }, { label: 'Revenue', value: `${fmt(figures.revenue)} AED thousands` }, { label: 'Operating expenses', value: `${fmt(figures.expenses)} AED thousands` }, { label: 'Operating result', value: `${fmt(figures.result)} AED thousands` }, { label: 'Cash', value: 'Not provided' }]} /><h3 className="section-label">Questions for an operating review</h3><div className="profile-driver-list">{profile.drivers.map((driver, i) => <div key={driver.name}><span>{String(i + 1).padStart(2, '0')}</span><div><h4>{driver.name}</h4><p>{driver.context}</p><strong>{driver.question}</strong></div></div>)}</div><Note>Operational quantities and rates are not provided. These fictional prompts do not calculate or establish the cause of a financial variance.</Note><DialogActions><Button variant="primary" onClick={() => { setScope(id); setStatementTab('income'); closeDialog(); navigate('statements') }}>Review this business<ArrowRight size={14} /></Button><Button onClick={() => { setScope(id); closeDialog(); navigate('planning') }}>Explore scenarios</Button></DialogActions></div>
}

export function StatementComparisonGuide() {
  const { scope, period, fmt, navigate, setConsolidationStep } = useWorkspace()
  const actual = getFigures(scope, period, 'actual'), budget = getFigures(scope, period, 'budget')
  return <div className="comparison-guide"><span className="summary-icon"><Layers3 size={18} /></span><div><h3>Keep the reporting boundary clear</h3><p>Actual revenue {fmt(actual.revenue)} vs. budget {fmt(budget.revenue)} AED thousands. This comparison is not a consolidated statement.</p></div><Button onClick={() => { setConsolidationStep(1); navigate('consolidation') }}>Review group readiness<ArrowRight size={14} /></Button></div>
}
