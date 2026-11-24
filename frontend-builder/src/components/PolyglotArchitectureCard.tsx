import { useState } from 'react'
import { CheckCircle2, Cpu, Download, Play, ShieldCheck, Workflow } from 'lucide-react'
import {
  LANGUAGE_RUNTIME_CONTRACTS,
  generateGoldenContractBundle,
  runAllInvariantsSuite,
  type RuntimeId,
} from '../lib/omniBlueprintEngine'
import { Badge, Button, Card, CardHeader, DataTable, Note, Segmented, Toggle } from './ui'

export function PolyglotArchitectureCard() {
  const [fallbacks, setFallbacks] = useState<RuntimeId[]>([])
  const [tierFilter, setTierFilter] = useState<'all' | 't1' | 't2' | 't3' | 't4'>('all')
  const [lastRunStamp, setLastRunStamp] = useState<string>('Initial check')
  const [exportStatus, setExportStatus] = useState<string>('')

  const toggleFallback = (id: RuntimeId) => {
    setFallbacks(current =>
      current.includes(id) ? current.filter(item => item !== id) : [...current, id]
    )
  }

  const downloadParityBundle = () => {
    const bundle = generateGoldenContractBundle()
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'atlas-fpa-v4.0-parity-vectors.json'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setExportStatus(
      `Exported v4.0 parity JSON (${bundle.summary.packsValidated} packs · ${bundle.summary.erpAdaptersValidated} ERPs · ${bundle.summary.fpaProjectWorkspacesCount} FP&A projects · ${bundle.summary.engineeringSubProjectsCount} sub-projects · ${bundle.summary.invariantsPassed}/${bundle.summary.invariantsTotal} invariants)`
    )
  }

  const suite = runAllInvariantsSuite(fallbacks)

  const filteredResults = suite.results.filter(item => {
    if (tierFilter === 't1') return item.tier.startsWith('Numeric')
    if (tierFilter === 't2') return item.tier.startsWith('Consolidation')
    if (tierFilter === 't3') return item.tier.startsWith('Security')
    if (tierFilter === 't4') return item.tier.startsWith('Per-Project')
    return true
  })

  return (
    <Card className="omni-polyglot-card">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Workflow size={16} />
            5-language Windows 11 contract &amp; 40-invariant oracle (I01–I40)
          </span>
        }
        subtitle="Contract-bounded Rust / TypeScript / Go / Elixir / Java 25 jlink architecture with live Rust fallback toggles · Compiled EXEs not built in Linux UI preview"
        actions={
          <Badge tone={suite.failedCount === 0 ? 'green' : 'amber'}>
            {suite.passedCount} / {suite.total} invariants passing
          </Badge>
        }
      />

      <div className="omni-section-body">
        <div className="omni-contracts-grid">
          <div className="omni-runtime-list" aria-label="Five-language process contracts">
            <div className="omni-subhead">
              <span className="eyebrow">WINDOWS 11 TARGET TOPOLOGY &amp; RUST FALLBACKS</span>
              <Badge tone={fallbacks.length === 0 ? 'blue' : 'amber'}>
                {fallbacks.length === 0 ? 'Full 5-runtime mode' : `${fallbacks.length} fallback(s) active`}
              </Badge>
            </div>
            {LANGUAGE_RUNTIME_CONTRACTS.map(contract => {
              const fallbackActive = fallbacks.includes(contract.id)
              return (
                <div key={contract.id} className="omni-runtime-item">
                  <div className="omni-runtime-head">
                    <div>
                      <strong>
                        <Cpu size={13} />
                        {contract.language} · <span className="mono">{contract.binaryName}</span>
                      </strong>
                      <p>{contract.authorityRole}</p>
                      <small className="cell-hint">IPC: {contract.ipcTransport}</small>
                    </div>
                    {contract.canDisablePrimary ? (
                      <div className="omni-runtime-toggle">
                        <Toggle
                          label={`Route ${contract.language} to Rust fallback`}
                          description={
                            fallbackActive
                              ? `Active: ${contract.fallbackTarget}`
                              : contract.constraintNote
                          }
                          checked={fallbackActive}
                          onChange={() => toggleFallback(contract.id)}
                        />
                      </div>
                    ) : (
                      <Badge tone="neutral">{contract.fallbackTarget}</Badge>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="omni-invariants-header">
          <div>
            <span className="eyebrow">BLOCKING VERIFICATION ORACLE · {lastRunStamp.toUpperCase()}</span>
            <h3>Live 40-invariant check matrix</h3>
          </div>
          <div className="omni-invariants-actions">
            <Segmented
              small
              label="Filter invariant tier"
              value={tierFilter}
              onChange={setTierFilter}
              options={[
                { value: 'all', label: `All (${suite.total})` },
                { value: 't1', label: 'Core & FP&A' },
                { value: 't2', label: 'Cons, ERP & IO' },
                { value: 't4', label: 'Per-Project' },
                { value: 't3', label: 'Scale, Sec & Roadmap' },
              ]}
            />
            <Button type="button" onClick={downloadParityBundle}>
              <Download size={13} />
              Export parity JSON
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() =>
                setLastRunStamp(
                  `Verified @ ${new Date().toLocaleTimeString('en-GB', { hour12: false })}`
                )
              }
            >
              <Play size={13} />
              Re-run 40 invariants
            </Button>
          </div>
        </div>
        {exportStatus && (
          <div className="cell-hint" role="status">
            {exportStatus}
          </div>
        )}

        <DataTable label="40 blocking invariants live execution matrix">
          <thead>
            <tr>
              <th>ID</th>
              <th>Invariant rule</th>
              <th>Check mode</th>
              <th>Status</th>
              <th>Deterministic evidence</th>
            </tr>
          </thead>
          <tbody>
            {filteredResults.map(item => (
              <tr key={item.id}>
                <td className="mono strong-number">{item.id}</td>
                <td>{item.title}</td>
                <td>
                  <Badge tone={item.mechanism === 'LIVE_ORACLE' ? 'blue' : 'neutral'}>
                    {item.mechanism === 'LIVE_ORACLE' ? 'Live BigInt' : 'Contract gate'}
                  </Badge>
                </td>
                <td>
                  <span className="inline-flex items-center gap-1 positive">
                    <CheckCircle2 size={13} />
                    {item.passed ? 'Pass' : 'Fail'}
                  </span>
                </td>
                <td className="cell-hint">{item.evidence}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>

        <Note>
          <span className="flex items-start gap-2">
            <ShieldCheck size={14} className="shrink-0 mt-0.5" />
            <span>
              <strong>Honest sandbox boundary:</strong> Live BigInt checks (I01–I28, I30–I31, I33–I40) execute directly inside this pure TypeScript oracle. Native Windows 11 builds (`fpa-core.exe`, `fpa-io.exe`, `fpa-flow`, `fpa-docs.exe`, `fpa-xll.xll`) and SQLCipher / Office 2021 host tests are contract-specified here and remain unbuilt in Linux preview.
            </span>
          </span>
        </Note>
      </div>
    </Card>
  )
}
