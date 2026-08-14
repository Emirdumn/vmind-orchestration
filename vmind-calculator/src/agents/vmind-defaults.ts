import { normalizeAlias } from '../core/catalog/aliases.js';
import { resolveProductAlias } from '../core/catalog/aliases.js';
import { callTool, type ToolContext } from '../mcp/tools/index.js';
import { reconcileNetworkTopology } from './network-reconciler.js';
import { reconcileBackupItems } from './backup-reconciler.js';
import type { AuditQuestion, CriticalUnknown, RequirementSpec } from './types.js';

export interface AnswerResolution {
  answer: string;
  usedVmindDefault: boolean;
  reason?: string;
}

const UNCERTAINTY =
  /(^| )(bilmiyorum|bilmiyom|fikrim yok|emin degilim|fark etmez|siz secin|sen sec|vmind secsin|uygun olani|onerilen|anlamadim|ne bileyim|idk|no idea)( |$)/;
const NEGATIVE = /(^| )(hayir|yok|gerek yok|istemiyorum|istemiyor|olmasin|eklenmesin)( |$)/;
const POSITIVE = /(^| )(evet|olsun|ekle|eklensin|dahil)( |$)/;
const AMOUNT = /\d+(?:[.,]\d+)?\s*(gb|tb|mbps|gbps)/i;

const normalized = (value: string): string => normalizeAlias(value.trim());

export function isUncertainAnswer(answer: string): boolean {
  const text = normalized(answer);
  return text.length === 0 || UNCERTAINTY.test(text) || /^(.)\1{2,}$/.test(text);
}

export function isNetworkExposureQuestion(question: string): boolean {
  const text = normalized(question);
  return (
    (text.includes('internal') ||
      text.includes('public') ||
      text.includes('vpn') ||
      /sunuculariniza internetten nasil erisilsin/.test(text)) &&
    !text.includes('floating ip')
  );
}

function exposureFrom(answer: string): 'internal' | 'public' | 'vpn' | undefined {
  const text = normalized(answer);
  if (
    /(guvenli karma|yalnizca.*(web|api|uygulama).*(public|internete)|load balancer.*public)/.test(
      text,
    )
  ) {
    return 'public';
  }
  if (/(hicbir.*public|public.*(acilmasin|olmasin)|internete.*(acilmasin|kapali))/.test(text)) {
    return /\b(vpn|site to site)\b/.test(text) ? 'vpn' : 'internal';
  }
  if (/\b(public|internete acik|internet uzerinden)\b/.test(text)) return 'public';
  if (/\b(vpn|site to site)\b/.test(text)) return 'vpn';
  if (/\b(internal|ozel ag|ic ag|internete kapali)\b/.test(text)) return 'internal';
  return undefined;
}

