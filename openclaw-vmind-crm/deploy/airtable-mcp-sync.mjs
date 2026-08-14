#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import { CRMStore } from "../crm-store.js";
import { openRuntime } from "./airtable-mcp-admin.mjs";

const OPENCLAW_HOME = process.env.OPENCLAW_HOME ?? "/home/openclaw/.openclaw";
const DB_PATH = process.env.VMIND_CRM_DB ?? `${OPENCLAW_HOME}/data/vmind-crm.sqlite`;
const CONNECTION_PATH = `${OPENCLAW_HOME}/data/vmind-crm-airtable.json`;
const SERVER_NAME = "airtable-sink";
const ENTITY_TYPES = ["CONTACT", "OPPORTUNITY", "CALCULATION", "TASK"];

function latestRows(rows) {
  const byEntity = new Map();
  for (const row of rows) byEntity.set(`${row.entity_type}:${row.entity_id}`, row);
  return [...byEntity.values()];
}

function fieldsById(table, payload) {
  const fields = {};
  for (const [name, value] of Object.entries(payload)) {
    const fieldId = table.fields[name];
    if (!fieldId) throw new Error(`Airtable field mapping missing: ${table.name}.${name}`);
    fields[fieldId] = value;
  }
  return fields;
}

async function main() {
  const connection = JSON.parse(await readFile(CONNECTION_PATH, "utf8"));
  const store = new CRMStore(DB_PATH);
  const runtime = await openRuntime();
  let synced = 0;
  try {
    const pending = latestRows(store.pendingOutbox(200));
    for (const entityType of ENTITY_TYPES) {
      const table = connection.tables[entityType];
      if (!table) throw new Error(`Airtable table mapping missing: ${entityType}`);
      const rows = pending.filter((row) => row.entity_type === entityType);
      for (let index = 0; index < rows.length; index += 50) {
        const batch = rows.slice(index, index + 50);
        const ids = batch.map((row) => row.entity_id);
        try {
          const result = await runtime.callTool(SERVER_NAME, "update_records_for_table", {
            baseId: connection.baseId,
            tableId: table.id,
            records: batch.map((row) => ({
              fields: fieldsById(table, JSON.parse(row.payload_json)),
            })),
            performUpsert: {
              fieldIdsToMergeOn: [table.fields[batch[0].id_field]],
            },
            typecast: false,
          });
          if (result?.isError) throw new Error("Airtable MCP upsert failed");
          store.markEntitiesSynced(entityType, ids);
          synced += batch.length;
        } catch (error) {
          store.markEntitiesFailed(
            entityType,
            ids,
            error instanceof Error ? error.message : "Airtable MCP sync failed",
            120,
          );
        }
      }
    }
    process.stdout.write(`${JSON.stringify({ ok: true, synced })}\n`);
  } finally {
    await runtime.dispose();
    store.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
