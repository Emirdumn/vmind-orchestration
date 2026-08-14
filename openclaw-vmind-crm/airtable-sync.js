const TABLES = Object.freeze({
  CONTACT: { env: "AIRTABLE_CONTACT_TABLE", fallback: "CONTACT" },
  OPPORTUNITY: { env: "AIRTABLE_OPPORTUNITY_TABLE", fallback: "OPPORTUNITY" },
  CALCULATION: { env: "AIRTABLE_CALCULATION_TABLE", fallback: "CALCULATION" },
  TASK: { env: "AIRTABLE_TASK_TABLE", fallback: "TASK" },
});

export function airtableConfig(env = process.env) {
  const token = String(env.AIRTABLE_PAT ?? "").trim();
  const baseId = String(env.AIRTABLE_BASE_ID ?? "").trim();
  if (!token || !baseId) return null;
  if (!/^pat[A-Za-z0-9._-]+$/.test(token) || !/^app[A-Za-z0-9]+$/.test(baseId)) return null;
  return {
    token,
    baseId,
    tables: Object.fromEntries(
      Object.entries(TABLES).map(([type, item]) => [
        type,
        String(env[item.env] ?? item.fallback).trim(),
      ]),
    ),
  };
}

function latestRows(rows) {
  const byEntity = new Map();
  for (const row of rows) byEntity.set(`${row.entity_type}:${row.entity_id}`, row);
  return [...byEntity.values()];
}

async function upsertBatch(config, entityType, rows) {
  const table = config.tables[entityType];
  if (!table) throw new Error(`Airtable table mapping missing: ${entityType}`);
  const endpoint = `https://api.airtable.com/v0/${encodeURIComponent(config.baseId)}/${encodeURIComponent(table)}`;
  const response = await fetch(endpoint, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      performUpsert: { fieldsToMergeOn: [rows[0].id_field] },
      records: rows.map((row) => ({ fields: JSON.parse(row.payload_json) })),
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const retry = response.status === 429 ? 30 : 120;
    const error = new Error(`Airtable HTTP ${response.status}`);
    error.retrySeconds = retry;
    throw error;
  }
  return response.json();
}

export async function flushAirtableOutbox(store, options = {}) {
  const config = options.config ?? airtableConfig();
  if (!config) return { configured: false, synced: 0 };
  const pending = latestRows(await store.pendingOutbox(80));
  if (pending.length === 0) return { configured: true, synced: 0 };
  let synced = 0;
  for (const entityType of Object.keys(TABLES)) {
    const rows = pending.filter((row) => row.entity_type === entityType);
    for (let index = 0; index < rows.length; index += 10) {
      const batch = rows.slice(index, index + 10);
      const ids = batch.map((row) => row.entity_id);
      try {
        await upsertBatch(config, entityType, batch);
        await store.markEntitiesSynced(entityType, ids);
        synced += batch.length;
      } catch (error) {
        await store.markEntitiesFailed(
          entityType,
          ids,
          error instanceof Error ? error.message : "Airtable sync failed",
          Number(error?.retrySeconds ?? 120),
        );
      }
    }
  }
  return { configured: true, synced };
}
