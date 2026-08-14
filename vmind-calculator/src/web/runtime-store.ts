import { createHash, randomUUID } from 'node:crypto';

import pg from 'pg';

import type { FlowResult } from '../agents/orchestrator.js';
import type { LlmProvider, UsageReport } from '../agents/llm.js';
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
  provider: LlmProvider;
  model: string;
  nextUsageSeq: number;
}

export interface StartRunInput {
  sessionId: string;
  identity: Identity;
  salesText: string;
  channel: string;
  provider: LlmProvider;
  model: string;
}

export interface FinishRunInput {
  result?: FlowResult;
  error?: unknown;
  trail: AuditTrail;
}

export interface RuntimeStore {
  init(): Promise<void>;
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
  if (identity.userId.startsWith('local:')) return 'guest';
  return 'user';
}

function amount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
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
      const result = await this.pool.query<{ audit_events: string | null }>(
        `SELECT to_regclass('agent.audit_events')::text AS audit_events`,
      );
      if (result.rows[0]?.audit_events !== 'agent.audit_events') {
        throw new Error('002_agent_runtime_telemetry.sql uygulanmamış.');
      }
    });
    this.degraded = false;
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
              output_tokens, cache_read_tokens, cost_usd, usage_seq)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
