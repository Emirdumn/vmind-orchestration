/**
 * FAZ 2.C GATE: "Fiyat değişimi simüle edildiğinde dedektör uyarı veriyor."
 *
 * Dedektör saf fonksiyon olduğu için ağ olmadan simüle edilebiliyor.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  detectBundleDrift,
  detectCatalogDrift,
  driftVerdict,
  type DriftInput,
} from '../src/core/catalog/drift.js';
import type { ApiEnvelope, Flavor, Product, VolumeType } from '../src/core/catalog/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = <T>(name: string): ApiEnvelope<T> =>
  JSON.parse(readFileSync(join(here, '..', 'fixtures', 'catalog', name), 'utf8'));

const baseline = (): DriftInput => ({
  products: structuredClone(read<Product>('products.json').items),
  flavors: structuredClone(read<Flavor>('flavors.json').items),
  volumeTypes: structuredClone(read<VolumeType>('volume-types.json').items),
});

const findProduct = (input: DriftInput, code: string): Product =>
  input.products.find((p) => p.productCode === code)!;

describe('Faz 2.C — drift dedektörü', () => {
  it('değişiklik yoksa bulgu üretmiyor', () => {
    const findings = detectCatalogDrift(baseline(), baseline());
    expect(findings).toEqual([]);
    expect(driftVerdict(findings)).toBe('ok');
  });

  it('küçük fiyat değişimi UYARI veriyor, akış devam ediyor', () => {
    const after = baseline();
    const product = findProduct(after, 'LB-001');
    const price = product.prices.find((p) => p.currency === 'TL')!;
    price.price = price.price * 1.05; // %5 zam

    const findings = detectCatalogDrift(baseline(), after);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('PRICE_CHANGED');
    expect(findings[0]!.severity).toBe('warning');
    expect(findings[0]!.message).toContain('LB-001');
    expect(driftVerdict(findings)).toBe('proceed-with-warning');
  });

  it('büyük fiyat değişimi (>=%20) DURDURUCU', () => {
    const after = baseline();
    const price = findProduct(after, 'FIP-001').prices.find((p) => p.currency === 'TL')!;
    price.price = price.price * 1.35;

    const findings = detectCatalogDrift(baseline(), after);
    expect(findings[0]!.kind).toBe('PRICE_CHANGED_MAJOR');
    expect(driftVerdict(findings)).toBe('stop');
  });

  it('ürün kaldırılması DURDURUCU — sessiz 0 TL riski', () => {
    const after = baseline();
    after.products = after.products.filter((p) => p.productCode !== 'OBS-001');

    const findings = detectCatalogDrift(baseline(), after);
    expect(findings.some((f) => f.kind === 'PRODUCT_REMOVED' && f.subject === 'OBS-001')).toBe(true);
    expect(findings.find((f) => f.kind === 'PRODUCT_REMOVED')!.message).toContain('SESSIZCE 0 TL');
    expect(driftVerdict(findings)).toBe('stop');
  });

  it('para birimi fiyatının kaldırılması DURDURUCU — hesaplayıcı çöker', () => {
    const after = baseline();
    const product = findProduct(after, 'VL-001');
    product.prices = product.prices.filter((p) => p.currency !== 'USD');

    const findings = detectCatalogDrift(baseline(), after);
    expect(findings.some((f) => f.kind === 'CURRENCY_REMOVED')).toBe(true);
    expect(driftVerdict(findings)).toBe('stop');
  });

  it('pricingUnit değişimi DURDURUCU — x720 çarpanı kayar', () => {
    const after = baseline();
    findProduct(after, 'NETW-OUT-001').prices.forEach((p) => {
      p.pricingUnit = 'HOUR';
    });

    const findings = detectCatalogDrift(baseline(), after);
    expect(findings.some((f) => f.kind === 'PRICING_UNIT_CHANGED')).toBe(true);
    expect(driftVerdict(findings)).toBe('stop');
  });

  it('yeni ürün yalnızca BILGI', () => {
    const after = baseline();
    after.products.push({
      service: 'OBJECT_STORAGE',
      productCode: 'OBS-002',
      productName: 'Object Storage Arşiv',
      productDescription: null,
      productUUID: null,
      detailJson: null,
      prices: [{ startDate: null, price: 0.0001, currency: 'TL', pricingUnit: 'HOUR' }],
    });

    const findings = detectCatalogDrift(baseline(), after);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('info');
    expect(driftVerdict(findings)).toBe('ok');
  });

  it('instance tipinin kaldırılması DURDURUCU', () => {
    const after = baseline();
    after.flavors = after.flavors.filter((f) => f.name !== 'g1.small');

    const findings = detectCatalogDrift(baseline(), after);
    expect(findings.some((f) => f.kind === 'FLAVOR_REMOVED')).toBe(true);
    expect(driftVerdict(findings)).toBe('stop');
  });
});

describe('Faz 2.C — bundle drift', () => {
  const current = { asset: 'assets/index-DsenZ_4u.js', etag: '"6a54e00c-1d9927"' };

  it('aynı bundle -> bulgu yok', () => {
    expect(detectBundleDrift(current, { ...current })).toEqual([]);
  });

  it('bundle değişimi DURDURUCU — port sapmış olabilir', () => {
    const findings = detectBundleDrift(current, { asset: 'assets/index-XXXXXXXX.js', etag: '"yeni"' });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('BUNDLE_CHANGED');
    expect(findings[0]!.severity).toBe('blocker');
    expect(driftVerdict(findings)).toBe('stop');
  });

  it('içerik aynı ama etag değişmiş -> yine durdurucu (temkinli taraf)', () => {
    const findings = detectBundleDrift(current, { ...current, etag: '"farkli"' });
    expect(findings).toHaveLength(1);
  });
});
