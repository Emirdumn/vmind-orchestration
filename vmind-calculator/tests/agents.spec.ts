/**
 * FAZ 5 — Ajan katmani testleri
 *
 * NE TEST EDILIYOR: Faz 5'in deterministik iskeleti — Orchestrator akisi,
 * tur limiti, HITL kapisi, Reconciler matematigi, Auditor'in kural tarafi,
 * Designer'in tool yetki siniri. Bunlarin hicbiri gercek LLM gerektirmiyor.
 *
 * NE TEST EDILMIYOR: modelin cikarim KALITESI (5.A "10 cumleden 9'u dogru",
 * 5.B "10 senaryoda uydurma kod yok"). Bunlar API anahtari ister ve
 * evals/ altindaki harness ile calistirilir.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { CODE, catalog, makeRuleEngine } from './helpers.js';
import { BrokenLlm, FakeLlm } from './fake-llm.js';

import { EstimateSession } from '../src/core/estimate/session.js';
import { createToolContext, type ToolContext } from '../src/mcp/tools/index.js';
import { Auditor, MAX_QUESTIONS_PER_ROUND, prioritizeQuestions } from '../src/agents/auditor.js';
import {
  RequirementExtractor,
  criticalUnknowns,
  hasServiceIntent,
  mergeDeterministicUnknowns,
} from '../src/agents/extractor.js';
import {
  DESIGNER_TOOLS,
  SolutionDesigner,
  designerIterationLimit,
} from '../src/agents/designer.js';
import { normalizeNetworkTopology } from '../src/agents/network-units.js';
import { RECONCILE_TOLERANCE, parseRemoteEstimate, reconcile } from '../src/agents/reconciler.js';
import { MAX_AUDIT_ROUNDS, Orchestrator, renderApprovalScreen } from '../src/agents/orchestrator.js';
import {
  REQUIREMENT_SPEC_JSON_SCHEMA,
  RequirementSpecSchema,
  type RequirementSpec,
} from '../src/agents/types.js';
import type { Gap } from '../src/core/rules/types.js';

const rules = makeRuleEngine();

let ctx: ToolContext;
beforeEach(() => {
  ctx = createToolContext(catalog, rules, {
    session: new EstimateSession(catalog, { currency: 'TL' }),
  });
});

/** Blocker uretmeyen, tam kurulmus compute kalemi. */
const goodCompute = {
  productCode: CODE.flavorMedium,
  count: 3,
  storage: { productCode: CODE.volumePremium, size: 100, unit: 'GB' },
  network: { productCode: CODE.netOut, traffic: 500, unit: 'GB' },
  floatingIp: { productCode: CODE.floatingIp, count: 1 },
  backup: { productCode: CODE.backup, sourceSize: 100, estimatedCount: 4 },
};

const baseSpec: RequirementSpec = {
  compute: { count: 3 },
  networkExposure: 'internal',
  unknowns: [],
  rationale: 'test',
};

// ---------------------------------------------------------------------------
// 5.A — Extractor
// ---------------------------------------------------------------------------

