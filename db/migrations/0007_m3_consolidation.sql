-- M3 Multi-Entity, Multi-Currency & Consolidation Schema (MASTER_PROMPT §4.2, §11.6 FX1-FX5, DEC-024)
-- Forward-only migration adding tables #33-#36:
--   33. fx_rate
--   34. entity_ownership
--   35. intercompany_rule
--   36. consolidation_run (append-only immutable snapshot)

-- 33. fx_rate (sourced & audited currency exchange rates, never AI-generated — FX5)
CREATE TABLE fx_rate (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id),
  base_currency  text NOT NULL CHECK (char_length(base_currency) = 3 AND base_currency = upper(base_currency)),
  quote_currency text NOT NULL CHECK (char_length(quote_currency) = 3 AND quote_currency = upper(quote_currency)),
  rate_type      text NOT NULL CHECK (rate_type IN ('closing', 'average', 'historical')),
  as_of_date     date NOT NULL,
  rate           NUMERIC(28,12) NOT NULL CHECK (rate > 0),
  source         text NOT NULL CHECK (source IN ('manual', 'ecb', 'fed', 'bloomberg', 'erp_feed')),
  created_by     uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (base_currency <> quote_currency),
  UNIQUE (company_id, id),
  UNIQUE (company_id, base_currency, quote_currency, rate_type, as_of_date),
  FOREIGN KEY (company_id, created_by) REFERENCES membership(company_id, user_id)
);

CREATE INDEX idx_fx_rate_lookup
  ON fx_rate (company_id, base_currency, quote_currency, rate_type, as_of_date DESC);

-- 34. entity_ownership (multi-entity ownership %, consolidation method, and NCI basis — FX4)
CREATE TABLE entity_ownership (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES company(id),
  parent_entity_id     uuid NOT NULL,
  child_entity_id      uuid NOT NULL,
  ownership_pct        NUMERIC(9,6) NOT NULL CHECK (ownership_pct > 0 AND ownership_pct <= 100),
  consolidation_method text NOT NULL CHECK (consolidation_method IN ('full', 'equity', 'cost')),
  effective_from       date NOT NULL DEFAULT CURRENT_DATE,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_entity_id <> child_entity_id),
  UNIQUE (company_id, id),
  UNIQUE (company_id, parent_entity_id, child_entity_id),
  FOREIGN KEY (company_id, parent_entity_id) REFERENCES entity(company_id, id),
  FOREIGN KEY (company_id, child_entity_id)  REFERENCES entity(company_id, id)
);

CREATE INDEX idx_entity_ownership_company
  ON entity_ownership (company_id, parent_entity_id, child_entity_id);

-- 35. intercompany_rule (declared entity-pair account elimination mappings — FX3)
CREATE TABLE intercompany_rule (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES company(id),
  from_entity_id  uuid NOT NULL,
  from_account_id uuid NOT NULL,
  to_entity_id    uuid NOT NULL,
  to_account_id   uuid NOT NULL,
  rule_type       text NOT NULL CHECK (rule_type IN (
    'ic_receivable_payable', 'ic_revenue_expense', 'ic_investment_equity', 'ic_dividend', 'ic_loan'
  )),
  description     text NOT NULL CHECK (btrim(description) <> ''),
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (from_entity_id <> to_entity_id),
  UNIQUE (company_id, id),
  UNIQUE (company_id, from_entity_id, from_account_id, to_entity_id, to_account_id),
  FOREIGN KEY (company_id, from_entity_id)  REFERENCES entity(company_id, id),
  FOREIGN KEY (company_id, from_account_id) REFERENCES account(company_id, id),
  FOREIGN KEY (company_id, to_entity_id)    REFERENCES entity(company_id, id),
  FOREIGN KEY (company_id, to_account_id)   REFERENCES account(company_id, id)
);

CREATE INDEX idx_intercompany_rule_company_active
  ON intercompany_rule (company_id, active);

-- 36. consolidation_run (append-only immutable consolidation ledger with CTA, NCI, eliminations & residual counts — FX1-FX4)
CREATE TABLE consolidation_run (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES company(id),
  fiscal_year          int  NOT NULL CHECK (fiscal_year BETWEEN 1900 AND 2200),
  period_id            uuid NOT NULL,
  reporting_currency   text NOT NULL CHECK (char_length(reporting_currency) = 3 AND reporting_currency = upper(reporting_currency)),
  status               text NOT NULL CHECK (status IN ('completed', 'quarantined_residuals', 'failed')),
  group_tb_balanced    boolean NOT NULL,
  group_bs_balanced    boolean NOT NULL,
  total_assets         NUMERIC(28,6) NOT NULL,
  total_liabilities    NUMERIC(28,6) NOT NULL,
  total_equity         NUMERIC(28,6) NOT NULL,
  total_cta            NUMERIC(28,6) NOT NULL,
  minority_interest    NUMERIC(28,6) NOT NULL,
  total_eliminations   NUMERIC(28,6) NOT NULL,
  unmatched_ic_count   int NOT NULL CHECK (unmatched_ic_count >= 0),
  snapshot_json        jsonb NOT NULL,
  executed_by          uuid NOT NULL,
  audit_entry_id       uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, period_id)      REFERENCES fiscal_period(company_id, id),
  FOREIGN KEY (company_id, executed_by)    REFERENCES membership(company_id, user_id),
  FOREIGN KEY (audit_entry_id)             REFERENCES audit_log(id)
);

CREATE INDEX idx_consolidation_run_company_period
  ON consolidation_run (company_id, fiscal_year, period_id, created_at DESC);

CREATE OR REPLACE FUNCTION enforce_consolidation_run_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'CONSOLIDATION_RUN_IMMUTABLE: consolidation_run is append-only (MASTER_PROMPT §11.6)';
END;
$$;

CREATE TRIGGER trg_consolidation_run_immutable
  BEFORE UPDATE OR DELETE ON consolidation_run
  FOR EACH ROW
  EXECUTE FUNCTION enforce_consolidation_run_immutable();
