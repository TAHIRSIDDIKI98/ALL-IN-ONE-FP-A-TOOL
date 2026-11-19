import { useState } from 'react'
import { AlertTriangle, CheckCircle2, FileCheck2, ShieldCheck } from 'lucide-react'
import {
  evaluateIngestionBatch,
  type IngestionPresetMode,
} from '../lib/omniBlueprintEngine'
import { Badge, Card, CardHeader, DataTable, Note, Segmented } from './ui'

export function SubLedgerGateCard() {
  const [mode, setMode] = useState<IngestionPresetMode>('COHERENT_SCOPED')
  const evaluation = evaluateIngestionBatch(mode)

  return (
    <Card className="omni-gate-card">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <FileCheck2 size={16} />
            Source-scoped ingestion gate (IMP-GL vs. IMP-SUB · fixes OQ-025 / K2 / K3)
          </span>
        }
        subtitle="GL double-entry asserts Debit = Credit; signed single-sided sub-ledgers verify control totals + fiscal date window"
        actions={
          <Badge tone={evaluation.falseAlertCount === 0 ? 'green' : 'amber'}>
            {evaluation.totalLoaded.toLocaleString('en-GB')} /{' '}
            {evaluation.totalSubmitted.toLocaleString('en-GB')} rows loaded
          </Badge>
        }
      />

      <div className="omni-section-body">
        <div className="golden-controls-row">
          <Segmented
            small
            label="Ingestion validation mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'COHERENT_SCOPED', label: 'Scoped IMP-GL / IMP-SUB (Fixed)' },
              { value: 'LEGACY_UNSCOPED_BUG', label: 'Legacy global Dr==Cr bug (OQ-025)' },
              { value: 'FUTURE_DATE_LEAK', label: 'Future date leak (K2 / EXC-011)' },
            ]}
          />
          <span className="cell-hint">
            False variance alerts triggered:{' '}
            <strong>{evaluation.falseAlertCount.toLocaleString('en-GB')}</strong>
          </span>
        </div>

        <DataTable label="Source-scoped batch ingestion verification">
          <thead>
            <tr>
              <th>Source artifact</th>
              <th>Gate policy applied</th>
              <th className="numeric">Accepted / Submitted</th>
              <th>Verification &amp; Canonical Finding Key (K3)</th>
            </tr>
          </thead>
          <tbody>
            {evaluation.batches.map(batch => (
              <tr key={batch.sourceKind}>
                <td>
                  <strong>{batch.sourceLabel}</strong>
                </td>
                <td className="mono cell-hint">{batch.gateApplied}</td>
                <td className="numeric strong-number">
                  <span className={batch.status === 'ACCEPTED' ? 'positive' : 'adverse'}>
                    {batch.rowsAccepted.toLocaleString('en-GB')} /{' '}
                    {batch.rowsSubmitted.toLocaleString('en-GB')}
                  </span>
                </td>
                <td>
                  <div className="omni-gate-finding">
                    {batch.status === 'ACCEPTED' ? (
                      <CheckCircle2 size={14} className="positive shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle size={14} className="adverse shrink-0 mt-0.5" />
                    )}
                    <div>
                      <span>{batch.controlCheckSummary}</span>
                      {batch.canonicalFindingKey && (
                        <div className="mono omni-finding-key">
                          Key: {batch.canonicalFindingKey}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>

        <Note tone={mode === 'COHERENT_SCOPED' ? 'green' : 'amber'}>
          <span className="flex items-start gap-2">
            <ShieldCheck size={14} className="shrink-0 mt-0.5" />
            <span>
              {mode === 'COHERENT_SCOPED'
                ? 'Source-scoped validation preserves 499/499 bank rows and 399/399 payroll rows while quarantining bad dates before fact commit.'
                : mode === 'LEGACY_UNSCOPED_BUG'
                  ? 'Reproduces finalFPA failure OQ-025: forcing Debit == Credit across signed sub-ledgers dropped 100% of bank (499) and payroll (399) rows.'
                  : 'Reproduces finalFPA failure K2 (EXC-011): a synthetic 2026-12-27 date outside fiscal close (2026-11-12) is quarantined before cascading 20,691 alerts.'}
            </span>
          </span>
        </Note>
      </div>
    </Card>
  )
}
