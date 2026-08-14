import { createHmac, timingSafeEqual } from "node:crypto";

import { CrmValidationError, normalizePhone } from "./crm-store.js";

export const SITE_QUOTE_ROUTE = "/vmind-crm/v1/site/quotes";
export const SITE_HEALTH_ROUTE = "/vmind-crm/v1/site/health";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/;

function requiredText(value, label, maxLength) {
  const text = String(value ?? "").trim();
  if (!text) throw new CrmValidationError(`${label} zorunludur.`);
  if (text.length > maxLength) {
    throw new CrmValidationError(`${label} en fazla ${maxLength} karakter olabilir.`);
  }
  return text;
}

function optionalText(value, label, maxLength) {
  if (value == null || String(value).trim() === "") return undefined;
  return requiredText(value, label, maxLength);
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CrmValidationError(`${label} nesne olmalıdır.`);
  }
  return value;
}

function exactKeys(value, allowed, label) {
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  if (extras.length > 0) {
    throw new CrmValidationError(`${label} bilinmeyen alan içeriyor: ${extras.join(", ")}.`);
  }
}

export function normalizeSiteQuotePayload(input) {
  const body = record(input, "İstek");
  exactKeys(
    body,
    new Set(["event_id", "flow_session_id", "customer", "opportunity", "calculation"]),
    "İstek",
  );

  const eventId = requiredText(body.event_id, "Olay kimliği", 160);
  if (!EVENT_ID_RE.test(eventId)) throw new CrmValidationError("Olay kimliği geçersizdir.");

  const flowSessionId = requiredText(body.flow_session_id, "Akış kimliği", 36);
  if (!UUID_RE.test(flowSessionId)) throw new CrmValidationError("Akış kimliği geçersizdir.");

  const customer = record(body.customer, "Müşteri");
  exactKeys(customer, new Set(["phone_e164", "name", "company"]), "Müşteri");
  const phone = normalizePhone(requiredText(customer.phone_e164, "Müşteri telefonu", 32));
  if (!phone) throw new CrmValidationError("Müşteri telefonu E.164 biçimine çevrilemedi.");
  const customerName = optionalText(customer.name, "Ad", 160);
  const customerCompany = optionalText(customer.company, "Şirket", 240);

  const opportunity = record(body.opportunity, "Fırsat");
  exactKeys(
    opportunity,
    new Set(["customer_need", "recommended_service", "qualified"]),
    "Fırsat",
  );
  const recommendedService = optionalText(
    opportunity.recommended_service,
    "Önerilen hizmet",
    500,
  );

  let calculation;
  if (body.calculation !== undefined) {
    const raw = record(body.calculation, "Hesaplama");
    exactKeys(
      raw,
      new Set([
        "calculator_id",
        "calculator_url",
        "configuration_summary",
        "estimated_amount",
        "currency",
      ]),
      "Hesaplama",
    );
    const estimatedAmount = Number(raw.estimated_amount);
    if (!Number.isFinite(estimatedAmount) || estimatedAmount < 0) {
      throw new CrmValidationError("Teklif tutarı geçersizdir.");
    }
    const currency = String(raw.currency ?? "TRY").trim().toUpperCase();
    if (!new Set(["TRY", "USD"]).has(currency)) {
      throw new CrmValidationError("Para birimi desteklenmiyor.");
    }
    calculation = {
      calculator_id: requiredText(raw.calculator_id, "Calculator kimliği", 160),
      calculator_url: requiredText(raw.calculator_url, "Calculator bağlantısı", 2048),
      configuration_summary: requiredText(raw.configuration_summary, "Konfigürasyon özeti", 4000),
      estimated_amount: estimatedAmount,
      currency,
    };
  }

  return {
    event_id: eventId,
    flow_session_id: flowSessionId,
    customer: {
      phone_e164: phone,
      ...(customerName ? { name: customerName } : {}),
      ...(customerCompany ? { company: customerCompany } : {}),
    },
    opportunity: {
      customer_need: requiredText(opportunity.customer_need, "Müşteri ihtiyacı", 2000),
      ...(recommendedService ? { recommended_service: recommendedService } : {}),
      qualified: opportunity.qualified === true,
    },
    ...(calculation ? { calculation } : {}),
  };
}

