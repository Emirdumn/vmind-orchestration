import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CRMStore, normalizePhone } from "./crm-store.js";
import {
  createSiteHealthHttpHandler,
  createSiteSignature,
  verifySiteSignature,
  normalizeSiteQuotePayload,
  syncSiteQuote,
} from "./site-api.js";

const directory = mkdtempSync(join(tmpdir(), "vmind-crm-site-"));
const store = new CRMStore(join(directory, "crm.sqlite"), {
  now: () => new Date("2026-08-14T09:00:00.000Z"),
});

try {
  assert.equal(normalizePhone("0555 123 45 67"), "+905551234567");
  assert.equal(normalizePhone("555 123 45 67"), "+905551234567");

  const secret = "site-test-secret-that-is-at-least-32-characters";
  const timestamp = "1786698000";
  const rawBody = JSON.stringify({ hello: "world" });
  const signature = createSiteSignature(secret, timestamp, rawBody);
  assert.equal(
    verifySiteSignature(secret, timestamp, rawBody, `v1=${signature}`, 1786698000 * 1000),
    true,
  );
  assert.equal(
    verifySiteSignature(
      ["new-site-secret-that-is-at-least-32-characters", secret],
      timestamp,
      rawBody,
      `v1=${signature}`,
      1786698000 * 1000,
    ),
    true,
  );
  assert.equal(
    verifySiteSignature(secret, timestamp, `${rawBody}x`, `v1=${signature}`, 1786698000 * 1000),
    false,
  );
  assert.equal(
    verifySiteSignature(secret, timestamp, rawBody, `v1=${signature}`, 1786699000 * 1000),
    false,
  );

  const healthTimestamp = "1786698000";
  const healthSignature = createSiteSignature(secret, healthTimestamp, "");
  const healthRequest = {
    method: "GET",
    headers: {
      "x-vmind-crm-timestamp": healthTimestamp,
      "x-vmind-crm-signature": `v1=${healthSignature}`,
    },
  };
  const healthResponse = {
    status: null,
    headers: null,
    body: "",
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
  const healthHandler = createSiteHealthHttpHandler({
    store: { ready: async () => {}, schema: { verified: ["001"] } },
    secret,
    now: () => 1786698000 * 1000,
  });
  await healthHandler(healthRequest, healthResponse);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(JSON.parse(healthResponse.body), {
    ok: true,
    database: "ready",
    schema_verified: 1,
  });

  const flowSessionId = randomUUID();
  const calculatorId = randomUUID();
  const payload = {
    event_id: `site-quote:${flowSessionId}`,
    flow_session_id: flowSessionId,
    customer: {
      phone_e164: "0555 123 45 67",
      name: "Deniz",
      company: "Örnek AŞ",
      communication_status: "opted_in",
      consent_notice_version: "2026-08-14",
    },
    opportunity: {
      customer_need: "İki uygulama sunucusu, premium disk ve App Load Balancer.",
      recommended_service: "Compute, Block Storage, Load Balancer",
      qualified: true,
    },
    calculation: {
      calculator_id: calculatorId,
      calculator_url: `https://calculator.portvmind.com/my-estimate/${calculatorId}`,
      configuration_summary: "2x compute; 2x Premium SSD; 1x App Load Balancer",
      estimated_amount: 3991.92,
      currency: "TRY",
    },
  };

  const normalized = normalizeSiteQuotePayload(payload);
  assert.equal(normalized.customer.phone_e164, "+905551234567");
  assert.equal(normalized.customer.communication_status, "opted_in");
  assert.equal(normalized.calculation.currency, "TRY");

  const first = await syncSiteQuote(store, payload);
  assert.equal(first.ok, true);
  assert.equal(first.phone, "+***4567");
  assert.equal(first.opportunity.stage, "Calculation Created");
  assert.equal(first.calculation_created, true);

  // Ayni teslimat yeni CONTACT/OPPORTUNITY/CALCULATION uretmemeli.
  const replay = await syncSiteQuote(store, payload);
  assert.equal(replay.contact_id, first.contact_id);
  assert.equal(replay.opportunity.opportunity_id, first.opportunity.opportunity_id);
  assert.equal(replay.calculation.calculation_id, first.calculation.calculation_id);
  assert.equal(replay.calculation_created, false);

  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM contacts").get().n, 1);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM opportunities").get().n, 1);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM calculations").get().n, 1);
  assert.equal(store.db.prepare("SELECT source FROM opportunities").get().source, "Website");
  const consent = store.db
    .prepare("SELECT communication_status, consent_notice_version, consent_source FROM contacts")
    .get();
  assert.equal(consent.communication_status, "opted_in");
  assert.equal(consent.consent_notice_version, "2026-08-14");
  assert.equal(consent.consent_source, "Website");

  // Hesaplama henuz yayinlanmadiysa yine tek opportunity kaydi olusur.
  const secondFlow = randomUUID();
  const needOnly = await syncSiteQuote(store, {
    event_id: `site-quote:${secondFlow}`,
    flow_session_id: secondFlow,
    customer: {
      phone_e164: "+905551234567",
      communication_status: "opted_in",
      consent_notice_version: "2026-08-14",
    },
    opportunity: {
      customer_need: "Yeni ve ayri bir GPU sunucu ihtiyaci.",
      recommended_service: "GPU Cloud",
      qualified: false,
    },
  });
  assert.equal(needOnly.opportunity.stage, "Need Identified");
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM contacts").get().n, 1);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM opportunities").get().n, 2);

  assert.throws(
    () => normalizeSiteQuotePayload({ ...payload, extra: true }),
    /bilinmeyen alan/,
  );
  assert.throws(
    () => normalizeSiteQuotePayload({
      ...payload,
      customer: {
        phone_e164: "123",
        communication_status: "opted_in",
        consent_notice_version: "2026-08-14",
      },
    }),
    /E\.164/,
  );
  assert.throws(
    () => normalizeSiteQuotePayload({
      ...payload,
      customer: {
        phone_e164: "+905551234567",
        communication_status: "not_requested",
        consent_notice_version: "2026-08-14",
      },
    }),
    /açık iletişim onayı/,
  );

  process.stdout.write(
    `${JSON.stringify({ ok: true, contacts: 1, opportunities: 2, calculations: 1, hmac: true, health: true })}\n`,
  );
} finally {
  store.close();
  rmSync(directory, { recursive: true, force: true });
}
