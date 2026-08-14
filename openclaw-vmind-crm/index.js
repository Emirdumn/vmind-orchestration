import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { jsonResult } from "openclaw/plugin-sdk/tool-results";
import { airtableConfig, flushAirtableOutbox } from "./airtable-sync.js";
import { CrmValidationError } from "./crm-store.js";
import { createCrmStoreFromEnv } from "./postgres-store.js";
import {
  SITE_HEALTH_ROUTE,
  SITE_QUOTE_ROUTE,
  createSiteHealthHttpHandler,
  createSiteQuoteHttpHandler,
} from "./site-api.js";

const emptySchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

const needSchema = {
  type: "object",
  properties: {
    customer_need: { type: "string", minLength: 1, maxLength: 2000 },
    recommended_service: { type: "string", maxLength: 500 },
    name: { type: "string", maxLength: 160 },
    company: { type: "string", maxLength: 240 },
    qualified: { type: "boolean" },
    opportunity_id: { type: "string", maxLength: 80 },
    new_opportunity: { type: "boolean" },
  },
  required: ["customer_need"],
  additionalProperties: false,
};

const calculationSchema = {
  type: "object",
  properties: {
    opportunity_id: { type: "string", minLength: 1, maxLength: 80 },
    calculator_id: { type: "string", minLength: 1, maxLength: 160 },
    calculator_url: { type: "string", minLength: 1, maxLength: 2048 },
    configuration_summary: { type: "string", minLength: 1, maxLength: 4000 },
    estimated_amount: { type: "number", minimum: 0 },
    currency: { type: "string", enum: ["TRY", "USD"] },
  },
  required: [
    "opportunity_id",
    "calculator_id",
    "calculator_url",
    "configuration_summary",
    "estimated_amount",
  ],
  additionalProperties: false,
};

const salesContactSchema = {
  type: "object",
  properties: {
    opportunity_id: { type: "string", minLength: 1, maxLength: 80 },
    explicit_confirmation: { type: "boolean" },
  },
  required: ["opportunity_id", "explicit_confirmation"],
  additionalProperties: false,
};

const communicationSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["opted_in", "opted_out"] },
    explicit_confirmation: { type: "boolean" },
  },
  required: ["status", "explicit_confirmation"],
  additionalProperties: false,
};

function isWhatsAppToolContext(ctx) {
  return String(ctx.messageChannel ?? "").toLowerCase() === "whatsapp" ||
    String(ctx.sessionKey ?? "").includes(":whatsapp:");
}

async function safeResult(action) {
  try {
    return jsonResult(await action());
  } catch (error) {
    const message = error instanceof CrmValidationError
      ? error.message
      : "CRM işlemi güvenli biçimde tamamlanamadı.";
    return jsonResult({ ok: false, error: message });
  }
}

function registerContextTool(api, name, definition, store, scheduleSync) {
  api.registerTool((toolContext) => {
    if (!isWhatsAppToolContext(toolContext)) return null;
    return {
      name,
      label: definition.label,
      description: definition.description,
      promptSnippet: definition.promptSnippet,
      promptGuidelines: definition.promptGuidelines,
      parameters: definition.parameters,
      async execute(_toolCallId, params) {
        const result = await safeResult(() => definition.execute(toolContext, params));
        scheduleSync();
        return result;
      },
    };
  }, { name });
}