function recommendedClarification(
  question: string,
  exposure: 'internal' | 'public' | 'vpn' = 'internal',
): string | undefined {
  const text = normalized(question);
  const asksCombinedNetwork =
    text.includes('floating ip') && /(outbound|trafik|gb|tb)/.test(text);

  if (isNetworkExposureQuestion(question)) {
    return (
      'VMind güvenli yayın önerisi: yalnızca web/API/uygulama rolleri App Load Balancer ' +
      'üzerinden public olsun; veritabanı, yönetim ve diğer backend sunucuları VPN/internal ' +
      'özel ağda kalsın. Backend sunuculara doğrudan public IP verilmesin. Public edge için ' +
      '1 Floating IP ve aylık 1 TB outbound yalnızca merkezi Router üzerinde fiyatlansın.'
    );
  }
  if (asksCombinedNetwork) {
    return exposure === 'public'
      ? 'VMind önerisi: public girişte 1 Floating IP ve aylık 1 TB outbound yalnızca merkezi Router üzerinde.'
      : 'VMind önerisi: Floating IP eklenmesin; aylık 1 TB outbound yalnızca merkezi Router üzerinde.';
  }
  if (/(load balancer|\blb\b)/.test(text) && !/(trafik|transfer|outbound)/.test(text)) {
    return 'VMind önerisi: HTTP/HTTPS iş yükleri için App Load Balancer kullanılsın.';
  }
  if (/(vcpu|cpu).*(ram)|ram.*(vcpu|cpu)/.test(text)) {
    return 'VMind güçlü varsayılanı: her sunucu 8 vCPU ve 16 GB RAM olsun.';
  }
  if (/(kac sunucu|kac instance|kac replica)/.test(text)) {
    return 'VMind yüksek erişilebilirlik varsayılanı: en az 2 sunucu/instance kullanılsın.';
  }
  if (/(disk boyutu|disk kapasitesi|disk.*gb|disk.*tb)/.test(text)) {
    return 'VMind güçlü varsayılanı: sunucu başına 500 GB Premium SSD kullanılsın.';
  }
  if (/(premium ssd|standard hdd|disk sinifi|disk tipi|disk turu)/.test(text)) {
    return 'VMind performans varsayılanı: Premium SSD kullanılsın.';
  }
  if (/gpu/.test(text)) {
    return 'VMind güçlü GPU varsayılanı: H100 sınıfı seçilsin; fiyat onay ekranında açıkça gösterilsin.';
  }
  return undefined;
}

function clarificationValid(question: string, answer: string): boolean {
  const q = normalized(question);
  const a = normalized(answer);
  if (isNetworkExposureQuestion(question)) return exposureFrom(answer) !== undefined;
  if (q.includes('floating ip') && /(outbound|trafik|gb|tb)/.test(q)) {
    return /\d+\s*(floating ip|ip)/.test(a) && AMOUNT.test(a);
  }
  if (/(load balancer|\blb\b)/.test(q) && !/(trafik|transfer|outbound)/.test(q)) {
    return /(app|net|http|https|tcp|udp|katman 4|katman 7)/.test(a) || NEGATIVE.test(a);
  }
  if (/(vcpu|cpu).*(ram)|ram.*(vcpu|cpu)/.test(q)) {
    return /\d+\s*(vcpu|cpu)/.test(a) && /\d+\s*(gb\s*)?ram/.test(a);
  }
  if (/(kac sunucu|kac instance|kac replica)/.test(q)) return /\d+/.test(a);
  if (/(disk boyutu|disk kapasitesi|disk.*gb|disk.*tb)/.test(q)) return AMOUNT.test(a);
  if (/(premium ssd|standard hdd|disk sinifi|disk tipi|disk turu)/.test(q)) {
    return /(premium|standard|ssd|hdd)/.test(a);
  }
  if (/gpu/.test(q)) return /(h100|h200|t4|a100|l4|gpu)/.test(a);
  return true;
}

export function resolveClarificationAnswers(
  unknowns: readonly CriticalUnknown[],
  answers: Readonly<Record<string, string>>,
  knownExposure?: 'internal' | 'public' | 'vpn' | 'unspecified',
): { answers: Record<string, string>; defaults: Array<{ question: string; answer: string }> } {
  const resolved: Record<string, string> = {};
  const defaults: Array<{ question: string; answer: string }> = [];
  const exposureQuestion = unknowns.find((unknown) => isNetworkExposureQuestion(unknown.question));
  const rawExposure = exposureQuestion ? (answers[exposureQuestion.question] ?? '') : '';
  const effectiveExposure =
    exposureFrom(rawExposure) ??
    (knownExposure && knownExposure !== 'unspecified' ? knownExposure : 'internal');

  for (const unknown of unknowns) {
    const raw = answers[unknown.question]?.trim() ?? '';
    const fallback = recommendedClarification(unknown.question, effectiveExposure);
    const needsFallback =
      fallback !== undefined && (isUncertainAnswer(raw) || !clarificationValid(unknown.question, raw));
    if (needsFallback) {
      resolved[unknown.question] = fallback;
      defaults.push({ question: unknown.question, answer: fallback });
    } else if (raw) {
      if (
        isNetworkExposureQuestion(unknown.question) &&
        exposureFrom(raw) === 'public' &&
        (!/\d+\s*(floating ip|ip)/.test(normalized(raw)) || !AMOUNT.test(raw))
      ) {
        const supplemented =
          `${raw} VMind ağ fiyatlama varsayımı: public edge için 1 Floating IP ve aylık ` +
          '1 TB outbound yalnızca merkezi Router üzerinde fiyatlansın.';
        resolved[unknown.question] = supplemented;
        defaults.push({ question: unknown.question, answer: supplemented });
      } else {
        resolved[unknown.question] = raw;
      }
    }
  }
  return { answers: resolved, defaults };
}

