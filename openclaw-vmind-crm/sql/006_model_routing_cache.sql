ALTER TABLE agent.llm_usage
  ADD COLUMN IF NOT EXISTS route_tier TEXT,
  ADD COLUMN IF NOT EXISTS route_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'llm_usage_route_tier_check'
      AND conrelid = 'agent.llm_usage'::regclass
  ) THEN
    ALTER TABLE agent.llm_usage
      ADD CONSTRAINT llm_usage_route_tier_check
      CHECK (route_tier IS NULL OR route_tier IN ('fast', 'balanced', 'strong'));
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS agent.response_cache (
  tenant_id UUID NOT NULL REFERENCES identity.tenants(tenant_id),
  cache_key TEXT NOT NULL,
  model TEXT NOT NULL,
  schema_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  response_json JSONB NOT NULL,
  hit_count BIGINT NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_hit_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, cache_key)
);

CREATE INDEX IF NOT EXISTS response_cache_expiry_idx
  ON agent.response_cache(tenant_id, expires_at);

COMMENT ON TABLE agent.response_cache IS
  'PII içermeyen, birebir aynı yapısal LLM isteklerinin tenant-sınırlı kısa süreli önbelleği.';
