/**
 * FAZ 3 — Tool katmani kabul kriterleri
 *
 * 3.A: salt-okunur tool'lar cache'ten calisiyor, ortalama < 50 ms, yazma yok
 * 3.B: addItem gecersiz productCode'u REDDEDIYOR, mutasyonlar geri alinabiliyor
 * 3.C: publish.* HITL onayi olmadan REDDEDILIYOR, dry_run varsayilan
 */
import { describe, expect, it, beforeEach } from 'vitest';

import { CODE, catalog, makeRuleEngine } from './helpers.js';
import {
  ApprovalRequiredError,
  BlockersPresentError,
  callTool,
  createToolContext,
  MUTATING_TOOLS,
  TOOL_SCHEMAS,
  WRITING_TOOLS,
  type ToolContext,
  type ToolName,
} from '../src/mcp/tools/index.js';
import { EstimateSession, SchemaValidationError } from '../src/core/estimate/session.js';
import { UnknownProductCodeError } from '../src/core/catalog/catalog.js';
import { PlatformApiClient, WriteNotAllowedError } from '../src/platform/api-client.js';

const rules = makeRuleEngine();

let ctx: ToolContext;
beforeEach(() => {
  ctx = createToolContext(catalog, rules, { session: new EstimateSession(catalog, { currency: 'TL' }) });
});

/** Blocker uretmeyen, tam kurulmus bir compute kalemi. */
const goodCompute = {
  productCode: CODE.flavorMedium,
  count: 3,
  storage: { productCode: CODE.volumePremium, size: 100, unit: 'GB' },
  network: { productCode: CODE.netOut, traffic: 500, unit: 'GB' },
  floatingIp: { productCode: CODE.floatingIp, count: 1 },
  backup: { productCode: CODE.backup, sourceSize: 100, unit: 'GB', estimatedCount: 4 },
};

// ---------------------------------------------------------------------------
// 3.A
// ---------------------------------------------------------------------------

