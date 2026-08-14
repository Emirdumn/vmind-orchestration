/**
 * FAZ 5.A — Requirement Extractor
 *
 * Serbest TR/EN metin -> RequirementSpec. Structured output ZORUNLU:
 * modelin serbest metin dondurme ihtimali API seviyesinde kapatilir.
 *
 * Bu ajanin tek isi ANLAMAK. Urun secmez, fiyat gormez, kalem eklemez —
 * boylece "yanlis anladi" ile "yanlis tasarladi" hatalari birbirine karismaz.
 */
import { findAliases } from '../core/catalog/aliases.js';
import type { LlmClient } from './llm.js';
import { deriveMonthlyEgress, normalizeNetworkTopology } from './network-units.js';
import { EXTRACTOR_SYSTEM } from './prompts.js';
import {
  REQUIREMENT_SPEC_JSON_SCHEMA,
  RequirementSpecSchema,
  type CriticalUnknown,
  type RequirementSpec,
} from './types.js';

export class RequirementExtractor {
  constructor(private readonly llm: LlmClient) {}

  async extract(salesText: string): Promise<RequirementSpec> {
    const spec = await this.llm.structured({
      system: EXTRACTOR_SYSTEM,
      userMessage: buildExtractionPrompt(salesText),
      schema: RequirementSpecSchema,
      jsonSchema: REQUIREMENT_SPEC_JSON_SCHEMA,
      schemaName: 'RequirementSpec',
      // RequirementSpec; servis kapsamlari, bilinmeyenler ve alternatifler
      // birlikte dondugunde 1800 token'i asabiliyor. Canli Gemini testinde
      // JSON kapanmadan kesildi. 16K varsayilanina cikmadan guvenli pay birak.
      maxTokens: 3200,
    });

    // Sozlugun kesin olarak belirsiz saydigi ifadeler modelce atlanmis olabilir;
    // deterministik olarak tamamlanir. Model eksik birakabilir, sozluk birakmaz.
    return normalizeNetworkTopology(
      deriveMonthlyEgress(mergeDeterministicUnknowns(salesText, spec)),
    );
  }
}

/**
 * Jargon sozlugu (Faz 1.B) ile onceden tespit edilen belirsizlikleri prompta ekler.
 * Modelin isini kolaylastirmaz — DOGRULAR: sozluk "worker belirsiz" diyorsa,
 * modelin bunu kacirmasi durumunda asagidaki birlestirme yakalar.
 */
export function buildExtractionPrompt(salesText: string): string {
  const hits = findAliases(salesText);
  const ambiguous = hits.filter((hit) => hit.kind === 'concept' && hit.concept?.ambiguous);

  const lines = [`Satis temsilcisinin yazdigi metin:`, '', salesText.trim(), ''];

  if (ambiguous.length > 0) {
    lines.push(
      'Sozluk taramasi asagidaki ifadeleri BELIRSIZ olarak isaretledi.',
      'Bunlarin her biri icin unknowns dizisine bir soru yazman gerekir:',
      ...ambiguous.map((hit) => `- "${hit.alias}": ${hit.concept?.note ?? ''}`),
      '',
    );
  }

  lines.push('Bu metni RequirementSpec semasina cevir.');
  return lines.join('\n');
}

/** Sozlukten gelen belirsizlikleri spec'e ekler (tekrar etmeden). */
export function mergeDeterministicUnknowns(
  salesText: string,
  spec: RequirementSpec,
): RequirementSpec {
  const hits = findAliases(salesText);
  const unknowns = [...spec.unknowns];

  for (const hit of hits) {
    if (hit.kind !== 'concept' || !hit.concept?.ambiguous) continue;
    const note = hit.concept.note;
    const alreadyCovered = unknowns.some(
      (existing) =>
        existing.toLowerCase().includes(hit.alias.toLowerCase()) ||
        note.toLowerCase().includes(existing.toLowerCase().slice(0, 20)),
    );
    if (!alreadyCovered) unknowns.push(`"${hit.alias}" belirsiz — ${note}`);
  }

  return { ...spec, unknowns };
}

