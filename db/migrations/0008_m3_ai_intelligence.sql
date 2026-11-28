-- M3 AI Intelligence, Cited Variance Commentary & Guarded Formulas Schema (MASTER_PROMPT §10.3, §12.3-12.7, SPEC.md §7.3 WI-0048B, DEC-026)
-- Forward-only migration adding tables #37-#39:
--   37. ai_policy_config (tenant AI feature consent & rate limits)
--   38. narrative_commentary (versioned, cited AI commentary with status workflow NAR1-NAR4)
--   39. ai_egress_audit (append-only immutable egress audit log with redaction metrics AI1, MG1-MG4)

-- 37. ai_policy_config
CREATE TABLE ai_policy_config (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES company(id) UNIQUE,
  ai_enabled            boolean NOT NULL DEFAULT false,
  consent_notice_version text NOT NULL DEFAULT 'v1',
  consent_recorded_at   timestamptz,
  consent_recorded_by   uuid,
  max_requests_per_hour int NOT NULL DEFAULT 60 CHECK (max_requests_per_hour > 0),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, consent_recorded_by) REFERENCES membership(company_id, user_id)
);

CREATE INDEX idx_ai_policy_config_company ON ai_policy_config (company_id);

-- 38. narrative_commentary (versioned commentary audit trail NAR1-NAR4)
CREATE TABLE narrative_commentary (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES company(id),
  period_id             uuid NOT NULL,
  statement_line_key    text NOT NULL,
  version_no            int NOT NULL CHECK (version_no >= 1),
  status                text NOT NULL CHECK (status IN ('ai_draft', 'human_edited', 'approved', 'locked')),
  provenance            text NOT NULL CHECK (provenance IN ('ai_draft', 'deterministic_fallback', 'human_edited')),
  disclosure            text NOT NULL,
  sentences_json        jsonb NOT NULL,
  citation_coverage_pct text NOT NULL,
  created_by            uuid,
  approved_by           uuid,
  approved_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, period_id, statement_line_key, version_no),
  FOREIGN KEY (company_id, period_id)          REFERENCES fiscal_period(company_id, id),
  FOREIGN KEY (statement_line_key)             REFERENCES statement_line(key),
  FOREIGN KEY (company_id, created_by)         REFERENCES membership(company_id, user_id),
  FOREIGN KEY (company_id, approved_by)        REFERENCES membership(company_id, user_id)
);

CREATE INDEX idx_narrative_commentary_lookup
  ON narrative_commentary (company_id, period_id, statement_line_key, version_no DESC);

-- 39. ai_egress_audit (append-only immutable egress audit log with redaction metrics AI1, MG1-MG4)
CREATE TABLE ai_egress_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES company(id),
  actor_id        uuid,
  feature         text NOT NULL CHECK (feature IN ('variance_commentary', 'nlq_query', 'formula_builder')),
  endpoint        text NOT NULL,
  model_used      text NOT NULL,
  mode            text NOT NULL CHECK (mode IN ('llm', 'deterministic_fallback')),
  prompt_bytes    int NOT NULL CHECK (prompt_bytes >= 0),
  redaction_count int NOT NULL CHECK (redaction_count >= 0),
  fallback_reason text,
  prompt_hash     text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, actor_id) REFERENCES membership(company_id, user_id)
);

CREATE INDEX idx_ai_egress_audit_company
  ON ai_egress_audit (company_id, created_at DESC);

-- Immutability trigger for ai_egress_audit
CREATE OR REPLACE FUNCTION fn_ai_egress_audit_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AI_EGRESS_AUDIT_IMMUTABLE: ai_egress_audit records are append-only and cannot be updated or deleted (§10.3)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ai_egress_audit_immutable
  BEFORE UPDATE OR DELETE ON ai_egress_audit
  FOR EACH ROW EXECUTE FUNCTION fn_ai_egress_audit_immutable();
