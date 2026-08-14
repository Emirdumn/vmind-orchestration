import { createHash, randomUUID } from "node:crypto";

// FAZ 0 — `applyPostgresMigrations` BU DOSYADA BİLEREK YOK.
// Sözleşme: RUNTIME/GATEWAY ŞEMA YAZAMAZ. Migration yalnızca açık
// deploy/admin komutlarıyla yapılır — `npm run db:migrate`
// (deploy/migrate-postgres.mjs) ve bilinçli yönetim aracı
// `npm run db:import-sqlite`.
import { createPostgresPool, DEFAULT_TENANT_ID } from "./postgres-db.js";
import { CRM_SCHEMA_REQUIREMENTS, verifyAppliedSchema } from "./schema-requirements.js";
import {
  CRMStore,
  CrmValidationError,
  STAGES,
  addBusinessDays,
  istanbulDate,
  normalizePhone,
  resolveTrustedSource,
  resolveTrustedPhone,
  validateCalculatorUrl,
} from "./crm-store.js";

const TERMINAL_STAGES = new Set([STAGES.WON, STAGES.LOST]);
const CURRENCIES = new Set(["TRY", "USD"]);
const COMMUNICATION_STATUSES = new Set([
  "not_requested",
  "opted_in",
  "opted_out",
  "contact_requested",
]);
export class PostgresCrmValidationError extends CrmValidationError {}

export function createCrmStoreFromEnv(env = process.env, options = {}) {
  const backend = String(env.VMIND_CRM_BACKEND ?? "sqlite").trim().toLowerCase();
  if (backend === "postgres" || backend === "postgresql") {
    return new PostgresCRMStore({ ...options, env });
  }
  if (backend !== "sqlite") {
    throw new Error(`VMIND_CRM_BACKEND desteklenmiyor: ${backend}`);
  }
  const dbPath = env.VMIND_CRM_DB ?? "/home/openclaw/.openclaw/data/vmind-crm.sqlite";
  return new CRMStore(dbPath, options);
}

function requiredText(value, label, maxLength) {
  const text = String(value ?? "").trim();
  if (!text) throw new PostgresCrmValidationError(`${label} zorunludur.`);
  if (text.length > maxLength) {
    throw new PostgresCrmValidationError(`${label} en fazla ${maxLength} karakter olabilir.`);
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
    throw new PostgresCrmValidationError("Teklif tutarı geçersiz.");
  }
  return Math.round(amount * 100);
}

function normalizeCurrency(value) {
  const currency = String(value ?? "TRY").trim().toUpperCase();
  if (!CURRENCIES.has(currency)) {
    throw new PostgresCrmValidationError("Para birimi desteklenmiyor.");
  }
  return currency;
}

function maskPhone(phone) {
  return `+***${phone.slice(-4)}`;
}

function sessionHash(sessionKey) {
  return createHash("sha256").update(String(sessionKey ?? "unknown")).digest("hex").slice(0, 32);
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function dateOnly(value) {
  return value instanceof Date ? istanbulDate(value) : value;
}

function publicOpportunity(row) {
  return {
    opportunity_id: row.opportunity_id,
    customer_need: row.customer_need,
    recommended_service: row.recommended_service,
    stage: row.stage,
    estimated_value: row.estimated_amount_minor == null ? null : Number(row.estimated_amount_minor) / 100,
    currency: row.currency,
    owner: row.owner,
    next_follow_up: dateOnly(row.next_follow_up),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

function publicCalculation(row) {
  return {
    calculation_id: row.calculation_id,
    calculator_id: row.external_calculation_id,
    opportunity_id: row.opportunity_id,
    calculator_url: row.calculator_url,
    configuration_summary: row.configuration_summary,
    amount: Number(row.amount_minor) / 100,
    currency: row.currency,
    version: Number(row.version),
    created_at: iso(row.created_at),
  };
}

function compactFields(fields) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== null && value !== undefined && value !== ""),
  );
}

