/**
 * FAZ 7.B — denetim izi testleri
 *
 * Kabul kriteri: "Her teklif icin tam denetim izi saklaniyor."
 *
 * En kritik iki grup:
 *   1. İZ HAM VERİ SIZDIRMAZ — iz bir sizinti kaynagina donusmemeli
 *   2. İZ AKIŞI BOZMAZ — telemetri hatasi teklifi kaybettirmemeli
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { CODE, catalog, makeRuleEngine } from './helpers.js';
import { AuditTrail } from '../src/core/telemetry/audit.js';
import { EstimateSession } from '../src/core/estimate/session.js';
import { callTool, createToolContext, type ToolContext } from '../src/mcp/tools/index.js';
import { Auditor } from '../src/agents/auditor.js';
import { Orchestrator } from '../src/agents/orchestrator.js';

const rules = makeRuleEngine();

/** Deterministik saat — iz testlenebilir olmali. */
const fixedClock = () => {
  let t = Date.parse('2026-07-30T10:00:00.000Z');
  return () => (t += 1000);
};

let trail: AuditTrail;
let ctx: ToolContext;

beforeEach(() => {
  trail = new AuditTrail({ now: fixedClock() });
  ctx = createToolContext(catalog, rules, {
    session: new EstimateSession(catalog, { currency: 'TL' }),
    audit: trail,
  });
});

const goodCompute = {
  productCode: CODE.flavorMedium,
  count: 3,
  storage: { productCode: CODE.volumePremium, size: 100, unit: 'GB' },
  network: { productCode: CODE.netOut, traffic: 500, unit: 'GB' },
  floatingIp: { productCode: CODE.floatingIp, count: 1 },
  backup: { productCode: CODE.backup, sourceSize: 100, estimatedCount: 4 },
};

// ---------------------------------------------------------------------------
// Tool katmanina baglanma
// ---------------------------------------------------------------------------

