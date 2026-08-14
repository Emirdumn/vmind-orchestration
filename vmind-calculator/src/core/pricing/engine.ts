/**
 * FAZ 2.A — Fiyat motoru portu
 *
 * calculator.portvmind.com uretim bundle'indaki `Calculate` / `CalculateService` /
 * `ServiceTotals` fonksiyonlarinin BIREBIR portu.
 *
 *   Kaynak: https://calculator.portvmind.com/assets/index-DsenZ_4u.js
 *   Bozulmamis kopya: tests/reference/vmind-reference.mjs
 *
 * ############################################################################
 * # BU DOSYADA "DUZELTME" YAPMAYIN.                                          #
 * # Platformdaki her tuhaflik BILEREK korunmustur. Bir sapma, teklifimizin    #
 * # musterinin ekranda gordugu tutardan farkli cikmasi demektir.              #
 * # Sapmalar tests/pricing.spec.ts tarafindan referansa karsi yakalanir.      #
 * ############################################################################
 *
 * Korunan davranislar (docs/pricing-port-notes.md'de gerekceleriyle):
 *   1. Bilinmeyen productCode -> sessizce 0, hata yok
 *   2. Aylik = saatlik x 720 (sabit; ayin gercek uzunlugu yok sayilir)
 *   3. unit "GB" degilse miktar x1024 (yani "MB" de sisirir)
 *   4. pricingUnit "HOUR" degilse aylik = fiyat x miktar (x720 YOK)
 *   5. Data transfer kalemleri toplam SAATLIK maliyete EKLENMEZ, sadece aylik
 *   6. backup.estimatedCount = 0 -> kalem tamamen atlanir
 *   7. compute.storage miktari `size * count`, kubernetes storage'da ise
 *      SONUC count ile carpilir (ayni matematik, farkli sira - aynen korundu)
 *
 * TEK KASITLI FARK: secili para biriminde fiyat yoksa platform ham bir
 * TypeError firlatir; biz ayni noktada tipli `MissingPriceError` firlatiriz.
 * Zamanlama ve degerler ayni, yalnizca hata tipi teshis edilebilir.
 */
import type { Product, ProductPrice } from '../catalog/types.js';
import type {
  BackupData,
  ComputeData,
  Currency,
  DataTransferData,
  FloatingIpData,
  KubernetesData,
  LoadBalancerData,
  NetworkSpec,
  ObjectStorageData,
  RouterData,
  ServiceCode,
  StorageData,
  StorageSpec,
} from '../schema/estimate.js';
import { SERVICE_TITLES } from '../schema/estimate.js';

// ---------------------------------------------------------------------------
// Girdi / cikti tipleri
// ---------------------------------------------------------------------------

/** Ceviri fonksiyonu. Platform i18n kullanir; varsayilan kimlik fonksiyonu. */
export type Translate = (key: string) => string;

export interface PricingContext {
  currency: Currency;
  products: readonly Product[];
  t?: Translate;
}

export interface CalcResult {
  productObj?: Product;
  priceObj?: ProductPrice;
  hourly: number;
  monthly: number;
  /** PORT EKLENTISI (platformda yok): urun katalogda bulundu mu.
   *  Sessiz sifir tespiti icin - aritmetigi etkilemez. */
  found: boolean;
}

export interface PriceLine {
  productName: string;
  /** Platform bazen sayi bazen bicimlenmis string koyuyor - aynen korundu. */
  count: string | number | undefined;
  /** Data transfer satirlarinda platform "-" yaziyor (saatlik maliyeti yok). */
  hourly: number | '-';
  monthly: number;
  flavorCode?: string;
  service?: ServiceCode;
}

export interface ServiceResult {
  totalHourCost: number;
  totalMonthCost: number;
  summary: string[];
  lines: PriceLine[];
}

export interface TotalsResult {
  lines: PriceLine[];
  totalHourCost: number;
  totalMonthCost: number;
}

/** Secili para biriminde fiyati olmayan urun. Platformda ham TypeError'a karsilik gelir. */
export class MissingPriceError extends Error {
  constructor(
    readonly productCode: string,
    readonly currency: string,
  ) {
    super(
      `"${productCode}" urununun ${currency} cinsinden fiyati yok. ` +
        `Platformun hesaplayicisi bu noktada cokuyor (undefined.price).`,
    );
    this.name = 'MissingPriceError';
  }
}

const identity: Translate = (key) => key;

const serviceTitle = (code: ServiceCode): string => SERVICE_TITLES[code];

// ---------------------------------------------------------------------------
// Calculate — cekirdek
// ---------------------------------------------------------------------------

