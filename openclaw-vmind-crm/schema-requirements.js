/**
 * FAZ 0 — CRM veritabanının karşılaması gereken şema manifesti.
 *
 * ## Neden ayrı dosya
 *
 * Gateway açılışında artık migration UYGULANMIYOR (bkz. index.js).
 * Sözleşme: runtime/gateway şema YAZAMAZ; migration yalnızca açık deploy/admin
 * komutlarıyla yapılır (`npm run db:migrate`, `npm run db:import-sqlite`).
 * Eklenti yalnızca "beklediğim şema orada mı" diye DOĞRULAR.
 *
 * Bu manifest o beklentinin tek kaynağıdır. `package.json` içine konmadı:
 * sürüm numarası değil, uygulanmış migration'ın ADI ve İÇERİK ÖZETİ
 * gerekiyor — paket sürümüyle ilgisi yok ve paket sürümü değişmeden şema
 * değişebilir (ya da tersi).
 *
 * ## checksum nereden geliyor
 *
 * `applyPostgresMigrations` her migration dosyasının sha256'sını
 * `platform.schema_migrations.checksum` alanına yazar. Buradaki değer o
 * algoritmayla üretilmiştir ve canlı `vmind` veritabanındaki kayıtla
 * birebir doğrulanmıştır.
 *
 * ## İleri sürümler REDDEDİLMEZ
 *
 * Doğrulama yalnızca "gerekli olanlar var mı" sorusunu sorar. Veritabanında
 * bunlardan sonra gelen, geriye uyumlu başka migration'lar bulunması normaldir
 * ve uygulamayı engellemez.
 */

/** @typedef {{ version: string, checksum: string }} SchemaRequirement */

/** @type {ReadonlyArray<SchemaRequirement>} */
export const CRM_SCHEMA_REQUIREMENTS = Object.freeze([
  Object.freeze({
    version: "001_platform_foundation.sql",
    checksum: "0bb5760fd341c3a3a100414387c871bdd898b1771b8e77eef12a3d17f4e7a219",
  }),
  Object.freeze({
    version: "004_contact_consent_audit.sql",
    checksum: "b7565be05e730ee9ba52c6e78b20149cd0d1ddbee820eb77dac1c6046e7ce738",
  }),
]);

/** Şema beklentisi karşılanmadığında fırlatılır. Bağlantı hatasından ayrıdır. */
export class SchemaRequirementError extends Error {
  constructor(message) {
    super(message);
    this.name = "SchemaRequirementError";
  }
}

const MIGRATE_HINT = "Şema değişikliği dağıtım adımıdır: `npm run db:migrate`.";

/**
 * Gerekli migration'ların uygulanmış ve içeriklerinin değişmemiş olduğunu
 * doğrular. Hiçbir şey YAZMAZ — yalnızca okur.
 *
 * @returns {Promise<{ verified: string[], appliedCount: number }>}
 */
export async function verifyAppliedSchema(pool, requirements = CRM_SCHEMA_REQUIREMENTS) {
  let rows;
  try {
    const result = await pool.query(
      "SELECT version, checksum FROM platform.schema_migrations",
    );
    rows = result.rows;
  } catch (error) {
    // Tablo yoksa ham "relation does not exist" yerine ne yapılacağını söyle.
    throw new SchemaRequirementError(
      `platform.schema_migrations okunamadı; CRM şeması kurulu görünmüyor. ${MIGRATE_HINT} ` +
        `Ayrıntı: ${error.message}`,
    );
  }

  const applied = new Map(rows.map((row) => [row.version, row.checksum]));
  for (const requirement of requirements) {
    const checksum = applied.get(requirement.version);
    if (checksum === undefined) {
      throw new SchemaRequirementError(
        `Gerekli migration uygulanmamış: ${requirement.version}. ${MIGRATE_HINT}`,
      );
    }
    if (checksum !== requirement.checksum) {
      throw new SchemaRequirementError(
        `Migration içeriği beklenenden farklı: ${requirement.version} ` +
          `(beklenen ${requirement.checksum.slice(0, 12)}…, ` +
          `bulunan ${String(checksum).slice(0, 12)}…). ` +
          "Veritabanı bu eklentinin beklediği şemada değil.",
      );
    }
  }

  return {
    verified: requirements.map((requirement) => requirement.version),
    appliedCount: applied.size,
  };
}
