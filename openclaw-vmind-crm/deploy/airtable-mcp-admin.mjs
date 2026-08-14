#!/usr/bin/env node

import { chmod, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const OPENCLAW_HOME = process.env.OPENCLAW_HOME ?? "/home/openclaw/.openclaw";
const OPENCLAW_DIST = process.env.OPENCLAW_DIST ??
  "/home/openclaw/.npm-global/lib/node_modules/openclaw/dist";
const CONFIG_PATH = `${OPENCLAW_HOME}/openclaw.json`;
const WORKSPACE_DIR = `${OPENCLAW_HOME}/workspace`;
const RUNTIME_MODULE = `${OPENCLAW_DIST}/agents/agent-bundle-mcp-runtime.js`;
const SERVER_NAME = "airtable-sink";
const CONNECTION_PATH = `${OPENCLAW_HOME}/data/vmind-crm-airtable.json`;

const SELECT_OPTIONS = Object.freeze({
  "Communication Status": ["not_requested", "opted_in", "opted_out", "contact_requested"],
  Stage: [
    "New",
    "Need Identified",
    "Qualified",
    "Calculation Created",
    "Proposal Sent",
    "Follow-up",
    "Sales Contact Requested",
    "Won",
    "Lost",
  ],
  Currency: ["TRY", "USD"],
  Source: ["WhatsApp"],
  Type: ["sales_contact", "follow_up"],
  Status: ["open", "done", "cancelled"],
});

function contentText(result) {
  return (result?.content ?? [])
    .filter((item) => item?.type === "text")
    .map((item) => item.text)
    .join("\n");
}

export async function openRuntime() {
  const cfg = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  const server = cfg?.mcp?.servers?.[SERVER_NAME];
  if (!server) throw new Error(`MCP server not configured: ${SERVER_NAME}`);

  // The persisted config hides every Airtable tool from the WhatsApp model.
  // This process-local copy is unfiltered only for deterministic operator calls.
  delete server.toolFilter;

  const { createSessionMcpRuntime } = await import(RUNTIME_MODULE);
  const runtime = createSessionMcpRuntime({
    sessionId: `vmind-airtable-admin-${process.pid}`,
    sessionKey: `vmind-airtable-admin-${process.pid}`,
    workspaceDir: WORKSPACE_DIR,
    cfg,
    logDiagnostics: true,
  });
  await runtime.getCatalog();
  return runtime;
}

function fieldDefinition([name, type]) {
  const field = { name, type };
  if (type === "singleSelect") {
    field.options = { choices: (SELECT_OPTIONS[name] ?? []).map((choice) => ({ name: choice })) };
  } else if (type === "number") {
    field.options = { precision: name === "Version" ? 0 : 2 };
  } else if (type === "date") {
    field.options = { dateFormat: { name: "iso" } };
  } else if (type === "dateTime") {
    field.options = {
      dateFormat: { name: "iso" },
      timeFormat: { name: "24hour" },
      timeZone: "Europe/Istanbul",
    };
  }
  return field;
}

function structured(result) {
  if (result?.isError) throw new Error(contentText(result) || "Airtable MCP call failed");
  return result?.structuredContent ?? {};
}

async function configureBase(runtime, workspaceId, baseName) {
  const schema = JSON.parse(await readFile(new URL("./airtable-schema.json", import.meta.url), "utf8"));
  const listed = structured(await runtime.callTool(SERVER_NAME, "list_bases", {}));
  let base = listed.bases?.find((item) => item.name === baseName);

  if (!base) {
    const tables = schema.tables.map((table) => ({
      name: table.name,
      fields: table.fields.map(fieldDefinition),
    }));
    structured(await runtime.callTool(SERVER_NAME, "create_base", {
      workspaceId,
      name: baseName,
      tables,
    }));
    const refreshed = structured(await runtime.callTool(SERVER_NAME, "list_bases", {}));
    base = refreshed.bases?.find((item) => item.name === baseName);
  }
  if (!base?.id) throw new Error(`Airtable base could not be resolved: ${baseName}`);

  const tableResult = structured(await runtime.callTool(SERVER_NAME, "list_tables_for_base", {
    baseId: base.id,
  }));
  const connection = {
    version: 1,
    baseId: base.id,
    baseName,
    tables: {},
    configuredAt: new Date().toISOString(),
  };
  for (const expected of schema.tables) {
    const table = tableResult.tables?.find((item) => item.name === expected.name);
    if (!table?.id) throw new Error(`Required Airtable table is missing: ${expected.name}`);
    const fields = {};
    for (const [fieldName] of expected.fields) {
      const field = table.fields?.find((item) => item.name === fieldName);
      if (!field?.id) throw new Error(`Required Airtable field is missing: ${expected.name}.${fieldName}`);
      fields[fieldName] = field.id;
    }
    connection.tables[expected.name] = {
      id: table.id,
      name: table.name,
      primaryFieldId: table.primaryFieldId,
      fields,
    };
  }
  await writeFile(CONNECTION_PATH, `${JSON.stringify(connection, null, 2)}\n`, { mode: 0o600 });
  await chmod(CONNECTION_PATH, 0o600);
  return connection;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const runtime = await openRuntime();
  try {
    if (command === "schemas") {
      const wanted = new Set(args);
      const catalog = runtime.peekCatalog();
      const tools = catalog.tools
        .filter((tool) => wanted.size === 0 || wanted.has(tool.toolName))
        .map(({ toolName, title, description, inputSchema }) => ({
          toolName,
          title,
          description,
          inputSchema,
        }));
      process.stdout.write(`${JSON.stringify(tools, null, 2)}\n`);
      return;
    }

    if (command === "call") {
      const [toolName, rawInput = "{}"] = args;
      if (!toolName) throw new Error("Usage: airtable-mcp-admin.mjs call <tool> [json]");
      const input = JSON.parse(rawInput);
      const result = await runtime.callTool(SERVER_NAME, toolName, input);
      const text = contentText(result);
      process.stdout.write(`${text || JSON.stringify(result, null, 2)}\n`);
      if (result?.isError) process.exitCode = 1;
      return;
    }

    if (command === "setup") {
      const [workspaceId, baseName = "VMind Sales CRM"] = args;
      if (!/^wsp[A-Za-z0-9]{14}$/.test(workspaceId ?? "")) {
        throw new Error("Usage: airtable-mcp-admin.mjs setup <workspaceId> [baseName]");
      }
      const connection = await configureBase(runtime, workspaceId, baseName);
      process.stdout.write(`${JSON.stringify({
        ok: true,
        baseId: connection.baseId,
        baseName: connection.baseName,
        tables: Object.keys(connection.tables),
      }, null, 2)}\n`);
      return;
    }

    throw new Error("Usage: airtable-mcp-admin.mjs schemas [tool...] | call <tool> [json] | setup <workspaceId> [baseName]");
  } finally {
    await runtime.dispose();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