async function one(client, text, values = []) {
  const result = await client.query(text, values);
  return result.rows[0] ?? null;
}

export class PostgresCRMStore {
  constructor(options = {}) {
    // FAZ 0 — bu red HAVUZDAN ÖNCE gelir. `options.pool` verilmeden yapılan
    // hatalı çağrıda önce havuz kurulup sonra fırlatılırsa o havuz sızar
    // (kimse `close()` çağıramaz, çünkü nesne hiç oluşmadı).
    if (options.migrate === true) {
      throw new Error(
        "PostgresCRMStore şema uygulayamaz: `migrate: true` desteklenmiyor. " +
          "Migration yalnızca açık deploy/admin komutlarıyla yapılır: " +
          "`npm run db:migrate` veya `npm run db:import-sqlite`.",
      );
    }

    this.now = options.now ?? (() => new Date());
    this.tenantId = options.tenantId ?? process.env.VMIND_TENANT_ID ?? DEFAULT_TENANT_ID;
    this.pool = options.pool ?? createPostgresPool({ env: options.env });
    this.ownsPool = !options.pool;
    // Şema doğrulaması VARSAYILAN ve tek davranış. Seçenek unutulsa bile store
    // migration uygulayamaz; `applyPostgresMigrations` bu dosyaya hiç import
    // edilmiyor. `migrate: false` geriye uyum için kabul edilir.
    this.readyPromise = verifyAppliedSchema(
      this.pool,
      options.schemaRequirements ?? CRM_SCHEMA_REQUIREMENTS,
    );
    // Kimse beklemeden reddedilirse Node unhandledRejection ile süreci
    // düşürebilir. Bu no-op handler onu engeller; readyPromise'i BEKLEYENLER
    // reddi aynen almaya devam eder.
    this.readyPromise.catch(() => {});
  }

  async ready() {
    const outcome = await this.readyPromise;
    // Salt okunur şema doğrulama raporu başlangıç log'unda ve sağlık
    // kontrollerinde kullanılmak üzere store üzerinde tutulur.
    if (outcome && Array.isArray(outcome.verified)) this.schema = outcome;
    await this.pool.query("SELECT tenant_id FROM identity.tenants WHERE tenant_id = $1", [this.tenantId]);
    return this;
  }

  timestamp() {
    return this.now().toISOString();
  }

