import { describe, expect, it } from 'vitest';

import { networkPolicyGaps } from '../src/agents/network-policy.js';
import type { RequirementSpec } from '../src/agents/types.js';
import type { ServiceCode } from '../src/core/schema/estimate.js';
import { CODE } from './helpers.js';

const compute = {
  service: 'compute' as ServiceCode,
  data: { productCode: CODE.flavorMedium, count: 2 },
};
const router = {
  service: 'router' as ServiceCode,
  data: {
    floatingIp: { productCode: CODE.floatingIp, count: 1 },
    network: { productCode: CODE.netOut, traffic: 500, unit: 'GB' },
  },
};
const spec = (networkExposure: RequirementSpec['networkExposure']): RequirementSpec => ({
  networkExposure,
  compute: { count: 2, sizeHint: '2 vCPU 4 GB RAM' },
  unknowns: [],
  rationale: 'test',
});
const ids = (
  requirement: RequirementSpec,
  list: Array<{ service: ServiceCode; data: Record<string, unknown> }>,
): string[] => networkPolicyGaps(requirement, list).map((gap) => gap.ruleId);

describe('network topology policy', () => {
  it('internal/public/vpn ayrimi net degilse yayini bloklar', () => {
    expect(ids(spec('unspecified'), [compute])).toContain('NETWORK_EXPOSURE_MISSING');
  });

  it('public teklif tek Router girisinde FIP ve outbound ile gecerlidir', () => {
    expect(ids(spec('public'), [compute, router])).toEqual([]);
  });

  it('public teklifte FIP ve outbound eksigini ayri ayri yakalar', () => {
    const result = ids(spec('public'), [compute]);
    expect(result).toContain('PUBLIC_NETWORK_NO_FLOATING_IP');
    expect(result).toContain('PUBLIC_NETWORK_NO_OUTBOUND');
  });

  it('FIP veya outbound iki farkli kalemde fiyatlanirsa cift sayimi bloklar', () => {
    const result = ids(spec('public'), [
      compute,
      router,
      {
        service: 'floating-ip',
        data: { productCode: CODE.floatingIp, count: 1 },
      },
      {
        service: 'data-transfer',
        data: { productCode: CODE.netOut, traffic: 500, unit: 'GB' },
      },
    ]);
    expect(result).toContain('NETWORK_FLOATING_IP_DUPLICATE');
    expect(result).toContain('NETWORK_OUTBOUND_DUPLICATE');
  });

  it('VPN urunu katalogda olmadigi icin fiyat uydurmak yerine yayini bloklar', () => {
    expect(ids(spec('vpn'), [compute, router])).toContain('VPN_PRODUCT_UNAVAILABLE');
  });
});
