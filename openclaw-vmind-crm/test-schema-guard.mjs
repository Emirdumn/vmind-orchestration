/**
 * FAZ 0 — otomatik migration kapalı + şema doğrulama testleri.
 *
 * Beş senaryo:
 *   1. Gerekli migration'lar mevcut  → store hazır
 *   2. Şema yok                      → net şema hatası, migration UYGULANMAZ
 *   3. Gerekli checksum yanlış       → net hata
 *   4. SQL dizininde uygulanmamış ek → store onu UYGULAMAZ
 *   5. PostgreSQL erişilemiyor       → süreç ayakta, CRM güvenli hata
 *
 * İzolasyon: her senaryo kendi geçici veritabanını ve gerektiğinde kendi
 * GEÇİCİ migration dizinini kullanır. Canlı `sql/` dizinine hiçbir dosya
 * yazılmaz.
 *
 * Çalıştırma (tek kullanımlık PostgreSQL gerekir):
 *   VMIND_TEST_PG_URL=postgres://... node test-schema-guard.mjs
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { applyPostgresMigrations } from "./postgres-db.js";
import { PostgresCRMStore } from "./postgres-store.js";
import {
  CRM_SCHEMA_REQUIREMENTS,
  SchemaRequirementError,
  verifyAppliedSchema,
} from "./schema-requirements.js";

const { Pool } = pg;

const BASE_URL = process.env.VMIND_TEST_PG_URL;
if (!BASE_URL) {
  console.error("VMIND_TEST_PG_URL gerekli (tek kullanımlık PostgreSQL).");
  process.exit(2);
}

// .pathname yüzde-kodlamayı çözmez; dizin adında boşluk var.
const SQL_DIR = fileURLToPath(new URL("./sql/", import.meta.url));
const FOUNDATION = "001_platform_foundation.sql";
const CONSENT_AUDIT = "004_contact_consent_audit.sql";
const adminPool = new Pool({ connectionString: BASE_URL });
const olusturulan = [];
const gecici = [];

async function taze(adPrefix) {
  const name = `${adPrefix}_${randomUUID().slice(0, 8)}`;
  await adminPool.query(`CREATE DATABASE ${name}`);
  olusturulan.push(name);
  const url = new URL(BASE_URL);
  url.pathname = `/${name}`;
  return { name, url: url.toString() };
}

/** Yalnız 001'i içeren geçici migration dizini — canlı sql/ değişmez. */
function geciciDizin(dosyalar) {
  const dir = mkdtempSync(join(tmpdir(), "vmind-mig-"));
  gecici.push(dir);
  for (const [ad, icerik] of Object.entries(dosyalar)) {
    writeFileSync(join(dir, ad), icerik);
  }
  return dir;
}

const foundationSql = readFileSync(join(SQL_DIR, FOUNDATION), "utf8");
const consentAuditSql = readFileSync(join(SQL_DIR, CONSENT_AUDIT), "utf8");
const requiredMigrations = {
  [FOUNDATION]: foundationSql,
  [CONSENT_AUDIT]: consentAuditSql,
};
const sonuc = [];

// ---------------------------------------------------------------------------
// 1) Gerekli migration'lar mevcut → store hazır
// ---------------------------------------------------------------------------
{
  const db = await taze("s1_hazir");
  const pool = new Pool({ connectionString: db.url });
  await applyPostgresMigrations(pool, { directory: geciciDizin(requiredMigrations) });

  const store = new PostgresCRMStore({ pool, migrate: false });
  await store.ready();

  assert.ok(
    store.schema,
    "migrate:false yolu şemayı DOĞRULAMALI; store.schema boş kaldı (doğrulama atlanmış olabilir)",
  );
  assert.deepEqual(store.schema.verified, [FOUNDATION, CONSENT_AUDIT]);
  assert.equal(store.schema.appliedCount, 2);
  await store.close();
  await pool.end();
  sonuc.push({ senaryo: 1, ad: "gerekli şema mevcut", sonuc: "store hazır" });
}

