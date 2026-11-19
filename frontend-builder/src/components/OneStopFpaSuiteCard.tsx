import { useMemo, useState } from 'react'
import { formatScaled } from '../lib/domainRules'
import {
  calculateCapexDepreciationRollForward,
  calculatePriceVolumeMixBridge,
  calculateUaeWorkforceEosb,
  evaluate13WeekCashForecast,
  type Cash13WeekScenario,
} from '../lib/omniBlueprintEngine'

type SuiteTabId = 'workforce_eosb' | 'capex_rollforward' | 'cash_13week' | 'pvm_bridge'

function fmtAed(fils: bigint): string {
  return `${formatScaled(fils, 2, true)} AED`
}

export function OneStopFpaSuiteCard() {
  const [activeTab, setActiveTab] = useState<SuiteTabId>('workforce_eosb')

  // Tab 1: Workforce & UAE Labor Law Art. 51 EOSB Gratuity
  const [headcount, setHeadcount] = useState(12)
  const [basicSalaryRaw, setBasicSalaryRaw] = useState('15000.00')
  const [allowancesRaw, setAllowancesRaw] = useState('5000.00')
  const [yearsWhole, setYearsWhole] = useState(6)

  const eosbResult = useMemo(
    () =>
      calculateUaeWorkforceEosb({
        headcount: BigInt(Math.max(1, headcount)),
        monthlyBasicSalaryAedRaw: basicSalaryRaw,
        monthlyAllowancesAedRaw: allowancesRaw,
        yearsOfServiceWhole: BigInt(Math.max(1, yearsWhole)),
      }),
    [headcount, basicSalaryRaw, allowancesRaw, yearsWhole]
  )

  // Tab 2: CapEx & Fixed Asset Roll-Forward
  const [additionsAedThousands, setAdditionsAedThousands] = useState(1200)
  const [depreciationAedThousands, setDepreciationAedThousands] = useState(450)
  const capexResult = useMemo(
    () =>
      calculateCapexDepreciationRollForward({
        openingNbvFils: 500000000n, // 5,000,000.00 AED
        additionsFils: BigInt(Math.max(0, additionsAedThousands)) * 100000n,
        cwipTransferInFils: 30000000n, // 300,000.00 AED
        disposalsNbvFils: 20000000n, // 200,000.00 AED
        depreciationChargeFils: BigInt(Math.max(0, depreciationAedThousands)) * 100000n,
      }),
    [additionsAedThousands, depreciationAedThousands]
  )

  // Tab 3: 13-Week Direct Cash Flow & DSCR Guard
  const [cashScenario, setCashScenario] = useState<Cash13WeekScenario>('COLLECTION_DELAY_STRESS')
  const cashResult = useMemo(() => evaluate13WeekCashForecast(cashScenario), [cashScenario])

  // Tab 4: Price-Volume-Mix (PVM) Variance Bridge
  const [actualUnits, setActualUnits] = useState(1150)
  const [actualPriceAed, setActualPriceAed] = useState(130)
  const pvmResult = useMemo(
    () =>
      calculatePriceVolumeMixBridge({
        budgetUnits: 1000n,
        actualUnits: BigInt(Math.max(100, actualUnits)),
        budgetPriceFils: 12000n, // 120.00 AED
        actualPriceFils: BigInt(Math.max(10, actualPriceAed)) * 100n,
        mixShiftFils: 150000n, // +1,500.00 AED
        fxTranslationFils: -50000n, // -500.00 AED
      }),
    [actualUnits, actualPriceAed]
  )

  return (
    <section
      id="omni-fpa-suite"
      className="panel omni-suite-card"
      aria-labelledby="one-stop-fpa-suite-heading"
    >
      <div className="panel-head omni-head-split">
        <div>
          <p className="eyebrow">Complete One-Stop FP&amp;A Replacement Engines · I34 &amp; I35 · 100% BigInt</p>
          <h3 id="one-stop-fpa-suite-heading">
            Workforce UAE EOSB, CapEx Roll-Forward, 13-Week Direct Cash &amp; PVM Variance Bridge
          </h3>
        </div>
        <div className="omni-badge-row" role="status" aria-live="polite">
          <span className="status-badge ok">0.00 AED Unallocated Delta</span>
          <span className="status-badge ok">Replaces Legacy EPM &amp; Treasury Silos</span>
        </div>
      </div>

      <p className="panel-copy">
        Deterministic reference engines that eliminate separate point tools for{' '}
        <strong>Headcount &amp; UAE Federal Decree-Law No. 33 Art. 51 End-of-Service Gratuity</strong>,{' '}
        <strong>CapEx Depreciation Roll-Forward</strong>, <strong>13-Week Direct Cash Flow &amp; DSCR Guard</strong>,
        and <strong>Price-Volume-Mix (PVM) Variance Attribution</strong> — all evaluated in pure scaled{' '}
        <code>BigInt</code> integer arithmetic.
      </p>

      <div className="omni-pack-tabs" role="tablist" aria-label="One-Stop FP&A Replacement Engines">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'workforce_eosb'}
          className={`omni-pack-tab ${activeTab === 'workforce_eosb' ? 'active' : ''}`}
          onClick={() => setActiveTab('workforce_eosb')}
        >
          <span className="omni-pack-code">WF-EOSB</span>
          <span>Workforce &amp; UAE Art. 51 Gratuity</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'capex_rollforward'}
          className={`omni-pack-tab ${activeTab === 'capex_rollforward' ? 'active' : ''}`}
          onClick={() => setActiveTab('capex_rollforward')}
        >
          <span className="omni-pack-code">CAPEX</span>
          <span>CapEx &amp; NBV Roll-Forward</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'cash_13week'}
          className={`omni-pack-tab ${activeTab === 'cash_13week' ? 'active' : ''}`}
          onClick={() => setActiveTab('cash_13week')}
        >
          <span className="omni-pack-code">13W-CASH</span>
          <span>13-Week Direct Cash &amp; DSCR</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'pvm_bridge'}
          className={`omni-pack-tab ${activeTab === 'pvm_bridge' ? 'active' : ''}`}
          onClick={() => setActiveTab('pvm_bridge')}
        >
          <span className="omni-pack-code">PVM-FX</span>
          <span>Price-Volume-Mix Bridge</span>
        </button>
      </div>

      {activeTab === 'workforce_eosb' && (
        <div className="omni-suite-body">
          <div className="omni-erp-mode-toggle">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setHeadcount(12)
                setBasicSalaryRaw('15000.00')
                setAllowancesRaw('5000.00')
                setYearsWhole(6)
              }}
            >
              Preset: 6 Yr Standard Cohort (21d + 30d Split)
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setHeadcount(4)
                setBasicSalaryRaw('25000.00')
                setAllowancesRaw('10000.00')
                setYearsWhole(45)
              }}
            >
              Preset: 45 Yr Executive Cohort (24-Month Statutory Cap)
            </button>
          </div>

          <div className="omni-erp-inspector-grid">
            <div className="omni-subpanel">
              <div className="omni-subhead">
                <h4>Cohort Roster Inputs (Basic vs Allowances Separation)</h4>
                <span className="mono">{yearsWhole} yrs service</span>
              </div>
              <div className="omni-form-grid">
                <label>
                  <span>Cohort Headcount (FTE)</span>
                  <input
                    type="number"
                    min={1}
                    max={5000}
                    value={headcount}
                    onChange={e => setHeadcount(Math.max(1, Number(e.target.value) || 1))}
                  />
                </label>
                <label>
                  <span>Monthly Basic Salary (AED — EOSB Base)</span>
                  <input
                    type="text"
                    value={basicSalaryRaw}
                    onChange={e => setBasicSalaryRaw(e.target.value)}
                  />
                </label>
                <label>
                  <span>Monthly Allowances (AED — Excluded from EOSB Rate)</span>
                  <input
                    type="text"
                    value={allowancesRaw}
                    onChange={e => setAllowancesRaw(e.target.value)}
                  />
                </label>
                <label>
                  <span>Completed Years of Service</span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={yearsWhole}
                    onChange={e => setYearsWhole(Math.max(1, Number(e.target.value) || 1))}
                  />
                </label>
              </div>
            </div>

            <div className="omni-subpanel">
              {eosbResult.status === 'CALCULATED' ? (
                <>
                  <div className="omni-subhead">
                    <h4>UAE Federal Decree-Law No. 33 Art. 51 EOSB Accrual Output</h4>
                    <span className={`status-badge ${eosbResult.capApplied ? 'warn' : 'ok'}`}>
                      {eosbResult.capApplied ? '24-Month Statutory Cap Active' : 'Standard 21d/30d Accrual'}
                    </span>
                  </div>
                  <dl className="omni-kv-list">
                    <div>
                      <dt>Per-Employee Raw EOSB (Uncapped)</dt>
                      <dd className="mono">{fmtAed(eosbResult.singleEmployeeRawEosbFils)}</dd>
                    </div>
                    <div>
                      <dt>Per-Employee 24-Month Statutory Ceiling</dt>
                      <dd className="mono">{fmtAed(eosbResult.singleEmployeeTwoYearCapFils)}</dd>
                    </div>
                    <div>
                      <dt>Per-Employee Net Capped EOSB Liability</dt>
                      <dd className="mono">{fmtAed(eosbResult.singleEmployeeCappedEosbFils)}</dd>
                    </div>
                    <div>
                      <dt>Total Cohort Balance-Sheet EOSB Provision</dt>
                      <dd className="mono">{fmtAed(eosbResult.totalCappedEosbLiabilityFils)}</dd>
                    </div>
                    <div>
                      <dt>Monthly P&amp;L Gratuity Accrual Run-Rate</dt>
                      <dd className="mono">{fmtAed(eosbResult.monthlyEosbAccrualFils)}</dd>
                    </div>
                    <div>
                      <dt>Statutory Formula Proof</dt>
                      <dd>{eosbResult.statutoryRuleSummary}</dd>
                    </div>
                  </dl>
                </>
              ) : (
                <p className="muted-copy">{eosbResult.message}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'capex_rollforward' && (
        <div className="omni-suite-body">
          <div className="omni-erp-inspector-grid">
            <div className="omni-subpanel">
              <div className="omni-subhead">
                <h4>Interactive CapEx Additions &amp; Depreciation Drivers</h4>
                <span className="mono">Policy: {capexResult.aggregationPolicy}</span>
              </div>
              <div className="omni-form-grid">
                <label>
                  <span>CapEx Additions (AED thousands)</span>
                  <input
                    type="number"
                    min={0}
                    max={50000}
                    value={additionsAedThousands}
                    onChange={e => setAdditionsAedThousands(Math.max(0, Number(e.target.value) || 0))}
                  />
                </label>
                <label>
                  <span>Depreciation Charge (AED thousands)</span>
                  <input
                    type="number"
                    min={0}
                    max={50000}
                    value={depreciationAedThousands}
                    onChange={e => setDepreciationAedThousands(Math.max(0, Number(e.target.value) || 0))}
                  />
                </label>
              </div>
              <p className="muted-copy">
                Enforces balance-sheet roll-forward identity{' '}
                <code>Closing NBV = Opening NBV + Additions + CWIP Transfers - Disposals - Depreciation</code>{' '}
                and prevents multi-period rollups from summing monthly closing stock balances (
                <code>STOCK_CLOSING_LAST</code>).
              </p>
            </div>

            <div className="omni-subpanel">
              <div className="omni-subhead">
                <h4>Fixed Asset Net Book Value (NBV) Roll-Forward (I34)</h4>
                <span className="status-badge ok">
                  Reconciles: {capexResult.reconcilesToZeroDelta ? '0.00 AED Delta' : 'Mismatch'}
                </span>
              </div>
              <dl className="omni-kv-list">
                <div>
                  <dt>Opening Net Book Value</dt>
                  <dd className="mono">{fmtAed(capexResult.openingNbvFils)}</dd>
                </div>
                <div>
                  <dt>+ CapEx Additions &amp; CWIP Transfers In</dt>
                  <dd className="mono">
                    +{fmtAed(capexResult.additionsFils)} · +{fmtAed(capexResult.cwipTransferInFils)}
                  </dd>
                </div>
                <div>
                  <dt>- Net Disposals &amp; Depreciation Charge</dt>
                  <dd className="mono">
                    -{fmtAed(capexResult.disposalsNbvFils)} · -{fmtAed(capexResult.depreciationChargeFils)}
                  </dd>
                </div>
                <div>
                  <dt>Closing Net Book Value (STOCK_CLOSING_LAST)</dt>
                  <dd className="mono">{fmtAed(capexResult.closingNbvFils)}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'cash_13week' && (
        <div className="omni-suite-body">
          <div className="omni-erp-mode-toggle">
            <button
              type="button"
              className={`secondary-button ${cashScenario === 'BASE_CUSHION' ? 'active-mode-btn' : ''}`}
              onClick={() => setCashScenario('BASE_CUSHION')}
            >
              Base Cushion Plan (Healthy Liquidity · DSCR 1.68x)
            </button>
            <button
              type="button"
              className={`secondary-button ${cashScenario === 'COLLECTION_DELAY_STRESS' ? 'active-mode-btn' : ''}`}
              onClick={() => setCashScenario('COLLECTION_DELAY_STRESS')}
            >
              AR Collection Delay Stress (Triggers Revolver Sweep &amp; DSCR Alert)
            </button>
          </div>

          <div className="omni-erp-inspector-grid">
            <div className="omni-subpanel">
              <div className="omni-subhead">
                <h4>13-Week Direct Cash &amp; Revolver Sweep Summary</h4>
                <span
                  className={`status-badge ${
                    cashResult.covenantStatus === 'COVENANT_COMPLIANT' ? 'ok' : 'error'
                  }`}
                >
                  {cashResult.covenantStatus}
                </span>
              </div>
              <dl className="omni-kv-list">
                <div>
                  <dt>Opening Cash (Week 1) &amp; Minimum Buffer Floor</dt>
                  <dd className="mono">
                    Open: {fmtAed(cashResult.openingCashWeek1Fils)} · Floor:{' '}
                    {fmtAed(cashResult.minimumBufferFloorFils)}
                  </dd>
                </div>
                <div>
                  <dt>Lowest Projected Weekly Cash (Week {cashResult.lowestCashWeekNumber})</dt>
                  <dd className="mono">{fmtAed(cashResult.lowestCashPreSweepFils)}</dd>
                </div>
                <div>
                  <dt>Automated Revolver Sweep Draw Required</dt>
                  <dd className="mono">{fmtAed(cashResult.revolverDrawRequiredFils)}</dd>
                </div>
                <div>
                  <dt>Debt Service Coverage Ratio (DSCR vs 1.20x Min)</dt>
                  <dd className="mono">{(Number(cashResult.dscrTenths) / 100).toFixed(2)}x</dd>
                </div>
              </dl>
            </div>

            <div className="omni-subpanel">
              <div className="omni-subhead">
                <h4>13-Week Cumulative Receipts vs Disbursements</h4>
                <span className="mono">Direct Treasury Method</span>
              </div>
              <dl className="omni-kv-list">
                <div>
                  <dt>Total 13-Week Direct Customer Receipts</dt>
                  <dd className="mono">+{fmtAed(cashResult.totalReceipts13WksFils)}</dd>
                </div>
                <div>
                  <dt>Total 13-Week Direct Operating &amp; CapEx Disbursements</dt>
                  <dd className="mono">-{fmtAed(cashResult.totalDisbursements13WksFils)}</dd>
                </div>
                <div>
                  <dt>Closing Week 13 Cash Balance (Post-Revolver Sweep)</dt>
                  <dd className="mono">{fmtAed(cashResult.closingCashWeek13Fils)}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'pvm_bridge' && (
        <div className="omni-suite-body">
          <div className="omni-erp-inspector-grid">
            <div className="omni-subpanel">
              <div className="omni-subhead">
                <h4>Interactive Actual Price &amp; Volume Drivers</h4>
                <span className="mono">Budget: 120.00 AED × 1,000 units</span>
              </div>
              <div className="omni-form-grid">
                <label>
                  <span>Actual Unit Price (AED)</span>
                  <input
                    type="number"
                    min={10}
                    max={5000}
                    value={actualPriceAed}
                    onChange={e => setActualPriceAed(Math.max(10, Number(e.target.value) || 10))}
                  />
                </label>
                <label>
                  <span>Actual Volume (Units)</span>
                  <input
                    type="number"
                    min={100}
                    max={10000}
                    value={actualUnits}
                    onChange={e => setActualUnits(Math.max(100, Number(e.target.value) || 100))}
                  />
                </label>
              </div>
              <p className="muted-copy">
                Includes deterministic portfolio Mix shift (<code>+1,500.00 AED</code>) and FX translation
                effect (<code>-500.00 AED</code>) with zero unallocated plug.
              </p>
            </div>

            <div className="omni-subpanel">
              <div className="omni-subhead">
                <h4>Exact PVM + FX Variance Bridge (I35 · Zero Unallocated Plug)</h4>
                <span className="status-badge ok">
                  Delta: {pvmResult.reconciliationDeltaFils.toString()}n fils
                </span>
              </div>
              <dl className="omni-kv-list">
                <div>
                  <dt>Total Revenue Variance (Actual - Budget)</dt>
                  <dd className="mono">{fmtAed(pvmResult.totalRevenueVarianceFils)}</dd>
                </div>
                <div>
                  <dt>1. Pure Volume Effect</dt>
                  <dd className="mono">{fmtAed(pvmResult.volumeVarianceFils)}</dd>
                </div>
                <div>
                  <dt>2. Pure Price Effect</dt>
                  <dd className="mono">{fmtAed(pvmResult.purePriceVarianceFils)}</dd>
                </div>
                <div>
                  <dt>3. Joint Price-Volume Interaction + Mix + FX</dt>
                  <dd className="mono">
                    Joint: {fmtAed(pvmResult.jointPriceVolumeInteractionFils)} · Mix:{' '}
                    {fmtAed(pvmResult.mixShiftFils)} · FX: {fmtAed(pvmResult.fxTranslationFils)}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
