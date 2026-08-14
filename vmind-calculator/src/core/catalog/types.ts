/** Katalog veri tipleri — `GET /billing/products`, `/compute/flavors`, `/compute/volume-types` */

export interface ProductPrice {
  startDate: string | null;
  price: number;
  /** Katalogda gorulen degerler: "TL" | "USD" | "EUR" */
  currency: string;
  /** "HOUR" | "GB" | "UNIT" — "HOUR" DISINDAKI her sey aylik carpani atlar (x720 yok). */
  pricingUnit: string;
}

export interface Product {
  /** LOAD_BALANCER | VOLUME | NETWORK | VPS | COMPUTE | OBJECT_STORAGE */
  service: string;
  /** "LB-001" gibi kod VEYA flavor/volume-type UUID'si. */
  productCode: string;
  productName: string;
  productDescription: string | null;
  productUUID: string | null;
  detailJson: unknown;
  prices: ProductPrice[];
}

export interface Flavor {
  id: string;
  name: string;
  vcpus: number;
  /** MB cinsinden. */
  ram: number;
  vgpus: number;
  vram: number;
  disk: number;
  ephemeralDisk: number;
  computeFamily: string | null;
  computeDescription: string | null;
  isDisabled: boolean;
  isPublic: boolean;
  priceTL: number;
  priceUSD: number;
  priceEUR: number;
}

export interface VolumeType {
  id: string;
  name: string;
  /** flavor'larin aksine burada productCode = id. */
  productCode: string;
  priceTL: number;
  priceUSD: number;
  priceEUR: number;
}

/** API zarfi: `{ result: {...}, items: [...] }` */
export interface ApiEnvelope<T> {
  result: { success: boolean; type: number; message: string | null; status: string | null };
  items: T[];
}