// ---------------------------------------------------------------------------
// 2) 001 yok → net şema hatası ve HİÇBİR migration uygulanmıyor
// ---------------------------------------------------------------------------
{
  const db = await taze("s2_bos");
  const pool = new Pool({ connectionString: db.url });

  const store = new PostgresCRMStore({ pool, migrate: false });
  const hata = await store.ready().then(() => null, (e) => e);

  assert.ok(hata instanceof SchemaRequirementError, "SchemaRequirementError bekleniyordu");
  assert.match(hata.message, /db:migrate/);

  // Kritik: doğrulama yolu şema YAZMAMALI.
  const tablolar = await pool.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables
      WHERE table_schema IN ('crm','identity','agent','billing','calculator','platform')`,
  );
  assert.equal(tablolar.rows[0].n, 0, "doğrulama yolu hiçbir tablo oluşturmamalı");

  await store.close();
  await pool.end();
  sonuc.push({ senaryo: 2, ad: "001 yok", sonuc: "net hata, 0 tablo oluştu" });
}

// ---------------------------------------------------------------------------
// 3) checksum yanlış → net hata
// ---------------------------------------------------------------------------
{
  const db = await taze("s3_checksum");
  const pool = new Pool({ connectionString: db.url });
  await applyPostgresMigrations(pool, { directory: geciciDizin(requiredMigrations) });

  // Kayıtlı özet bozulur: dosya değişmiş gibi.
  await pool.query("UPDATE platform.schema_migrations SET checksum = $1 WHERE version = $2", [
    "deadbeef".repeat(8),
    FOUNDATION,
  ]);

  const store = new PostgresCRMStore({ pool, migrate: false });
  const hata = await store.ready().then(() => null, (e) => e);

  assert.ok(hata instanceof SchemaRequirementError);
  assert.match(hata.message, /beklenenden farklı/);
  await store.close();
  await pool.end();
  sonuc.push({ senaryo: 3, ad: "checksum yanlış", sonuc: "net hata" });
}

// ---------------------------------------------------------------------------
// 4) VARSAYILAN kurucu (migrate seçeneği YOK) → yine de migration uygulamaz
//
// Bu senaryonun gücü şurada: gerçek `sql/` dizininde 002 ve 003 DURUYOR.
// Store hâlâ `applyPostgresMigrations` çağırsaydı, varsayılan dizinden
// 002 ve 003'ü de uygulardı. Uygulamıyorsa garanti seçeneğe değil YAPIYA bağlıdır.
// ---------------------------------------------------------------------------
{
  const db = await taze("s4_varsayilan");
  const pool = new Pool({ connectionString: db.url });

  // Yalnız zorunlu 001+004 uygulanır; 002/003 bilerek dışarıda bırakılır.
  await applyPostgresMigrations(pool, { directory: geciciDizin(requiredMigrations) });

  // DİKKAT: `migrate: false` BİLEREK verilmiyor — varsayılan da güvenli olmalı.
  const store = new PostgresCRMStore({ pool });
  await store.ready();
  assert.ok(store.schema, "varsayılan kurucu da şemayı doğrulamalı");

  const uygulanmis = await pool.query(
    "SELECT version FROM platform.schema_migrations ORDER BY version",
  );
  assert.deepEqual(
    uygulanmis.rows.map((r) => r.version),
    [FOUNDATION, CONSENT_AUDIT],
    "platform.schema_migrations yalnız zorunlu migration'ları içermeli",
  );

  // 002'nin tablosu ve 003'ün view'ı oluşmamalı.
  const iz = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM information_schema.tables
         WHERE table_schema='agent' AND table_name='audit_events')   AS f002,
       (SELECT COUNT(*)::int FROM information_schema.views
         WHERE table_schema='agent' AND table_name='run_overview')   AS f003`,
  );
  assert.equal(iz.rows[0].f002, 0, "002 uygulanmamalı (agent.audit_events yok olmalı)");
  assert.equal(iz.rows[0].f003, 0, "003 uygulanmamalı (agent.run_overview yok olmalı)");

  await store.close();
  await pool.end();
  sonuc.push({ senaryo: 4, ad: "varsayılan kurucu", sonuc: "ek migration uygulanmadı" });
}

