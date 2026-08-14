import { describe, expect, it } from 'vitest';

import { Catalog } from '../src/core/catalog/catalog.js';
import { assessCatalogInventory } from '../src/core/catalog/inventory.js';
import { catalog } from './helpers.js';

describe('katalog envanter ve kapasite kapısı', () => {
  it('mevcut snapshot TL/USD teklif için hazır', () => {
    const report = assessCatalogInventory(catalog, ['TL', 'USD'], new Date(0));
    expect(report.ready).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.stats.publicEnabledFlavors).toBeGreaterThan(0);
    expect(report.stats.gpuFlavors).toBeGreaterThan(0);
    expect(report.warnings.map((warning) => warning.code)).toContain('UNSELECTABLE_COMPUTE_PRODUCTS');
  });

  it('seçilebilir flavor veya fiyat kalmazsa canlı kapısını kapatıyor', () => {
    const broken = new Catalog({
      products: catalog.products.map((product) => ({
        ...product,
        prices: product.prices.filter((price) => price.currency !== 'USD'),
      })),
      flavors: catalog.flavors.map((flavor) => ({ ...flavor, isDisabled: true })),
      volumeTypes: [...catalog.volumeTypes],
    });
    const report = assessCatalogInventory(broken, ['USD']);
    expect(report.ready).toBe(false);
    expect(report.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining(['NO_SELECTABLE_FLAVOR', 'MISSING_PRICE']),
    );
  });
});
