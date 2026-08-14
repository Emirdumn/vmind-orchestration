/**
 * FAZ 5 — LLM erisim katmani
 *
 * Ajanlarin Claude'a dokundugu TEK yer. Arayuz arkasinda tutulmasinin iki sebebi:
 *
 *   1. TESTLENEBILIRLIK — Orchestrator, Reconciler ve Auditor'in kural tarafi
 *      LLM'siz calisir ve gercek API cagrisi olmadan test edilebilir.
 *   2. SORUMLULUK SINIRI — "LLM planlar, deterministik kod fiyatlar" kuralini
 *      mimari olarak zorlar: fiyat hesabi bu dosyanin altinda hicbir yerde yok.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import { DEFAULT_OPENROUTER_MODEL, OpenRouterLlm } from './llm-openrouter.js';
import { ToolLoopProgressGuard } from './tool-loop-guard.js';

/** Anthropic'in en yetenekli modeli; teklif dogrulugu maliyetten onemli. */
export const DEFAULT_MODEL = 'claude-opus-5';

export interface StructuredRequest<T extends z.ZodTypeAny> {
  system: string;
  userMessage: string;
  /**
   * Calisma zamani dogrulamasinin TEK kaynagi. Model ciktisi API tarafinda
   * `jsonSchema` ile kisitlanir, sonra burada Zod ile ayrica dogrulanir —
   * ikisinin sapmasi durumunda Zod kazanir.
   */
  schema: T;
  /**
   * API'ye gonderilecek JSON Schema. Zod'dan otomatik uretilmiyor:
   * projede Zod 3 var, SDK'nin zod yardimcisi Zod 4 bekliyor. Elle yazmak
   * ayrica alan aciklamalarini korur (model ciktisini bunlar yonlendiriyor).
   */
  jsonSchema: Record<string, unknown> & { type: 'object' };
  schemaName: string;
  maxTokens?: number;
}

/** Claude'un bekledigi tool girdi semasi: kok her zaman `object`. */
export interface ToolInputSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
}

export interface ToolLoopRequest {
  system: string;
  userMessage: string;
  /** Tool tanimlari (JSON Schema). */
  tools: ToolDefinition[];
  /** Tool cagrisini yurutur. Hata firlatirsa ajana metin olarak doner. */
  runTool: (name: string, input: unknown) => Promise<unknown>;
  maxTokens?: number;
  /** Sonsuz dongu korumasi. */
  maxIterations?: number;
  /** Ayni tool+girdi bu sayidan fazla tekrarlanirsa gercek dongu kabul edilir. */
  maxRepeatedToolCalls?: number;
}

export interface ToolLoopResult {
  finalText: string;
  toolCalls: Array<{ name: string; input: unknown; ok: boolean; error?: string }>;
}

/**
 * FAZ 7.B — token/maliyet takibi.
 *
 * Saglayicilar farkli alan adlari kullaniyor (`prompt_tokens` vs
 * `input_tokens`); adaptorler bunu normalize edip buraya bildirir.
 * `AuditTrail.llmUsage` bu sekli bekliyor.
 */
export interface UsageReport {
  inputTokens: number;
  outputTokens: number;
  /** Saglayici bildirdiyse. HESAPLANMAZ, uydurulmaz. */
  costUsd?: number;
  cacheReadTokens?: number;
  model: string;
  /** Uygulama model router'ı kullandıysa seçilen katman ve deterministik gerekçe. */
  routeTier?: 'fast' | 'balanced' | 'strong';
  routeReason?: string;
}

export type UsageSink = (usage: UsageReport) => void;

export interface LlmClient {
  /** Semaya UYGUN cikti zorunlu — serbest metin kabul edilmez. */
  structured<T extends z.ZodTypeAny>(request: StructuredRequest<T>): Promise<z.infer<T>>;
  /** Tool cagrili dongu; ajan yalnizca verilen tool'lari kullanabilir. */
  toolLoop(request: ToolLoopRequest): Promise<ToolLoopResult>;
  /** Kisa serbest metin (Auditor'in Turkce ozeti gibi). */
  text(request: { system: string; userMessage: string; maxTokens?: number }): Promise<string>;
}

