/**
 * FAZ 1.B — Satisci jargonu sozlugu
 *
 * "premium disk olsun, worker olsun, app LB olsun" gibi konusma dilini
 * katalog kodlarina cevirir.
 *
 * IKI AYRI TABLO — bilerek:
 *
 *   PRODUCT_ALIASES  jargon -> KESIN productCode. Belirsizlik yasak; bir takma ad
 *                    yalnizca tek bir koda cikar. Testle zorlanir.
 *
 *   CONCEPT_ALIASES  jargon -> KAVRAM (rol, mimari istek). Bunlarin tek dogru
 *                    urun karsiligi YOKTUR; hangi flavor/boyut secilecegine
 *                    Solution Designer karar verir. "worker" bir urun degil roldur;
 *                    burada urune baglamak sessiz yanlis secime yol acardi.
 */
import type { ServiceCode } from '../schema/estimate.js';

/**
 * Turkce metni eslestirme icin normalize eder:
 * kucuk harf, aksan katlama (ç->c, ğ->g, ı/i->i, ö->o, ş->s, ü->u), bosluk sadelestirme.
 */
export function normalizeAlias(text: string): string {
  return text
    .toLowerCase()
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface ProductAlias {
  /** Hedef katalog kodu. */
  productCode: string;
  /** Bu kodun hangi teklif servisinde kullanildigi. */
  service: ServiceCode;
  /** Satisciya gosterilecek gerekce ("premium disk -> PortvMind-Premium-SSD"). */
  label: string;
}

const V_PREMIUM = '096439fe-26d6-4bd0-bdf0-11e40f73753e';
const V_STANDARD = 'bd0bbcfb-c178-4d21-b661-1b67c43b8c60';

const P = (productCode: string, service: ServiceCode, label: string): ProductAlias => ({
  productCode,
  service,
  label,
});

/** Takma ad -> kesin urun. Anahtarlar `normalizeAlias` ile normalize edilmis olmali. */
export const PRODUCT_ALIASES: Record<string, ProductAlias> = {
  // --- Block storage: premium (SSD) --------------------------------------
  'premium disk': P(V_PREMIUM, 'storage', 'PortvMind-Premium-SSD'),
  'premium ssd': P(V_PREMIUM, 'storage', 'PortvMind-Premium-SSD'),
  premium: P(V_PREMIUM, 'storage', 'PortvMind-Premium-SSD'),
  ssd: P(V_PREMIUM, 'storage', 'PortvMind-Premium-SSD'),
  'hizli disk': P(V_PREMIUM, 'storage', 'PortvMind-Premium-SSD'),
  'nvme disk': P(V_PREMIUM, 'storage', 'PortvMind-Premium-SSD'),
  'yuksek performansli disk': P(V_PREMIUM, 'storage', 'PortvMind-Premium-SSD'),

  // --- Block storage: standart (HDD) -------------------------------------
  'standart disk': P(V_STANDARD, 'storage', 'PortvMind-Standard-HDD'),
  'standard disk': P(V_STANDARD, 'storage', 'PortvMind-Standard-HDD'),
  hdd: P(V_STANDARD, 'storage', 'PortvMind-Standard-HDD'),
  'normal disk': P(V_STANDARD, 'storage', 'PortvMind-Standard-HDD'),
  'ekonomik disk': P(V_STANDARD, 'storage', 'PortvMind-Standard-HDD'),

  // --- Block storage: jenerik --------------------------------------------
  volume: P('VL-001', 'storage', 'Volume-GB'),
  'block storage': P('VL-001', 'storage', 'Volume-GB'),
  'blok depolama': P('VL-001', 'storage', 'Volume-GB'),
  'ek disk': P('VL-001', 'storage', 'Volume-GB'),
  'kalici disk': P('VL-001', 'storage', 'Volume-GB'),

  // --- Snapshot -----------------------------------------------------------
  snapshot: P('VL-002', 'storage', 'Snapshot-GB'),
  'anlik goruntu': P('VL-002', 'storage', 'Snapshot-GB'),

  // --- Load balancer ------------------------------------------------------
  'app lb': P('LB-001', 'load-balancer', 'App Loadbalancer 2C2GB'),
  'app load balancer': P('LB-001', 'load-balancer', 'App Loadbalancer 2C2GB'),
  'uygulama load balancer': P('LB-001', 'load-balancer', 'App Loadbalancer 2C2GB'),
  'katman 7 load balancer': P('LB-001', 'load-balancer', 'App Loadbalancer 2C2GB'),
  'layer 7 lb': P('LB-001', 'load-balancer', 'App Loadbalancer 2C2GB'),
  'net lb': P('LB-002', 'load-balancer', 'Net Loadbalancer 2C2GB'),
  'network load balancer': P('LB-002', 'load-balancer', 'Net Loadbalancer 2C2GB'),
  'ag load balancer': P('LB-002', 'load-balancer', 'Net Loadbalancer 2C2GB'),
  'katman 4 load balancer': P('LB-002', 'load-balancer', 'Net Loadbalancer 2C2GB'),
  'layer 4 lb': P('LB-002', 'load-balancer', 'Net Loadbalancer 2C2GB'),

  // --- Floating IP --------------------------------------------------------
  'floating ip': P('FIP-001', 'floating-ip', 'FloatingIp'),
  'public ip': P('FIP-001', 'floating-ip', 'FloatingIp'),
  'genel ip': P('FIP-001', 'floating-ip', 'FloatingIp'),
  'sabit ip': P('FIP-001', 'floating-ip', 'FloatingIp'),
  'dis ip': P('FIP-001', 'floating-ip', 'FloatingIp'),
  'statik ip': P('FIP-001', 'floating-ip', 'FloatingIp'),

  // --- Data transfer / egress --------------------------------------------
  egress: P('NETW-OUT-001', 'data-transfer', 'Outbound Trafik'),
  'data transfer': P('NETW-OUT-001', 'data-transfer', 'Outbound Trafik'),
  'veri transferi': P('NETW-OUT-001', 'data-transfer', 'Outbound Trafik'),
  'cikis trafigi': P('NETW-OUT-001', 'data-transfer', 'Outbound Trafik'),
  'outbound trafik': P('NETW-OUT-001', 'data-transfer', 'Outbound Trafik'),
  'internet trafigi': P('NETW-OUT-001', 'data-transfer', 'Outbound Trafik'),
  'bant genisligi': P('NETW-OUT-001', 'data-transfer', 'Outbound Trafik'),
  'disari cikan trafik': P('NETW-OUT-001', 'data-transfer', 'Outbound Trafik'),
  indirme: P('NETW-OUT-001', 'data-transfer', 'Outbound Trafik'),

  // --- Object storage -----------------------------------------------------
  'object storage': P('OBS-001', 'object-storage', 'Object Storage Standart'),
  'nesne depolama': P('OBS-001', 'object-storage', 'Object Storage Standart'),
  s3: P('OBS-001', 'object-storage', 'Object Storage Standart'),
  bucket: P('OBS-001', 'object-storage', 'Object Storage Standart'),
  'dosya deposu': P('OBS-001', 'object-storage', 'Object Storage Standart'),

  // --- Backup -------------------------------------------------------------
  backup: P('BC-001', 'backup', 'Backup Volume'),
  yedek: P('BC-001', 'backup', 'Backup Volume'),
  yedekleme: P('BC-001', 'backup', 'Backup Volume'),
  'yedek alsin': P('BC-001', 'backup', 'Backup Volume'),
  'cloud backup': P('BC-001', 'backup', 'Backup Volume'),
};

export interface ConceptAlias {
  concept:
    | 'k8s-worker'
    | 'k8s-master'
    | 'app-server'
    | 'high-availability'
    | 'gpu'
    | 'high-memory'
    | 'general-purpose'
    | 'kubernetes'
    | 'router'
    | 'load-balancer-unspecified';
  /** Bu kavram netlestirilmeden tasarima gecilemez mi? */
  ambiguous: boolean;
  note: string;
}

/**
 * Urune degil KAVRAMA cozulen jargon. Solution Designer bunlari yorumlar.
 * `ambiguous: true` olanlar Requirement Extractor tarafindan `unknowns[]`e yazilir.
 */
export const CONCEPT_ALIASES: Record<string, ConceptAlias> = {
  worker: {
    concept: 'k8s-worker',
    ambiguous: true,
    note: 'Kubernetes worker node mu, yoksa is kuyrugu calistiran uygulama sunucusu mu? Netlestirilmeli.',
  },
  'worker node': { concept: 'k8s-worker', ambiguous: false, note: 'Kubernetes worker havuzu.' },
  'is makinesi': { concept: 'k8s-worker', ambiguous: true, note: 'Rol belirsiz; sorulmali.' },
  master: { concept: 'k8s-master', ambiguous: false, note: 'Kubernetes control plane.' },
  'control plane': { concept: 'k8s-master', ambiguous: false, note: 'Kubernetes control plane.' },
  kubernetes: { concept: 'kubernetes', ambiguous: false, note: 'Yonetilen Kubernetes kumesi.' },
  k8s: { concept: 'kubernetes', ambiguous: false, note: 'Yonetilen Kubernetes kumesi.' },
  kume: { concept: 'kubernetes', ambiguous: true, note: 'Kubernetes kumesi mi, sunucu grubu mu?' },
  sunucu: { concept: 'app-server', ambiguous: false, note: 'compute kalemi.' },
  server: { concept: 'app-server', ambiguous: false, note: 'compute kalemi.' },
  instance: { concept: 'app-server', ambiguous: false, note: 'compute kalemi.' },
  vm: { concept: 'app-server', ambiguous: false, note: 'compute kalemi.' },
  'sanal makine': { concept: 'app-server', ambiguous: false, note: 'compute kalemi.' },
  'uygulama sunucusu': { concept: 'app-server', ambiguous: false, note: 'compute kalemi.' },
  yedeklilik: {
    concept: 'high-availability',
    ambiguous: true,
    note: 'Kac kopya? Farkli AZ isteniyor mu? "yedekleme" (backup) ile karistirilmamali.',
  },
  ha: { concept: 'high-availability', ambiguous: false, note: 'En az 2 compute + load balancer.' },
  'yuksek erisilebilirlik': {
    concept: 'high-availability',
    ambiguous: false,
    note: 'En az 2 compute + load balancer.',
  },
  gpu: { concept: 'gpu', ambiguous: true, note: 'Hangi GPU sinifi? T4 mu H100 mu?' },
  'ekran karti': { concept: 'gpu', ambiguous: true, note: 'Hangi GPU sinifi?' },
  'yapay zeka sunucusu': { concept: 'gpu', ambiguous: true, note: 'Egitim mi cikarim mi? GPU sinifi degisir.' },
  'yuksek bellek': { concept: 'high-memory', ambiguous: false, note: 'm1.* ailesi.' },
  'bellek yogun': { concept: 'high-memory', ambiguous: false, note: 'm1.* ailesi.' },
  'genel amacli': { concept: 'general-purpose', ambiguous: false, note: 'g1.* ailesi.' },
  // Ciplak "load balancer" BILEREK urune baglanmadi: App (LB-001, katman 7) ile
  // Net (LB-002, katman 4) arasindaki fark fiyati ~7 kat degistiriyor.
  // Sessizce birini secmek tam olarak bu projenin onlemek istedigi hata.
  'load balancer': {
    concept: 'load-balancer-unspecified',
    ambiguous: true,
    note: 'App LB (LB-001, katman 7 / HTTP) mi, Net LB (LB-002, katman 4 / TCP) mi? Fiyat farki buyuk.',
  },
  lb: {
    concept: 'load-balancer-unspecified',
    ambiguous: true,
    note: 'App LB mi Net LB mi belirtilmemis.',
  },
  'yuk dengeleyici': {
    concept: 'load-balancer-unspecified',
    ambiguous: true,
    note: 'App LB mi Net LB mi belirtilmemis.',
  },
  router: { concept: 'router', ambiguous: false, note: 'router kalemi (floating IP + egress tasiyabilir).' },
  'yonlendirici': { concept: 'router', ambiguous: false, note: 'router kalemi.' },
};

export interface AliasHit {
  alias: string;
  kind: 'product' | 'concept';
  product?: ProductAlias;
  concept?: ConceptAlias;
}

/**
 * Metinde gecen tum takma adlari bulur. En uzun eslesme oncelikli:
 * "premium disk" varken ayrica "premium" dondurmez.
 */
export function findAliases(text: string): AliasHit[] {
  const normalized = normalizeAlias(text);
  const hits: AliasHit[] = [];
  const consumed: Array<[number, number]> = [];

  const candidates: AliasHit[] = [
    ...Object.entries(PRODUCT_ALIASES).map(([alias, product]) => ({
      alias,
      kind: 'product' as const,
      product,
    })),
    ...Object.entries(CONCEPT_ALIASES).map(([alias, concept]) => ({
      alias,
      kind: 'concept' as const,
      concept,
    })),
  ].sort((a, b) => b.alias.length - a.alias.length);

  for (const candidate of candidates) {
    const pattern = new RegExp(`(?<![a-z0-9])${candidate.alias.replace(/ /g, '\\s+')}(?![a-z0-9])`, 'g');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(normalized)) !== null) {
      const span: [number, number] = [match.index, match.index + match[0].length];
      const overlaps = consumed.some(([s, e]) => span[0] < e && s < span[1]);
      if (overlaps) continue;
      consumed.push(span);
      hits.push(candidate);
    }
  }

  return hits;
}

/** Tek bir ifadeyi kesin urune cozer; kavramlar icin `undefined` doner. */
export function resolveProductAlias(text: string): ProductAlias | undefined {
  return PRODUCT_ALIASES[normalizeAlias(text)];
}
