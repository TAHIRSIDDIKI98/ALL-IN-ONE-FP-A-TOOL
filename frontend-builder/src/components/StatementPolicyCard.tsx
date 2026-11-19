import { useState } from 'react'
import { GitBranch, Layers, ShieldAlert } from 'lucide-react'
import { formatScaled } from '../lib/domainRules'
import {
  evaluateStatementPolicyMatrix,
  topologicalSortFormulaDag,
} from '../lib/omniBlueprintEngine'
import { useWorkspace } from '../lib/workspace'
import { Badge, Card, CardHeader, DefinitionList, Note, Segmented } from './ui'

type PolicyFocus = 'FLOW_SUM' | 'STOCK_CLOSING_LAST' | 'RATIO_OF_SUMS'
type DagMode = 'ACYCLIC_VALID' | 'CYCLIC_INJECTED'

export function StatementPolicyCard() {
  const { preferences } = useWorkspace()
  const [policyFocus, setPolicyFocus] = useState<PolicyFocus>('STOCK_CLOSING_LAST')
  const [dagMode, setDagMode] = useState<DagMode>('ACYCLIC_VALID')

  const matrix = evaluateStatementPolicyMatrix()
  const dagResult =
    dagMode === 'ACYCLIC_VALID'
      ? topologicalSortFormulaDag([
          { id: 'revenue_flow', deps: [] },
          { id: 'expenses_flow', deps: [] },
          { id: 'operating_result', deps: ['revenue_flow', 'expenses_flow'] },
          { id: 'operating_margin_pct', deps: ['operating_result', 'revenue_flow'] },
        ])
      : topologicalSortFormulaDag([
          { id: 'revenue_flow', deps: [] },
          { id: 'loop_a', deps: ['loop_b'] },
          { id: 'loop_b', deps: ['loop_a'] },
        ])

  return (
    <Card className="omni-stmt-policy-card">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Layers size={16} />
            Multi-period aggregation policy &amp; acyclic DAG guard (I08, I09, I27)
          </span>
        }
        subtitle="Proves Q1 2026 flow summing vs. closing-stock preservation, RATIO_OF_SUMS weighted margins, and circular formula blocking"
        actions={<Badge tone="blue">Live BigInt reference oracle</Badge>}
      />

      <div className="uae-tax-grid">
        <section className="uae-tax-panel" aria-label="Multi-period aggregation policy matrix">
          <div className="uae-panel-top">
            <div>
              <span className="eyebrow">I08 &amp; I09 · Q1 2026 TIME ROLLUP POLICY</span>
              <h3>Flow vs. Stock vs. Weighted Ratio</h3>
            </div>
            <Badge tone="green">Policy enforced</Badge>
          </div>

          <Segmented
            small
            label="Aggregation policy focus"
            value={policyFocus}
            onChange={setPolicyFocus}
            options={[
              { value: 'FLOW_SUM', label: 'FLOW_SUM (Rev)' },
              { value: 'STOCK_CLOSING_LAST', label: 'CLOSING_LAST (ARR)' },
              { value: 'RATIO_OF_SUMS', label: 'RATIO_OF_SUMS (Margin)' },
            ]}
          />

          {policyFocus === 'FLOW_SUM' ? (
            <DefinitionList
              items={[
                { label: 'Monthly Rev (Jan / Feb / Mar)', value: '3,140 / 3,200 / 3,320 AED k' },
                {
                  label: 'Q1 Valid FLOW_SUM Total',
                  value: `${formatScaled(matrix.quarterFlowRevenueThousands, 0, preferences.grouping)} AED k`,
                },
                {
                  label: 'Q1 Valid OpEx FLOW_SUM',
                  value: `${formatScaled(matrix.quarterFlowExpensesThousands, 0, preferences.grouping)} AED k`,
                },
              ]}
            />
          ) : policyFocus === 'STOCK_CLOSING_LAST' ? (
            <DefinitionList
              items={[
                { label: 'Monthly ARR (Jan / Feb / Mar)', value: '11,000 / 11,900 / 12,450 AED k' },
                {
                  label: 'Q1 Valid STOCK_CLOSING_LAST',
                  value: `${formatScaled(matrix.quarterClosingArrFils, 2, preferences.grouping)} AED k`,
                },
                {
                  label: 'Blocked naive stock sum (I08)',
                  value: `${formatScaled(matrix.naiveBrokenStockSumArrFils, 2, preferences.grouping)} AED k (rejected)`,
                },
              ]}
            />
          ) : (
            <DefinitionList
              items={[
                {
                  label: 'Q1 Numerator / Denominator',
                  value: `${formatScaled(matrix.quarterFlowOperatingResultThousands, 0, preferences.grouping)} / ${formatScaled(matrix.quarterFlowRevenueThousands, 0, preferences.grouping)} AED k`,
                },
                {
                  label: 'Valid RATIO_OF_SUMS Margin',
                  value: `${formatScaled(matrix.quarterOperatingMarginPctTenths, 1, false)} %`,
                },
                {
                  label: 'Rejected naive monthly avg (I09)',
                  value: `${formatScaled(matrix.naiveBrokenAverageMarginPctTenths, 1, false)} % (unweighted distortion)`,
                },
              ]}
            />
          )}

          <Note>
            <span>
              {policyFocus === 'FLOW_SUM'
                ? 'P&L revenues and expenses aggregate strictly across open periods using scaled BigInt sums.'
                : policyFocus === 'STOCK_CLOSING_LAST'
                  ? 'Point-in-time stock accounts (Closing ARR, Headcount, Balance Sheet) never sum across Jan+Feb+Mar.'
                  : 'Percentages and occupancy aggregate SUM(numerator) / SUM(denominator), never unweighted monthly averages.'}
            </span>
          </Note>
        </section>

        <section className="uae-tax-panel" aria-label="Acyclic formula DAG verification">
          <div className="uae-panel-top">
            <div>
              <span className="eyebrow">I27 · CALCULATION DAG TOPOLOGICAL SOLVER</span>
              <h3>Dependency Order &amp; Cycle Block</h3>
            </div>
            <Badge tone={dagResult.status === 'ACYCLIC_OK' ? 'green' : 'amber'}>
              {dagResult.status}
            </Badge>
          </div>

          <Segmented
            small
            label="Calculation DAG test scenario"
            value={dagMode}
            onChange={setDagMode}
            options={[
              { value: 'ACYCLIC_VALID', label: 'Valid Q1 DAG (4 nodes)' },
              { value: 'CYCLIC_INJECTED', label: 'Inject cycle (A ↔ B)' },
            ]}
          />

          {dagResult.status === 'ACYCLIC_OK' ? (
            <div className="omni-dag-steps">
              <div className="omni-subhead">
                <span className="eyebrow">RESOLVED DETERMINISTIC EVALUATION ORDER</span>
                <span className="cell-hint">{dagResult.order.length} nodes</span>
              </div>
              <ol className="omni-dag-list">
                {dagResult.order.map((nodeId, idx) => (
                  <li key={nodeId} className="mono">
                    <GitBranch size={12} />
                    <span>
                      {idx + 1}. {nodeId}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <div className="omni-error-box" role="alert">
              <span className="inline-flex items-center gap-1.5">
                <ShieldAlert size={14} />
                <strong>{dagResult.status}:</strong>
              </span>{' '}
              {dagResult.message}
            </div>
          )}

          <Note>
            <span>
              Kahn&apos;s deterministic lexicographic topological sort guarantees identical multi-thread evaluation order across TS oracle and planned Rust Rayon DAG engine.
            </span>
          </Note>
        </section>
      </div>
    </Card>
  )
}