/**
 * Tasarima gecmeden ONCE sorulmasi gereken belirsizlikler.
 *
 * PLAN §3 adim 2: "unknowns icinde kritik belirsizlik var -> tasarima gecmeden
 * 1 netlestirme sorusu". Kritik olan, cevabi teklifin YAPISINI degistirenlerdir;
 * yalnizca bir sayiyi degistirenler (disk boyutu, trafik) tasarim sonrasi
 * kural motoru tarafindan zaten sorulur.
 */
export function criticalUnknowns(spec: RequirementSpec): CriticalUnknown[] {
  const critical: CriticalUnknown[] = [];

  const add = (question: string, reason: string): void => {
    const normalized = question.toLowerCase();
    if (
      critical.some((item) => {
        const existing = item.question.toLowerCase();
        return existing === normalized || existing.includes(normalized) || normalized.includes(existing);
      })
    ) {
      return;
    }
    critical.push({ question, reason });
  };

  for (const unknown of spec.unknowns) {
    const lower = unknown.toLowerCase();
    if (lower.includes('worker') || lower.includes('kubernetes') || lower.includes('kume')) {
      add(
        unknown,
        'Cevap, teklife Kubernetes kalemi mi yoksa compute kalemi mi girecegini belirler.',
      );
    } else if (lower.includes('load balancer') || lower.includes(' lb') || lower.startsWith('lb')) {
      add(unknown, 'App LB ile Net LB arasindaki fiyat farki buyuk; sessizce secilemez.');
    } else if (lower.includes('gpu')) {
      add(unknown, 'GPU sinifi (T4 / H100) teklifi kat kat degistirir.');
    }
  }

  const hasNetworkedWorkload = Boolean(
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
    const roleNames = (spec.computeGroups ?? [])
      .map((group) => group.role.trim())
      .filter((role) => role.length > 0);
    add(
      'Sunucularınıza internetten nasıl erişilsin?',
      'Yalnızca müşterinin kullanacağı web/API servislerini Load Balancer üzerinden internete açmanızı; ' +
        'veritabanı, yönetim ve diğer sunucuları VPN/özel ağda tutmanızı öneriyoruz. ' +
        (roleNames.length > 0
          ? `İnternete açılacak rol adlarını aşağıya yazabilirsiniz. Mevcut roller: ${roleNames.join(', ')}.`
          : 'İnternete açılacak sunucu veya rol adlarını aşağıya yazabilirsiniz (ör. web-1, web-2, API).'),
    );
  }

  const mayNeedInternetEdge =
    spec.networkExposure === 'public' ||
    spec.networkExposure === 'vpn';
  const hasEgress =
    spec.egressGb !== undefined ||
    spec.egressBandwidthMbps !== undefined ||
    spec.router?.egressGb !== undefined;
  const hasFloatingIp =
    spec.floatingIpCount !== undefined || spec.router?.floatingIpCount !== undefined;
  if (mayNeedInternetEdge && (!hasEgress || !hasFloatingIp)) {
    add(
      'Public veya VPN erişimi olacaksa kaç internet giriş noktası/Floating IP kullanılacak ve aylık outbound trafik kaç GB/TB olacak?',
      'Floating IP giriş noktası başına, outbound trafik ise Router üzerinden aylık kullanım olarak fiyatlanır; backend başına tekrar yazılmaz.',
    );
  }

  const computeCount =
    spec.compute?.count ??
    (spec.computeGroups ?? []).reduce((sum, group) => sum + (group.count ?? 0), 0);
  const wantsHa = spec.scenarioRequests?.some((scenario) => scenario.kind === 'ha') ?? false;
  if ((computeCount >= 2 || wantsHa) && !spec.loadBalancer) {
    add(
      'Çoklu sunucuların önünde Load Balancer olacak mı? HTTP/HTTPS için App LB, TCP/UDP için Net LB; istenmiyorsa açıkça belirtin.',
      'Katalogdaki iki LB de sabit 2 vCPU/2 GB üründür; protokol ürün ve fiyat seçimini belirler.',
    );
  }

  // Fiyati veya urun secimini tasarimdan once degistiren eksikler. Bunlar
  // Designer'a sessiz varsayim birakilirsa teklif daha ilk adimda yanlis bir
  // flavor/servisle kurulabilir; kural motoru sonradan bunu anlayamaz.
  if (spec.compute) {
    if (spec.compute.count === undefined) {
      add('Kaç sunucu/instance gerekiyor?', 'Adet aylik compute ve bagli disk maliyetini dogrudan carpar.');
    }
    if (!spec.compute.sizeHint && spec.compute.needsGpu !== true && spec.compute.highMemory !== true) {
      add(
        'Sunucu başına kaç vCPU ve kaç GB RAM gerekiyor; iş yükü nedir?',
        'Flavor secimi teklifin ana compute fiyatini belirler; sessizce orta boy secilmemeli.',
      );
    }
    if (spec.compute.storage) {
      if (spec.compute.storage.sizeGbPerInstance === undefined) {
        add('Sunucu başına disk boyutu kaç GB/TB?', 'Disk boyutu sunucu adediyle carpilir ve fiyati dogrudan etkiler.');
      }
      if (spec.compute.storage.tier === 'unspecified') {
        add(
          'Sunucu diski Premium SSD mi Standard HDD mi olacak?',
          'Disk sinifi hem performansi hem depolama fiyatini degistirir.',
        );
      }
    }
  }

  for (const group of spec.computeGroups ?? []) {
    const role = group.role.trim() || 'Compute grubu';
    if (group.count === undefined) {
      add(
        `${role} için kaç replica/instance gerekiyor?`,
        'Rol bazli adet compute ve bagli disk maliyetini dogrudan carpar.',
      );
    }
    const hasNumericSizing =
      group.vcpuPerInstance !== undefined && group.ramGbPerInstance !== undefined;
    if (
      !hasNumericSizing &&
      !group.sizeHint &&
      group.needsGpu !== true &&
      group.highMemory !== true
    ) {
      add(
        `${role} için instance başına kaç vCPU ve kaç GB RAM gerekiyor?`,
        'Her rol kendi flavor secimine donusur; roller tek toplamda birlestirilemez.',
      );
    }
    if (group.storage) {
      if (group.storage.sizeGbPerInstance === undefined) {
        add(
          `${role} için instance başına disk boyutu kaç GB/TB?`,
          'Rolun kalici disk miktari fiyatini dogrudan belirler.',
        );
      }
      if (group.storage.tier === 'unspecified') {
        add(
          `${role} diski Premium SSD mi Standard HDD mi olacak?`,
          'Disk sinifi fiyat ve performans secimidir.',
        );
      }
    }
    if (
      group.backup &&
      (group.backup.countPerMonth === undefined || group.backup.sourceSizeGb === undefined)
    ) {
      add(
        `${role} backup/PITR için kaynak boyutu ve aylık saklama adedi nedir?`,
        'PITR istegi tek basina fiyat miktari vermez; kaynak ve saklama adedi gerekir.',
      );
    }
  }

  if (spec.standaloneStorage) {
    if (spec.standaloneStorage.sizeGb === undefined) {
      add('Bağımsız Block Storage boyutu kaç GB/TB?', 'Boyut depolama fiyatini dogrudan belirler.');
    }
    if (spec.standaloneStorage.tier === 'unspecified') {
      add('Bağımsız disk Premium SSD mi Standard HDD mi?', 'Disk sinifi fiyat ve performans secimidir.');
    }
  }

  if (spec.kubernetes && (spec.kubernetes.masterCount === undefined || spec.kubernetes.workerCount === undefined)) {
    add(
      'Kubernetes için kaç master ve kaç worker node gerekiyor?',
      'Her iki node havuzunun adedi ve flavor secimi toplam fiyati belirler.',
    );
  }

  if (spec.objectStorage && spec.objectStorage.sizeGb === undefined) {
    add('Object Storage içinde kaç GB/TB veri tutulacak?', 'Saklanan veri miktari depolama fiyatini belirler.');
  }

  if (spec.backup && (spec.backup.countPerMonth === undefined || spec.backup.sourceSizeGb === undefined)) {
    add(
      'Backup için kaynak boyutu ve ayda saklanacak yedek adedi nedir?',
      'Kaynak boyutu ile yedek adedi birlikte backup maliyetini belirler.',
    );
  }

  if (spec.egressBandwidthMbps !== undefined && spec.egressGb === undefined) {
    add(
      `${spec.egressBandwidthMbps} Mbps bağlantının aylık ortalama kullanım oranı yüzde kaç?`,
      'Mbps bağlantı hızıdır; katalog aylık GB egress fiyatladığı için kullanım yüzdesi veya aylık GB/TB gerekir.',
    );
  }

  if (spec.router && spec.router.egressGb === undefined && spec.router.floatingIpCount === undefined) {
    add(
      'Router üzerinden aylık ne kadar çıkış trafiği ve kaç Floating IP kullanılacak?',
      'Boş Router kalemi 0 maliyet görünür; trafik veya IP miktarı gerekir.',
    );
  }

  // Yalnizca is yuku anlatilip hic servis/kapasite belirtilmediyse bos teklif
  // uretmek yerine kisa bir mimari kesif yap. Bu, "e-ticaret sistemi icin
  // teklif" gibi gercek satis girislerinin basarisiz olmasini engeller.
  if (!hasServiceIntent(spec)) {
    add(
      'Uygulama sanal sunucularda mı yoksa yönetilen Kubernetes üzerinde mi çalışacak?',
      'Bu seçim teklifin ana servis yapısını belirler.',
    );
    add(
      'Kaç sunucu/node gerekir ve her biri için vCPU ile RAM ihtiyacı nedir?',
      'Compute kapasitesi aylık maliyetin ana kalemidir.',
    );
    add(
      'Kalıcı veri tutulacak mı; disk/Object Storage türü ve yaklaşık boyutu nedir?',
      'Block Storage ile Object Storage farklı kullanım ve fiyat modellerine sahiptir.',
    );
    add(
      'Aylık çıkış trafiği, internet erişimi ve Load Balancer ihtiyacı nedir?',
      'Egress, Floating IP ve Load Balancer fiyatı doğrudan etkiler.',
    );
    add(
      'Yedekleme ve yüksek erişilebilirlik isteniyor mu?',
      'Yedek adedi ve çoğaltılmış mimari toplam maliyeti değiştirir.',
    );
  }

  if (spec.loadBalancer?.kind === 'unspecified') {
    const already = critical.some((item) => item.question.toLowerCase().includes('lb'));
    if (!already) {
      add(
        'Load Balancer App (katman 7 / HTTP) mi, Net (katman 4 / TCP) mi olacak?',
        'App LB ile Net LB arasindaki fiyat farki buyuk; sessizce secilemez.',
      );
    }
  }

  // Telefon gorusmesi sirasinda tek ekranda daha fazlasi kullanilabilir degil.
  // Kalan fiyat bosluklari tasarim sonrasi kural motorunun sonraki turuna kalir.
  return critical.slice(0, 5);
}

/** RequirementSpec tasarim yapacak en az bir somut servis niyeti tasiyor mu? */
export function hasServiceIntent(spec: RequirementSpec): boolean {
  return Boolean(
    spec.compute ||
      (spec.computeGroups?.length ?? 0) > 0 ||
      spec.kubernetes ||
      spec.loadBalancer ||
      spec.standaloneStorage ||
      spec.objectStorage ||
      spec.backup ||
      spec.egressBandwidthMbps !== undefined ||
      spec.egressGb !== undefined ||
      spec.floatingIpCount !== undefined ||
      spec.router,
  );
}
