import { useId, useState } from 'react'
import { FileSpreadsheet, KeyRound, Play, RotateCcw, ShieldAlert } from 'lucide-react'
import { formatScaled } from '../lib/domainRules'
import {
  createInitialXllCommandLedger,
  evaluateExcelXllFormula,
  processExcelWriteCommand,
  type XllWriteCommandResult,
} from '../lib/omniBlueprintEngine'
import { useWorkspace } from '../lib/workspace'
import { Badge, Button, Card, CardHeader, DefinitionList, Note } from './ui'

const FORMULA_PRESETS = [
  { label: '=FPA.GET ENT-01 Rev', formula: '=FPA.GET("ENT-01","REV","2026-01","ACTUAL")' },
  { label: '=FPA.SET Blocked (I20)', formula: '=FPA.SET("ENT-01","REV","2026-01",999)' },
  {
    label: '17-digit guard',
    formula: '=FPA.GET("PRECISION_TEST","MAX_SAFE","2026-01","ACTUAL")',
  },
  { label: 'TPL-04 Missing Cash', formula: '=FPA.GET("TPL-04","CASH","2026-01","ACTUAL")' },
]

export function ExcelXllContractCard() {
  const { preferences } = useWorkspace()
  const formulaInputId = useId()
  const keyInputId = useId()
  const amtInputId = useId()

  const [formulaText, setFormulaText] = useState(FORMULA_PRESETS[0].formula)
  const [ledger, setLedger] = useState(createInitialXllCommandLedger)
  const [idempotencyKey, setIdempotencyKey] = useState('xll-cmd-2026-01-a')
  const [proposedAmount, setProposedAmount] = useState('1050000.00')
  const [lastCmdResult, setLastCmdResult] = useState<XllWriteCommandResult | null>(null)

  const evalResult = evaluateExcelXllFormula(formulaText)
  const ent01Current = ledger.currentValuesFils['ENT-01|REV|2026-01'] ?? 0n

  const runCommand = (params: {
    key: string
    expectedRevision: number
    amount: string
  }) => {
    const res = processExcelWriteCommand(ledger, {
      idempotencyKey: params.key,
      expectedRevision: params.expectedRevision,
      entityCode: 'ENT-01',
      accountCode: 'REV',
      periodCode: '2026-01',
      proposedRaw: params.amount,
    })
    setLedger(res.nextLedger)
    setLastCmdResult(res)
  }

  const evalBadgeTone =
    evalResult.status === 'SAFE_EXACT'
      ? 'green'
      : evalResult.status === 'MISSING_INPUT'
        ? 'blue'
        : 'amber'

  const cmdBadgeTone =
    !lastCmdResult
      ? 'neutral'
      : lastCmdResult.outcome === 'COMMITTED'
        ? 'green'
        : lastCmdResult.outcome === 'IDEMPOTENT_REPLAY'
          ? 'blue'
          : 'amber'

  return (
    <Card className="omni-xll-card">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <FileSpreadsheet size={16} />
            Native 64-bit Excel XLL contract lab (I20 read-only UDF &amp; I28 Command write-back)
          </span>
        }
        subtitle="Simulates Office 2021 x64 C-ABI constraints: =FPA.GET precision protection, =FPA.SET prohibition, and idempotent revision-checked commits"
        actions={<Badge tone="blue">Simulated XLL contract · Native .xll unbuilt here</Badge>}
      />

      <div className="uae-tax-grid">
        <section className="uae-tax-panel" aria-label="FPA.GET formula evaluator">
          <div className="uae-panel-top">
            <div>
              <span className="eyebrow">I20 · READ-ONLY WORKSHEET UDF &amp; FLOAT GUARD</span>
              <h3>=FPA.GET &amp; Precision Check</h3>
            </div>
            <Badge tone={evalBadgeTone}>{evalResult.status}</Badge>
          </div>

          <div className="omni-preset-row">
            {FORMULA_PRESETS.map(preset => (
              <Button
                key={preset.label}
                type="button"
                onClick={() => setFormulaText(preset.formula)}
              >
                {preset.label}
              </Button>
            ))}
          </div>

          <label className="field" htmlFor={formulaInputId}>
            <span>Excel XLL formula bar</span>
            <input
              id={formulaInputId}
              className="mono"
              type="text"
              value={formulaText}
              onChange={e => setFormulaText(e.target.value)}
            />
          </label>

          <DefinitionList
            items={[
              { label: 'Excel cell value', value: evalResult.excelNumericOutput },
              {
                label: 'Authoritative BigInt',
                value: evalResult.decimalAuthoritative ?? 'Not provided (explicit empty)',
              },
              { label: 'Pinned revision', value: evalResult.revision },
            ]}
          />

          {evalResult.status === 'BLOCKED_READ_ONLY' || evalResult.status === 'PRECISION_LOSS_BLOCKED' ? (
            <div className="omni-error-box" role="status">
              <strong>Contract guard ({evalResult.status}):</strong> {evalResult.diagnostic}
            </div>
          ) : (
            <Note tone={evalResult.status === 'SAFE_EXACT' ? 'green' : undefined}>
              <span>{evalResult.diagnostic}</span>
            </Note>
          )}
        </section>

        <section className="uae-tax-panel" aria-label="Idempotent signed Command batch">
          <div className="uae-panel-top">
            <div>
              <span className="eyebrow">I28 · ATOMIC COMMAND WRITE-BACK LEDGER</span>
              <h3>Idempotency &amp; Revision Mutex</h3>
            </div>
            <Badge tone={cmdBadgeTone}>
              {lastCmdResult ? lastCmdResult.outcome : `Ledger rev #${ledger.headRevision}`}
            </Badge>
          </div>

          <DefinitionList
            items={[
              { label: 'Active head revision', value: `#${ledger.headRevision}` },
              {
                label: 'Simulated ENT-01 Rev',
                value: `${formatScaled(ent01Current, 2, preferences.grouping)} AED`,
              },
              {
                label: 'Committed keys stored',
                value: `${Object.keys(ledger.committedByKey).length} key(s) in session memory`,
              },
            ]}
          />

          <div className="omni-weight-grid">
            <label className="field" htmlFor={keyInputId}>
              <span>Idempotency key</span>
              <input
                id={keyInputId}
                className="mono"
                type="text"
                value={idempotencyKey}
                onChange={e => setIdempotencyKey(e.target.value)}
              />
            </label>
            <label className="field" htmlFor={amtInputId}>
              <span>ENT-01 batch amount (AED)</span>
              <input
                id={amtInputId}
                type="text"
                inputMode="decimal"
                value={proposedAmount}
                onChange={e => setProposedAmount(e.target.value)}
              />
            </label>
            <div className="field">
              <span>Expected revision</span>
              <div className="readonly-value">#{ledger.headRevision}</div>
            </div>
          </div>

          <div className="omni-preset-row">
            <Button
              type="button"
              variant="primary"
              onClick={() =>
                runCommand({
                  key: idempotencyKey,
                  expectedRevision: ledger.headRevision,
                  amount: proposedAmount,
                })
              }
            >
              <Play size={12} />
              Commit atomic batch
            </Button>
            <Button
              type="button"
              onClick={() =>
                runCommand({
                  key: idempotencyKey,
                  expectedRevision: ledger.headRevision,
                  amount: proposedAmount,
                })
              }
            >
              <KeyRound size={12} />
              Replay same key
            </Button>
            <Button
              type="button"
              onClick={() =>
                runCommand({
                  key: idempotencyKey,
                  expectedRevision: ledger.headRevision,
                  amount: proposedAmount === '999999.00' ? '888888.00' : '999999.00',
                })
              }
            >
              <ShieldAlert size={12} />
              Mutate same key (409)
            </Button>
            <Button
              type="button"
              onClick={() =>
                runCommand({
                  key: `${idempotencyKey}-stale-${ledger.headRevision}`,
                  expectedRevision: Math.max(1, ledger.headRevision - 1),
                  amount: '1120000.00',
                })
              }
            >
              Stale revision (412)
            </Button>
            <Button
              type="button"
              onClick={() => {
                setLedger(createInitialXllCommandLedger())
                setIdempotencyKey('xll-cmd-2026-01-a')
                setProposedAmount('1050000.00')
                setLastCmdResult(null)
              }}
            >
              <RotateCcw size={12} />
              Reset XLL ledger
            </Button>
          </div>

          {lastCmdResult ? (
            lastCmdResult.outcome === 'IDEMPOTENCY_CONFLICT' ||
            lastCmdResult.outcome === 'STALE_REVISION_CONFLICT' ||
            lastCmdResult.outcome === 'VALIDATION_ERROR' ? (
              <div className="omni-error-box" role="alert">
                <strong>{lastCmdResult.outcome}:</strong> {lastCmdResult.message}
              </div>
            ) : (
              <Note tone={lastCmdResult.outcome === 'COMMITTED' ? 'green' : undefined}>
                <span>{lastCmdResult.message}</span>
              </Note>
            )
          ) : (
            <Note>
              <span>
                Test commit, identical-key replay deduplication, mutated-key 409 conflict, or stale-revision 412 rejection in React memory.
              </span>
            </Note>
          )}
        </section>
      </div>
    </Card>
  )
}
