/**
 * FAZ 2.C — Katalog & bundle drift dedektörü
 *
 * İki riski birlikte izler:
 *
 *   1. KATALOG DRIFT — ürün/fiyat/birim değişimi. Kaydedilmiş bir teklif aynı
 *      kalır ama yeniden hesaplandığında farklı tutar verir.
 *   2. BUNDLE DRIFT — frontend'in kendisi güncellenmiş olabilir; yani portladığımız
 *      `CalculateService` mantığı artık platformdakinden farklı olabilir.
 *      PLAN §5'teki "sessiz sapma" riski tam olarak budur.
 *
 * Saf fonksiyon: ağ erişimi yok, böylece testlerde simüle edilebilir.
 */
import type { Flavor, Product, VolumeType } from './types.js';

export type DriftSeverity = 'blocker' | 'warning' | 'info';

export type DriftKind =
  | 'PRODUCT_REMOVED'
  | 'PRODUCT_ADDED'
  | 'PRICE_CHANGED'
  | 'PRICE_CHANGED_MAJOR'
  | 'PRICING_UNIT_CHANGED'
  | 'CURRENCY_REMOVED'
  | 'CURRENCY_ADDED'
  | 'FLAVOR_REMOVED'
  | 'FLAVOR_ADDED'
  | 'VOLUME_TYPE_REMOVED'
  | 'VOLUME_TYPE_ADDED'
  | 'BUNDLE_CHANGED';

export interface DriftFinding {
  kind: DriftKind;
  severity: DriftSeverity;
  /** Etkilenen ürün/flavor kodu (varsa). */
  subject?: string;
  message: string;
  before?: unknown;
  after?: unknown;
}

/** Bu oranın üzerindeki fiyat değişimi uyarı değil, durdurucu sayılır. */
export const MAJOR_PRICE_CHANGE_RATIO = 0.2;

export interface DriftInput {
  products: Product[];
  flavors: Flavor[];
  volumeTypes: VolumeType[];
}

export interface BundleRef {
  /** "assets/index-DsenZ_4u.js" — içerik değişince hash değişir. */
  asset: string;
  etag?: string;
  lastModified?: string;
  contentLength?: number;
}

export function detectCatalogDrift(before: DriftInput, after: DriftInput): DriftFinding[] {
  const findings: DriftFinding[] = [];

  const beforeProducts = new Map(before.products.map((p) => [p.productCode, p]));
  const afterProducts = new Map(after.products.map((p) => [p.productCode, p]));

  for (const [code, old] of beforeProducts) {
    const now = afterProducts.get(code);
    if (!now) {
      findings.push({
        kind: 'PRODUCT_REMOVED',
        severity: 'blocker',
        subject: code,
        message:
          `"${old.productName}" (${code}) katalogdan kalkmış. ` +
          `Bu kodu kullanan teklifler artık SESSIZCE 0 TL hesaplanır.`,
        before: old.productName,
      });
      continue;
    }

    const beforePrices = new Map(old.prices.map((p) => [p.currency, p]));
    const afterPrices = new Map(now.prices.map((p) => [p.currency, p]));

    for (const [currency, oldPrice] of beforePrices) {
      const newPrice = afterPrices.get(currency);
      if (!newPrice) {
        findings.push({
          kind: 'CURRENCY_REMOVED',
          severity: 'blocker',
          subject: code,
          message:
            `${code} ürününün ${currency} fiyatı kaldırılmış. ` +
            `Bu para birimi seçilirse platformun hesaplayıcısı ÇÖKER (undefined.price).`,
          before: oldPrice.price,
        });
        continue;
      }

      if (newPrice.pricingUnit !== oldPrice.pricingUnit) {
        findings.push({
          kind: 'PRICING_UNIT_CHANGED',
          severity: 'blocker',
          subject: code,
          message:
            `${code} fiyatlandırma birimi ${oldPrice.pricingUnit} -> ${newPrice.pricingUnit}. ` +
            `Aylık x720 çarpanının uygulanıp uygulanmayacağı değişti.`,
          before: oldPrice.pricingUnit,
          after: newPrice.pricingUnit,
        });
      }

      if (newPrice.price !== oldPrice.price) {
        const ratio = oldPrice.price === 0 ? Infinity : Math.abs(newPrice.price - oldPrice.price) / oldPrice.price;
        const major = ratio >= MAJOR_PRICE_CHANGE_RATIO;
        findings.push({
          kind: major ? 'PRICE_CHANGED_MAJOR' : 'PRICE_CHANGED',
          severity: major ? 'blocker' : 'warning',
          subject: code,
          message:
            `${code} ${currency} fiyatı ${oldPrice.price} -> ${newPrice.price} ` +
            `(%${(ratio * 100).toFixed(1)} değişim).`,
          before: oldPrice.price,
          after: newPrice.price,
        });
      }
    }

    for (const [currency, newPrice] of afterPrices) {
      if (!beforePrices.has(currency)) {
        findings.push({
          kind: 'CURRENCY_ADDED',
          severity: 'info',
          subject: code,
          message: `${code} için yeni para birimi: ${currency} (${newPrice.price}).`,
          after: newPrice.price,
        });
      }
    }
  }

  for (const [code, now] of afterProducts) {
    if (!beforeProducts.has(code)) {
      findings.push({
        kind: 'PRODUCT_ADDED',
        severity: 'info',
        subject: code,
        message: `Yeni ürün: "${now.productName}" (${code}). Sözlüğe takma ad eklenmeli mi?`,
        after: now.productName,
      });
    }
  }

  const compareNamed = <T extends { id: string; name: string }>(
    beforeList: T[],
    afterList: T[],
    removedKind: DriftKind,
    addedKind: DriftKind,
    label: string,
  ): void => {
    const beforeIds = new Map(beforeList.map((x) => [x.id, x]));
    const afterIds = new Map(afterList.map((x) => [x.id, x]));
    for (const [id, old] of beforeIds) {
      if (!afterIds.has(id)) {
        findings.push({
          kind: removedKind,
          severity: 'blocker',
          subject: id,
          message: `${label} "${old.name}" kaldırılmış — bu kodu içeren teklifler geçersiz.`,
          before: old.name,
        });
      }
    }
    for (const [id, now] of afterIds) {
      if (!beforeIds.has(id)) {
        findings.push({
          kind: addedKind,
          severity: 'info',
          subject: id,
          message: `Yeni ${label}: "${now.name}".`,
          after: now.name,
        });
      }
    }
  };

  compareNamed(before.flavors, after.flavors, 'FLAVOR_REMOVED', 'FLAVOR_ADDED', 'instance tipi');
  compareNamed(before.volumeTypes, after.volumeTypes, 'VOLUME_TYPE_REMOVED', 'VOLUME_TYPE_ADDED', 'volume type');

  return findings;
}

