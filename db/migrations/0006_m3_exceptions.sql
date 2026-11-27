-- OneFP&A M3 Exception-Rule Catalog, Owner Exception Inbox & Reversal-Only Rectification Journal
-- (MASTER_PROMPT §2.6, §4.1, §6.6, §7.4, §12.6; DEC-023 / WI-0046)
-- Forward-only migration: adds tables #30–#32 (`exception_finding`, `exception_finding_event`, `rectification_journal`).
-- Every instant column is strictly `timestamptz`; every monetary amount is `NUMERIC(28,6)`.

-- 30. exception_finding
CREATE TABLE exception_finding (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES company(id),
  finding_key        text NOT NULL CHECK (btrim(finding_key) <> ''),
  finding_id_hash    text NOT NULL CHECK (finding_id_hash ~ '^[0-9a-f]{32}$'),
  rule_id            text NOT NULL CHECK (rule_id ~ '^EXC-[0-9]{3}$'),
  title              text NOT NULL CHECK (btrim(title) <> ''),
  severity           text NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  status             text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'acknowledged', 'explained', 'corrected', 'verified', 'closed', 'waived')),
  period_id          uuid NOT NULL,
  account_code       text,
  statement_line_key text,
  grain_key          text NOT NULL CHECK (btrim(grain_key) <> ''),
  amount             NUMERIC(28,6) NOT NULL DEFAULT 0,
  owner_user_id      uuid,
  due_date           date NOT NULL,
  explanation_note   text,
  waiver_reason      text,
  waiver_expires_at  timestamptz,
  evidence_json      jsonb NOT NULL DEFAULT '{}'::jsonb,
  suggestion_json    jsonb NOT NULL DEFAULT '{}'::jsonb,
  version            int NOT NULL DEFAULT 1 CHECK (version >= 1),
  detected_at        timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid NOT NULL,
  CHECK (
    status <> 'waived'
    OR (waiver_reason IS NOT NULL AND btrim(waiver_reason) <> '' AND waiver_expires_at IS NOT NULL)
  ),
  UNIQUE (company_id, id),
  UNIQUE (company_id, finding_key),
  FOREIGN KEY (company_id, period_id)     REFERENCES fiscal_period(company_id, id),
  FOREIGN KEY (company_id, owner_user_id) REFERENCES membership(company_id, user_id),
  FOREIGN KEY (company_id, updated_by)    REFERENCES membership(company_id, user_id)
);

CREATE INDEX idx_exception_finding_company_period_status
  ON exception_finding (company_id, period_id, status, severity);
CREATE INDEX idx_exception_finding_company_owner
  ON exception_finding (company_id, owner_user_id, status);

-- 31. exception_finding_event (append-only lifecycle audit table)
CREATE TABLE exception_finding_event (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id),
  finding_id     uuid NOT NULL,
  from_status    text CHECK (from_status IS NULL OR from_status IN ('new', 'acknowledged', 'explained', 'corrected', 'verified', 'closed', 'waived')),
  to_status      text NOT NULL CHECK (to_status IN ('new', 'acknowledged', 'explained', 'corrected', 'verified', 'closed', 'waived')),
  action         text NOT NULL CHECK (action IN ('detected', 'reopened', 'assign', 'acknowledge', 'explain', 'correct', 'verify', 'close', 'waive')),
  note           text,
  actor_id       uuid NOT NULL,
  audit_entry_id uuid NOT NULL REFERENCES audit_log(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, finding_id) REFERENCES exception_finding(company_id, id),
  FOREIGN KEY (company_id, actor_id)   REFERENCES membership(company_id, user_id)
);

CREATE INDEX idx_exception_finding_event_company_finding
  ON exception_finding_event (company_id, finding_id, created_at DESC);

CREATE OR REPLACE FUNCTION enforce_exception_finding_event_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'EXCEPTION_EVENT_IMMUTABLE: exception_finding_event is append-only; % is forbidden', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_exception_finding_event_immutable
  BEFORE UPDATE OR DELETE ON exception_finding_event
  FOR EACH ROW
  EXECUTE FUNCTION enforce_exception_finding_event_immutable();

-- 32. rectification_journal (reversal-only correction proposals & posted GL links)
CREATE TABLE rectification_journal (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES company(id),
  finding_id       uuid NOT NULL,
  target_period_id uuid NOT NULL,
  mode             text NOT NULL CHECK (mode IN ('post_reversal', 'export_csv', 'dismiss')),
  suggestion_kind  text NOT NULL CHECK (suggestion_kind IN (
    'reverse', 'repost', 'reverse_and_repost', 'reclass', 'reclass_dimension',
    'accrue', 'release_accrual', 'clear_suspense', 'move_period',
    'investigate', 'commentary', 'none'
  )),
  basis            text NOT NULL CHECK (btrim(basis) <> ''),
  erp_hint         text NOT NULL CHECK (btrim(erp_hint) <> ''),
  lines_json       jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_debit      NUMERIC(28,6) NOT NULL DEFAULT 0 CHECK (total_debit >= 0),
  total_credit     NUMERIC(28,6) NOT NULL DEFAULT 0 CHECK (total_credit >= 0),
  posted_batch_id  uuid,
  csv_payload      text,
  note             text,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (total_debit = total_credit),
  CHECK (mode <> 'dismiss' OR (note IS NOT NULL AND btrim(note) <> '')),
  UNIQUE (company_id, id),
  UNIQUE (company_id, finding_id),
  FOREIGN KEY (company_id, finding_id)       REFERENCES exception_finding(company_id, id),
  FOREIGN KEY (company_id, target_period_id) REFERENCES fiscal_period(company_id, id),
  FOREIGN KEY (company_id, posted_batch_id)  REFERENCES import_batch(company_id, id),
  FOREIGN KEY (company_id, created_by)       REFERENCES membership(company_id, user_id)
);

CREATE INDEX idx_rectification_journal_company_period
  ON rectification_journal (company_id, target_period_id, created_at DESC);
