/**
 * OpenRouter adaptoru — istek sekli ve yanit cozumleme testleri.
 *
 * `fetch` enjekte edilebilir oldugu icin bu testler AG'A CIKMAZ ve anahtar
 * istemez. Test edilen sey: Anthropic yuzeyinden OpenAI-uyumlu yuzeye
 * eslemenin dogru yapildigi — ozellikle tool argumanlarinin JSON *string*
 * olarak gelmesi, ki bu en kolay gozden kacan fark.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  InsufficientCreditsError,
  OpenRouterError,
  OpenRouterLlm,
  type FetchLike,
} from '../src/agents/llm-openrouter.js';

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Sirayla verilen yanitlari donduren sahte fetch; istekleri kaydeder. */
function fakeFetch(responses: unknown[]): { fetchImpl: FetchLike; requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  let index = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    requests.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string) as Record<string, unknown>,
    });
    const payload = responses[Math.min(index++, responses.length - 1)];
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  return { fetchImpl, requests };
}

const chatReply = (content: string) => ({
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }],
});

const makeLlm = (fetchImpl: FetchLike) =>
  new OpenRouterLlm({ apiKey: 'sk-or-test', model: 'anthropic/claude-opus-5', fetchImpl });

describe('OpenRouter — istemci kurulumu', () => {
  it('anahtar yoksa anlamli hata veriyor', () => {
    const saved = process.env['OPENROUTER_API_KEY'];
    delete process.env['OPENROUTER_API_KEY'];
    expect(() => new OpenRouterLlm()).toThrow(/OPENROUTER_API_KEY/);
    if (saved !== undefined) process.env['OPENROUTER_API_KEY'] = saved;
  });

  it('dogru uc noktaya, Bearer basligiyla gidiyor', async () => {
    const { fetchImpl, requests } = fakeFetch([chatReply('merhaba')]);
    await makeLlm(fetchImpl).text({ system: 's', userMessage: 'u' });

    expect(requests[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(requests[0]!.headers['Authorization']).toBe('Bearer sk-or-test');
    expect(requests[0]!.body['model']).toBe('anthropic/claude-opus-5');
  });

  it('HTTP hatasi tipli hataya cevriliyor', async () => {
    const fetchImpl: FetchLike = async () => new Response('{"error":"nope"}', { status: 402 });
    await expect(makeLlm(fetchImpl).text({ system: 's', userMessage: 'u' })).rejects.toThrow(
      OpenRouterError,
    );
  });

  it('200 dondurup govdede hata bildirilirse de yakalaniyor', async () => {
    const { fetchImpl } = fakeFetch([{ error: { code: 429, message: 'rate limited' } }]);
    await expect(makeLlm(fetchImpl).text({ system: 's', userMessage: 'u' })).rejects.toThrow(
      /rate limited/,
    );
  });
});

describe('OpenRouter — kredi yetersizligi (HTTP 402)', () => {
  // Ciplak 402 "kredim var ama calismiyor" gibi gorunuyor; asil sebep
  // max_tokens uzerinden ON PROVIZYON alinmasi. Mesaj bunu anlatmali.
  const creditFetch: FetchLike = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: 402,
          message:
            'This request requires more credits, or fewer max_tokens. You requested up to 16000 tokens, but can only afford 467.',
        },
      }),
      { status: 402 },
    );

  it('tipli InsufficientCreditsError firlatiyor', async () => {
    await expect(makeLlm(creditFetch).text({ system: 's', userMessage: 'u' })).rejects.toThrow(
      InsufficientCreditsError,
    );
  });

  it('mesaj on provizyon mekanigini ve iki cozumu aciklıyor', async () => {
    let message = '';
    try {
      await makeLlm(creditFetch).text({ system: 's', userMessage: 'u' });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('ON PROVIZYON');
    expect(message).toContain('467');
    expect(message).toContain('credits');
    expect(message).toContain('OPENROUTER_MAX_TOKENS');
  });
});

