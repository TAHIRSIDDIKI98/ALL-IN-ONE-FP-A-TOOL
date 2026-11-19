import { useId, useState } from 'react'
import { Cpu, Database, Scale } from 'lucide-react'
import { formatScaled } from '../lib/domainRules'
import {
  allocateLargestRemainder,
  estimateHyperblockFootprint,
  type AllocationTargetInput,
} from '../lib/omniBlueprintEngine'
import { useWorkspace } from '../lib/workspace'
import { Badge, Button, Card, CardHeader, DataTable, DefinitionList, Note, Segmented } from './ui'

const defaultTargets: AllocationTargetInput[] = [
  { id: 'packaging', label: 'Synthetic Packaging', weightRaw: '33.33' },
  { id: 'metals', label: 'Synthetic Metals', weightRaw: '33.33' },
  { id: 'property', label: 'Synthetic Property', weightRaw: '33.33' },
]

export function HyperblockScaleCard() {
  const { preferences } = useWorkspace()
  const poolId = useId()
  const [poolRaw, setPoolRaw] = useState('100.00')
  const [targets, setTargets] = useState<AllocationTargetInput[]>(defaultTargets)
  const [cellsMillions, setCellsMillions] = useState<'10' | '50' | '100' | '220'>('100')
  const [denseShare, setDenseShare] = useState<'20' | '35' | '65' | '85'>('35')

  const alloc = allocateLargestRemainder({ sourcePoolRaw: poolRaw, targets })
  const scaleEst = estimateHyperblockFootprint({
    populatedCellsMillions: Number(cellsMillions),
    denseRatioPct: Number(denseShare),
    workingSetBudgetMb: 2200,
  })

  const updateWeight = (id: string, nextWeight: string) => {
    setTargets(current =>
      current.map(item => (item.id === id ? { ...item, weightRaw: nextWeight } : item))
    )
  }

  return (
    <Card className="omni-scale-card">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Scale size={16} />
            Exact-sum allocation (I05) &amp; 100M+ Hyperblock scale model
          </span>
        }
        subtitle="Largest-Remainder BigInt distributor (zero penny drift) + 4,096-cell adaptive Block-Hybrid memory & mmap spill estimator"
        actions={<Badge tone="blue">Architecture reference · V1 target</Badge>}
      />

      <div className="uae-tax-grid">
        <section className="uae-tax-panel" aria-label="Largest-Remainder exact-sum allocator">
          <div className="uae-panel-top">
            <div>
              <span className="eyebrow">I05 · LARGEST-REMAINDER ALLOCATOR</span>
              <h3>Exact penny-reconciled distribution</h3>
            </div>
            <Badge tone={alloc.status === 'ALLOCATED' ? 'green' : 'amber'}>
              {alloc.status === 'ALLOCATED' ? 'Delta 0.00 AED' : alloc.code}
            </Badge>
          </div>

          <div className="omni-preset-row">
            <Button
              type="button"
              onClick={() => {
                setPoolRaw('100.00')
                setTargets(defaultTargets)
              }}
            >
              Equal 33.33% split
            </Button>
            <Button
              type="button"
              onClick={() => {
                setPoolRaw('1000.00')
                setTargets([
                  { id: 'packaging', label: 'Synthetic Packaging', weightRaw: '0' },
                  { id: 'metals', label: 'Synthetic Metals', weightRaw: '0' },
                  { id: 'property', label: 'Synthetic Property', weightRaw: '0' },
                ])
              }}
            >
              Zero base test
            </Button>
            <Button
              type="button"
              onClick={() => {
                setPoolRaw('1000.00')
                setTargets([
                  { id: 'packaging', label: 'Synthetic Packaging', weightRaw: '70' },
                  { id: 'metals', label: 'Synthetic Metals', weightRaw: '-15' },
                  { id: 'property', label: 'Synthetic Property', weightRaw: '45' },
                ])
              }}
            >
              Negative weight test
            </Button>
          </div>

          <div className="omni-alloc-inputs">
            <label className="field" htmlFor={poolId}>
              <span>Allocation pool · AED</span>
              <input
                id={poolId}
                type="text"
                inputMode="decimal"
                value={poolRaw}
                onChange={e => setPoolRaw(e.target.value)}
                aria-invalid={alloc.status === 'ERROR' && alloc.code === 'INVALID_POOL'}
              />
            </label>
            <div className="omni-weight-grid">
              {targets.map(t => (
                <label className="field" key={t.id}>
                  <span>{t.label.replace('Synthetic ', '')} weight</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={t.weightRaw}
                    onChange={e => updateWeight(t.id, e.target.value)}
                  />
                </label>
              ))}
            </div>
          </div>

          {alloc.status === 'ERROR' ? (
            <div className="omni-error-box" role="alert">
              <strong>Blocked ({alloc.code}):</strong> {alloc.message}
            </div>
          ) : (
            <>
              <DataTable label="Largest-remainder allocation breakdown">
                <thead>
                  <tr>
                    <th>Entity</th>
                    <th className="numeric">Weight</th>
                    <th className="numeric">Penny +0.01</th>
                    <th className="numeric">Final AED</th>
                  </tr>
                </thead>
                <tbody>
                  {alloc.rows.map(row => (
                    <tr key={row.id}>
                      <td>{row.label}</td>
                      <td className="numeric">{formatScaled(row.weightScaled, 2, false)}</td>
                      <td className="numeric">
                        {row.pennyAdjustedFils === 0n
                          ? '0.00'
                          : `+${formatScaled(row.pennyAdjustedFils, 2, false)}`}
                      </td>
                      <td className="numeric strong-number">
                        {formatScaled(row.finalAllocatedFils, 2, preferences.grouping)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>Total reconciled ({alloc.pennyUnitsDistributed.toString()} penny adj.)</th>
                    <td className="numeric" />
                    <td className="numeric">
                      Delta {formatScaled(alloc.reconciliationDeltaFils, 2, false)}
                    </td>
                    <td className="numeric">
                      {formatScaled(alloc.sumAllocatedFils, 2, preferences.grouping)}
                    </td>
                  </tr>
                </tfoot>
              </DataTable>
            </>
          )}
        </section>

        <section className="uae-tax-panel" aria-label="100M+ cell Hyperblock memory model">
          <div className="uae-panel-top">
            <div>
              <span className="eyebrow">SCALE MODEL · 4,096 CELLS/BLOCK</span>
              <h3>Adaptive Block-Hybrid RAM &amp; Spill</h3>
            </div>
            <Badge tone={scaleEst.spillRequired ? 'amber' : 'green'}>
              {scaleEst.spillRequired ? 'Encrypted mmap spill' : 'In-RAM working set'}
            </Badge>
          </div>

          <div className="uae-controls-stack">
            <div className="field">
              <span>Populated cube scale</span>
              <Segmented
                small
                label="Populated cell count in millions"
                value={cellsMillions}
                onChange={setCellsMillions}
                options={[
                  { value: '10', label: '10M' },
                  { value: '50', label: '50M' },
                  { value: '100', label: '100M' },
                  { value: '220', label: '220M' },
                ]}
              />
            </div>

            <div className="field">
              <span>Dense block concentration (remaining auto-tiered)</span>
              <Segmented
                small
                label="Dense block ratio"
                value={denseShare}
                onChange={setDenseShare}
                options={[
                  { value: '20', label: '20% dense' },
                  { value: '35', label: '35% baseline' },
                  { value: '65', label: '65% heavy' },
                  { value: '85', label: '85% extreme' },
                ]}
              />
            </div>
          </div>

          <DefinitionList
            items={[
              { label: 'Active 4K blocks', value: scaleEst.blockCountActive.toLocaleString('en-GB') },
              { label: 'Payload + CSR DAG RAM', value: `${scaleEst.totalFootprintMb.toLocaleString('en-GB')} MB` },
              { label: 'Target RAM ceiling', value: `${scaleEst.workingSetBudgetMb.toLocaleString('en-GB')} MB` },
              {
                label: 'Cold spill volume',
                value: scaleEst.spillRequired
                  ? `${scaleEst.spilledColdMb.toLocaleString('en-GB')} MB (${scaleEst.encryptedSpillCipher})`
                  : '0 MB (fits cleanly in RAM)',
              },
            ]}
          />

          <div className="omni-block-bars" aria-label="Block variant distribution">
            {scaleEst.blockBreakdown.map(b => (
              <div key={b.variant} className="omni-block-row">
                <span>
                  <Cpu size={12} />
                  <strong>{b.variant}</strong> ({b.sharePct}%)
                </span>
                <span>{b.blocks.toLocaleString('en-GB')} blks · {b.ramMb} MB</span>
              </div>
            ))}
          </div>

          <Note>
            <span className="flex items-start gap-2">
              <Database size={14} className="shrink-0 mt-0.5" />
              <span>
                Analytical projection for the planned Rust Hyperblock store; native memory benchmarks await Windows x64 compilation.
              </span>
            </span>
          </Note>
        </section>
      </div>
    </Card>
  )
}
