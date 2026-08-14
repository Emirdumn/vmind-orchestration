import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const STAGES = Object.freeze({
  NEW: "New",
  NEED_IDENTIFIED: "Need Identified",
  QUALIFIED: "Qualified",
  CALCULATION_CREATED: "Calculation Created",
  PROPOSAL_SENT: "Proposal Sent",
  FOLLOW_UP: "Follow-up",
  SALES_CONTACT_REQUESTED: "Sales Contact Requested",
  WON: "Won",
  LOST: "Lost",
});

const TERMINAL_STAGES = new Set([STAGES.WON, STAGES.LOST]);
const CURRENCIES = new Set(["TRY", "USD"]);
const COMMUNICATION_STATUSES = new Set([
  "not_requested",
  "opted_in",
  "opted_out",
  "contact_requested",
]);
// Teklif Ajanı yayınlanan teklif için `calculator.portvmind.com/my-estimate/{id}`
// linki üretir (bkz. vmind-calculator/src/platform/api-client.ts). Bu host
// listede olmadığı için saveCalculation sessizce reddediliyordu.
const CALCULATOR_HOSTS = new Set([
  "calculator.portvmind.com",
  "teklif.43-229-94-48.sslip.io",
  "vmind.com.tr",
  "www.vmind.com.tr",
]);

export class CrmValidationError extends Error {}

function requiredText(value, label, maxLength) {
  const text = String(value ?? "").trim();
  if (!text) throw new CrmValidationError(`${label} zorunludur.`);
  if (text.length > maxLength) {
    throw new CrmValidationError(`${label} en fazla ${maxLength} karakter olabilir.`);
  }
  return text;
}

function optionalText(value, label, maxLength) {
  if (value == null || String(value).trim() === "") return null;
  return requiredText(value, label, maxLength);
}

function amountToMinor(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000_000) {
    throw new CrmValidationError("Teklif tutarı geçersiz.");
  }
  return Math.round(amount * 100);
}

function normalizeCurrency(value) {
  const currency = String(value ?? "TRY").trim().toUpperCase();
  if (!CURRENCIES.has(currency)) throw new CrmValidationError("Para birimi desteklenmiyor.");
  return currency;
}

export function normalizePhone(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  const jidLocal = raw.includes("@") ? raw.split("@", 1)[0].split(":", 1)[0] : raw;
  const candidates = [jidLocal, raw];
  for (const candidate of candidates) {
    const matches = candidate.match(/\+?\d[\d ()-]{8,20}\d/g) ?? [];
    for (const match of matches) {
      let digits = match.replace(/\D/g, "");
      // Site formunda kullanicilar cogunlukla 05xx veya 5xx yazar. Bunlari
      // E.164'e deterministik cevir; WhatsApp'in 90... JID bicimi aynen kalir.
      if (digits.length === 11 && digits.startsWith("0")) digits = `90${digits.slice(1)}`;
      if (digits.length === 10 && digits.startsWith("5")) digits = `90${digits}`;
      if (digits.length >= 10 && digits.length <= 15 && !digits.startsWith("0")) {
        return `+${digits}`;
      }
    }
  }
  return null;
}

/**
 * Kaynak modeli serbest metinden gelmez. Website degeri yalnizca imzali HTTP
 * rotasinin olusturdugu dahili context ile verilebilir; normal tool context'i
 * her zaman WhatsApp olarak kalir.
 */
export function resolveTrustedSource(toolContext) {
  return toolContext?.vmindCrmSource === "Website" ? "Website" : "WhatsApp";
}

export function resolveTrustedPhone(toolContext) {
  const direct = normalizePhone(toolContext?.requesterSenderId);
  if (direct) return direct;
  const fromSession = normalizePhone(toolContext?.sessionKey);
  if (fromSession) return fromSession;
  throw new CrmValidationError("Güvenilir müşteri telefon numarası alınamadı.");
}

function maskPhone(phone) {
  return `+***${phone.slice(-4)}`;
}

