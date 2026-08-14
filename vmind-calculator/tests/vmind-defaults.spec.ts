import { describe, expect, it } from 'vitest';

import {
  applyVmindStrongProfile,
  resolveAuditAnswer,
  resolveClarificationAnswers,
  vmindRecommendedAuditAnswer,
} from '../src/agents/vmind-defaults.js';
import type { AuditQuestion, CriticalUnknown } from '../src/agents/types.js';
import { EstimateSession } from '../src/core/estimate/session.js';
import { createToolContext } from '../src/mcp/tools/index.js';
import { CODE, catalog, makeRuleEngine } from './helpers.js';

const critical = (question: string): CriticalUnknown => ({ question, reason: 'fiyati etkiler' });

describe('VMind güçlü varsayılan politikası', () => {
  it('bilmiyorum cevabini güçlü compute profiline cevirir ve kayda alir', () => {
    const question = 'Sunucu başına kaç vCPU ve kaç GB RAM gerekiyor; iş yükü nedir?';
    const result = resolveClarificationAnswers([critical(question)], { [question]: 'bilmiyorum' });
    expect(result.answers[question]).toContain('8 vCPU ve 16 GB RAM');
    expect(result.defaults).toHaveLength(1);
  });

  it('LB sorusundaki ilgisiz cevabi App LB onerisine cevirir', () => {
    const question = 'App LB mi, Net LB mi?';
    const result = resolveClarificationAnswers([critical(question)], { [question]: 'muz olsun' });
    expect(result.answers[question]).toContain('App Load Balancer');
    expect(result.defaults).toHaveLength(1);
  });

  it('gecerli ve acik musteri kararini degistirmez', () => {
    const question = 'App LB mi, Net LB mi?';
    const answer = 'TCP uygulaması için Net Load Balancer kullanılsın.';
    const result = resolveClarificationAnswers([critical(question)], { [question]: answer });
    expect(result.answers[question]).toBe(answer);
    expect(result.defaults).toHaveLength(0);
  });

  it('ag belirsizliginde tum backendleri degil yalniz uygulama edgeini public yapar', () => {
    const question =
      'Sistem yalnızca internal/özel ağda mı kalacak, internete public mi açılacak, yoksa VPN mi?';
    const result = resolveClarificationAnswers([critical(question)], { [question]: 'siz seçin' });
    expect(result.answers[question]).toContain('web/API/uygulama rolleri');
    expect(result.answers[question]).toContain('VPN/internal özel ağda kalsın');
    expect(result.answers[question]).toContain('doğrudan public IP verilmesin');
  });

  it('kullanici public rol adlarini yazarsa eksik ag fiyatlarini guvenli varsayimla tamamlar', () => {
    const question = 'Sunucularınıza internetten nasıl erişilsin?';
    const answer = 'web-1 ve Customer API load balancer üzerinden public, database VPN’de kalsın.';
    const result = resolveClarificationAnswers([critical(question)], { [question]: answer });
    expect(result.answers[question]).toContain(answer);
    expect(result.answers[question]).toContain('1 Floating IP');
    expect(result.answers[question]).toContain('1 TB outbound');
    expect(result.defaults).toHaveLength(1);
  });

  it('public oldugu bilinen sistemde eksik FIP ve trafik cevabini public profil ile tamamlar', () => {
    const question =
      'Public erişimde kaç internet giriş noktası/Floating IP kullanılacak ve outbound trafik kaç GB olacak?';
    const result = resolveClarificationAnswers(
      [critical(question)],
      { [question]: 'bilmiyorum' },
      'public',
    );
    expect(result.answers[question]).toContain('1 Floating IP');
    expect(result.answers[question]).toContain('1 TB outbound');
  });

  it('bos veya mantiksiz audit cevabinda premium varsayilani uygular', () => {
    const question: AuditQuestion = {
      ruleId: 'NO_BACKUP_ANYWHERE',
      question: 'Yedekleme dahil edilsin mi?',
      defaultAnswer: 'Yedekleme eklenmeyecek',
      severity: 'recommended',
    };
    expect(resolveAuditAnswer(question, 'ne bileyim')).toMatchObject({
      usedVmindDefault: true,
      answer: expect.stringContaining('ayda 4 yedek'),
    });
    expect(resolveAuditAnswer(question, 'Hayır, yedek istemiyorum.')).toEqual({
      answer: 'Hayır, yedek istemiyorum.',
      usedVmindDefault: false,
    });
  });

  it('auditor arayuzunde eski ucuz default yerine VMind onerisi gorunur', () => {
    expect(vmindRecommendedAuditAnswer('COMPUTE_NO_BLOCK_STORAGE', 'Ek disk eklenmeyecek')).toContain(
      '500 GB Premium SSD',
    );
    expect(vmindRecommendedAuditAnswer('BILINMEYEN', 'orijinal')).toBe('orijinal');
  });

  it('NLPnin sessiz sectigi ucuz diski premium guclu profile yukseltir', async () => {
    const ctx = createToolContext(catalog, makeRuleEngine(), {
      session: new EstimateSession(catalog, { currency: 'TL' }),
    });
    ctx.session.addItem('compute', {
      productCode: CODE.flavorSmall,
      count: 2,
      storage: {
        productCode: CODE.volumeStandard,
        size: 100,
        unit: 'GB',
        volumeTypeName: 'PortvMind-Standard-HDD',
      },
    });

    const result = await applyVmindStrongProfile(
      ctx,
      {
        compute: { count: 2 },
        networkExposure: 'internal',
        unknowns: [],
        rationale: 'disk belirtilmedi',
      },
      'müşteri bilmiyor; VMind seçsin',
    );

    expect(result.changed).toBe(true);
    const state = ctx.session.read();
    const compute = state.list.find((item) => item.service === 'compute')!;
    const flavor = catalog.flavors.find((candidate) => candidate.id === compute.data['productCode'])!;
    expect(flavor.vcpus).toBeGreaterThanOrEqual(8);
    expect(flavor.ram / 1024).toBeGreaterThanOrEqual(16);
    expect(compute.data['storage']).toMatchObject({
      productCode: CODE.volumePremium,
      size: 500,
      unit: 'GB',
    });
    expect(compute.data).not.toHaveProperty('backup');
    const backup = state.list.find((item) => item.service === 'backup')!;
    expect(backup.data).toMatchObject({
      productCode: CODE.backup,
      sourceSize: 1000,
      unit: 'GB',
      estimatedCount: 4,
    });
    expect(state.list.map((item) => item.service)).toEqual([
      'compute',
      'load-balancer',
      'router',
      'backup',
    ]);
  });

  it('Designer ayri backup eklediyse guclu profil backupi ikinci kez fiyatlamaz', async () => {
    const ctx = createToolContext(catalog, makeRuleEngine(), {
      session: new EstimateSession(catalog, { currency: 'TL' }),
    });
    ctx.session.addItem('compute', {
      productCode: CODE.flavorSmall,
      count: 2,
      storage: { productCode: CODE.volumePremium, size: 500, unit: 'GB' },
    });
    ctx.session.addItem('backup', {
      productCode: CODE.backup,
      sourceSize: 1000,
      unit: 'GB',
      estimatedCount: 4,
    });

    await applyVmindStrongProfile(
      ctx,
      {
        compute: { count: 2, storage: { tier: 'premium', sizeGbPerInstance: 500 } },
        networkExposure: 'internal',
        unknowns: [],
        rationale: 'backup zaten tasarlandi',
      },
      'müşteri diğer soruyu bilmiyor; VMind seçsin',
    );

    const backups = ctx.session.read().list.filter((item) => item.service === 'backup');
    expect(backups).toHaveLength(1);
    expect(backups[0]?.data).toMatchObject({ sourceSize: 1000, estimatedCount: 4 });
  });
});
