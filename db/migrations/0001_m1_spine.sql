-- OneFP&A M1 Spine Schema (Migration 0001)
-- Enforces MASTER_PROMPT Part 4 (§4.1–§4.9):
--   - Exact 18 approved M1 tables (enforced by scripts/schema-scope.mjs)
--   - NUMERIC(28,6) money columns (zero float4/float8/real)
--   - Composite company-scoped foreign keys preventing cross-tenant references (D2)
--   - DEFERRABLE INITIALLY DEFERRED journal balance trigger (D3)
--   - gl_line single-sided positive debit/credit CHECK constraints (D4)
--   - Atomic idempotent import batch active-source uniqueness + row accounting trigger (D5)
--   - plan_line UNIQUE NULLS NOT DISTINCT preventing duplicates even when department_id IS NULL (D6)
--   - Append-only audit_log protected by BEFORE UPDATE OR DELETE trigger (D7)

-- 1. app_user
CREATE TABLE app_user (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid text NOT NULL UNIQUE,
  email        text NOT NULL,
  display_name text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 2. company
CREATE TABLE company (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  base_currency      text NOT NULL CHECK (char_length(base_currency) = 3),
  fiscal_calendar_id uuid,
  coa_version        int  NOT NULL DEFAULT 1 CHECK (coa_version >= 1),
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- 3. membership
CREATE TABLE membership (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company(id),
  user_id    uuid NOT NULL REFERENCES app_user(id),
  role       text NOT NULL CHECK (role IN ('owner')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, user_id)
);

-- 4. fiscal_calendar
CREATE TABLE fiscal_calendar (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES company(id),
  kind               text NOT NULL CHECK (kind IN ('12month', '445', '454', '544', '52_53', '13x4')),
  year_start_month   int  NOT NULL CHECK (year_start_month BETWEEN 1 AND 12),
  week_anchor        text NOT NULL DEFAULT 'sunday-nearest',
  w53_rule           text NOT NULL DEFAULT 'nrf4day' CHECK (w53_rule IN ('nrf4day', 'fullweek')),
  include_adjustment boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id)
);

ALTER TABLE company
  ADD CONSTRAINT fk_company_fiscal_calendar
  FOREIGN KEY (id, fiscal_calendar_id)
  REFERENCES fiscal_calendar(company_id, id)
  DEFERRABLE INITIALLY DEFERRED;

-- 5. fiscal_period
CREATE TABLE fiscal_period (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES company(id),
  fiscal_calendar_id uuid NOT NULL,
  fiscal_year        int  NOT NULL CHECK (fiscal_year BETWEEN 1900 AND 2200),
  period_no          int  NOT NULL CHECK (period_no BETWEEN 1 AND 14),
  code               text NOT NULL,
  label              text NOT NULL,
  quarter            int  NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  start_date         date NOT NULL,
  end_date           date NOT NULL,
  is_53rd_week       boolean NOT NULL DEFAULT false,
  is_adjustment      boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  UNIQUE (company_id, id),
  UNIQUE (company_id, fiscal_calendar_id, fiscal_year, period_no),
  UNIQUE (company_id, fiscal_calendar_id, fiscal_year, code),
  FOREIGN KEY (company_id, fiscal_calendar_id) REFERENCES fiscal_calendar(company_id, id)
);
CREATE INDEX idx_fiscal_period_company_dates ON fiscal_period (company_id, start_date, end_date);

-- 6. statement_line (canonical vocabulary — §4.4, §4.5)
CREATE TABLE statement_line (
  key        text PRIMARY KEY,
  statement  text NOT NULL CHECK (statement IN ('pl', 'bs', 'cf')),
  label      text NOT NULL,
  sort_order int  NOT NULL,
  sign_rule  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (statement, sort_order)
);

-- 7. account
CREATE TABLE account (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES company(id),
  code               text NOT NULL CHECK (btrim(code) <> '' AND code = regexp_replace(btrim(code), '\s+', ' ', 'g')),
  name               text NOT NULL CHECK (btrim(name) <> ''),
  type               text NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  normal_side        text NOT NULL CHECK (normal_side IN ('debit', 'credit')),
  is_contra          boolean NOT NULL DEFAULT false,
  parent_id          uuid,
  is_postable        boolean NOT NULL DEFAULT true,
  statement_line_key text NOT NULL REFERENCES statement_line(key),
  version            int  NOT NULL DEFAULT 1 CHECK (version >= 1),
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (
    is_contra OR (
      (type IN ('asset', 'expense') AND normal_side = 'debit') OR
      (type IN ('liability', 'equity', 'revenue') AND normal_side = 'credit')
    )
  ),
  UNIQUE (company_id, id),
  UNIQUE (company_id, code),
  FOREIGN KEY (company_id, parent_id) REFERENCES account(company_id, id)
);

-- 8. entity
CREATE TABLE entity (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company(id),
  code       text NOT NULL CHECK (btrim(code) <> '' AND code = regexp_replace(btrim(code), '\s+', ' ', 'g')),
  name       text NOT NULL CHECK (btrim(name) <> ''),
  currency   text NOT NULL CHECK (char_length(currency) = 3),
  parent_id  uuid,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, code),
  FOREIGN KEY (company_id, parent_id) REFERENCES entity(company_id, id)
);