describe('Faz 5.A — Zod semasi ile JSON Schema senkron', () => {
  // Iki sema iki farkli amaca hizmet ediyor (API kisiti + calisma zamani dogrulamasi).
  // Ayrisirlarsa model, Zod'un reddedecegi bir sekli uretmekte serbest kalir.
  const zodKeys = Object.keys(RequirementSpecSchema.shape).sort();
  const jsonKeys = Object.keys(REQUIREMENT_SPEC_JSON_SCHEMA.properties).sort();

  it('alan kumeleri birebir ayni', () => {
    expect(jsonKeys).toEqual(zodKeys);
  });

  it('zorunlu alanlar ayni', () => {
    const zodRequired = zodKeys
      .filter((key) => !RequirementSpecSchema.shape[key as keyof typeof RequirementSpecSchema.shape].isOptional())
      .sort();
    expect([...REQUIREMENT_SPEC_JSON_SCHEMA.required].sort()).toEqual(zodRequired);
  });

  it('JSON Schema ek alana izin vermiyor (model uydurma alan ekleyemez)', () => {
    expect(REQUIREMENT_SPEC_JSON_SCHEMA.additionalProperties).toBe(false);
  });

  it('unknowns ve rationale her zaman zorunlu — "bilmiyorum" demek opsiyonel degil', () => {
    expect(REQUIREMENT_SPEC_JSON_SCHEMA.required).toContain('unknowns');
    expect(REQUIREMENT_SPEC_JSON_SCHEMA.required).toContain('rationale');
  });

  it('DESTEKLENMEYEN sayisal/uzunluk kisiti icermiyor (API 400 verir)', () => {
    // Canli calistirmada ogrenildi: structured output `minimum` kabul etmiyor.
    //   "output_config.format.schema: For 'integer' type, property 'minimum'
    //    is not supported"
    // Kisitlar Zod tarafinda yasiyor; API semasina geri sizmamali.
    const UNSUPPORTED = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern'];

    const walk = (node: unknown, path: string): string[] => {
      if (node === null || typeof node !== 'object') return [];
      if (Array.isArray(node)) return node.flatMap((v, i) => walk(v, `${path}[${i}]`));
      const found: string[] = [];
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (UNSUPPORTED.includes(key)) found.push(`${path}.${key}`);
        found.push(...walk(value, `${path}.${key}`));
      }
      return found;
    };

    expect(walk(REQUIREMENT_SPEC_JSON_SCHEMA, '$')).toEqual([]);
  });

  it('kisitlar Zod tarafinda KORUNUYOR — dogrulama kaybolmadi', () => {
    // API semasindan cikarilan sinirlar burada hala geceriyor.
    expect(RequirementSpecSchema.safeParse({ compute: { count: 0 }, unknowns: [], rationale: 'x' }).success).toBe(false);
    expect(RequirementSpecSchema.safeParse({ compute: { count: -3 }, unknowns: [], rationale: 'x' }).success).toBe(false);
    expect(RequirementSpecSchema.safeParse({ compute: { count: 2.5 }, unknowns: [], rationale: 'x' }).success).toBe(false);
    expect(RequirementSpecSchema.safeParse({ egressGb: -1, unknowns: [], rationale: 'x' }).success).toBe(false);
    expect(RequirementSpecSchema.safeParse({ compute: { count: 3 }, unknowns: [], rationale: 'x' }).success).toBe(true);
  });
});