export function createSiteSignature(secret, timestamp, rawBody) {
  const key = String(secret ?? "");
  if (key.length < 32) throw new Error("VMIND_CRM_SITE_SECRET en az 32 karakter olmalıdır.");
  return createHmac("sha256", key).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function verifySiteSignature(secret, timestamp, rawBody, provided, now = Date.now()) {
  const seconds = Number(timestamp);
  if (!Number.isInteger(seconds)) return false;
  const nowSeconds = Math.floor(now / 1000);
  if (Math.abs(nowSeconds - seconds) > MAX_CLOCK_SKEW_SECONDS) return false;
  const signature = String(provided ?? "").replace(/^v1=/, "");
  if (!/^[0-9a-f]{64}$/i.test(signature)) return false;

  let expected;
  try {
    expected = createSiteSignature(secret, String(timestamp), rawBody);
  } catch {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
}

export async function syncSiteQuote(store, input) {
  const payload = normalizeSiteQuotePayload(input);
  const context = {
    requesterSenderId: payload.customer.phone_e164,
    sessionKey: `site:${payload.flow_session_id}`,
    vmindCrmSource: "Website",
  };
  const need = await store.saveNeed(context, {
    customer_need: payload.opportunity.customer_need,
    ...(payload.opportunity.recommended_service
      ? { recommended_service: payload.opportunity.recommended_service }
      : {}),
    ...(payload.customer.name ? { name: payload.customer.name } : {}),
    ...(payload.customer.company ? { company: payload.customer.company } : {}),
    qualified: payload.opportunity.qualified,
  });

  let calculation;
  if (payload.calculation) {
    calculation = await store.saveCalculation(context, {
      opportunity_id: need.opportunity.opportunity_id,
      ...payload.calculation,
    });
  }

  return {
    ok: true,
    event_id: payload.event_id,
    contact_id: need.contact_id,
    phone: need.phone,
    opportunity: calculation?.opportunity ?? need.opportunity,
    ...(calculation ? { calculation: calculation.calculation, calculation_created: calculation.created } : {}),
  };
}

function header(req, name) {
  const value = req.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

async function readRawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new CrmValidationError("İstek gövdesi çok büyük.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

export function createSiteQuoteHttpHandler({ store, secret, now = () => Date.now() }) {
  if (String(secret ?? "").length < 32) {
    throw new Error("VMIND_CRM_SITE_SECRET en az 32 karakter olmalıdır.");
  }

  return async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Yalnızca POST desteklenir." });
      return true;
    }

    let rawBody;
    try {
      rawBody = await readRawBody(req);
    } catch (error) {
      sendJson(res, 413, { error: error.message });
      return true;
    }

    const timestamp = header(req, "x-vmind-crm-timestamp");
    const signature = header(req, "x-vmind-crm-signature");
    if (!verifySiteSignature(secret, timestamp, rawBody, signature, now())) {
      sendJson(res, 401, { error: "İmza doğrulanamadı." });
      return true;
    }

    let input;
    try {
      input = JSON.parse(rawBody);
    } catch {
      sendJson(res, 400, { error: "Geçersiz JSON." });
      return true;
    }

    try {
      const result = await syncSiteQuote(store, input);
      sendJson(res, 200, result);
    } catch (error) {
      if (error instanceof CrmValidationError) {
        sendJson(res, 400, { error: error.message });
      } else {
        console.error("[vmind-crm] site senkronu güvenli biçimde tamamlanamadı:", error);
        sendJson(res, 503, { error: "CRM geçici olarak kullanılamıyor." });
      }
    }
    return true;
  };
}

export function createSiteHealthHttpHandler({ store, secret, now = () => Date.now() }) {
  if (String(secret ?? "").length < 32) {
    throw new Error("VMIND_CRM_SITE_SECRET en az 32 karakter olmalıdır.");
  }

  return async (req, res) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Yalnızca GET desteklenir." });
      return true;
    }

    const timestamp = header(req, "x-vmind-crm-timestamp");
    const signature = header(req, "x-vmind-crm-signature");
    if (!verifySiteSignature(secret, timestamp, "", signature, now())) {
      sendJson(res, 401, { error: "İmza doğrulanamadı." });
      return true;
    }

    try {
      if (typeof store.ready === "function") await store.ready();
      sendJson(res, 200, {
        ok: true,
        database: "ready",
        schema_verified: Array.isArray(store.schema?.verified)
          ? store.schema.verified.length
          : null,
      });
    } catch (error) {
      console.error("[vmind-crm] site sağlık kontrolü tamamlanamadı:", error);
      sendJson(res, 503, { error: "CRM geçici olarak kullanılamıyor." });
    }
    return true;
  };
}