function sessionHash(sessionKey) {
  return createHash("sha256").update(String(sessionKey ?? "unknown")).digest("hex").slice(0, 32);
}

/**
 * Calculator bağlantısını doğrular. SQLite ve PostgreSQL store'ları AYNI
 * politikayı kullanmak zorunda — liste iki dosyada ayrı tutulduğunda yeni bir
 * host yalnızca birine eklenip diğerinde sessiz redde yol açıyor.
 *
 * `ErrorClass` parametresi çağıran store'un kendi hata tipini koruması için;
 * doğrulama politikası tek yerde, hata kimliği çağırana ait kalıyor.
 */
export function validateCalculatorUrl(value, ErrorClass = CrmValidationError) {
  const raw = String(value ?? "").trim();
  if (!raw) throw new ErrorClass("Calculator bağlantısı zorunludur.");
  if (raw.length > 2048) {
    throw new ErrorClass("Calculator bağlantısı en fazla 2048 karakter olabilir.");
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ErrorClass("Calculator bağlantısı geçersiz.");
  }
  // hostname WHATWG URL tarafından küçük harfe ve punycode'a çevrilmiş gelir.
  // Tam eşleşme, `calculator.portvmind.com.evil.com` gibi son ek saldırılarını
  // kendiliğinden eler; suffix kuralı yalnızca baştaki noktayla kullanılır.
  const hostAllowed = CALCULATOR_HOSTS.has(parsed.hostname) ||
    parsed.hostname.endsWith(".vmind.com.tr");
  if (parsed.protocol !== "https:" || !hostAllowed || parsed.username || parsed.password) {
    throw new ErrorClass("Calculator bağlantısı izin verilen VMind adreslerinden değil.");
  }
  return parsed.toString();
}

function istanbulDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