describe('OpenRouter — reasoning ve max_tokens esnekligi', () => {
  const schema = z.object({ ok: z.boolean() });
  const structuredRequest = {
    system: 's',
    userMessage: 'u',
    schema,
    jsonSchema: {
      type: 'object' as const,
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    },
    schemaName: 'T',
  };

  it('reasoningEffort null verilirse reasoning HIC gonderilmiyor', async () => {
    // Her OpenRouter modeli bu parametreyi desteklemiyor; desteklemeyen bir
    // modele gonderilmesi istegi bozabilir.
    const { fetchImpl, requests } = fakeFetch([chatReply('{"ok":true}')]);
    const llm = new OpenRouterLlm({
      apiKey: 'sk-or-test',
      model: 'bir/model:free',
      reasoningEffort: null,
      fetchImpl,
    });
    await llm.structured(structuredRequest);
    expect(requests[0]!.body).not.toHaveProperty('reasoning');
  });

  it('reasoningEffort ayarlanabiliyor', async () => {
    const { fetchImpl, requests } = fakeFetch([chatReply('{"ok":true}')]);
    const llm = new OpenRouterLlm({ apiKey: 'sk-or-test', reasoningEffort: 'low', fetchImpl });
    await llm.structured(structuredRequest);
    expect(requests[0]!.body['reasoning']).toEqual({ effort: 'low' });
  });

  it('text() BILEREK reasoning gondermiyor — hafif gorev', async () => {
    // Bu yolu yalnizca Auditor'in kisa Turkce ozeti kullaniyor.
    const { fetchImpl, requests } = fakeFetch([chatReply('ozet')]);
    const llm = new OpenRouterLlm({ apiKey: 'sk-or-test', reasoningEffort: 'high', fetchImpl });
    await llm.text({ system: 's', userMessage: 'u' });
    expect(requests[0]!.body).not.toHaveProperty('reasoning');
  });

  it('maxTokensCap ajanin istedigi tavani kirpiyor', async () => {
    const { fetchImpl, requests } = fakeFetch([chatReply('ok')]);
    const llm = new OpenRouterLlm({ apiKey: 'sk-or-test', maxTokensCap: 500, fetchImpl });
    await llm.text({ system: 's', userMessage: 'u', maxTokens: 9000 });
    expect(requests[0]!.body['max_tokens']).toBe(500);
  });

  it('cap istenen degerden buyukse istenen deger korunuyor', async () => {
    const { fetchImpl, requests } = fakeFetch([chatReply('ok')]);
    const llm = new OpenRouterLlm({ apiKey: 'sk-or-test', maxTokensCap: 20000, fetchImpl });
    await llm.text({ system: 's', userMessage: 'u', maxTokens: 3000 });
    expect(requests[0]!.body['max_tokens']).toBe(3000);
  });
});

