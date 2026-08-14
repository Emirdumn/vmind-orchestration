#!/usr/bin/env node

import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { applyPostgresMigrations, createPostgresPool, DEFAULT_TENANT_ID } from "../postgres-db.js";

const SQLITE_PATH = process.env.VMIND_CRM_DB ?? "/home/openclaw/.openclaw/data/vmind-crm.sqlite";
const TENANT_ID = process.env.VMIND_TENANT_ID ?? DEFAULT_TENANT_ID;

const TABLES = [
  ["contacts", "contact_id"],
  ["opportunities", "opportunity_id"],
  ["calculations", "calculation_id"],
  ["stage_events", "event_id"],
  ["sales_tasks", "task_id"],
  ["sync_outbox", "outbox_id"],
];

function idHash(rows, idField) {
  return createHash("sha256")
    .update(rows.map((row) => String(row[idField])).sort().join("\n"))
    .digest("hex");
}

function sourceSnapshot(db) {
  return Object.fromEntries(TABLES.map(([table, idField]) => {
    const rows = db.prepare(`SELECT * FROM ${table}`).all();
    return [table, { rows, count: rows.length, idHash: idHash(rows, idField) }];
  }));
}

async function upsertRows(client, snapshot) {
  for (const row of snapshot.contacts.rows) {
    await client.query(`
      INSERT INTO crm.contacts (
        contact_id, tenant_id, phone_e164, name, company, communication_status,
        consent_updated_at, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (contact_id) DO UPDATE SET
        phone_e164 = EXCLUDED.phone_e164,
        name = EXCLUDED.name,
        company = EXCLUDED.company,
        communication_status = EXCLUDED.communication_status,
        consent_updated_at = EXCLUDED.consent_updated_at,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at
    `, [
      row.contact_id,
      TENANT_ID,
      row.phone_e164,
      row.name,
      row.company,
      row.communication_status,
      row.consent_updated_at,
      row.created_at,
      row.updated_at,
    ]);
  }

  for (const row of snapshot.opportunities.rows) {
    await client.query(`
      INSERT INTO crm.opportunities (
        opportunity_id, tenant_id, contact_id, session_hash, customer_need,
        recommended_service, stage, estimated_amount_minor, currency, owner,
        next_follow_up, source, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (opportunity_id) DO UPDATE SET
        contact_id = EXCLUDED.contact_id,
        session_hash = EXCLUDED.session_hash,
        customer_need = EXCLUDED.customer_need,
        recommended_service = EXCLUDED.recommended_service,
        stage = EXCLUDED.stage,
        estimated_amount_minor = EXCLUDED.estimated_amount_minor,
        currency = EXCLUDED.currency,
        owner = EXCLUDED.owner,
        next_follow_up = EXCLUDED.next_follow_up,
        source = EXCLUDED.source,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at
    `, [
      row.opportunity_id,
      TENANT_ID,
      row.contact_id,
      row.session_hash,
      row.customer_need,
      row.recommended_service,
      row.stage,
      row.estimated_amount_minor,
      row.currency,
      row.owner,
      row.next_follow_up,
      row.source,
      row.created_at,
      row.updated_at,
    ]);
  }

  for (const row of snapshot.calculations.rows) {
    await client.query(`
      INSERT INTO crm.calculations (
        calculation_id, tenant_id, external_calculation_id, opportunity_id,
        calculator_url, configuration_summary, amount_minor, currency, version, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (calculation_id) DO UPDATE SET
        external_calculation_id = EXCLUDED.external_calculation_id,
        opportunity_id = EXCLUDED.opportunity_id,
        calculator_url = EXCLUDED.calculator_url,
        configuration_summary = EXCLUDED.configuration_summary,
        amount_minor = EXCLUDED.amount_minor,
        currency = EXCLUDED.currency,
        version = EXCLUDED.version,
        created_at = EXCLUDED.created_at
    `, [
      row.calculation_id,
      TENANT_ID,
      row.external_calculation_id,
      row.opportunity_id,
      row.calculator_url,
      row.configuration_summary,
      row.amount_minor,
      row.currency,
      row.version,
      row.created_at,
    ]);
  }

  for (const row of snapshot.stage_events.rows) {
    await client.query(`
      INSERT INTO crm.stage_events (
        event_id, tenant_id, opportunity_id, from_stage, to_stage, reason, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (event_id) DO UPDATE SET
        opportunity_id = EXCLUDED.opportunity_id,
        from_stage = EXCLUDED.from_stage,
        to_stage = EXCLUDED.to_stage,
        reason = EXCLUDED.reason,
        created_at = EXCLUDED.created_at
    `, [
      row.event_id,
      TENANT_ID,
      row.opportunity_id,
      row.from_stage,
      row.to_stage,
      row.reason,
      row.created_at,
    ]);
  }

  for (const row of snapshot.sales_tasks.rows) {
    await client.query(`
      INSERT INTO crm.sales_tasks (
        task_id, tenant_id, opportunity_id, task_type, status, owner,
        due_at, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (task_id) DO UPDATE SET
        opportunity_id = EXCLUDED.opportunity_id,
        task_type = EXCLUDED.task_type,
        status = EXCLUDED.status,
        owner = EXCLUDED.owner,
        due_at = EXCLUDED.due_at,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at
    `, [
      row.task_id,
      TENANT_ID,
      row.opportunity_id,
      row.task_type,
      row.status,
      row.owner,
      row.due_at,
      row.created_at,
      row.updated_at,
    ]);
  }

  for (const row of snapshot.sync_outbox.rows) {
    let payload;
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      throw new Error(`Geçersiz outbox JSON: ${row.outbox_id}`);
    }
    await client.query(`
      INSERT INTO crm.sync_outbox (
        outbox_id, tenant_id, entity_type, entity_id, id_field, payload_json,
        status, attempts, next_attempt_at, last_error, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (outbox_id) DO UPDATE SET
        entity_type = EXCLUDED.entity_type,
        entity_id = EXCLUDED.entity_id,
        id_field = EXCLUDED.id_field,
        payload_json = EXCLUDED.payload_json,
        status = EXCLUDED.status,
        attempts = EXCLUDED.attempts,
        next_attempt_at = EXCLUDED.next_attempt_at,
        last_error = EXCLUDED.last_error,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at
    `, [
      row.outbox_id,
      TENANT_ID,
      row.entity_type,
      row.entity_id,
      row.id_field,
      JSON.stringify(payload),
      row.status,
      row.attempts,
      row.next_attempt_at,
      row.last_error,
      row.created_at,
      row.updated_at,
    ]);
  }
}

async function destinationSnapshot(client) {
  const output = {};
  for (const [table, idField] of TABLES) {
    const rows = (await client.query(
      `SELECT ${idField} FROM crm.${table} WHERE tenant_id = $1`,
      [TENANT_ID],
    )).rows;
    output[table] = { count: rows.length, idHash: idHash(rows, idField) };
  }
  return output;
}

const db = new DatabaseSync(SQLITE_PATH, { readOnly: true });
const pool = createPostgresPool();
try {
  db.exec("PRAGMA foreign_keys = ON");
  const source = sourceSnapshot(db);
  await applyPostgresMigrations(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await upsertRows(client, source);
    const destination = await destinationSnapshot(client);
    for (const [table] of TABLES) {
      if (
        source[table].count !== destination[table].count ||
        source[table].idHash !== destination[table].idHash
      ) {
        throw new Error(`Aktarım doğrulaması başarısız: ${table}`);
      }
    }
    await client.query("COMMIT");
    process.stdout.write(`${JSON.stringify({
      ok: true,
      source: SQLITE_PATH,
      counts: Object.fromEntries(TABLES.map(([table]) => [table, source[table].count])),
      verified: true,
    })}\n`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  db.close();
  await pool.end();
}
