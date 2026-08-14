#!/usr/bin/env node

import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

import { createPostgresPool, DEFAULT_TENANT_ID } from "../postgres-db.js";

const SQLITE_PATH = process.env.VMIND_CRM_DB ?? "/home/openclaw/.openclaw/data/vmind-crm.sqlite";
const TENANT_ID = process.env.VMIND_TENANT_ID ?? DEFAULT_TENANT_ID;
const COMPARE_SQLITE = process.env.VMIND_VERIFY_SQLITE === "1" && existsSync(SQLITE_PATH);
const TABLES = [
  ["contacts", "contact_id"],
  ["opportunities", "opportunity_id"],
  ["calculations", "calculation_id"],
  ["stage_events", "event_id"],
  ["sales_tasks", "task_id"],
  ["sync_outbox", "outbox_id"],
];

function digest(ids) {
  return createHash("sha256").update(ids.map(String).sort().join("\n")).digest("hex");
}

const pool = createPostgresPool();
try {
  const counts = {};
  for (const [table, idField] of TABLES) {
    const rows = (await pool.query(
      `SELECT ${idField} FROM crm.${table} WHERE tenant_id = $1`,
      [TENANT_ID],
    )).rows;
    counts[table] = rows.length;
    if (COMPARE_SQLITE) {
      const sqlite = new DatabaseSync(SQLITE_PATH, { readOnly: true });
      try {
        const sourceIds = sqlite.prepare(`SELECT ${idField} FROM ${table}`).all()
          .map((row) => row[idField]);
        if (sourceIds.length !== rows.length || digest(sourceIds) !== digest(rows.map((row) => row[idField]))) {
          throw new Error(`SQLite/PostgreSQL farkı bulundu: ${table}`);
        }
      } finally {
        sqlite.close();
      }
    }
  }

  const integrity = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM crm.opportunities o
       LEFT JOIN crm.contacts c
         ON c.tenant_id = o.tenant_id AND c.contact_id = o.contact_id
       WHERE o.tenant_id = $1 AND c.contact_id IS NULL) AS orphan_opportunities,
      (SELECT COUNT(*) FROM crm.calculations x
       LEFT JOIN crm.opportunities o
         ON o.tenant_id = x.tenant_id AND o.opportunity_id = x.opportunity_id
       WHERE x.tenant_id = $1 AND o.opportunity_id IS NULL) AS orphan_calculations,
      (SELECT COUNT(*) FROM crm.stage_events e
       LEFT JOIN crm.opportunities o
         ON o.tenant_id = e.tenant_id AND o.opportunity_id = e.opportunity_id
       WHERE e.tenant_id = $1 AND o.opportunity_id IS NULL) AS orphan_stage_events,
      (SELECT COUNT(*) FROM crm.sales_tasks t
       LEFT JOIN crm.opportunities o
         ON o.tenant_id = t.tenant_id AND o.opportunity_id = t.opportunity_id
       WHERE t.tenant_id = $1 AND o.opportunity_id IS NULL) AS orphan_tasks
  `, [TENANT_ID]);
  const orphans = Object.fromEntries(
    Object.entries(integrity.rows[0]).map(([key, value]) => [key, Number(value)]),
  );
  if (Object.values(orphans).some((value) => value !== 0)) {
    throw new Error(`PostgreSQL ilişki doğrulaması başarısız: ${JSON.stringify(orphans)}`);
  }
  const migrations = (await pool.query(
    "SELECT version FROM platform.schema_migrations ORDER BY version",
  )).rows.map((row) => row.version);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    counts,
    orphans,
    migrations,
    sqlite_compared: COMPARE_SQLITE,
  })}\n`);
} finally {
  await pool.end();
}
