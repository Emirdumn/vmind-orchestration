import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CRMStore, CrmValidationError, validateCalculatorUrl } from "./crm-store.js";
import { PostgresCrmValidationError } from "./postgres-store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Kabul edilmesi gerekenler
// ---------------------------------------------------------------------------

// Teklif Ajanı'nın ürettiği gerçek yayınlama linki. Bu host listede olmadığı
// için saveCalculation sessizce reddediliyordu — bu testin varlık sebebi.
const LIVE_SHARE_URL =
  "https://calculator.portvmind.com/my-estimate/1c659e42-fd08-44d8-9b86-1158513120d9";

for (const url of [
  LIVE_SHARE_URL,
  // Eski geçerli linkler bozulmamalı.
  "https://teklif.43-229-94-48.sslip.io/c/CALC-18492",
  "https://vmind.com.tr/teklif/CALC-1",
  "https://www.vmind.com.tr/teklif/CALC-1",
  "https://teklif.vmind.com.tr/c/CALC-1",
  // hostname WHATWG URL tarafından küçük harfe çevrilir.
  "https://CALCULATOR.PORTVMIND.COM/my-estimate/abc",
]) {
  assert.equal(typeof validateCalculatorUrl(url), "string", `kabul edilmeliydi: ${url}`);
}

// ---------------------------------------------------------------------------
// Reddedilmesi gerekenler
// ---------------------------------------------------------------------------

for (const url of [
  // HTTP — TLS zorunlu.
  "http://calculator.portvmind.com/my-estimate/abc",
  // Kimlik bilgisi gömülü URL.
  "https://kullanici:sifre@calculator.portvmind.com/my-estimate/abc",
  // Son ek saldırısı: izin verilen host bir alt alan adı olarak görünüyor.
  "https://calculator.portvmind.com.evil.com/my-estimate/abc",
  // `@` ile gerçek host gizlenmeye çalışılıyor.
  "https://calculator.portvmind.com@evil.com/my-estimate/abc",
  // Baştaki nokta olmadan suffix eşleşmesi olmamalı.
  "https://xvmind.com.tr/teklif/CALC-1",
  "https://notportvmind.com/my-estimate/abc",
  // Alakasız alan.
  "https://example.com/offer",
  // Biçimsiz ve boş girdi.
  "not-a-url",
  "",
  null,
]) {
  assert.throws(
    () => validateCalculatorUrl(url),
    CrmValidationError,
    `reddedilmeliydi: ${String(url)}`,
  );
}

// ---------------------------------------------------------------------------
// Hata kimliği çağırana ait kalmalı
// ---------------------------------------------------------------------------

assert.throws(
  () => validateCalculatorUrl("https://example.com/offer", PostgresCrmValidationError),
  PostgresCrmValidationError,
);
// PostgresCrmValidationError, CrmValidationError'dan türediği için index.js'in
// `instanceof CrmValidationError` yakalaması her iki store'da da çalışır.
assert.ok(new PostgresCrmValidationError("x") instanceof CrmValidationError);

// ---------------------------------------------------------------------------
// Ayrışma regresyonu: politika tek dosyada kalmalı
// ---------------------------------------------------------------------------

const postgresSource = readFileSync(new URL("./postgres-store.js", import.meta.url), "utf8");
assert.ok(
  !/CALCULATOR_HOSTS\s*=/.test(postgresSource),
  "postgres-store.js kendi host listesini tanımlamamalı; crm-store.js'ten import etmeli.",
);
assert.ok(
  !/function\s+validateCalculatorUrl/.test(postgresSource),
  "postgres-store.js kendi validateCalculatorUrl'ünü tanımlamamalı.",
);

// ---------------------------------------------------------------------------
// Uçtan uca: SQLite store gerçekten kaydediyor mu
// ---------------------------------------------------------------------------

const root = mkdtempSync(join(tmpdir(), "vmind-crm-url-"));
const store = new CRMStore(join(root, "crm.sqlite"));
try {
  const ctx = { requesterSenderId: "+905551112233", sessionKey: "s:whatsapp:+905551112233" };
  const need = store.saveNeed(ctx, { customer_need: "4 sunucu, premium disk" });

  const saved = store.saveCalculation(ctx, {
    opportunity_id: need.opportunity.opportunity_id,
    calculator_id: "CALC-PORTVMIND-1",
    calculator_url: LIVE_SHARE_URL,
    configuration_summary: "4 x compute + premium disk",
    estimated_amount: 2143.15,
    currency: "TRY",
  });

  assert.equal(saved.calculation.calculator_url, LIVE_SHARE_URL);
  assert.equal(store.stats().calculations, 1);

  console.log(JSON.stringify({ ok: true, accepted_host: "calculator.portvmind.com" }));
} finally {
  store.close();
  rmSync(root, { recursive: true, force: true });
}
