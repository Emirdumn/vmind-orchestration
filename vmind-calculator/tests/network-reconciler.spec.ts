import { describe, expect, it } from 'vitest';

import { reconcileNetworkTopology } from '../src/agents/network-reconciler.js';
import { EstimateSession } from '../src/core/estimate/session.js';
import { createToolContext } from '../src/mcp/tools/index.js';
import { CODE, catalog, makeRuleEngine } from './helpers.js';

describe('network topology reconciler', () => {
  it('public FIP ve outbound tekrarlarini tek Router kalemine tasir', async () => {
    const ctx = createToolContext(catalog, makeRuleEngine(), {
      session: new EstimateSession(catalog, { currency: 'USD' }),
    });
    ctx.session.addItem('compute', {
      productCode: CODE.flavorMedium,
      count: 2,
      floatingIp: { productCode: CODE.floatingIp, count: 2 },
      network: { productCode: CODE.netOut, traffic: 500, unit: 'GB' },
    });
    ctx.session.addItem('load-balancer', {
      productCode: CODE.lbApp,
      network: { productCode: CODE.netOut, traffic: 500, unit: 'GB' },
    });
    ctx.session.addItem('floating-ip', { productCode: CODE.floatingIp, count: 1 });
    ctx.session.addItem('data-transfer', {
      productCode: CODE.netOut,
      traffic: 500,
      unit: 'GB',
    });

    const result = await reconcileNetworkTopology(ctx, {
      networkExposure: 'public',
      compute: { count: 2, sizeHint: '2 vCPU 4 GB RAM' },
      loadBalancer: { kind: 'app' },
      router: { floatingIpCount: 1, egressGb: 500 },
      unknowns: [],
      rationale: 'test',
    });

    expect(result.changed).toBe(true);
    const state = ctx.session.read();
    expect(state.list.map((item) => item.service)).toEqual([
      'compute',
      'load-balancer',
      'router',
    ]);
    expect(state.list.find((item) => item.service === 'compute')?.data).not.toHaveProperty('network');
    expect(state.list.find((item) => item.service === 'compute')?.data).not.toHaveProperty('floatingIp');
    expect(state.list.find((item) => item.service === 'load-balancer')?.data).not.toHaveProperty('network');
    expect(state.list.find((item) => item.service === 'router')?.data).toEqual({
      floatingIp: { productCode: CODE.floatingIp, count: 1 },
      network: { productCode: CODE.netOut, traffic: 500, unit: 'GB' },
    });
  });

  it('internal topolojiyi ve mevcut kalemleri degistirmez', async () => {
    const ctx = createToolContext(catalog, makeRuleEngine(), {
      session: new EstimateSession(catalog, { currency: 'USD' }),
    });
    ctx.session.addItem('compute', {
      productCode: CODE.flavorMedium,
      count: 1,
    });
    const before = ctx.session.read();
    const result = await reconcileNetworkTopology(ctx, {
      networkExposure: 'internal',
      compute: { count: 1 },
      unknowns: [],
      rationale: 'test',
    });
    expect(result.changed).toBe(false);
    expect(ctx.session.read()).toEqual(before);
  });

  it('internal sistemin outbound trafigini tek Router kalemine tasir ve FIP eklemez', async () => {
    const ctx = createToolContext(catalog, makeRuleEngine(), {
      session: new EstimateSession(catalog, { currency: 'USD' }),
    });
    ctx.session.addItem('compute', {
      productCode: CODE.flavorMedium,
      count: 2,
      network: { productCode: CODE.netOut, traffic: 1024, unit: 'GB' },
    });
    ctx.session.addItem('load-balancer', {
      productCode: CODE.lbApp,
      network: { productCode: CODE.netOut, traffic: 500, unit: 'GB' },
    });
    ctx.session.addItem('data-transfer', {
      productCode: CODE.netOut,
      traffic: 1024,
      unit: 'GB',
    });

    const result = await reconcileNetworkTopology(ctx, {
      networkExposure: 'internal',
      compute: { count: 2, sizeHint: '4 vCPU 8 GB RAM' },
      loadBalancer: { kind: 'app' },
      egressGb: 1024,
      unknowns: [],
      rationale: 'test',
    });

    expect(result.changed).toBe(true);
    const state = ctx.session.read();
    expect(state.list.map((item) => item.service)).toEqual(['compute', 'load-balancer', 'router']);
    expect(state.list.find((item) => item.service === 'router')?.data).toEqual({
      network: { productCode: CODE.netOut, traffic: 1024, unit: 'GB' },
    });
    expect(JSON.stringify(state.list)).not.toContain('floatingIp');
  });
});