/**
 * Frontend bundle'ı değişmiş mi? Değiştiyse portladığımız fiyat mantığı
 * artık platformdakiyle aynı olmayabilir — bu her zaman durdurucudur.
 */
export function detectBundleDrift(before: BundleRef, after: BundleRef): DriftFinding[] {
  if (before.asset === after.asset && before.etag === after.etag) return [];
  return [
    {
      kind: 'BUNDLE_CHANGED',
      severity: 'blocker',
      subject: after.asset,
      message:
        `Frontend bundle değişti (${before.asset} -> ${after.asset}). ` +
        `Fiyat mantığı değişmiş olabilir: tests/reference/vmind-reference.mjs yeniden ` +
        `çıkarılmalı ve Faz 2 testleri tekrar çalıştırılmalı (docs/pricing-port-notes.md §5).`,
      before: before.asset,
      after: after.asset,
    },
  ];
}

/**
 * KARAR (PLAN 2.C GATE gereği belgelenmiştir):
 *
 *   blocker  -> ajan DURUR. Teklif üretmez. İnsan müdahalesi gerekir.
 *   warning  -> ajan DEVAM EDER, ancak fark teklif özetinde açıkça belirtilir.
 *   info     -> yalnızca rapora yazılır.
 *
 * Gerekçe: `warning` yalnızca "aynı ürün, farklı fiyat" durumudur — hesap doğru
 * kalır, sadece güncel katalogla yapılır ve bu zaten istenen davranıştır.
 * `blocker` ise hesabın SESSIZCE yanlış çıkabileceği durumları kapsar
 * (ürün kaybolmuş -> 0 TL, birim değişmiş -> x720 kayması, bundle değişmiş ->
 * port sapmış olabilir). Sessiz yanlış tutar, bu projenin önlemek için var olduğu
 * tek şeydir; şüphede kalındığında durmak doğru varsayılandır.
 *
 * %20 eşiği (MAJOR_PRICE_CHANGE_RATIO) VMind ile teyit edilmelidir —
 * olağan zam aralığı bunun üzerindeyse eşik yükseltilmeli.
 */
export function driftVerdict(findings: DriftFinding[]): 'stop' | 'proceed-with-warning' | 'ok' {
  if (findings.some((f) => f.severity === 'blocker')) return 'stop';
  if (findings.some((f) => f.severity === 'warning')) return 'proceed-with-warning';
  return 'ok';
}
