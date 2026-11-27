-- OneFP&A M3 Close Management & Period Locks Schema (Migration 0005, DEC-022, §12.6 CLS1–CLS4)
-- Opens tables #26–#29:
--   26. close_task_template
--   27. close_cycle (NO hand-set status column — status is derived purely from tasks + reconciliation + period lock per CLS4)
--   28. close_task
--   29. period_lock_event (append-only immutable lock/unlock history per CLS3)
-- Plus extends `fiscal_period` with `lock_status` ('open' | 'soft_closed' | 'hard_closed'),
-- `lock_updated_at`, and `lock_updated_by`.
-- Keeps CapEx, Sales, Treasury, FX, Consolidation, NetSuite, D365, SAP, Oracle blocked in schema-scope.

ALTER TABLE fiscal_period
  ADD COLUMN lock_status text NOT NULL DEFAULT 'open'
    CHECK (lock_status IN ('open', 'soft_closed', 'hard_closed')),
  ADD COLUMN lock_updated_at timestamptz,
  ADD COLUMN lock_updated_by uuid,
  ADD CONSTRAINT fk_fiscal_period_lock_actor
    FOREIGN KEY (company_id, lock_updated_by) REFERENCES membership(company_id, user_id);

-- 26. close_task_template (company close calendar DAG definition — §12.6 CLS1)
CREATE TABLE close_task_template (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES company(id),
  task_key                text NOT NULL CHECK (task_key ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  title                   text NOT NULL CHECK (btrim(title) <> ''),
  category                text NOT NULL CHECK (category IN ('import', 'reconciliation', 'review', 'reporting', 'lock')),
  owner_role              text NOT NULL CHECK (owner_role IN ('owner', 'editor', 'reviewer')),
  due_day_offset          int  NOT NULL CHECK (due_day_offset BETWEEN -30 AND 60),
  prerequisite_keys       text[] NOT NULL DEFAULT '{}',
  requires_reconciliation boolean NOT NULL DEFAULT false,
  sort_order              int  NOT NULL CHECK (sort_order >= 0),
  active                  boolean NOT NULL DEFAULT true,
  created_by              uuid NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, task_key),
  FOREIGN KEY (company_id, created_by) REFERENCES membership(company_id, user_id)
);
CREATE INDEX idx_close_task_template_company ON close_task_template (company_id, sort_order, task_key);

-- 27. close_cycle (per-period close instance; intentionally has ZERO mutable status column — CLS4)
CREATE TABLE close_cycle (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company(id),
  period_id  uuid NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, period_id),
  FOREIGN KEY (company_id, period_id)  REFERENCES fiscal_period(company_id, id),
  FOREIGN KEY (company_id, created_by) REFERENCES membership(company_id, user_id)
);
CREATE INDEX idx_close_cycle_company_period ON close_cycle (company_id, period_id);

-- 28. close_task (period close task instances with DAG prerequisites & audited sign-off — CLS1, CLS2)
CREATE TABLE close_task (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES company(id),
  cycle_id                uuid NOT NULL,
  template_id             uuid,
  task_key                text NOT NULL CHECK (task_key ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  title                   text NOT NULL CHECK (btrim(title) <> ''),
  category                text NOT NULL CHECK (category IN ('import', 'reconciliation', 'review', 'reporting', 'lock')),
  owner_role              text NOT NULL CHECK (owner_role IN ('owner', 'editor', 'reviewer')),
  assigned_user_id        uuid,
  due_date                date NOT NULL,
  prerequisite_keys       text[] NOT NULL DEFAULT '{}',
  requires_reconciliation boolean NOT NULL DEFAULT false,
  status                  text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'signed_off', 'reopened')),
  sort_order              int  NOT NULL CHECK (sort_order >= 0),
  signed_off_by           uuid,
  signed_off_at           timestamptz,
  signoff_note            text,
  version                 int  NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'signed_off' AND signed_off_by IS NOT NULL AND signed_off_at IS NOT NULL) OR
    (status <> 'signed_off' AND signed_off_by IS NULL AND signed_off_at IS NULL)
  ),
  UNIQUE (company_id, id),
  UNIQUE (company_id, cycle_id, task_key),
  FOREIGN KEY (company_id, cycle_id)         REFERENCES close_cycle(company_id, id),
  FOREIGN KEY (company_id, template_id)      REFERENCES close_task_template(company_id, id),
  FOREIGN KEY (company_id, assigned_user_id) REFERENCES membership(company_id, user_id),
  FOREIGN KEY (company_id, signed_off_by)    REFERENCES membership(company_id, user_id)
);
CREATE INDEX idx_close_task_cycle_order ON close_task (company_id, cycle_id, sort_order, task_key);

-- 29. period_lock_event (append-only immutable lock/unlock history linked to audit_log — CLS3)
CREATE TABLE period_lock_event (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id),
  period_id      uuid NOT NULL,
  from_status    text NOT NULL CHECK (from_status IN ('open', 'soft_closed', 'hard_closed')),
  to_status      text NOT NULL CHECK (to_status IN ('open', 'soft_closed', 'hard_closed')),
  action         text NOT NULL CHECK (action IN ('soft_close', 'hard_close', 'unlock')),
  reason         text NOT NULL CHECK (btrim(reason) <> ''),
  actor_id       uuid NOT NULL,
  audit_entry_id uuid NOT NULL REFERENCES audit_log(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (from_status <> to_status),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, period_id) REFERENCES fiscal_period(company_id, id),
  FOREIGN KEY (company_id, actor_id)  REFERENCES membership(company_id, user_id)
);
CREATE INDEX idx_period_lock_event_company_period
  ON period_lock_event (company_id, period_id, created_at DESC);

CREATE OR REPLACE FUNCTION fn_forbid_period_lock_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PERIOD_LOCK_EVENT_IMMUTABLE: % on period_lock_event is forbidden (§12.6, CLS3)', TG_OP;
END;
$$;

CREATE TRIGGER trg_period_lock_event_append_only
  BEFORE UPDATE OR DELETE ON period_lock_event
  FOR EACH ROW
  EXECUTE FUNCTION fn_forbid_period_lock_event_mutation();
