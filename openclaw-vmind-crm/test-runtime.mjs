import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = mkdtempSync(join(tmpdir(), "vmind-crm-runtime-"));
process.env.VMIND_CRM_DB = join(root, "crm.sqlite");

const plugin = (await import(`./index.js?runtime-test=${Date.now()}`)).default;
const factories = new Map();
const hooks = new Map();
plugin.register({
  registerTool(factory, options) {
    factories.set(options.name, factory);
  },
  on(name, handler) {
    hooks.set(name, handler);
  },
});

const ctx = {
  messageChannel: "whatsapp",
  requesterSenderId: "905551234567@s.whatsapp.net",
  sessionKey: "agent:main:whatsapp:direct:+905551234567",
};

function resultJson(result) {
  if (result.details && typeof result.details === "object") return result.details;
  return JSON.parse(result.content.find((item) => item.type === "text").text);
}

async function call(name, params) {
  const factory = factories.get(name);
  assert.equal(typeof factory, "function", `${name} factory missing`);
  const tool = factory(ctx);
  assert.equal(tool?.name, name);
  return resultJson(await tool.execute(`test-${name}`, params));
}

try {
  assert.equal(factories.size, 5);
  assert.equal(typeof hooks.get("message_sent"), "function");

  const empty = await call("vmind_crm_get_context", {});
  assert.equal(empty.found, false);

  const need = await call("vmind_crm_save_need", {
    customer_need: "2 adet H200 GPU ile inference",
    recommended_service: "VMind GPU Cloud",
    qualified: true,
    company: "Test AŞ",
  });
  assert.equal(need.ok, true);
  assert.equal(need.opportunity.stage, "Qualified");

  const calculation = await call("vmind_crm_save_calculation", {
    opportunity_id: need.opportunity.opportunity_id,
    calculator_id: "RUNTIME-CALC-1",
    calculator_url: "https://teklif.43-229-94-48.sslip.io/c/RUNTIME-CALC-1",
    configuration_summary: "2x H200 GPU / inference",
    estimated_amount: 125000,
    currency: "TRY",
  });
  assert.equal(calculation.ok, true);
  assert.equal(calculation.opportunity.stage, "Calculation Created");

  await hooks.get("message_sent")({
    to: "+905551234567",
    content: `Teklif: ${calculation.calculation.calculator_url}`,
    success: true,
  }, { channelId: "whatsapp" });
  const sent = await call("vmind_crm_get_context", {});
  assert.equal(sent.opportunities[0].stage, "Proposal Sent");

  const task = await call("vmind_crm_request_sales_contact", {
    opportunity_id: need.opportunity.opportunity_id,
    explicit_confirmation: true,
  });
  assert.equal(task.stage, "Sales Contact Requested");

  const optOut = await call("vmind_crm_set_communication_status", {
    status: "opted_out",
    explicit_confirmation: true,
  });
  assert.equal(optOut.communication_status, "opted_out");

  console.log(JSON.stringify({
    ok: true,
    tools: factories.size,
    final_stage: task.stage,
    communication_status: optOut.communication_status,
  }));
} finally {
  hooks.get("gateway_stop")?.();
  rmSync(root, { recursive: true, force: true });
}
