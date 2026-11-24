import { useState } from 'react'
import { ArrowRight, FlaskConical, Redo2, RotateCcw, SlidersHorizontal, Sparkles, Undo2 } from 'lucide-react'
import { getFigures, getPlan, planningMonths, scopeNames, signedNumber, type Measure, type PlanningMonth, type Preset } from '../lib/data'
import { useWorkspace } from '../lib/workspace'
import { Badge, Button, Card, CardHeader, DataTable, Note, PageHeader, SelectField } from '../components/ui'
import { BusinessDrivers, NextStep } from '../components/review'
import { UaeTaxPreviewCard } from '../components/UaeTaxPreviewCard'
import { HyperblockScaleCard } from '../components/HyperblockScaleCard'
import { OneStopFpaSuiteCard } from '../components/OneStopFpaSuiteCard'
import { ProjectWorkspaceHubCard } from '../components/ProjectWorkspaceHubCard'

export function Planning() {
  const { scope, period, preset, setPreset, undoPreset, redoPreset, canUndoPreset, canRedoPreset, fmt, preferences, navigate, setScope, setConsolidationStep } = useWorkspace()
  const [month, setMonth] = useState<PlanningMonth>('jan')
  const [assumptionDraft, setAssumption] = useState<string | null>(null)
  const assumption = assumptionDraft ?? String(preset)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const values = getPlan(scope, month, preset)
  const actual = month === 'jan' ? getFigures(scope, 'jan', 'actual') : null
  const names: Record<Preset, string> = { '-5': 'Cautious', 0: 'Base case', 5: 'Upside' }
  const measures: { key: Measure; label: string }[] = [{ key: 'revenue', label: 'Revenue' }, { key: 'expenses', label: 'Operating expenses' }, { key: 'result', label: 'Operating result' }, { key: 'cash', label: 'Cash balance' }]
  const choosePreset = (value: Preset) => { setPreset(value); setAssumption(null); setError(''); setMessage('Fixed demo preview selected. Nothing has been saved to a financial record. Undo is available for changes to the selected preset.') }
  const apply = () => {
    if (!['-5', '0', '5'].includes(assumption.trim())) { setError('Choose -5, 0, or 5. Only these fixed illustrative previews are available.'); document.getElementById('revenue-assumption')?.focus(); return }
    choosePreset(Number(assumption) as Preset)
  }
  const reset = () => { setPreset(0); setAssumption(null); setMonth('jan'); setError(''); setMessage('Local demo assumptions reset to the base case. No financial records were changed.') }
  const restore = (direction: 'undo' | 'redo') => { if (direction === 'undo') undoPreset(); else redoPreset(); setAssumption(null); setError(''); setMessage(`${direction === 'undo' ? 'Previous' : 'Next'} demo preview restored in this session. No financial record was changed.`) }
  return <div className="screen-stack"><PageHeader title="Planning & scenarios" description="Compare the plan. Explore a possibility. Keep every change local." actions={<><Badge tone="blue"><FlaskConical size={12} />Illustrative preview</Badge><div className="undo-controls"><Button aria-label="Undo scenario change" title={canUndoPreset ? 'Restore the previous demo preset' : 'Select a different preset to enable Undo'} disabled={!canUndoPreset} onClick={() => restore('undo')}><Undo2 size={13} />Undo</Button><Button aria-label="Redo scenario change" title={canRedoPreset ? 'Restore the next demo preset' : 'Undo a change to enable Redo'} disabled={!canRedoPreset} onClick={() => restore('redo')}><Redo2 size={13} /></Button></div><Button onClick={reset}><RotateCcw size={14} />Reset demo</Button></>} />
    <div className="planning-toolbar"><div className="flex flex-wrap items-end gap-4"><SelectField label="Demo scenario" value={String(preset)} onChange={value => choosePreset(Number(value) as Preset)} options={[{ value: '0', label: 'Base case · no uplift' }, { value: '5', label: 'Upside · +5% revenue' }, { value: '-5', label: 'Cautious · −5% revenue' }]} /><SelectField label="Planning month" value={month} onChange={value => setMonth(value as PlanningMonth)} options={Object.entries(planningMonths).map(([value, label]) => ({ value, label }))} /></div><div className="planning-context"><span>{scopeNames[scope]}</span><strong>AED thousands</strong></div></div>
    {period !== 'jan' && <Note>The planning fixture covers January–March 2026, independently of the historical reporting-period selector. Actuals are supplied only for January in this planning grid.</Note>}
    <div className="planning-grid"><Card className="plan-comparison"><CardHeader title={`${names[preset]} comparison`} subtitle={`${planningMonths[month]} · Predetermined synthetic outputs`} actions={<Badge tone="green">Session only</Badge>} /><DataTable label={`Actual budget forecast comparison, ${planningMonths[month]}, AED thousands`}><thead><tr><th>Operating measure</th><th className="numeric">Actual</th><th className="numeric">Budget</th><th className="numeric forecast-column">Forecast</th><th className="numeric">Forecast vs. budget</th></tr></thead><tbody>{measures.map(measure => {
      const forecast = values.forecast[measure.key], budget = values.budget[measure.key]
      return <tr key={measure.key} className={measure.key === 'result' ? 'statement-total' : ''}><th>{measure.label}</th><td className={`numeric ${!actual || actual[measure.key] === null ? 'missing-cell' : ''}`}>{fmt(actual?.[measure.key])}</td><td className={`numeric ${budget === null ? 'missing-cell' : ''}`}>{fmt(budget)}</td><td className={`numeric forecast-column ${forecast === null ? 'missing-cell' : 'strong-number'}`}>{fmt(forecast)}</td><td className="numeric">{forecast === null || budget === null ? <span className="missing-cell">Not provided</span> : <span className={measure.key === 'expenses' && forecast > budget ? 'adverse' : forecast >= budget ? 'positive' : 'adverse'}>{signedNumber(forecast - budget, preferences.grouping)}</span>}</td></tr>
    })}</tbody></DataTable><div className="planning-table-note"><span className="tiny-dot" />Forecast reflects the selected fixed preview; actual and budget fixtures do not change.</div><div className="plan-summary"><div><span>Illustrative revenue</span><strong>{fmt(values.forecast.revenue)}<small>AED k</small></strong></div><ArrowRight size={19} className="muted" /><div><span>Illustrative operating result</span><strong>{fmt(values.forecast.result)}<small>AED k</small></strong></div></div></Card>
    <Card className="assumption-card"><CardHeader title={<span className="flex items-center gap-2"><SlidersHorizontal size={16} />Local assumption</span>} subtitle="A reversible sensitivity preview" /><div className="assumption-body"><label className="field" htmlFor="revenue-assumption"><span>Revenue uplift / reduction</span><div className="input-suffix"><input id="revenue-assumption" type="number" min="-5" max="5" step="5" value={assumption} onChange={e => { setAssumption(e.target.value); setError(''); setMessage('') }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); apply() } }} aria-invalid={!!error} aria-describedby={error ? 'assumption-help assumption-error' : 'assumption-help'} /><span>%</span></div></label><p id="assumption-help" className="field-hint">Available previews: −5%, 0%, +5%. Operating expenses remain fixed. Changed presets can be undone or redone.</p>{error && <p id="assumption-error" className="form-error" role="alert">{error}</p>}<Button variant="primary" onClick={apply}><Sparkles size={14} />Apply demo preview</Button><div className="assumption-divider" /><h3>How this preview works</h3><p>The input selects a predefined fictional dataset. It does not run a financial model or save an approved forecast.</p><Badge>Simulated · In memory only</Badge></div></Card></div>
    {message && <Note tone="green"><span role="status">{message}</span></Note>}
    <Card><CardHeader title="Quarter at a glance" subtitle={`${names[preset]} forecast · AED thousands · No actuals inferred`} /><DataTable label="Illustrative quarterly forecast in AED thousands"><thead><tr><th>Operating measure</th>{Object.entries(planningMonths).map(([key, name]) => <th className="numeric" key={key}>{name}</th>)}</tr></thead><tbody>{measures.map(measure => <tr key={measure.key} className={measure.key === 'result' ? 'statement-total' : ''}><th>{measure.label}</th>{(['jan', 'feb', 'mar'] as const).map(key => <td className={`numeric ${measure.key === 'cash' ? 'missing-cell' : ''}`} key={key}>{fmt(getPlan(scope, key, preset).forecast[measure.key])}</td>)}</tr>)}</tbody></DataTable></Card>
    <UaeTaxPreviewCard />
    <HyperblockScaleCard />
    <OneStopFpaSuiteCard />
    <ProjectWorkspaceHubCard />
    <BusinessDrivers />
    <NextStep title="Review the group reporting boundary" description="Planning previews do not clear missing inputs or perform consolidation. Inspect the separate readiness workflow." label="Review group reporting" onClick={() => { setScope('group'); setConsolidationStep(1); navigate('consolidation') }} />
    {preferences.guidance && <Note>All scenarios are illustrative and unadjusted. These fixed outputs do not establish accounting accuracy, model validity, or an approved budget. Resetting affects this session only.</Note>}
  </div>
}
