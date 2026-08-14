/**
 * FAZ 4.A/4.B/4.C — Kural motoru
 *
 * 4.C kabul kriteri: her kural icin 1 POZITIF (tetiklenmeli) + 1 NEGATIF
 * (tetiklenmemeli) fixture; golden fixture uzerinde yanlis blocker = 0.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CODE, ROOT, RULES_YAML, makeRuleEngine } from './helpers.js';
import { RuleEngine, type EstimateLike } from '../src/core/rules/engine.js';
import type { Severity } from '../src/core/rules/types.js';
import type { ServiceCode } from '../src/core/schema/estimate.js';

const engine = makeRuleEngine();

const est = (list: { service: string; data: unknown }[]): EstimateLike => ({
  currency: 'TL',
  list: list.map((item, index) => ({
    id: `item-${index}`,
    service: item.service as ServiceCode,
    data: item.data as Record<string, unknown>,
  })),
});

const firedRules = (estimate: EstimateLike): string[] =>
  engine.check(estimate).gaps.map((g) => g.ruleId);

// ---------------------------------------------------------------------------
// Yapisal kabul kriterleri
// ---------------------------------------------------------------------------

describe('Faz 4.A — kural dosyasi yapisi', () => {
  const rules = engine.listRules();

  it('en az 15 kural var', () => {
    expect(rules.length).toBeGreaterThanOrEqual(15);
  });

  it('her kuralin id, severity ve message alani dolu', () => {
    for (const rule of rules) {
      expect(rule.id, 'id').toBeTruthy();
      expect(rule.message.trim().length, `${rule.id} message`).toBeGreaterThan(10);
      expect(['blocker', 'recommended', 'optional']).toContain(rule.severity);
    }
  });

  it('kural id\'leri benzersiz', () => {
    const ids = rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('Faz 4.B — her severity icin en az 3 kural var', () => {
    const bySeverity = (s: Severity): number => rules.filter((r) => r.severity === s).length;
    expect(bySeverity('blocker'), 'blocker').toBeGreaterThanOrEqual(3);
    expect(bySeverity('recommended'), 'recommended').toBeGreaterThanOrEqual(3);
    expect(bySeverity('optional'), 'optional').toBeGreaterThanOrEqual(3);
  });

  it('Faz 6.A — soru soran her kuralin bir varsayilani var', () => {
    // "Satisci 5 sorunun tamamini atlayabiliyor" kriteri, her sorunun
    // varsayilanli olmasina bagli.
    for (const rule of rules) {
      if (rule.ask) expect(rule.default, `${rule.id} ask var ama default yok`).toBeTruthy();
    }
  });

  it('kural motoru LLM\'siz ve bagimsiz calisiyor (katalogsuz da yuklenebiliyor)', () => {
    const standalone = makeRuleEngine();
    expect(standalone.ruleCount).toBe(engine.ruleCount);
  });
});

// ---------------------------------------------------------------------------
// 4.C — kural basina pozitif / negatif
// ---------------------------------------------------------------------------

interface RuleCase {
  ruleId: string;
  positive: { service: string; data: unknown }[];
  negative: { service: string; data: unknown }[];
}

const compute = (extra: Record<string, unknown> = {}) => ({
  service: 'compute',
  data: { productCode: CODE.flavorMedium, count: 2, ...extra },
});

const storageSpec = { productCode: CODE.volumePremium, size: 100, unit: 'GB' };
const networkSpec = { productCode: CODE.netOut, traffic: 500, unit: 'GB' };

const CASES: RuleCase[] = [
  {
    ruleId: 'UNKNOWN_PRODUCT_CODE',
    positive: [{ service: 'compute', data: { productCode: CODE.bogus, count: 1 } }],
    negative: [compute()],
  },
  {
    // NOT: bilinmeyen kod hem bu kurali hem UNKNOWN_PRODUCT_CODE'u tetikler.
    // Ortusme kasitli: biri kodu, digeri sonucu yakalar (savunma derinligi).
    ruleId: 'ZERO_COST_ITEM',
    positive: [{ service: 'compute', data: { productCode: CODE.bogus, count: 1 } }],
    negative: [compute()],
  },
  {
    ruleId: 'OBJ_STORAGE_NO_TRANSFER',
    positive: [{ service: 'object-storage', data: { storage: { productCode: CODE.objectStorage, size: 1, unit: 'TB' } } }],
    negative: [
      {
        service: 'object-storage',
        data: { storage: { productCode: CODE.objectStorage, size: 1, unit: 'TB' }, network: networkSpec },
      },
    ],
  },
  {
    ruleId: 'OBJ_STORAGE_EMPTY',
    positive: [{ service: 'object-storage', data: {} }],
    negative: [{ service: 'object-storage', data: { storage: { productCode: CODE.objectStorage, size: 1, unit: 'TB' }, network: networkSpec } }],
  },
  {
    ruleId: 'BACKUP_ZERO_COUNT',
    positive: [{ service: 'backup', data: { productCode: CODE.backup, sourceSize: 500, unit: 'GB', estimatedCount: 0 } }],
    negative: [{ service: 'backup', data: { productCode: CODE.backup, sourceSize: 500, unit: 'GB', estimatedCount: 4 } }],
  },
  {
    ruleId: 'COMPUTE_BACKUP_ZERO_COUNT',
    positive: [compute({ backup: { productCode: CODE.backup, sourceSize: 100, estimatedCount: 0 } })],
    negative: [compute({ backup: { productCode: CODE.backup, sourceSize: 100, estimatedCount: 4 } })],
  },
  {
    ruleId: 'COMPUTE_BACKUP_TB_IGNORED',
    positive: [compute({ backup: { productCode: CODE.backup, sourceSize: 2, unit: 'TB', estimatedCount: 4 } })],
    negative: [compute({ backup: { productCode: CODE.backup, sourceSize: 2048, unit: 'GB', estimatedCount: 4 } })],
  },
  {
    ruleId: 'FLOATING_IP_DOUBLE_COUNT',
    positive: [
      { service: 'floating-ip', data: { productCode: CODE.floatingIp, count: 2 } },
      compute({ floatingIp: { productCode: CODE.floatingIp, count: 2 } }),
    ],
    negative: [compute({ floatingIp: { productCode: CODE.floatingIp, count: 2 } })],
  },
  {
    ruleId: 'ROUTER_EMPTY',
    positive: [{ service: 'router', data: {} }],
    negative: [{ service: 'router', data: { network: networkSpec } }],
  },
  {
    ruleId: 'COMPUTE_NO_BLOCK_STORAGE',
    positive: [compute()],
    negative: [compute({ storage: storageSpec })],
  },
  {
    ruleId: 'COMPUTE_NO_TRANSFER',
    positive: [compute()],
    negative: [
      compute(),
      { service: 'router', data: { network: networkSpec } },
    ],
  },
  {
    ruleId: 'LB_NO_TRANSFER',
    positive: [{ service: 'load-balancer', data: { productCode: CODE.lbApp } }],
    negative: [
      { service: 'load-balancer', data: { productCode: CODE.lbApp } },
      { service: 'router', data: { network: networkSpec } },
    ],
  },
  {
    ruleId: 'LB_WITHOUT_HA',
    positive: [
      { service: 'load-balancer', data: { productCode: CODE.lbApp } },
      { service: 'compute', data: { productCode: CODE.flavorSmall, count: 1 } },
    ],
    negative: [
      { service: 'load-balancer', data: { productCode: CODE.lbApp } },
      { service: 'compute', data: { productCode: CODE.flavorSmall, count: 3 } },
    ],
  },
  {
    ruleId: 'NO_PUBLIC_ACCESS',
    positive: [compute()],
    negative: [compute({ floatingIp: { productCode: CODE.floatingIp, count: 1 } })],
  },
  {
    ruleId: 'K8S_WORKER_NO_STORAGE',
    positive: [
      {
        service: 'kubernetes',
        data: {
          master: { productCode: CODE.flavorMedium, count: 1 },
          worker: { productCode: CODE.flavorMedium, count: 3 },
        },
      },
    ],
    negative: [
      {
        service: 'kubernetes',
        data: {
          master: { productCode: CODE.flavorMedium, count: 1 },
          worker: { productCode: CODE.flavorMedium, count: 3, storage: storageSpec },
        },
      },
    ],
  },
  {
    ruleId: 'NO_BACKUP_ANYWHERE',
    positive: [compute()],
    negative: [compute({ backup: { productCode: CODE.backup, sourceSize: 100, estimatedCount: 4 } })],
  },
  {
    ruleId: 'SUGGEST_LOAD_BALANCER',
    positive: [compute()],
    negative: [compute(), { service: 'load-balancer', data: { productCode: CODE.lbApp } }],
  },
  {
    ruleId: 'SUGGEST_OBJECT_STORAGE',
    positive: [compute()],
    negative: [
      compute(),
      {
        service: 'object-storage',
        data: { storage: { productCode: CODE.objectStorage, size: 1, unit: 'TB' }, network: networkSpec },
      },
    ],
  },
  {
    ruleId: 'CONSIDER_BLOCK_STORAGE_FOR_OBJECT_WORKLOAD',
    positive: [
      {
        service: 'object-storage',
        data: { storage: { productCode: CODE.objectStorage, size: 1, unit: 'TB' }, network: networkSpec },
      },
    ],
    negative: [compute({ storage: storageSpec })],
  },
  {
    ruleId: 'SUGGEST_PREMIUM_SSD',
    positive: [compute({ storage: { productCode: CODE.volumeStandard, size: 100, unit: 'GB' } })],
    negative: [compute({ storage: storageSpec })],
  },
  {
    ruleId: 'SUGGEST_BACKUP_FOR_STORAGE',
    positive: [{ service: 'storage', data: { productCode: CODE.volumePremium, size: 500, unit: 'GB' } }],
    negative: [
      { service: 'storage', data: { productCode: CODE.volumePremium, size: 500, unit: 'GB' } },
      { service: 'backup', data: { productCode: CODE.backup, sourceSize: 500, unit: 'GB', estimatedCount: 4 } },
    ],
  },
];

describe('Faz 4.C — her kural icin pozitif/negatif regresyon', () => {
  it('YAML\'daki her kuralin bir test vakasi var', () => {
    const covered = new Set(CASES.map((c) => c.ruleId));
    const uncovered = engine.listRules().map((r) => r.id).filter((id) => !covered.has(id));
    expect(uncovered, 'test vakasi olmayan kurallar').toEqual([]);
  });

  for (const testCase of CASES) {
    it(`${testCase.ruleId} — POZITIF: tetikleniyor`, () => {
      expect(firedRules(est(testCase.positive))).toContain(testCase.ruleId);
    });

    it(`${testCase.ruleId} — NEGATIF: tetiklenmiyor`, () => {
      expect(firedRules(est(testCase.negative))).not.toContain(testCase.ruleId);
    });
  }
});

// ---------------------------------------------------------------------------
// 4.C — yanlis pozitif olcumu
// ---------------------------------------------------------------------------

describe('Faz 4.C — yanlis pozitif blocker sayisi = 0', () => {
  it('canli golden fixture uzerinde hic blocker yok', () => {
    const golden = JSON.parse(
      readFileSync(join(ROOT, 'fixtures', 'golden', 'live-01-compute-storage-backup.json'), 'utf8'),
    ) as { currency: 'TL' | 'USD'; service: ServiceCode; data: Record<string, unknown> };

    const report = engine.check({
      currency: golden.currency,
      list: [{ id: 'g1', service: golden.service, data: golden.data }],
    });

    expect(report.blockers.map((b) => b.ruleId)).toEqual([]);
    expect(report.publishable).toBe(true);
  });

  it('iyi kurulmus tam bir teklifte blocker yok', () => {
    const report = engine.check(
      est([
        { service: 'load-balancer', data: { productCode: CODE.lbApp, network: networkSpec } },
        compute({
          storage: storageSpec,
          network: networkSpec,
          floatingIp: { productCode: CODE.floatingIp, count: 1 },
          backup: { productCode: CODE.backup, sourceSize: 100, unit: 'GB', estimatedCount: 4 },
        }),
        {
          service: 'object-storage',
          data: { storage: { productCode: CODE.objectStorage, size: 1, unit: 'TB' }, network: networkSpec },
        },
      ]),
    );
    expect(report.blockers.map((b) => b.ruleId)).toEqual([]);
  });

  it('bos teklif blocker uretmiyor', () => {
    expect(engine.check(est([])).blockers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rapor davranisi
// ---------------------------------------------------------------------------

describe('Faz 4.B — severity semantigi', () => {
  it('blocker varsa publishable = false', () => {
    const report = engine.check(est([{ service: 'object-storage', data: {} }]));
    expect(report.blockers.length).toBeGreaterThan(0);
    expect(report.publishable).toBe(false);
  });

  it('yalnizca recommended/optional varsa publishable = true', () => {
    const report = engine.check(est([compute()]));
    expect(report.blockers).toEqual([]);
    expect(report.recommended.length).toBeGreaterThan(0);
    expect(report.publishable).toBe(true);
  });

  it('gaps severity sirasina gore: blocker once', () => {
    const report = engine.check(est([{ service: 'object-storage', data: {} }, compute()]));
    const severities = report.gaps.map((g) => g.severity);
    const firstRecommended = severities.indexOf('recommended');
    const lastBlocker = severities.lastIndexOf('blocker');
    expect(lastBlocker).toBeLessThan(firstRecommended === -1 ? Infinity : firstRecommended);
  });

  it('kalem bazli Gap ilgili kalemin id\'sini tasiyor', () => {
    const report = engine.check(est([{ service: 'object-storage', data: {} }]));
    const gap = report.gaps.find((g) => g.ruleId === 'OBJ_STORAGE_NO_TRANSFER');
    expect(gap?.itemId).toBe('item-0');
    expect(gap?.service).toBe('object-storage');
  });

  it('soru soran Gap, ask ve default alanlarini tasiyor', () => {
    const report = engine.check(est([{ service: 'object-storage', data: {} }]));
    const gap = report.gaps.find((g) => g.ruleId === 'OBJ_STORAGE_NO_TRANSFER');
    expect(gap?.ask).toContain('egress');
    expect(gap?.default).toBeTruthy();
  });
});

describe('Faz 4 — determinizm', () => {
  it('ayni teklif her calistirmada ayni Gap listesini veriyor', () => {
    const estimate = est([compute({ storage: storageSpec }), { service: 'object-storage', data: {} }]);
    const first = JSON.stringify(engine.check(estimate));
    for (let i = 0; i < 5; i++) {
      expect(JSON.stringify(engine.check(estimate))).toBe(first);
    }
  });

  it('katalogsuz da calisiyor — fiyat gerektiren kurallar sessizce atlanir', () => {
    // Kural motoru bagimsiz calistirilabilir olmali (4.C kriteri).
    const withoutCatalog = RuleEngine.fromYaml(RULES_YAML);
    const report = withoutCatalog.check(est([compute()]));
    expect(report.gaps.length).toBeGreaterThan(0);
    // itemMonthly() undefined doner -> ZERO_COST_ITEM tetiklenmez, patlamaz.
    expect(report.gaps.map((g) => g.ruleId)).not.toContain('ZERO_COST_ITEM');
  });
});
