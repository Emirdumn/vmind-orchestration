import { PRODUCT_SERVICE_BY_ESTIMATE_SERVICE, type Catalog } from './catalog.js';
import { SERVICE_CODES, type Currency } from '../schema/estimate.js';

export interface InventoryFinding {
  code: string;
  message: string;
  productCodes: string[];
}

export interface InventoryReport {
  checkedAt: string;
  currencies: string[];
  stats: {
    products: number;
    publicEnabledFlavors: number;
    gpuFlavors: number;
    volumeTypes: number;
    unselectableComputeProducts: number;
  };
  blockers: InventoryFinding[];
  warnings: InventoryFinding[];
  ready: boolean;
}

/** Canlıya çıkmadan önce katalog/flavor envanterinin fiyatlanabilirlik kapısı. */
export function assessCatalogInventory(
  catalog: Catalog,
  currencies: readonly Currency[] = ['TL', 'USD'],
  now = new Date(),
): InventoryReport {
  const blockers: InventoryFinding[] = [];
  const warnings: InventoryFinding[] = [];
  const selectable = catalog.searchFlavors();
  const gpu = selectable.filter((flavor) => flavor.vgpus > 0);

  if (selectable.length === 0) {
    blockers.push({ code: 'NO_SELECTABLE_FLAVOR', message: 'Etkin/public instance tipi yok.', productCodes: [] });
  }
  for (const currency of currencies) {
    const missing = catalog.productsMissingPrice(currency).map((product) => product.productCode);
    if (missing.length > 0) {
      blockers.push({
        code: 'MISSING_PRICE',
        message: `${currency} fiyatı eksik ürünler var.`,
        productCodes: missing,
      });
    }
    const flavorMissing = selectable
      .filter((flavor) => catalog.priceOf(flavor.id, currency) === undefined)
      .map((flavor) => flavor.id);
    if (flavorMissing.length > 0) {
      blockers.push({
        code: 'SELECTABLE_FLAVOR_MISSING_PRICE',
        message: `${currency} fiyatı olmayan seçilebilir flavor var.`,
        productCodes: flavorMissing,
      });
    }
  }
  for (const service of SERVICE_CODES) {
    const productServices = PRODUCT_SERVICE_BY_ESTIMATE_SERVICE[service] as readonly string[];
    const matches = catalog.products.filter((product) => productServices.includes(product.service));
    if (matches.length === 0) {
      blockers.push({
        code: 'SERVICE_WITHOUT_PRODUCT',
        message: `${service} için katalog ürünü yok.`,
        productCodes: [],
      });
    }
  }
  const missingVolumeTypes = catalog.volumeTypes
    .filter((volume) => !catalog.has(volume.productCode))
    .map((volume) => volume.productCode);
  if (missingVolumeTypes.length > 0) {
    blockers.push({
      code: 'VOLUME_TYPE_NOT_PRICEABLE',
      message: 'Volume type fiyat kataloğunda yok.',
      productCodes: missingVolumeTypes,
    });
  }
  const unselectable = catalog.unselectableComputeProducts().map((product) => product.productCode);
  if (unselectable.length > 0) {
    warnings.push({
      code: 'UNSELECTABLE_COMPUTE_PRODUCTS',
      message: 'Fiyat kataloğunda olup Calculator flavor listesinde olmayan compute ürünleri ajan tarafından kullanılamaz.',
      productCodes: unselectable,
    });
  }
  if (gpu.length === 0) {
    warnings.push({ code: 'NO_GPU_FLAVOR', message: 'Etkin/public GPU flavor yok.', productCodes: [] });
  }
  return {
    checkedAt: now.toISOString(),
    currencies: [...currencies],
    stats: {
      products: catalog.products.length,
      publicEnabledFlavors: selectable.length,
      gpuFlavors: gpu.length,
      volumeTypes: catalog.volumeTypes.length,
      unselectableComputeProducts: unselectable.length,
    },
    blockers,
    warnings,
    ready: blockers.length === 0,
  };
}
