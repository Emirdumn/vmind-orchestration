ALTER TABLE agent.runs
  ADD COLUMN IF NOT EXISTS external_run_key TEXT,
  ADD COLUMN IF NOT EXISTS channel TEXT,
  ADD COLUMN IF NOT EXISTS result_stage TEXT,
  ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS total_cost_usd NUMERIC(18, 8);

CREATE UNIQUE INDEX IF NOT EXISTS runs_external_key_idx
  ON agent.runs(tenant_id, external_run_key)
  WHERE external_run_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS runs_started_idx
  ON agent.runs(tenant_id, started_at DESC);

ALTER TABLE agent.messages
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES agent.runs(run_id);

CREATE INDEX IF NOT EXISTS messages_run_idx
  ON agent.messages(tenant_id, run_id, created_at)
  WHERE run_id IS NOT NULL;

ALTER TABLE agent.llm_usage
  ADD COLUMN IF NOT EXISTS usage_seq INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS llm_usage_run_seq_idx
  ON agent.llm_usage(tenant_id, run_id, usage_seq)
  WHERE usage_seq IS NOT NULL;

CREATE INDEX IF NOT EXISTS llm_usage_created_idx
  ON agent.llm_usage(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS tool_calls_run_idx
  ON agent.tool_calls(tenant_id, run_id, created_at);

CREATE TABLE IF NOT EXISTS agent.audit_events (
  audit_event_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES identity.tenants(tenant_id),
  run_id UUID NOT NULL REFERENCES agent.runs(run_id),
  event_seq INTEGER NOT NULL CHECK (event_seq > 0),
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, run_id, event_seq)
);

CREATE INDEX IF NOT EXISTS audit_events_run_idx
  ON agent.audit_events(tenant_id, run_id, event_seq);

ALTER TABLE billing.usage_ledger
  ADD COLUMN IF NOT EXISTS usage_id UUID REFERENCES agent.llm_usage(usage_id),
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'llm',
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS usage_ledger_usage_idx
  ON billing.usage_ledger(usage_id)
  WHERE usage_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS usage_ledger_idempotency_idx
  ON billing.usage_ledger(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS usage_ledger_tenant_time_idx
  ON billing.usage_ledger(tenant_id, occurred_at DESC);

ALTER TABLE calculator.estimates
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES agent.runs(run_id),
  ADD COLUMN IF NOT EXISTS principal_id UUID,
  ADD COLUMN IF NOT EXISTS flow_session_id UUID,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'dry_run';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'estimates_tenant_principal_fkey'
      AND conrelid = 'calculator.estimates'::regclass
  ) THEN
    ALTER TABLE calculator.estimates
      ADD CONSTRAINT estimates_tenant_principal_fkey
      FOREIGN KEY (tenant_id, principal_id)
      REFERENCES identity.principals(tenant_id, principal_id);
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS estimates_run_version_idx
  ON calculator.estimates(tenant_id, run_id, version)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS estimates_created_idx
  ON calculator.estimates(tenant_id, created_at DESC);