-- 9. department
CREATE TABLE department (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company(id),
  code       text NOT NULL CHECK (btrim(code) <> '' AND code = regexp_replace(btrim(code), '\s+', ' ', 'g')),
  name       text NOT NULL CHECK (btrim(name) <> ''),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, code)
);

-- 10. coa_mapping
CREATE TABLE coa_mapping (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES company(id),
  source_system     text NOT NULL,
  source_code       text NOT NULL CHECK (btrim(source_code) <> '' AND source_code = regexp_replace(btrim(source_code), '\s+', ' ', 'g')),
  account_id        uuid,
  mapping_version   int  NOT NULL DEFAULT 1 CHECK (mapping_version >= 1),
  effective_from    date NOT NULL DEFAULT CURRENT_DATE,
  status            text NOT NULL CHECK (status IN ('mapped', 'quarantined')),
  quarantine_reason text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'mapped' AND account_id IS NOT NULL) OR (status = 'quarantined' AND quarantine_reason IS NOT NULL)),
  UNIQUE (company_id, id),
  UNIQUE (company_id, source_system, source_code, mapping_version),
  FOREIGN KEY (company_id, account_id) REFERENCES account(company_id, id)
);

-- 11. import_batch
CREATE TABLE import_batch (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES company(id),
  kind              text NOT NULL CHECK (kind IN ('actuals', 'budget')),
  source_filename   text NOT NULL,
  source_hash       text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  row_count         int  NOT NULL CHECK (row_count >= 0),
  status            text NOT NULL CHECK (status IN ('staged', 'committed', 'replaced', 'failed')),
  replaced_batch_id uuid,
  imported_by       uuid NOT NULL REFERENCES app_user(id),
  imported_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, replaced_batch_id) REFERENCES import_batch(company_id, id)
);

CREATE UNIQUE INDEX uq_import_batch_active_source
  ON import_batch (company_id, kind, source_hash)
  WHERE status IN ('staged', 'committed');

-- 12. import_row_raw
CREATE TABLE import_row_raw (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES company(id),
  batch_id          uuid NOT NULL,
  row_no            int  NOT NULL CHECK (row_no >= 1),
  raw_payload       jsonb NOT NULL,
  parsed_fields     jsonb,
  status            text NOT NULL CHECK (status IN ('imported', 'quarantined')),
  quarantine_reason text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'imported' OR quarantine_reason IS NOT NULL),
  UNIQUE (company_id, id),
  UNIQUE (batch_id, row_no),
  FOREIGN KEY (company_id, batch_id) REFERENCES import_batch(company_id, id)
);

-- 13. gl_entry
CREATE TABLE gl_entry (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES company(id),
  batch_id     uuid NOT NULL,
  period_id    uuid NOT NULL,
  entity_id    uuid NOT NULL,
  entry_date   date NOT NULL,
  source_ref   text,
  currency     text NOT NULL CHECK (char_length(currency) = 3),
  total_debit  NUMERIC(28,6) NOT NULL CHECK (total_debit >= 0),
  total_credit NUMERIC(28,6) NOT NULL CHECK (total_credit >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (total_debit = total_credit),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, batch_id)  REFERENCES import_batch(company_id, id),
  FOREIGN KEY (company_id, period_id) REFERENCES fiscal_period(company_id, id),
  FOREIGN KEY (company_id, entity_id) REFERENCES entity(company_id, id)
);

