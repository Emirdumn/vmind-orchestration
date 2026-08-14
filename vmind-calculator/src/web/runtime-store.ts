import { createHash, randomUUID } from 'node:crypto';

import pg from 'pg';

import type { FlowResult } from '../agents/orchestrator.js';
import type { LlmProvider, UsageReport } from '../agents/llm.js';
import type { StructuredCachePut, StructuredResponseCache } from '../agents/model-router.js';
import type { AuditEvent, AuditTrail } from '../core/telemetry/audit.js';
import { redactPii } from '../core/telemetry/pii.js';
import type { Identity } from './auth.js';
import {
  BudgetExceededError,
  type BudgetLimits,
  type BudgetSnapshot,
} from './budget.js';

const { Pool } = pg;

export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

export interface RuntimeRun {
  runId: string;
  conversationId: string;
  principalId: string;
  sessionId: string;
  provider: RuntimeProvider;
  model: string;
  nextUsageSeq: number;
}

export type RuntimeProvider = LlmProvider | 'deterministic';

export interface StartRunInput {
  sessionId: string;
  identity: Identity;
  salesText: string;
  channel: string;
  provider: RuntimeProvider;
  model: string;
}

export interface FinishRunInput {
  result?: FlowResult;
  error?: unknown;
  trail: AuditTrail;
}

export interface AdminOverview {
  generatedAt: string;
  principals: number;
  runs: {
    total: number;
    running: number;
    completed: number;
    failed: number;
  };
  estimates: { total: number; published: number };
  crm: { contacts: number; opportunities: number; openOpportunities: number };
  today: { llmCalls: number; inputTokens: number; outputTokens: number; costUsd: number };
  cache: { entries: number; activeEntries: number; hits: number };
}

export interface AdminRunRow {
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  channel: string | null;
  provider: string;
  model: string;
  status: string;
  resultStage: string | null;
  published: boolean;
  principalType: string | null;
  principalKey: string | null;
  displayName: string | null;
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  toolCalls: number;
  rejectedToolCalls: number;
  estimateStatus: string | null;
  currency: string | null;
  monthlyTotal: number | null;
  errorCode: string | null;
}

