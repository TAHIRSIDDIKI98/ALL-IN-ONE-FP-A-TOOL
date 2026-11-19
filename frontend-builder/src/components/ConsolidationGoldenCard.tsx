import { useId, useState } from 'react'
import { AlertOctagon, CheckCircle2, GitMerge, ShieldAlert } from 'lucide-react'
import { computeConsolidationWalkthrough } from '../lib/domainRules'
import { Badge, Card, CardHeader, DefinitionList, Note, Segmented } from './ui'

export function ConsolidationGoldenCard() {
  const ownershipId = useId()
  const [icCase, setIcCase] = useState<'matched' | 'mismatched'>('matched')
  const [hasOwnership, setHasOwnership] = useState(true)

  const result = computeConsolidationWalkthrough({
    parentIcReceivable: icCase === 'matched' ? 10n : 11n,
    hasOwnershipEvidence: hasOwnership,
  })

  return (
    <Card className="golden-walkthrough-card">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <GitMerge size={16} />
            Golden consolidation case simulator (Docs/19 &amp; T-AG-01)
          </span>
        }
        subtitle="Illustrative manual specification walkthrough · 80% Parent / 20% NCI · Not an approved policy or group report"
        actions={
          <Badge tone={result.status === 'ILLUSTRATIVE_BALANCED' ? 'blue' : 'amber'}>
            {result.status === 'ILLUSTRATIVE_BALANCED' ? 'Draft spec · Balanced' : 'Blocked · Exception'}
          </Badge>
        }
      />

      <div className="workflow-body">
        <div className="golden-controls-row">
          <Segmented
            small
            label="Intercompany test case"
            value={icCase}
            onChange={setIcCase}
            options={[
              { value: 'matched', label: 'Matched IC (10 vs 10)' },
              { value: 'mismatched', label: 'Unmatched IC (11 vs 10)' },
            ]}
          />
          <label className="uae-checkbox" htmlFor={ownershipId}>
            <input
              id={ownershipId}
              type="checkbox"
              checked={hasOwnership}
              onChange={e => setHasOwnership(e.target.checked)}
            />
            <span>Ownership &amp; control register verified (80% / 20% NCI)</span>
          </label>
        </div>

        <div className="golden-panels-grid">
          <div className="golden-panel">
            <span className="eyebrow">STANDALONE · PARENT (AED)</span>
            <DefinitionList
              items={[
                { label: 'Cash', value: result.parent.cash.toString() },
                { label: 'Intercompany receivable', value: result.parent.icReceivable.toString() },
                { label: 'Investment in subsidiary (80%)', value: result.parent.investmentInSub.toString() },
                { label: 'Total assets / Equity', value: `${result.parent.totalAssets.toString()} / ${result.parent.equity.toString()}` },
              ]}
            />
          </div>

          <div className="golden-panel">
            <span className="eyebrow">STANDALONE · SUBSIDIARY (AED)</span>
            <DefinitionList
              items={[
                { label: 'Cash', value: result.subsidiary.cash.toString() },
                { label: 'Intercompany payable', value: result.subsidiary.icPayable.toString() },
                { label: 'Share capital / equity', value: result.subsidiary.equity.toString() },
                { label: 'Assets / Liab. + Equity', value: `${result.subsidiary.totalAssets.toString()} / ${result.subsidiary.totalLiabilitiesAndEquity.toString()}` },
              ]}
            />
          </div>

          <div className={`golden-panel ${result.status === 'BLOCKED' ? 'golden-panel-blocked' : 'golden-panel-balanced'}`}>
            <span className="eyebrow">CONSOLIDATED SPEC OUTCOME (AED)</span>
            {result.status === 'ILLUSTRATIVE_BALANCED' && result.consolidated ? (
              <>
                <DefinitionList
                  items={[
                    { label: 'Consolidated cash & assets', value: result.consolidated.cashAndAssets.toString() },
                    { label: 'Consolidated liabilities', value: result.consolidated.liabilities.toString() },
                    { label: 'Parent equity', value: result.consolidated.parentEquity.toString() },
                    { label: 'Non-controlling interest (20%)', value: result.consolidated.nciEquity.toString() },
                    { label: 'Total consolidated equity', value: result.consolidated.totalEquity.toString() },
                  ]}
                />
                <ul className="golden-eliminations">
                  {result.eliminations.map(entry => (
                    <li key={entry.label}>
                      <CheckCircle2 size={13} />
                      <span>
                        <strong>{entry.label}:</strong> Dr {entry.debit}; Cr {entry.credit}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="golden-blocker-box" role="status">
                <AlertOctagon size={18} />
                <div>
                  <strong>
                    {result.blockerCode === 'MISSING_OWNERSHIP_EVIDENCE'
                      ? 'Consolidation blocked · Missing ownership evidence (CONS-001)'
                      : 'Consolidation blocked · Unmatched intercompany (CONS-004)'}
                  </strong>
                  <p>{result.blockerMessage}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="golden-dividend-strip">
          <ShieldAlert size={16} />
          <div>
            <strong>T-AG-01 Investment Dividend Boundary:</strong> Operating units sum to{' '}
            <span>{result.dividendBoundary.operatingUnitsEbitdaThousands.toString()} AED k</span>{' '}
            (unadjusted operating result). Synthetic Investments cash dividend of{' '}
            <span>{result.dividendBoundary.investmentDividendThousands.toString()} AED k</span> is
            displayed separately and excluded from operating EBITDA (
            <span>{result.dividendBoundary.combinedOperatingEbitdaThousands.toString()} AED k</span>).
          </div>
        </div>

        <Note>
          Draft golden walkthrough awaiting group finance SME approval (CONS-001 to CONS-009). Passing this manual illustration does not activate production consolidation.
        </Note>
      </div>
    </Card>
  )
}