export class MissingCredentialsError extends Error {
  constructor() {
    super(
      'LLM kimlik bilgisi bulunamadi. Su ikisinden BIRI yeterli:\n' +
        '  OPENROUTER_API_KEY  (openrouter.ai/keys)\n' +
        '  ANTHROPIC_API_KEY   (console.anthropic.com)\n\n' +
        'NOT: VMind API anahtari BASKA bir seydir ve zaten calisiyor — bu anahtar\n' +
        'dogal dili anlayan model icin gerekli, katalog/fiyat icin degil.\n\n' +
        'Deterministik katmanlar (kural motoru, fiyat motoru, Reconciler,\n' +
        'Orchestrator akisi) bu anahtar olmadan da calisir ve test edilir.',
    );
    this.name = 'MissingCredentialsError';
  }
}

/**
 * Model ciktisindan JSON cozer.
 *
 * `strict: true` gonderilse bile bazi modeller (ozellikle OpenAI-uyumlu
 * ucuncu taraf uclari) ciktiyi ```json blogu icine sariyor. Bu, canli
 * calistirmada tespit edildi — JSON tamamen gecerliydi, yalnizca sarilmisti.
 *
 * Cit temizligi TOLERANS degil bicim duzeltmesidir: JSON'un ICERIGI
 * degistirilmiyor. Semaya uymayan cikti bir sonraki adimda Zod tarafindan
 * yine reddedilir.
 */
