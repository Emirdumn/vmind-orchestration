import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import pg from 'pg';

import { PostgresRuntimeStore, DEFAULT_TENANT_ID } from '../src/web/runtime-store.js';

const connectionString = process.env['VMIND_DATABASE_URL']?.trim();
if (!connectionString) throw new Error('VMIND_DATABASE_URL gerekli.');

const store = new PostgresRuntimeStore(connectionString, {
  dailyTotalUsd: 5,
  dailyPerUserUsd: 1,
});
const pool = new pg.Pool({
  connectionString,
  application_name: 'vmind-runtime-acceptance-cleanup',
});
const cacheKey = `acceptance-${randomUUID()}`;

try {
  await store.init();
  await store.healthCheck();
  assert.equal(await store.get(cacheKey), null);
  await store.put({
    cacheKey,
    model: 'acceptance/model',
    schemaName: 'AcceptanceSchema',
    promptVersion: 'acceptance-v1',
    response: { ok: true, value: 42 },
    ttlSeconds: 60,
  });
  assert.deepEqual(await store.get(cacheKey), { ok: true, value: 42 });
  const overview = await store.adminOverview();
  assert.ok(overview.cache.entries >= 1);
  assert.ok(overview.cache.hits >= 1);
  process.stdout.write(`${JSON.stringify({ ok: true, schema: '001-006', health: true, cache: true })}\n`);
} finally {
  await pool.query(
    'DELETE FROM agent.response_cache WHERE tenant_id = $1 AND cache_key = $2',
    [DEFAULT_TENANT_ID, cacheKey],
  ).catch(() => undefined);
  await pool.end();
  await store.close();
}
