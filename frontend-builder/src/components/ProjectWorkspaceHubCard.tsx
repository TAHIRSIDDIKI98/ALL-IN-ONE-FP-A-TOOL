import { useState } from 'react'
import { formatScaled } from '../lib/domainRules'
import {
  FPA_PROJECT_WORKSPACES,
  consolidateProjectPortfolio,
  evaluateFpaProjectWorkspace,
  validateProjectCoaBoundary,
  type FpaProjectId,
} from '../lib/omniBlueprintEngine'

function fmtCur(fils: bigint, currency: string): string {
  return `${formatScaled(fils, 2, true)} ${currency}`
}

export function ProjectWorkspaceHubCard() {
  const [selectedProjectId, setSelectedProjectId] = useState<FpaProjectId>('PRJ-02')
  const [simulateCoaBreach, setSimulateCoaBreach] = useState(false)
  const [simulateMissingEurFx, setSimulateMissingEurFx] = useState(false)

  const projectSpec =
    FPA_PROJECT_WORKSPACES.find(p => p.projectId === selectedProjectId) ??
    FPA_PROJECT_WORKSPACES[0]
  const evalResult = evaluateFpaProjectWorkspace(selectedProjectId)

  const isolationCheck = validateProjectCoaBoundary(
    simulateCoaBreach
      ? {
          targetProjectId: selectedProjectId,
          postingProjectId: selectedProjectId === 'PRJ-01' ? 'PRJ-02' : 'PRJ-01',
          coaNamespace:
            selectedProjectId === 'PRJ-01' ? 'COA-DEV-POC' : 'COA-HOLDING-IFRS',
          nativeAccountCode:
            selectedProjectId === 'PRJ-01' ? '02-DEV-4100' : '0000410000',
        }
      : {
          targetProjectId: selectedProjectId,
          postingProjectId: selectedProjectId,
          coaNamespace: projectSpec.coaNamespace,
          nativeAccountCode: projectSpec.isolatedCoa[0]?.nativeCode ?? '',
        }
  )

  const portfolio = consolidateProjectPortfolio({
    baseCurrency: 'USD',
    simulateMissingEurRate: simulateMissingEurFx,
  })

  return (
    <section
      id="omni-project-workspaces"
      className="panel omni-project-hub-card"
      aria-labelledby="project-workspaces-heading"
    >
      <div className="panel-head omni-head-split">
        <div>
          <p className="eyebrow">
            MULTI-PROJECT FP&amp;A WORKSPACES · I37–I39 · SEALED COA, WBS/POC &amp; PROJECT P&amp;L
          </p>
          <h3 id="project-workspaces-heading">
            Per-Project Workspaces, Isolated Chart of Accounts &amp; Project P&amp;L Hub
          </h3>
        </div>
        <div className="omni-inline-meta mono">
          {FPA_PROJECT_WORKSPACES.length} Sealed Projects · {evalResult.currency} Native · Delta{' '}
          {formatScaled(evalResult.wbsReconciliationDeltaFils, 2, true)}
        </div>
      </div>

      <p className="panel-copy">
        Switch across isolated FP&amp;A client or deal workspaces. Each project seals its own
        Chart of Accounts namespace (<strong>I37</strong>), ERP source adapter, WBS milestone
        schedule, and exact <strong>BigInt</strong> PoC/EAC Project P&amp;L (<strong>I39</strong>),
        while enforcing explicit FX-rate presence before group consolidation (<strong>I38</strong>).
      </p>

      <div
        className="omni-pack-tabs"
        role="tablist"
        aria-label="Isolated FP&A Project Workspaces"
      >
        {FPA_PROJECT_WORKSPACES.map(project => {
          const active = project.projectId === selectedProjectId
          return (
            <button
              key={project.projectId}
              type="button"
              role="tab"
              aria-selected={active}
              className={`omni-pack-tab ${active ? 'active' : ''}`}
              onClick={() => setSelectedProjectId(project.projectId)}
            >
              <span className="omni-pack-code">{project.projectId}</span>
              <span>
                {project.projectName} · {project.currency}
              </span>
            </button>
          )
        })}
      </div>

      <div className="omni-project-meta-strip">
        <span>{projectSpec.projectId}</span>
        <span aria-hidden="true">·</span>
        <span>{projectSpec.industryModel}</span>
        <span aria-hidden="true">·</span>
        <span>ERP: {projectSpec.erpProfileLabel}</span>
        <span aria-hidden="true">·</span>
        <span className="mono">{projectSpec.coaNamespace}</span>
        <span aria-hidden="true">·</span>
        <span>{projectSpec.perimeterLabel}</span>
      </div>

      <div className="omni-project-kpi-strip">
        <div>
          <span>Contract / Plan Value</span>
          <strong className="mono tabular-nums">
            {fmtCur(evalResult.contractValueFils, evalResult.currency)}
          </strong>
        </div>
        <div>
          <span>Actual Cost to Date</span>
          <strong className="mono tabular-nums">
            {fmtCur(evalResult.actualCostFils, evalResult.currency)}
          </strong>
        </div>
        <div>
          <span>EAC Cost (Actual + ETC)</span>
          <strong className="mono tabular-nums">
            {fmtCur(evalResult.eacCostFils, evalResult.currency)}
          </strong>
        </div>
        <div>
          <span>PoC Completion (BigInt)</span>
          <strong className="mono tabular-nums">
            {formatScaled(evalResult.pocPctTenths, 1, false)}%
          </strong>
        </div>
        <div>
          <span>Earned Project Revenue</span>
          <strong className="mono tabular-nums">
            {fmtCur(evalResult.earnedRevenueFils, evalResult.currency)}
          </strong>
        </div>
        <div>
          <span>Recognized Gross Profit</span>
          <strong className="mono tabular-nums positive">
            {fmtCur(evalResult.recognizedGrossProfitFils, evalResult.currency)}
          </strong>
        </div>
      </div>

      <div className="omni-erp-inspector-grid">
        <div className="omni-subpanel">
          <div className="omni-subhead">
            <h4>Isolated Chart of Accounts &amp; Firewall (I37)</h4>
            <button
              type="button"
              className={`secondary-button ${simulateCoaBreach ? 'active-mode-btn' : ''}`}
              aria-pressed={simulateCoaBreach}
              onClick={() => setSimulateCoaBreach(prev => !prev)}
            >
              {simulateCoaBreach
                ? 'Reset to Valid Project Mapping'
                : 'Simulate Cross-Project CoA Leak'}
            </button>
          </div>

          <div
            className={
              isolationCheck.status === 'ISOLATION_OK' ? 'omni-ok-box' : 'omni-error-box'
            }
            role="status"
          >
            <strong>{isolationCheck.status}</strong> — {isolationCheck.diagnostic}
          </div>

          <div className="table-scroll">
            <table
              className="data-table"
              aria-label={`${projectSpec.projectName} isolated Chart of Accounts`}
            >
              <thead>
                <tr>
                  <th>Native Code</th>
                  <th>Account Description</th>
                  <th>Canonical Map</th>
                  <th>Class</th>
                </tr>
              </thead>
              <tbody>
                {projectSpec.isolatedCoa.map(acc => (
                  <tr key={acc.nativeCode}>
                    <td className="mono">{acc.nativeCode}</td>
                    <td>{acc.nativeName}</td>
                    <td className="mono">{acc.canonicalGroupCode}</td>
                    <td className="cell-hint">{acc.statementClass}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="omni-subpanel">
          <div className="omni-subhead">
            <h4>WBS Cost Schedule &amp; Project P&amp;L Tie-Out (I39)</h4>
            <span className="mono cell-hint">
              WBS Delta: {fmtCur(evalResult.wbsReconciliationDeltaFils, evalResult.currency)}
            </span>
          </div>

          <div className="table-scroll">
            <table
              className="data-table"
              aria-label={`${projectSpec.projectName} WBS milestone schedule`}
            >
              <thead>
                <tr>
                  <th>WBS</th>
                  <th>Workstream</th>
                  <th className="numeric">Actual</th>
                  <th className="numeric">ETC</th>
                  <th className="numeric">EAC</th>
                </tr>
              </thead>
              <tbody>
                {projectSpec.wbsItems.map(wbs => {
                  const rowEac = wbs.actualCostFils + wbs.etcCostFils
                  return (
                    <tr key={wbs.wbsCode}>
                      <td className="mono">{wbs.wbsCode}</td>
                      <td>{wbs.title}</td>
                      <td className="numeric mono tabular-nums">
                        {formatScaled(wbs.actualCostFils, 2, true)}
                      </td>
                      <td className="numeric mono tabular-nums">
                        {formatScaled(wbs.etcCostFils, 2, true)}
                      </td>
                      <td className="numeric mono tabular-nums strong-number">
                        {formatScaled(rowEac, 2, true)}
                      </td>
                    </tr>
                  )
                })}
                <tr className="statement-total">
                  <th colSpan={2}>Total Project Cost ({evalResult.currency})</th>
                  <td className="numeric mono tabular-nums">
                    {formatScaled(evalResult.actualCostFils, 2, true)}
                  </td>
                  <td className="numeric mono tabular-nums">
                    {formatScaled(evalResult.etcCostFils, 2, true)}
                  </td>
                  <td className="numeric mono tabular-nums">
                    {formatScaled(evalResult.eacCostFils, 2, true)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="omni-subpanel">
        <div className="omni-subhead">
          <div>
            <h4>Cross-Project Portfolio Consolidation Guard (USD Reporting Boundary · I38)</h4>
            <p className="muted-copy">
              Included: {portfolio.includedCount} / {FPA_PROJECT_WORKSPACES.length} projects ·{' '}
              Consolidated Earned Revenue:{' '}
              <strong className="mono tabular-nums">
                {fmtCur(portfolio.totalEarnedRevenueUsdFils, 'USD')}
              </strong>{' '}
              · Gross Profit:{' '}
              <strong className="mono tabular-nums">
                {fmtCur(portfolio.totalGrossProfitUsdFils, 'USD')}
              </strong>
            </p>
          </div>
          <button
            type="button"
            className={`secondary-button ${simulateMissingEurFx ? 'active-mode-btn' : ''}`}
            aria-pressed={simulateMissingEurFx}
            onClick={() => setSimulateMissingEurFx(prev => !prev)}
          >
            {simulateMissingEurFx
              ? 'Restore Valid EUR->USD Rate'
              : 'Simulate Missing EUR->USD FX Rate'}
          </button>
        </div>

        {portfolio.status === 'PARTIAL_EXCLUDED_MISSING_FX' && (
          <div className="omni-error-box" role="alert">
            <strong>PARTIAL_EXCLUDED_MISSING_FX (I38):</strong> Quarantined{' '}
            {portfolio.quarantinedProjectIds.join(', ')} because EUR-&gt;USD rate is Not provided.
            Missing rates never coerce to 0 or 1:1.
          </div>
        )}

        <div className="table-scroll">
          <table className="data-table" aria-label="Cross-project USD consolidation summary">
            <thead>
              <tr>
                <th>Project</th>
                <th>Native CCY</th>
                <th className="numeric">FX -&gt; USD (10^4)</th>
                <th>Boundary State</th>
                <th className="numeric">Earned Revenue (USD)</th>
                <th className="numeric">Gross Profit (USD)</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.rows.map(row => (
                <tr key={row.projectId}>
                  <td>
                    <span className="mono">{row.projectId}</span> · {row.projectName}
                  </td>
                  <td className="mono">{row.nativeCurrency}</td>
                  <td className="numeric mono tabular-nums">
                    {row.fxRateScaled4 !== null ? (
                      formatScaled(row.fxRateScaled4, 4, false)
                    ) : (
                      <span className="missing-cell">Not provided</span>
                    )}
                  </td>
                  <td>
                    {row.included ? (
                      <span className="positive">Included</span>
                    ) : (
                      <span className="adverse">Quarantined (Missing FX)</span>
                    )}
                  </td>
                  <td className="numeric mono tabular-nums">
                    {row.earnedRevenueUsdFils !== null ? (
                      formatScaled(row.earnedRevenueUsdFils, 2, true)
                    ) : (
                      <span className="missing-cell">Quarantined</span>
                    )}
                  </td>
                  <td className="numeric mono tabular-nums">
                    {row.grossProfitUsdFils !== null ? (
                      formatScaled(row.grossProfitUsdFils, 2, true)
                    ) : (
                      <span className="missing-cell">Quarantined</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
