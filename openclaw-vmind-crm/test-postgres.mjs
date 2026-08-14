/**
 * PostgreSQL store testi — İZOLE, TEKRAR ÇALIŞTIRILABİLİR, VERİ BIRAKMAZ.
 *
 * İzolasyon üç şeye dayanıyor:
 *
 *   1. Her çalıştırma KENDİ tenant'ını üretir (rastgele UUID + benzersiz slug).
 *   2. Store'un bütün yazma/okuma sorguları `WHERE tenant_id = $1` ile sınırlı
 *      — `advanceDueFollowUps` ve `markProposalSent` dahil. Başka tenant'ın
 *      satırına dokunamaz.
 *   3. `finally` yalnızca bu tenant'ın satırlarını siler; hem çocuk kayıtların
 *      hem de TENANT SATIRININ gittiğini ayrı sorgularla DOĞRULAR.
 *
 * ## Üretim veritabanında çalıştırma
 *
 * Bu test canlı CRM veritabanında smoke test olarak kullanılabilir, ama iki
 * koruma altında:
 *
 *   - `VMIND_ALLOW_LIVE_DB_TEST=1` yoksa üretim DB'sinde BAĞLANMADAN reddeder.
 *   - Üretimde `applyPostgresMigrations` ÇALIŞMAZ. Smoke test şema değiştirmez;
 *     migration ayrı bir dağıtım adımıdır (`npm run db:migrate`).
 *
 * Tek kullanımlık bir veritabanında (yerel konteyner) migration otomatik
 * uygulanır, çünkü orada şema henüz yoktur.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { applyPostgresMigrations, createPostgresPool } from "./postgres-db.js";
import { PostgresCRMStore, PostgresCrmValidationError } from "./postgres-store.js";
import { STAGES } from "./crm-store.js";
import { syncSiteQuote } from "./site-api.js";

// Şeması dışarıdan yönetilen, testin ASLA migrate etmeyeceği veritabanları.
const PRODUCTION_DATABASES = new Set(["vmind", "vmind_runtime"]);

function resolveDatabaseName(env) {
  const url = String(env.VMIND_DATABASE_URL ?? env.DATABASE_URL ?? "").trim();
  if (url) {
    try {
      return new URL(url).pathname.replace(/^\//, "") || null;
    } catch {
      return null;
    }
  }
  const name = String(env.PGDATABASE ?? "").trim();
  return name || null;
}

const databaseName = resolveDatabaseName(process.env);
const isProduction = databaseName != null && PRODUCTION_DATABASES.has(databaseName);
const liveAllowed = process.env.VMIND_ALLOW_LIVE_DB_TEST === "1";

// Kararı görünür yap: hangi DB'ye, hangi modda gidildiği tahmine kalmasın.
console.log(JSON.stringify({
  target_database: databaseName ?? "(belirtilmemiş)",
  mode: isProduction ? "live" : "disposable",
  migrations: isProduction ? "atlanacak" : "uygulanacak",
}));

// BAĞLANMADAN önce reddet — yanlışlıkla çalıştırma buraya kadar gelmesin.
if (isProduction && !liveAllowed) {
  console.error(
    `REDDEDİLDİ: "${databaseName}" üretim veritabanı olarak tanınıyor.\n` +
    "Canlı smoke test için açık onay gerekir:\n" +
    "  VMIND_ALLOW_LIVE_DB_TEST=1 npm run test:postgres\n" +
    "Şema değişikliği için ayrı adım kullanın: npm run db:migrate",
  );
  process.exit(1);
}

// Yalnızca bu çalıştırmaya ait kimlikler.
const tenantId = randomUUID();
const runTag = tenantId.slice(0, 8);
const testPhone = "+905551234567";

// Silme sırası FK'lere göre: çocuklar önce, tenant en son.
const CLEANUP_ORDER = [
  "crm.sync_outbox",
  "crm.sales_tasks",
  "crm.stage_events",
  "crm.calculations",
  "crm.opportunities",
  "crm.contacts",
  "identity.api_keys",
  "identity.principals",
];

async function cleanup(pool) {
  for (const table of CLEANUP_ORDER) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }

  // Çocuk kayıt kalmadığını KANITLA — "temizledim" demek yetmez.
  const children = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM crm.contacts      WHERE tenant_id = $1) +
       (SELECT COUNT(*) FROM crm.opportunities WHERE tenant_id = $1) +
       (SELECT COUNT(*) FROM crm.calculations  WHERE tenant_id = $1) +
       (SELECT COUNT(*) FROM crm.stage_events  WHERE tenant_id = $1) +
       (SELECT COUNT(*) FROM crm.sales_tasks   WHERE tenant_id = $1) +
       (SELECT COUNT(*) FROM crm.sync_outbox   WHERE tenant_id = $1) AS remaining`,
    [tenantId],
  );

  await pool.query("DELETE FROM identity.tenants WHERE tenant_id = $1", [tenantId]);

  // Tenant satırının kendisi de gitmeli — ayrı sorguyla doğrulanır.
  const tenantRow = await pool.query(
    "SELECT COUNT(*) AS remaining FROM identity.tenants WHERE tenant_id = $1",
    [tenantId],
  );

  return {
    tenant: tenantId,
    remaining_rows: Number(children.rows[0].remaining),
    remaining_tenant_rows: Number(tenantRow.rows[0].remaining),
  };
}

const pool = createPostgresPool();
let current = new Date("2026-08-14T09:00:00.000Z");
let store;
// Tenant gerçekten oluşturulmadıysa temizleyecek bir şey yok; şema eksikse
// körlemesine DELETE denemek asıl hata mesajını gizliyordu.
let tenantCreated = false;
let failure;

try {
  if (isProduction) {
    // Şema burada zaten var; testin işi onu değiştirmek değil, doğrulamak.
    // Yoksa net bir mesajla dur — sessizce yarım çalışma olmasın.
    try {
      await pool.query("SELECT 1 FROM identity.tenants LIMIT 1");
    } catch (error) {
      throw new Error(
        `"${databaseName}" üzerinde CRM şeması bulunamadı. ` +
        "Önce dağıtım adımı olarak `npm run db:migrate` çalıştırın. " +
        `Ayrıntı: ${error.message}`,
      );
    }
  } else {
    await applyPostgresMigrations(pool);
  }

  await pool.query(
    `INSERT INTO identity.tenants (tenant_id, slug, display_name) VALUES ($1, $2, $3)`,
    [tenantId, `crm-test-${runTag}`, `CRM test tenant ${runTag}`],
  );
  tenantCreated = true;

  store = new PostgresCRMStore({
    now: () => current,
    tenantId,
    pool,
    migrate: false,
  });

  const ctx = {
    messageChannel: "whatsapp",
    requesterSenderId: "905551234567@s.whatsapp.net",
    sessionKey: "agent:main:whatsapp:direct:+905551234567",
  };

  await store.ready();

  const need = await store.saveNeed(ctx, {
    customer_need: "2 adet H200 GPU sunucu ile yapay zekâ inference çalıştırmak",
    recommended_service: "VMind GPU Cloud",
    qualified: true,
    company: "Örnek AŞ",
  });
  assert.equal(need.opportunity.stage, STAGES.QUALIFIED);

  // --- eski geçerli host bozulmamalı --------------------------------------
  const saved = await store.saveCalculation(ctx, {
    opportunity_id: need.opportunity.opportunity_id,
    calculator_id: `PG-CALC-${runTag}-1`,
    calculator_url: "https://teklif.43-229-94-48.sslip.io/c/PG-CALC-18492",
    configuration_summary: "2x H200 GPU / AI inference",
    estimated_amount: 125000,
    currency: "TRY",
  });
  assert.equal(saved.created, true);
  assert.equal(saved.calculation.version, 1);
  assert.equal(saved.opportunity.stage, STAGES.CALCULATION_CREATED);
  assert.equal(saved.opportunity.next_follow_up, "2026-08-18");

  const duplicate = await store.saveCalculation(ctx, {
    opportunity_id: need.opportunity.opportunity_id,
    calculator_id: `PG-CALC-${runTag}-1`,
    calculator_url: "https://teklif.43-229-94-48.sslip.io/c/PG-CALC-18492",
    configuration_summary: "2x H200 GPU / AI inference",
    estimated_amount: 125000,
    currency: "TRY",
  });
  assert.equal(duplicate.created, false);

  // --- BAŞARI: Teklif Ajanı'nın gerçek yayınlama linki ---------------------
  // Bu host allowlist'te olmadığı için üretimde saveCalculation sessizce
  // reddediliyordu. PostgreSQL yolu üretim yolu olduğu için burada kanıtlanır.
  const canonicalUrl =
    "https://calculator.portvmind.com/my-estimate/1c659e42-fd08-44d8-9b86-1158513120d9";
  const portvmind = await store.saveCalculation(ctx, {
    opportunity_id: need.opportunity.opportunity_id,
    calculator_id: `PG-CALC-${runTag}-2`,
    calculator_url: canonicalUrl,
    configuration_summary: "4x compute / premium disk",
    estimated_amount: 2143.15,
    currency: "TRY",
  });
  assert.equal(portvmind.created, true);
  assert.equal(portvmind.calculation.version, 2);
  // Link OKUNARAK doğrulanır — yazıldığını varsaymıyoruz.
  assert.equal(portvmind.calculation.calculator_url, canonicalUrl);

  // --- BAŞARISIZLIK: benzer görünen host reddedilmeli ----------------------
  // Doğrulama transaction'dan ÖNCE çalıştığı için kısmi yazma bırakmaz.
  for (const badUrl of [
    "https://calculator.portvmind.com.evil.com/my-estimate/abc",
    "http://calculator.portvmind.com/my-estimate/abc",
    "https://kullanici:sifre@calculator.portvmind.com/my-estimate/abc",
  ]) {
    await assert.rejects(
      store.saveCalculation(ctx, {
        opportunity_id: need.opportunity.opportunity_id,
        calculator_id: `PG-CALC-${runTag}-EVIL`,
        calculator_url: badUrl,
        configuration_summary: "Geçersiz host",
        estimated_amount: 10,
        currency: "TRY",
      }),
      PostgresCrmValidationError,
      `reddedilmeliydi: ${badUrl}`,
    );
  }

  // --- yaşam döngüsünün geri kalanı ---------------------------------------
  const proposal = await store.markProposalSent(
    testPhone,
    `Teklifiniz: ${saved.calculation.calculator_url}`,
  );
  assert.equal(proposal.stage, STAGES.PROPOSAL_SENT);

  current = new Date("2026-08-18T08:00:00.000Z");
  assert.equal(await store.advanceDueFollowUps(), 1);
  assert.equal((await store.getContext(ctx)).opportunities[0].stage, STAGES.FOLLOW_UP);

  await assert.rejects(
    store.requestSalesContact(ctx, {
      opportunity_id: need.opportunity.opportunity_id,
      explicit_confirmation: false,
    }),
    PostgresCrmValidationError,
  );
  const contactRequest = await store.requestSalesContact(ctx, {
    opportunity_id: need.opportunity.opportunity_id,
    explicit_confirmation: true,
  });
  assert.equal(contactRequest.stage, STAGES.SALES_CONTACT_REQUESTED);

  await store.setCommunicationStatus(ctx, { status: "opted_out", explicit_confirmation: true });
  assert.equal((await store.getContext(ctx)).contact.communication_status, "opted_out");

  // --- site -> kontrollü CRM API -> PostgreSQL ----------------------------
  // Aynı müşteri altında ayrı site akışı ayrı opportunity oluşturur. Aynı
  // teslimat tekrarlandığında advisory lock + session anahtarı ikinci kayıt
  // açmaz; kaynak da WhatsApp değil Website olarak kalır.
  const siteFlowSessionId = randomUUID();
  const sitePayload = {
    event_id: `site-quote:${siteFlowSessionId}`,
    flow_session_id: siteFlowSessionId,
    customer: {
      phone_e164: testPhone,
      name: "Site Test Müşterisi",
      company: "Örnek AŞ",
    },
    opportunity: {
      customer_need: "Site üzerinden ayrı bir uygulama sunucusu ihtiyacı.",
      recommended_service: "VMind Compute",
      qualified: true,
    },
  };
  const siteFirst = await syncSiteQuote(store, sitePayload);
  const siteReplay = await syncSiteQuote(store, sitePayload);
  assert.equal(siteReplay.contact_id, siteFirst.contact_id);
  assert.equal(
    siteReplay.opportunity.opportunity_id,
    siteFirst.opportunity.opportunity_id,
  );
  const siteSource = await pool.query(
    "SELECT source FROM crm.opportunities WHERE tenant_id = $1 AND opportunity_id = $2",
    [tenantId, siteFirst.opportunity.opportunity_id],
  );
  assert.equal(siteSource.rows[0].source, "Website");

  // stats() tenant'a göre saydığı için taze tenant'ta sayılar deterministik.
  const stats = await store.stats();
  assert.deepEqual(
    {
      contacts: stats.contacts,
      opportunities: stats.opportunities,
      calculations: stats.calculations,
      tasks: stats.tasks,
    },
    // İki hesaplama: eski host (v1) + canonical portvmind linki (v2).
    { contacts: 1, opportunities: 2, calculations: 2, tasks: 1 },
  );

  console.log(JSON.stringify({ ok: true, tenant: tenantId, ...stats }));
} catch (error) {
  failure = error;
}

if (store) await store.close().catch(() => {});

let cleanupFailure;
if (tenantCreated) {
  try {
    const report = await cleanup(pool);
    console.log(JSON.stringify({ cleanup: "ok", ...report }));
    assert.equal(report.remaining_rows, 0, "test tenant'ından artık kayıt kalmamalı");
    assert.equal(report.remaining_tenant_rows, 0, "test tenant satırı da silinmeliydi");
  } catch (error) {
    // Temizlik başarısızsa tenant kimliği görünür olmalı; elle silinebilsin.
    console.error(`TEMİZLİK BAŞARISIZ — bu tenant elle silinmeli: ${tenantId}`);
    cleanupFailure = error;
  }
} else {
  console.log(JSON.stringify({ cleanup: "atlandı", reason: "test tenant'ı oluşturulmadı" }));
}

await pool.end();

// Asıl hata önceliklidir; temizlik hatası onu gizlememeli.
if (failure) throw failure;
if (cleanupFailure) throw cleanupFailure;
