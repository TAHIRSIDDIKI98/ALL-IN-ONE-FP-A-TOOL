import { useState } from 'react'
import { MASTER_EXECUTION_ROADMAP, type RoadmapPhaseSpec } from '../lib/omniBlueprintEngine'

const REPLACEMENT_MATRIX = [
  {
    category: 'Spreadsheet & Ad-Hoc Modeling',
    replacedTools: 'Disconnected Excel Models, VBA Macros, Manual CSV Joins',
    atlasCapability: 'Native Windows x64 C-API XLL Add-In (FPA.GET / FPA.DIM) + Rust Arrow Hyperblock',
    invariants: 'I17, I18, I19, I20, I28',
  },
  {
    category: 'Enterprise Connected Planning',
    replacedTools: 'Anaplan, Pigments, Workday Adaptive Planning, Planful',
    atlasCapability: '100M+ Cell Block-Hybrid Hyperblock + All 10 Industry Packs + Largest-Remainder Allocator',
    invariants: 'I01–I07, I10–I16, I26, I27',
  },
  {
    category: 'Financial Consolidation & Close',
    replacedTools: 'Oracle HFM / FCCS, SAP BPC, OneStream, Tagetik',
    atlasCapability: 'IAS 21 Multi-Currency FX & CTA + IC Elimination + Journal Posting Gate + Close Lock',
    invariants: 'I08, I09, I21–I25',
  },
  {
    category: 'Workforce, CapEx & 13-Week Cash',
    replacedTools: 'Legacy HR Gratuity Sheets, Fixed Asset Sub-Models, Treasury Cash Trackers',
    atlasCapability: 'UAE Labor Law Art. 51 EOSB Engine + CapEx NBV Roll-Forward + 13-Week Cash & DSCR Guard',
    invariants: 'I34, I35',
  },
  {
    category: 'Universal ERP Data Integration',
    replacedTools: 'Fragile ETL Scripts, Manual Trial Balance Re-Keying',
    atlasCapability: 'Top-12 ERP Adapter Catalog + SCD2 CoA Mapper + Source-Scoped IMP-GL / IMP-SUB Gate',
    invariants: 'I10, I11, I12, I33',
  },
]

export function MasterRoadmapBlueprintCard() {
  const [selectedPhaseId, setSelectedPhaseId] = useState<RoadmapPhaseSpec['phaseId']>('P0')

  const selectedPhase =
    MASTER_EXECUTION_ROADMAP.find(phase => phase.phaseId === selectedPhaseId) ??
    MASTER_EXECUTION_ROADMAP[0]

  return (
    <section
      id="omni-master-roadmap"
      className="panel omni-roadmap-card"
      aria-labelledby="master-roadmap-blueprint-heading"
    >
      <div className="panel-head omni-head-split">
        <div>
          <p className="eyebrow">Master Zero-Compromise Execution Roadmap &amp; Secondary Brain · I36 · P0–P7</p>
          <h3 id="master-roadmap-blueprint-heading">
            8-Phase Gated Build Roadmap, Secondary Brain Protocol &amp; One-Stop Replacement Matrix
          </h3>
        </div>
        <div className="omni-badge-row">
          <span className="status-badge ok">{MASTER_EXECUTION_ROADMAP.length} Vertical Gated Phases</span>
          <span className="status-badge ok">Secondary Brain 00–05 Synchronized</span>
        </div>
      </div>

      <p className="panel-copy">
        Follow this <strong>8-phase gated execution roadmap (P0–P7)</strong> to build and verify the complete
        Windows 11 offline production tool without regressions or orphaned modules. Every phase enforces the
        repository&apos;s 6-file <strong>Secondary Brain</strong> operating loop (
        <code>READ → VERIFY → ACT → MEMORIZE</code>) before advancing.
      </p>

      <div className="omni-pack-tabs" role="tablist" aria-label="8-Phase Gated Build Roadmap">
        {MASTER_EXECUTION_ROADMAP.map(phase => {
          const isSelected = phase.phaseId === selectedPhase.phaseId
          return (
            <button
              key={phase.phaseId}
              type="button"
              role="tab"
              aria-selected={isSelected}
              className={`omni-pack-tab ${isSelected ? 'active' : ''}`}
              onClick={() => setSelectedPhaseId(phase.phaseId)}
            >
              <span className="omni-pack-code">{phase.phaseId}</span>
              <span>{phase.title}</span>
            </button>
          )
        })}
      </div>

      <div className="omni-erp-inspector-grid">
        <div className="omni-subpanel">
          <div className="omni-subhead">
            <h4>
              {selectedPhase.phaseId} · {selectedPhase.title}
            </h4>
            <span
              className={`status-badge ${
                selectedPhase.environmentStatus === 'VERIFIED_IN_WEB_WORKBENCH' ? 'ok' : 'warn'
              }`}
            >
              {selectedPhase.environmentStatus}
            </span>
          </div>
          <dl className="omni-kv-list">
            <div>
              <dt>Primary Languages &amp; Runtimes</dt>
              <dd className="mono">{selectedPhase.runtimesInvolved}</dd>
            </div>
            <div>
              <dt>Key Deliverables</dt>
              <dd>{selectedPhase.primaryDeliverables}</dd>
            </div>
            <div>
              <dt>Blocking Invariants Enforced</dt>
              <dd className="mono">{selectedPhase.blockingInvariants}</dd>
            </div>
          </dl>
        </div>

        <div className="omni-subpanel">
          <div className="omni-subhead">
            <h4>Secondary Brain Gate &amp; CLI Verification</h4>
            <span className="mono">READ → VERIFY → ACT → MEMORIZE</span>
          </div>
          <dl className="omni-kv-list">
            <div>
              <dt>Secondary Brain Files Synchronized</dt>
              <dd className="mono">{selectedPhase.brainFilesUpdated}</dd>
            </div>
            <div>
              <dt>Mandatory Brain Synchronization Protocol</dt>
              <dd>
                Read Brain 00 &amp; 04 before coding; verify actual files &amp; parity JSON; wire every engine
                to UI &amp; tests (0% orphan rule I31); memorize decisions in Brain 02–05 before advancing.
              </dd>
            </div>
            <div>
              <dt>Deterministic Exit Verification Command</dt>
              <dd className="mono omni-raw-payload">{selectedPhase.exitGateCommand}</dd>
            </div>
          </dl>
        </div>
      </div>

      <details className="omni-erp-catalog-details">
        <summary>
          View Complete One-Stop FP&amp;A Replacement Matrix (5 Legacy Tool Categories Replaced)
        </summary>
        <div className="omni-compact-grid">
          {REPLACEMENT_MATRIX.map(row => (
            <article key={row.category} className="omni-mini-card">
              <div className="omni-subhead">
                <strong>{row.category}</strong>
                <span className="mono">{row.invariants}</span>
              </div>
              <p className="muted-copy">Replaces: {row.replacedTools}</p>
              <p className="mono">{row.atlasCapability}</p>
            </article>
          ))}
        </div>
      </details>
    </section>
  )
}
