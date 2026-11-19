import { useState } from 'react'
import {
  ERP_UNIVERSAL_ADAPTERS,
  normalizeErpSampleRecord,
  validateAllErpAdapters,
  type ErpAdapterCode,
} from '../lib/omniBlueprintEngine'

export function ErpUniversalMapperCard() {
  const [selectedErpCode, setSelectedErpCode] = useState<ErpAdapterCode>('ERP-01')
  const [simulateUnmappedCoa, setSimulateUnmappedCoa] = useState(false)

  const validationSummary = validateAllErpAdapters()
  const passedCount = validationSummary.reports.filter(r => r.passed).length
  const selectedSpec =
    ERP_UNIVERSAL_ADAPTERS.find(a => a.code === selectedErpCode) ?? ERP_UNIVERSAL_ADAPTERS[0]
  const normalizedResult = normalizeErpSampleRecord(selectedErpCode, simulateUnmappedCoa)

  return (
    <section
      id="omni-erp-mapper"
      className="panel omni-erp-card"
      aria-labelledby="erp-universal-mapper-heading"
    >
      <div className="panel-head omni-head-split">
        <div>
          <p className="eyebrow">Universal Top-12 ERP Adapter Catalog · I33 · IMP-GL / IMP-SUB</p>
          <h3 id="erp-universal-mapper-heading">
            Universal ERP Normalization Pipeline &amp; SCD2 Canonical CoA Mapper
          </h3>
        </div>
        <div className="omni-badge-row" role="status" aria-live="polite">
          <span className="status-badge ok">
            {passedCount} / {validationSummary.totalAdapters} ERP Dialects Verified
          </span>
          <span className={`status-badge ${simulateUnmappedCoa ? 'error' : 'ok'}`}>
            {normalizedResult.coaStatus}
          </span>
        </div>
      </div>

      <p className="panel-copy">
        Inspect how raw exports across <strong>12 enterprise &amp; mid-market ERPs</strong> (SAP S/4HANA{' '}
        <code>ACDOCA</code>, Oracle Fusion, Dynamics 365, NetSuite, TallyPrime XML/lakh, Odoo, Sage, Workday
        HCM, QuickBooks, Zoho Books UAE FTA, Infor M3, and ISO 21378 / OECD SAF-T) normalize through the{' '}
        <strong>6-stage Go / Rust ingestion pipeline</strong> into signed <code>i128</code> scaled integers (
        <code>10^2</code> fils) with source-scoped <code>IMP-GL</code> vs <code>IMP-SUB</code> routing and
        deterministic unmapped-CoA quarantine.
      </p>

      <div className="omni-erp-controls">
        <div className="omni-pack-tabs" role="tablist" aria-label="Universal ERP adapters">
          {ERP_UNIVERSAL_ADAPTERS.map(adapter => {
            const isSelected = adapter.code === selectedErpCode
            return (
              <button
                key={adapter.code}
                type="button"
                role="tab"
                aria-selected={isSelected}
                className={`omni-pack-tab ${isSelected ? 'active' : ''}`}
                onClick={() => setSelectedErpCode(adapter.code)}
              >
                <span className="omni-pack-code">{adapter.code}</span>
                <span>{adapter.erpName.split(' (')[0]}</span>
              </button>
            )
          })}
        </div>

        <div className="omni-erp-mode-toggle">
          <button
            type="button"
            className={`secondary-button ${!simulateUnmappedCoa ? 'active-mode-btn' : ''}`}
            onClick={() => setSimulateUnmappedCoa(false)}
          >
            Active SCD2 CoA Mapping
          </button>
          <button
            type="button"
            className={`secondary-button ${simulateUnmappedCoa ? 'active-mode-btn' : ''}`}
            onClick={() => setSimulateUnmappedCoa(true)}
          >
            Simulate Unmapped CoA Quarantine
          </button>
        </div>
      </div>

      <div className="omni-erp-inspector-grid">
        <div className="omni-subpanel">
          <div className="omni-subhead">
            <h4>
              {selectedSpec.code} · {selectedSpec.erpName}
            </h4>
            <span className="mono">{selectedSpec.vendorFamily}</span>
          </div>
          <p className="muted-copy">{selectedSpec.quirkHandled}</p>

          <dl className="omni-kv-list">
            <div>
              <dt>Supported Formats</dt>
              <dd className="mono">{selectedSpec.supportedFormats.join(' · ')}</dd>
            </div>
            <div>
              <dt>Primary Export Table / Schema</dt>
              <dd className="mono">{selectedSpec.nativeTables}</dd>
            </div>
            <div>
              <dt>Raw Account &amp; Sign Indicator</dt>
              <dd className="mono">
                {selectedSpec.rawAccountSegment} · {selectedSpec.rawSignIndicator}
              </dd>
            </div>
            <div>
              <dt>Raw Amount &amp; Fiscal Period Token</dt>
              <dd className="mono">
                {selectedSpec.rawAmountString} · {selectedSpec.rawPeriodToken}
              </dd>
            </div>
            <div>
              <dt>Raw Sample ERP Record</dt>
              <dd className="mono omni-raw-payload">{selectedSpec.rawSampleLine}</dd>
            </div>
          </dl>
        </div>

        <div className="omni-subpanel">
          <div className="omni-subhead">
            <h4>Canonical Normalized Ledger Record (Stage 1 → Stage 6)</h4>
            <span className="mono">{normalizedResult.gateRoute}</span>
          </div>

          <dl className="omni-kv-list">
            <div>
              <dt>Canonical Entity / Cost Center</dt>
              <dd className="mono">
                {normalizedResult.canonicalEntity} · {normalizedResult.canonicalCostCenter}
              </dd>
            </div>
            <div>
              <dt>Canonical Account (SCD2 CoA)</dt>
              <dd className="mono">{normalizedResult.canonicalAccountCode}</dd>
            </div>
            <div>
              <dt>Fiscal Period &amp; Gate Policy</dt>
              <dd className="mono">
                {normalizedResult.canonicalPeriod} · {normalizedResult.gateRoute}
              </dd>
            </div>
            <div>
              <dt>Signed BigInt Amount (i128 scaled 10^2)</dt>
              <dd className="mono">
                {normalizedResult.formattedSignedAed} ({normalizedResult.signedAmountFils.toString()}n fils)
              </dd>
            </div>
            <div>
              <dt>SHA-256 Line Manifest Digest</dt>
              <dd className="mono">{normalizedResult.manifestSha256}</dd>
            </div>
            <div>
              <dt>Normalization Verification Note</dt>
              <dd>{normalizedResult.diagnostic}</dd>
            </div>
          </dl>
        </div>
      </div>

      <details className="omni-erp-catalog-details">
        <summary>
          View Complete Top-12 Universal ERP Adapter Matrix ({passedCount}/
          {validationSummary.totalAdapters} passing deterministic BigInt vectors)
        </summary>
        <div className="omni-compact-grid">
          {validationSummary.reports.map(item => (
            <article key={item.code} className="omni-mini-card">
              <div className="omni-subhead">
                <strong>
                  {item.code} · {item.erpName}
                </strong>
                <span className="status-badge ok">
                  {item.normalized.gateRoute.startsWith('IMP-SUB') ? 'IMP-SUB' : 'IMP-GL'}
                </span>
              </div>
              <p className="mono">
                {item.normalized.canonicalEntity} · {item.normalized.canonicalAccountCode}
              </p>
              <p className="mono">{item.normalized.formattedSignedAed}</p>
            </article>
          ))}
        </div>
      </details>
    </section>
  )
}
