/**
 * Solution Reviser testleri.
 *
 * Bu ajanin varlik sebebi bir HATA: orchestrator `onRevise`'i bastan beri
 * cagiriyordu ama hicbir uretim kodu saglamiyordu. Sonuc, satiscinin cevabinin
 * SESSIZCE yok sayilmasiydi. O yuzden testlerin merkezinde tek soru var:
 * "cevap teklife gercekten islendi mi?"
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Catalog } from '../src/core/catalog/catalog.js';
import { RuleEngine } from '../src/core/rules/engine.js';
import { EstimateSession } from '../src/core/estimate/session.js';
import { createToolContext, priceTools, type ToolContext } from '../src/mcp/tools/index.js';
import { SolutionReviser, buildRevisePrompt } from '../src/agents/reviser.js';
import { FakeLlm } from './fake-llm.js';
import type { AuditQuestion } from '../src/agents/types.js';
import type { ApiEnvelope, Flavor, Product, VolumeType } from '../src/core/catalog/types.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = <T>(name: string): ApiEnvelope<T> =>
  JSON.parse(readFileSync(join(root, 'fixtures', 'catalog', name), 'utf8'));

const catalog = Catalog.fromEnvelopes(
  read<Product>('products.json'),
  read<Flavor>('flavors.json'),
  read<VolumeType>('volume-types.json'),
);
const rules = RuleEngine.fromYaml(
  readFileSync(join(root, 'rules', 'estimate-rules.yaml'), 'utf8'),
  catalog,
);

const FLAVOR = 'fd9ee6ed-a56d-483e-98c9-1a05d634ffcb'; // g1.medium
const QUESTIONS: AuditQuestion[] = [
  {
    ruleId: 'COMPUTE_NO_TRANSFER',
    severity: 'recommended',
    question: 'Sunuculardan aylik ne kadar veri disari cikacak?',
    defaultAnswer: '500 GB/ay varsayilacak',
  },
];

let ctx: ToolContext;

beforeEach(() => {
  const session = new EstimateSession(catalog, { currency: 'TL' });
  // Bilerek trafiksiz bir compute kalemi: COMPUTE_NO_TRANSFER'in konusu.
  session.addItem('compute', { productCode: FLAVOR, count: 2 });
  ctx = createToolContext(catalog, rules, { session });
});

describe('SolutionReviser — cevap teklife ISLENIYOR', () => {
  it('yedek cevabini compute icine degil teklif sonunda ayri Backup hizmetine yazar', async () => {
    const compute = ctx.session.read().list[0]!;
    ctx.session.updateItem(compute.id, {
      storage: { productCode: '096439fe-26d6-4bd0-bdf0-11e40f73753e', size: 200, unit: 'GB' },
    });
    const llm = new FakeLlm({ toolPlan: [], finalText: '' });

    await new SolutionReviser(llm).revise(
      ctx,
      [{ ruleId: 'NO_BACKUP_ANYWHERE', answer: 'Evet, ayda 4 yedek olsun.' }],
      [
        {
          ruleId: 'NO_BACKUP_ANYWHERE',
          severity: 'recommended',
          question: 'Yedekleme dahil edilsin mi?',
          defaultAnswer: 'Ayda 4 yedek',
        },
      ],
    );

    const state = ctx.session.read();
    expect(state.list[0]?.data).not.toHaveProperty('backup');
    expect(state.list.at(-1)).toMatchObject({
      service: 'backup',
      data: { productCode: 'BC-001', sourceSize: 400, unit: 'GB', estimatedCount: 4 },
    });
  });

  it('miktar cevabi compute kalemine yaziliyor ve FIYAT DEGISIYOR', async () => {
    const before = priceTools.calculate(ctx).totalMonthCost;
    const itemId = ctx.session.read().list[0]!.id;

    const llm = new FakeLlm({
      toolPlan: [
        { name: 'estimate_read', input: {} },
        {
          name: 'estimate_updateItem',
          input: {
            itemId,
            patch: { network: { productCode: 'NETW-OUT-001', traffic: 3, unit: 'TB' } },
          },
        },
      ],
      finalText: 'Sunucu egress 3 TB olarak eklendi.',
    });

    const result = await new SolutionReviser(llm).revise(
      ctx,
      [{ ruleId: 'COMPUTE_NO_TRANSFER', answer: '3 TB' }],
      QUESTIONS,
    );

    expect(result.rejectedToolCalls).toBe(0);
    expect(llm.toolLoopCalls).toHaveLength(0);
    const after = priceTools.calculate(ctx).totalMonthCost;
    // ASIL ISPAT: tutar degisti. Hatanin ta kendisi buydu — cevap
    // kaydediliyordu ama fiyata hic yansimiyordu.
    expect(after).toBeGreaterThan(before);
  });

  it('duzeltme sonrasi ilgili kural bulgusu KAYBOLUYOR', async () => {
    const itemId = ctx.session.read().list[0]!.id;
    const before = rules.check(ctx.session.read());
    expect(before.gaps.some((gap) => gap.ruleId === 'COMPUTE_NO_TRANSFER')).toBe(true);

    const llm = new FakeLlm({
      toolPlan: [
        {
          name: 'estimate_updateItem',
          input: {
            itemId,
            patch: { network: { productCode: 'NETW-OUT-001', traffic: 3, unit: 'TB' } },
          },
        },
      ],
      finalText: 'eklendi',
    });
    await new SolutionReviser(llm).revise(
      ctx,
      [{ ruleId: 'COMPUTE_NO_TRANSFER', answer: '3 TB' }],
      QUESTIONS,
    );

    const after = rules.check(ctx.session.read());
    expect(after.gaps.some((gap) => gap.ruleId === 'COMPUTE_NO_TRANSFER')).toBe(false);
    expect(ctx.session.read().list.find((item) => item.service === 'router')).toBeDefined();
    expect(ctx.session.read().list[0]!.data).not.toHaveProperty('network');
  });

  it('compute ve LB trafik cevaplarini iki kez degil tek Router kaleminde tutar', async () => {
    ctx.session.addItem('load-balancer', { productCode: 'LB-001' });
    const llm = new FakeLlm({ toolPlan: [], finalText: '' });
    await new SolutionReviser(llm).revise(
      ctx,
      [
        { ruleId: 'COMPUTE_NO_TRANSFER', answer: '1 TB' },
        { ruleId: 'LB_NO_TRANSFER', answer: '1 TB' },
      ],
      [
        QUESTIONS[0]!,
        {
          ruleId: 'LB_NO_TRANSFER',
          severity: 'recommended',
          question: 'Load Balancer üzerinden aylık ne kadar trafik geçecek?',
          defaultAnswer: '1 TB/ay',
        },
      ],
    );

    const withNetwork = ctx.session
      .read()
      .list.filter((item) => (item.data as Record<string, unknown>)['network'] !== undefined);
    expect(withNetwork).toHaveLength(1);
    expect(withNetwork[0]?.service).toBe('router');
  });

  it('uydurma productCode TOOL KATMANINDA reddediliyor', async () => {
    const itemId = ctx.session.read().list[0]!.id;
    const llm = new FakeLlm({
      toolPlan: [
        {
          name: 'estimate_updateItem',
          input: {
            itemId,
            patch: { network: { productCode: 'UYDURMA-KOD-999', traffic: 3, unit: 'TB' } },
          },
        },
      ],
      finalText: 'denendi',
    });

    const result = await new SolutionReviser(llm).revise(
      ctx,
      [{ ruleId: 'BILINMEYEN', answer: '3 TB' }],
      QUESTIONS,
    );
    expect(result.rejectedToolCalls).toBe(1);
    // Kalem BOZULMADAN kaldi.
    expect(ctx.session.read().list[0]!.data).not.toHaveProperty('network');
  });

  it('yetki disi tool (publish) reddediliyor', async () => {
    const llm = new FakeLlm({
      toolPlan: [{ name: 'publish_save', input: { dryRun: false } }],
      finalText: 'denendi',
    });
    const result = await new SolutionReviser(llm).revise(
      ctx,
      [{ ruleId: 'BILINMEYEN', answer: 'yayınla' }],
      QUESTIONS,
    );
    expect(result.rejectedToolCalls).toBe(1);
    expect(result.rejections[0]).toMatch(/acik degil/);
  });

  it('hicbir tool cagrilmazsa teklif AYNEN kaliyor', async () => {
    const snapshot = JSON.stringify(ctx.session.read());
    const llm = new FakeLlm({ toolPlan: [], finalText: 'Cevabi anlamadim, degisiklik yapmadim.' });

    const result = await new SolutionReviser(llm).revise(
      ctx,
      [{ ruleId: 'COMPUTE_NO_TRANSFER', answer: 'zzz' }],
      QUESTIONS,
    );
    expect(result.rejectedToolCalls).toBe(0);
    expect(JSON.stringify(ctx.session.read())).toBe(snapshot);
  });
});

describe('buildRevisePrompt', () => {
  it('soru metnini ve cevabi birlikte veriyor', () => {
    const prompt = buildRevisePrompt(ctx, [{ ruleId: 'COMPUTE_NO_TRANSFER', answer: '3 TB' }], QUESTIONS);
    // ruleId tek basina yetmez: model neyin sorulduğunu gormeli.
    expect(prompt).toContain('Sunuculardan aylik ne kadar veri disari cikacak?');
    expect(prompt).toContain('CEVAP: 3 TB');
  });

  it('teklifin su anki halini iceriyor', () => {
    const prompt = buildRevisePrompt(ctx, [], QUESTIONS);
    expect(prompt).toContain(FLAVOR);
  });

  it('soru metni bulunamasa da cokmuyor', () => {
    const prompt = buildRevisePrompt(ctx, [{ ruleId: 'BILINMEYEN', answer: 'x' }], QUESTIONS);
    expect(prompt).toContain('BILINMEYEN');
  });
});
