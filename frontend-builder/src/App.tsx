import { useEffect, useRef, useState } from 'react'
import { ArrowRight, ArrowUpRight, Building2, CalendarDays, ChartNoAxesCombined, ChevronDown, CircleHelp, FileBarChart2, FileSpreadsheet, FlaskConical, FolderOpen, GitMerge, History, LayoutDashboard, Menu, Monitor, Search, Settings2, Upload, WifiOff, X, type LucideIcon } from 'lucide-react'
import { APP_NAME, DEFAULT_WORKSPACE, businesses, formatNumber, pageNames, periods, type PageId, type Period, type Preset, type Scenario, type Scope, type StatementTab } from './lib/data'
import { Workspace, useWorkspace, type OverlayOptions, type Preferences } from './lib/workspace'
import { initialImportDraft, extendedSectorProfiles, type DemoIssueId, type ImportDraft } from './lib/reviewData'
import { useUndoState } from './lib/useUndoState'
import { INDUSTRY_BLUEPRINT_PACKS } from './lib/omniBlueprintEngine'
import { Badge, Button, Card, DefinitionList, Dialog, EmptyState, Note, PageHeader } from './components/ui'
import { ExtendedSectorProfile } from './components/review'
import { Overview } from './pages/Overview'
import { Statements } from './pages/Statements'
import { Planning } from './pages/Planning'
import { Consolidation } from './pages/Consolidation'
import { Imports } from './pages/Imports'
import { Excel } from './pages/Excel'
import { Activity } from './pages/Activity'
import { Settings } from './pages/Settings'