export function parseModelJson(raw: string): unknown {
  let text = raw.trim();

  // ```json ... ```  veya  ``` ... ```
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(text);
  if (fenced?.[1] !== undefined) text = fenced[1].trim();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Model gecerli JSON uretmedi: ${text.slice(0, 300)}`);
  }
}

/** Hangi saglayicinin kullanildigi — loglama ve rapor icin. */
export type LlmProvider = 'openrouter' | 'anthropic';

export interface LlmSelection {
  client: LlmClient;
  provider: LlmProvider;
  model: string;
}

/**
 * Ortamdan uygun saglayiciyi secer.
 *
 * OpenRouter once denenir: tanimliysa kullanicinin acik tercihi odur.
 * Ikisi de yoksa `MissingCredentialsError` firlatir — hangi anahtarin
 * eksik oldugunu ve VMind anahtariyla karistirilmamasi gerektigini soyler.
 */
export function createLlm(options: { model?: string; onUsage?: UsageSink } = {}): LlmSelection {
  if (process.env['OPENROUTER_API_KEY']) {
    const model =
      options.model ?? process.env['OPENROUTER_MODEL'] ?? DEFAULT_OPENROUTER_MODEL;
    return {
      client: new OpenRouterLlm({ model, ...(options.onUsage ? { onUsage: options.onUsage } : {}) }),
      provider: 'openrouter',
      model,
    };
  }

  if (process.env['ANTHROPIC_API_KEY'] || process.env['ANTHROPIC_AUTH_TOKEN']) {
    const model = options.model ?? process.env['ANTHROPIC_MODEL'] ?? DEFAULT_MODEL;
    return {
      client: new AnthropicLlm({ model, ...(options.onUsage ? { onUsage: options.onUsage } : {}) }),
      provider: 'anthropic',
      model,
    };
  }

  throw new MissingCredentialsError();
}

export class AnthropicLlm implements LlmClient {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly onUsage: UsageSink | undefined;

  constructor(options: { model?: string; client?: Anthropic; onUsage?: UsageSink } = {}) {
    this.model = options.model ?? DEFAULT_MODEL;
    // Anahtar yoksa SDK ortamdan cozer (ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / profil).
    this.client = options.client ?? new Anthropic();
    this.onUsage = options.onUsage;
  }

  /**
   * FAZ 7.B: kullanim bildirimi. Anthropic maliyet DONDURMEZ — yalnizca token.
   * Maliyet uydurulmaz; `costUsd` bos birakilir.
   */
  private reportUsage(response: { usage?: Anthropic.Usage; model?: string }): void {
    if (!this.onUsage || !response.usage) return;
    const u = response.usage;
    this.onUsage({
      model: response.model ?? this.model,
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      ...(u.cache_read_input_tokens !== null && u.cache_read_input_tokens !== undefined
        ? { cacheReadTokens: u.cache_read_input_tokens }
        : {}),
    });
  }

  async structured<T extends z.ZodTypeAny>(request: StructuredRequest<T>): Promise<z.infer<T>> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: request.maxTokens ?? 16000,
      // Karmasik cikarim: modelin ne kadar dusunecegine kendisi karar versin.
      thinking: { type: 'adaptive' },
      system: request.system,
      messages: [{ role: 'user', content: request.userMessage }],
      output_config: { format: { type: 'json_schema', schema: request.jsonSchema } },
    });
    this.reportUsage(response);

    if (response.stop_reason === 'refusal') {
      throw new Error(`Model istegi reddetti: ${response.stop_details?.explanation ?? 'gerekce yok'}`);
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error('Model ciktisi max_tokens sinirinda kesildi; JSON eksik.');
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    // Son soz Zod'un: API semasi ile Zod semasi ayrisirsa burada patlar,
    // sessizce yanlis sekilli bir spec asagi akmaz.
    return request.schema.parse(parseModelJson(text)) as z.infer<T>;
  }

  async toolLoop(request: ToolLoopRequest): Promise<ToolLoopResult> {
    const maxIterations = request.maxIterations ?? 20;
    const progress = new ToolLoopProgressGuard(request.maxRepeatedToolCalls ?? 3);
    const toolCalls: ToolLoopResult['toolCalls'] = [];
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: request.userMessage }];
    let finalText = '';

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: request.maxTokens ?? 16000,
        thinking: { type: 'adaptive' },
        system: request.system,
        tools: request.tools,
        messages,
      });
      this.reportUsage(response);

      if (response.stop_reason === 'refusal') {
        throw new Error(`Model istegi reddetti: ${response.stop_details?.explanation ?? 'gerekce yok'}`);
      }

      // Sunucu tarafli tool dongusu duraklarsa ayni gecmisle devam et.
      if (response.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content });
        continue;
      }

      for (const block of response.content) {
        if (block.type === 'text') finalText += block.text;
      }

      const toolUses = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );
      if (toolUses.length === 0) return { finalText, toolCalls };

      messages.push({ role: 'assistant', content: response.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        progress.record(use.name, use.input);
        try {
          const output = await request.runTool(use.name, use.input);
          toolCalls.push({ name: use.name, input: use.input, ok: true });
          results.push({
            type: 'tool_result',
            tool_use_id: use.id,
            content: JSON.stringify(output),
          });
        } catch (error) {
          // Reddedilme ajana METIN olarak doner ki nedenini gorup duzeltebilsin.
          const message = `${(error as Error).name}: ${(error as Error).message}`;
          toolCalls.push({ name: use.name, input: use.input, ok: false, error: message });
          results.push({
            type: 'tool_result',
            tool_use_id: use.id,
            content: message,
            is_error: true,
          });
        }
      }
      messages.push({ role: 'user', content: results });
    }

    throw new Error(
      `Tool akisi ${maxIterations} turda tamamlanmadi; ${toolCalls.length} tool cagrisi yapildi. ` +
        'Ayni cagri tekrari yoksa istek bu tur butcesinden daha buyuk olabilir.',
    );
  }

  async text(request: { system: string; userMessage: string; maxTokens?: number }): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: request.maxTokens ?? 4000,
      system: request.system,
      messages: [{ role: 'user', content: request.userMessage }],
    });
    this.reportUsage(response);
    if (response.stop_reason === 'refusal') {
      throw new Error(`Model istegi reddetti: ${response.stop_details?.explanation ?? 'gerekce yok'}`);
    }
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
  }
}