export function istanbulDate(date) {
  const { year, month, day } = istanbulDateParts(date);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addBusinessDays(date, count) {
  const { year, month, day } = istanbulDateParts(date);
  const cursor = new Date(Date.UTC(year, month - 1, day, 12));
  let remaining = count;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`;
}

function publicOpportunity(row) {
  return {
    opportunity_id: row.opportunity_id,
    customer_need: row.customer_need,
    recommended_service: row.recommended_service,
    stage: row.stage,
    estimated_value: row.estimated_amount_minor == null ? null : row.estimated_amount_minor / 100,
    currency: row.currency,
    owner: row.owner,
    next_follow_up: row.next_follow_up,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function publicCalculation(row) {
  return {
    calculation_id: row.calculation_id,
    calculator_id: row.external_calculation_id,
    opportunity_id: row.opportunity_id,
    calculator_url: row.calculator_url,
    configuration_summary: row.configuration_summary,
    amount: row.amount_minor / 100,
    currency: row.currency,
    version: row.version,
    created_at: row.created_at,
  };
}

function compactFields(fields) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== null && value !== undefined && value !== ""),
  );
}

export class CRMStore {
  constructor(dbPath, options = {}) {
    this.now = options.now ?? (() => new Date());
    mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
    chmodSync(dirname(dbPath), 0o700);
    this.db = new DatabaseSync(dbPath);
    chmodSync(dbPath, 0o600);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 3000;");
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS contacts (
        contact_id TEXT PRIMARY KEY,
        phone_e164 TEXT NOT NULL UNIQUE,
        name TEXT,
        company TEXT,
        communication_status TEXT NOT NULL DEFAULT 'not_requested',
        consent_updated_at TEXT,
        consent_notice_version TEXT,
        consent_source TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS opportunities (
        opportunity_id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL REFERENCES contacts(contact_id),
        session_hash TEXT NOT NULL,
        customer_need TEXT NOT NULL,
        recommended_service TEXT,
        stage TEXT NOT NULL,
        estimated_amount_minor INTEGER,
        currency TEXT,
        owner TEXT NOT NULL DEFAULT 'unassigned',
        next_follow_up TEXT,
        source TEXT NOT NULL DEFAULT 'WhatsApp',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS opportunities_contact_idx
        ON opportunities(contact_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS opportunities_session_idx
        ON opportunities(contact_id, session_hash, updated_at DESC);
      CREATE TABLE IF NOT EXISTS calculations (
        calculation_id TEXT PRIMARY KEY,
        external_calculation_id TEXT NOT NULL UNIQUE,
        opportunity_id TEXT NOT NULL REFERENCES opportunities(opportunity_id),
        calculator_url TEXT NOT NULL,
        configuration_summary TEXT NOT NULL,
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(opportunity_id, version)
      );
      CREATE INDEX IF NOT EXISTS calculations_opportunity_idx
        ON calculations(opportunity_id, version DESC);
      CREATE TABLE IF NOT EXISTS stage_events (
        event_id TEXT PRIMARY KEY,
        opportunity_id TEXT NOT NULL REFERENCES opportunities(opportunity_id),
        from_stage TEXT,
        to_stage TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sales_tasks (
        task_id TEXT PRIMARY KEY,
        opportunity_id TEXT NOT NULL REFERENCES opportunities(opportunity_id),
        task_type TEXT NOT NULL,
        status TEXT NOT NULL,
        owner TEXT NOT NULL DEFAULT 'unassigned',
        due_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS sales_tasks_open_contact_idx
        ON sales_tasks(opportunity_id, task_type) WHERE status = 'open';
      CREATE TABLE IF NOT EXISTS sync_outbox (
        outbox_id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        id_field TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sync_outbox_pending_idx
        ON sync_outbox(status, next_attempt_at, created_at);
    `);
    const contactColumns = new Set(
      this.db.prepare("PRAGMA table_info(contacts)").all().map((column) => column.name),
    );
    if (!contactColumns.has("consent_notice_version")) {
      this.db.exec("ALTER TABLE contacts ADD COLUMN consent_notice_version TEXT");
    }
    if (!contactColumns.has("consent_source")) {
      this.db.exec("ALTER TABLE contacts ADD COLUMN consent_source TEXT");
    }
  }

  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  timestamp() {
    return this.now().toISOString();
  }

  ensureContact(phone, params, now) {
    const name = optionalText(params.name, "Ad", 160);
    const company = optionalText(params.company, "Şirket", 240);
    const optedIn = params.communication_status === "opted_in";
    const consentNoticeVersion = optedIn
      ? optionalText(params.consent_notice_version, "Gizlilik bildirimi sürümü", 64)
      : null;
    const consentSource = optedIn ? optionalText(params.consent_source, "Onay kaynağı", 80) : null;
    const existing = this.db.prepare("SELECT * FROM contacts WHERE phone_e164 = ?").get(phone);
    if (existing) {
      this.db.prepare(`
        UPDATE contacts
        SET name = COALESCE(?, name),
            company = COALESCE(?, company),
            communication_status = CASE WHEN ? THEN 'opted_in' ELSE communication_status END,
            consent_updated_at = CASE WHEN ? THEN ? ELSE consent_updated_at END,
            consent_notice_version = COALESCE(?, consent_notice_version),
            consent_source = COALESCE(?, consent_source),
            updated_at = ?
        WHERE contact_id = ?
      `).run(
        name,
        company,
        optedIn ? 1 : 0,
        optedIn ? 1 : 0,
        now,
        consentNoticeVersion,
        consentSource,
        now,
        existing.contact_id,
      );
      return this.db.prepare("SELECT * FROM contacts WHERE contact_id = ?").get(existing.contact_id);
    }
    const contactId = randomUUID();
    this.db.prepare(`
      INSERT INTO contacts (
        contact_id, phone_e164, name, company, communication_status,
        consent_updated_at, consent_notice_version, consent_source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      contactId,
      phone,
      name,
      company,
      optedIn ? "opted_in" : "not_requested",
      optedIn ? now : null,
      consentNoticeVersion,
      consentSource,
      now,
      now,
    );
    return this.db.prepare("SELECT * FROM contacts WHERE contact_id = ?").get(contactId);
  }

  enqueue(entityType, entityId, idField, payload, now) {
    this.db.prepare(`
      INSERT INTO sync_outbox (
        outbox_id, entity_type, entity_id, id_field, payload_json,
        status, attempts, next_attempt_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
    `).run(randomUUID(), entityType, entityId, idField, JSON.stringify(payload), now, now, now);
  }

  enqueueContact(contact, now) {
    this.enqueue("CONTACT", contact.contact_id, "Contact ID", compactFields({
      "Contact ID": contact.contact_id,
      Phone: contact.phone_e164,
      Name: contact.name ?? "",
      Company: contact.company ?? "",
      "Communication Status": contact.communication_status,
      "Consent Updated At": contact.consent_updated_at ?? "",
      "Consent Notice Version": contact.consent_notice_version ?? "",
      "Consent Source": contact.consent_source ?? "",
      "Created At": contact.created_at,
      "Updated At": contact.updated_at,
    }), now);
  }

  enqueueOpportunity(opportunity, now) {
    this.enqueue("OPPORTUNITY", opportunity.opportunity_id, "Opportunity ID", compactFields({
      "Opportunity ID": opportunity.opportunity_id,
      "Contact ID": opportunity.contact_id,
      "Customer Need": opportunity.customer_need,
      "Recommended Service": opportunity.recommended_service ?? "",
      Stage: opportunity.stage,
      "Estimated Value": opportunity.estimated_amount_minor == null
        ? null
        : opportunity.estimated_amount_minor / 100,
      Currency: opportunity.currency ?? "",
      Owner: opportunity.owner,
      "Next Follow-up": opportunity.next_follow_up ?? "",
      Source: opportunity.source,
      "Created At": opportunity.created_at,
      "Updated At": opportunity.updated_at,
    }), now);
  }

  enqueueCalculation(calculation, now) {
    this.enqueue("CALCULATION", calculation.calculation_id, "Calculation ID", compactFields({
      "Calculation ID": calculation.calculation_id,
      "Calculator ID": calculation.external_calculation_id,
      "Opportunity ID": calculation.opportunity_id,
      "Calculator URL": calculation.calculator_url,
      "Configuration Summary": calculation.configuration_summary,
      Amount: calculation.amount_minor / 100,
      Currency: calculation.currency,
      Version: calculation.version,
      "Created At": calculation.created_at,
    }), now);
  }

  enqueueTask(task, now) {
    this.enqueue("TASK", task.task_id, "Task ID", compactFields({
      "Task ID": task.task_id,
      "Opportunity ID": task.opportunity_id,
      Type: task.task_type,
      Status: task.status,
      Owner: task.owner,
      "Due At": task.due_at,
      "Created At": task.created_at,
      "Updated At": task.updated_at,
    }), now);
  }

  transition(opportunity, toStage, reason, now) {
    if (opportunity.stage === toStage) return opportunity;
    if (TERMINAL_STAGES.has(opportunity.stage)) {
      throw new CrmValidationError("Kapanmış fırsatın satış aşaması değiştirilemez.");
    }
    this.db.prepare("UPDATE opportunities SET stage = ?, updated_at = ? WHERE opportunity_id = ?")
      .run(toStage, now, opportunity.opportunity_id);
    this.db.prepare(`
      INSERT INTO stage_events (event_id, opportunity_id, from_stage, to_stage, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), opportunity.opportunity_id, opportunity.stage, toStage, reason, now);
    return this.db.prepare("SELECT * FROM opportunities WHERE opportunity_id = ?")
      .get(opportunity.opportunity_id);
  }

  saveNeed(toolContext, params) {
    const phone = resolveTrustedPhone(toolContext);
    const source = resolveTrustedSource(toolContext);
    const customerNeed = requiredText(params.customer_need, "Müşteri ihtiyacı", 2000);
    const recommendedService = optionalText(params.recommended_service, "Önerilen hizmet", 500);
    const qualified = params.qualified === true;
    const currentSessionHash = sessionHash(toolContext.sessionKey);
    const now = this.timestamp();
    const cutoff = new Date(this.now().getTime() - 30 * 86400000).toISOString();

    return this.transaction(() => {
      const contact = this.ensureContact(phone, params, now);
      let opportunity;
      if (params.opportunity_id) {
        opportunity = this.db.prepare(`
          SELECT * FROM opportunities WHERE opportunity_id = ? AND contact_id = ?
        `).get(String(params.opportunity_id), contact.contact_id);
        if (!opportunity) throw new CrmValidationError("Fırsat bu müşteri kaydına ait değil.");
      } else if (params.new_opportunity !== true) {
        opportunity = this.db.prepare(`
          SELECT * FROM opportunities
          WHERE contact_id = ? AND session_hash = ? AND stage NOT IN (?, ?) AND updated_at >= ?
          ORDER BY updated_at DESC LIMIT 1
        `).get(contact.contact_id, currentSessionHash, STAGES.WON, STAGES.LOST, cutoff);
      }

      if (!opportunity) {
        const opportunityId = randomUUID();
        this.db.prepare(`
          INSERT INTO opportunities (
            opportunity_id, contact_id, session_hash, customer_need, recommended_service,
            stage, owner, source, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'unassigned', ?, ?, ?)
        `).run(
          opportunityId,
          contact.contact_id,
          currentSessionHash,
          customerNeed,
          recommendedService,
          STAGES.NEW,
          source,
          now,
          now,
        );
        opportunity = this.db.prepare("SELECT * FROM opportunities WHERE opportunity_id = ?")
          .get(opportunityId);
        this.db.prepare(`
          INSERT INTO stage_events (event_id, opportunity_id, from_stage, to_stage, reason, created_at)
          VALUES (?, ?, NULL, ?, 'opportunity_created', ?)
        `).run(randomUUID(), opportunityId, STAGES.NEW, now);
      }

      this.db.prepare(`
        UPDATE opportunities
        SET customer_need = ?, recommended_service = COALESCE(?, recommended_service), updated_at = ?
        WHERE opportunity_id = ?
      `).run(customerNeed, recommendedService, now, opportunity.opportunity_id);
      opportunity = this.db.prepare("SELECT * FROM opportunities WHERE opportunity_id = ?")
        .get(opportunity.opportunity_id);
      if (opportunity.stage === STAGES.NEW) {
        opportunity = this.transition(opportunity, STAGES.NEED_IDENTIFIED, "need_captured", now);
      }
      if (qualified && opportunity.stage === STAGES.NEED_IDENTIFIED) {
        opportunity = this.transition(opportunity, STAGES.QUALIFIED, "requirements_qualified", now);
      }

      const updatedContact = this.db.prepare("SELECT * FROM contacts WHERE contact_id = ?")
        .get(contact.contact_id);
      this.enqueueContact(updatedContact, now);
      this.enqueueOpportunity(opportunity, now);
      return {
        ok: true,
        contact_id: contact.contact_id,
        phone: maskPhone(phone),
        opportunity: publicOpportunity(opportunity),
      };
    });
  }

  getContext(toolContext) {
    const phone = resolveTrustedPhone(toolContext);
    const contact = this.db.prepare("SELECT * FROM contacts WHERE phone_e164 = ?").get(phone);
    if (!contact) return { ok: true, found: false, phone: maskPhone(phone), opportunities: [] };
    const opportunities = this.db.prepare(`
      SELECT * FROM opportunities
      WHERE contact_id = ?
      ORDER BY updated_at DESC LIMIT 5
    `).all(contact.contact_id);
    const result = opportunities.map((opportunity) => {
      const calculation = this.db.prepare(`
        SELECT * FROM calculations WHERE opportunity_id = ? ORDER BY version DESC LIMIT 1
      `).get(opportunity.opportunity_id);
      return {
        ...publicOpportunity(opportunity),
        latest_calculation: calculation ? publicCalculation(calculation) : null,
      };
    });
    return {
      ok: true,
      found: true,
      contact: {
        contact_id: contact.contact_id,
        phone: maskPhone(phone),
        name: contact.name,
        company: contact.company,
        communication_status: contact.communication_status,
      },
      opportunities: result,
    };
  }

  saveCalculation(toolContext, params) {
    const phone = resolveTrustedPhone(toolContext);
    const opportunityId = requiredText(params.opportunity_id, "Fırsat kimliği", 80);
    const externalCalculationId = requiredText(params.calculator_id, "Calculator kimliği", 160);
    const calculatorUrl = validateCalculatorUrl(params.calculator_url);
    const configurationSummary = requiredText(
      params.configuration_summary,
      "Konfigürasyon özeti",
      4000,
    );
    const amountMinor = amountToMinor(params.estimated_amount);
    const currency = normalizeCurrency(params.currency);
    const now = this.timestamp();
    const nextFollowUp = addBusinessDays(this.now(), 2);

    return this.transaction(() => {
      const contact = this.db.prepare("SELECT * FROM contacts WHERE phone_e164 = ?").get(phone);
      if (!contact) throw new CrmValidationError("Önce müşteri ihtiyacı kaydedilmelidir.");
      let opportunity = this.db.prepare(`
        SELECT * FROM opportunities WHERE opportunity_id = ? AND contact_id = ?
      `).get(opportunityId, contact.contact_id);
        if (!opportunity) throw new CrmValidationError("Fırsat bu müşteri kaydına ait değil.");

      const duplicate = this.db.prepare(`
        SELECT * FROM calculations WHERE external_calculation_id = ?
      `).get(externalCalculationId);
      if (duplicate) {
        if (duplicate.opportunity_id !== opportunityId) {
          throw new CrmValidationError("Calculator kimliği başka bir fırsatta kullanılmış.");
        }
        return {
          ok: true,
          created: false,
          phone: maskPhone(phone),
          opportunity: publicOpportunity(opportunity),
          calculation: publicCalculation(duplicate),
        };
      }

      const latest = this.db.prepare(`
        SELECT COALESCE(MAX(version), 0) AS version FROM calculations WHERE opportunity_id = ?
      `).get(opportunityId);
      const calculationId = randomUUID();
      const version = Number(latest.version) + 1;
      this.db.prepare(`
        INSERT INTO calculations (
          calculation_id, external_calculation_id, opportunity_id, calculator_url,
          configuration_summary, amount_minor, currency, version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        calculationId,
        externalCalculationId,
        opportunityId,
        calculatorUrl,
        configurationSummary,
        amountMinor,
        currency,
        version,
        now,
      );
      this.db.prepare(`
        UPDATE opportunities
        SET estimated_amount_minor = ?, currency = ?, next_follow_up = ?, updated_at = ?
        WHERE opportunity_id = ?
      `).run(amountMinor, currency, nextFollowUp, now, opportunityId);
      opportunity = this.db.prepare("SELECT * FROM opportunities WHERE opportunity_id = ?")
        .get(opportunityId);
      if (opportunity.stage === STAGES.NEW) {
        opportunity = this.transition(opportunity, STAGES.NEED_IDENTIFIED, "need_inferred_from_calculation", now);
      }
      if (opportunity.stage === STAGES.NEED_IDENTIFIED) {
        opportunity = this.transition(opportunity, STAGES.QUALIFIED, "calculation_inputs_complete", now);
      }
      if ([
        STAGES.QUALIFIED,
        STAGES.PROPOSAL_SENT,
        STAGES.FOLLOW_UP,
      ].includes(opportunity.stage)) {
        opportunity = this.transition(opportunity, STAGES.CALCULATION_CREATED, "calculation_recorded", now);
      }
      const calculation = this.db.prepare("SELECT * FROM calculations WHERE calculation_id = ?")
        .get(calculationId);
      this.enqueueOpportunity(opportunity, now);
      this.enqueueCalculation(calculation, now);
      return {
        ok: true,
        created: true,
        phone: maskPhone(phone),
        opportunity: publicOpportunity(opportunity),
        calculation: publicCalculation(calculation),
      };
    });
  }

  markProposalSent(to, content) {
    const phone = normalizePhone(to);
    if (!phone || !content) return null;
    const candidates = this.db.prepare(`
      SELECT c.*, o.stage, o.contact_id, ct.phone_e164
      FROM calculations c
      JOIN opportunities o ON o.opportunity_id = c.opportunity_id
      JOIN contacts ct ON ct.contact_id = o.contact_id
      WHERE ct.phone_e164 = ?
      ORDER BY c.created_at DESC LIMIT 20
    `).all(phone);
    const calculation = candidates.find((candidate) => String(content).includes(candidate.calculator_url));
    if (!calculation) return null;
    const now = this.timestamp();
    return this.transaction(() => {
      let opportunity = this.db.prepare("SELECT * FROM opportunities WHERE opportunity_id = ?")
        .get(calculation.opportunity_id);
      if (opportunity.stage === STAGES.CALCULATION_CREATED) {
        opportunity = this.transition(opportunity, STAGES.PROPOSAL_SENT, "calculator_link_delivered", now);
        this.enqueueOpportunity(opportunity, now);
      }
      return publicOpportunity(opportunity);
    });
  }

  requestSalesContact(toolContext, params) {
    if (params.explicit_confirmation !== true) {
      throw new CrmValidationError("Satış iletişim talebi için açık kullanıcı onayı gerekir.");
    }
    const phone = resolveTrustedPhone(toolContext);
    const opportunityId = requiredText(params.opportunity_id, "Fırsat kimliği", 80);
    const now = this.timestamp();
    return this.transaction(() => {
      let opportunity = this.db.prepare(`
        SELECT o.* FROM opportunities o
        JOIN contacts c ON c.contact_id = o.contact_id
        WHERE o.opportunity_id = ? AND c.phone_e164 = ?
      `).get(opportunityId, phone);
      if (!opportunity) throw new CrmValidationError("Fırsat bu müşteri kaydına ait değil.");
      const calculation = this.db.prepare(`
        SELECT calculation_id FROM calculations WHERE opportunity_id = ? LIMIT 1
      `).get(opportunityId);
      if (!calculation) throw new CrmValidationError("Satış iletişim talebinden önce hesaplama bulunmalıdır.");

      opportunity = this.transition(
        opportunity,
        STAGES.SALES_CONTACT_REQUESTED,
        "customer_requested_sales_contact",
        now,
      );
      this.db.prepare(`
        UPDATE contacts
        SET communication_status = 'contact_requested', consent_updated_at = ?, updated_at = ?
        WHERE contact_id = ?
      `).run(now, now, opportunity.contact_id);
      let task = this.db.prepare(`
        SELECT * FROM sales_tasks
        WHERE opportunity_id = ? AND task_type = 'sales_contact' AND status = 'open'
      `).get(opportunityId);
      if (!task) {
        const taskId = randomUUID();
        this.db.prepare(`
          INSERT INTO sales_tasks (
            task_id, opportunity_id, task_type, status, owner, due_at, created_at, updated_at
          ) VALUES (?, ?, 'sales_contact', 'open', 'unassigned', ?, ?, ?)
        `).run(taskId, opportunityId, now, now, now);
        task = this.db.prepare("SELECT * FROM sales_tasks WHERE task_id = ?").get(taskId);
      }
      const contact = this.db.prepare("SELECT * FROM contacts WHERE contact_id = ?")
        .get(opportunity.contact_id);
      this.enqueueContact(contact, now);
      this.enqueueOpportunity(opportunity, now);
      this.enqueueTask(task, now);
      return {
        ok: true,
        phone: maskPhone(phone),
        stage: opportunity.stage,
        task_id: task.task_id,
        task_status: task.status,
      };
    });
  }

  setCommunicationStatus(toolContext, params) {
    if (params.explicit_confirmation !== true) {
      throw new CrmValidationError("İletişim tercihi yalnızca açık kullanıcı beyanıyla değiştirilebilir.");
    }
    const status = String(params.status ?? "");
    if (!new Set(["opted_in", "opted_out"]).has(status)) {
      throw new CrmValidationError("İletişim tercihi geçersiz.");
    }
    const phone = resolveTrustedPhone(toolContext);
    const now = this.timestamp();
    return this.transaction(() => {
      const contact = this.db.prepare("SELECT * FROM contacts WHERE phone_e164 = ?").get(phone);
      if (!contact) throw new CrmValidationError("Bu müşteri için CRM kaydı bulunamadı.");
      this.db.prepare(`
        UPDATE contacts
        SET communication_status = ?, consent_updated_at = ?, updated_at = ?
        WHERE contact_id = ?
      `).run(status, now, now, contact.contact_id);
      const updated = this.db.prepare("SELECT * FROM contacts WHERE contact_id = ?")
        .get(contact.contact_id);
      if (!COMMUNICATION_STATUSES.has(updated.communication_status)) {
        throw new CrmValidationError("İletişim durumu geçersiz.");
      }
      this.enqueueContact(updated, now);
      return { ok: true, phone: maskPhone(phone), communication_status: status };
    });
  }

  advanceDueFollowUps() {
    const today = istanbulDate(this.now());
    const due = this.db.prepare(`
      SELECT * FROM opportunities
      WHERE stage = ? AND next_follow_up IS NOT NULL AND next_follow_up <= ?
    `).all(STAGES.PROPOSAL_SENT, today);
    if (due.length === 0) return 0;
    const now = this.timestamp();
    return this.transaction(() => {
      for (const row of due) {
        const updated = this.transition(row, STAGES.FOLLOW_UP, "follow_up_date_reached", now);
        this.enqueueOpportunity(updated, now);
      }
      return due.length;
    });
  }

  pendingOutbox(limit = 50) {
    return this.db.prepare(`
      SELECT * FROM sync_outbox
      WHERE status = 'pending' AND next_attempt_at <= ?
      ORDER BY created_at ASC LIMIT ?
    `).all(this.timestamp(), limit);
  }

  markEntitiesSynced(entityType, entityIds) {
    if (entityIds.length === 0) return;
    const placeholders = entityIds.map(() => "?").join(",");
    const now = this.timestamp();
    this.db.prepare(`
      UPDATE sync_outbox SET status = 'synced', last_error = NULL, updated_at = ?
      WHERE status = 'pending' AND entity_type = ? AND entity_id IN (${placeholders})
    `).run(now, entityType, ...entityIds);
  }

  markEntitiesFailed(entityType, entityIds, error, retrySeconds = 30) {
    if (entityIds.length === 0) return;
    const placeholders = entityIds.map(() => "?").join(",");
    const nowDate = this.now();
    const now = nowDate.toISOString();
    const retryAt = new Date(nowDate.getTime() + retrySeconds * 1000).toISOString();
    this.db.prepare(`
      UPDATE sync_outbox
      SET attempts = attempts + 1, next_attempt_at = ?, last_error = ?, updated_at = ?
      WHERE status = 'pending' AND entity_type = ? AND entity_id IN (${placeholders})
    `).run(retryAt, String(error).slice(0, 240), now, entityType, ...entityIds);
  }

  stats() {
    const count = (table) => Number(this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
    return {
      contacts: count("contacts"),
      opportunities: count("opportunities"),
      calculations: count("calculations"),
      tasks: count("sales_tasks"),
      pending_sync: Number(this.db.prepare(`
        SELECT COUNT(*) AS n FROM sync_outbox WHERE status = 'pending'
      `).get().n),
    };
  }

  close() {
    this.db.close();
  }
}