const navItems: { id: PageId; icon: LucideIcon; group: 'workspace' | 'operations' }[] = [
  { id: 'overview', icon: LayoutDashboard, group: 'workspace' },
  { id: 'statements', icon: FileBarChart2, group: 'workspace' },
  { id: 'planning', icon: ChartNoAxesCombined, group: 'workspace' },
  { id: 'consolidation', icon: GitMerge, group: 'workspace' },
  { id: 'imports', icon: Upload, group: 'operations' },
  { id: 'excel', icon: FileSpreadsheet, group: 'operations' },
  { id: 'activity', icon: History, group: 'operations' },
]
const defaultPreferences: Preferences = { compact: false, grouping: true, reduceMotion: false, guidance: true }
function getPageFromHash(): PageId {
  const value = window.location.hash.replace(/^#\/?/, '')
  return Object.prototype.hasOwnProperty.call(pageNames, value) ? value as PageId : 'overview'
}

function App() {
  const [page, setPage] = useState<PageId>(getPageFromHash)
  const [workspace, setWorkspace] = useState<'sample' | 'blank'>('sample')
  const [workspaceName, setWorkspaceName] = useState(DEFAULT_WORKSPACE)
  const [scope, setScope] = useState<Scope>('group')
  const [period, setPeriod] = useState<Period>('jan')
  const [scenario, setScenario] = useState<Scenario>('actual')
  const [statementTab, setStatementTab] = useState<StatementTab>('income')
  const [consolidationStep, setConsolidationStep] = useState(0)
  const presetHistory = useUndoState<Preset>(0)
  const preset = presetHistory.value
  const setPreset = presetHistory.set
  const [importDraft, setImportDraft] = useState<ImportDraft>(initialImportDraft)
  const [importResetSnapshot, setImportResetSnapshot] = useState<ImportDraft | null>(null)
  const [inspectedIssues, setInspectedIssues] = useState<DemoIssueId[]>([])
  const [activityQuery, setActivityQuery] = useState('')
  const resetImportFlow = () => { setImportResetSnapshot(importDraft); setImportDraft(initialImportDraft()) }
  const undoImportReset = () => { if (importResetSnapshot) setImportDraft(importResetSnapshot); setImportResetSnapshot(null) }
  const toggleInspection = (issue: DemoIssueId) => setInspectedIssues(current => current.includes(issue) ? current.filter(value => value !== issue) : [...current, issue])
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences)
  const [overlay, setOverlay] = useState<OverlayOptions | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [epoch, setEpoch] = useState(0)
  const navigate = (next: PageId) => { setPage(next); window.location.hash = `/${next}`; setMobileOpen(false); window.scrollTo({ top: 0, behavior: 'instant' }); requestAnimationFrame(() => document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true })) }
  const closeDialog = () => setOverlay(null)
  const openSearch = () => setOverlay({ title: 'Search workspace', eyebrow: 'QUICK NAVIGATION · CTRL + K', content: <SearchPanel />, footer: <span className="search-modal-hint"><kbd>Esc</kbd> to close<span className="inline-dot">·</span>Searches bundled demo screens only</span> })
  const showAbout = () => setOverlay({ title: 'A workbench for possibilities', eyebrow: `${APP_NAME.toUpperCase()} · INTERACTIVE PROTOTYPE`, content: <><Badge tone="blue"><FlaskConical size={12} />Prototype · Synthetic data</Badge><p className="dialog-copy">Explore a fictional finance workspace for Aster Vale Group. All business names, figures, sources, and activity are synthetic. No endorsement or real corporate relationship is implied.</p><div className="about-feature-list"><div><strong>Explore the data</strong><span>Switch scope, period, and scenario. Open a number to see fictional provenance.</span></div><div><strong>Try a workflow</strong><span>Edit a local assumption, review an import, or walk through an Excel confirmation.</span></div><div><strong>Know the boundary</strong><span>No financial engine, backend, database, native add-in, or production integrations are connected.</span></div></div><Note>Management totals are unadjusted, not consolidated. No accounting accuracy, regulatory compliance, encryption, or completed consolidation is claimed.</Note><p className="field-hint mt-4">Keyboard: Ctrl + K opens search. Tab moves through controls. Escape closes a dialog. Preferences are in memory only and reset on reload.</p></> })
  const resetDemo = () => setOverlay({ title: 'Reset the local demo?', content: <><p className="dialog-copy">Restore session selections, scenario assumptions, display preferences, and the fictional workspace label to their defaults. The retained filename preview, local undo history, and inspection markers will also be cleared.</p><Note>This only resets temporary interface state. No financial record, workbook, external system, or audit event will be changed.</Note></>, footer: <><Button onClick={closeDialog}>Keep exploring</Button><Button variant="primary" onClick={() => { setWorkspace('sample'); setWorkspaceName(DEFAULT_WORKSPACE); setScope('group'); setPeriod('jan'); setScenario('actual'); setStatementTab('income'); setConsolidationStep(0); presetHistory.reset(0); setImportDraft(initialImportDraft()); setImportResetSnapshot(null); setInspectedIssues([]); setActivityQuery(''); setPreferences(defaultPreferences); setEpoch(current => current + 1); navigate('overview'); closeDialog() }}>Reset local demo</Button></> })

  useEffect(() => {
    if (!mobileOpen) return
    const previous = document.activeElement as HTMLElement | null
    const sidebar = document.getElementById('primary-navigation')
    const timer = window.setTimeout(() => (sidebar?.querySelector<HTMLElement>('[aria-current="page"]') || sidebar?.querySelector<HTMLElement>('a'))?.focus(), 0)
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || document.querySelector('dialog[open]')) return
      const controls = Array.from(sidebar?.querySelectorAll<HTMLElement>('a, button:not(:disabled)') || []).filter(element => element.offsetHeight > 0)
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', trap)
    return () => { window.clearTimeout(timer); document.removeEventListener('keydown', trap); previous?.focus({ preventScroll: true }) }
  }, [mobileOpen])

  useEffect(() => {
    const onHashChange = () => { setPage(getPageFromHash()); setMobileOpen(false) }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setOverlay({ title: 'Search workspace', eyebrow: 'QUICK NAVIGATION · CTRL + K', content: <SearchPanel />, footer: <span className="search-modal-hint"><kbd>Esc</kbd> to close<span className="inline-dot">·</span>Searches bundled demo screens only</span> }) }
    }
    document.title = APP_NAME
    window.addEventListener('hashchange', onHashChange)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('hashchange', onHashChange); window.removeEventListener('keydown', onKey) }
  }, [])

  const pages = { overview: <Overview />, statements: <Statements />, planning: <Planning />, consolidation: <Consolidation key={scope} />, imports: <Imports />, excel: <Excel key={`${scope}-${period}-${scenario}`} />, activity: <Activity />, settings: <Settings /> }
  return <Workspace.Provider value={{ page, navigate, workspace, setWorkspace, workspaceName, setWorkspaceName, scope, setScope, period, setPeriod, scenario, setScenario, statementTab, setStatementTab, consolidationStep, setConsolidationStep, preset, setPreset, undoPreset: presetHistory.undo, redoPreset: presetHistory.redo, canUndoPreset: presetHistory.canUndo, canRedoPreset: presetHistory.canRedo, importDraft, setImportDraft, resetImportFlow, undoImportReset, canUndoImportReset: !!importResetSnapshot?.filename, inspectedIssues, toggleInspection, activityQuery, setActivityQuery, preferences, setPreferences, fmt: value => formatNumber(value, preferences.grouping), openDialog: setOverlay, closeDialog, showAbout, resetDemo }}>
    <div className={`app-shell ${preferences.compact ? 'compact-tables' : ''} ${preferences.reduceMotion ? 'reduce-motion' : ''}`}>
      <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus() }}>Skip to main content</a>
      {mobileOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside id="primary-navigation" className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`} aria-label="Main navigation">
        <a className="brand" href="#/overview" aria-label={`${APP_NAME} overview`} onClick={event => { event.preventDefault(); navigate('overview') }}><svg viewBox="0 0 32 34" className="brand-symbol" aria-hidden="true"><path d="M3 28 16 3l13 25h-8L16 18l-5 10z" fill="currentColor" /><path d="m11.5 29 4.5-8 4.5 8z" fill="#84d4b8" /></svg><span className="brand-word">{APP_NAME.replace(/\sFP&A$/, '').toLowerCase()}</span><span className="brand-tag">FP&A</span></a>
        <div className="sidebar-main"><div className="nav-section-label">WORKSPACE</div><nav className="nav-list" aria-label="Finance workspace">{navItems.filter(item => item.group === 'workspace').map(({ id, icon: Icon }) => <a href={`#/${id}`} className={`nav-item ${page === id ? 'active' : ''}`} aria-current={page === id ? 'page' : undefined} aria-label={pageNames[id]} title={pageNames[id]} key={id} onClick={event => { event.preventDefault(); navigate(id) }}><Icon size={17} strokeWidth={1.65} /><span>{pageNames[id]}</span>{id === 'consolidation' && <span className="nav-counter" aria-label="2 example issues">2</span>}</a>)}</nav><div className="nav-section-label operations-label">DATA & OPERATIONS</div><nav className="nav-list" aria-label="Data and operations">{navItems.filter(item => item.group === 'operations').map(({ id, icon: Icon }) => <a href={`#/${id}`} className={`nav-item ${page === id ? 'active' : ''}`} aria-current={page === id ? 'page' : undefined} aria-label={pageNames[id]} title={pageNames[id]} key={id} onClick={event => { event.preventDefault(); navigate(id) }}><Icon size={17} strokeWidth={1.65} /><span>{pageNames[id]}</span></a>)}</nav></div>
        <div className="sidebar-bottom"><nav className="nav-list" aria-label="Workspace preferences"><a href="#/settings" className={`nav-item ${page === 'settings' ? 'active' : ''}`} aria-current={page === 'settings' ? 'page' : undefined} aria-label="Settings" title="Settings" onClick={event => { event.preventDefault(); navigate('settings') }}><Settings2 size={17} strokeWidth={1.65} /><span>Settings</span></a><button className="nav-item" onClick={showAbout} title="Demo guide" aria-label="Demo guide"><CircleHelp size={17} strokeWidth={1.65} /><span>Demo guide</span><ArrowUpRight size={13} className="nav-external" /></button></nav><div className="local-workspace-card"><span className="local-icon"><Monitor size={17} /></span><div><strong>Made for focused work.</strong><p>Local demo workspace.<br />No production connections.</p></div><span className="local-dot" /></div><button className="sidebar-profile" aria-label="About Jamie Demo, fictional persona" onClick={() => setOverlay({ title: 'A fictional workspace persona', content: <><Badge>Demo only · No user account</Badge><p className="dialog-copy">Jamie Demo is a fictional finance persona used to give this prototype context. There is no authentication, online login, user account, or corporate identity connection.</p><DefinitionList items={[{ label: 'Persona', value: 'Jamie Demo' }, { label: 'Role', value: 'Group finance · fictional' }, { label: 'Session', value: 'Local UI state only' }]} /></> })}><span className="profile-avatar">JD</span><span className="profile-copy"><strong>Jamie Demo</strong><small>Finance workspace</small></span><ChevronDown size={14} /></button></div>
      </aside>
      <div className="main-shell"><header className="topbar"><button className="mobile-menu icon-button" onClick={() => setMobileOpen(!mobileOpen)} aria-controls="primary-navigation" aria-expanded={mobileOpen} aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}>{mobileOpen ? <X size={19} /> : <Menu size={19} />}</button><div className="toolbar-workspace toolbar-select"><Building2 size={16} /><select aria-label="Workspace" value={workspace} onChange={event => setWorkspace(event.target.value as 'sample' | 'blank')}><option value="sample">{workspaceName}</option><option value="blank">Blank demo workspace</option></select><ChevronDown size={12} /></div><span className="toolbar-divider" /><div className="toolbar-scope toolbar-select"><select aria-label="Entity or group scope" value={scope} onChange={event => setScope(event.target.value as Scope)}><option value="group">All businesses</option>{businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select><ChevronDown size={12} /></div><div className="toolbar-spacer" /><div className="toolbar-filters"><div className="toolbar-period toolbar-select"><CalendarDays size={14} /><select aria-label="Reporting period" value={period} onChange={event => setPeriod(event.target.value as Period)}>{Object.entries(periods).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}</select><ChevronDown size={12} /></div><div className="toolbar-scenario toolbar-select"><span className="scenario-dot" /><select aria-label="Reporting scenario" value={scenario} onChange={event => setScenario(event.target.value as Scenario)}><option value="actual">Actual</option><option value="budget">Budget</option><option value="forecast">Forecast</option></select><ChevronDown size={12} /></div></div><button className="toolbar-search" aria-label="Search workspace, Ctrl K" onClick={openSearch}><Search size={17} /><kbd>Ctrl K</kbd></button><span className="toolbar-divider offline-divider" /><span className="offline-status"><WifiOff size={14} /><span>Offline demo</span></span></header>
        <div className="prototype-strip"><span className="prototype-mark"><FlaskConical size={13} />Prototype · Synthetic data</span><span className="prototype-explanation">A fictional workspace. Production integrations are not connected.</span><button onClick={showAbout}>About this demo<ArrowUpRight size={12} /></button></div>
        <main id="main-content" className="main-content" tabIndex={-1}><div key={`${page}-${epoch}`} className="page-enter">{workspace === 'blank' && page !== 'settings' && page !== 'imports' ? <BlankWorkspace /> : pages[page]}</div></main>
      </div>
      {overlay && <Dialog options={overlay} onClose={closeDialog} />}
    </div>
  </Workspace.Provider>
}