-- 14. gl_line
CREATE TABLE gl_line (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES company(id),
  entry_id      uuid NOT NULL,
  account_id    uuid NOT NULL,
  period_id     uuid NOT NULL,
  entity_id     uuid NOT NULL,
  department_id uuid,
  debit         NUMERIC(28,6) NOT NULL DEFAULT 0,
  credit        NUMERIC(28,6) NOT NULL DEFAULT 0,
  source_row_id uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (debit >= 0 AND credit >= 0),
  CHECK ((debit = 0) <> (credit = 0)),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, entry_id)      REFERENCES gl_entry(company_id, id),
  FOREIGN KEY (company_id, account_id)    REFERENCES account(company_id, id),
  FOREIGN KEY (company_id, period_id)     REFERENCES fiscal_period(company_id, id),
  FOREIGN KEY (company_id, entity_id)     REFERENCES entity(company_id, id),
  FOREIGN KEY (company_id, department_id) REFERENCES department(company_id, id),
  FOREIGN KEY (company_id, source_row_id) REFERENCES import_row_raw(company_id, id)
);
CREATE INDEX idx_gl_line_company_period_account ON gl_line (company_id, period_id, account_id);
CREATE INDEX idx_gl_line_company_entity_period  ON gl_line (company_id, entity_id, period_id);

-- 15. scenario
CREATE TABLE scenario (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES company(id),
  kind             text NOT NULL CHECK (kind IN ('actual', 'budget', 'forecast')),
  name             text NOT NULL CHECK (btrim(name) <> ''),
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'locked')),
  base_scenario_id uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, name),
  FOREIGN KEY (company_id, base_scenario_id) REFERENCES scenario(company_id, id)
);

-- 16. plan_version
CREATE TABLE plan_version (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES company(id),
  scenario_id uuid NOT NULL,
  version_no  int  NOT NULL CHECK (version_no >= 1),
  label       text NOT NULL CHECK (btrim(label) <> ''),
  is_current  boolean NOT NULL DEFAULT true,
  locked_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, scenario_id, version_no),
  FOREIGN KEY (company_id, scenario_id) REFERENCES scenario(company_id, id)
);

-- 17. plan_line
CREATE TABLE plan_line (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES company(id),
  scenario_id   uuid NOT NULL,
  version_id    uuid NOT NULL,
  account_id    uuid NOT NULL,
  period_id     uuid NOT NULL,
  entity_id     uuid NOT NULL,
  department_id uuid,
  amount        NUMERIC(28,6) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE NULLS NOT DISTINCT (company_id, scenario_id, version_id, account_id, period_id, entity_id, department_id),
  FOREIGN KEY (company_id, scenario_id)   REFERENCES scenario(company_id, id),
  FOREIGN KEY (company_id, version_id)    REFERENCES plan_version(company_id, id),
  FOREIGN KEY (company_id, account_id)    REFERENCES account(company_id, id),
  FOREIGN KEY (company_id, period_id)     REFERENCES fiscal_period(company_id, id),
  FOREIGN KEY (company_id, entity_id)     REFERENCES entity(company_id, id),
  FOREIGN KEY (company_id, department_id) REFERENCES department(company_id, id)
);

