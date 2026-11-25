-- OneFP&A M2 Collaboration & Workflow Schema (Migration 0002, DEC-017, §11.2, §11.9)
-- Adds approved M2 collaboration tables while keeping all M3+ tables strictly blocked:
--   19. approval_task
--   20. comment
--   21. job
--   22. notification
-- Expands membership.role per §4.3 (M2 RBAC expansion) and enforces:
--   - Composite company-scoped foreign keys on every tenant child reference (D2)
--   - State-machine transition enforcement trigger on approval_task (draft -> submitted -> approved | rejected)
--   - Canonical anchor invariants on comment
--   - Idempotency key uniqueness on job

-- Expand membership.role from single owner (M1) to M2 RBAC roles (§4.3)
ALTER TABLE membership
  DROP CONSTRAINT IF EXISTS membership_role_check;

ALTER TABLE membership
  ADD CONSTRAINT membership_role_check
  CHECK (role IN ('owner', 'editor', 'reviewer', 'viewer'));

-- 19. approval_task (versioned plan approval state machine — §11.9, COL1)
CREATE TABLE approval_task (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES company(id),
  scenario_id     uuid NOT NULL,
  plan_version_id uuid NOT NULL,
  title           text NOT NULL CHECK (btrim(title) <> ''),
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  version         int  NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by      uuid NOT NULL,
  assignee_id     uuid,
  submitted_by    uuid,
  submitted_at    timestamptz,
  decided_by      uuid,
  decided_at      timestamptz,
  decision_reason text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'draft' AND submitted_by IS NULL AND submitted_at IS NULL AND decided_by IS NULL AND decided_at IS NULL) OR
    (status = 'submitted' AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL AND decided_by IS NULL AND decided_at IS NULL) OR
    (status IN ('approved', 'rejected') AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CHECK (status <> 'rejected' OR (decision_reason IS NOT NULL AND btrim(decision_reason) <> '')),
  UNIQUE (company_id, id),
  UNIQUE (company_id, plan_version_id),
  FOREIGN KEY (company_id, scenario_id)     REFERENCES scenario(company_id, id),
  FOREIGN KEY (company_id, plan_version_id) REFERENCES plan_version(company_id, id),
  FOREIGN KEY (company_id, created_by)      REFERENCES membership(company_id, user_id),
  FOREIGN KEY (company_id, assignee_id)     REFERENCES membership(company_id, user_id),
  FOREIGN KEY (company_id, submitted_by)    REFERENCES membership(company_id, user_id),
  FOREIGN KEY (company_id, decided_by)      REFERENCES membership(company_id, user_id)
);
CREATE INDEX idx_approval_task_company_status ON approval_task (company_id, status, updated_at);

CREATE OR REPLACE FUNCTION fn_verify_approval_task_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.company_id <> OLD.company_id OR NEW.plan_version_id <> OLD.plan_version_id THEN
    RAISE EXCEPTION 'WORKFLOW_IMMUTABLE_KEY: cannot change company_id or plan_version_id on approval_task %', OLD.id;
  END IF;

  IF OLD.status = 'draft' AND NEW.status IN ('draft', 'submitted') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'submitted' AND NEW.status IN ('approved', 'rejected') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'INVALID_WORKFLOW_TRANSITION: approval_task % cannot transition from % to %',
    OLD.id, OLD.status, NEW.status;
END;
$$;

CREATE TRIGGER trg_approval_task_state_machine
  BEFORE UPDATE ON approval_task
  FOR EACH ROW
  EXECUTE FUNCTION fn_verify_approval_task_transition();

-- 20. comment (anchored to cell/account/statement_line/version via canonical keys — §11.9, COL2)
CREATE TABLE comment (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES company(id),
  plan_version_id    uuid NOT NULL,
  anchor_kind        text NOT NULL CHECK (anchor_kind IN ('version', 'account', 'cell', 'statement_line')),
  anchor_key         text NOT NULL CHECK (btrim(anchor_key) <> ''),
  account_id         uuid,
  period_id          uuid,
  statement_line_key text REFERENCES statement_line(key),
  author_id          uuid NOT NULL,
  body               text NOT NULL CHECK (btrim(body) <> ''),
  mentioned_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(mentioned_user_ids) = 'array'),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (anchor_kind = 'version'        AND anchor_key = 'version' AND account_id IS NULL AND period_id IS NULL AND statement_line_key IS NULL) OR
    (anchor_kind = 'account'        AND anchor_key LIKE 'account:%' AND account_id IS NOT NULL AND period_id IS NULL AND statement_line_key IS NULL) OR
    (anchor_kind = 'cell'           AND anchor_key LIKE 'cell:%' AND account_id IS NOT NULL AND period_id IS NOT NULL AND statement_line_key IS NULL) OR
    (anchor_kind = 'statement_line' AND anchor_key LIKE 'statement:%' AND account_id IS NULL AND period_id IS NULL AND statement_line_key IS NOT NULL)
  ),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, plan_version_id) REFERENCES plan_version(company_id, id),
  FOREIGN KEY (company_id, account_id)      REFERENCES account(company_id, id),
  FOREIGN KEY (company_id, period_id)       REFERENCES fiscal_period(company_id, id),
  FOREIGN KEY (company_id, author_id)       REFERENCES membership(company_id, user_id)
);
CREATE INDEX idx_comment_company_version ON comment (company_id, plan_version_id, created_at);

-- 21. job (typed async/synchronous background job ledger — §11.2, JOB1–JOB4)
CREATE TABLE job (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES company(id),
  kind            text NOT NULL CHECK (kind IN ('notification.dispatch', 'import.commit', 'export.xlsx', 'export.pdf', 'export.pptx', 'model.recalc', 'sync.run', 'ai.generate', 'corpus.generate')),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  status          text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  attempts        int  NOT NULL DEFAULT 1 CHECK (attempts >= 0),
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_ref      jsonb,
  error_code      text,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  UNIQUE (company_id, id),
  UNIQUE (company_id, kind, idempotency_key),
  FOREIGN KEY (company_id, created_by) REFERENCES membership(company_id, user_id)
);
CREATE INDEX idx_job_company_created ON job (company_id, created_at);

-- 22. notification (in-app inbox notifications dispatched via job queue — §11.9, COL3)
CREATE TABLE notification (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES company(id),
  recipient_id    uuid NOT NULL,
  job_id          uuid NOT NULL,
  event_kind      text NOT NULL CHECK (event_kind IN ('mention', 'approval.submitted', 'approval.approved', 'approval.rejected')),
  plan_version_id uuid NOT NULL,
  task_id         uuid,
  comment_id      uuid,
  title           text NOT NULL CHECK (btrim(title) <> ''),
  body            text NOT NULL CHECK (btrim(body) <> ''),
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, recipient_id)    REFERENCES membership(company_id, user_id),
  FOREIGN KEY (company_id, job_id)          REFERENCES job(company_id, id),
  FOREIGN KEY (company_id, plan_version_id) REFERENCES plan_version(company_id, id),
  FOREIGN KEY (company_id, task_id)         REFERENCES approval_task(company_id, id),
  FOREIGN KEY (company_id, comment_id)      REFERENCES comment(company_id, id)
);
CREATE INDEX idx_notification_recipient_inbox ON notification (company_id, recipient_id, created_at);