/**
 * Referans:
 *   Calculate=(_e,St,en,tn)=>{ en=en??1; ...
 *     if(!an) return {hourly:0,monthly:0};
 *     const on=an.prices.find(un=>un.currency===_e.currency), sn=on.price;
 *     return tn&&(en*=tn=="GB"?1:1024), nn=sn*en, rn=sn*en*720,
 *            on.pricingUnit!="HOUR"&&(rn=sn*en), {productObj:an,priceObj:on,hourly:nn,monthly:rn}}
 */
export function calculate(
  ctx: PricingContext,
  productCode: string | undefined,
  qty?: number,
  unit?: string,
): CalcResult {
  // `en=en??1` — miktar verilmezse 1 (load-balancer bu yolu kullanir).
  let quantity = qty ?? 1;

  const product = ctx.products.find((p) => p.productCode === productCode);
  // TUHAFLIK 1: bulunamayan urun sessizce 0. Uydurma bir kod fark edilmeden teklife girer.
  if (!product) return { hourly: 0, monthly: 0, found: false };

  const priceObj = product.prices.find((p) => p.currency === ctx.currency);
  if (!priceObj) throw new MissingPriceError(product.productCode, ctx.currency);
  const price = priceObj.price;

  // TUHAFLIK 3: "GB" DISINDAKI her birim x1024. Sema bu yuzden GB|TB ile sinirli.
  if (unit) quantity *= unit === 'GB' ? 1 : 1024;

  const hourly = price * quantity;
  // TUHAFLIK 2: sabit 720 saat.
  let monthly = price * quantity * 720;
  // TUHAFLIK 4: saatlik olmayan fiyatlandirmada carpan yok (NETW-OUT-001 = GB, VPS = UNIT).
  if (priceObj.pricingUnit !== 'HOUR') monthly = price * quantity;

  return { productObj: product, priceObj, hourly, monthly, found: true };
}

/** Referans: blockStorageLineName=(_e,St)=>`${_e("Block Storage")} - ${St.volumeTypeName||_e("Default")}` */
function blockStorageLineName(t: Translate, storage: StorageSpec): string {
  return `${t('Block Storage')} - ${storage.volumeTypeName || t('Default')}`;
}

// ---------------------------------------------------------------------------
// CalculateService — servis bazli dallanma
// ---------------------------------------------------------------------------

