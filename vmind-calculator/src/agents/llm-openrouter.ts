/**
 * FAZ 5 — OpenRouter LLM adaptoru
 *
 * `LlmClient` arayuzunun ikinci uygulamasi. Ajanlarin (Extractor, Designer,
 * Auditor) hicbiri degismedi — LLM erisimini arayuz arkasina koymanin sebebi
 * tam olarak buydu.
 *
 * OpenRouter OpenAI-UYUMLU bir yuzey sunar; Anthropic'in yuzeyi degil.
 * Farklar ve nasil eslendikleri:
 *
 *   | Anthropic                     | OpenRouter (OpenAI-uyumlu)                    |
 *   |-------------------------------|-----------------------------------------------|
 *   | `system` ayri alan            | `messages[0] = {role:'system'}`               |
 *   | `output_config.format`        | `response_format.json_schema`                 |
 *   | `thinking:{type:'adaptive'}`  | `reasoning:{effort:'high'}`                   |
 *   | `content[].type==='tool_use'` | `message.tool_calls[].function`               |
 *   | tool girdisi nesne            | `function.arguments` JSON **string**          |
 *   | `{type:'tool_result'}` blogu  | `{role:'tool', tool_call_id, content}`        |
 *
 * SDK yerine `fetch` kullaniliyor: projede zaten `src/platform/api-client.ts`
 * boyle calisiyor ve tek bir uc nokta icin ek bagimlilik gereksiz.
 */
import type { z } from 'zod';
import { parseModelJson } from './llm.js';
import { ToolLoopProgressGuard } from './tool-loop-guard.js';
import type {
  LlmClient,
  StructuredRequest,
  ToolLoopRequest,
  ToolLoopResult,
  UsageSink,
} from './llm.js';

/** Anthropic'teki `claude-opus-5` ile ayni model, ayni fiyat ($5/$25 per MTok). */
export const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-opus-5';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

/** Test edilebilirlik icin enjekte edilebilir. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export interface OpenRouterOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  /** OpenRouter siralama basliklari — opsiyonel. */
  appName?: string;
  appUrl?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /**
   * `reasoning` parametresi. `null` verilirse HIC gonderilmez.
   *
   * Her OpenRouter modeli bu parametreyi desteklemiyor; desteklemeyen bir
   * modele gonderilmesi istegi bozabilir. Model degistirilecekse
   * /api/v1/models ciktisindaki `supported_parameters` kontrol edilmeli.
   */
  reasoningEffort?: ReasoningEffort | null;
  /**
   * FAZ 7.B — her cagrinin token kullanimi buraya bildirilir.
   * Genelde `(u) => auditTrail.llmUsage({provider:'openrouter', ...u})`.
   */
  onUsage?: UsageSink;
  /**
   * Ajanlarin istedigi `max_tokens` degerinin ust siniri.
   *
   * OpenRouter `max_tokens`'a gore ON PROVIZYON alir: kredi gercek yanit icin
   * yetse bile istenen tavan icin yetmiyorsa istek HTTP 402 ile reddedilir.
   * Dusuk kredili hesaplarda bu siniri dusurmek gerekir.
   */
  maxTokensCap?: number;
}

export class OpenRouterError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`OpenRouter HTTP ${status}: ${body.slice(0, 400)}`);
    this.name = 'OpenRouterError';
  }
}

/**
 * Kredi yetersizligi (HTTP 402) — cok sik karsilasilan ve ciplak haliyle
 * yanlis teshis edilen durum.
 *
 * OpenRouter `max_tokens`'a gore ON PROVIZYON alir. Yani asil yanit 500 token
 * olsa bile, `max_tokens: 16000` istedigimizde kredinin 16000 token'i
 * karsilamasi gerekir. "Kredi var ama istek reddediliyor" gorunumu buradan
 * gelir; cozum ya kredi eklemek ya OPENROUTER_MAX_TOKENS'i dusurmektir.
 */