  async transaction(fn) {
    await this.readyPromise;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async ensureContact(client, phone, params, now) {
    const name = optionalText(params.name, "Ad", 160);
    const company = optionalText(params.company, "Şirket", 240);
    const optedIn = params.communication_status === "opted_in";
    const consentNoticeVersion = optedIn
      ? optionalText(params.consent_notice_version, "Gizlilik bildirimi sürümü", 64)
      : null;
    const consentSource = optedIn
      ? optionalText(params.consent_source, "Onay kaynağı", 80)
      : null;
    return one(client, `
      INSERT INTO crm.contacts (
        contact_id, tenant_id, phone_e164, name, company,
        communication_status, consent_updated_at, consent_notice_version,
        consent_source, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
      ON CONFLICT (tenant_id, phone_e164) DO UPDATE
      SET name = COALESCE(EXCLUDED.name, crm.contacts.name),
          company = COALESCE(EXCLUDED.company, crm.contacts.company),
          communication_status = CASE
            WHEN EXCLUDED.communication_status = 'opted_in' THEN 'opted_in'
            ELSE crm.contacts.communication_status
          END,
          consent_updated_at = COALESCE(EXCLUDED.consent_updated_at, crm.contacts.consent_updated_at),
          consent_notice_version = COALESCE(
            EXCLUDED.consent_notice_version,
            crm.contacts.consent_notice_version
          ),
          consent_source = COALESCE(EXCLUDED.consent_source, crm.contacts.consent_source),
          updated_at = EXCLUDED.updated_at
      RETURNING *
    `, [
      randomUUID(),
      this.tenantId,
      phone,
      name,
      company,
      optedIn ? "opted_in" : "not_requested",
      optedIn ? now : null,
      consentNoticeVersion,
      consentSource,
      now,
    ]);
  }

  async enqueue(client, entityType, entityId, idField, payload, now) {
    await client.query(`
      INSERT INTO crm.sync_outbox (
        outbox_id, tenant_id, entity_type, entity_id, id_field, payload_json,
        status, attempts, next_attempt_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'pending', 0, $7, $7, $7)
    `, [
      randomUUID(),
      this.tenantId,
      entityType,
      entityId,
      idField,
      JSON.stringify(payload),
      now,
    ]);
  }

  enqueueContact(client, contact, now) {
    return this.enqueue(client, "CONTACT", contact.contact_id, "Contact ID", compactFields({
      "Contact ID": contact.contact_id,
      Phone: contact.phone_e164,
      Name: contact.name ?? "",
      Company: contact.company ?? "",
      "Communication Status": contact.communication_status,
      "Consent Updated At": iso(contact.consent_updated_at) ?? "",
      "Consent Notice Version": contact.consent_notice_version ?? "",
      "Consent Source": contact.consent_source ?? "",
      "Created At": iso(contact.created_at),
      "Updated At": iso(contact.updated_at),
    }), now);
  }

  enqueueOpportunity(client, opportunity, now) {
    return this.enqueue(
      client,
      "OPPORTUNITY",
      opportunity.opportunity_id,
      "Opportunity ID",
      compactFields({
        "Opportunity ID": opportunity.opportunity_id,
        "Contact ID": opportunity.contact_id,
        "Customer Need": opportunity.customer_need,
        "Recommended Service": opportunity.recommended_service ?? "",
        Stage: opportunity.stage,
        "Estimated Value": opportunity.estimated_amount_minor == null
          ? null
          : Number(opportunity.estimated_amount_minor) / 100,
        Currency: opportunity.currency ?? "",
        Owner: opportunity.owner,
        "Next Follow-up": iso(opportunity.next_follow_up) ?? "",
        Source: opportunity.source,
        "Created At": iso(opportunity.created_at),
        "Updated At": iso(opportunity.updated_at),
      }),
      now,
    );
  }

  enqueueCalculation(client, calculation, now) {
    return this.enqueue(
      client,
      "CALCULATION",
      calculation.calculation_id,
      "Calculation ID",
      compactFields({
        "Calculation ID": calculation.calculation_id,
        "Calculator ID": calculation.external_calculation_id,
        "Opportunity ID": calculation.opportunity_id,
        "Calculator URL": calculation.calculator_url,
        "Configuration Summary": calculation.configuration_summary,
        Amount: Number(calculation.amount_minor) / 100,
        Currency: calculation.currency,
        Version: Number(calculation.version),
        "Created At": iso(calculation.created_at),
      }),
      now,
    );
  }

  enqueueTask(client, task, now) {
    return this.enqueue(client, "TASK", task.task_id, "Task ID", compactFields({
      "Task ID": task.task_id,
      "Opportunity ID": task.opportunity_id,
      Type: task.task_type,
      Status: task.status,
      Owner: task.owner,
      "Due At": iso(task.due_at),
      "Created At": iso(task.created_at),
      "Updated At": iso(task.updated_at),
    }), now);
  }

  async transition(client, opportunity, toStage, reason, now) {
    if (opportunity.stage === toStage) return opportunity;
    if (TERMINAL_STAGES.has(opportunity.stage)) {
      throw new PostgresCrmValidationError("Kapanmış fırsatın satış aşaması değiştirilemez.");
    }
    const updated = await one(client, `
      UPDATE crm.opportunities SET stage = $1, updated_at = $2
      WHERE tenant_id = $3 AND opportunity_id = $4
      RETURNING *
    `, [toStage, now, this.tenantId, opportunity.opportunity_id]);
    await client.query(`
      INSERT INTO crm.stage_events (
        event_id, tenant_id, opportunity_id, from_stage, to_stage, reason, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [randomUUID(), this.tenantId, opportunity.opportunity_id, opportunity.stage, toStage, reason, now]);
    return updated;
  }

  async saveNeed(toolContext, params) {
    const phone = resolveTrustedPhone(toolContext);
    const source = resolveTrustedSource(toolContext);
    const customerNeed = requiredText(params.customer_need, "Müşteri ihtiyacı", 2000);
    const recommendedService = optionalText(params.recommended_service, "Önerilen hizmet", 500);
    const qualified = params.qualified === true;
    const currentSessionHash = sessionHash(toolContext.sessionKey);
    const now = this.timestamp();
    const cutoff = new Date(this.now().getTime() - 30 * 86400000).toISOString();

    return this.transaction(async (client) => {
      // Ayni site akisi iki kez/eszamanli teslim edilirse SELECT -> INSERT
      // yarisi iki ayri opportunity olusturmasin. Kilit yalniz bu musteri ve
      // akisa ozeldir; baska teklifleri bloke etmez.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        [`${this.tenantId}:${phone}:${currentSessionHash}`],
      );
      const contact = await this.ensureContact(client, phone, params, now);
      let opportunity = null;
      if (params.opportunity_id) {
        opportunity = await one(client, `
          SELECT * FROM crm.opportunities
          WHERE tenant_id = $1 AND opportunity_id = $2 AND contact_id = $3
          FOR UPDATE
        `, [this.tenantId, String(params.opportunity_id), contact.contact_id]);
        if (!opportunity) {
          throw new PostgresCrmValidationError("Fırsat bu müşteri kaydına ait değil.");
        }
      } else if (params.new_opportunity !== true) {
        opportunity = await one(client, `
          SELECT * FROM crm.opportunities
          WHERE tenant_id = $1 AND contact_id = $2 AND session_hash = $3
            AND stage NOT IN ($4, $5) AND updated_at >= $6
          ORDER BY updated_at DESC LIMIT 1 FOR UPDATE
        `, [this.tenantId, contact.contact_id, currentSessionHash, STAGES.WON, STAGES.LOST, cutoff]);
      }

      if (!opportunity) {
        const opportunityId = randomUUID();
        opportunity = await one(client, `
          INSERT INTO crm.opportunities (
            opportunity_id, tenant_id, contact_id, session_hash, customer_need,
            recommended_service, stage, owner, source, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'unassigned', $8, $9, $9)
          RETURNING *
        `, [
          opportunityId,
          this.tenantId,
          contact.contact_id,
          currentSessionHash,
          customerNeed,
          recommendedService,
          STAGES.NEW,
          source,
          now,
        ]);
        await client.query(`
          INSERT INTO crm.stage_events (
            event_id, tenant_id, opportunity_id, from_stage, to_stage, reason, created_at
          ) VALUES ($1, $2, $3, NULL, $4, 'opportunity_created', $5)
        `, [randomUUID(), this.tenantId, opportunityId, STAGES.NEW, now]);
      }

      opportunity = await one(client, `
        UPDATE crm.opportunities
        SET customer_need = $1,
            recommended_service = COALESCE($2, recommended_service),
            updated_at = $3
        WHERE tenant_id = $4 AND opportunity_id = $5
        RETURNING *
      `, [customerNeed, recommendedService, now, this.tenantId, opportunity.opportunity_id]);
      if (opportunity.stage === STAGES.NEW) {
        opportunity = await this.transition(client, opportunity, STAGES.NEED_IDENTIFIED, "need_captured", now);
      }
      if (qualified && opportunity.stage === STAGES.NEED_IDENTIFIED) {
        opportunity = await this.transition(client, opportunity, STAGES.QUALIFIED, "requirements_qualified", now);
      }

      const updatedContact = await one(client, `
        SELECT * FROM crm.contacts WHERE tenant_id = $1 AND contact_id = $2
      `, [this.tenantId, contact.contact_id]);
      await this.enqueueContact(client, updatedContact, now);
      await this.enqueueOpportunity(client, opportunity, now);
      return {
        ok: true,
        contact_id: contact.contact_id,
        phone: maskPhone(phone),
        opportunity: publicOpportunity(opportunity),
      };
    });
  }

  async getContext(toolContext) {
    await this.readyPromise;
    const phone = resolveTrustedPhone(toolContext);
    const contact = await one(this.pool, `
      SELECT * FROM crm.contacts WHERE tenant_id = $1 AND phone_e164 = $2
    `, [this.tenantId, phone]);
    if (!contact) return { ok: true, found: false, phone: maskPhone(phone), opportunities: [] };
    const opportunities = (await this.pool.query(`
      SELECT o.*,
        c.calculation_id AS latest_calculation_id,
        c.external_calculation_id AS latest_external_calculation_id,
        c.calculator_url AS latest_calculator_url,
        c.configuration_summary AS latest_configuration_summary,
        c.amount_minor AS latest_amount_minor,
        c.currency AS latest_currency,
        c.version AS latest_version,
        c.created_at AS latest_calculation_created_at
      FROM crm.opportunities o
      LEFT JOIN LATERAL (
        SELECT * FROM crm.calculations c
        WHERE c.tenant_id = o.tenant_id AND c.opportunity_id = o.opportunity_id
        ORDER BY c.version DESC LIMIT 1
      ) c ON true
      WHERE o.tenant_id = $1 AND o.contact_id = $2
      ORDER BY o.updated_at DESC LIMIT 5
    `, [this.tenantId, contact.contact_id])).rows;
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
      opportunities: opportunities.map((opportunity) => ({
        ...publicOpportunity(opportunity),
        latest_calculation: opportunity.latest_calculation_id
          ? publicCalculation({
              calculation_id: opportunity.latest_calculation_id,
              external_calculation_id: opportunity.latest_external_calculation_id,
              opportunity_id: opportunity.opportunity_id,
              calculator_url: opportunity.latest_calculator_url,
              configuration_summary: opportunity.latest_configuration_summary,
              amount_minor: opportunity.latest_amount_minor,
              currency: opportunity.latest_currency,
              version: opportunity.latest_version,
              created_at: opportunity.latest_calculation_created_at,
            })
          : null,
      })),
    };
  }

  async saveCalculation(toolContext, params) {
    const phone = resolveTrustedPhone(toolContext);
    const opportunityId = requiredText(params.opportunity_id, "Fırsat kimliği", 80);
    const externalCalculationId = requiredText(params.calculator_id, "Calculator kimliği", 160);
    const calculatorUrl = validateCalculatorUrl(params.calculator_url, PostgresCrmValidationError);
    const configurationSummary = requiredText(
      params.configuration_summary,
      "Konfigürasyon özeti",
      4000,
    );
    const amountMinor = amountToMinor(params.estimated_amount);
    const currency = normalizeCurrency(params.currency);
    const now = this.timestamp();
    const nextFollowUp = addBusinessDays(this.now(), 2);

    return this.transaction(async (client) => {
      const contact = await one(client, `
        SELECT * FROM crm.contacts WHERE tenant_id = $1 AND phone_e164 = $2
      `, [this.tenantId, phone]);
      if (!contact) {
        throw new PostgresCrmValidationError("Önce müşteri ihtiyacı kaydedilmelidir.");
      }
      let opportunity = await one(client, `
        SELECT * FROM crm.opportunities
        WHERE tenant_id = $1 AND opportunity_id = $2 AND contact_id = $3
        FOR UPDATE
      `, [this.tenantId, opportunityId, contact.contact_id]);
      if (!opportunity) {
        throw new PostgresCrmValidationError("Fırsat bu müşteri kaydına ait değil.");
      }

      const duplicate = await one(client, `
        SELECT * FROM crm.calculations
        WHERE tenant_id = $1 AND external_calculation_id = $2
      `, [this.tenantId, externalCalculationId]);
      if (duplicate) {
        if (duplicate.opportunity_id !== opportunityId) {
          throw new PostgresCrmValidationError("Calculator kimliği başka bir fırsatta kullanılmış.");
        }
        return {
          ok: true,
          created: false,
          phone: maskPhone(phone),
          opportunity: publicOpportunity(opportunity),
          calculation: publicCalculation(duplicate),
        };
      }

      const latest = await one(client, `
        SELECT COALESCE(MAX(version), 0) AS version
        FROM crm.calculations WHERE tenant_id = $1 AND opportunity_id = $2
      `, [this.tenantId, opportunityId]);
      const calculationId = randomUUID();
      const version = Number(latest.version) + 1;
      const calculation = await one(client, `
        INSERT INTO crm.calculations (
          calculation_id, tenant_id, external_calculation_id, opportunity_id,
          calculator_url, configuration_summary, amount_minor, currency, version, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `, [
        calculationId,
        this.tenantId,
        externalCalculationId,
        opportunityId,
        calculatorUrl,
        configurationSummary,
        amountMinor,
        currency,
        version,
        now,
      ]);
      opportunity = await one(client, `
        UPDATE crm.opportunities
        SET estimated_amount_minor = $1, currency = $2, next_follow_up = $3, updated_at = $4
        WHERE tenant_id = $5 AND opportunity_id = $6
        RETURNING *
      `, [amountMinor, currency, nextFollowUp, now, this.tenantId, opportunityId]);
      if (opportunity.stage === STAGES.NEW) {
        opportunity = await this.transition(
          client,
          opportunity,
          STAGES.NEED_IDENTIFIED,
          "need_inferred_from_calculation",
          now,
        );
      }
      if (opportunity.stage === STAGES.NEED_IDENTIFIED) {
        opportunity = await this.transition(
          client,
          opportunity,
          STAGES.QUALIFIED,
          "calculation_inputs_complete",
          now,
        );
      }
      if ([STAGES.QUALIFIED, STAGES.PROPOSAL_SENT, STAGES.FOLLOW_UP].includes(opportunity.stage)) {
        opportunity = await this.transition(
          client,
          opportunity,
          STAGES.CALCULATION_CREATED,
          "calculation_recorded",
          now,
        );
      }
      await this.enqueueOpportunity(client, opportunity, now);
      await this.enqueueCalculation(client, calculation, now);
      return {
        ok: true,
        created: true,
        phone: maskPhone(phone),
        opportunity: publicOpportunity(opportunity),
        calculation: publicCalculation(calculation),
      };
    });
  }

  async markProposalSent(to, content) {
    const phone = normalizePhone(to);
    if (!phone || !content) return null;
    await this.readyPromise;
    const candidates = (await this.pool.query(`
      SELECT c.*
      FROM crm.calculations c
      JOIN crm.opportunities o
        ON o.tenant_id = c.tenant_id AND o.opportunity_id = c.opportunity_id
      JOIN crm.contacts ct
        ON ct.tenant_id = o.tenant_id AND ct.contact_id = o.contact_id
      WHERE c.tenant_id = $1 AND ct.phone_e164 = $2
      ORDER BY c.created_at DESC LIMIT 20
    `, [this.tenantId, phone])).rows;
    const calculation = candidates.find((candidate) => String(content).includes(candidate.calculator_url));
    if (!calculation) return null;
    const now = this.timestamp();
    return this.transaction(async (client) => {
      let opportunity = await one(client, `
        SELECT * FROM crm.opportunities
        WHERE tenant_id = $1 AND opportunity_id = $2 FOR UPDATE
      `, [this.tenantId, calculation.opportunity_id]);
      if (opportunity.stage === STAGES.CALCULATION_CREATED) {
        opportunity = await this.transition(
          client,
          opportunity,
          STAGES.PROPOSAL_SENT,
          "calculator_link_delivered",
          now,
        );
        await this.enqueueOpportunity(client, opportunity, now);
      }
      return publicOpportunity(opportunity);
    });
  }

  async requestSalesContact(toolContext, params) {
    if (params.explicit_confirmation !== true) {
      throw new PostgresCrmValidationError("Satış iletişim talebi için açık kullanıcı onayı gerekir.");
    }
    const phone = resolveTrustedPhone(toolContext);
    const opportunityId = requiredText(params.opportunity_id, "Fırsat kimliği", 80);
    const now = this.timestamp();
    return this.transaction(async (client) => {
      let opportunity = await one(client, `
        SELECT o.* FROM crm.opportunities o
        JOIN crm.contacts c
          ON c.tenant_id = o.tenant_id AND c.contact_id = o.contact_id
        WHERE o.tenant_id = $1 AND o.opportunity_id = $2 AND c.phone_e164 = $3
        FOR UPDATE OF o
      `, [this.tenantId, opportunityId, phone]);
      if (!opportunity) {
        throw new PostgresCrmValidationError("Fırsat bu müşteri kaydına ait değil.");
      }
      const calculation = await one(client, `
        SELECT calculation_id FROM crm.calculations
        WHERE tenant_id = $1 AND opportunity_id = $2 LIMIT 1
      `, [this.tenantId, opportunityId]);
      if (!calculation) {
        throw new PostgresCrmValidationError("Satış iletişim talebinden önce hesaplama bulunmalıdır.");
      }

      opportunity = await this.transition(
        client,
        opportunity,
        STAGES.SALES_CONTACT_REQUESTED,
        "customer_requested_sales_contact",
        now,
      );
      const contact = await one(client, `
        UPDATE crm.contacts
        SET communication_status = 'contact_requested', consent_updated_at = $1, updated_at = $1
        WHERE tenant_id = $2 AND contact_id = $3
        RETURNING *
      `, [now, this.tenantId, opportunity.contact_id]);
      let task = await one(client, `
        SELECT * FROM crm.sales_tasks
        WHERE tenant_id = $1 AND opportunity_id = $2
          AND task_type = 'sales_contact' AND status = 'open'
      `, [this.tenantId, opportunityId]);
      if (!task) {
        task = await one(client, `
          INSERT INTO crm.sales_tasks (
            task_id, tenant_id, opportunity_id, task_type, status,
            owner, due_at, created_at, updated_at
          ) VALUES ($1, $2, $3, 'sales_contact', 'open', 'unassigned', $4, $4, $4)
          RETURNING *
        `, [randomUUID(), this.tenantId, opportunityId, now]);
      }
      await this.enqueueContact(client, contact, now);
      await this.enqueueOpportunity(client, opportunity, now);
      await this.enqueueTask(client, task, now);
      return {
        ok: true,
        phone: maskPhone(phone),
        stage: opportunity.stage,
        task_id: task.task_id,
        task_status: task.status,
      };
    });
  }

  async setCommunicationStatus(toolContext, params) {
    if (params.explicit_confirmation !== true) {
      throw new PostgresCrmValidationError("İletişim tercihi yalnızca açık kullanıcı beyanıyla değiştirilebilir.");
    }
    const status = String(params.status ?? "");
    if (!new Set(["opted_in", "opted_out"]).has(status)) {
      throw new PostgresCrmValidationError("İletişim tercihi geçersiz.");
    }
    const phone = resolveTrustedPhone(toolContext);
    const now = this.timestamp();
    return this.transaction(async (client) => {
      const updated = await one(client, `
        UPDATE crm.contacts
        SET communication_status = $1, consent_updated_at = $2, updated_at = $2
        WHERE tenant_id = $3 AND phone_e164 = $4
        RETURNING *
      `, [status, now, this.tenantId, phone]);
      if (!updated) {
        throw new PostgresCrmValidationError("Bu müşteri için CRM kaydı bulunamadı.");
      }
      if (!COMMUNICATION_STATUSES.has(updated.communication_status)) {
        throw new PostgresCrmValidationError("İletişim durumu geçersiz.");
      }
      await this.enqueueContact(client, updated, now);
      return { ok: true, phone: maskPhone(phone), communication_status: status };
    });
  }

  async advanceDueFollowUps() {
    const today = istanbulDate(this.now());
    const now = this.timestamp();
    return this.transaction(async (client) => {
      const due = (await client.query(`
        SELECT * FROM crm.opportunities
        WHERE tenant_id = $1 AND stage = $2
          AND next_follow_up IS NOT NULL AND next_follow_up <= $3
        FOR UPDATE SKIP LOCKED
      `, [this.tenantId, STAGES.PROPOSAL_SENT, today])).rows;
      for (const row of due) {
        const updated = await this.transition(
          client,
          row,
          STAGES.FOLLOW_UP,
          "follow_up_date_reached",
          now,
        );
        await this.enqueueOpportunity(client, updated, now);
      }
      return due.length;
    });
  }

  async pendingOutbox(limit = 50) {
    await this.readyPromise;
    const result = await this.pool.query(`
      SELECT * FROM crm.sync_outbox
      WHERE tenant_id = $1 AND status = 'pending' AND next_attempt_at <= $2
      ORDER BY created_at ASC LIMIT $3
    `, [this.tenantId, this.timestamp(), limit]);
    return result.rows.map((row) => ({
      ...row,
      payload_json: typeof row.payload_json === "string"
        ? row.payload_json
        : JSON.stringify(row.payload_json),
    }));
  }

  async markEntitiesSynced(entityType, entityIds) {
    if (entityIds.length === 0) return;
    await this.readyPromise;
    await this.pool.query(`
      UPDATE crm.sync_outbox SET status = 'synced', last_error = NULL, updated_at = $1
      WHERE tenant_id = $2 AND status = 'pending' AND entity_type = $3
        AND entity_id = ANY($4::text[])
    `, [this.timestamp(), this.tenantId, entityType, entityIds]);
  }

  async markEntitiesFailed(entityType, entityIds, error, retrySeconds = 30) {
    if (entityIds.length === 0) return;
    await this.readyPromise;
    const nowDate = this.now();
    const retryAt = new Date(nowDate.getTime() + retrySeconds * 1000).toISOString();
    await this.pool.query(`
      UPDATE crm.sync_outbox
      SET attempts = attempts + 1, next_attempt_at = $1, last_error = $2, updated_at = $3
      WHERE tenant_id = $4 AND status = 'pending' AND entity_type = $5
        AND entity_id = ANY($6::text[])
    `, [
      retryAt,
      String(error).slice(0, 240),
      nowDate.toISOString(),
      this.tenantId,
      entityType,
      entityIds,
    ]);
  }

  async stats() {
    await this.readyPromise;
    const result = await this.pool.query(`
      SELECT
        (SELECT COUNT(*) FROM crm.contacts WHERE tenant_id = $1) AS contacts,
        (SELECT COUNT(*) FROM crm.opportunities WHERE tenant_id = $1) AS opportunities,
        (SELECT COUNT(*) FROM crm.calculations WHERE tenant_id = $1) AS calculations,
        (SELECT COUNT(*) FROM crm.sales_tasks WHERE tenant_id = $1) AS tasks,
        (SELECT COUNT(*) FROM crm.sync_outbox WHERE tenant_id = $1 AND status = 'pending') AS pending_sync
    `, [this.tenantId]);
    return Object.fromEntries(
      Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)]),
    );
  }

  async close() {
    await this.readyPromise.catch(() => {});
    if (this.ownsPool) await this.pool.end();
  }
}