function BlankWorkspace() {
  const { page, setWorkspace, navigate } = useWorkspace()
  return <div className="screen-stack"><PageHeader title={pageNames[page]} description="Blank demo workspace · No financial inputs provided" actions={<Badge>Empty demo state</Badge>} /><Card><EmptyState icon={FolderOpen} title="A workspace with room to begin" description="This intentionally empty demo has no business inputs. Missing data is not shown as zero, and no financial records have been created." action={<div className="flex flex-wrap justify-center gap-2"><Button variant="primary" onClick={() => setWorkspace('sample')}>Open sample workspace<ArrowRight size={14} /></Button><Button onClick={() => navigate('imports')}>Explore mock import</Button></div>} /></Card><Note>The sample workspace contains only bundled synthetic figures. Selecting it does not import or commit data.</Note></div>
}

const omniSearchEntries = [
  { id: 'omni-blueprints', name: 'Global 10-industry blueprint studio', description: 'BP-01 to BP-10 · Declarative BigInt KPIs · 0 warnings', page: 'overview' as PageId, icon: LayoutDashboard, sectorId: undefined as string | undefined },
  { id: 'omni-stmt-policy', name: 'Multi-period aggregation & acyclic DAG guard (I08/I09/I27)', description: 'FLOW_SUM vs CLOSING_LAST, RATIO_OF_SUMS & cycle blocker', page: 'statements' as PageId, icon: FileBarChart2, sectorId: undefined as string | undefined },
  { id: 'omni-allocator', name: 'Largest-Remainder exact-sum allocator (I05)', description: 'Zero penny drift · Rejects zero/negative weights', page: 'planning' as PageId, icon: ChartNoAxesCombined, sectorId: undefined as string | undefined },
  { id: 'omni-scale', name: '100M+ cell Hyperblock RAM & spill estimator', description: '4,096-cell Block-Hybrid · ChaCha20 mmap spill', page: 'planning' as PageId, icon: ChartNoAxesCombined, sectorId: undefined as string | undefined },
  { id: 'omni-fpa-suite', name: 'One-Stop FP&A Replacement Suite (I34/I35)', description: 'Workforce UAE Art. 51 EOSB, CapEx Roll-Forward, 13-Week Cash DSCR & PVM Bridge', page: 'planning' as PageId, icon: ChartNoAxesCombined, sectorId: undefined as string | undefined },
  { id: 'omni-ingestion', name: 'Source-scoped ingestion gate (IMP-GL / IMP-SUB)', description: 'Fixes OQ-025 sub-ledger drop, K2 leak, K3 finding key', page: 'imports' as PageId, icon: Upload, sectorId: undefined as string | undefined },
  { id: 'omni-erp-mapper', name: 'Universal Top-12 ERP Adapter Catalog & CoA Mapper (I33)', description: 'SAP ACDOCA, Oracle, D365, NetSuite, TallyPrime, Odoo, Sage, Workday, QuickBooks, Zoho, Infor, SAF-T', page: 'imports' as PageId, icon: Upload, sectorId: undefined as string | undefined },
  { id: 'omni-xll', name: 'Native XLL P0 =FPA.GET & Command idempotency lab (I20/I28)', description: '15-sig-digit guard, =FPA.SET block & 409/412 conflicts', page: 'excel' as PageId, icon: FileSpreadsheet, sectorId: undefined as string | undefined },
  { id: 'omni-audit-chain', name: 'FIPS 180-4 SHA-256 hash-chained audit oracle (I22)', description: 'Tamper detection & sequential digest chain verifier', page: 'activity' as PageId, icon: History, sectorId: undefined as string | undefined },
  { id: 'omni-invariants', name: '5-language contract & 36-invariant oracle (I01–I36)', description: 'Rust, TypeScript, Go, Elixir, Java 25 jlink fallbacks', page: 'settings' as PageId, icon: Settings2, sectorId: undefined as string | undefined },
  { id: 'omni-master-roadmap', name: '8-Phase Gated Execution Roadmap & Secondary Brain (I36)', description: 'P0–P7 vertical gates, One-Stop Replacement Matrix & Brain 00–05 sync', page: 'settings' as PageId, icon: Settings2, sectorId: undefined as string | undefined },
  ...INDUSTRY_BLUEPRINT_PACKS.map(pack => ({
    id: `omni-pack-${pack.id}`,
    name: `${pack.code} · ${pack.name}`,
    description: `${pack.sectorGroup} · ${pack.uaeConglomerateLink}`,
    page: 'overview' as PageId,
    icon: LayoutDashboard,
    sectorId: undefined as string | undefined,
  })),
]

