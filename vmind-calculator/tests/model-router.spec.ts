import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { LlmClient, StructuredRequest } from '../src/agents/llm.js';
import {
  RoutedLlm,
  modelRouterConfigFromEnv,
  routeStructuredRequest,
  routeToolLoopRequest,
  structuredCacheKey,
  type ModelRouterConfig,
  type StructuredResponseCache,
} from '../src/agents/model-router.js';

const config: ModelRouterConfig = {
  fastModel: 'fast-model', balancedModel: 'balanced-model', strongModel: 'strong-model',
};
const schema = z.object({ workload: z.string() }).strict();
const request = (userMessage: string): StructuredRequest<typeof schema> => ({
  system: 'İhtiyacı yapısal çıkar.',
  userMessage,
  schema,
  schemaName: 'RequirementSpec',
  jsonSchema: {
    type: 'object', additionalProperties: false,
    properties: { workload: { type: 'string' } }, required: ['workload'],
  },
});

describe('deterministik model router', () => {
  it('kısa tek iş yükünü hızlı modele gönderiyor', () => {
    expect(routeStructuredRequest(request('2 web sunucusu istiyorum'), config)).toMatchObject({
      tier: 'fast', model: 'fast-model',
    });
  });

  it('çok bileşenli uzman talebi güçlü modele gönderiyor', () => {
    const decision = routeStructuredRequest(
      request('Kubernetes GPU H200 training cluster, PostgreSQL Redis database ve disaster recovery'),
      config,
    );
    expect(decision).toMatchObject({ tier: 'strong', model: 'strong-model' });
  });

  it('tool planını sinyale göre dengeli veya güçlü seçiyor', () => {
    expect(routeToolLoopRequest({ system: 'Tasarım', userMessage: 'web', tools: [] }, config).tier)
      .toBe('balanced');
    expect(routeToolLoopRequest({
      system: 'Kubernetes GPU migration', userMessage: 'H200 cluster', tools: [],
    }, config).tier).toBe('strong');
  });

  it('boş katman env değerlerini gerçek model adı saymıyor', () => {
    expect(modelRouterConfigFromEnv('openrouter', {
      OPENROUTER_MODEL: 'fallback', OPENROUTER_MODEL_FAST: '',
      OPENROUTER_MODEL_BALANCED: ' balanced ', OPENROUTER_MODEL_STRONG: ' ',
    })).toEqual({ fastModel: 'fallback', balancedModel: 'balanced', strongModel: 'fallback' });
  });

  it('anahtar model, prompt sürümü ve şemaya bağlı', () => {
    const decision = routeStructuredRequest(request('2 web sunucusu'), config);
    expect(structuredCacheKey(request('2 web sunucusu'), decision, 'v1'))
      .not.toBe(structuredCacheKey(request('2 web sunucusu'), decision, 'v2'));
  });
});

describe('güvenli yapısal önbellek', () => {
  const makeClient = (structured: LlmClient['structured']): LlmClient => ({
    structured,
    toolLoop: vi.fn(async () => ({ finalText: '', toolCalls: [] })),
    text: vi.fn(async () => ''),
  });

  it('ikinci birebir istekte sağlayıcıyı çağırmıyor ve sonucu yeniden doğruluyor', async () => {
    const values = new Map<string, unknown>();
    const cache: StructuredResponseCache = {
      get: vi.fn(async (key) => values.get(key) ?? null),
      put: vi.fn(async (entry) => { values.set(entry.cacheKey, entry.response); }),
    };
    const providerCall = vi.fn(async () => ({ workload: 'web' }));
    const routed = new RoutedLlm(config, () => makeClient(providerCall), { cache, promptVersion: 'v1' });

    await expect(routed.structured(request('2 web sunucusu'))).resolves.toEqual({ workload: 'web' });
    await expect(routed.structured(request('2 web sunucusu'))).resolves.toEqual({ workload: 'web' });
    expect(providerCall).toHaveBeenCalledTimes(1);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it('telefon gibi PII içeren isteği cache okumadan/yazmadan çalıştırıyor', async () => {
    const cache: StructuredResponseCache = {
      get: vi.fn(async () => null), put: vi.fn(async () => {}),
    };
    const providerCall = vi.fn(async () => ({ workload: 'web' }));
    const routed = new RoutedLlm(config, () => makeClient(providerCall), { cache });
    await routed.structured(request('+90 555 519 19 03 için 2 web sunucusu'));
    expect(providerCall).toHaveBeenCalledOnce();
    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('şemaya uymayan cache kaydını kullanmıyor', async () => {
    const cache: StructuredResponseCache = {
      get: vi.fn(async () => ({ wrong: true })), put: vi.fn(async () => {}),
    };
    const providerCall = vi.fn(async () => ({ workload: 'web' }));
    const routed = new RoutedLlm(config, () => makeClient(providerCall), { cache });
    await expect(routed.structured(request('2 web sunucusu'))).resolves.toEqual({ workload: 'web' });
    expect(providerCall).toHaveBeenCalledOnce();
  });
});