describe('OpenRouter — structured output', () => {
  const schema = z.object({ count: z.number(), unknowns: z.array(z.string()) });
  const jsonSchema = {
    type: 'object' as const,
    properties: { count: { type: 'number' }, unknowns: { type: 'array', items: { type: 'string' } } },
    required: ['count', 'unknowns'],
    additionalProperties: false,
  };

  const request = {
    system: 'sistem',
    userMessage: 'kullanici',
    schema,
    jsonSchema,
    schemaName: 'Test',
  };

  it('system ayri alan degil, ilk mesaj olarak gidiyor (OpenAI-uyumlu)', async () => {
    const { fetchImpl, requests } = fakeFetch([chatReply('{"count":4,"unknowns":[]}')]);
    await makeLlm(fetchImpl).structured(request);

    const messages = requests[0]!.body['messages'] as Array<{ role: string; content: string }>;
    expect(messages[0]).toEqual({ role: 'system', content: 'sistem' });
    expect(messages[1]).toEqual({ role: 'user', content: 'kullanici' });
    expect(requests[0]!.body['system']).toBeUndefined();
  });

  it('response_format.json_schema strict:true ile gonderiliyor', async () => {
    const { fetchImpl, requests } = fakeFetch([chatReply('{"count":4,"unknowns":[]}')]);
    await makeLlm(fetchImpl).structured(request);

    const format = requests[0]!.body['response_format'] as {
      type: string;
      json_schema: { name: string; strict: boolean; schema: unknown };
    };
    expect(format.type).toBe('json_schema');
    expect(format.json_schema.strict).toBe(true);
    expect(format.json_schema.name).toBe('Test');
    expect(format.json_schema.schema).toEqual(jsonSchema);
  });

  it('reasoning parametresi gonderiliyor (Anthropic thinking karsiligi)', async () => {
    const { fetchImpl, requests } = fakeFetch([chatReply('{"count":1,"unknowns":[]}')]);
    await makeLlm(fetchImpl).structured(request);
    expect(requests[0]!.body['reasoning']).toEqual({ effort: 'high' });
  });

  it('sonuc Zod ile DE dogrulaniyor — semadan sapan cikti reddediliyor', async () => {
    // API strict semayi zorlasa bile son soz Zod'un.
    const { fetchImpl } = fakeFetch([chatReply('{"count":"dort","unknowns":[]}')]);
    await expect(makeLlm(fetchImpl).structured(request)).rejects.toThrow();
  });

  it('gecersiz JSON anlamli hata veriyor', async () => {
    const { fetchImpl } = fakeFetch([chatReply('bu JSON degil')]);
    await expect(makeLlm(fetchImpl).structured(request)).rejects.toThrow(/gecerli JSON uretmedi/);
  });

  it('```json bloguna sarili cikti cozuluyor', async () => {
    // Canli calistirmada tespit edildi: strict:true gonderilse bile bazi
    // modeller ciktiyi markdown citiyle sariyor.
    const { fetchImpl } = fakeFetch([
      chatReply('```json\n{"count":7,"unknowns":["disk boyutu?"]}\n```'),
    ]);
    const result = await makeLlm(fetchImpl).structured(request);
    expect(result.count).toBe(7);
    expect(result.unknowns).toEqual(['disk boyutu?']);
  });

  it('dil etiketi olmayan cit de cozuluyor', async () => {
    const { fetchImpl } = fakeFetch([chatReply('```\n{"count":1,"unknowns":[]}\n```')]);
    expect((await makeLlm(fetchImpl).structured(request)).count).toBe(1);
  });

  it('cit temizligi TOLERANS degil — sema disi cikti yine reddediliyor', async () => {
    // Sarilmis olsa bile icerik semaya uymuyorsa Zod durdurur.
    const { fetchImpl } = fakeFetch([chatReply('```json\n{"count":"yedi","unknowns":[]}\n```')]);
    await expect(makeLlm(fetchImpl).structured(request)).rejects.toThrow();
  });

  it('token siniri kesintisi yakalaniyor (OpenAI: finish_reason=length)', async () => {
    const { fetchImpl } = fakeFetch([
      { choices: [{ finish_reason: 'length', message: { role: 'assistant', content: '{"cou' } }] },
    ]);
    await expect(makeLlm(fetchImpl).structured(request)).rejects.toThrow(/token sinirinda kesildi/);
  });

  it('token siniri kesintisi yakalaniyor (Anthropic: native_finish_reason=max_tokens)', async () => {
    // Canli eval'de yasandi: Anthropic 'length' yazmiyor, 'max_tokens' yaziyor.
    // Yalnizca finish_reason'a bakmak kesilmis JSON'u "gecersiz JSON" diye
    // raporluyordu — gelistirici yanlis yerde hata arar. Regresyon testi.
    const { fetchImpl } = fakeFetch([
      {
        choices: [
          {
            finish_reason: 'stop',
            native_finish_reason: 'max_tokens',
            message: { role: 'assistant', content: '{"count":4,"unknowns":[],"rationale":"kesil' },
          },
        ],
      },
    ]);
    await expect(makeLlm(fetchImpl).structured(request)).rejects.toThrow(/token sinirinda kesildi/);
  });

  it('kesilme hatasi max_tokens degerini ve cozumu soyluyor', async () => {
    const { fetchImpl } = fakeFetch([
      { choices: [{ native_finish_reason: 'max_tokens', message: { role: 'assistant', content: '{' } }] },
    ]);
    const llm = new OpenRouterLlm({ apiKey: 'sk-or-test', maxTokensCap: 1234, fetchImpl });
    let message = '';
    try {
      await llm.structured(request);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('1234');
    expect(message).toContain('OPENROUTER_MAX_TOKENS');
  });
});

describe('OpenRouter — tool dongusu', () => {
  const tools = [
    {
      name: 'estimate_addItem',
      description: 'kalem ekler',
      input_schema: { type: 'object' as const, properties: { service: { type: 'string' } } },
    },
  ];

  const toolCallReply = (name: string, args: string) => ({
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name, arguments: args } }],
        },
      },
    ],
  });

  it('tool tanimlari OpenAI function seklinde gonderiliyor', async () => {
    const { fetchImpl, requests } = fakeFetch([chatReply('bitti')]);
    await makeLlm(fetchImpl).toolLoop({
      system: 's',
      userMessage: 'u',
      tools,
      runTool: async () => ({}),
    });

    const sent = requests[0]!.body['tools'] as Array<{ type: string; function: { name: string } }>;
    expect(sent[0]!.type).toBe('function');
    expect(sent[0]!.function.name).toBe('estimate_addItem');
  });

  it('tool argumanlari JSON STRING olarak gelir ve cozulur', async () => {
    // OpenAI-uyumlu yuzeydeki en kolay gozden kacan fark.
    const { fetchImpl } = fakeFetch([
      toolCallReply('estimate_addItem', '{"service":"compute"}'),
      chatReply('eklendi'),
    ]);

    let received: unknown;
    const result = await makeLlm(fetchImpl).toolLoop({
      system: 's',
      userMessage: 'u',
      tools,
      runTool: async (_name, input) => {
        received = input;
        return { ok: true };
      },
    });

    expect(received).toEqual({ service: 'compute' });
    expect(result.toolCalls[0]!.ok).toBe(true);
    expect(result.finalText).toBe('eklendi');
  });

  it('tool sonucu role:"tool" mesaji olarak geri gonderiliyor', async () => {
    const { fetchImpl, requests } = fakeFetch([
      toolCallReply('estimate_addItem', '{"service":"compute"}'),
      chatReply('tamam'),
    ]);
    await makeLlm(fetchImpl).toolLoop({ system: 's', userMessage: 'u', tools, runTool: async () => ({ id: 'x' }) });

    const messages = requests[1]!.body['messages'] as Array<Record<string, unknown>>;
    const toolMessage = messages.find((m) => m['role'] === 'tool');
    expect(toolMessage).toBeDefined();
    expect(toolMessage!['tool_call_id']).toBe('call_1');
    expect(toolMessage!['content']).toBe('{"id":"x"}');
  });

  it('reddedilen tool cagrisi ajana METIN olarak donuyor (duzeltebilsin)', async () => {
    const { fetchImpl, requests } = fakeFetch([
      toolCallReply('estimate_addItem', '{"service":"compute"}'),
      chatReply('duzelttim'),
    ]);

    const result = await makeLlm(fetchImpl).toolLoop({
      system: 's',
      userMessage: 'u',
      tools,
      runTool: async () => {
        const error = new Error('"UYDURMA-999" katalogda yok.');
        error.name = 'UnknownProductCodeError';
        throw error;
      },
    });

    expect(result.toolCalls[0]!.ok).toBe(false);
    expect(result.toolCalls[0]!.error).toContain('UnknownProductCodeError');

    const messages = requests[1]!.body['messages'] as Array<Record<string, unknown>>;
    const toolMessage = messages.find((m) => m['role'] === 'tool');
    expect(String(toolMessage!['content'])).toContain('katalogda yok');
  });

  it('bozuk tool argumani dongurü kirmiyor, hata olarak geri bildiriliyor', async () => {
    const { fetchImpl } = fakeFetch([
      toolCallReply('estimate_addItem', '{bozuk json'),
      chatReply('tamam'),
    ]);

    let ran = false;
    const result = await makeLlm(fetchImpl).toolLoop({
      system: 's',
      userMessage: 'u',
      tools,
      runTool: async () => {
        ran = true;
        return {};
      },
    });

    expect(ran).toBe(false); // bozuk arguman tool'a hic ulasmadi
    expect(result.toolCalls[0]!.ok).toBe(false);
    expect(result.toolCalls[0]!.error).toContain('gecerli JSON degil');
  });

  it('sonsuz dongu korumasi var', async () => {
    const { fetchImpl } = fakeFetch([toolCallReply('estimate_addItem', '{}')]);
    await expect(
      makeLlm(fetchImpl).toolLoop({
        system: 's',
        userMessage: 'u',
        tools,
        runTool: async () => ({}),
        maxIterations: 3,
      }),
    ).rejects.toThrow(/3 turda tamamlanmadi/);
  });
});