function SearchPanel() {
  const { navigate, openDialog, closeDialog, setStatementTab, setConsolidationStep } = useWorkspace()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const resultsRef = useRef<HTMLDivElement>(null)
  const results = [...Object.entries(pageNames).map(([id, name]) => ({ id, name, description: 'Prototype screen', page: id as PageId, icon: navItems.find(n => n.id === id)?.icon || Settings2, sectorId: undefined as string | undefined })),
    { id: 'cash-inputs', name: 'Cash inputs · Not provided', description: 'Missing-data example', page: 'statements' as PageId, icon: FileBarChart2, sectorId: undefined },
    { id: 'fx-reference', name: 'Missing reference FX rate', description: 'Consolidation blocker · Demo only', page: 'consolidation' as PageId, icon: GitMerge, sectorId: undefined },
    ...extendedSectorProfiles.map(sector => ({ id: `sector-${sector.id}`, name: `${sector.name} · ${sector.sector}`, description: `Extended sector template (${sector.portfolioRef})`, page: 'overview' as PageId, icon: Building2, sectorId: sector.id })),
    ...omniSearchEntries,
  ].filter(result => `${result.name} ${result.description}`.toLowerCase().includes(query.toLowerCase()))
  const choose = (result: typeof results[number]) => {
    if (result.sectorId) {
      const sector = extendedSectorProfiles.find(item => item.id === result.sectorId)
      if (sector) {
        navigate('overview')
        openDialog({ title: sector.name, eyebrow: `${sector.code} · ${sector.portfolioRef.toUpperCase()} · TEMPLATE PREVIEW`, drawer: true, content: <ExtendedSectorProfile profile={sector} /> })
        return
      }
    }
    if (result.id === 'cash-inputs') setStatementTab('cash')
    if (result.id === 'fx-reference') setConsolidationStep(2)
    closeDialog()
    navigate(result.page)
  }
  return <div className="search-panel"><label className="search-field"><Search size={18} /><input autoFocus value={query} role="combobox" aria-expanded="true" aria-controls="workspace-search-results" aria-autocomplete="list" aria-activedescendant={results[activeIndex] ? `search-${results[activeIndex].id}` : undefined} onChange={event => { setQuery(event.target.value); setActiveIndex(0) }} onKeyDown={event => {
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && results.length) { event.preventDefault(); const next = (activeIndex + (event.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length; setActiveIndex(next); resultsRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[next]?.scrollIntoView({ block: 'nearest' }) }
    if (event.key === 'Enter' && results[activeIndex]) { event.preventDefault(); choose(results[activeIndex]) }
  }} placeholder="Find a screen or demo workflow…" aria-label="Search screens and demo workflows" /></label><div className="search-results" id="workspace-search-results" ref={resultsRef} role="listbox" aria-label="Search results">{results.length ? results.map((result, index) => <button key={result.id} id={`search-${result.id}`} role="option" aria-selected={activeIndex === index} className={activeIndex === index ? 'search-active' : ''} tabIndex={-1} onMouseMove={() => setActiveIndex(index)} onClick={() => choose(result)}><result.icon size={18} /><span><strong>{result.name}</strong><small>{result.description}</small></span><ArrowRight size={14} /></button>) : <div role="option" aria-selected="false"><EmptyState icon={Search} title="No matching demo screens" description="Try “cash”, “Excel”, or “planning”." /></div>}</div><p className="command-hint"><kbd>↑</kbd><kbd>↓</kbd> to choose <kbd>Enter</kbd> to open · No external search</p></div>
}

export default App
