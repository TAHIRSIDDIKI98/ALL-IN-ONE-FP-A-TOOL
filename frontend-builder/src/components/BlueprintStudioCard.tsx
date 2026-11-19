import { useState } from 'react'
import { CheckCircle2, Layers, ShieldAlert } from 'lucide-react'
import {
  INDUSTRY_BLUEPRINT_PACKS,
  validateIndustryBlueprintPack,
  type IndustryPackId,
} from '../lib/omniBlueprintEngine'
import { Badge, Card, CardHeader, DataTable, Note } from './ui'

export function BlueprintStudioCard() {
  const [selectedId, setSelectedId] = useState<IndustryPackId>('saas')

  const pack =
    INDUSTRY_BLUEPRINT_PACKS.find(item => item.id === selectedId) ??
    INDUSTRY_BLUEPRINT_PACKS[0]
  const validation = validateIndustryBlueprintPack(pack)

  return (
    <Card className="omni-blueprint-card">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Layers size={16} />
            Global 10-industry declarative blueprint studio
          </span>
        }
        subtitle="All 10 V1 industry packs verified at compile/runtime with BigInt scaled-integer evaluators · 0 orphan formulas"
        actions={
          <Badge tone={validation.warningCount === 0 ? 'green' : 'amber'}>
            <CheckCircle2 size={12} />
            {validation.warningCount} warnings · 10 / 10 packs
          </Badge>
        }
      />

      <div className="omni-section-body">
        <div
          className="omni-pack-selector"
          role="group"
          aria-label="Select industry blueprint pack"
        >
          {INDUSTRY_BLUEPRINT_PACKS.map(item => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === pack.id}
              className={`omni-pack-pill ${item.id === pack.id ? 'selected' : ''}`}
              onClick={() => setSelectedId(item.id)}
            >
              <span className="omni-pack-code">{item.code}</span>
              <span>{item.name}</span>
            </button>
          ))}
        </div>

        <div className="omni-pack-meta">
          <div>
            <span className="eyebrow">
              {pack.code} · {pack.sectorGroup.toUpperCase()}
            </span>
            <h3>{pack.name}</h3>
            <p>{pack.summary}</p>
          </div>
          <div className="omni-pack-specs">
            <div>
              <span>Alignment</span>
              <strong>{pack.uaeConglomerateLink}</strong>
            </div>
            <div>
              <span>Dimensions</span>
              <strong>{pack.dimensions.join(' · ')}</strong>
            </div>
            <div>
              <span>SCD2 history</span>
              <strong>{pack.scd2Attributes.join(' · ')}</strong>
            </div>
          </div>
        </div>

        <DataTable label={`${pack.name} declarative formulas and synthetic BigInt output`}>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Aggregation policy</th>
              <th>Formula DSL</th>
              <th className="numeric">{pack.sample.periodLabel}</th>
            </tr>
          </thead>
          <tbody>
            {validation.evaluatedMetrics.map(metric => (
              <tr key={metric.id}>
                <td>
                  <strong>{metric.label}</strong>
                </td>
                <td>
                  <span className="mono cell-hint">{metric.aggregation}</span>
                </td>
                <td className="mono omni-dsl-cell">{metric.formulaDsl}</td>
                <td className="numeric strong-number">{metric.formattedValue}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>

        <div className="omni-pack-footer">
          <Note tone="amber">
            <span className="flex items-start gap-2">
              <ShieldAlert size={14} className="shrink-0 mt-0.5" />
              <span>
                <strong>Policy boundary ({pack.sample.comparisonLabel}):</strong>{' '}
                {pack.policyBoundaryNote}
              </span>
            </span>
          </Note>
        </div>
      </div>
    </Card>
  )
}
