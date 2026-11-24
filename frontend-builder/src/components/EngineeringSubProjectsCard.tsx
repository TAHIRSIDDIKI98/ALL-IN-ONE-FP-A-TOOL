import { useState } from 'react'
import {
  ENGINEERING_SUBPROJECT_PACKS,
  validateSubProjectTraceability,
  type EngineeringSubProjectId,
} from '../lib/omniBlueprintEngine'

export function EngineeringSubProjectsCard() {
  const [selectedId, setSelectedId] = useState<EngineeringSubProjectId>('PRJ-CORE')
  const selected =
    ENGINEERING_SUBPROJECT_PACKS.find(sp => sp.subProjectId === selectedId) ??
    ENGINEERING_SUBPROJECT_PACKS[0]
  const trace = validateSubProjectTraceability()

  return (
    <section
      id="omni-engineering-subprojects"
      className="panel omni-subproject-card"
      aria-labelledby="engineering-subprojects-heading"
    >
      <div className="panel-head omni-head-split">
        <div>
          <p className="eyebrow">
            MODULAR ENGINEERING SUB-PROJECT BLUEPRINT PACKS · I40 · 0 ORPHAN INVARIANTS
          </p>
          <h3 id="engineering-subprojects-heading">
            7 Engineering Sub-Project Blueprint Packs (fpa-documentation/projects/)
          </h3>
        </div>
        <div className="omni-inline-meta mono">
          {ENGINEERING_SUBPROJECT_PACKS.length} Sub-Projects · {trace.coveredInvariantIds.length} /{' '}
          {trace.expectedInvariantCount} Invariants Covered · {trace.orphanInvariantIds.length}{' '}
          Orphans
        </div>
      </div>

      <p className="panel-copy">
        Every runtime module owns a standalone per-project specification in{' '}
        <code>fpa-documentation/projects/</code> detailing its IPC/SQLCipher ownership boundary,
        security gate, Secondary Brain pre-flight triggers, and deterministic Windows 11 exit
        command.
      </p>

      <div
        className="omni-pack-tabs"
        role="tablist"
        aria-label="Engineering Sub-Project Blueprint Packs"
      >
        {ENGINEERING_SUBPROJECT_PACKS.map(sp => {
          const active = sp.subProjectId === selected.subProjectId
          return (
            <button
              key={sp.subProjectId}
              type="button"
              role="tab"
              aria-selected={active}
              className={`omni-pack-tab ${active ? 'active' : ''}`}
              onClick={() => setSelectedId(sp.subProjectId)}
            >
              <span className="omni-pack-code">{sp.subProjectId}</span>
              <span>{sp.languageRuntime.split(' ')[0]}</span>
            </button>
          )
        })}
      </div>

      <div className="omni-project-meta-strip">
        <span className="mono">{selected.subProjectId}</span>
        <span aria-hidden="true">·</span>
        <span>{selected.languageRuntime}</span>
        <span aria-hidden="true">·</span>
        <span className="mono">{selected.targetBinary}</span>
        <span aria-hidden="true">·</span>
        <span>Phases: {selected.phasesUnlocked.join(', ')}</span>
        <span aria-hidden="true">·</span>
        <span
          className={
            selected.environmentStatus === 'VERIFIED_IN_WEB_WORKBENCH' ? 'positive' : 'adverse'
          }
        >
          {selected.environmentStatus}
        </span>
      </div>

      <div className="omni-erp-inspector-grid">
        <div className="omni-subpanel">
          <h4>
            {selected.subProjectId} · {selected.title}
          </h4>
          <dl className="omni-kv-list">
            <div>
              <dt>Modular Blueprint File</dt>
              <dd className="mono">{selected.docPath}</dd>
            </div>
            <div>
              <dt>IPC &amp; Storage Ownership Boundary</dt>
              <dd>{selected.ipcAndDataBoundary}</dd>
            </div>
            <div>
              <dt>Owned Blocking Invariants ({selected.ownedInvariants.length})</dt>
              <dd className="mono">{selected.ownedInvariants.join(', ')}</dd>
            </div>
          </dl>
        </div>

        <div className="omni-subpanel">
          <h4>Security Gate &amp; Exit Verification</h4>
          <dl className="omni-kv-list">
            <div>
              <dt>Security &amp; Offline Isolation Gate</dt>
              <dd>{selected.securityGate}</dd>
            </div>
            <div>
              <dt>Secondary Brain Gate Trigger</dt>
              <dd>
                Read Brain 00, Brain 04, and {selected.subProjectId} pack before changes; verify
                outputs against atlas-fpa-v4.0-parity-vectors.json; log changes in Brain 01–05.
              </dd>
            </div>
            <div>
              <dt>Exit Gate Verification Command</dt>
              <dd className="mono omni-raw-payload">{selected.exitGateCommand}</dd>
            </div>
          </dl>
        </div>
      </div>

      <details className="omni-erp-catalog-details">
        <summary>
          Inspect Full 7-Pack Traceability Matrix ({trace.coveredInvariantIds.length}/
          {trace.expectedInvariantCount} Invariants Assigned · 0 Orphans)
        </summary>
        <div className="table-scroll">
          <table
            className="data-table"
            aria-label="Engineering sub-project invariant traceability matrix"
          >
            <thead>
              <tr>
                <th>Pack</th>
                <th>Target Binary</th>
                <th>Phases</th>
                <th>Status</th>
                <th>Assigned Invariants</th>
              </tr>
            </thead>
            <tbody>
              {ENGINEERING_SUBPROJECT_PACKS.map(sp => (
                <tr key={sp.subProjectId}>
                  <td className="mono strong-number">{sp.subProjectId}</td>
                  <td className="mono">{sp.targetBinary}</td>
                  <td className="mono">{sp.phasesUnlocked.join(', ')}</td>
                  <td className="cell-hint">{sp.environmentStatus}</td>
                  <td className="mono">{sp.ownedInvariants.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}
