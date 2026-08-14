import type { RequirementSpec } from './types.js';

/** Calculator egress'i aylik GB olarak fiyatlar; fiyat motoru da 720 saat/ay kullanir. */
export const BILLING_HOURS_PER_MONTH = 720;

/** Mbps/Gbps/Kbps ifadesini ortak Mbps birimine cevirir. */
export function parseBandwidthMbps(text: string): number | null {
  const match = /(\d+(?:[.,]\d+)?)\s*(kbps|mbps|gbps|kbit\/s|mbit\/s|gbit\/s)/i.exec(text);
  if (!match?.[1] || !match[2]) return null;
  const value = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2].toLowerCase();
  if (unit.startsWith('g')) return value * 1000;
  if (unit.startsWith('k')) return value / 1000;
  return value;
}

/** Yuzde 30 / %30 / 30% gibi ortalama kullanim cevaplarini cozer. */
export function parseUtilizationPercent(text: string): number | null {
  const match =
    /(?:%\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*%|y[uü]zde\s*(\d+(?:[.,]\d+)?))/i.exec(
      text,
    );
  const raw = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!raw) return null;
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) && value > 0 && value <= 100 ? value : null;
}

/** "Ortalama/surekli 100 Mbps" kapasite degil gercek ortalama hiz olarak okunabilir. */
export function isExplicitAverageBandwidth(text: string): boolean {
  return /(ortalama|average|s[uü]rekli|continuous|24\s*\/\s*7|tam kapasite)/i.test(text);
}

/**
 * Mbps x kullanim oranini aylik GB'a deterministik cevirir.
 * 1 Mbps surekli kullanim = 324 GB / 720 saatlik ay (decimal network birimi).
 */
export function monthlyEgressGbFromMbps(
  bandwidthMbps: number,
  utilizationPercent: number,
): number {
  const seconds = BILLING_HOURS_PER_MONTH * 3600;
  const gb =
    ((bandwidthMbps * 1_000_000) / 8) * seconds * (utilizationPercent / 100) / 1_000_000_000;
  return Math.round(gb * 1000) / 1000;
}

/**
 * Structured spec'teki Mbps kapasitesini, varsa netlestirme cevabiyla aylik
 * GB'a cevirir. Kullanim orani yoksa egressGb URETMEZ; sessiz 24/7 varsayimi yapmaz.
 */
export function deriveMonthlyEgress(
  spec: RequirementSpec,
  clarificationTexts: readonly string[] = [],
): RequirementSpec {
  const bandwidthMbps =
    spec.egressBandwidthMbps ??
    clarificationTexts.map(parseBandwidthMbps).find((value): value is number => value !== null);
  let utilizationPercent =
    spec.egressUtilizationPercent ??
    clarificationTexts
      .map(parseUtilizationPercent)
      .find((value): value is number => value !== null);

  if (
    utilizationPercent === undefined &&
    clarificationTexts.some(
      (text) => parseBandwidthMbps(text) !== null && isExplicitAverageBandwidth(text),
    )
  ) {
    utilizationPercent = 100;
  }

  if (bandwidthMbps === undefined || utilizationPercent === undefined) {
    return {
      ...spec,
      ...(bandwidthMbps !== undefined ? { egressBandwidthMbps: bandwidthMbps } : {}),
    };
  }

  const egressGb =
    spec.egressGb ?? monthlyEgressGbFromMbps(bandwidthMbps, utilizationPercent);
  return {
    ...spec,
    egressBandwidthMbps: bandwidthMbps,
    egressUtilizationPercent: utilizationPercent,
    egressGb,
    unknowns: spec.unknowns.filter(
      (unknown) => !/(mbps|gbps|bant genisligi|bant genişliği|kullanim orani|kullanım oranı)/i.test(unknown),
    ),
    rationale:
      spec.egressGb === undefined
        ? `${spec.rationale}\nEgress dönüşümü: ${bandwidthMbps} Mbps x %${utilizationPercent} ortalama kullanım = ${egressGb} GB/ay.`
        : spec.rationale,
  };
}

/**
 * Public/VPN topolojisinde internet maliyetleri, internal topolojide ise acikca
 * istenen outbound trafik tek Router girisinde toplanir.
 * Boylece LB arkasindaki her backend'e ayri Floating IP yazilmaz ve ayni
 * outbound trafik LB/compute/router altinda iki kez fiyatlanmaz.
 */
export function normalizeNetworkTopology(spec: RequirementSpec): RequirementSpec {
  const egressGb = spec.router?.egressGb ?? spec.egressGb;
  const isPublicEdge = spec.networkExposure === 'public' || spec.networkExposure === 'vpn';
  const isInternalOutbound = spec.networkExposure === 'internal' && egressGb !== undefined;
  if (!isPublicEdge && !isInternalOutbound) return spec;

  const floatingIpCount = isPublicEdge
    ? (spec.router?.floatingIpCount ?? spec.floatingIpCount)
    : undefined;
  if (egressGb === undefined && floatingIpCount === undefined && !spec.router) return spec;

  const {
    egressGb: _standaloneEgress,
    floatingIpCount: _standaloneFloatingIp,
    ...withoutStandaloneNetwork
  } = spec;
  return {
    ...withoutStandaloneNetwork,
    router: {
      ...(egressGb !== undefined ? { egressGb } : {}),
      ...(floatingIpCount !== undefined ? { floatingIpCount } : {}),
    },
    rationale:
      `${spec.rationale}\nAg topolojisi: ${isPublicEdge ? 'Floating IP ve ' : ''}` +
      'outbound trafik tek Router girisinde toplandi; backend sunuculara tekrar yazilmadi.',
  };
}