-- 18. audit_log (append-only hash chain — §4.4, D7)
CREATE TABLE audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES company(id),
  actor_id     uuid NOT NULL REFERENCES app_user(id),
  action       text NOT NULL,
  target_table text NOT NULL,
  target_id    uuid NOT NULL,
  old_payload  jsonb,
  new_payload  jsonb,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  prev_hash    text NOT NULL CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  entry_hash   text NOT NULL CHECK (entry_hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_log_company_occurred ON audit_log (company_id, occurred_at, id);

-- =============================================================================
-- INTEGRITY TRIGGERS
-- =============================================================================

-- D3: Deferred constraint trigger asserting SUM(gl_line.debit) = SUM(gl_line.credit) = gl_entry header totals at COMMIT
CREATE OR REPLACE FUNCTION fn_verify_gl_entry_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry_id uuid;
  v_header_debit  NUMERIC(28,6);
  v_header_credit NUMERIC(28,6);
  v_sum_debit     NUMERIC(28,6);
  v_sum_credit    NUMERIC(28,6);
  v_line_count    int;
BEGIN
  v_entry_id := COALESCE(NEW.entry_id, OLD.entry_id);
  IF v_entry_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT total_debit, total_credit
    INTO v_header_debit, v_header_credit
    FROM gl_entry
   WHERE id = v_entry_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0), COUNT(*)
    INTO v_sum_debit, v_sum_credit, v_line_count
    FROM gl_line
   WHERE entry_id = v_entry_id;

  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'GL_ENTRY_EMPTY: gl_entry % has zero gl_line rows at COMMIT', v_entry_id;
  END IF;

  IF v_sum_debit <> v_sum_credit OR v_sum_debit <> v_header_debit OR v_sum_credit <> v_header_credit THEN
    RAISE EXCEPTION 'TRIAL_BALANCE_IMBALANCE: gl_entry % lines (debit=%, credit=%) do not match balanced header (debit=%, credit=%)',
      v_entry_id, v_sum_debit, v_sum_credit, v_header_debit, v_header_credit;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION fn_verify_gl_entry_header_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_sum_debit  NUMERIC(28,6);
  v_sum_credit NUMERIC(28,6);
  v_line_count int;
BEGIN
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0), COUNT(*)
    INTO v_sum_debit, v_sum_credit, v_line_count
    FROM gl_line
   WHERE entry_id = NEW.id;

  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'GL_ENTRY_EMPTY: gl_entry % has zero gl_line rows at COMMIT', NEW.id;
  END IF;

  IF v_sum_debit <> v_sum_credit OR v_sum_debit <> NEW.total_debit OR v_sum_credit <> NEW.total_credit THEN
    RAISE EXCEPTION 'TRIAL_BALANCE_IMBALANCE: gl_entry % lines (debit=%, credit=%) do not match balanced header (debit=%, credit=%)',
      NEW.id, v_sum_debit, v_sum_credit, NEW.total_debit, NEW.total_credit;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_gl_entry_balance_header
  AFTER INSERT OR UPDATE ON gl_entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION fn_verify_gl_entry_header_balance();

CREATE CONSTRAINT TRIGGER trg_gl_line_balance_lines
  AFTER INSERT OR UPDATE OR DELETE ON gl_line
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION fn_verify_gl_entry_balance();

-- D5: Deferred constraint trigger asserting imported + quarantined == row_count on committed import_batch
CREATE OR REPLACE FUNCTION fn_verify_import_batch_row_accounting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_batch_id uuid;
  v_status   text;
  v_expected int;
  v_actual   int;
BEGIN
  IF TG_TABLE_NAME = 'import_batch' THEN
    v_batch_id := NEW.id;
  ELSE
    v_batch_id := COALESCE(NEW.batch_id, OLD.batch_id);
  END IF;

  SELECT status, row_count
    INTO v_status, v_expected
    FROM import_batch
   WHERE id = v_batch_id;

  IF NOT FOUND OR v_status <> 'committed' THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*)
    INTO v_actual
    FROM import_row_raw
   WHERE batch_id = v_batch_id
     AND status IN ('imported', 'quarantined');

  IF v_actual <> v_expected THEN
    RAISE EXCEPTION 'IMPORT_ROW_ACCOUNTING_FAILED: batch % expects row_count=%, got imported+quarantined=%',
      v_batch_id, v_expected, v_actual;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_import_batch_row_accounting
  AFTER INSERT OR UPDATE ON import_batch
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION fn_verify_import_batch_row_accounting();

CREATE CONSTRAINT TRIGGER trg_import_row_raw_accounting
  AFTER INSERT OR UPDATE OR DELETE ON import_row_raw
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION fn_verify_import_batch_row_accounting();

-- D7: Append-only audit_log enforcement (forbids UPDATE and DELETE)
CREATE OR REPLACE FUNCTION fn_forbid_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_LOG_IMMUTABLE: % on audit_log is forbidden (§4.4, D7)', TG_OP;
END;
$$;

CREATE TRIGGER trg_audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION fn_forbid_audit_log_mutation();