const PREMIUM_AUDIT_DEFAULTS: Record<string, string> = {
  OBJ_STORAGE_NO_TRANSFER: 'VMind önerisi: aylık 1 TB egress eklensin.',
  OBJ_STORAGE_EMPTY: 'VMind önerisi: 500 GB Object Storage eklensin.',
  BACKUP_ZERO_COUNT: 'VMind önerisi: ayda 4 yedek saklansın.',
  COMPUTE_BACKUP_ZERO_COUNT: 'VMind önerisi: her sunucu için ayda 4 yedek saklansın.',
  FLOATING_IP_DOUBLE_COUNT:
    'VMind önerisi: Floating IP tek merkezî Router altında birleştirilsin; çift sayım kaldırılsın.',
  ROUTER_EMPTY: 'VMind önerisi: Router üzerinde aylık 1 TB outbound tanımlansın.',
  COMPUTE_NO_BLOCK_STORAGE: 'VMind önerisi: sunucu başına 500 GB Premium SSD eklensin.',
  COMPUTE_NO_TRANSFER:
    'VMind önerisi: aylık 1 TB outbound yalnızca merkezi Router üzerinde bir kez fiyatlansın.',
  LB_NO_TRANSFER:
    'VMind önerisi: aylık 1 TB outbound yalnızca merkezi Router üzerinde bir kez fiyatlansın.',
  LB_WITHOUT_HA: 'VMind önerisi: evet, Load Balancer arkasında en az 2 sunucu kullanılsın.',
  NO_PUBLIC_ACCESS:
    'VMind güvenli varsayılanı: hayır, public erişim eklenmesin; sistem internal kalsın.',
  K8S_WORKER_NO_STORAGE: 'VMind önerisi: worker başına 500 GB Premium SSD eklensin.',
  NO_BACKUP_ANYWHERE:
    'VMind önerisi: evet, mevcut Premium SSD kapasitesi üzerinden ayda 4 yedek eklensin.',
};

export function vmindRecommendedAuditAnswer(
  ruleId: string,
  originalDefault: string,
): string {
  return PREMIUM_AUDIT_DEFAULTS[ruleId] ?? originalDefault;
}

function auditAnswerValid(question: AuditQuestion, answer: string): boolean {
  const text = normalized(answer);
  switch (question.ruleId) {
    case 'OBJ_STORAGE_NO_TRANSFER':
    case 'OBJ_STORAGE_EMPTY':
    case 'COMPUTE_BACKUP_TB_IGNORED':
    case 'ROUTER_EMPTY':
    case 'COMPUTE_NO_BLOCK_STORAGE':
    case 'COMPUTE_NO_TRANSFER':
    case 'LB_NO_TRANSFER':
    case 'K8S_WORKER_NO_STORAGE':
      return AMOUNT.test(text) || NEGATIVE.test(text);
    case 'BACKUP_ZERO_COUNT':
    case 'COMPUTE_BACKUP_ZERO_COUNT':
      return /\d+/.test(text) || NEGATIVE.test(text);
    case 'FLOATING_IP_DOUBLE_COUNT':
      return /(router|sunucu|ayri|birles)/.test(text);
    case 'LB_WITHOUT_HA':
    case 'NO_PUBLIC_ACCESS':
    case 'NO_BACKUP_ANYWHERE':
      return POSITIVE.test(text) || NEGATIVE.test(text) || /\d+/.test(text);
    default:
      return true;
  }
}

