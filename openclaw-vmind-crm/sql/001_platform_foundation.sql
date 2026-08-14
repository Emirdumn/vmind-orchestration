CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS crm;
CREATE SCHEMA IF NOT EXISTS agent;
CREATE SCHEMA IF NOT EXISTS billing;
CREATE SCHEMA IF NOT EXISTS calculator;

CREATE TABLE IF NOT EXISTS identity.tenants (
  tenant_id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO identity.tenants (tenant_id, slug, display_name)
VALUES ('00000000-0000-0000-0000-000000000001', 'vmind', 'VMind')
ON CONFLICT (tenant_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS identity.principals (
  principal_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES identity.tenants(tenant_id),
  principal_type TEXT NOT NULL CHECK (principal_type IN ('user', 'service', 'guest', 'channel_contact')),
  external_key TEXT NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, principal_type, external_key),
  UNIQUE (tenant_id, principal_id)
);

CREATE TABLE IF NOT EXISTS identity.api_keys (
  api_key_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES identity.tenants(tenant_id),
  principal_id UUID NOT NULL,
  key_prefix TEXT NOT NULL,
  secret_hash TEXT NOT NULL UNIQUE,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, principal_id)
    REFERENCES identity.principals(tenant_id, principal_id)
);

CREATE TABLE IF NOT EXISTS crm.contacts (
  contact_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES identity.tenants(tenant_id),
  phone_e164 TEXT NOT NULL,
  name TEXT,
  company TEXT,
  communication_status TEXT NOT NULL DEFAULT 'not_requested'
    CHECK (communication_status IN ('not_requested', 'opted_in', 'opted_out', 'contact_requested')),
  consent_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, phone_e164),
  UNIQUE (tenant_id, contact_id)
);

CREATE TABLE IF NOT EXISTS crm.opportunities (
  opportunity_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES identity.tenants(tenant_id),
  contact_id UUID NOT NULL,
  session_hash CHAR(32) NOT NULL,
  customer_need TEXT NOT NULL,
  recommended_service TEXT,
  stage TEXT NOT NULL CHECK (stage IN (
    'New', 'Need Identified', 'Qualified', 'Calculation Created',
    'Proposal Sent', 'Follow-up', 'Sales Contact Requested', 'Won', 'Lost'
  )),
  estimated_amount_minor BIGINT,
  currency TEXT CHECK (currency IS NULL OR currency IN ('TRY', 'USD')),
  owner TEXT NOT NULL DEFAULT 'unassigned',
  next_follow_up DATE,
  source TEXT NOT NULL DEFAULT 'WhatsApp',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, opportunity_id),
  FOREIGN KEY (tenant_id, contact_id)
    REFERENCES crm.contacts(tenant_id, contact_id)
);

CREATE INDEX IF NOT EXISTS opportunities_contact_idx
  ON crm.opportunities(tenant_id, contact_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS opportunities_session_idx
  ON crm.opportunities(tenant_id, contact_id, session_hash, updated_at DESC);

CREATE TABLE IF NOT EXISTS crm.calculations (
  calculation_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES identity.tenants(tenant_id),
  external_calculation_id TEXT NOT NULL,
  opportunity_id UUID NOT NULL,
  calculator_url TEXT NOT NULL,
  configuration_summary TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL CHECK (currency IN ('TRY', 'USD')),
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, external_calculation_id),
  UNIQUE (tenant_id, opportunity_id, version),
  FOREIGN KEY (tenant_id, opportunity_id)
    REFERENCES crm.opportunities(tenant_id, opportunity_id)
);

CREATE INDEX IF NOT EXISTS calculations_opportunity_idx
  ON crm.calculations(tenant_id, opportunity_id, version DESC);

CREATE TABLE IF NOT EXISTS crm.stage_events (
  event_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES identity.tenants(tenant_id),
  opportunity_id UUID NOT NULL,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (tenant_id, opportunity_id)
    REFERENCES crm.opportunities(tenant_id, opportunity_id)
);

