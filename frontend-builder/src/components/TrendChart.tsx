import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, ChartNoAxesCombined, Table2 } from 'lucide-react'
import { getTrend, scenarioNames, signedNumber } from '../lib/data'
import { useWorkspace } from '../lib/workspace'
import { Card, CardHeader, DataTable, Segmented } from './ui'
import { VarianceReview } from './review'

export function TrendChart() {
  const { scope, period, scenario, fmt, openDialog, preferences } = useWorkspace()
  const [metric, setMetric] = useState<'revenue' | 'expenses'>('revenue')
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [focused, setFocused] = useState<number | null>(null)
  const [width, setWidth] = useState(724)
  const chartRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const target = chartRef.current
    if (!target) return
    const observer = new ResizeObserver(entries => setWidth(Math.max(280, Math.round(entries[0].contentRect.width))))
    observer.observe(target)
    return () => observer.disconnect()
  }, [view])
  const data = getTrend(scope, period, scenario, metric)
  const comparisonName = scenario === 'budget' ? 'Actual' : 'Budget'
  const highest = Math.max(...data.flatMap(d => [d.value, d.comparison]))
  const increment = highest > 2000 ? 1000 : highest > 800 ? 500 : 200
  const maximum = Math.ceil(highest / increment) * increment
  const left = 43, right = width - 28, top = 15, bottom = 145
  const x = (i: number) => left + (i / (data.length - 1)) * (right - left)
  const y = (value: number) => bottom - (value / maximum) * (bottom - top)
  const line = (key: 'value' | 'comparison') => data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(d[key])}`).join(' ')
  const current = focused === null ? null : data[focused]
  const last = data[data.length - 1]
  return <Card className="trend-card"><CardHeader title="Performance over time" subtitle={`${metric === 'revenue' ? 'Revenue' : 'Operating expenses'} · ${signedNumber(last.value - last.comparison, preferences.grouping)} vs. ${comparisonName.toLowerCase()} · AED thousands`} actions={<Segmented value={metric} onChange={setMetric} label="Trend measure" small options={[{ value: 'revenue', label: 'Revenue' }, { value: 'expenses', label: 'Expenses' }]} />} />
    {view === 'chart' ? <div className="chart-wrap" ref={chartRef}><svg className="trend-chart" viewBox={`0 0 ${width} 176`} role="img" aria-label={`Fictional ${metric} trend. ${data.map(d => `${d.month}: ${scenarioNames[scenario]} ${fmt(d.value)}, ${comparisonName} ${fmt(d.comparison)}`).join('; ')}. All figures in AED thousands.`}>
      <rect x={right - 25} y={top - 8} width={50} height={bottom - top + 9} rx={5} fill="#f1f6f3" />
      {Array.from({ length: maximum / increment + 1 }, (_, i) => i * increment).map(value => <g key={value}><line x1={left} y1={y(value)} x2={right + 12} y2={y(value)} stroke="#e9ecee" strokeDasharray={value ? '3 4' : undefined} /><text x={left - 13} y={y(value) + 4} textAnchor="end" className="chart-axis">{fmt(value)}</text></g>)}
      <path d={`${line('value')} L ${right} ${bottom} L ${left} ${bottom} Z`} fill="#edf6f1" opacity="0.8" />
      <path d={line('comparison')} fill="none" stroke="#9da9b8" strokeWidth="2" strokeDasharray="5 5" strokeLinecap="round" strokeLinejoin="round" />
      <path d={line('value')} fill="none" stroke="#18816c" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" />
      <text x={right - 2} y={y(data[data.length - 1].value) < 30 ? y(data[data.length - 1].value) + 18 : y(data[data.length - 1].value) - 12} textAnchor="end" className="chart-end-value">{fmt(data[data.length - 1].value)}</text>
      {data.map((d, i) => <g key={d.month}><text x={x(i)} y={169} textAnchor="middle" className={`chart-axis ${i === data.length - 1 ? 'chart-axis-current' : ''}`}>{d.month}</text><circle cx={x(i)} cy={y(d.value)} r={i === data.length - 1 ? 5 : 3.5} fill="#18816c" stroke="white" strokeWidth="2" /><circle cx={x(i)} cy={y(d.value)} r="13" fill="transparent" tabIndex={0} role="button" aria-label={`${d.month}: ${scenarioNames[scenario]} ${fmt(d.value)}, ${comparisonName} ${fmt(d.comparison)} AED thousands`} onMouseEnter={() => setFocused(i)} onMouseLeave={() => setFocused(null)} onFocus={() => setFocused(i)} onBlur={() => setFocused(null)} onClick={() => setFocused(focused === i ? null : i)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFocused(focused === i ? null : i) } }} /></g>)}
    </svg>{current && <div className="chart-tooltip" role="status"><strong>{current.month}</strong><span>{scenarioNames[scenario]} <b>{fmt(current.value)}</b></span><span>{comparisonName} <b>{fmt(current.comparison)}</b></span></div>}</div> : <div className="trend-table"><DataTable label="Accessible trend values in AED thousands"><thead><tr><th>Month</th><th className="numeric">{scenarioNames[scenario]}</th><th className="numeric">{comparisonName}</th></tr></thead><tbody>{data.map(d => <tr key={d.month}><td>{d.month}</td><td className="numeric">{fmt(d.value)}</td><td className="numeric">{fmt(d.comparison)}</td></tr>)}</tbody></DataTable></div>}
    <div className="chart-footer"><div className="chart-legend"><span><i className="legend-line" />{scenarioNames[scenario]}</span><span><i className="legend-line legend-budget" />{comparisonName}</span><span className="fictional-series">Fictional series</span></div><div className="chart-footer-tools"><button className="chart-review-button" aria-label={`Review ${metric} variance`} onClick={() => openDialog({ title: `${metric === 'revenue' ? 'Revenue' : 'Operating expenses'} variance`, drawer: true, content: <VarianceReview metric={metric} /> })}><span>Review variance</span><ArrowUpRight size={13} /></button><Segmented value={view} onChange={setView} small label="Chart display" options={[{ value: 'chart', label: <><ChartNoAxesCombined size={13} /><span className="sr-only">Chart</span></> }, { value: 'table', label: <><Table2 size={13} /><span className="sr-only">Table</span></> }]} /></div></div>
  </Card>
}