export function resolveAuditAnswer(
  question: AuditQuestion,
  answer: string | undefined,
): AnswerResolution {
  const raw = answer?.trim() ?? '';
  const fallback = vmindRecommendedAuditAnswer(question.ruleId, question.defaultAnswer);
  if (isUncertainAnswer(raw) || !auditAnswerValid(question, raw)) {
    return {
      answer: fallback,
      usedVmindDefault: true,
      reason: raw ? 'Cevap soruyla uyumlu veya fiyatlanabilir değildi.' : 'Cevap verilmedi.',
    };
  }
  return { answer: raw, usedVmindDefault: false };
}

export interface StrongProfileResult {
  changed: boolean;
  actions: string[];
}

/**
 * NLP'nin sessizce ucuz/eksik bir kalem secmesini engelleyen son koruma.
 * Yalnizca VMind fallback'i gercekten kullanildiysa cagrilir; spec'te acikca
 * belirtilen daha dusuk musteri tercihini ezmez, eksik alanlari premium profil ile tamamlar.
 */
export async function applyVmindStrongProfile(
  ctx: ToolContext,
  spec: RequirementSpec,
  contextText: string,
): Promise<StrongProfileResult> {
  const actions: string[] = [];
  const normalizedContext = normalized(contextText);
  const currency = ctx.session.read().currency;
  const premium = resolveProductAlias('premium disk');
  const backup = resolveProductAlias('backup');
  const appLb = resolveProductAlias('app lb');
  if (!premium || !backup || !appLb) throw new Error('VMind güçlü profil ürün eşlemesi eksik.');

  const strongFlavor = ctx.catalog
    .searchFlavors({ minVcpu: 8, minRamGb: 16, gpu: false })
    .filter((flavor) => {
      try {
        ctx.catalog.assertPriceable(flavor.id, currency);
        return true;
      } catch {
        return false;
      }
    })
    .sort((left, right) =>
      left.vcpus - right.vcpus ||
      left.ram - right.ram ||
      (ctx.catalog.priceOf(left.id, currency) ?? Infinity) -
        (ctx.catalog.priceOf(right.id, currency) ?? Infinity),
    )[0];
  if (!strongFlavor) throw new Error('Katalogda fiyatlanabilir 8 vCPU / 16 GB flavor bulunamadi.');

  const explicitStorage = Boolean(
    spec.compute?.storage &&
      (spec.compute.storage.tier !== 'unspecified' ||
        spec.compute.storage.sizeGbPerInstance !== undefined),
  );
  const explicitSizing = Boolean(
    spec.compute?.sizeHint &&
      !/vmind guclu varsayilani|8\s*vcpu.*16\s*gb/i.test(normalized(spec.compute.sizeHint)),
  );
  const explicitlyNoBackup =
    /(yedek|backup).*(istemiyorum|gerek yok|olmasin|eklenmesin)/.test(normalizedContext);
  const explicitlyNoLb =
    /(load balancer|\blb\b).*(istemiyorum|gerek yok|olmasin|eklenmesin)/.test(
      normalizedContext,
    );

  const computeItems = ctx.session.read().list.filter((item) => item.service === 'compute');
  // Designer backup'i yeni kurala gore zaten bagimsiz hizmet olarak eklediyse
  // compute'lara bir kez daha gomup uzlastirma sirasinda iki kez fiyatlama.
  const hasStandaloneBackup = ctx.session
    .read()
    .list.some((item) => item.service === 'backup');
  for (const item of computeItems) {
    const data = item.data as Record<string, unknown>;
    const currentFlavor = ctx.catalog.flavors.find((flavor) => flavor.id === data['productCode']);
    const patch: Record<string, unknown> = {};

    if (
      !explicitSizing &&
      (!currentFlavor ||
        (currentFlavor.vgpus === 0 &&
          (currentFlavor.vcpus < 8 || currentFlavor.ram / 1024 < 16)))
    ) {
      patch['productCode'] = strongFlavor.id;
      actions.push(`${item.id}: compute en az 8 vCPU / 16 GB yapildi.`);
    }

    if (spec.compute?.count === undefined) {
      const currentCount = Number(data['count'] ?? 1);
      if (currentCount < 2) {
        patch['count'] = 2;
        actions.push(`${item.id}: yuksek erisilebilirlik icin sunucu adedi 2 yapildi.`);
      }
    }

    let protectedSourceSizeGb: number | undefined;
    if (!explicitStorage) {
      const currentStorage = data['storage'] as Record<string, unknown> | undefined;
      const currentSize = Number(currentStorage?.['size'] ?? 0);
      const currentSizeGb = currentStorage?.['unit'] === 'TB' ? currentSize * 1024 : currentSize;
      protectedSourceSizeGb = Math.max(500, Number.isFinite(currentSizeGb) ? currentSizeGb : 0);
      patch['storage'] = {
        productCode: premium.productCode,
        size: protectedSourceSizeGb,
        unit: 'GB',
        volumeTypeName: premium.label,
      };
      actions.push(`${item.id}: disk en az 500 GB Premium SSD yapildi.`);
    } else {
      const currentStorage = data['storage'] as Record<string, unknown> | undefined;
      const currentSize = Number(currentStorage?.['size']);
      if (Number.isFinite(currentSize) && currentSize > 0) {
        protectedSourceSizeGb = currentStorage?.['unit'] === 'TB' ? currentSize * 1024 : currentSize;
      }
    }

    if (!explicitlyNoBackup && !hasStandaloneBackup && protectedSourceSizeGb !== undefined) {
      const currentBackup = data['backup'] as Record<string, unknown> | undefined;
      const currentCount = Number(currentBackup?.['estimatedCount'] ?? 0);
      patch['backup'] = {
        productCode: backup.productCode,
        sourceSize: Math.max(protectedSourceSizeGb, Number(currentBackup?.['sourceSize'] ?? 0)),
        estimatedCount: Math.max(4, Number.isFinite(currentCount) ? currentCount : 0),
        unit: 'GB',
      };
      actions.push(`${item.id}: ayda en az 4 yedek eklendi.`);
    }

    if (Object.keys(patch).length > 0) {
      await callTool(ctx, 'estimate.updateItem', { itemId: item.id, patch });
    }
  }

  const afterCompute = ctx.session.read();
  if (
    computeItems.length > 0 &&
    !explicitlyNoLb &&
    !afterCompute.list.some((item) => item.service === 'load-balancer')
  ) {
    await callTool(ctx, 'estimate.addItem', {
      service: 'load-balancer',
      data: { productCode: appLb.productCode },
    });
    actions.push('App Load Balancer eklendi.');
  }

  const exposure =
    spec.networkExposure && spec.networkExposure !== 'unspecified'
      ? spec.networkExposure
      : 'internal';
  const requestedEgress = spec.router?.egressGb ?? spec.egressGb ?? 1024;
  const networkResult = await reconcileNetworkTopology(ctx, {
    ...spec,
    networkExposure: exposure,
    router: {
      egressGb: requestedEgress,
      ...(exposure === 'public'
        ? { floatingIpCount: spec.router?.floatingIpCount ?? spec.floatingIpCount ?? 1 }
        : {}),
    },
  });
  if (networkResult.changed) actions.push(networkResult.message);

  const backupResult = await reconcileBackupItems(ctx);
  if (backupResult.changed) actions.push(backupResult.message);

  return { changed: actions.length > 0, actions };
}
