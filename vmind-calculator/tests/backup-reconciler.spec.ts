import { describe, expect, it } from 'vitest';

import { reconcileBackupItems } from '../src/agents/backup-reconciler.js';
import { EstimateSession } from '../src/core/estimate/session.js';
import { createToolContext, priceTools } from '../src/mcp/tools/index.js';
import { CODE, catalog, makeRuleEngine } from './helpers.js';

const makeContext = () =>
  createToolContext(catalog, makeRuleEngine(), {
    session: new EstimateSession(catalog, { currency: 'TL' }),
  });

describe('backup hizmeti uzlastirmasi', () => {
  it('compute icindeki backupi toplam kapasiteyle ayri ve son kaleme tasir, fiyati korur', async () => {
    const ctx = makeContext();
    ctx.session.addItem('compute', {
      productCode: CODE.flavorMedium,
      count: 4,
      storage: { productCode: CODE.volumePremium, size: 200, unit: 'GB' },
      backup: { productCode: CODE.backup, sourceSize: 200, estimatedCount: 4 },
    });
    ctx.session.addItem('load-balancer', { productCode: CODE.lbApp });

    const before = priceTools.calculate(ctx);
    const beforeBackup = before.lines.find((line) => line.productName === 'Backup')!;
    const result = await reconcileBackupItems(ctx);
    const after = priceTools.calculate(ctx);
    const state = ctx.session.read();

    expect(result).toMatchObject({ changed: true, protectedGb: 800, monthlyCopies: [4] });
    expect(after.totalMonthCost).toBeCloseTo(before.totalMonthCost, 8);
    expect(after.lines.find((line) => line.service === 'backup')?.monthly).toBeCloseTo(
      Number(beforeBackup.monthly),
      8,
    );
    expect(state.list.map((item) => item.service)).toEqual([
      'compute',
      'load-balancer',
      'backup',
    ]);
    expect(state.list[0]?.data).not.toHaveProperty('backup');
    expect(state.list.at(-1)?.data).toMatchObject({
      productCode: CODE.backup,
      sourceSize: 800,
      unit: 'GB',
      estimatedCount: 4,
    });
  });

  it('ayni aylik politikadaki compute gruplarini tek gorunur backup satirinda toplar', async () => {
    const ctx = makeContext();
    ctx.session.addItem('compute', {
      productCode: CODE.flavorMedium,
      count: 2,
      backup: { productCode: CODE.backup, sourceSize: 500, estimatedCount: 4 },
    });
    ctx.session.addItem('compute', {
      productCode: CODE.flavorSmall,
      count: 3,
      backup: { productCode: CODE.backup, sourceSize: 100, estimatedCount: 4 },
    });

    await reconcileBackupItems(ctx);
    const backups = ctx.session.read().list.filter((item) => item.service === 'backup');
    expect(backups).toHaveLength(1);
    expect(backups[0]?.data).toMatchObject({ sourceSize: 1300, unit: 'GB', estimatedCount: 4 });
  });

  it('farkli aylik politikalari ayri satirlar halinde tutar ve hepsini sona alir', async () => {
    const ctx = makeContext();
    ctx.session.addItem('backup', {
      productCode: CODE.backup,
      sourceSize: 1,
      unit: 'TB',
      estimatedCount: 14,
    });
    ctx.session.addItem('compute', {
      productCode: CODE.flavorMedium,
      count: 2,
      backup: { productCode: CODE.backup, sourceSize: 250, estimatedCount: 4 },
    });
    ctx.session.addItem('load-balancer', { productCode: CODE.lbApp });

    await reconcileBackupItems(ctx);
    const state = ctx.session.read();
    expect(state.list.map((item) => item.service)).toEqual([
      'compute',
      'load-balancer',
      'backup',
      'backup',
    ]);
    expect(state.list.slice(-2).map((item) => item.data)).toEqual([
      expect.objectContaining({ sourceSize: 1024, unit: 'GB', estimatedCount: 14 }),
      expect.objectContaining({ sourceSize: 500, unit: 'GB', estimatedCount: 4 }),
    ]);
  });

  it('compute icindeki TB kaynagini gercek GB kapasitesine cevirerek platform hatasini onler', async () => {
    const ctx = makeContext();
    ctx.session.addItem('compute', {
      productCode: CODE.flavorMedium,
      count: 2,
      backup: { productCode: CODE.backup, sourceSize: 2, unit: 'TB', estimatedCount: 4 },
    });

    await reconcileBackupItems(ctx);
    expect(ctx.session.read().list.at(-1)?.data).toMatchObject({
      sourceSize: 4096,
      unit: 'GB',
      estimatedCount: 4,
    });
  });
});