export interface AdminRunDetail {
  run: AdminRunRow;
  messages: Array<{
    direction: string;
    contentRedacted: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
  auditEvents: Array<{
    eventSeq: number;
    eventType: string;
    summary: string;
    detail: Record<string, unknown>;
    occurredAt: string;
  }>;
}

export interface AdminDailyUsageRow {
  usageDayUtc: string;
  principalType: string | null;
  principalKey: string | null;
  displayName: string | null;
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface AdminOpportunityRow {
  opportunityId: string;
  contactId: string;
  phoneE164: string;
  name: string | null;
  company: string | null;
  communicationStatus: string;
  consentUpdatedAt: string | null;
  consentNoticeVersion: string | null;
  consentSource: string | null;
  customerNeed: string;
  recommendedService: string | null;
  stage: string;
  estimatedAmountMinor: number | null;
  currency: string | null;
  owner: string;
  nextFollowUp: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
  calculation: null | {
    externalCalculationId: string;
    calculatorUrl: string;
    configurationSummary: string;
    amountMinor: number;
    currency: string;
    version: number;
    createdAt: string;
  };
}

export interface AdminOpportunityUpdate {
  stage?: string;
  owner?: string;
  nextFollowUp?: string | null;
}

export interface RuntimeStore extends StructuredResponseCache {
  init(): Promise<void>;
  healthCheck(): Promise<void>;
  assertCanSpend(identity: Identity): Promise<void>;
  remaining(identity: Identity): Promise<{ total: number | null; user: number | null }>;
  snapshot(): Promise<BudgetSnapshot>;
  reconcileLegacyBudget(snapshot: BudgetSnapshot): Promise<void>;
  startRun(input: StartRunInput): Promise<RuntimeRun>;
  appendInteraction(
    sessionId: string,
    direction: 'inbound' | 'outbound' | 'system',
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
  recordUsage(run: RuntimeRun, usage: UsageReport): Promise<void>;
  finishRun(run: RuntimeRun, input: FinishRunInput): Promise<void>;
  adminOverview(): Promise<AdminOverview>;
  adminRuns(limit: number): Promise<AdminRunRow[]>;
  adminRunDetail(runId: string): Promise<AdminRunDetail | null>;
  adminDailyUsage(days: number): Promise<AdminDailyUsageRow[]>;
  adminOpportunities(limit: number, stage?: string): Promise<AdminOpportunityRow[]>;
  adminUpdateOpportunity(
    opportunityId: string,
    update: AdminOpportunityUpdate,
  ): Promise<AdminOpportunityRow | null>;
  close(): Promise<void>;
}

export class RuntimeStoreUnavailableError extends Error {
  constructor(operation: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`PostgreSQL ${operation} işlemi başarısız: ${message}`);
    this.name = 'RuntimeStoreUnavailableError';
  }
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

function safeText(value: string, max = 8_000): string {
  const redacted = redactPii(value);
  return redacted.length > max ? `${redacted.slice(0, max)}…` : redacted;
}

/** PostgreSQL'e giden yapıların içindeki her metni PII filtresinden geçirir. */
function safeValue(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[DERINLIK_SINIRI]';
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return safeText(value, 4_000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.slice(0, 250).map((item) => safeValue(item, depth + 1));
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 250)) {
      output[key] = safeValue(child, depth + 1);
    }
    return output;
  }
  return String(value);
}

function jsonObject(value: unknown): Record<string, unknown> {
  const safe = safeValue(value);
  return safe !== null && typeof safe === 'object' && !Array.isArray(safe)
    ? (safe as Record<string, unknown>)
    : { value: safe };
}

function principalType(identity: Identity): 'user' | 'service' | 'guest' {
  if (identity.actorType === 'service') return 'service';
  if (identity.userId.startsWith('local:') || identity.userId.startsWith('guest:')) return 'guest';
  return 'user';
}

function amount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableAmount(value: unknown): number | null {
  return value === null || value === undefined ? null : amount(value);
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function nullableIso(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}

function utcDayStart(day?: string): string {
  return `${day ?? new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
}

function resultSummary(result: FlowResult | undefined, trail: AuditTrail): Record<string, unknown> {
  const price = result?.price;
  return jsonObject({
    stage: result?.stage,
    published: result?.published ?? false,
    haltReason: result?.haltReason,
    shareUrl: result?.shareUrl,
    currency: price?.currency,
    monthlyTotal: price?.totalMonthCost,
    hourlyTotal: price?.totalHourCost,
    lineCount: price?.lines.length,
    audit: trail.summary(),
  });
}

function outboundSummary(result: FlowResult | undefined, error: unknown): string {
  if (error !== undefined) {
    const message = error instanceof Error ? error.message : String(error);
    return `Akış başarısız: ${message}`;
  }
  if (!result) return 'Akış sonuç üretmeden tamamlandı.';
  const total = result.price
    ? `${result.price.totalMonthCost.toFixed(2)} ${result.price.currency}/ay`
    : 'fiyat oluşmadı';
  return `Akış ${result.stage}; ${total}; yayınlandı=${result.published ? 'evet' : 'hayır'}.`;
}

function externalCalculationId(result: FlowResult | undefined, trail: AuditTrail): string | null {
  const audited = trail.summary().estimateId;
  if (audited) return audited;
  if (!result?.shareUrl) return null;
  try {
    const parts = new URL(result.shareUrl).pathname.split('/').filter(Boolean);
    return parts.at(-1) ?? null;
  } catch {
    return null;
  }
}

export class PostgresRuntimeStore implements RuntimeStore {
  private readonly pool: pg.Pool;
  private writeFailures = 0;
  private degraded = false;

  constructor(
    connectionString: string,
    private readonly limits: BudgetLimits,
    private readonly tenantId = DEFAULT_TENANT_ID,
  ) {
    if (!connectionString.trim()) throw new Error('VMIND_DATABASE_URL boş olamaz.');
    this.pool = new Pool({
      connectionString,
      application_name: 'vmind-calculator',
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  private async guarded<T>(operation: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof BudgetExceededError) throw error;
      this.writeFailures++;
      this.degraded = true;
      throw new RuntimeStoreUnavailableError(operation, error);
    }
  }

  async init(): Promise<void> {
    await this.guarded('bağlantı doğrulama', async () => {
      const result = await this.pool.query<{
        audit_events: string | null;
        run_overview: string | null;
        daily_usage: string | null;
        consent_notice_version: string | null;
        response_cache: string | null;
        route_tier: string | null;
      }>(
        `SELECT
           to_regclass('agent.audit_events')::text AS audit_events,
           to_regclass('agent.run_overview')::text AS run_overview,
           to_regclass('billing.daily_usage')::text AS daily_usage,
           (
             SELECT column_name FROM information_schema.columns
              WHERE table_schema = 'crm' AND table_name = 'contacts'
                AND column_name = 'consent_notice_version'
           ) AS consent_notice_version,
           to_regclass('agent.response_cache')::text AS response_cache,
           (
             SELECT column_name FROM information_schema.columns
              WHERE table_schema = 'agent' AND table_name = 'llm_usage'
                AND column_name = 'route_tier'
           ) AS route_tier`,
      );
      const row = result.rows[0];
      if (row?.audit_events !== 'agent.audit_events') {
        throw new Error('002_agent_runtime_telemetry.sql uygulanmamış.');
      }
      if (row.run_overview !== 'agent.run_overview' || row.daily_usage !== 'billing.daily_usage') {
        throw new Error('003_runtime_reporting_views.sql uygulanmamış.');
      }
      if (row.consent_notice_version !== 'consent_notice_version') {
        throw new Error('004_contact_consent_audit.sql uygulanmamış.');
      }
      if (row.response_cache !== 'agent.response_cache' || row.route_tier !== 'route_tier') {
        throw new Error('006_model_routing_cache.sql uygulanmamış.');
      }
      const columns = await this.pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'agent' AND table_name = 'run_overview'
            AND column_name = 'tenant_id'`,
      );
      if (columns.rowCount !== 1) {
        throw new Error('005_tenant_safe_admin_reporting.sql uygulanmamış.');
      }
    });
    this.degraded = false;
  }

  async healthCheck(): Promise<void> {
    await this.guarded('sağlık kontrolü', async () => {
      const result = await this.pool.query<{ ok: number }>('SELECT 1::int AS ok');
      if (result.rows[0]?.ok !== 1) throw new Error('PostgreSQL beklenen yanıtı vermedi.');
    });
  }

  private async ensurePrincipal(identity: Identity): Promise<string> {
    const existing = await this.pool.query<{ principal_id: string }>(
      `SELECT principal_id
         FROM identity.principals
        WHERE tenant_id = $1 AND principal_type = $2 AND external_key = $3`,
      [this.tenantId, principalType(identity), identity.userId],
    );
    let principalId = existing.rows[0]?.principal_id;
    if (!principalId) {
      principalId = randomUUID();
      const inserted = await this.pool.query<{ principal_id: string }>(
        `INSERT INTO identity.principals
           (principal_id, tenant_id, principal_type, external_key, display_name, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id, principal_type, external_key)
         DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()
         RETURNING principal_id`,
        [
          principalId,
          this.tenantId,
          principalType(identity),
          identity.userId,
          safeText(identity.displayName, 200),
          { source: 'vmind-calculator' },
        ],
      );
      principalId = inserted.rows[0]!.principal_id;
    }
    await this.syncPolicies(principalId);
    return principalId;
  }

  private async syncPolicies(principalId: string): Promise<void> {
    const policies: Array<{
      scopeType: 'tenant' | 'principal';
      scopeId: string;
      maxCost: number;
    }> = [
      { scopeType: 'tenant', scopeId: this.tenantId, maxCost: this.limits.dailyTotalUsd },
      { scopeType: 'principal', scopeId: principalId, maxCost: this.limits.dailyPerUserUsd },
    ];
    for (const policy of policies) {
      await this.pool.query(
        `INSERT INTO billing.quota_policies
           (quota_policy_id, tenant_id, scope_type, scope_id, period, max_cost_usd, active)
         VALUES ($1, $2, $3, $4, 'day', $5, $6)
         ON CONFLICT (tenant_id, scope_type, scope_id, period)
         DO UPDATE SET max_cost_usd = EXCLUDED.max_cost_usd,
                       active = EXCLUDED.active,
                       updated_at = now()`,
        [
          randomUUID(),
          this.tenantId,
          policy.scopeType,
          policy.scopeId,
          policy.maxCost > 0 ? policy.maxCost : null,
          policy.maxCost > 0,
        ],
      );
    }
  }

  private async spend(principalId: string, day?: string): Promise<{ total: number; user: number }> {
    const start = utcDayStart(day);
    const result = await this.pool.query<{ total: string; user_total: string }>(
      `SELECT
         COALESCE(SUM(cost_usd), 0)::text AS total,
         COALESCE(SUM(cost_usd) FILTER (WHERE principal_id = $2), 0)::text AS user_total
       FROM billing.usage_ledger
       WHERE tenant_id = $1 AND occurred_at >= $3::timestamptz
         AND occurred_at < $3::timestamptz + interval '1 day'`,
      [this.tenantId, principalId, start],
    );
    return {
      total: amount(result.rows[0]?.total),
      user: amount(result.rows[0]?.user_total),
    };
  }

  async assertCanSpend(identity: Identity): Promise<void> {
    // Önceki bir LLM kullanım satırı yazılamadıysa PostgreSQL toplamı eksik
    // olabilir. Restart uzlaştırması yapılana kadar yeni harcamayı kapat.
    if (this.degraded) {
      throw new RuntimeStoreUnavailableError(
        'kota kontrolü',
        'önceki kalıcı kayıt başarısız; servis yeniden uzlaştırılmalı',
      );
    }
    await this.guarded('kota kontrolü', async () => {
      const principalId = await this.ensurePrincipal(identity);
      const spent = await this.spend(principalId);
      if (this.limits.dailyTotalUsd > 0 && spent.total >= this.limits.dailyTotalUsd) {
        throw new BudgetExceededError('total', spent.total, this.limits.dailyTotalUsd);
      }
      if (this.limits.dailyPerUserUsd > 0 && spent.user >= this.limits.dailyPerUserUsd) {
        throw new BudgetExceededError(
          'user',
          spent.user,
          this.limits.dailyPerUserUsd,
          identity.userId,
        );
      }
    });
  }

  async remaining(identity: Identity): Promise<{ total: number | null; user: number | null }> {
    return this.guarded('kalan kota', async () => {
      const principalId = await this.ensurePrincipal(identity);
      const spent = await this.spend(principalId);
      return {
        total:
          this.limits.dailyTotalUsd > 0
            ? Math.max(0, this.limits.dailyTotalUsd - spent.total)
            : null,
        user:
          this.limits.dailyPerUserUsd > 0
            ? Math.max(0, this.limits.dailyPerUserUsd - spent.user)
            : null,
      };
    });
  }

  async snapshot(): Promise<BudgetSnapshot> {
    return this.guarded('kota özeti', async () => {
      const day = new Date().toISOString().slice(0, 10);
      const start = utcDayStart(day);
      const result = await this.pool.query<{
        external_key: string | null;
        spent: string;
      }>(
        `SELECT p.external_key, SUM(l.cost_usd)::text AS spent
           FROM billing.usage_ledger l
           LEFT JOIN identity.principals p ON p.principal_id = l.principal_id
          WHERE l.tenant_id = $1
            AND l.occurred_at >= $2::timestamptz
            AND l.occurred_at < $2::timestamptz + interval '1 day'
          GROUP BY p.external_key`,
        [this.tenantId, start],
      );
      const perUserUsd: Record<string, number> = {};
      let totalUsd = 0;
      for (const row of result.rows) {
        const spent = amount(row.spent);
        totalUsd += spent;
        if (row.external_key) perUserUsd[row.external_key] = spent;
      }
      return {
        day,
        totalUsd,
        perUserUsd,
        limits: { ...this.limits },
        writeFailures: this.writeFailures,
      };
    });
  }

  /**
   * Faz-1 JSON defterindeki o günkü harcamayı PostgreSQL'e eksik kadar taşır.
   * Hedef miktar idempotency anahtarına girdiği için restart aynı satırı çoğaltmaz.
   */
  async reconcileLegacyBudget(snapshot: BudgetSnapshot): Promise<void> {
    await this.guarded('eski kota uzlaştırması', async () => {
      for (const [userId, targetCost] of Object.entries(snapshot.perUserUsd)) {
        if (!Number.isFinite(targetCost) || targetCost <= 0) continue;
        const identity: Identity = { userId, displayName: userId };
        const principalId = await this.ensurePrincipal(identity);
        const current = (await this.spend(principalId, snapshot.day)).user;
        const delta = targetCost - current;
        if (delta <= 0.000000005) continue;
        await this.pool.query(
          `INSERT INTO billing.usage_ledger
             (usage_ledger_id, tenant_id, principal_id, cost_usd, occurred_at, source, idempotency_key)
           VALUES ($1, $2, $3, $4, $5::timestamptz, 'legacy-budget', $6)
           ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
           DO NOTHING`,
          [
            randomUUID(),
            this.tenantId,
            principalId,
            delta,
            utcDayStart(snapshot.day),
            `legacy:${snapshot.day}:${sha256(userId).slice(0, 24)}:${targetCost.toFixed(8)}`,
          ],
        );
      }
    });
  }

  async startRun(input: StartRunInput): Promise<RuntimeRun> {
    return this.guarded('akış başlangıcı', async () => {
      const principalId = await this.ensurePrincipal(input.identity);
      const runId = randomUUID();
      const conversationId = input.sessionId;
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO agent.conversations
             (conversation_id, tenant_id, principal_id, channel, external_thread_key_hash)
           VALUES ($1, $2, $3, $4, $5)`,
          [conversationId, this.tenantId, principalId, safeText(input.channel, 80), sha256(input.sessionId)],
        );
        await client.query(
          `INSERT INTO agent.runs
             (run_id, tenant_id, conversation_id, principal_id, provider, model,
              prompt_version, status, request_summary, external_run_key, channel)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'running', $8, $9, $10)`,
          [
            runId,
            this.tenantId,
            conversationId,
            principalId,
            input.provider,
            input.model,
            process.env['VMIND_PROMPT_VERSION'] ?? 'phase2',
            {
              inputChars: input.salesText.length,
              inputHash: sha256(input.salesText),
              channel: input.channel,
            },
            input.sessionId,
            input.channel,
          ],
        );
        await client.query(
          `INSERT INTO agent.messages
             (message_id, tenant_id, conversation_id, run_id, direction,
              content_redacted, content_hash, metadata)
           VALUES ($1, $2, $3, $4, 'inbound', $5, $6, $7)`,
          [
            randomUUID(),
            this.tenantId,
            conversationId,
            runId,
            safeText(input.salesText),
            sha256(input.salesText),
            { kind: 'flow.start', channel: input.channel },
          ],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      return {
        runId,
        conversationId,
        principalId,
        sessionId: input.sessionId,
        provider: input.provider,
        model: input.model,
        nextUsageSeq: 0,
      };
    });
  }

  async appendInteraction(
    sessionId: string,
    direction: 'inbound' | 'outbound' | 'system',
    content: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.guarded('mesaj kaydı', async () => {
      const found = await this.pool.query<{ run_id: string; conversation_id: string }>(
        `SELECT run_id, conversation_id
           FROM agent.runs
          WHERE tenant_id = $1 AND external_run_key = $2`,
        [this.tenantId, sessionId],
      );
      const run = found.rows[0];
      if (!run) return;
      await this.pool.query(
        `INSERT INTO agent.messages
           (message_id, tenant_id, conversation_id, run_id, direction,
            content_redacted, content_hash, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          randomUUID(),
          this.tenantId,
          run.conversation_id,
          run.run_id,
          direction,
          safeText(content),
          sha256(content),
          jsonObject(metadata),
        ],
      );
    });
  }

  async recordUsage(run: RuntimeRun, usage: UsageReport): Promise<void> {
    const usageSeq = ++run.nextUsageSeq;
    await this.guarded('LLM kullanım kaydı', async () => {
      const usageId = randomUUID();
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO agent.llm_usage
             (usage_id, tenant_id, run_id, provider, model, input_tokens,
              output_tokens, cache_read_tokens, cost_usd, usage_seq, route_tier, route_reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            usageId,
            this.tenantId,
            run.runId,
            run.provider,
            safeText(usage.model, 200),
            usage.inputTokens,
            usage.outputTokens,
            usage.cacheReadTokens ?? 0,
            usage.costUsd ?? null,
            usageSeq,
            usage.routeTier ?? null,
            usage.routeReason ? safeText(usage.routeReason, 500) : null,
          ],
        );
        await client.query(
          `INSERT INTO billing.usage_ledger
             (usage_ledger_id, tenant_id, principal_id, run_id, usage_id,
              input_tokens, output_tokens, cost_usd, source, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'llm', $9)`,
          [
            randomUUID(),
            this.tenantId,
            run.principalId,
            run.runId,
            usageId,
            usage.inputTokens,
            usage.outputTokens,
            usage.costUsd ?? null,
            `run:${run.runId}:usage:${usageSeq}`,
          ],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
  }

  /** Önbellek hızlandırıcıdır; arızası teklif akışını durdurmaz. */
  async get(cacheKey: string): Promise<unknown | null> {
    try {
      const result = await this.pool.query<{ response_json: unknown }>(
        `UPDATE agent.response_cache
            SET hit_count = hit_count + 1, last_hit_at = now(), updated_at = now()
          WHERE tenant_id = $1 AND cache_key = $2 AND expires_at > now()
          RETURNING response_json`,
        [this.tenantId, cacheKey],
      );
      return result.rows[0]?.response_json ?? null;
    } catch {
      return null;
    }
  }

  /** PII kontrolü router'da yapılır; veritabanı yalnızca doğrulanmış JSON alır. */
  async put(entry: StructuredCachePut): Promise<void> {
    try {
      const ttlSeconds = Math.min(Math.max(Math.trunc(entry.ttlSeconds), 60), 604_800);
      await this.pool.query(
        `INSERT INTO agent.response_cache
           (tenant_id, cache_key, model, schema_name, prompt_version, response_json, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, now() + ($7::int * interval '1 second'))
         ON CONFLICT (tenant_id, cache_key)
         DO UPDATE SET model = EXCLUDED.model,
                       schema_name = EXCLUDED.schema_name,
                       prompt_version = EXCLUDED.prompt_version,
                       response_json = EXCLUDED.response_json,
                       expires_at = EXCLUDED.expires_at,
                       updated_at = now()`,
        [
          this.tenantId,
          entry.cacheKey,
          safeText(entry.model, 200),
          safeText(entry.schemaName, 120),
          safeText(entry.promptVersion, 120),
          jsonObject(entry.response),
          ttlSeconds,
        ],
      );
    } catch {
      // Cache yazılamaması fiyatlama ve kota doğruluğunu etkilemez.
    }
  }

  async finishRun(run: RuntimeRun, input: FinishRunInput): Promise<void> {
    await this.guarded('akış sonuç kaydı', async () => {
      const audit = input.trail.toJSON();
      const status = input.error === undefined ? 'completed' : 'failed';
      const errorText =
        input.error === undefined
          ? null
          : safeText(input.error instanceof Error ? input.error.message : String(input.error), 1_000);
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE agent.runs
              SET status = $3,
                  response_summary = $4,
                  error_code = $5,
                  result_stage = $6,
                  published = $7,
                  total_cost_usd = (
                    SELECT SUM(cost_usd) FROM agent.llm_usage WHERE run_id = $1
                  ),
                  finished_at = now()
            WHERE run_id = $1 AND tenant_id = $2`,
          [
            run.runId,
            this.tenantId,
            status,
            resultSummary(input.result, input.trail),
            errorText ? 'FLOW_FAILED' : null,
            input.result?.stage ?? (errorText ? 'failed' : null),
            input.result?.published ?? false,
          ],
        );

        const outbound = outboundSummary(input.result, input.error);
        await client.query(
          `INSERT INTO agent.messages
             (message_id, tenant_id, conversation_id, run_id, direction,
              content_redacted, content_hash, metadata)
           VALUES ($1, $2, $3, $4, 'outbound', $5, $6, $7)`,
          [
            randomUUID(),
            this.tenantId,
            run.conversationId,
            run.runId,
            safeText(outbound),
            sha256(outbound),
            { kind: 'flow.result', state: status },
          ],
        );

        for (const event of audit.events) {
          await this.insertAuditEvent(client, run, event);
          if (event.type === 'tool.call' || event.type === 'tool.rejected') {
            const detail = event.detail ?? {};
            await client.query(
              `INSERT INTO agent.tool_calls
                 (tool_call_id, tenant_id, run_id, tool_name, status,
                  input_summary, output_summary, error_code, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb, $7, $8::timestamptz)`,
              [
                randomUUID(),
                this.tenantId,
                run.runId,
                safeText(String(detail['tool'] ?? 'unknown'), 200),
                event.type === 'tool.call' ? 'succeeded' : 'rejected',
                jsonObject(detail['input'] ?? {}),
                event.type === 'tool.rejected'
                  ? safeText(String(detail['errorName'] ?? 'TOOL_REJECTED'), 200)
                  : null,
                event.at,
              ],
            );
          }
        }

        if (input.result?.price) {
          const result = input.result;
          const price = result.price!;
          const externalId = externalCalculationId(result, input.trail);
          await client.query(
            `INSERT INTO calculator.estimates
               (estimate_id, tenant_id, external_calculation_id, version, currency,
                monthly_total, requirement_spec, estimate_payload, published,
                run_id, principal_id, flow_session_id, status)
             VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             ON CONFLICT (tenant_id, run_id, version) WHERE run_id IS NOT NULL
             DO UPDATE SET external_calculation_id = EXCLUDED.external_calculation_id,
                           currency = EXCLUDED.currency,
                           monthly_total = EXCLUDED.monthly_total,
                           requirement_spec = EXCLUDED.requirement_spec,
                           estimate_payload = EXCLUDED.estimate_payload,
                           published = EXCLUDED.published,
                           status = EXCLUDED.status`,
            [
              randomUUID(),
              this.tenantId,
              externalId,
              price.currency,
              price.totalMonthCost,
              jsonObject(result.spec ?? {}),
              jsonObject({
                stage: result.stage,
                draft: result.draft,
                audit: result.audit,
                price,
                assumptions: result.assumptions,
                haltReason: result.haltReason,
                shareUrl: result.shareUrl,
              }),
              result.published,
              run.runId,
              run.principalId,
              run.sessionId,
              result.published ? 'published' : result.stage === 'halted' ? 'halted' : 'dry_run',
            ],
          );
        }

        await client.query(
          `UPDATE agent.conversations
              SET status = 'closed', updated_at = now()
            WHERE conversation_id = $1 AND tenant_id = $2`,
          [run.conversationId, this.tenantId],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
  }

  private async insertAuditEvent(
    client: pg.PoolClient,
    run: RuntimeRun,
    event: AuditEvent,
  ): Promise<void> {
    await client.query(
      `INSERT INTO agent.audit_events
         (audit_event_id, tenant_id, run_id, event_seq, event_type, summary, detail, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)
       ON CONFLICT (tenant_id, run_id, event_seq) DO NOTHING`,
      [
        randomUUID(),
        this.tenantId,
        run.runId,
        event.seq,
        event.type,
        safeText(event.summary, 1_000),
        jsonObject(event.detail ?? {}),
        event.at,
      ],
    );
  }

  async adminOverview(): Promise<AdminOverview> {
    return this.guarded('yönetim özeti', async () => {
      const result = await this.pool.query<{
        principals: string;
        runs_total: string;
        runs_running: string;
        runs_completed: string;
        runs_failed: string;
        estimates_total: string;
        estimates_published: string;
        contacts: string;
        opportunities: string;
        open_opportunities: string;
        llm_calls_today: string;
        input_tokens_today: string;
        output_tokens_today: string;
        cost_usd_today: string;
        cache_entries: string;
        cache_active_entries: string;
        cache_hits: string;
      }>(
        `SELECT
          (SELECT COUNT(*) FROM identity.principals WHERE tenant_id = $1)::text AS principals,
          (SELECT COUNT(*) FROM agent.runs WHERE tenant_id = $1)::text AS runs_total,
          (SELECT COUNT(*) FROM agent.runs WHERE tenant_id = $1 AND status = 'running')::text AS runs_running,
          (SELECT COUNT(*) FROM agent.runs WHERE tenant_id = $1 AND status = 'completed')::text AS runs_completed,
          (SELECT COUNT(*) FROM agent.runs WHERE tenant_id = $1 AND status = 'failed')::text AS runs_failed,
          (SELECT COUNT(*) FROM calculator.estimates WHERE tenant_id = $1)::text AS estimates_total,
          (SELECT COUNT(*) FROM calculator.estimates WHERE tenant_id = $1 AND published)::text AS estimates_published,
          (SELECT COUNT(*) FROM crm.contacts WHERE tenant_id = $1)::text AS contacts,
          (SELECT COUNT(*) FROM crm.opportunities WHERE tenant_id = $1)::text AS opportunities,
          (SELECT COUNT(*) FROM crm.opportunities
            WHERE tenant_id = $1 AND stage NOT IN ('Won', 'Lost'))::text AS open_opportunities,
          (SELECT COUNT(*) FILTER (WHERE source = 'llm') FROM billing.usage_ledger
            WHERE tenant_id = $1 AND occurred_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::text AS llm_calls_today,
          (SELECT COALESCE(SUM(input_tokens), 0) FROM billing.usage_ledger
            WHERE tenant_id = $1 AND occurred_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::text AS input_tokens_today,
          (SELECT COALESCE(SUM(output_tokens), 0) FROM billing.usage_ledger
            WHERE tenant_id = $1 AND occurred_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::text AS output_tokens_today,
          (SELECT COALESCE(SUM(cost_usd), 0) FROM billing.usage_ledger
            WHERE tenant_id = $1 AND occurred_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::text AS cost_usd_today,
          (SELECT COUNT(*) FROM agent.response_cache WHERE tenant_id = $1)::text AS cache_entries,
          (SELECT COUNT(*) FROM agent.response_cache
            WHERE tenant_id = $1 AND expires_at > now())::text AS cache_active_entries,
          (SELECT COALESCE(SUM(hit_count), 0) FROM agent.response_cache
            WHERE tenant_id = $1)::text AS cache_hits`,
        [this.tenantId],
      );
      const row = result.rows[0]!;
      return {
        generatedAt: new Date().toISOString(),
        principals: amount(row.principals),
        runs: {
          total: amount(row.runs_total),
          running: amount(row.runs_running),
          completed: amount(row.runs_completed),
          failed: amount(row.runs_failed),
        },
        estimates: {
          total: amount(row.estimates_total),
          published: amount(row.estimates_published),
        },
        crm: {
          contacts: amount(row.contacts),
          opportunities: amount(row.opportunities),
          openOpportunities: amount(row.open_opportunities),
        },
        today: {
          llmCalls: amount(row.llm_calls_today),
          inputTokens: amount(row.input_tokens_today),
          outputTokens: amount(row.output_tokens_today),
          costUsd: amount(row.cost_usd_today),
        },
        cache: {
          entries: amount(row.cache_entries),
          activeEntries: amount(row.cache_active_entries),
          hits: amount(row.cache_hits),
        },
      };
    });
  }

  private mapAdminRun(row: Record<string, unknown>): AdminRunRow {
    return {
      runId: String(row['run_id']),
      startedAt: iso(row['started_at']),
      finishedAt: nullableIso(row['finished_at']),
      channel: row['channel'] === null ? null : String(row['channel']),
      provider: String(row['provider']),
      model: String(row['model']),
      status: String(row['status']),
      resultStage: row['result_stage'] === null ? null : String(row['result_stage']),
      published: row['published'] === true,
      principalType: row['principal_type'] === null ? null : String(row['principal_type']),
      principalKey: row['principal_key'] === null ? null : String(row['principal_key']),
      displayName: row['display_name'] === null ? null : String(row['display_name']),
      llmCalls: amount(row['llm_calls']),
      inputTokens: amount(row['input_tokens']),
      outputTokens: amount(row['output_tokens']),
      costUsd: amount(row['cost_usd']),
      toolCalls: amount(row['tool_calls']),
      rejectedToolCalls: amount(row['rejected_tool_calls']),
      estimateStatus: row['estimate_status'] === null ? null : String(row['estimate_status']),
      currency: row['currency'] === null ? null : String(row['currency']),
      monthlyTotal: nullableAmount(row['monthly_total']),
      errorCode: row['error_code'] === null ? null : String(row['error_code']),
    };
  }

  async adminRuns(limit: number): Promise<AdminRunRow[]> {
    return this.guarded('yönetim çalıştırma listesi', async () => {
      const result = await this.pool.query<Record<string, unknown>>(
        `SELECT * FROM agent.run_overview
          WHERE tenant_id = $1
          ORDER BY started_at DESC
          LIMIT $2`,
        [this.tenantId, limit],
      );
      return result.rows.map((row) => this.mapAdminRun(row));
    });
  }

  async adminRunDetail(runId: string): Promise<AdminRunDetail | null> {
    return this.guarded('yönetim çalıştırma detayı', async () => {
      const runResult = await this.pool.query<Record<string, unknown>>(
        `SELECT * FROM agent.run_overview WHERE tenant_id = $1 AND run_id = $2`,
        [this.tenantId, runId],
      );
      const row = runResult.rows[0];
      if (!row) return null;
      const [messages, audit] = await Promise.all([
        this.pool.query<Record<string, unknown>>(
          `SELECT m.direction, m.content_redacted, m.metadata, m.created_at
             FROM agent.messages m
             JOIN agent.runs r ON r.run_id = m.run_id AND r.tenant_id = m.tenant_id
            WHERE m.tenant_id = $1 AND m.run_id = $2 AND r.tenant_id = $1
            ORDER BY m.created_at`,
          [this.tenantId, runId],
        ),
        this.pool.query<Record<string, unknown>>(
          `SELECT event_seq, event_type, summary, detail, occurred_at
             FROM agent.audit_events
            WHERE tenant_id = $1 AND run_id = $2
            ORDER BY event_seq`,
          [this.tenantId, runId],
        ),
      ]);
      return {
        run: this.mapAdminRun(row),
        messages: messages.rows.map((message) => ({
          direction: String(message['direction']),
          contentRedacted:
            message['content_redacted'] === null ? null : String(message['content_redacted']),
          metadata: jsonObject(message['metadata']),
          createdAt: iso(message['created_at']),
        })),
        auditEvents: audit.rows.map((event) => ({
          eventSeq: amount(event['event_seq']),
          eventType: String(event['event_type']),
          summary: String(event['summary']),
          detail: jsonObject(event['detail']),
          occurredAt: iso(event['occurred_at']),
        })),
      };
    });
  }

  async adminDailyUsage(days: number): Promise<AdminDailyUsageRow[]> {
    return this.guarded('yönetim kullanım özeti', async () => {
      const result = await this.pool.query<Record<string, unknown>>(
        `SELECT usage_day_utc, principal_type, principal_key, display_name,
                llm_calls, input_tokens, output_tokens, cost_usd
           FROM billing.daily_usage
          WHERE tenant_id = $1 AND usage_day_utc >= (CURRENT_DATE - ($2::int - 1))
          ORDER BY usage_day_utc DESC, cost_usd DESC`,
        [this.tenantId, days],
      );
      return result.rows.map((row) => ({
        usageDayUtc: iso(row['usage_day_utc']).slice(0, 10),
        principalType: row['principal_type'] === null ? null : String(row['principal_type']),
        principalKey: row['principal_key'] === null ? null : String(row['principal_key']),
        displayName: row['display_name'] === null ? null : String(row['display_name']),
        llmCalls: amount(row['llm_calls']),
        inputTokens: amount(row['input_tokens']),
        outputTokens: amount(row['output_tokens']),
        costUsd: amount(row['cost_usd']),
      }));
    });
  }

  private async queryAdminOpportunities(
    limit: number,
    filters: { stage?: string; opportunityId?: string } = {},
  ): Promise<AdminOpportunityRow[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT
         o.opportunity_id, o.contact_id, c.phone_e164, c.name, c.company,
         c.communication_status, c.consent_updated_at, c.consent_notice_version,
         c.consent_source, o.customer_need, o.recommended_service, o.stage,
         o.estimated_amount_minor, o.currency, o.owner, o.next_follow_up,
         o.source, o.created_at, o.updated_at,
         calc.external_calculation_id, calc.calculator_url,
         calc.configuration_summary, calc.amount_minor AS calculation_amount_minor,
         calc.currency AS calculation_currency, calc.version AS calculation_version,
         calc.created_at AS calculation_created_at
       FROM crm.opportunities o
       JOIN crm.contacts c
         ON c.tenant_id = o.tenant_id AND c.contact_id = o.contact_id
       LEFT JOIN LATERAL (
         SELECT external_calculation_id, calculator_url, configuration_summary,
                amount_minor, currency, version, created_at
           FROM crm.calculations
          WHERE tenant_id = o.tenant_id AND opportunity_id = o.opportunity_id
          ORDER BY version DESC
          LIMIT 1
       ) calc ON true
       WHERE o.tenant_id = $1
         AND ($2::text IS NULL OR o.stage = $2)
         AND ($3::uuid IS NULL OR o.opportunity_id = $3)
       ORDER BY o.updated_at DESC
       LIMIT $4`,
      [this.tenantId, filters.stage ?? null, filters.opportunityId ?? null, limit],
    );
    return result.rows.map((row) => ({
      opportunityId: String(row['opportunity_id']),
      contactId: String(row['contact_id']),
      phoneE164: String(row['phone_e164']),
      name: row['name'] === null ? null : String(row['name']),
      company: row['company'] === null ? null : String(row['company']),
      communicationStatus: String(row['communication_status']),
      consentUpdatedAt: nullableIso(row['consent_updated_at']),
      consentNoticeVersion:
        row['consent_notice_version'] === null ? null : String(row['consent_notice_version']),
      consentSource: row['consent_source'] === null ? null : String(row['consent_source']),
      customerNeed: String(row['customer_need']),
      recommendedService:
        row['recommended_service'] === null ? null : String(row['recommended_service']),
      stage: String(row['stage']),
      estimatedAmountMinor: nullableAmount(row['estimated_amount_minor']),
      currency: row['currency'] === null ? null : String(row['currency']),
      owner: String(row['owner']),
      nextFollowUp: nullableIso(row['next_follow_up'])?.slice(0, 10) ?? null,
      source: String(row['source']),
      createdAt: iso(row['created_at']),
      updatedAt: iso(row['updated_at']),
      calculation:
        row['external_calculation_id'] === null
          ? null
          : {
              externalCalculationId: String(row['external_calculation_id']),
              calculatorUrl: String(row['calculator_url']),
              configurationSummary: String(row['configuration_summary']),
              amountMinor: amount(row['calculation_amount_minor']),
              currency: String(row['calculation_currency']),
              version: amount(row['calculation_version']),
              createdAt: iso(row['calculation_created_at']),
            },
    }));
  }

  async adminOpportunities(limit: number, stage?: string): Promise<AdminOpportunityRow[]> {
    return this.guarded('yönetim fırsat listesi', () =>
      this.queryAdminOpportunities(limit, stage ? { stage } : {}),
    );
  }

  async adminUpdateOpportunity(
    opportunityId: string,
    update: AdminOpportunityUpdate,
  ): Promise<AdminOpportunityRow | null> {
    return this.guarded('yönetim fırsat güncellemesi', async () => {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const before = await client.query<{ stage: string }>(
          `SELECT stage FROM crm.opportunities
            WHERE tenant_id = $1 AND opportunity_id = $2
            FOR UPDATE`,
          [this.tenantId, opportunityId],
        );
        const oldStage = before.rows[0]?.stage;
        if (!oldStage) {
          await client.query('ROLLBACK');
          return null;
        }
        await client.query(
          `UPDATE crm.opportunities
              SET stage = CASE WHEN $3::boolean THEN $4 ELSE stage END,
                  owner = CASE WHEN $5::boolean THEN $6 ELSE owner END,
                  next_follow_up = CASE WHEN $7::boolean THEN $8::date ELSE next_follow_up END,
                  updated_at = now()
            WHERE tenant_id = $1 AND opportunity_id = $2`,
          [
            this.tenantId,
            opportunityId,
            update.stage !== undefined,
            update.stage ?? null,
            update.owner !== undefined,
            update.owner ?? null,
            update.nextFollowUp !== undefined,
            update.nextFollowUp ?? null,
          ],
        );
        if (update.stage !== undefined && update.stage !== oldStage) {
          await client.query(
            `INSERT INTO crm.stage_events
               (event_id, tenant_id, opportunity_id, from_stage, to_stage, reason, created_at)
             VALUES ($1, $2, $3, $4, $5, 'admin-api', now())`,
            [randomUUID(), this.tenantId, opportunityId, oldStage, update.stage],
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      return (await this.queryAdminOpportunities(1, { opportunityId }))[0] ?? null;
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function runtimeStoreFromEnv(
  limits: BudgetLimits,
  env: NodeJS.ProcessEnv = process.env,
): PostgresRuntimeStore | undefined {
  const connectionString = (env['VMIND_DATABASE_URL'] ?? env['DATABASE_URL'] ?? '').trim();
  if (!connectionString) return undefined;
  return new PostgresRuntimeStore(
    connectionString,
    limits,
    (env['VMIND_TENANT_ID'] ?? DEFAULT_TENANT_ID).trim(),
  );
}