export class InsufficientCreditsError extends OpenRouterError {
  constructor(body: string, requestedMaxTokens: number) {
    super(402, body);
    this.name = 'InsufficientCreditsError';
    const affordable = /can only afford (\d+)/.exec(body)?.[1];
    this.message =
      `OpenRouter kredisi yetersiz. ${requestedMaxTokens} token tavan istendi` +
      (affordable ? `, kredi yalnizca ${affordable} token'a yetiyor.` : '.') +
      '\n\nOpenRouter max_tokens uzerinden ON PROVIZYON alir: gercek yanit kisa olsa' +
      '\nbile istenen TAVAN icin kredi gerekir. Iki cozum:' +
      '\n  1) openrouter.ai/settings/credits adresinden kredi ekleyin (onerilen)' +
      '\n  2) OPENROUTER_MAX_TOKENS ile tavani dusurun — ancak dusuk tavan' +
      '\n     structured output JSON\'unu yarida kesebilir.';
  }
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

interface ChatResponse {
  choices?: Array<{
    /** OpenAI-uyumlu deger: 'stop' | 'length' | 'tool_calls' | ... */
    finish_reason?: string;
    /**
     * Saglayicinin KENDI degeri, oldugu gibi. Anthropic burada 'max_tokens'
     * yaziyor — OpenAI'nin 'length' degeri her zaman gelmiyor.
     */
    native_finish_reason?: string;
    message?: ChatMessage;
  }>;
  /** OpenAI-uyumlu kullanim bloku. `cost` yalnizca istenirse doner. */
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  model?: string;
  error?: { message?: string; code?: number };
}

/**
 * "Structured output bu workspace/saglayici icin yok" hatasini tanir.
 *
 * OpenRouter bunu farkli sekillerde bildiriyor (workspace kisiti, saglayici
 * kisiti, desteklenmeyen parametre) — hepsi ayni geri dususe gider.
 */
/**
 * Yanit token siniri yuzunden mi kesildi?
 *
 * Iki alan da kontrol edilir: OpenAI-uyumlu `finish_reason` ('length') ve
 * saglayicinin ham degeri `native_finish_reason` (Anthropic: 'max_tokens').
 * Yalnizca ilkine bakmak, kesilmis ciktinin "gecersiz JSON" olarak
 * raporlanmasina yol aciyor.
 */
function isTruncated(choice: { finish_reason?: string; native_finish_reason?: string } | undefined): boolean {
  if (!choice) return false;
  const values = [choice.finish_reason, choice.native_finish_reason].filter(
    (v): v is string => typeof v === 'string',
  );
  return values.some((v) => v === 'length' || v === 'max_tokens' || v === 'MAX_TOKENS');
}

function isStructuredOutputUnsupported(error: unknown): boolean {
  if (!(error instanceof OpenRouterError)) return false;
  if (error.status !== 400) return false;
  const body = error.body.toLowerCase();
  return (
    body.includes('structured_outputs') ||
    body.includes('response_format') ||
    body.includes('json_schema')
  );
}

export class OpenRouterLlm implements LlmClient {
  /**
   * Structured output desteklenmedigi icin prompt-tabanli geri dususe
   * gecildiyse true. Rapora yazilir — "sema API tarafinda zorlanmadi"
   * bilgisi sessiz kalmamali.
   */
  structuredFallbackUsed = false;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly appName: string;
  private readonly appUrl: string;
  private readonly reasoningEffort: ReasoningEffort | null;
  private readonly maxTokensCap: number;
  private readonly onUsage: UsageSink | undefined;

  constructor(options: OpenRouterOptions = {}) {
    const key = options.apiKey ?? process.env['OPENROUTER_API_KEY'];
    if (!key) {
      throw new Error(
        'OPENROUTER_API_KEY tanimli degil. openrouter.ai/keys adresinden anahtar alip ' +
          '`setx OPENROUTER_API_KEY "sk-or-..."` ile tanimlayin.',
      );
    }
    this.apiKey = key;
    this.model = options.model ?? process.env['OPENROUTER_MODEL'] ?? DEFAULT_OPENROUTER_MODEL;
    this.baseUrl = options.baseUrl ?? process.env['OPENROUTER_BASE_URL'] ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    const envTimeout = Number(process.env['OPENROUTER_TIMEOUT_MS']);
    this.timeoutMs =
      options.timeoutMs ??
      (Number.isFinite(envTimeout) && envTimeout >= 5_000 ? envTimeout : 45_000);
    this.appName = options.appName ?? 'VMind Teklif Ajani';
    this.appUrl = options.appUrl ?? 'https://calculator.portvmind.com';

    this.reasoningEffort =
      options.reasoningEffort !== undefined
        ? options.reasoningEffort
        : ((process.env['OPENROUTER_REASONING'] as ReasoningEffort | undefined) ?? 'high');

    const envCap = Number(process.env['OPENROUTER_MAX_TOKENS']);
    this.maxTokensCap =
      options.maxTokensCap ?? (Number.isFinite(envCap) && envCap > 0 ? envCap : 16000);

    this.onUsage = options.onUsage;
  }

  /** Ajanin istedigi tavani kredi/model sinirina gore kirpar. */
  private cap(requested: number | undefined, fallback: number): number {
    return Math.min(requested ?? fallback, this.maxTokensCap);
  }

