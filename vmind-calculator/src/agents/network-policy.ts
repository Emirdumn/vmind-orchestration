import type { Gap } from '../core/rules/types.js';
import type { ServiceCode } from '../core/schema/estimate.js';
import type { RequirementSpec } from './types.js';

interface EstimateItem {
  service: ServiceCode;
  data: Record<string, unknown>;
}

function networkLocations(list: readonly EstimateItem[]): {
  floatingIp: number;
  dataTransfer: number;
} {
  let floatingIp = 0;
  let dataTransfer = 0;

  for (const item of list) {
    const data = item.data;
    if (item.service === 'floating-ip') floatingIp += 1;
    if (item.service === 'data-transfer') dataTransfer += 1;
    if (data['floatingIp']) floatingIp += 1;
    if (data['network']) dataTransfer += 1;
    const router = data['router'] as Record<string, unknown> | undefined;
    if (router?.['floatingIp']) floatingIp += 1;
    if (router?.['network']) dataTransfer += 1;
  }

  return { floatingIp, dataTransfer };
}

/**
 * RequirementSpec ile fiyat kalemleri arasindaki ag/topoloji sozlesmesi.
 * Bu kontroller LLM'e birakilmaz: eksik ya da iki kez fiyatlanan internet
 * kalemi teklifin yayinlanmasini deterministik olarak durdurur.
 */
export function networkPolicyGaps(
  spec: RequirementSpec | undefined,
  list: readonly EstimateItem[],
): Gap[] {
  if (!spec) return [];

  const gaps: Gap[] = [];
  const add = (ruleId: string, message: string): void => {
    gaps.push({ ruleId, severity: 'blocker', message });
  };
  const locations = networkLocations(list);
  const hasNetworkedWorkload =
    list.some((item) =>
      ['compute', 'kubernetes', 'load-balancer', 'router'].includes(item.service),
    ) ||
    Boolean(
      spec.compute ||
        (spec.computeGroups?.length ?? 0) > 0 ||
        spec.kubernetes ||
        spec.loadBalancer ||
        spec.router,
    );

  if (
    hasNetworkedWorkload &&
    (spec.networkExposure === undefined || spec.networkExposure === 'unspecified')
  ) {
    add(
      'NETWORK_EXPOSURE_MISSING',
      'Sistemin internal, public veya yalnızca VPN/özel erişimli olduğu netleşmedi. ' +
        'Router, Floating IP, outbound ve Load Balancer maliyeti bu bilgi olmadan doğrulanamaz.',
    );
  }

  if (spec.networkExposure === 'public' && locations.floatingIp === 0) {
    add(
      'PUBLIC_NETWORK_NO_FLOATING_IP',
      'Public erişim seçildi ancak internet giriş noktası/Floating IP fiyatlanmadı. ' +
        'Backend sunuculara ayrı ayrı değil, public LB/Router girişine gereken IP eklenmelidir.',
    );
  }
  if (spec.networkExposure === 'public' && locations.dataTransfer === 0) {
    add(
      'PUBLIC_NETWORK_NO_OUTBOUND',
      'Public erişim seçildi ancak aylık outbound trafik fiyatlanmadı. ' +
        'Router üzerinden çıkacak GB/TB miktarı teklife eklenmelidir.',
    );
  }

  if (spec.networkExposure === 'vpn') {
    add(
      'VPN_PRODUCT_UNAVAILABLE',
      'VPN/özel erişim istendi; mevcut VMind Calculator kataloğunda fiyatlanabilir bir VPN ' +
        'ürünü bulunmuyor. VPN lisans/appliance bedeli uydurulmadı; ürün kodu tanımlanmadan teklif yayınlanamaz.',
    );
  }

  if (locations.floatingIp > 1) {
    add(
      'NETWORK_FLOATING_IP_DUPLICATE',
      'Floating IP birden fazla fiyat konumunda bulundu. Public giriş IP’si Router/LB girişinde bir kez ' +
        'tutulmalı; backend veya bağımsız kalemlerde tekrar edilmemelidir.',
    );
  }
  if (locations.dataTransfer > 1) {
    add(
      'NETWORK_OUTBOUND_DUPLICATE',
      'Aynı outbound trafik birden fazla fiyat konumunda bulundu. Trafik Router, LB veya compute ' +
        'kalemlerinden yalnızca birinde fiyatlanmalıdır.',
    );
  }

  return gaps;
}