describe('Faz 5.A — Requirement Extractor', () => {
  it('structured output ZORUNLU — semadan gecmeyen cikti reddediliyor', async () => {
    const llm = new FakeLlm({ structuredResult: { compute: { count: -1 }, unknowns: [], rationale: 'x' } });
    const extractor = new RequirementExtractor(llm);
    await expect(extractor.extract('3 sunucu')).rejects.toThrow();
  });

  it('sozlukten gelen belirsizlikler modelin kacirmasi halinde de ekleniyor', () => {
    // Model "worker"i gormezden gelmis olsun:
    const spec = mergeDeterministicUnknowns('4 sunucu ve worker olsun', {
      compute: { count: 4 },
      unknowns: [],
      rationale: 'test',
    });
    expect(spec.unknowns.some((u) => u.toLowerCase().includes('worker'))).toBe(true);
  });

  it('belirsiz olmayan ifadeler unknowns\'a eklenmiyor', () => {
    const spec = mergeDeterministicUnknowns('premium disk olsun', {
      compute: { storage: { tier: 'premium' } },
      unknowns: [],
      rationale: 'test',
    });
    expect(spec.unknowns).toEqual([]);
  });

  it('PLAN §3 ornegi: "worker" tasarimdan ONCE sorulacak kritik belirsizlik', () => {
    const spec = mergeDeterministicUnknowns(
      'Müşteri 4 sunucu istiyor, load balancer olsun, worker olsun, premium disk olsun, backup olsun.',
      { compute: { count: 4, storage: { tier: 'premium' } }, unknowns: [], rationale: 'test' },
    );
    const critical = criticalUnknowns(spec);
    expect(critical.some((c) => c.question.toLowerCase().includes('worker'))).toBe(true);
    expect(critical.some((c) => c.question.toLowerCase().includes('load balancer'))).toBe(true);
  });

  it('load balancer "unspecified" ise kritik soru uretiliyor', () => {
    const critical = criticalUnknowns({
      loadBalancer: { kind: 'unspecified' },
      networkExposure: 'internal',
      unknowns: [],
      rationale: 'test',
    });
    expect(critical).toHaveLength(1);
    expect(critical[0]!.reason).toContain('fiyat farki');
  });

  it('compute flavor bilgisi yoksa fiyat etkili netlestirme sorusu uretiliyor', () => {
    const critical = criticalUnknowns({ compute: { count: 2 }, unknowns: [], rationale: 'x' });
    expect(critical.some((item) => item.question.includes('vCPU'))).toBe(true);
  });

  it('compute flavor bilgisi verildiyse gereksiz boyut sorusu sorulmuyor', () => {
    const critical = criticalUnknowns({
      compute: { count: 2, sizeHint: '4 vCPU 8 GB RAM' },
      networkExposure: 'internal',
      loadBalancer: { kind: 'app' },
      unknowns: [],
      rationale: 'x',
    });
    expect(critical.some((item) => item.question.includes('vCPU'))).toBe(false);
  });

  it('ag erisimi teknik terim yerine tek ve anlasilir sonuc sorusuyla netlestiriliyor', () => {
    const critical = criticalUnknowns({
      compute: { count: 2, sizeHint: '2 vCPU 4 GB RAM' },
      unknowns: [],
      rationale: 'x',
    });
    expect(critical.some((item) => item.question === 'Sunucularınıza internetten nasıl erişilsin?')).toBe(true);
    expect(critical.some((item) => item.question.includes('outbound'))).toBe(false);
    expect(critical.some((item) => item.question.includes('Load Balancer'))).toBe(true);
  });

  it('ag sorusunda mevcut compute rol adlarini kullaniciya gosteriyor', () => {
    const critical = criticalUnknowns({
      computeGroups: [
        { role: 'Customer API', count: 2, vcpuPerInstance: 4, ramGbPerInstance: 8 },
        { role: 'PostgreSQL', count: 1, vcpuPerInstance: 8, ramGbPerInstance: 32 },
      ],
      unknowns: [],
      rationale: 'x',
    });
    const access = critical.find((item) => item.question.includes('internetten'))!;
    expect(access.reason).toContain('Customer API');
    expect(access.reason).toContain('PostgreSQL');
  });

  it('internete acilacak rol adlari RequirementSpec semasinda korunuyor', () => {
    expect(
      RequirementSpecSchema.safeParse({
        networkExposure: 'public',
        internetFacingRoles: ['web-1', 'Customer API'],
        unknowns: [],
        rationale: 'yalniz uygulama katmani public',
      }).success,
    ).toBe(true);
  });

  it('public FIP ve outbound tek Router kalemine tasinir, ust seviyede tekrar kalmaz', () => {
    const normalized = normalizeNetworkTopology({
      networkExposure: 'public',
      compute: { count: 2, sizeHint: '2 vCPU 4 GB RAM' },
      egressGb: 500,
      floatingIpCount: 1,
      unknowns: [],
      rationale: 'x',
    });
    expect(normalized.router).toEqual({ egressGb: 500, floatingIpCount: 1 });
    expect(normalized.egressGb).toBeUndefined();
    expect(normalized.floatingIpCount).toBeUndefined();
  });

  it('internal outbound da Routera tasinir ama Floating IP uretilmez', () => {
    const normalized = normalizeNetworkTopology({
      networkExposure: 'internal',
      compute: { count: 2, sizeHint: '4 vCPU 8 GB RAM' },
      egressGb: 1024,
      unknowns: [],
      rationale: 'x',
    });
    expect(normalized.router).toEqual({ egressGb: 1024 });
    expect(normalized.egressGb).toBeUndefined();
    expect(normalized.floatingIpCount).toBeUndefined();
  });

  it('dokuz servis kapsamindaki standalone storage ve router semada temsil ediliyor', () => {
    expect(
      RequirementSpecSchema.safeParse({
        standaloneStorage: { tier: 'premium', sizeGb: 500 },
        router: { egressGb: 1024, floatingIpCount: 1 },
        unknowns: [],
        rationale: 'x',
      }).success,
    ).toBe(true);
  });

  it('yalnizca is yuku varsa bos teklif yerine 5 maddelik kesif soruyor', () => {
    const spec = { workload: 'e-ticaret', unknowns: [], rationale: 'e-ticaret sistemi' };
    expect(hasServiceIntent(spec)).toBe(false);
    const questions = criticalUnknowns(spec);
    expect(questions).toHaveLength(5);
    expect(questions.some((item) => item.question.includes('Kubernetes'))).toBe(true);
    expect(questions.some((item) => item.question.includes('Object Storage'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5.B — Designer
// ---------------------------------------------------------------------------

describe('Faz 5.B — Solution Designer', () => {
  it('compute + LB + Router guclu profiline en az 16 benzersiz tool turu ayirir', () => {
    expect(
      designerIterationLimit({
        compute: { count: 2, sizeHint: '8 vCPU 16 GB RAM' },
        loadBalancer: { kind: 'app' },
        router: { egressGb: 1024 },
        unknowns: [],
        rationale: 'VMind güçlü profil',
      }),
    ).toBeGreaterThanOrEqual(16);
  });

  it('publish.* ve approval.* tool\'lari bu ajana HIC verilmiyor', () => {
    expect(DESIGNER_TOOLS).not.toContain('publish.save');
    expect(DESIGNER_TOOLS).not.toContain('approval.grant');
    expect(DESIGNER_TOOLS).not.toContain('approval.revoke');
  });

  it('yetki disi tool cagrisi reddediliyor (prompt disiplinine guvenilmiyor)', async () => {
    const llm = new FakeLlm({ toolPlan: [{ name: 'publish_save', input: {} }], finalText: '' });
    const draft = await new SolutionDesigner(llm).design(ctx, baseSpec);
    expect(draft.rejectedToolCalls).toBe(1);
    expect(draft.rejections[0]).toContain('acik degil');
  });

  it('uydurma productCode reddediliyor ve METRIK olarak sayiliyor', async () => {
    const llm = new FakeLlm({
      toolPlan: [
        { name: 'estimate_addItem', input: { service: 'compute', data: { productCode: CODE.bogus, count: 2 } } },
        { name: 'estimate_addItem', input: { service: 'compute', data: goodCompute } },
      ],
      finalText: '- compute: g1.medium secildi',
    });
    const draft = await new SolutionDesigner(llm).design(ctx, baseSpec);

    expect(draft.rejectedToolCalls).toBe(1);
    expect(draft.rejections[0]).toContain('UnknownProductCodeError');
    // Reddedilen kalem teklife GIRMEDI; gecerli compute ve onun icinden
    // musteriye acik fiyat satiri icin ayrilan backup kalemi girdi.
    expect(draft.choices.map((choice) => choice.service)).toEqual(['compute', 'backup']);
    expect(ctx.session.itemCount).toBe(2);
    expect(ctx.session.read().list[0]?.data).not.toHaveProperty('backup');
  });

  it('temiz tasarimda reddedilme sayisi 0', async () => {
    const llm = new FakeLlm({
      toolPlan: [
        { name: 'catalog_searchFlavors', input: { minVcpu: 2 } },
        { name: 'estimate_addItem', input: { service: 'compute', data: goodCompute } },
      ],
      finalText: '- compute: g1.medium x3, premium disk',
    });
    const draft = await new SolutionDesigner(llm).design(ctx, baseSpec);
    expect(draft.rejectedToolCalls).toBe(0);
    expect(draft.choices[0]!.rationale).toContain('compute');
  });

  it('belirsiz alanlar prompta "kalem ekleme" uyarisi olarak giriyor', async () => {
    const llm = new FakeLlm({ toolPlan: [], finalText: '' });
    await new SolutionDesigner(llm).design(ctx, {
      ...baseSpec,
      unknowns: ['App LB mi Net LB mi?'],
    }).catch(() => undefined);
    expect(llm.toolLoopCalls[0]!.userMessage).toContain('App LB mi Net LB mi?');
    expect(llm.toolLoopCalls[0]!.userMessage).toContain('kalem ekleme');
  });

  it('kritik netlestirme cevaplari Designer promptuna aktariliyor', async () => {
    const llm = new FakeLlm({ toolPlan: [], finalText: '' });
    await new SolutionDesigner(llm)
      .design(ctx, baseSpec, {
        'Sunucu başına kaç vCPU ve kaç GB RAM gerekiyor; iş yükü nedir?':
          '4 vCPU, 8 GB RAM, e-ticaret',
      })
      .catch(() => undefined);
    expect(llm.toolLoopCalls[0]!.userMessage).toContain('4 vCPU, 8 GB RAM, e-ticaret');
    expect(llm.toolLoopCalls[0]!.userMessage).toContain('MUTLAKA uygula');
  });
});

// ---------------------------------------------------------------------------
// 5.C — Auditor
// ---------------------------------------------------------------------------

describe('Faz 5.C — Auditor', () => {
  const gap = (ruleId: string, severity: Gap['severity'], ask?: string): Gap => ({
    ruleId,
    severity,
    message: `${ruleId} mesaji`,
    ...(ask !== undefined ? { ask, default: 'varsayilan' } : {}),
  });

  it('blocker sorulari recommended\'dan once soruluyor', () => {
    const questions = prioritizeQuestions([
      gap('R1', 'recommended', 'r1?'),
      gap('B1', 'blocker', 'b1?'),
    ]);
    expect(questions.map((q) => q.ruleId)).toEqual(['B1', 'R1']);
  });

  it('optional kurallar ASLA sorulmuyor (yalnizca raporda)', () => {
    const questions = prioritizeQuestions([gap('O1', 'optional', 'o1?')]);
    expect(questions).toEqual([]);
  });

  it('tek turda en fazla 5 soru', () => {
    const many = Array.from({ length: 12 }, (_, i) => gap(`B${i}`, 'blocker', `q${i}?`));
    expect(prioritizeQuestions(many)).toHaveLength(MAX_QUESTIONS_PER_ROUND);
  });

  it('ayni kural birden fazla kalemde tetiklense de bir kez soruluyor', () => {
    const questions = prioritizeQuestions([
      { ...gap('B1', 'blocker', 'b1?'), itemId: 'i1' },
      { ...gap('B1', 'blocker', 'b1?'), itemId: 'i2' },
    ]);
    expect(questions).toHaveLength(1);
  });

  it('cevaplanmis kurallar tekrar sorulmuyor', () => {
    const questions = prioritizeQuestions([gap('B1', 'blocker', 'b1?')], new Set(['B1']));
    expect(questions).toEqual([]);
  });

  it('her sorunun varsayilani var (satisci hepsini atlayabilmeli)', async () => {
    await ctx.session.addItem('object-storage', {});
    const state = ctx.session.read();
    const report = await new Auditor(rules).audit({ currency: state.currency, list: state.list });
    expect(report.questions.length).toBeGreaterThan(0);
    for (const question of report.questions) {
      expect(question.defaultAnswer).toBeTruthy();
      expect(question.defaultAnswer).not.toBe('Varsayilan tanimlanmamis');
    }
  });

  it('LLM COKSE BILE denetim tamamlaniyor — kural tarafi atlanmiyor', async () => {
    ctx.session.addItem('object-storage', {});
    const state = ctx.session.read();
    const report = await new Auditor(rules, new BrokenLlm()).audit({
      currency: state.currency,
      list: state.list,
    });
    expect(report.publishable).toBe(false);
    expect(report.gaps.some((g) => g.ruleId === 'OBJ_STORAGE_NO_TRANSFER')).toBe(true);
    expect(report.contextualNotes).toEqual([]); // LLM notu yok, denetim yine tam
  });

  it('LLM yalnizca baglamsal not ekliyor; Gap listesini degistiremiyor', async () => {
    ctx.session.addItem('object-storage', {});
    const state = ctx.session.read();
    const llm = new FakeLlm({ textResult: '- musteri e-ticaret dedi ama yedeklilik yok' });
    const report = await new Auditor(rules, llm).audit({ currency: state.currency, list: state.list });

    const withoutLlm = await new Auditor(rules).audit({ currency: state.currency, list: state.list });
    expect(report.gaps.map((g) => g.ruleId)).toEqual(withoutLlm.gaps.map((g) => g.ruleId));
    expect(report.publishable).toBe(withoutLlm.publishable);
    expect(report.contextualNotes).toEqual(['musteri e-ticaret dedi ama yedeklilik yok']);
  });
});

// ---------------------------------------------------------------------------
// 5.C — Reconciler
// ---------------------------------------------------------------------------

describe('Faz 5.C — Reconciler', () => {
  const localSnapshot = () => {
    ctx.session.addItem('compute', goodCompute);
    const state = ctx.session.read();
    return {
      snapshot: ctx,
      remote: { id: state.id, currency: state.currency, list: state.list },
    };
  };

  it('ayni teklif -> mutabakat saglaniyor, fark 0', async () => {
    const { remote } = localSnapshot();
    const price = (await import('../src/mcp/tools/index.js')).priceTools.calculate(ctx);
    const result = reconcile(catalog, price, remote);
    expect(result.ok).toBe(true);
    expect(result.monthlyDiff).toBe(0);
    expect(result.lineMismatches).toEqual([]);
  });

  it('platformda kalem eksikse mutabakatsizlik', async () => {
    const { remote } = localSnapshot();
    const price = (await import('../src/mcp/tools/index.js')).priceTools.calculate(ctx);
    const result = reconcile(catalog, price, { ...remote, list: [] });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('MUTABAKATSIZLIK');
  });

  it('platformda alan kaybolmussa (storage dusmus) yakalaniyor', async () => {
    const { remote } = localSnapshot();
    const price = (await import('../src/mcp/tools/index.js')).priceTools.calculate(ctx);
    const stripped = {
      ...remote,
      list: remote.list.map((item) => {
        const data = { ...(item.data as Record<string, unknown>) };
        delete data['storage'];
        return { ...item, data };
      }),
    };
    const result = reconcile(catalog, price, stripped);
    expect(result.ok).toBe(false);
    expect(result.monthlyDiff).toBeGreaterThan(RECONCILE_TOLERANCE);
  });

  it('para birimi farkliysa yakalaniyor', async () => {
    const { remote } = localSnapshot();
    const price = (await import('../src/mcp/tools/index.js')).priceTools.calculate(ctx);
    const result = reconcile(catalog, price, { ...remote, currency: 'USD' });
    expect(result.ok).toBe(false);
    expect(result.lineMismatches.some((m) => m.includes('Para birimi'))).toBe(true);
  });

  it('platform yaniti stringlenmis json alanindan cozuluyor', () => {
    const estimate = { id: 'x', currency: 'TL', list: [] };
    const parsed = parseRemoteEstimate({ json: JSON.stringify(estimate) });
    expect(parsed.currency).toBe('TL');
  });

  /**
   * REGRESYON — bu zarf UYDURMA DEGIL. 2026-07-30'da ilk gercek yazma yapilirken
   * `GET /billing/estimateplan/{key}`'in dondurdugu govdeden alindi.
   *
   * Onceki parser yalnizca `json` / `items[0].json` bakiyordu ve bu govdede
   * PATLIYORDU: "Platform yaniti beklenen `json` alanini icermiyor."
   * Yani reconcile her gercek yayinlamada basarisiz olacakti — ama tum testler
   * taklit veriyle gectigi icin bu gorunmuyordu.
   *
   * Ders: bir yolun testleri gecmesi, o yolun CALISTIGI anlamina gelmiyor;
   * gercek zarfi gormeden dogrulanmis saymamak lazim.
   */
  it('GERCEK platform yaniti: teklif tekil `item` alaninda JSON string olarak doner', () => {
    const stored = {
      id: '1c659e42-fd08-44d8-9b86-1158513120d9',
      name: '[TEST] VMind Teklif Ajani',
      currency: 'TL',
      list: [
        {
          id: 'b1e18fe4-9171-4c48-8954-581d87925ad8',
          service: 'compute',
          data: {
            productCode: 'fd9ee6ed-a56d-483e-98c9-1a05d634ffcb',
            count: 2,
            network: { productCode: 'NETW-OUT-001', traffic: 100, unit: 'GB' },
            storage: {
              productCode: '096439fe-26d6-4bd0-bdf0-11e40f73753e',
              size: 50,
              unit: 'GB',
            },
          },
        },
      ],
    };
    const realEnvelope = {
      result: { success: true, type: 0, message: null, status: null },
      item: JSON.stringify(stored),
    };

    const parsed = parseRemoteEstimate(realEnvelope);
    expect(parsed.id).toBe('1c659e42-fd08-44d8-9b86-1158513120d9');
    expect(parsed.currency).toBe('TL');
    expect(parsed.list).toHaveLength(1);
    // Ic ice `storage` ve `unit` serilestirmede kaybolmamis — reconcile'in
    // asil kanitlamasi gereken sey bu.
    expect((parsed.list[0]?.data as { storage: { unit: string } }).storage.unit).toBe('GB');
  });

  /**
   * Yalnizca parse degil, ZINCIRIN TAMAMI gercek zarf seklinden gecirilir:
   * platformun dondurdugu govde -> parse -> yeniden fiyatla -> yerelle karsilastir.
   * Canli calistirmada bu adim hic tamamlanamadi (parse patliyordu), bu yuzden
   * reconcile'in gercek sekille calistigi ilk kez burada kanitlaniyor.
   */
  it('GERCEK zarf sekli uctan uca reconcile ediliyor', async () => {
    const { remote } = localSnapshot();
    const price = (await import('../src/mcp/tools/index.js')).priceTools.calculate(ctx);
    // Yerel teklifi platformun dondurdugu sekle sok, sonra geri coz.
    const envelope = {
      result: { success: true, type: 0, message: null, status: null },
      item: JSON.stringify(remote),
    };
    const result = reconcile(catalog, price, parseRemoteEstimate(envelope));
    expect(result.ok).toBe(true);
    expect(result.monthlyDiff).toBe(0);
    expect(result.lineMismatches).toEqual([]);
  });

  it('POST ile GET ayni adi farkli tipte kullaniyor: `item: true` teklif degildir', () => {
    // POST /billing/estimateplan -> {"result":{...},"item":true}
    // Bunu teklif sanip parse etmeye calismak sessiz bir hata olurdu.
    expect(() => parseRemoteEstimate({ result: { success: true }, item: true })).toThrow(/item/);
  });

  it('bozuk platform yaniti anlamli hata veriyor', () => {
    expect(() => parseRemoteEstimate({})).toThrow(/item/);
    expect(() => parseRemoteEstimate({ json: JSON.stringify({ id: 'x' }) })).toThrow(/list/);
  });
});

// ---------------------------------------------------------------------------
// 5.C — Orchestrator
// ---------------------------------------------------------------------------

describe('Faz 5.C — Orchestrator akisi', () => {
  const orchestrator = () => new Orchestrator({ catalog, auditor: new Auditor(rules) });

  it('kritik cevap akista kaybolmadan Designer secimine ulasiyor', async () => {
    const llm = new FakeLlm({
      structuredResult: { compute: { count: 3 }, unknowns: [], rationale: '3 sunucu' },
      toolPlan: [{ name: 'estimate_addItem', input: { service: 'compute', data: goodCompute } }],
      finalText: '- compute: 4 vCPU 8 GB RAM secildi',
    });
    const withNlp = new Orchestrator({
      catalog,
      auditor: new Auditor(rules),
      extractor: new RequirementExtractor(llm),
      designer: new SolutionDesigner(llm),
    });

    await withNlp.run(ctx, '3 sunucu', {
      onClarify: async (unknowns) => {
        const sizing = unknowns.find((unknown) => unknown.question.includes('vCPU'))!;
        return { [sizing.question]: '4 vCPU, 8 GB RAM' };
      },
      onQuestions: async (questions) => questions.map((question) => ({ ruleId: question.ruleId })),
      onApprove: async () => ({ approved: false }),
    });

    expect(llm.toolLoopCalls[0]!.userMessage).toContain('4 vCPU, 8 GB RAM');
  });

  it('kalem yoksa akis duruyor', async () => {
    const result = await orchestrator().run(ctx, 'bos');
    expect(result.stage).toBe('halted');
    expect(result.haltReason).toContain('hic kalem yok');
  });

  it('cozulmemis blocker varken yayinlanamiyor', async () => {
    ctx.session.addItem('object-storage', {});
    const result = await orchestrator().run(ctx, 'object storage');
    expect(result.stage).toBe('halted');
    expect(result.haltReason).toContain('OBJ_STORAGE_NO_TRANSFER');
    expect(result.published).toBe(false);
  });

  it('soru turu sayisi MAX_AUDIT_ROUNDS ile sinirli (sonsuz dongu yok)', async () => {
    ctx.session.addItem('object-storage', {});
    let rounds = 0;
    await orchestrator().run(ctx, 'x', {
      // Hicbir soruyu cevaplamayan, dolayisiyla durumu degistirmeyen satisci:
      onQuestions: async (questions) => {
        rounds++;
        return questions.map((q) => ({ ruleId: q.ruleId }));
      },
    });
    expect(rounds).toBeLessThanOrEqual(MAX_AUDIT_ROUNDS);
  });

  it('atlanan sorular VARSAYIM olarak kaydediliyor (sessizce kaybolmuyor)', async () => {
    ctx.session.addItem('compute', { productCode: CODE.flavorMedium, count: 2 });
    const result = await orchestrator().run(ctx, 'x', {
      onQuestions: async (questions) => questions.map((q) => ({ ruleId: q.ruleId })),
      onApprove: async () => ({ approved: false }),
    });
    expect(result.assumptions.length).toBeGreaterThan(0);
    for (const assumption of result.assumptions) {
      expect(assumption.assumed).toBeTruthy();
      expect(assumption.question).toBeTruthy();
    }
  });

  it('onay verilmezse yayinlanmiyor ama fiyat hazir', async () => {
    ctx.session.addItem('compute', goodCompute);
    const result = await orchestrator().run(ctx, 'x', {
      onQuestions: async (questions) => questions.map((q) => ({ ruleId: q.ruleId })),
      onApprove: async () => ({ approved: false }),
    });
    expect(result.stage).toBe('done');
    expect(result.published).toBe(false);
    expect(result.price!.totalMonthCost).toBeGreaterThan(0);
    expect(ctx.approval.granted).toBe(false);
  });

  it('onay callback\'i hic verilmezse yayinlanmiyor (varsayilan: onaysiz)', async () => {
    ctx.session.addItem('compute', goodCompute);
    const result = await orchestrator().run(ctx, 'x');
    expect(result.published).toBe(false);
    expect(ctx.approval.granted).toBe(false);
  });

  it('onay verilse bile API istemcisi salt-okunursa yazma engelleniyor', async () => {
    const { PlatformApiClient } = await import('../src/platform/api-client.js');
    ctx.client = new PlatformApiClient(); // allowWrites varsayilan false
    ctx.session.addItem('compute', goodCompute);
    await expect(
      orchestrator().run(ctx, 'x', {
        onQuestions: async (questions) => questions.map((q) => ({ ruleId: q.ruleId })),
        onApprove: async () => ({ approved: true, approvedBy: 'satisci@vmind' }),
      }),
    ).rejects.toThrow(/salt-okunur/);
  });

  it('onay ile kalıcı yayın ayrıysa public taslak hata vermeden tamamlanır', async () => {
    const { PlatformApiClient } = await import('../src/platform/api-client.js');
    ctx.client = new PlatformApiClient(); // salt-okunur public istemci
    ctx.session.addItem('compute', goodCompute);
    const result = await orchestrator().run(ctx, 'x', {
      onQuestions: async (questions) => questions.map((q) => ({ ruleId: q.ruleId })),
      onApprove: async () => ({
        approved: true,
        approvedBy: 'Ziyaretçi',
        publish: false,
      }),
    });
    expect(result.stage).toBe('done');
    expect(result.published).toBe(false);
    expect(result.price!.totalMonthCost).toBeGreaterThan(0);
    expect(ctx.approval.granted).toBe(true);
  });

  it('akis olaylari sirayla kaydediliyor', async () => {
    ctx.session.addItem('compute', goodCompute);
    const result = await orchestrator().run(ctx, 'x', {
      onQuestions: async (questions) => questions.map((q) => ({ ruleId: q.ruleId })),
      onApprove: async () => ({ approved: false }),
    });
    const stages = result.events.map((event) => event.stage);
    expect(stages).toContain('audit');
    expect(stages).toContain('approve');
    expect(stages.indexOf('audit')).toBeLessThan(stages.indexOf('approve'));
  });

  it('cevaplanan sorular onRevise ile taslaga isleniyor', async () => {
    ctx.session.addItem('object-storage', {
      storage: { productCode: CODE.objectStorage, size: 1, unit: 'TB' },
    });
    let revised = false;
    await orchestrator().run(ctx, 'x', {
      onQuestions: async (questions) =>
        questions.map((q) => ({ ruleId: q.ruleId, answer: '1 TB' })),
      onRevise: async (_answers, context) => {
        revised = true;
        const item = context.session.read().list[0]!;
        context.session.updateItem(item.id, {
          network: { productCode: CODE.netOut, traffic: 1, unit: 'TB' },
        });
      },
      onApprove: async () => ({ approved: false }),
    });
    expect(revised).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6.B — Onay ekrani
// ---------------------------------------------------------------------------

describe('Faz 6.B — onay ekrani metni', () => {
  it('varsayimlar ve oneriler AYRI basliklarda listeleniyor', async () => {
    ctx.session.addItem('compute', goodCompute);
    const { priceTools } = await import('../src/mcp/tools/index.js');
    const price = priceTools.calculate(ctx);
    const state = ctx.session.read();
    const audit = await new Auditor(rules).audit({ currency: state.currency, list: state.list });

    const screen = renderApprovalScreen({
      price,
      audit,
      assumptions: [{ ruleId: 'X', question: 'Egress ne kadar?', assumed: '1 TB/ay' }],
      estimate: state,
    });

    expect(screen).toContain('TEKLIF');
    expect(screen).toContain('YAPTIGIM VARSAYIMLAR');
    expect(screen).toContain('ONERDIKLERIM');
    expect(screen).toContain('Egress ne kadar? -> 1 TB/ay');
    expect(screen).toContain('TOPLAM:');
  });

  it('varsayim yoksa baslik siliniyor degil, "yapilmadi" yaziliyor', async () => {
    ctx.session.addItem('compute', goodCompute);
    const { priceTools } = await import('../src/mcp/tools/index.js');
    const state = ctx.session.read();
    const screen = renderApprovalScreen({
      price: priceTools.calculate(ctx),
      audit: await new Auditor(rules).audit({ currency: state.currency, list: state.list }),
      assumptions: [],
      estimate: state,
    });
    expect(screen).toContain('Varsayim yapilmadi.');
  });
});