describe('Faz 7.B — tool cagrilari ize yaziliyor', () => {
  it('basarili cagri kaydediliyor', async () => {
    await callTool(ctx, 'catalog.listServices', {});
    const summary = trail.summary();
    expect(summary.toolCallCount).toBe(1);
    expect(summary.rejectedToolCalls).toBe(0);
  });

  it('UYDURMA productCode ayri sayilıyor (PLAN 7.B metrigi)', async () => {
    await expect(
      callTool(ctx, 'estimate.addItem', { service: 'compute', data: { productCode: CODE.bogus, count: 1 } }),
    ).rejects.toThrow();

    const summary = trail.summary();
    expect(summary.fabricatedCodeAttempts).toBe(1);
    expect(summary.rejectedToolCalls).toBe(1);
    expect(summary.toolCallCount).toBe(0); // basarili sayilmadi
  });

  it('sema hatasi red sayilir ama uydurma kod SAYILMAZ', async () => {
    await expect(
      callTool(ctx, 'estimate.addItem', {
        service: 'storage',
        data: { productCode: CODE.volumePremium, size: 100, unit: 'MB' },
      }),
    ).rejects.toThrow();

    const summary = trail.summary();
    expect(summary.rejectedToolCalls).toBe(1);
    // Iki metrik ayri: "gecersiz cagri" ile "uydurma kod" farkli sorular.
    expect(summary.fabricatedCodeAttempts).toBe(0);
  });

  it('birden fazla uydurma deneme birikiyor', async () => {
    for (const bogus of ['YOK-1', 'YOK-2', 'YOK-3']) {
      await expect(
        callTool(ctx, 'estimate.addItem', { service: 'compute', data: { productCode: bogus, count: 1 } }),
      ).rejects.toThrow();
    }
    expect(trail.summary().fabricatedCodeAttempts).toBe(3);
  });

  it('iz verilmezse tool davranisi degismiyor', async () => {
    const noTrail = createToolContext(catalog, rules, {
      session: new EstimateSession(catalog, { currency: 'TL' }),
    });
    await expect(callTool(noTrail, 'catalog.listServices', {})).resolves.toBeDefined();
    await expect(
      callTool(noTrail, 'estimate.addItem', { service: 'compute', data: { productCode: CODE.bogus, count: 1 } }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// PII sizmasi
// ---------------------------------------------------------------------------

describe('Faz 7.B — iz HAM VERI SIZDIRMIYOR', () => {
  it('taranan metnin ham PII degeri ize girmiyor', () => {
    trail.scanText('satisci metni', 'Ahmet Yilmaz, ahmet@firma.com, 0532 123 45 67');
    const json = JSON.stringify(trail.toJSON());

    expect(json).not.toContain('ahmet@firma.com');
    expect(json).not.toContain('5321234567');
    // Ama bulgu KAYITLI — "biliyorduk" izi kalmali.
    expect(trail.summary().pii.detections).toBe(2);
    expect(trail.summary().pii.kinds.email).toBe(1);
  });

  it('olay ozetindeki PII de maskeleniyor', () => {
    trail.stage('understand', 'musteri e-postasi ahmet@firma.com olarak alindi');
    const json = JSON.stringify(trail.toJSON());
    expect(json).not.toContain('ahmet@firma.com');
    expect(json).toContain('[EMAIL:');
  });

  it('tool girdisindeki PII maskeleniyor', () => {
    trail.toolCall('estimate.create', { name: 'Teklif — ahmet@firma.com' });
    expect(JSON.stringify(trail.toJSON())).not.toContain('ahmet@firma.com');
  });

  it('PII yoksa detections 0 kaliyor (yanlis pozitif yok)', () => {
    trail.scanText('teklif', JSON.stringify({ productCode: CODE.flavorMedium, count: 3, size: 100 }));
    expect(trail.summary().pii.detections).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Dayaniklilik
// ---------------------------------------------------------------------------

describe('Faz 7.B — iz akisi BOZMUYOR', () => {
  it('serilestirilemeyen girdi izi cokertmiyor', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular['self'] = circular;
    // Dongusel referans summarizeValue'da sonsuz dongu/hata yapabilir;
    // push() bunu yutmali ve sayaca yazmali.
    expect(() => trail.toolCall('x', circular)).not.toThrow();
    // Ya kaydedildi ya da sessizce atlandi — ama patlamadi.
    const s = trail.summary();
    expect(s.toolCallCount).toBe(1);
  });

  it('cok uzun metin kirpiliyor', () => {
    trail.toolCall('x', { note: 'A'.repeat(5000) });
    const json = JSON.stringify(trail.toJSON());
    expect(json.length).toBeLessThan(2000);
    expect(json).toContain('…(+');
  });

  it('list() kopya donduruyor — iz disaridan bozulamiyor', () => {
    trail.stage('a', 'b');
    const events = trail.list();
    events.length = 0;
    expect(trail.list()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// LLM kullanimi
// ---------------------------------------------------------------------------

describe('Faz 7.B — token/maliyet takibi', () => {
  it('token birikiyor', () => {
    trail.llmUsage({ provider: 'openrouter', model: 'm', inputTokens: 100, outputTokens: 50 });
    trail.llmUsage({ provider: 'openrouter', model: 'm', inputTokens: 200, outputTokens: 80 });
    const s = trail.summary();
    expect(s.llm.calls).toBe(2);
    expect(s.llm.inputTokens).toBe(300);
    expect(s.llm.outputTokens).toBe(130);
  });

  it('maliyet yalnizca saglayici bildirdiyse toplaniyor — uydurulmuyor', () => {
    trail.llmUsage({ provider: 'anthropic', model: 'm', inputTokens: 10, outputTokens: 5 });
    // Anthropic maliyet dondurmez -> costUsd olmamali
    expect(trail.summary().llm.costUsd).toBeUndefined();

    trail.llmUsage({ provider: 'openrouter', model: 'm', inputTokens: 10, outputTokens: 5, costUsd: 0.002 });
    expect(trail.summary().llm.costUsd).toBeCloseTo(0.002, 6);
  });
});

// ---------------------------------------------------------------------------
// Uctan uca: Orchestrator izi
// ---------------------------------------------------------------------------

describe('Faz 7.B — uctan uca denetim izi', () => {
  it('soru ureten akisin tamami ize giriyor', async () => {
    // `storage` YOK -> COMPUTE_NO_BLOCK_STORAGE (recommended, ask+default var).
    // `goodCompute` fazla iyi yapilandirilmis oldugu icin soru uretmiyor;
    // soru yolunu test etmek icin bilerek bir bosluk birakiliyor.
    const { storage, ...withoutStorage } = goodCompute;
    void storage;
    ctx.session.addItem('compute', withoutStorage);
    const orchestrator = new Orchestrator({ catalog, auditor: new Auditor(rules) });

    await orchestrator.run(ctx, 'Musteri 3 sunucu istiyor', {
      onQuestions: async (questions) => questions.map((q) => ({ ruleId: q.ruleId })),
      onApprove: async () => ({ approved: false }),
    });

    const types = trail.list().map((e) => e.type);
    expect(types).toContain('stage');
    expect(types).toContain('validation');
    expect(types).toContain('price.snapshot');
    expect(types).toContain('question.asked');
    expect(types).toContain('assumption');

    const s = trail.summary();
    expect(s.questionsAsked).toBeGreaterThan(0);
    expect(s.assumptions).toBeGreaterThan(0);
    expect(s.published).toBe(false);
    expect(s.approvedBy).toBeUndefined();
  });

  it('eksigi olmayan teklifte soru sorulmuyor — iz de bunu gosteriyor', async () => {
    ctx.session.addItem('compute', goodCompute);
    const orchestrator = new Orchestrator({ catalog, auditor: new Auditor(rules) });
    await orchestrator.run(ctx, 'tam kurulmus teklif', {
      onQuestions: async (questions) => questions.map((q) => ({ ruleId: q.ruleId })),
      onApprove: async () => ({ approved: false }),
    });

    const s = trail.summary();
    expect(s.questionsAsked).toBe(0);
    expect(s.assumptions).toBe(0);
    // Ama denetim yine kosmus ve fiyat yine kaydedilmis olmali.
    expect(trail.list().map((e) => e.type)).toContain('validation');
    expect(trail.list().map((e) => e.type)).toContain('price.snapshot');
  });

  it('cevaplanan soru "answered", atlanan "assumption" olarak ayriliyor', async () => {
    const { storage, ...withoutStorage } = goodCompute;
    void storage;
    ctx.session.addItem('compute', withoutStorage);
    const orchestrator = new Orchestrator({ catalog, auditor: new Auditor(rules) });

    await orchestrator.run(ctx, 'x', {
      onQuestions: async (questions) =>
        // Ilkini cevapla, kalanini atla.
        questions.map((q, i) => (i === 0 ? { ruleId: q.ruleId, answer: '200 GB' } : { ruleId: q.ruleId })),
      onApprove: async () => ({ approved: false }),
    });

    const types = trail.list().map((e) => e.type);
    expect(types).toContain('question.answered');
    const answered = trail.list().filter((e) => e.type === 'question.answered');
    expect(answered).toHaveLength(1);
  });

  it('durdurulan akis izde "halt" olarak gorunuyor', async () => {
    ctx.session.addItem('object-storage', {});
    const orchestrator = new Orchestrator({ catalog, auditor: new Auditor(rules) });
    await orchestrator.run(ctx, 'object storage');

    expect(trail.list().map((e) => e.type)).toContain('halt');
    const haltEvent = trail.list().find((e) => e.type === 'halt');
    expect(haltEvent?.summary).toContain('OBJ_STORAGE_NO_TRANSFER');
  });

  it('satisci metnindeki PII akis basinda taraniyor', async () => {
    ctx.session.addItem('compute', goodCompute);
    const orchestrator = new Orchestrator({ catalog, auditor: new Auditor(rules) });
    await orchestrator.run(ctx, 'Musteri Ahmet, ahmet@firma.com, 3 sunucu istiyor', {
      onApprove: async () => ({ approved: false }),
    });

    expect(trail.summary().pii.detections).toBeGreaterThan(0);
    expect(JSON.stringify(trail.toJSON())).not.toContain('ahmet@firma.com');
  });

  it('render() insan-okunur dokum uretiyor', async () => {
    ctx.session.addItem('compute', goodCompute);
    await callTool(ctx, 'price.calculate', {});
    const out = trail.render();
    expect(out).toContain('DENETIM IZI');
    expect(out).toContain('tool cagrisi');
    expect(out).toContain('uydurma kod');
  });

  it('olaylar sirali ve zaman damgali', () => {
    trail.stage('a', 'birinci');
    trail.stage('b', 'ikinci');
    const events = trail.list();
    expect(events[0]!.seq).toBe(1);
    expect(events[1]!.seq).toBe(2);
    expect(Date.parse(events[1]!.at)).toBeGreaterThan(Date.parse(events[0]!.at));
  });
});
