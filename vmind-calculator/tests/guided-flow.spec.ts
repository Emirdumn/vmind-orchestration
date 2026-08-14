import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Catalog } from '../src/core/catalog/catalog.js';
import { RuleEngine } from '../src/core/rules/engine.js';
import { EstimateSession } from '../src/core/estimate/session.js';
import { AuditTrail } from '../src/core/telemetry/audit.js';
import { createToolContext, priceTools } from '../src/mcp/tools/index.js';
import {
  DeterministicGuidedDesigner,
  GuidedQuoteInputSchema,
  guidedQuoteToSpec,
  type GuidedQuoteInput,
} from '../src/web/guided-flow.js';
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

const recommended: GuidedQuoteInput = {
  profile: 'recommended',
  workload: 'web',
  exposure: 'public',
  capacity: 'powerful',
  instanceCount: 2,
  diskTier: 'premium',
  diskGb: 500,
  loadBalancer: 'app',
  backupCount: 4,
  egressGb: 1024,
  floatingIpCount: 1,
  currency: 'TL',
  notes: '',
};

describe('LLM kullanmayan tıklamalı teklif yolu', () => {
  it('compute, LB, tek Router ve ayrı Backup kalemini katalogdan üretir', async () => {
    const trail = new AuditTrail();
    const ctx = createToolContext(catalog, rules, {
      session: new EstimateSession(catalog, { currency: 'TL', name: 'test' }),
      audit: trail,
    });
    const spec = guidedQuoteToSpec(recommended);
    const draft = await new DeterministicGuidedDesigner(recommended).design(ctx, spec);
    const state = ctx.session.read();

    expect(state.list.map((item) => item.service)).toEqual([
      'compute', 'load-balancer', 'router', 'backup',
    ]);
    expect(state.list.find((item) => item.service === 'router')?.data).toMatchObject({
      floatingIp: { count: 1 },
      network: { traffic: 1024, unit: 'GB' },
    });
    expect(state.list.find((item) => item.service === 'backup')?.data).toMatchObject({
      sourceSize: 1000,
      estimatedCount: 4,
      unit: 'GB',
    });
    expect(state.list.find((item) => item.service === 'compute')?.data).not.toHaveProperty('backup');
    expect(priceTools.calculate(ctx).totalMonthCost).toBeGreaterThan(0);
    expect(draft.rejectedToolCalls).toBe(0);
    expect(trail.summary().llm.calls).toBe(0);
  });

  it('veritabanı iş yükünde memory flavor ailesini tercih eder', async () => {
    const input: GuidedQuoteInput = {
      ...recommended,
      workload: 'database',
      capacity: 'standard',
      loadBalancer: 'none',
      exposure: 'internal',
    };
    const ctx = createToolContext(catalog, rules, {
      session: new EstimateSession(catalog, { currency: 'TL', name: 'test' }),
    });
    await new DeterministicGuidedDesigner(input).design(ctx, guidedQuoteToSpec(input));
    const productCode = String(ctx.session.read().list[0]?.data['productCode']);
    expect(catalog.flavors.find((flavor) => flavor.id === productCode)?.name).toMatch(/^m1\./);
  });

  it('bilinmeyen alanı ve sınır dışı miktarı reddeder', () => {
    expect(GuidedQuoteInputSchema.safeParse({ ...recommended, instanceCount: 0 }).success).toBe(false);
    expect(GuidedQuoteInputSchema.safeParse({ ...recommended, hidden: true }).success).toBe(false);
  });
});