  /** `reasoning` yalnizca yapilandirildiysa gonderilir. */
  private reasoning(): Record<string, unknown> {
    return this.reasoningEffort ? { reasoning: { effort: this.reasoningEffort } } : {};
  }

  /**
   * OpenRouter varsayilan olarak ucuz saglayicilari agirliklandirir. Bu bir
   * musteri telefonu sirasinda kullanilan arayuz; burada ilk oncelik gecikme.
   */
  private provider(requireParameters = false): Record<string, unknown> {
    return {
      sort: 'latency',
      allow_fallbacks: true,
      ...(requireParameters ? { require_parameters: true } : {}),
    };
  }

  private async chat(body: Record<string, unknown>): Promise<ChatResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': this.appUrl,
        'X-Title': this.appName,
      },
      // `usage: {include: true}` OLMADAN OpenRouter maliyet DONDURMEZ.
      // Bunu istemek bedava ve bütçe takibinin tek gerçek kaynağı — tahmini
      // maliyet hesaplamak yerine sağlayıcının bildirdiği rakam kullanılıyor.
      body: JSON.stringify({ model: this.model, usage: { include: true }, ...body }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const text = await response.text();
    if (response.status === 402) {
      throw new InsufficientCreditsError(text, Number(body['max_tokens']) || 0);
    }
    if (!response.ok) throw new OpenRouterError(response.status, text);

    const json = JSON.parse(text) as ChatResponse;
    // OpenRouter 200 dondurup govdede hata bildirebiliyor.
    if (json.error) throw new OpenRouterError(json.error.code ?? 200, json.error.message ?? 'bilinmeyen hata');
    this.reportUsage(json);
    return json;
  }

  /** FAZ 7.B: kullanim varsa bildir. Yoksa sessizce atla — uydurma sayi yazmayiz. */
  private reportUsage(json: ChatResponse): void {
    if (!this.onUsage || !json.usage) return;
    const u = json.usage;
    this.onUsage({
      model: json.model ?? this.model,
      inputTokens: u.prompt_tokens ?? 0,
      outputTokens: u.completion_tokens ?? 0,
      ...(u.cost !== undefined ? { costUsd: u.cost } : {}),
      ...(u.prompt_tokens_details?.cached_tokens !== undefined
        ? { cacheReadTokens: u.prompt_tokens_details.cached_tokens }
        : {}),
    });
  }

  async structured<T extends z.ZodTypeAny>(request: StructuredRequest<T>): Promise<z.infer<T>> {
    const messages = [
      { role: 'system' as const, content: request.system },
      { role: 'user' as const, content: request.userMessage },
    ];
    const initialMaxTokens = this.cap(request.maxTokens, 16000);
    let fallbackUsedForRequest = false;

    const runAttempt = async (maxTokens: number): Promise<ChatResponse> => {
      if (!fallbackUsedForRequest) {
        try {
          return await this.chat({
            max_tokens: maxTokens,
            ...this.reasoning(),
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: request.schemaName,
                // strict: model semadan sapamaz — "sessiz varsayim yok" kuralinin
                // API seviyesindeki karsiligi.
                strict: true,
                schema: request.jsonSchema,
              },
            },
            // Yalnizca response_format'i DESTEKLEYEN saglayicilara yonlendir.
            // Bu olmadan OpenRouter istegi desteklemeyen bir saglayiciya (orn.
            // Azure) atabiliyor ve 400 aliyoruz.
            provider: this.provider(true),
            messages,
          });
        } catch (error) {
          if (!isStructuredOutputUnsupported(error)) throw error;
          fallbackUsedForRequest = true;
          this.structuredFallbackUsed = true;
        }
      }

