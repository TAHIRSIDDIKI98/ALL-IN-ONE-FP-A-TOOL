-- OneFP&A M2 Workforce Module Schema (Migration 0003, DEC-018, §2.4, §4.1–§4.3)
-- Opens table #23: `workforce_position` (position-based headcount & payroll roster)
-- while keeping M3+ modules (CapEx, Sales, Cash/Treasury, Consolidation, FX) strictly blocked.
-- Enforces:
--   - NUMERIC(28,6) columns for salary, FTE, burden, bonus, ramp, and merit ratios
--   - Composite company-scoped FKs referencing account(company_id, id) and membership(company_id, user_id)
--   - Non-negative financial constraints and valid status check

CREATE TABLE workforce_position (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES company(id),
  position_code         text NOT NULL CHECK (btrim(position_code) <> '' AND position_code = regexp_replace(btrim(position_code), '\s+', ' ', 'g')),
  title                 text NOT NULL CHECK (btrim(title) <> ''),
  department_name       text NOT NULL CHECK (btrim(department_name) <> ''),
  account_id            uuid NOT NULL,
  start_period_code     text NOT NULL CHECK (btrim(start_period_code) <> ''),
  end_period_code       text CHECK (end_period_code IS NULL OR btrim(end_period_code) <> ''),
  fte                   NUMERIC(28,6) NOT NULL CHECK (fte >= 0),
  annual_salary         NUMERIC(28,6) NOT NULL CHECK (annual_salary >= 0),
  burden_rate           NUMERIC(28,6) NOT NULL DEFAULT 0 CHECK (burden_rate >= 0),
  bonus_rate            NUMERIC(28,6) NOT NULL DEFAULT 0 CHECK (bonus_rate >= 0),
  ramp_first_period_pct NUMERIC(28,6) NOT NULL DEFAULT 1 CHECK (ramp_first_period_pct >= 0 AND ramp_first_period_pct <= 1),
  merit_period_code     text CHECK (merit_period_code IS NULL OR btrim(merit_period_code) <> ''),
  merit_increase_pct    NUMERIC(28,6) NOT NULL DEFAULT 0 CHECK (merit_increase_pct >= 0),
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, position_code),
  FOREIGN KEY (company_id, account_id) REFERENCES account(company_id, id),
  FOREIGN KEY (company_id, created_by) REFERENCES membership(company_id, user_id)
);

CREATE INDEX idx_workforce_position_company
  ON workforce_position (company_id, status, position_code);
