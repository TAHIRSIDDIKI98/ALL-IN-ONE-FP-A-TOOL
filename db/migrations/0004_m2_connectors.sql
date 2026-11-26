-- OneFP&A M2 Connectors & Integration Sync Ledger Schema (Migration 0004, DEC-020, §11.1, CON1–CON5)
-- Opens tables #24 & #25: `connector_config` and `sync_run`
-- while keeping M3+ connectors (NetSuite, D365, SAP, Oracle) and M3+ modules strictly blocked.
-- Enforces:
--   - Source system allow-list: 'google_sheets', 'quickbooks_online', 'xero'
--   - Opaque hashed credential_ref (`vault:sha256:<64-hex>`) — zero plaintext credentials in SQL/API/audit (§11.1 CON4)
--   - NUMERIC(28,6) total_debits / total_credits columns (zero float4/float8/real)
--   - Composite company-scoped FKs referencing membership, connector_config, import_batch, and sync_run (D2)
--   - Strict quarantine invariant: mismatched sync_run writes status='quarantined', import_batch_id IS NULL, non-empty reason (CON3)

-- 24. connector_config
CREATE TABLE connector_config (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id),
  source_system  text NOT NULL CHECK (source_system IN ('google_sheets', 'quickbooks_online', 'xero')),
  name           text NOT NULL CHECK (btrim(name) <> ''),
  external_ref   text NOT NULL CHECK (btrim(external_ref) <> ''),
  credential_ref text NOT NULL CHECK (credential_ref ~ '^vault:sha256:[0-9a-f]{64}$'),
  sync_cursor    text,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'revoked')),
  last_synced_at timestamptz,
  created_by     uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, source_system, name),
  FOREIGN KEY (company_id, created_by) REFERENCES membership(company_id, user_id)
);

CREATE INDEX idx_connector_config_company
  ON connector_config (company_id, source_system, status);

-- 25. sync_run
CREATE TABLE sync_run (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES company(id),
  connector_id          uuid NOT NULL,
  mode                  text NOT NULL CHECK (mode IN ('incremental', 'full_repull')),
  status                text NOT NULL CHECK (status IN ('completed', 'replaced', 'quarantined', 'failed')),
  cursor_before         text,
  cursor_after          text,
  source_hash           text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  rows_pulled           int  NOT NULL CHECK (rows_pulled >= 0),
  rows_imported         int  NOT NULL CHECK (rows_imported >= 0),
  rows_quarantined      int  NOT NULL CHECK (rows_quarantined >= 0),
  total_debits          NUMERIC(28,6) NOT NULL CHECK (total_debits >= 0),
  total_credits         NUMERIC(28,6) NOT NULL CHECK (total_credits >= 0),
  reconciliation_status text NOT NULL CHECK (reconciliation_status IN ('matched', 'mismatch_quarantined')),
  reconciliation_reason text,
  import_batch_id       uuid,
  replaced_run_id       uuid,
  triggered_by          uuid NOT NULL,
  started_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz,
  CHECK (
    (reconciliation_status = 'matched' AND status <> 'quarantined') OR
    (reconciliation_status = 'mismatch_quarantined' AND status = 'quarantined' AND import_batch_id IS NULL AND reconciliation_reason IS NOT NULL AND btrim(reconciliation_reason) <> '')
  ),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, connector_id)    REFERENCES connector_config(company_id, id),
  FOREIGN KEY (company_id, import_batch_id) REFERENCES import_batch(company_id, id),
  FOREIGN KEY (company_id, replaced_run_id) REFERENCES sync_run(company_id, id),
  FOREIGN KEY (company_id, triggered_by)    REFERENCES membership(company_id, user_id)
);

CREATE INDEX idx_sync_run_connector_started
  ON sync_run (company_id, connector_id, started_at DESC);