// ---------------------------------------------------------------------------
// 4b) `migrate: true` açıkça REDDEDİLİR
// ---------------------------------------------------------------------------
{
  const db = await taze("s4b_migrate_true");
  const pool = new Pool({ connectionString: db.url });

  assert.throws(
    () => new PostgresCRMStore({ pool, migrate: true }),
    /db:migrate/,
    "migrate:true açık hata vermeli",
  );

  // Havuz VERİLMEDEN de reddedilmeli. Red kontrolü kurucunun en başında
  // olduğu için `createPostgresPool` hiç çağrılmaz ve sızacak havuz oluşmaz.
  assert.throws(
    () => new PostgresCRMStore({ migrate: true }),
    /db:migrate/,
    "havuzsuz migrate:true de reddedilmeli",
  );

  // Reddedilen kurucu hiçbir şey yazmamış olmalı.
  const tablolar = await pool.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables
      WHERE table_schema IN ('crm','identity','agent','billing','calculator','platform')`,
  );
  assert.equal(tablolar.rows[0].n, 0, "reddedilen kurucu şema yazmamalı");

  await pool.end();
  sonuc.push({ senaryo: "4b", ad: "migrate:true", sonuc: "açıkça reddedildi" });
}

// ---------------------------------------------------------------------------
// 5) PostgreSQL erişilemiyor → süreç ayakta, CRM güvenli hata
// ---------------------------------------------------------------------------
{
  const olu = new Pool({
    connectionString: "postgres://yok:yok@127.0.0.1:59999/yok",
    connectionTimeoutMillis: 1500,
  });
  const store = new PostgresCRMStore({ pool: olu, migrate: false });

  const hata = await store.ready().then(() => null, (e) => e);
  assert.ok(hata instanceof SchemaRequirementError, "bağlantı hatası da net mesaja sarılmalı");

  // index.js'in `safeResult` sözleşmesi: yazma yolu REDDEDER, süreç düşmez.
  const yazmaHatasi = await store
    .saveNeed(
      { requesterSenderId: "+905551112233", sessionKey: "s:whatsapp:+905551112233" },
      { customer_need: "test" },
    )
    .then(() => null, (e) => e);
  assert.ok(yazmaHatasi, "şema doğrulanamadıysa CRM yazması reddedilmeli");

  await store.close().catch(() => {});
  await olu.end().catch(() => {});
  sonuc.push({ senaryo: 5, ad: "PostgreSQL erişilemez", sonuc: "süreç ayakta, yazma reddedildi" });
}

// ---------------------------------------------------------------------------
// Manifest tutarlılığı: dosyadaki gerçek özet ile manifest aynı olmalı
// ---------------------------------------------------------------------------
{
  const { createHash } = await import("node:crypto");
  for (const [version, sql] of Object.entries(requiredMigrations)) {
    const gercek = createHash("sha256").update(sql).digest("hex");
    const manifest = CRM_SCHEMA_REQUIREMENTS.find((r) => r.version === version);
    assert.equal(manifest.checksum, gercek, `manifest checksum'ı ${version} ile uyuşmuyor`);
  }
  sonuc.push({ senaryo: 6, ad: "manifest ↔ zorunlu SQL", sonuc: "uyumlu" });
}

// ---------------------------------------------------------------------------
// İleri migration'lar reddedilmemeli
// ---------------------------------------------------------------------------
{
  const db = await taze("s7_ileri");
  const pool = new Pool({ connectionString: db.url });
  await applyPostgresMigrations(pool, {
    directory: geciciDizin({
      ...requiredMigrations,
      "090_ileri_uyumlu.sql": "CREATE TABLE platform.ileri_ornek (x int);",
    }),
  });
  const rapor = await verifyAppliedSchema(pool);
  assert.deepEqual(rapor.verified, [FOUNDATION, CONSENT_AUDIT]);
  assert.equal(rapor.appliedCount, 3, "ileri migration sayılır ama engellemez");
  await pool.end();
  sonuc.push({ senaryo: 7, ad: "ileri uyumlu migration", sonuc: "reddedilmedi" });
}

// ---------------------------------------------------------------------------
for (const s of sonuc) console.log(JSON.stringify(s));
console.log(JSON.stringify({ ok: true, senaryolar: sonuc.length }));

for (const dir of gecici) rmSync(dir, { recursive: true, force: true });
for (const name of olusturulan) await adminPool.query(`DROP DATABASE IF EXISTS ${name}`);
await adminPool.end();