export function calculateService(
  ctx: PricingContext,
  service: ServiceCode,
  data: unknown,
): ServiceResult {
  const t = ctx.t ?? identity;
  let totalHourCost = 0;
  let totalMonthCost = 0;
  const summary: string[] = [];
  const lines: PriceLine[] = [];

  /** Data transfer kalemi: TUHAFLIK 5 — yalnizca aylik toplanir, saatlik "-" olarak yazilir. */
  const pushNetwork = (network: NetworkSpec, flavorCode?: string): void => {
    const r = calculate(ctx, network.productCode, network.traffic, network.unit);
    totalMonthCost += r.monthly;
    summary.push(`${network.traffic} ${network.unit} ${serviceTitle('data-transfer')}`);
    lines.push({
      productName: t('Data Transfer'),
      count: `${network.traffic} ${network.unit}`,
      hourly: '-',
      monthly: r.monthly,
      ...(flavorCode !== undefined ? { flavorCode } : {}),
    });
  };

  /** Floating IP kalemi: saatlik VE aylik toplanir. */
  const pushFloatingIp = (fip: { productCode: string; count: number }, flavorCode?: string): void => {
    const r = calculate(ctx, fip.productCode, fip.count);
    totalHourCost += r.hourly;
    totalMonthCost += r.monthly;
    summary.push(`${fip.count} ${serviceTitle('floating-ip')}`);
    lines.push({
      productName: t('Floating IP'),
      count: fip.count,
      hourly: r.hourly,
      monthly: r.monthly,
      ...(flavorCode !== undefined ? { flavorCode } : {}),
    });
  };

  if (service === 'compute') {
    const d = data as ComputeData;

    const main = calculate(ctx, d.productCode, d.count);
    summary.push(`${d.count} x ${main.productObj?.productName}`);
    lines.push({
      productName: main.productObj?.productName as string,
      count: d.count,
      hourly: main.hourly,
      monthly: main.monthly,
      flavorCode: d.productCode,
    });
    totalHourCost += main.hourly;
    totalMonthCost += main.monthly;

    // NOT: flavorCode olarak network'un degil COMPUTE'un kodu yaziliyor (platform quirk).
    if (d.network) pushNetwork(d.network, d.productCode);

    if (d.storage) {
      const count = d.count ?? 1;
      // TUHAFLIK 7a: miktar Calculate'e girmeden ONCE count ile carpilir.
      const r = calculate(ctx, d.storage.productCode, d.storage.size * count, d.storage.unit);
      totalHourCost += r.hourly;
      totalMonthCost += r.monthly;
      const prefix = count > 1 ? `${count} instances x ` : '';
      // NOT: asagidaki cift bosluk platformda da var.
      summary.push(`${prefix}${d.storage.size} ${d.storage.unit}  ${serviceTitle('storage')}`);
      lines.push({
        productName: blockStorageLineName(t, d.storage),
        count: `${prefix}${d.storage.size} ${d.storage.unit}`,
        hourly: r.hourly,
        monthly: r.monthly,
        flavorCode: d.productCode,
      });
    }

    if (d.backup) {
      const count = d.count ?? 1;
      const estimatedCount = d.backup.estimatedCount ?? 0;
      // TUHAFLIK 6: adet 0 ise kalem TAMAMEN atlanir - satir bile olusmaz.
      if (estimatedCount > 0) {
        // Birim sabit "GB" gecilir; compute icindeki backup'in unit alani yoktur.
        const r = calculate(ctx, d.backup.productCode, count * d.backup.sourceSize * estimatedCount, 'GB');
        totalHourCost += r.hourly;
        totalMonthCost += r.monthly;
        const prefix = count > 1 ? `${count} instances x ` : '';
        const label = `${prefix}${d.backup.sourceSize} GB x ${estimatedCount}  ${serviceTitle('backup')}`;
        summary.push(label);
        // NOT: platform `count` alanina ozet metnin AYNISINI koyuyor.
        lines.push({
          productName: t('Backup'),
          count: label,
          hourly: r.hourly,
          monthly: r.monthly,
          flavorCode: d.productCode,
        });
      }
    }

    if (d.floatingIp) pushFloatingIp(d.floatingIp, d.productCode);

    if (d.router) {
      if (d.router.floatingIp) pushFloatingIp(d.router.floatingIp, d.productCode);
      if (d.router.network) pushNetwork(d.router.network, d.productCode);
    }
  } else if (service === 'data-transfer') {
    const d = data as DataTransferData;
    pushNetwork(d);
  } else if (service === 'router') {
    const d = data as RouterData;
    if (d.floatingIp) pushFloatingIp(d.floatingIp);
    if (d.network) pushNetwork(d.network);
  } else if (service === 'storage') {
    const d = data as StorageData;
    // NOT: standalone storage count ile CARPILMAZ (compute icindekinin aksine).
    const r = calculate(ctx, d.productCode, d.size, d.unit);
    totalHourCost += r.hourly;
    totalMonthCost += r.monthly;
    summary.push(`${d.size} ${d.unit} ${serviceTitle('storage')}`);
    lines.push({
      productName: blockStorageLineName(t, d),
      count: `${d.size} ${d.unit}`,
      hourly: r.hourly,
      monthly: r.monthly,
    });
  } else if (service === 'backup') {
    const d = data as BackupData;
    // Standalone backup TB'yi BURADA cevirir, sonra Calculate'e "GB" gecer (cift carpma yok).
    const sizeInGb = Number(d.unit === 'TB' ? d.sourceSize * 1024 : d.sourceSize) || 0;
    const count = Number(d.estimatedCount) || 0;
    const totalGb = sizeInGb * count;
    if (totalGb > 0) {
      const r = calculate(ctx, d.productCode, totalGb, 'GB');
      totalHourCost += r.hourly;
      totalMonthCost += r.monthly;
      summary.push(`${count} ${t('Backups')} (${Math.round(totalGb)} GB total)`);
      lines.push({
        productName: t('Cloud Backup Service'),
        // NOT: miktar GB'ye cevrilmis ama etikette ORIJINAL birim yaziyor (platform quirk).
        count: `${count} backups x ${sizeInGb} ${d.unit}`,
        hourly: r.hourly,
        monthly: r.monthly,
      });
    }
  } else if (service === 'floating-ip') {
    const d = data as FloatingIpData;
    pushFloatingIp(d);
  } else if (service === 'object-storage') {
    const d = data as ObjectStorageData;
    if (d.storage) {
      const r = calculate(ctx, d.storage.productCode, d.storage.size, d.storage.unit);
      totalHourCost += r.hourly;
      totalMonthCost += r.monthly;
      summary.push(`${d.storage.size} ${d.storage.unit} ${serviceTitle('storage')}`);
      lines.push({
        productName: t('Object Storage'),
        count: `${d.storage.size} ${d.storage.unit}`,
        hourly: r.hourly,
        monthly: r.monthly,
      });
    }
    if (d.network) pushNetwork(d.network);
  } else if (service === 'load-balancer') {
    const d = data as LoadBalancerData;
    // Miktar verilmez -> 1. LB icin ozet satiri YOK, yalnizca lines kaydi (platform quirk).
    const r = calculate(ctx, d.productCode);
    totalHourCost += r.hourly;
    totalMonthCost += r.monthly;
    lines.push({
      productName: t('Load Balancer'),
      count: d.productCode === 'LB-001' ? 'App LoadBalancer' : 'Net LoadBalancer',
      hourly: r.hourly,
      monthly: r.monthly,
    });
    if (d.network) pushNetwork(d.network);
  } else if (service === 'kubernetes') {
    const d = data as KubernetesData;

    const master = calculate(ctx, d.master?.productCode, d.master?.count);
    totalHourCost += master.hourly;
    totalMonthCost += master.monthly;
    summary.push(`Master: ${master.productObj?.productName}`);
    lines.push({
      productName: `Master - ${master.productObj?.productName}`,
      count: d.master?.count,
      hourly: master.hourly,
      monthly: master.monthly,
      flavorCode: d.master?.productCode,
    });

    const worker = calculate(ctx, d.worker?.productCode, d.worker?.count);
    totalHourCost += worker.hourly;
    totalMonthCost += worker.monthly;
    summary.push(`Worker: ${d.worker?.count} x ${worker.productObj?.productName}`);
    lines.push({
      productName: `Worker - ${worker.productObj?.productName}`,
      count: d.worker?.count,
      hourly: worker.hourly,
      monthly: worker.monthly,
      flavorCode: d.worker?.productCode,
    });

    // TUHAFLIK 7b: compute'un aksine burada SONUC count ile carpilir.
    const masterStorage = d.master?.storage;
    if (masterStorage) {
      const count = d.master?.count ?? 1;
      const r = calculate(ctx, masterStorage.productCode, masterStorage.size, masterStorage.unit);
      totalHourCost += r.hourly * count;
      totalMonthCost += r.monthly * count;
      summary.push(`${count} x ${masterStorage.size} ${masterStorage.unit} ${serviceTitle('storage')}`);
      lines.push({
        productName: blockStorageLineName(t, masterStorage),
        count: `Master - ${count} instances x ${masterStorage.size} ${masterStorage.unit}`,
        hourly: r.hourly * count,
        monthly: r.monthly * count,
        flavorCode: d.master?.productCode,
      });
    }

    const workerStorage = d.worker?.storage;
    if (workerStorage) {
      const count = d.worker?.count ?? 1;
      const r = calculate(ctx, workerStorage.productCode, workerStorage.size, workerStorage.unit);
      totalHourCost += r.hourly * count;
      totalMonthCost += r.monthly * count;
      summary.push(`${count} x ${workerStorage.size} ${workerStorage.unit} ${serviceTitle('storage')}`);
      lines.push({
        productName: blockStorageLineName(t, workerStorage),
        count: `Worker - ${count} instances x ${workerStorage.size} ${workerStorage.unit}`,
        hourly: r.hourly * count,
        monthly: r.monthly * count,
        flavorCode: d.worker?.productCode,
      });
    }
  }

  return { totalHourCost, totalMonthCost, summary, lines };
}