      // GERI DUSUS: structured output yoksa semayi PROMPT'a koyup Zod ile
      // dogrula. Garanti zayiflamiyor — semadan sapan cikti yine reddedilir;
      // yalnizca model kisitlanmadigi icin daha sik hata yapabilir.
      return this.chat({
        max_tokens: maxTokens,
        ...this.reasoning(),
        provider: this.provider(),
        messages: [
          messages[0]!,
          {
            role: 'user' as const,
            content:
              `${request.userMessage}\n\n` +
              `Yanitini SADECE asagidaki JSON Schema'ya uyan bir JSON nesnesi olarak ver. ` +
              `Aciklama, markdown citi veya baska metin YAZMA.\n\n` +
              JSON.stringify(request.jsonSchema),
          },
        ],
      });
    };

    let usedMaxTokens = initialMaxTokens;
    let json = await runAttempt(usedMaxTokens);
    let choice = json.choices?.[0];

    // Kisa/ucuz ilk deneme kesilirse ayni istegi bir kez daha genis butceyle
    // calistir. Retry yalnizca truncation icindir; sema/API hatalarini gizlemez.
    // Ortam tavani son soz olmaya devam eder ve OpenRouter on provizyonunu korur.
    if (isTruncated(choice)) {
      const retryMaxTokens = Math.min(
        Math.max(initialMaxTokens * 2, 8000),
        this.maxTokensCap,
      );
      if (retryMaxTokens > initialMaxTokens) {
        usedMaxTokens = retryMaxTokens;
        json = await runAttempt(usedMaxTokens);
        choice = json.choices?.[0];
      }
    }

    // Kesilme tespiti: OpenAI'nin 'length' degeri her saglayicidan gelmiyor.
    // Anthropic `native_finish_reason: 'max_tokens'` yaziyor. Bu ayrimi
    // atlamak, kesilmis JSON'u "gecersiz JSON" diye raporlamaya yol aciyor —
    // gelistirici token limiti yerine sema hatasi arar. Canli eval'de yasandi.
    if (isTruncated(choice)) {
      throw new Error(
        `Model ciktisi token sinirinda kesildi (max_tokens=${usedMaxTokens}); JSON eksik. ` +
          `Ilk ajan limiti ${initialMaxTokens}, ortam tavani ${this.maxTokensCap}. ` +
          'Hem ajan maxTokens degerini hem OPENROUTER_MAX_TOKENS tavanini kontrol edin.',
      );
    }

    const content = choice?.message?.content;
    if (!content) throw new Error('Model bos yanit dondu.');

    // Son soz Zod'un — API semasi ile Zod semasi ayrisirsa burada patlar.
    return request.schema.parse(parseModelJson(content)) as z.infer<T>;
  }

  async toolLoop(request: ToolLoopRequest): Promise<ToolLoopResult> {
    const maxIterations = request.maxIterations ?? 20;
    const progress = new ToolLoopProgressGuard(request.maxRepeatedToolCalls ?? 3);
    const toolCalls: ToolLoopResult['toolCalls'] = [];
    const messages: ChatMessage[] = [
      { role: 'system', content: request.system },
      { role: 'user', content: request.userMessage },
    ];
    let finalText = '';

    const tools = request.tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const json = await this.chat({
        max_tokens: this.cap(request.maxTokens, 16000),
        ...this.reasoning(),
        provider: this.provider(),
        tools,
        messages,
      });

      const message = json.choices?.[0]?.message;
      if (!message) throw new Error('Model bos yanit dondu.');

      if (message.content) finalText += message.content;

      const calls = message.tool_calls ?? [];
      if (calls.length === 0) return { finalText, toolCalls };

      messages.push(message);

      for (const call of calls) {
        // OpenAI-uyumlu yuzeyde argumanlar JSON STRING olarak gelir.
        let input: unknown;
        try {
          input = JSON.parse(call.function.arguments || '{}');
        } catch {
          const error = `Tool argumanlari gecerli JSON degil: ${call.function.arguments.slice(0, 200)}`;
          toolCalls.push({ name: call.function.name, input: call.function.arguments, ok: false, error });
          messages.push({ role: 'tool', tool_call_id: call.id, content: error });
          continue;
        }

        progress.record(call.function.name, input);

        try {
          const output = await request.runTool(call.function.name, input);
          toolCalls.push({ name: call.function.name, input, ok: true });
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
        } catch (error) {
          // Reddedilme ajana METIN olarak doner ki nedenini gorup duzeltebilsin.
          const text = `${(error as Error).name}: ${(error as Error).message}`;
          toolCalls.push({ name: call.function.name, input, ok: false, error: text });
          messages.push({ role: 'tool', tool_call_id: call.id, content: text });
        }
      }
    }

    throw new Error(
      `Tool akisi ${maxIterations} turda tamamlanmadi; ${toolCalls.length} tool cagrisi yapildi. ` +
        'Ayni cagri tekrari yoksa istek bu tur butcesinden daha buyuk olabilir.',
    );
  }

  /**
   * Kisa serbest metin.
   *
   * `reasoning` BILEREK gonderilmiyor: bu yolu yalnizca Auditor'in Turkce
   * ozeti/baglamsal notu kullaniyor ve o hafif bir gorev. Derin dusunme
   * eklemek maliyeti ve gecikmeyi bosa cikarirdi.
   */
  async text(request: { system: string; userMessage: string; maxTokens?: number }): Promise<string> {
    const json = await this.chat({
      max_tokens: this.cap(request.maxTokens, 4000),
      provider: this.provider(),
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.userMessage },
      ],
    });
    return json.choices?.[0]?.message?.content ?? '';
  }
}