describe('Faz 3.A — salt-okunur katalog tool\'lari', () => {
  it('listServices 9 servisi donduruyor', async () => {
    const services = (await callTool(ctx, 'catalog.listServices', {})) as { code: string }[];
    expect(services).toHaveLength(9);
    expect(services.map((s) => s.code)).toContain('object-storage');
  });

  it('searchFlavors GPU filtresi calisiyor ve productCode olarak flavor.id veriyor', async () => {
    const flavors = (await callTool(ctx, 'catalog.searchFlavors', { gpu: true })) as {
      productCode: string;
      gpus: number;
    }[];
    expect(flavors.length).toBeGreaterThan(0);
    expect(flavors.every((f) => f.gpus > 0)).toBe(true);
    // Dondurulen kod dogrudan estimate.addItem'a verilebilmeli.
    expect(flavors.every((f) => catalog.has(f.productCode))).toBe(true);
  });

  it('searchProducts secili para biriminde fiyat donduruyor', async () => {
    const products = (await callTool(ctx, 'catalog.searchProducts', { query: 'Loadbalancer' })) as {
      productCode: string;
      price: number;
      currency: string;
    }[];
    expect(products.length).toBeGreaterThan(0);
    expect(products.every((p) => typeof p.price === 'number')).toBe(true);
    expect(products.every((p) => p.currency === 'TL')).toBe(true);
  });

  it('listVolumeTypes iki tipi de veriyor', async () => {
    const types = (await callTool(ctx, 'catalog.listVolumeTypes', {})) as { name: string }[];
    expect(types.map((t) => t.name)).toEqual(['PortvMind-Standard-HDD', 'PortvMind-Premium-SSD']);
  });

  it('ortalama < 50 ms (cache\'ten, ag yok)', async () => {
    const start = performance.now();
    const runs = 50;
    for (let i = 0; i < runs; i++) {
      await callTool(ctx, 'catalog.searchFlavors', { minVcpu: 2 });
      await callTool(ctx, 'catalog.searchProducts', { query: 'volume' });
    }
    const average = (performance.now() - start) / (runs * 2);
    expect(average).toBeLessThan(50);
  });

  it('salt-okunur tool\'lar state\'i degistirmiyor', async () => {
    const before = JSON.stringify(await callTool(ctx, 'estimate.read', {}));
    await callTool(ctx, 'catalog.listServices', {});
    await callTool(ctx, 'catalog.searchFlavors', {});
    await callTool(ctx, 'catalog.searchProducts', { query: 'x' });
    await callTool(ctx, 'catalog.listVolumeTypes', {});
    expect(JSON.stringify(await callTool(ctx, 'estimate.read', {}))).toBe(before);
  });

  it('okuma tool\'lari MUTATING listesinde degil', () => {
    for (const name of ['catalog.listServices', 'catalog.searchProducts', 'price.calculate', 'validate.check'] as ToolName[]) {
      expect(MUTATING_TOOLS.has(name), name).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 3.B
// ---------------------------------------------------------------------------

describe('Faz 3.B — yerel state tool\'lari', () => {
  it('addItem gecerli kalemi ekliyor', async () => {
    const item = (await callTool(ctx, 'estimate.addItem', { service: 'compute', data: goodCompute })) as {
      id: string;
      service: string;
    };
    expect(item.service).toBe('compute');
    expect(ctx.session.itemCount).toBe(1);
  });

  it('addItem UYDURMA productCode\'u REDDEDIYOR', async () => {
    await expect(
      callTool(ctx, 'estimate.addItem', { service: 'compute', data: { productCode: CODE.bogus, count: 1 } }),
    ).rejects.toThrow(UnknownProductCodeError);
    expect(ctx.session.itemCount).toBe(0);
  });

  it('addItem ic ice uydurma kodu da reddediyor', async () => {
    await expect(
      callTool(ctx, 'estimate.addItem', {
        service: 'compute',
        data: { productCode: CODE.flavorSmall, count: 1, storage: { productCode: CODE.bogus, size: 10, unit: 'GB' } },
      }),
    ).rejects.toThrow(UnknownProductCodeError);
  });

  it('addItem sema disi veriyi reddediyor (MB birimi)', async () => {
    await expect(
      callTool(ctx, 'estimate.addItem', {
        service: 'storage',
        data: { productCode: CODE.volumePremium, size: 100, unit: 'MB' },
      }),
    ).rejects.toThrow(SchemaValidationError);
  });

  it('reddedilen ekleme state\'i kirletmiyor', async () => {
    await callTool(ctx, 'estimate.addItem', { service: 'compute', data: goodCompute });
    await expect(
      callTool(ctx, 'estimate.addItem', { service: 'compute', data: { productCode: CODE.bogus, count: 1 } }),
    ).rejects.toThrow();
    expect(ctx.session.itemCount).toBe(1);
  });

  it('updateItem birlesik sonucu yeniden dogruluyor', async () => {
    const item = (await callTool(ctx, 'estimate.addItem', { service: 'compute', data: goodCompute })) as { id: string };
    await expect(
      callTool(ctx, 'estimate.updateItem', {
        itemId: item.id,
        patch: { storage: { productCode: CODE.bogus, size: 1, unit: 'GB' } },
      }),
    ).rejects.toThrow(UnknownProductCodeError);
  });

  it('TUM mutasyonlar geri alinabiliyor (undo log)', async () => {
    await callTool(ctx, 'estimate.addItem', { service: 'compute', data: goodCompute });
    await callTool(ctx, 'estimate.addItem', {
      service: 'load-balancer',
      data: { productCode: CODE.lbApp },
    });
    expect(ctx.session.itemCount).toBe(2);

    await callTool(ctx, 'estimate.undo', {});
    expect(ctx.session.itemCount).toBe(1);

    await callTool(ctx, 'estimate.undo', {});
    expect(ctx.session.itemCount).toBe(0);

    const result = (await callTool(ctx, 'estimate.undo', {})) as { undone: boolean };
    expect(result.undone).toBe(false);
  });

  it('removeItem geri alinabiliyor', async () => {
    const item = (await callTool(ctx, 'estimate.addItem', { service: 'compute', data: goodCompute })) as { id: string };
    await callTool(ctx, 'estimate.removeItem', { itemId: item.id });
    expect(ctx.session.itemCount).toBe(0);
    await callTool(ctx, 'estimate.undo', {});
    expect(ctx.session.itemCount).toBe(1);
  });

  it('estimate.read derin kopya veriyor — disaridan bozulamiyor', async () => {
    await callTool(ctx, 'estimate.addItem', { service: 'compute', data: goodCompute });
    const state = (await callTool(ctx, 'estimate.read', {})) as { list: unknown[] };
    state.list.length = 0;
    expect(ctx.session.itemCount).toBe(1);
  });

  it('para birimi degisimi, yeni birimde fiyati olmayan urun varsa reddediliyor', () => {
    const session = new EstimateSession(catalog, { currency: 'TL' });
    session.addItem('load-balancer', { productCode: CODE.lbApp });
    // LB-001'in EUR fiyati yok; sema zaten EUR'a izin vermiyor, ama alt katman da korumali.
    expect(() => session.setCurrency('EUR' as never)).toThrow();
  });

  it('price.calculate tutar ve satir kirilimi donduruyor', async () => {
    await callTool(ctx, 'estimate.addItem', { service: 'compute', data: goodCompute });
    const price = (await callTool(ctx, 'price.calculate', {})) as {
      totalMonthCost: number;
      lines: unknown[];
    };
    expect(price.totalMonthCost).toBeGreaterThan(0);
    expect(price.lines.length).toBeGreaterThan(1);
  });

  it('validate.check kural motorunu calistiriyor', async () => {
    await callTool(ctx, 'estimate.addItem', { service: 'object-storage', data: {} });
    const report = (await callTool(ctx, 'validate.check', {})) as { blockers: { ruleId: string }[] };
    expect(report.blockers.map((b) => b.ruleId)).toContain('OBJ_STORAGE_NO_TRANSFER');
  });
});

// ---------------------------------------------------------------------------
// 3.C — HITL kapisi
// ---------------------------------------------------------------------------

describe('Faz 3.C — yayinlama HITL kapisi', () => {
  it('dry_run VARSAYILAN true — parametresiz cagri yazmiyor', async () => {
    await callTool(ctx, 'estimate.addItem', { service: 'compute', data: goodCompute });
    const result = (await callTool(ctx, 'publish.save', {})) as { dryRun: boolean; shareUrl: string };
    expect(result.dryRun).toBe(true);
    expect(result.shareUrl).toContain('/my-estimate/');
  });

  it('onaysiz gercek yazma REDDEDILIYOR', async () => {
    await callTool(ctx, 'estimate.addItem', { service: 'compute', data: goodCompute });
    await expect(callTool(ctx, 'publish.save', { dryRun: false })).rejects.toThrow(ApprovalRequiredError);
  });

  it('cozulmemis blocker varsa yayinlanamiyor (dry_run\'da bile)', async () => {
    await callTool(ctx, 'estimate.addItem', { service: 'object-storage', data: {} });
    await expect(callTool(ctx, 'publish.save', {})).rejects.toThrow(BlockersPresentError);
  });

  it('blocker varken ONAY dahi alinamiyor', async () => {
    await callTool(ctx, 'estimate.addItem', { service: 'object-storage', data: {} });
    await expect(callTool(ctx, 'approval.grant', { approvedBy: 'satisci@vmind' })).rejects.toThrow(
      BlockersPresentError,
    );
    expect(ctx.approval.granted).toBe(false);
  });

  it('onay alindiktan sonra bile API istemcisi salt-okunursa yazma engelleniyor', async () => {
    ctx.client = new PlatformApiClient(); // allowWrites varsayilan false
    await callTool(ctx, 'estimate.addItem', { service: 'compute', data: goodCompute });
    await callTool(ctx, 'approval.grant', { approvedBy: 'satisci@vmind' });
    await expect(callTool(ctx, 'publish.save', { dryRun: false })).rejects.toThrow(WriteNotAllowedError);
  });

  it('onay geri alinabiliyor', async () => {
    await callTool(ctx, 'estimate.addItem', { service: 'compute', data: goodCompute });
    await callTool(ctx, 'approval.grant', { approvedBy: 'satisci@vmind' });
    expect(ctx.approval.granted).toBe(true);
    await callTool(ctx, 'approval.revoke', {});
    expect(ctx.approval.granted).toBe(false);
    await expect(callTool(ctx, 'publish.save', { dryRun: false })).rejects.toThrow(ApprovalRequiredError);
  });

  it('yeni oturum onaysiz basliyor', () => {
    expect(createToolContext(catalog, rules).approval.granted).toBe(false);
  });

  it('publish.save tek yazma tool\'u', () => {
    expect([...WRITING_TOOLS]).toEqual(['publish.save']);
  });
});

describe('Faz 3 — tool sozlesmesi', () => {
  it('her tool adinin bir girdi semasi var', () => {
    const names = Object.keys(TOOL_SCHEMAS) as ToolName[];
    expect(names.length).toBeGreaterThanOrEqual(14);
    for (const name of names) expect(TOOL_SCHEMAS[name]).toBeDefined();
  });

  it('gecersiz tool girdisi sema seviyesinde reddediliyor', async () => {
    await expect(callTool(ctx, 'estimate.addItem', { service: 'boyle-bir-servis-yok', data: {} })).rejects.toThrow();
    await expect(callTool(ctx, 'approval.grant', { approvedBy: '' })).rejects.toThrow();
  });
});