CREATE INDEX IF NOT EXISTS stage_events_opportunity_idx
  ON crm.stage_events(tenant_id, opportunity_id, created_at);

CREATE TABLE IF NOT EXISTS crm.sales_tasks (
  task_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES identity.tenants(tenant_id),
  opportunity_id UUID NOT NULL,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL,
  owner TEXT NOT NULL DEFAULT 'unassigned',
  due_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (tenant_id, opportunity_id)
    REFERENCES crm.opportunities(tenant_id, opportunity_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_tasks_open_contact_idx
  ON crm.sales_tasks(tenant_id, opportunity_id, task_type) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS crm.sync_outbox (
  outbox_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES identity.tenants(tenant_id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  id_field TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'synced', 'discarded')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sync_outbox_pending_idx
  ON crm.sync_outbox(tenant_id, status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS agent.conversations (
  conversation_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES identity.tenants(tenant_id),
  principal_id UUID,
  channel TEXT NOT NULL,
  external_thread_key_hash TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, principal_id)
    REFERENCES identity.principals(tenant_id, principal_id)
);

CREATE TABLE IF NOT EXISTS agent.messages (
  message_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES identity.tenants(tenant_id),
  conversation_id UUID NOT NULL REFERENCES agent.conversations(conversation_id),
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'system')),
  content_redacted TEXT,
  content_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_conversation_idx
  ON agent.messages(tenant_id, conversation_id, created_at);

CREATE TABLE IF NOT EXISTS agent.runs (
  run_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES identity.tenants(tenant_id),
  conversation_id UUID REFERENCES agent.conversations(conversation_id),
  principal_id UUID,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  request_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  FOREIGN KEY (tenant_id, principal_id)
    REFERENCES identity.principals(tenant_id, principal_id)
);

CREATE TABLE IF NOT EXISTS agent.llm_usage (
  usage_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES identity.tenants(tenant_id),
  run_id UUID NOT NULL REFERENCES agent.runs(run_id),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_read_tokens BIGINT NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cost_usd NUMERIC(18, 8),
  latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent.tool_calls (
  tool_call_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES identity.tenants(tenant_id),
  run_id UUID NOT NULL REFERENCES agent.runs(run_id),
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'rejected', 'failed')),
  input_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing.quota_policies (
  quota_policy_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES identity.tenants(tenant_id),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('tenant', 'principal', 'api_key')),
  scope_id UUID NOT NULL,
  period TEXT NOT NULL CHECK (period IN ('day', 'month')),
  max_cost_usd NUMERIC(18, 8),
  max_input_tokens BIGINT,
  max_output_tokens BIGINT,
  max_requests BIGINT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, scope_type, scope_id, period)
);

CREATE TABLE IF NOT EXISTS billing.usage_ledger (
  usage_ledger_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES identity.tenants(tenant_id),
  principal_id UUID,
  api_key_id UUID REFERENCES identity.api_keys(api_key_id),
  run_id UUID REFERENCES agent.runs(run_id),
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  cost_usd NUMERIC(18, 8),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, principal_id)
    REFERENCES identity.principals(tenant_id, principal_id)
);

CREATE INDEX IF NOT EXISTS usage_ledger_principal_idx
  ON billing.usage_ledger(tenant_id, principal_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS calculator.estimates (
  estimate_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES identity.tenants(tenant_id),
  opportunity_id UUID,
  external_calculation_id TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  currency TEXT NOT NULL CHECK (currency IN ('TL', 'USD')),
  monthly_total NUMERIC(20, 6) NOT NULL CHECK (monthly_total >= 0),
  requirement_spec JSONB NOT NULL DEFAULT '{}'::jsonb,
  estimate_payload JSONB NOT NULL,
  published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, opportunity_id)
    REFERENCES crm.opportunities(tenant_id, opportunity_id),
  UNIQUE (tenant_id, external_calculation_id)
);
