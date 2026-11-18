import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode, type ButtonHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, Check, ChevronDown, CircleHelp, Info, X, type LucideIcon } from 'lucide-react'
import { useWorkspace, type OverlayOptions } from '../lib/workspace'
import { APP_NAME, businesses, getFigures, periods, REVISION, scenarioNames, scopeNames, type Measure, type Scope } from '../lib/data'

export function Button({ children, variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return <button className={`button button-${variant} ${className}`} {...props}>{children}</button>
}
export function IconButton({ icon: Icon, label, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return <button className="icon-button" aria-label={label} title={label} {...props}><Icon size={17} /></button>
}
export function Badge({ children, tone = 'neutral', dot = false }: { children: ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'red' | 'blue'; dot?: boolean }) {
  return <span className={`badge badge-${tone}`}>{dot && <span className="status-dot" />}{children}</span>
}
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) { return <section className={`card ${className}`}>{children}</section> }
export function PageHeader({ title, description, eyebrow, actions }: { title: string; description: ReactNode; eyebrow?: string; actions?: ReactNode }) {
  return <header className="page-header"><div>{eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}<h1 tabIndex={-1}>{title}</h1><p className="page-description">{description}</p></div>{actions && <div className="page-actions">{actions}</div>}</header>
}
export function CardHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return <div className="card-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{actions && <div className="card-actions">{actions}</div>}</div>
}
export function Segmented<T extends string>({ options, value, onChange, label, small = false }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (value: T) => void; label: string; small?: boolean }) {
  return <div className={`segmented ${small ? 'segmented-small' : ''}`} role="group" aria-label={label}>{options.map(option => <button key={option.value} aria-pressed={value === option.value} className={value === option.value ? 'selected' : ''} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>
}
export function SelectField({ label, value, onChange, options, disabled = false }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; disabled?: boolean }) {
  const id = useId()
  return <div className="field"><label htmlFor={id}>{label}</label><div className="select-wrap"><select id={id} aria-label={label} value={value} onChange={e => onChange(e.target.value)} disabled={disabled}>{options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select><ChevronDown size={14} aria-hidden="true" /></div></div>
}
export function Note({ children, tone = 'neutral', className = '' }: { children: ReactNode; tone?: 'neutral' | 'amber' | 'green'; className?: string }) {
  return <div className={`note note-${tone} ${className}`}><Info size={16} aria-hidden="true" /><div>{children}</div></div>
}
export function EmptyState({ icon: Icon = CircleHelp, title, description, action }: { icon?: LucideIcon; title: string; description: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={27} strokeWidth={1.5} /></span><h3>{title}</h3><p>{description}</p>{action}</div>
}
export function DataTable({ children, label, className = '' }: { children: ReactNode; label: string; className?: string }) {
  return <div className="table-scroll" role="region" aria-label={label} tabIndex={0}><table className={`data-table ${className}`}><caption className="sr-only">{label}</caption>{children}</table></div>
}
export function BusinessLabel({ id, secondary = false }: { id: string; secondary?: boolean }) {
  const business = businesses.find(b => b.id === id)
  if (!business) return null
  return <span className="business-label"><span className={`business-icon business-${business.color}`}>{business.short}</span><span><span className="business-name">{business.name}</span>{secondary && <span className="business-code">{business.code} · Fictional entity</span>}</span></span>
}
const DialogFooterHost = createContext<HTMLElement | null>(null)
export function DialogActions({ children }: { children: ReactNode }) {
  const host = useContext(DialogFooterHost)
  return host ? createPortal(<div className="dialog-workflow-actions">{children}</div>, host) : null
}
export function Dialog({ options, onClose }: { options: OverlayOptions; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [footerHost, setFooterHost] = useState<HTMLElement | null>(null)
  const id = useId()
  useEffect(() => {
    const dialog = ref.current
    const previouslyFocused = document.activeElement as HTMLElement | null
    dialog?.showModal()
    return () => { dialog?.close(); previouslyFocused?.focus() }
  }, [])
  useEffect(() => {
    const dialog = ref.current
    const target = dialog?.querySelector<HTMLElement>('.search-panel input') || dialog?.querySelector<HTMLElement>('.dialog-header .icon-button')
    target?.focus()
  }, [options.title])
  return <dialog ref={ref} className={`dialog ${options.drawer ? 'drawer' : ''} ${options.wide ? 'dialog-wide' : ''}`} aria-labelledby={id} onCancel={e => { e.preventDefault(); onClose() }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <DialogFooterHost.Provider value={footerHost}><div className="dialog-inner"><header className="dialog-header"><div><div className="eyebrow">{options.eyebrow || `${APP_NAME.toUpperCase()} · DEMO WORKSPACE`}</div><h2 id={id}>{options.title}</h2></div><IconButton icon={X} label="Close dialog" onClick={onClose} /></header><div className="dialog-content">{options.content}</div><footer className="dialog-footer"><div className="dialog-actions-host" ref={setFooterHost} />{options.footer || <Button onClick={onClose}>Close preview</Button>}</footer></div></DialogFooterHost.Provider>
  </dialog>
}
export function DefinitionList({ items }: { items: { label: string; value: ReactNode }[] }) { return <dl className="definition-list">{items.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl> }
export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: () => void; label: string; description: string }) {
  const id = useId()
  return <div className="setting-row"><div><label id={id}>{label}</label><p>{description}</p></div><button type="button" role="switch" aria-checked={checked} aria-labelledby={id} className={`toggle ${checked ? 'on' : ''}`} onClick={onChange}><span>{checked && <Check size={11} />}</span></button></div>
}
export function SourceDetail({ metric, title, scopeOverride, showActions = true }: { metric: Measure; title: string; scopeOverride?: Scope; showActions?: boolean }) {
  const { scope: currentScope, period, scenario, fmt, navigate, setScope, setStatementTab, closeDialog } = useWorkspace()
  const scope = scopeOverride ?? currentScope
  const values = getFigures(scope, period, scenario)
  return <div className="source-detail"><Badge tone="blue">Fictional provenance · Demo data</Badge><div className="detail-hero"><span>{title}</span><strong>{fmt(values[metric])}</strong><small>AED thousands · {scenarioNames[scenario]}</small></div><DefinitionList items={[
    { label: 'Reporting scope', value: scopeNames[scope] }, { label: 'Period', value: periods[period].full }, { label: 'Revision', value: REVISION }, { label: 'Fixture', value: period === 'jan' && scenario === 'actual' ? 'synthetic-january-2026.csv' : 'Bundled comparison fixture' }, { label: 'View', value: 'Unadjusted management inputs' },
  ]} /><h3 className="section-label">Illustrative source lineage</h3><div className="lineage"><span>Bundled fixture</span><ArrowRight size={14} /><span>Demo mapping</span><ArrowRight size={14} /><span>View</span></div><h3 className="section-label">Contributing inputs</h3><div className="detail-inputs">{businesses.filter(b => scope === 'group' || b.id === scope).map(b => <div key={b.id}><BusinessLabel id={b.id} /><strong>{fmt(getFigures(b.id, period, scenario)[metric])}</strong></div>)}</div><Note>No ledger connection or source document was accessed. No adjustments, eliminations, or FX conversions have been applied.</Note>{showActions && <DialogActions><Button variant="primary" onClick={() => { setScope(scope); setStatementTab(metric === 'cash' ? 'cash' : 'income'); closeDialog(); navigate('statements') }}>Compare in statements<ArrowRight size={14} /></Button><Button onClick={() => { setScope(scope); closeDialog(); navigate('planning') }}>Explore scenarios</Button></DialogActions>}</div>
}
