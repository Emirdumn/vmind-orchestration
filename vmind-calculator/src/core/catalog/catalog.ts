/**
 * FAZ 1.B — Katalog normalizasyonu
 *
 * Ajanin urun secebildigi TEK kaynak. `productCode` uydurmayi imkansiz kilar:
 * burada olmayan bir kod tool katmanindan geri cevrilir.
 *
 * Kritik ayrinti: flavor'lar ve volume type'lar AYRI endpoint'lerden gelir ama
 * fiyatlari `billing/products` icindedir — `flavor.id` dogrudan `productCode`'dur.
 * Fiyat motoru yalnizca products listesine bakar; bir flavor products'ta yoksa
 * secildiginde SESSIZCE 0 TL olur. `assertPriceable()` bunu onceden yakalar.
 */
import type { ApiEnvelope, Flavor, Product, VolumeType } from './types.js';
import type { Currency, ServiceCode } from '../schema/estimate.js';

export interface CatalogSnapshot {
  products: Product[];
  flavors: Flavor[];
  volumeTypes: VolumeType[];
  /** Snapshot'in alindigi an (ISO). Drift dedektoru kullanir. */
  fetchedAt?: string;
}

/** Katalogda bulunamayan urun kodu. */
export class UnknownProductCodeError extends Error {
  constructor(readonly productCode: string) {
    super(
      `"${productCode}" katalogda yok. Fiyat motoru bunu sessizce 0 TL olarak gecer. ` +
        `Yalnizca catalog.searchProducts / searchFlavors ciktisindaki kodlar kullanilabilir.`,
    );
    this.name = 'UnknownProductCodeError';
  }
}

export class Catalog {
  private readonly byCode: Map<string, Product>;
  readonly products: readonly Product[];
  readonly flavors: readonly Flavor[];
  readonly volumeTypes: readonly VolumeType[];
  readonly fetchedAt: string | undefined;

  constructor(snapshot: CatalogSnapshot) {
    this.products = snapshot.products;
    this.flavors = snapshot.flavors;
    this.volumeTypes = snapshot.volumeTypes;
    this.fetchedAt = snapshot.fetchedAt;
    this.byCode = new Map(snapshot.products.map((p) => [p.productCode, p]));
  }

  /** Ham API zarflarindan katalog kurar. */
  static fromEnvelopes(
    products: ApiEnvelope<Product>,
    flavors: ApiEnvelope<Flavor>,
    volumeTypes: ApiEnvelope<VolumeType>,
    fetchedAt?: string,
  ): Catalog {
    return new Catalog({
      products: products.items,
      flavors: flavors.items,
      volumeTypes: volumeTypes.items,
      ...(fetchedAt !== undefined ? { fetchedAt } : {}),
    });
  }

  find(productCode: string): Product | undefined {
    return this.byCode.get(productCode);
  }

  has(productCode: string): boolean {
    return this.byCode.has(productCode);
  }

  /**
   * Kodun hem katalogda oldugunu HEM de secili para biriminde fiyati oldugunu dogrular.
   * Ikincisi olmazsa platformun hesaplayicisi coker (undefined.price).
   */
  assertPriceable(productCode: string, currency: Currency): Product {
    const product = this.byCode.get(productCode);
    if (!product) throw new UnknownProductCodeError(productCode);
    if (!product.prices.some((p) => p.currency === currency)) {
      throw new Error(
        `"${productCode}" urununun ${currency} fiyati yok — bu teklif platformda hata verir.`,
      );
    }
    return product;
  }

  priceOf(productCode: string, currency: Currency): number | undefined {
    return this.byCode.get(productCode)?.prices.find((p) => p.currency === currency)?.price;
  }

  /** Serbest metinle urun arar (ad, kod ve aciklamada gecen alt dizge). */
  search(query: string, service?: string): Product[] {
    const q = query.trim().toLowerCase();
    return this.products.filter((p) => {
      if (service && p.service !== service) return false;
      if (!q) return true;
      return (
        p.productCode.toLowerCase().includes(q) ||
        p.productName.toLowerCase().includes(q) ||
        (p.productDescription ?? '').toLowerCase().includes(q)
      );
    });
  }

  /** vCPU / RAM / GPU alt sinirlarina gore instance tipi arar. */
  searchFlavors(filter: { minVcpu?: number; minRamGb?: number; gpu?: boolean } = {}): Flavor[] {
    return this.flavors.filter((f) => {
      if (f.isDisabled || !f.isPublic) return false;
      if (filter.minVcpu !== undefined && f.vcpus < filter.minVcpu) return false;
      if (filter.minRamGb !== undefined && f.ram / 1024 < filter.minRamGb) return false;
      if (filter.gpu !== undefined && filter.gpu !== f.vgpus > 0) return false;
      return true;
    });
  }

  flavorByName(name: string): Flavor | undefined {
    const n = name.trim().toLowerCase();
    return this.flavors.find((f) => f.name.toLowerCase() === n);
  }

  volumeTypeByName(name: string): VolumeType | undefined {
    const n = name.trim().toLowerCase();
    return this.volumeTypes.find((v) => v.name.toLowerCase() === n);
  }

  /**
   * Katalogda olup flavor listesinde OLMAYAN compute urunleri.
   * Bunlar arayuzden secilemez; ajan da onermemeli (ornek: ex_gpu.* rezerve tipler).
   */
  unselectableComputeProducts(): Product[] {
    const flavorIds = new Set(this.flavors.map((f) => f.id));
    return this.products.filter((p) => p.service === 'COMPUTE' && !flavorIds.has(p.productCode));
  }

  /** Secili para biriminde fiyati olmayan urunler — hesaplayiciyi coktururler. */
  productsMissingPrice(currency: string): Product[] {
    return this.products.filter((p) => !p.prices.some((x) => x.currency === currency));
  }

  currencies(): string[] {
    return [...new Set(this.products.flatMap((p) => p.prices.map((x) => x.currency)))];
  }
}

/**
 * Servis kodu -> o serviste kullanilabilecek urunlerin `product.service` degeri.
 * `billing/products` bizim 9 servis kodumuzdan FARKLI bir siniflandirma kullaniyor.
 */
export const PRODUCT_SERVICE_BY_ESTIMATE_SERVICE = {
  compute: ['COMPUTE'],
  storage: ['VOLUME'],
  'data-transfer': ['NETWORK'],
  'floating-ip': ['NETWORK'],
  'load-balancer': ['LOAD_BALANCER'],
  kubernetes: ['COMPUTE'],
  'object-storage': ['OBJECT_STORAGE'],
  router: ['NETWORK'],
  backup: ['VOLUME'],
} as const satisfies Record<ServiceCode, readonly string[]>;
