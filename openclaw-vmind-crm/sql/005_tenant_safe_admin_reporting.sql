-- Yönetim sorguları tenant sınırını view seviyesinde de uygulayabilsin.
-- Önceki 003 view'ı tenant_id döndürmediği için çok kiracılı kullanımda
-- uygulama güvenli bir WHERE tenant_id = ... filtresi kuramıyordu.

DROP VIEW IF EXISTS agent.run_overview;

CREATE VIEW agent.run_overview AS
SELECT
  r.tenant_id,
  r.run_id,
  r.started_at,
  r.finished_at,
  r.channel,
  r.provider,
  r.model,
  r.status,
  r.result_stage,
  r.published,
  p.principal_type,
  p.external_key AS principal_key,
  p.display_name,
  COALESCE(u.llm_calls, 0) AS llm_calls,
  COALESCE(u.input_tokens, 0) AS input_tokens,
  COALESCE(u.output_tokens, 0) AS output_tokens,
  COALESCE(u.cost_usd, 0) AS cost_usd,
  COALESCE(t.tool_calls, 0) AS tool_calls,
  COALESCE(t.rejected_tool_calls, 0) AS rejected_tool_calls,
  e.status AS estimate_status,
  e.currency,
  e.monthly_total,
  r.error_code
FROM agent.runs r
LEFT JOIN identity.principals p
  ON p.tenant_id = r.tenant_id AND p.principal_id = r.principal_id
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS llm_calls,
    SUM(input_tokens) AS input_tokens,
    SUM(output_tokens) AS output_tokens,
    SUM(cost_usd) AS cost_usd
  FROM agent.llm_usage
  WHERE tenant_id = r.tenant_id AND run_id = r.run_id
) u ON true
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS tool_calls,
    COUNT(*) FILTER (WHERE status <> 'succeeded') AS rejected_tool_calls
  FROM agent.tool_calls
  WHERE tenant_id = r.tenant_id AND run_id = r.run_id
) t ON true
LEFT JOIN calculator.estimates e
  ON e.tenant_id = r.tenant_id AND e.run_id = r.run_id AND e.version = 1;

COMMENT ON VIEW agent.run_overview IS
  'Tenant filtrelenebilir, PII-filtreli ajan çalıştırma ve maliyet yönetim görünümü.';
