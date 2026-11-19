import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Link2, ShieldCheck } from 'lucide-react'
import { buildAuditChainFixture, verifyAuditChain } from '../lib/omniBlueprintEngine'
import { Badge, Card, CardHeader, Note, Segmented } from './ui'

type AuditChainMode = 'INTACT' | 'TAMPER_SEQ_2' | 'TAMPER_GENESIS'

export function AuditChainCard() {
  const [mode, setMode] = useState<AuditChainMode>('INTACT')

  const baseChain = buildAuditChainFixture()
  const activeChain = baseChain.map(entry => {
    if (mode === 'TAMPER_SEQ_2' && entry.sequence === 2) {
      return {
        ...entry,
        canonicalPayload: 'pool=100.00|weights=33.33,33.33,33.33|SILENT_PLUG=0.05',
      }
    }
    if (mode === 'TAMPER_GENESIS' && entry.sequence === 0) {
      return {
        ...entry,
        actor: 'Unauthorized Override (Edited)',
      }
    }
    return entry
  })

  const verification = verifyAuditChain(activeChain)

  return (
    <Card className="omni-audit-card">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Link2 size={16} />
            Append-only SHA-256 hash-chained audit oracle (Invariant I22)
          </span>
        }
        subtitle="Live FIPS 180-4 SHA-256 verification across genesis -> sequential revisions; altering any payload breaks downstream hash verification"
        actions={
          <Badge tone={verification.valid ? 'green' : 'amber'}>
            {verification.valid
              ? `${verification.checkedCount} / ${verification.checkedCount} SHA-256 links valid`
              : `Broken at seq #${verification.brokenSequence}`}
          </Badge>
        }
      />

      <div className="omni-section-body">
        <div className="golden-controls-row">
          <Segmented
            small
            label="Audit chain tamper test mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'INTACT', label: 'Intact SHA-256 chain (5 links)' },
              { value: 'TAMPER_SEQ_2', label: 'Tamper Event #2 payload' },
              { value: 'TAMPER_GENESIS', label: 'Tamper Event #0 actor' },
            ]}
          />
          <span className="cell-hint">
            Algorithm: <strong>FIPS 180-4 SHA-256 (synchronous pure TS oracle)</strong>
          </span>
        </div>

        <ol className="omni-chain-list" aria-label="SHA-256 hash-chained audit sequence">
          {activeChain.map((evt, index) => {
            const link = verification.links[index]
            return (
              <li
                key={evt.eventId}
                className={`omni-chain-item ${link.linkValid ? '' : 'is-broken'}`}
              >
                <div className="omni-chain-top">
                  <strong>
                    #{evt.sequence} · {evt.eventId} · {evt.actionType}
                  </strong>
                  <Badge tone={link.linkValid ? 'green' : 'red'}>
                    {link.linkValid ? (
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 size={12} />
                        SHA-256 verified
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <AlertTriangle size={12} />
                        Hash mismatch
                      </span>
                    )}
                  </Badge>
                </div>
                <div className="omni-chain-meta">
                  <span>Actor: {evt.actor}</span>
                  <span>Time: {evt.timestampIso}</span>
                </div>
                <div className="mono omni-chain-payload">Payload: {evt.canonicalPayload}</div>
                <div className="mono omni-chain-hashes">
                  <span>prev: {evt.prevHash.slice(0, 18)}…</span>
                  <span>recorded: {evt.entryHash.slice(0, 18)}…</span>
                  <span>computed: {link.expectedHash.slice(0, 18)}…</span>
                </div>
              </li>
            )
          })}
        </ol>

        {!verification.valid ? (
          <div className="omni-error-box" role="alert">
            <strong>Chain tamper detected:</strong> {verification.reason}
          </div>
        ) : null}

        <Note tone={verification.valid ? 'green' : 'amber'}>
          <span className="flex items-start gap-2">
            <ShieldCheck size={14} className="shrink-0 mt-0.5" />
            <span>
              <strong>Honest security boundary:</strong> {verification.reason} Native Windows persistence uses Rust SQLCipher append-only triggers; local hash chaining detects tampering but cannot prevent modification by a privileged same-user Windows administrator without external archival.
            </span>
          </span>
        </Note>
      </div>
    </Card>
  )
}