export default definePluginEntry({
  id: "vmind-crm",
  name: "VMind CRM",
  description: "Controlled CRM tools and a signed VMind website ingestion route.",
  register(api) {
    // FAZ 0 — gateway açılışında ŞEMA UYGULANMAZ, yalnızca doğrulanır.
    // Migration yalnızca açık deploy/admin komutlarıyla yapılır.
    const store = createCrmStoreFromEnv(process.env, { migrate: false });

    // `ready()` üretim akışlarında çağrılmıyordu; doğrulamanın gerçekten
    // koşması için başlangıçta bir kez burada tetikleniyor. Sonuç tek satır
    // log'a düşer. Hata gateway'i DÜŞÜRMEZ — reddedilen readyPromise'i her
    // CRM işlemi zaten bekliyor, dolayısıyla yazma yolları `safeResult`
    // üzerinden güvenli hata döndürür.
    if (typeof store.ready === "function") {
      store.ready().then(
        (ready) => {
          const detail = ready?.schema
            ? `${ready.schema.verified.join(", ")}; uygulanmış: ${ready.schema.appliedCount}`
            : "sqlite";
          console.log(`[vmind-crm] şema doğrulandı (${detail}); otomatik migration KAPALI`);
        },
        (error) => {
          console.error(
            `[vmind-crm] ŞEMA DOĞRULANAMADI — CRM yazma devre dışı: ${error.message}`,
          );
        },
      );
    }

    // Site, CRM veritabanina veya OpenClaw tool context'ine dogrudan erismez.
    // Gateway rotasi yalniz sunucuda paylasilan HMAC sirriyla imzalanmis,
    // zaman penceresi icindeki istekleri kabul eder. Sir yoksa rota bilincli
    // olarak kaydedilmez; yanlis yapilandirma acik bir yazma yuzeyi yaratmaz.
    const siteSecret = String(process.env.VMIND_CRM_SITE_SECRET ?? "").trim();
    if (siteSecret) {
      const siteHandler = createSiteQuoteHttpHandler({ store, secret: siteSecret });
      const siteHealthHandler = createSiteHealthHttpHandler({ store, secret: siteSecret });
      api.registerHttpRoute({
        path: SITE_QUOTE_ROUTE,
        auth: "plugin",
        match: "exact",
        handler: siteHandler,
      });
      api.registerHttpRoute({
        path: SITE_HEALTH_ROUTE,
        auth: "plugin",
        match: "exact",
        handler: siteHealthHandler,
      });
      console.log(
        `[vmind-crm] site API etkin: ${SITE_QUOTE_ROUTE}, ${SITE_HEALTH_ROUTE} (HMAC)`,
      );
    } else {
      console.log("[vmind-crm] site API kapalı: VMIND_CRM_SITE_SECRET tanımlı değil");
    }

    const configuredSink = airtableConfig();
    let syncRunning = false;
    let syncQueued = false;
    const scheduleSync = () => {
      if (!configuredSink || syncQueued) return;
      syncQueued = true;
      setTimeout(async () => {
        syncQueued = false;
        if (syncRunning) return;
        syncRunning = true;
        try {
          await flushAirtableOutbox(store, { config: configuredSink });
        } catch {
          // Local CRM is authoritative; the outbox retains unsynced records.
        } finally {
          syncRunning = false;
        }
      }, 0).unref();
    };

    registerContextTool(api, "vmind_crm_get_context", {
      label: "VMind CRM Context",
      description: "Read only this WhatsApp sender's CRM contact, opportunities, and latest calculations. The phone is taken from trusted channel context, never from model arguments.",
      promptSnippet: "Read the current WhatsApp customer's compact CRM context without asking for their phone number.",
      parameters: emptySchema,
      execute: (ctx) => store.getContext(ctx),
    }, store, scheduleSync);

    registerContextTool(api, "vmind_crm_save_need", {
      label: "VMind CRM Save Need",
      description: "Create or update a normalized CONTACT and OPPORTUNITY for this WhatsApp sender. Store only a concise need summary and confirmed name/company; never store raw chat transcripts. Set qualified only when material requirements are known. Set new_opportunity for a distinct new buying need.",
      promptSnippet: "Save a structured customer need without asking for or supplying a phone number.",
      promptGuidelines: [
        "Do not ask the user to fill a CRM form; infer only fields already present in the conversation.",
        "Keep separate buying needs as separate opportunities under the same contact.",
      ],
      parameters: needSchema,
      execute: (ctx, params) => store.saveNeed(ctx, params),
    }, store, scheduleSync);

    registerContextTool(api, "vmind_crm_save_calculation", {
      label: "VMind CRM Save Calculation",
      description: "Attach an immutable, versioned VMind calculator result to this sender's opportunity. The calculator ID is idempotent. This deterministically sets stage to Calculation Created and follow-up to two weekdays later.",
      promptSnippet: "Save the calculator result before returning its VMind link to the customer.",
      parameters: calculationSchema,
      execute: (ctx, params) => store.saveCalculation(ctx, params),
    }, store, scheduleSync);

    registerContextTool(api, "vmind_crm_request_sales_contact", {
      label: "VMind CRM Sales Contact",
      description: "After the customer explicitly asks to be contacted, mark the opportunity Sales Contact Requested and create one open sales task. Never infer consent.",
      promptSnippet: "Create a sales-contact task only after explicit customer confirmation.",
      parameters: salesContactSchema,
      execute: (ctx, params) => store.requestSalesContact(ctx, params),
    }, store, scheduleSync);

    registerContextTool(api, "vmind_crm_set_communication_status", {
      label: "VMind CRM Communication Status",
      description: "Record this WhatsApp sender's explicit opt-in or opt-out communication preference. Never infer a preference from silence.",
      parameters: communicationSchema,
      execute: (ctx, params) => store.setCommunicationStatus(ctx, params),
    }, store, scheduleSync);

    api.on("message_sent", async (event, ctx) => {
      if (ctx.channelId !== "whatsapp" || event.success !== true) return;
      try {
        const updated = await store.markProposalSent(event.to, event.content);
        if (updated) scheduleSync();
      } catch {
        // Delivery must not fail because a CRM update could not be recorded.
      }
    });

    const advanceFollowUps = async () => {
      try {
        if (await store.advanceDueFollowUps() > 0) scheduleSync();
      } catch {
        // Retry on the next interval.
      }
    };
    advanceFollowUps();
    scheduleSync();
    const followUpTimer = setInterval(advanceFollowUps, 15 * 60 * 1000);
    followUpTimer.unref();

    api.on("gateway_stop", async () => {
      clearInterval(followUpTimer);
      await store.close();
    });
  },
});
