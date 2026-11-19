import { useId, useState } from 'react'
import { Building, Calculator, ShieldCheck } from 'lucide-react'
import {
  calculateUaeCorporateTax,
  calculateUaeVat,
  formatScaled,
  type CorporateTaxRegime,
  type VatBasis,
} from '../lib/domainRules'
import { useWorkspace } from '../lib/workspace'
import { Badge, Card, CardHeader, DefinitionList, Note, Segmented, SelectField } from './ui'

export function UaeTaxPreviewCard() {
  const { preferences } = useWorkspace()
  const vatAmountId = useId()
  const vatConfirmId = useId()
  const ctIncomeId = useId()
  const ctReliefsId = useId()

  const [vatAmount, setVatAmount] = useState('1000')
  const [vatBasis, setVatBasis] = useState<VatBasis>('inclusive')
  const [vatConfirmed, setVatConfirmed] = useState(true)

  const [ctIncome, setCtIncome] = useState('500000')
  const [ctRegime, setCtRegime] = useState<CorporateTaxRegime>('standard_confirmed')
  const [ctReliefsApply, setCtReliefsApply] = useState(false)

  const vatResult = calculateUaeVat({
    amountRaw: vatAmount,
    basis: vatBasis,
    ratePercentRaw: '5',
    taxTreatmentConfirmed: vatConfirmed,
  })

  const ctResult = calculateUaeCorporateTax({
    taxableIncomeRaw: ctIncome,
    regime: ctRegime,
    specialReliefsOrGroupApply: ctReliefsApply,
  })

  return (
    <Card className="uae-tax-card">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Calculator size={16} />
            UAE VAT &amp; Corporate Tax planning preview
          </span>
        }
        subtitle="Manual user-driven assumptions from docs/11 (U-02 & U-03) · BigInt half-even math · Not tax filing"
        actions={<Badge tone="amber">Illustrative · Not tax advice</Badge>}
      />

      <div className="uae-tax-grid">
        <section className="uae-tax-panel" aria-label="UAE VAT planning preview">
          <div className="uae-panel-top">
            <div>
              <span className="eyebrow">U-02 · VAT WORKING-CAPITAL ESTIMATE</span>
              <h3>User-reviewed 5% / exempt check</h3>
            </div>
            <Badge tone={vatResult.status === 'CALCULATED' ? 'green' : 'amber'}>
              {vatResult.status === 'CALCULATED' ? 'Estimate ready' : vatResult.status === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : 'Invalid input'}
            </Badge>
          </div>

          <div className="uae-controls-stack">
            <div className="field">
              <span>Supply basis</span>
              <Segmented
                small
                label="UAE VAT basis"
                value={vatBasis}
                onChange={setVatBasis}
                options={[
                  { value: 'exclusive', label: 'Exclusive (5%)' },
                  { value: 'inclusive', label: 'Inclusive (5%)' },
                  { value: 'exempt_or_uncertain', label: 'Exempt / Uncertain' },
                ]}
              />
            </div>

            <label className="field" htmlFor={vatAmountId}>
              <span>Supply amount · AED</span>
              <input
                id={vatAmountId}
                type="text"
                inputMode="decimal"
                value={vatAmount}
                onChange={e => setVatAmount(e.target.value)}
                aria-invalid={vatResult.status === 'INVALID_INPUT'}
                aria-describedby={vatResult.status === 'INVALID_INPUT' ? `${vatAmountId}-err` : undefined}
              />
            </label>

            <label className="uae-checkbox" htmlFor={vatConfirmId}>
              <input
                id={vatConfirmId}
                type="checkbox"
                checked={vatConfirmed}
                onChange={e => setVatConfirmed(e.target.checked)}
              />
              <span>Confirm supply classification and recovery eligibility were reviewed</span>
            </label>
          </div>

          {vatResult.status === 'INVALID_INPUT' && (
            <p id={`${vatAmountId}-err`} className="form-error" role="alert">
              {vatResult.error}
            </p>
          )}

          {vatResult.status === 'NEEDS_REVIEW' && (
            <Note tone="amber">
              <strong>NEEDS_REVIEW:</strong> {vatResult.reason}
            </Note>
          )}

          {vatResult.status === 'CALCULATED' && (
            <DefinitionList
              items={[
                { label: 'Taxable base (AED)', value: formatScaled(vatResult.taxableBaseFils, 2, preferences.grouping) },
                { label: 'Estimated VAT 5% (AED)', value: formatScaled(vatResult.vatFils, 2, preferences.grouping) },
                { label: 'Gross total (AED)', value: formatScaled(vatResult.grossTotalFils, 2, preferences.grouping) },
              ]}
            />
          )}
        </section>

        <section className="uae-tax-panel" aria-label="UAE Corporate Tax planning preview">
          <div className="uae-panel-top">
            <div>
              <span className="eyebrow">U-03 · CORPORATE TAX SCENARIO</span>
              <h3>0% up to AED 375k / 9% above</h3>
            </div>
            <Badge tone={ctResult.status === 'CALCULATED_ILLUSTRATIVE' ? 'green' : 'amber'}>
              {ctResult.status === 'CALCULATED_ILLUSTRATIVE'
                ? 'Illustrative formula'
                : ctResult.status === 'NEEDS_REVIEW'
                  ? 'NEEDS_REVIEW'
                  : 'Invalid input'}
            </Badge>
          </div>

          <div className="uae-controls-stack">
            <SelectField
              label="Entity corporate tax status"
              value={ctRegime}
              onChange={value => setCtRegime(value as CorporateTaxRegime)}
              options={[
                { value: 'standard_confirmed', label: 'Standard mainland (confirmed)' },
                { value: 'free_zone_qfzp', label: 'Free Zone / QFZP (NEEDS_REVIEW)' },
                { value: 'unconfirmed', label: 'Unconfirmed status (NEEDS_REVIEW)' },
              ]}
            />

            <label className="field" htmlFor={ctIncomeId}>
              <span>User-supplied taxable income · AED</span>
              <input
                id={ctIncomeId}
                type="text"
                inputMode="decimal"
                value={ctIncome}
                onChange={e => setCtIncome(e.target.value)}
                aria-invalid={ctResult.status === 'INVALID_INPUT'}
                aria-describedby={ctResult.status === 'INVALID_INPUT' ? `${ctIncomeId}-err` : undefined}
              />
            </label>

            <label className="uae-checkbox" htmlFor={ctReliefsId}>
              <input
                id={ctReliefsId}
                type="checkbox"
                checked={ctReliefsApply}
                onChange={e => setCtReliefsApply(e.target.checked)}
              />
              <span>Tax grouping, Small Business Relief, or special elections apply</span>
            </label>
          </div>

          {ctResult.status === 'INVALID_INPUT' && (
            <p id={`${ctIncomeId}-err`} className="form-error" role="alert">
              {ctResult.error}
            </p>
          )}

          {ctResult.status === 'NEEDS_REVIEW' && (
            <Note tone="amber">
              <strong>NEEDS_REVIEW:</strong> {ctResult.reason}
            </Note>
          )}

          {ctResult.status === 'CALCULATED_ILLUSTRATIVE' && (
            <DefinitionList
              items={[
                { label: '0% threshold applied (AED)', value: formatScaled(ctResult.zeroBandAppliedFils, 2, preferences.grouping) },
                { label: 'Taxable excess @ 9% (AED)', value: formatScaled(ctResult.excessTaxableFils, 2, preferences.grouping) },
                { label: 'Illustrative CT provision (AED)', value: formatScaled(ctResult.estimatedTaxFils, 2, preferences.grouping) },
              ]}
            />
          )}
        </section>
      </div>

      <div className="statement-footer">
        <span className="flex items-center gap-2">
          <ShieldCheck size={13} />
          Planning estimate only — review statutory eligibility, Free Zone rules, and groupings with a qualified UAE tax adviser.
        </span>
        <span className="flex items-center gap-1.5 cell-hint">
          <Building size={12} />
          No auto-inferred tax jurisdiction
        </span>
      </div>
    </Card>
  )
}
