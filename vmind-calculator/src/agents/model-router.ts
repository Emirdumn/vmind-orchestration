import { createHash } from 'node:crypto';

import type { z } from 'zod';

import type {
  LlmClient,
  StructuredRequest,
  ToolLoopRequest,
  ToolLoopResult,
} from './llm.js';
import { summarizePii } from '../core/telemetry/pii.js';

export type ModelTier = 'fast' | 'balanced' | 'strong';

export interface ModelRouteDecision {
  tier: ModelTier;
  model: string;
  reason: string;
}

export interface ModelRouterConfig {
  fastModel: string;
  balancedModel: string;
  strongModel: string;
}

export interface StructuredCachePut {
  cacheKey: string;
  model: string;
  schemaName: string;
  promptVersion: string;
  response: unknown;
  ttlSeconds: number;
}

export interface StructuredResponseCache {
  get(cacheKey: string): Promise<unknown | null>;
  put(entry: StructuredCachePut): Promise<void>;
}

export interface ModelRouterOptions {
  cache?: StructuredResponseCache;
  promptVersion?: string;
  cacheTtlSeconds?: number;
}

export function modelRouterConfigFromEnv(
  provider: 'openrouter' | 'anthropic',
  env: NodeJS.ProcessEnv = process.env,
): ModelRouterConfig {
  const prefix = provider === 'openrouter' ? 'OPENROUTER' : 'ANTHROPIC';
  const configured = (name: string): string | undefined => {
    const value = env[name]?.trim();
    return value ? value : undefined;
  };
  const fallback =
    configured(`${prefix}_MODEL`) ??
    (provider === 'openrouter' ? 'anthropic/claude-opus-5' : 'claude-opus-5');
  return {
    fastModel: configured(`${prefix}_MODEL_FAST`) ?? fallback,
    balancedModel: configured(`${prefix}_MODEL_BALANCED`) ?? fallback,
    strongModel: configured(`${prefix}_MODEL_STRONG`) ?? fallback,
  };
}

const occurrences = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

export function structuredCacheKey(
  request: Pick<StructuredRequest<z.ZodTypeAny>, 'system' | 'userMessage' | 'jsonSchema' | 'schemaName'>,
  decision: ModelRouteDecision,
  promptVersion: string,
): string {
  const canonical = JSON.stringify(
    stableValue({
      version: 1,
      promptVersion,
      model: decision.model,
      schemaName: request.schemaName,
      system: request.system,
      userMessage: request.userMessage,
      jsonSchema: request.jsonSchema,
    }),
  );
  return createHash('sha256').update(canonical).digest('hex');
}

/** Saf ve test edilebilir yönlendirme; hiçbir model çağrısı yapmaz. */
export function routeStructuredRequest(
  request: Pick<StructuredRequest<z.ZodTypeAny>, 'schemaName' | 'userMessage'>,
  config: ModelRouterConfig,
): ModelRouteDecision {
  const text = request.userMessage.toLocaleLowerCase('tr-TR');
  if (request.schemaName !== 'RequirementSpec') {
    return { tier: 'balanced', model: config.balancedModel, reason: 'Genel yapısal çıktı.' };
  }
  const complexSignals = [
    /\b(excel|xlsx|csv|tablo|spreadsheet)\b/,
    /\b(kubernetes|k8s|cluster|kume|küme)\b/,
    /\b(gpu|h100|h200|a100|training|inference)\b/,
    /\b(migration|migrasyon|disaster recovery|felaket kurtarma)\b/,
    /\b(postgresql|redis|rabbitmq|database|veritabani|veritabanı)\b/,
    /\b(ha|high availability|yuksek erisilebilirlik|yüksek erişilebilirlik)\b/,
  ].filter((pattern) => pattern.test(text)).length;
  const roleSignals = occurrences(text, /\b(web|api|db|database|redis|worker|master|backend|frontend)\b/g);
  if (text.length > 2_500 || complexSignals >= 3 || roleSignals >= 5) {
    return {
      tier: 'strong',
      model: config.strongModel,
      reason: 'Uzun veya çok bileşenli altyapı çıkarımı.',
    };
  }
  if (text.length <= 900 && complexSignals === 0 && roleSignals <= 2) {
    return {
      tier: 'fast',
      model: config.fastModel,
      reason: 'Kısa ve tek iş yüklü ihtiyaç çıkarımı.',
    };
  }
  return {
    tier: 'balanced',
    model: config.balancedModel,
    reason: 'Orta karmaşıklıkta ihtiyaç çıkarımı.',
  };
}

export function routeToolLoopRequest(
  request: Pick<ToolLoopRequest, 'system' | 'userMessage' | 'tools'>,
  config: ModelRouterConfig,
): ModelRouteDecision {
  const text = `${request.system}\n${request.userMessage}`.toLocaleLowerCase('tr-TR');
  const complex =
    text.length > 5_000 ||
    occurrences(text, /"role"/g) >= 3 ||
    /\b(kubernetes|k8s|gpu|h100|h200|migration|migrasyon)\b/.test(text);
  if (complex) {
    return {
      tier: 'strong',
      model: config.strongModel,
      reason: 'Çok rollü veya uzmanlık gerektiren tool planı.',
    };
  }
  return {
    tier: 'balanced',
    model: config.balancedModel,
    reason:
      request.tools.length > 0
        ? 'Sınırlı katalog/tool planlama işi.'
        : 'Orta karmaşıklıkta model işi.',
  };
}

/**
 * Her çağrıda uygun sabit model istemcisini seçer. Yönlendirme için ayrı bir
 * LLM çağrısı yapmaz; aksi halde tasarruf daha karar aşamasında kaybolurdu.
 */
export class RoutedLlm implements LlmClient {
  constructor(
    private readonly config: ModelRouterConfig,
    private readonly createClient: (decision: ModelRouteDecision) => LlmClient,
    private readonly options: ModelRouterOptions = {},
  ) {}

  async structured<T extends z.ZodTypeAny>(request: StructuredRequest<T>): Promise<z.infer<T>> {
    const decision = routeStructuredRequest(request, this.config);
    const promptVersion = this.options.promptVersion ?? 'phase2';
    const cache = this.options.cache;
    const cacheAllowed = cache !== undefined && !summarizePii(request.userMessage).found;
    const cacheKey = cacheAllowed
      ? structuredCacheKey(request, decision, promptVersion)
      : undefined;

    if (cache && cacheKey) {
      const cached = await cache.get(cacheKey);
      if (cached !== null) {
        const validated = request.schema.safeParse(cached);
        if (validated.success) return validated.data;
      }
    }

    const response = await this.createClient(decision).structured(request);
    if (cache && cacheKey) {
      await cache.put({
        cacheKey,
        model: decision.model,
        schemaName: request.schemaName,
        promptVersion,
        response,
        ttlSeconds: this.options.cacheTtlSeconds ?? 86_400,
      });
    }
    return response;
  }

  toolLoop(request: ToolLoopRequest): Promise<ToolLoopResult> {
    const decision = routeToolLoopRequest(request, this.config);
    return this.createClient(decision).toolLoop(request);
  }

  text(request: { system: string; userMessage: string; maxTokens?: number }): Promise<string> {
    const decision: ModelRouteDecision = {
      tier: 'fast',
      model: this.config.fastModel,
      reason: 'Kısa serbest metin üretimi.',
    };
    return this.createClient(decision).text(request);
  }
}