// ---------------------------------------------------------------------------
// ServiceTotals — teklifin tamami
// ---------------------------------------------------------------------------

export interface EstimateLike {
  currency: Currency;
  list: ReadonlyArray<{ id?: string; service: ServiceCode; data: unknown }>;
}

/**
 * Teklifin tum kalemlerini gezer ve toplar.
 * Referanstaki gibi: satirlar ait olduklari `service` ile etiketlenir.
 */
export function serviceTotals(
  ctx: Omit<PricingContext, 'currency'>,
  estimate: EstimateLike,
): TotalsResult {
  const fullCtx: PricingContext = { ...ctx, currency: estimate.currency };
  const lines: PriceLine[] = [];
  let totalHourCost = 0;
  let totalMonthCost = 0;

  for (const item of estimate.list) {
    const r = calculateService(fullCtx, item.service, item.data);
    totalHourCost += r.totalHourCost;
    totalMonthCost += r.totalMonthCost;
    for (const line of r.lines) line.service = item.service;
    lines.push(...r.lines);
  }

  return { lines, totalHourCost, totalMonthCost };
}

/** Tek bir servisi izole fiyatlar (platformdaki `ServiceTotals(t, est, service, data)` yolu). */
export function serviceTotalsFor(
  ctx: PricingContext,
  service: ServiceCode,
  data: unknown,
): TotalsResult {
  const r = calculateService(ctx, service, data);
  return { lines: r.lines, totalHourCost: r.totalHourCost, totalMonthCost: r.totalMonthCost };
}
