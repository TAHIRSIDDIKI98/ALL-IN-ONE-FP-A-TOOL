import { useState } from 'react'
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChartColumnIncreasing, ChevronRight, CircleHelp, FileSpreadsheet, Info, Landmark, MousePointer2, ReceiptText, TriangleAlert, TrendingUp, Wallet } from 'lucide-react'
import { businesses, getFigures, periods, scenarioNames, scopeNames, signedNumber, variancePercent, type Measure } from '../lib/data'
import { useWorkspace } from '../lib/workspace'
import { Badge, BusinessLabel, Button, Card, CardHeader, DataTable, Note, PageHeader, Segmented, SourceDetail } from '../components/ui'
import { TrendChart } from '../components/TrendChart'
import { BusinessDrivers, BusinessProfile, MiniTrend, NextStep, VarianceReview } from '../components/review'

export function Overview() {
  const { scope, period, scenario, fmt, preferences, openDialog, navigate, setStatementTab, setConsolidationStep, workspaceName } = useWorkspace()
  const [tableMetric, setTableMetric] = useState<'revenue' | 'expenses' | 'result'>('revenue')
  const actual = getFigures(scope, period, scenario)
  const compareScenario = scenario === 'budget' ? 'actual' : 'budget'
  const compare = getFigures(scope, period, compareScenario)
  const metrics: { key: Measure; label: string; icon: typeof TrendingUp }[] = [
    { key: 'revenue', label: 'Revenue', icon: TrendingUp }, { key: 'expenses', label: 'Operating expenses', icon: ReceiptText },
    { key: 'result', label: 'Operating result', icon: ChartColumnIncreasing }, { key: 'cash', label: 'Cash balance', icon: Wallet },
  ]
  const showMeasure = (key: Measure, label: string) => {
    if (key === 'cash') { setStatementTab('cash'); navigate('statements'); return }
    openDialog({ title: `${label} · source detail`, drawer: true, content: <SourceDetail metric={key} title={label} /> })
  }
  const viewInfo = () => openDialog({ title: 'An unadjusted management view', content: <><Badge tone="blue">Not consolidated</Badge><p className="dialog-copy">These fictional inputs are presented together for management review. The total is a simple sum, not a consolidated financial statement.</p><Note>No intercompany eliminations, adjustments, FX conversions, ownership assumptions, or accounting policies have been applied.</Note><p className="dialog-copy muted">Budget, forecast, and historical comparisons are additional fictional fixtures. Cash and other unsupplied measures are shown as Not provided.</p></> })
  return <div className="overview-page">
    <PageHeader title={scope === 'group' ? 'Group overview' : 'Business overview'} description={<>{scope === 'group' ? workspaceName : scopeNames[scope]}<span className="inline-dot">·</span>{periods[period].full}<span className="inline-dot">·</span>AED thousands</>} actions={<><button className="view-label" onClick={viewInfo}><span className="tiny-dot" />Unadjusted management view<Info size={13} /></button><Button variant="primary" onClick={() => { setStatementTab('income'); navigate('statements') }}>View statements<ArrowUpRight size={15} /></Button></>} />
    <div className="kpi-grid">{metrics.map(({ key, label, icon: Icon }) => {
      const value = actual[key], reference = compare[key]
      const positive = value !== null && reference !== null && (key === 'expenses' ? value <= reference : value >= reference)
      return <button key={key} className={`kpi-card ${key === 'cash' ? 'kpi-missing' : ''}`} onClick={() => showMeasure(key, label)} aria-label={`${label}: ${fmt(value)} AED thousands. View ${key === 'cash' ? 'missing inputs' : 'source details'}`}>
        <div className="kpi-top"><span>{label}</span><Icon size={17} strokeWidth={1.65} /></div>
        <div className="kpi-value-row"><strong className={`kpi-value ${value === null ? 'missing-value' : ''}`}>{fmt(value)}</strong>{value !== null && <span className="kpi-unit">AED k</span>}{key !== 'cash' && <MiniTrend metric={key} scope={scope} period={period} scenario={scenario} favorable={positive} />}</div>
        {value !== null && reference !== null ? <div className="kpi-comparison"><span className={`comparison-change ${positive ? 'positive' : 'adverse'}`}>{value >= reference ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{variancePercent(value, reference)}</span><span>vs. {scenarioNames[compareScenario].toLowerCase()} <b>{fmt(reference)}</b></span></div> : <div className="kpi-comparison missing-comparison"><CircleHelp size={12} /><span>Actual & plan inputs not provided</span></div>}
      </button>
    })}</div>
    <div className="overview-middle"><TrendChart /><Card className="attention-card"><CardHeader title={<span className="flex items-center gap-2"><TriangleAlert size={16} className="amber-text" />Attention required</span>} actions={<span className="attention-count">3</span>} /><div className="attention-list">
      <button className="attention-item" onClick={() => { setStatementTab('cash'); navigate('statements') }}><span className="attention-icon"><Wallet size={16} /></span><span><strong>Cash inputs not provided</strong><small>{scope === 'group' ? '3 businesses' : scopeNames[scope]} · {periods[period].label}</small></span><ChevronRight size={15} /></button>
      <button className="attention-item" onClick={() => { setConsolidationStep(2); navigate('consolidation') }}><span className="attention-icon"><Landmark size={16} /></span><span><strong>1 reference FX rate missing</strong><small>Consolidation preview is incomplete</small></span><ChevronRight size={15} /></button>
      <button className="attention-item" onClick={() => navigate('excel')}><span className="attention-icon neutral-icon"><FileSpreadsheet size={16} /></span><span><strong>Excel is not connected</strong><small>Native add-in not built in prototype</small></span><ChevronRight size={15} /></button>
    </div><button className="card-footer-link" onClick={() => { setConsolidationStep(1); navigate('consolidation') }}>View readiness checks<ArrowRight size={14} /></button></Card></div>
    <Card className="business-card"><CardHeader title="Business performance" subtitle={`${scenarioNames[scenario]} vs. ${scenarioNames[compareScenario].toLowerCase()} · AED thousands`} actions={<><span className="table-review-hint"><MousePointer2 size={12} />Inspect a variance</span><Segmented value={tableMetric} onChange={setTableMetric} label="Business comparison measure" small options={[{ value: 'revenue', label: 'Revenue' }, { value: 'expenses', label: 'Expenses' }, { value: 'result', label: 'Operating result' }]} /></>} />
      <DataTable label={`Business ${tableMetric} variance in AED thousands`}><thead><tr><th>Business</th><th className="numeric">{scenarioNames[scenario]} {tableMetric === 'revenue' ? 'revenue' : tableMetric === 'expenses' ? 'expenses' : 'result'}</th><th className="numeric">{scenarioNames[compareScenario]}</th><th className="numeric">Variance</th><th className="numeric">{tableMetric === 'revenue' ? 'Operating expenses' : 'Revenue'}</th><th className="numeric">{tableMetric === 'result' ? 'Operating expenses' : 'Operating result'}</th><th className="table-end"><span className="sr-only">Details</span></th></tr></thead><tbody>{businesses.filter(b => scope === 'group' || scope === b.id).map(business => {
        const row = getFigures(business.id, period, scenario), plan = getFigures(business.id, period, compareScenario)
        const difference = row[tableMetric] - plan[tableMetric]
        const favorable = tableMetric === 'expenses' ? difference < 0 : difference > 0
        const showBusiness = () => openDialog({ title: business.name, eyebrow: `${business.code} · FICTIONAL ENTITY`, drawer: true, content: <BusinessProfile id={business.id} /> })
        const inspectVariance = () => openDialog({ title: `${tableMetric === 'revenue' ? 'Revenue' : tableMetric === 'expenses' ? 'Operating expenses' : 'Operating result'} variance`, drawer: true, content: <VarianceReview metric={tableMetric} selectedScope={business.id} /> })
        return <tr key={business.id}><td><button className="business-button" onClick={showBusiness}><BusinessLabel id={business.id} /></button></td><td className="numeric strong-number">{fmt(row[tableMetric])}</td><td className="numeric muted">{fmt(plan[tableMetric])}</td><td className={`numeric ${difference === 0 ? 'muted' : favorable ? 'positive' : 'adverse'}`}><button className="variance-button" onClick={inspectVariance} aria-label={`Inspect ${business.name} ${tableMetric} variance: ${signedNumber(difference, preferences.grouping)} AED thousands`}>{signedNumber(difference, preferences.grouping)}<small>{variancePercent(row[tableMetric], plan[tableMetric])}</small></button></td><td className="numeric">{fmt(tableMetric === 'revenue' ? row.expenses : row.revenue)}</td><td className="numeric strong-number">{fmt(tableMetric === 'result' ? row.expenses : row.result)}</td><td className="table-end"><button className="row-detail" onClick={showBusiness} aria-label={`View ${business.name} details`}><ChevronRight size={15} /></button></td></tr>
      })}</tbody><tfoot><tr><th><span className="flex items-center gap-2">{scope === 'group' ? 'Unadjusted management total' : 'Business total'}<button className="inline-info" onClick={viewInfo} aria-label="About management totals"><Info size={13} /></button></span></th><td className="numeric">{fmt(actual[tableMetric])}</td><td className="numeric">{fmt(compare[tableMetric])}</td><td className="numeric"><button className="variance-button" aria-label={`Inspect total ${tableMetric} variance`} onClick={() => openDialog({ title: 'Management variance review', drawer: true, content: <VarianceReview metric={tableMetric} /> })}>{signedNumber(actual[tableMetric] - compare[tableMetric], preferences.grouping)}<ArrowUpRight size={12} /></button></td><td className="numeric">{fmt(tableMetric === 'revenue' ? actual.expenses : actual.revenue)}</td><td className="numeric">{fmt(tableMetric === 'result' ? actual.expenses : actual.result)}</td><td /></tr></tfoot></DataTable>
    </Card>
    <div className="overview-footnote"><span><Info size={12} />Management totals are unadjusted. No consolidation has been performed.</span><span>DEMO-03<span className="inline-dot">·</span>{scenarioNames[scenario]}</span></div>
    <div className="overview-below-fold"><BusinessDrivers /><NextStep title="Turn a variance into a review" description="Compare the operating measures, inspect their sources, then explore a local scenario." label="Review financial statements" onClick={() => { setStatementTab('income'); navigate('statements') }} /></div>
  </div>
}
