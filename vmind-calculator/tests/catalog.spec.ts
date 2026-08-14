/**
 * FAZ 1.B kabul kriterleri + FAZ 0.C katalog GATE kontrolleri.
 *
 * Bu testler snapshot'a karsi calisir; canli katalog degistiginde
 * `npm run snapshot:catalog` ile guncellenir ve buradaki iddialar yeniden dogrulanir.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Catalog, PRODUCT_SERVICE_BY_ESTIMATE_SERVICE } from '../src/core/catalog/catalog.js';
import {
  CONCEPT_ALIASES,
  PRODUCT_ALIASES,
  findAliases,
  normalizeAlias,
  resolveProductAlias,
} from '../src/core/catalog/aliases.js';
import { SERVICE_CODES } from '../src/core/schema/estimate.js';
import type { ApiEnvelope, Flavor, Product, VolumeType } from '../src/core/catalog/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = <T>(name: string): ApiEnvelope<T> =>
  JSON.parse(readFileSync(join(here, '..', 'fixtures', 'catalog', name), 'utf8'));

const catalog = Catalog.fromEnvelopes(
  read<Product>('products.json'),
  read<Flavor>('flavors.json'),
  read<VolumeType>('volume-types.json'),
);

describe('Faz 0.C — katalog GATE', () => {
  it('9 servis kodunun her biri icin en az bir productCode var', () => {
    for (const service of SERVICE_CODES) {
      const productServices = PRODUCT_SERVICE_BY_ESTIMATE_SERVICE[service];
      const matches = catalog.products.filter((p) => (productServices as readonly string[]).includes(p.service));
      expect(matches.length, `${service} icin urun bulunamadi`).toBeGreaterThan(0);
    }
  });

  it('TL ve USD icin fiyati eksik urun YOK (bu ikisi arayuzde secilebilir)', () => {
    expect(catalog.productsMissingPrice('TL').map((p) => p.productCode)).toEqual([]);
    expect(catalog.productsMissingPrice('USD').map((p) => p.productCode)).toEqual([]);
  });

  it('EUR fiyati eksik urunler BELGELENMIS — bu yuzden EUR desteklenmiyor', () => {
    // Arayuz yalnizca TL/USD sunuyor. EUR secilebilseydi bu urunler
    // `priceObj.price` uzerinde TypeError firlatip hesaplayiciyi cokertirdi.
    const missing = catalog.productsMissingPrice('EUR').map((p) => p.productCode).sort();
    expect(missing).toEqual(['FIP-001', 'LB-001', 'LB-002', 'NETW-OUT-001', 'VL-001', 'VL-002']);
  });

  it('her flavor fiyat katalogunda var (yoksa secildiginde sessizce 0 TL olur)', () => {
    const missing = catalog.flavors.filter((f) => !catalog.has(f.id)).map((f) => f.name);
    expect(missing).toEqual([]);
  });

  it('her volume type fiyat katalogunda var', () => {
    const missing = catalog.volumeTypes.filter((v) => !catalog.has(v.productCode)).map((v) => v.name);
    expect(missing).toEqual([]);
  });

  it('flavor listesinde olmayan compute urunleri isaretli (ajan bunlari onermemeli)', () => {
    const unselectable = catalog.unselectableComputeProducts().map((p) => p.productName).sort();
    // ex_gpu.* tipleri fiyat katalogunda var ama arayuzdeki flavor secicisinde yok.
    expect(unselectable.every((n) => n.startsWith('ex_gpu.'))).toBe(true);
  });
});

describe('Faz 1.B — jargon sozlugu kabul kriterleri', () => {
  const productKeys = Object.keys(PRODUCT_ALIASES);
  const conceptKeys = Object.keys(CONCEPT_ALIASES);

  it('en az 30 takma ad var', () => {
    expect(productKeys.length + conceptKeys.length).toBeGreaterThanOrEqual(30);
  });

  it('tum takma adlar normalize edilmis formda (aksi halde arama tutmaz)', () => {
    for (const key of [...productKeys, ...conceptKeys]) {
      expect(normalizeAlias(key), `"${key}" normalize edilmemis`).toBe(key);
    }
  });

  it('hicbir takma ad hem urune hem kavrama eslesmiyor (belirsizlik yasak)', () => {
    const overlap = productKeys.filter((k) => k in CONCEPT_ALIASES);
    expect(overlap).toEqual([]);
  });

  it('her takma adin hedef productCode\'u katalogda mevcut', () => {
    for (const [alias, target] of Object.entries(PRODUCT_ALIASES)) {
      expect(catalog.has(target.productCode), `${alias} -> ${target.productCode} katalogda yok`).toBe(true);
    }
  });

  it('takma adin hedefi, belirttigi servisle uyumlu', () => {
    for (const [alias, target] of Object.entries(PRODUCT_ALIASES)) {
      const product = catalog.find(target.productCode)!;
      const allowed = PRODUCT_SERVICE_BY_ESTIMATE_SERVICE[target.service] as readonly string[];
      expect(allowed.includes(product.service), `${alias}: ${product.service} != ${target.service}`).toBe(true);
    }
  });

  it('Turkce aksanlar ve buyuk harf tolere ediliyor', () => {
    expect(resolveProductAlias('Premium Disk')?.productCode).toBe(resolveProductAlias('premium disk')?.productCode);
    expect(resolveProductAlias('ÇIKIŞ TRAFİĞİ')?.productCode).toBe('NETW-OUT-001');
    expect(resolveProductAlias('yedekleme')?.productCode).toBe('BC-001');
  });
});

describe('Faz 1.B — PLAN.md §3 ornek cumlesi', () => {
  const sentence =
    'Müşteri 4 sunucu istiyor, load balancer olsun, worker olsun, premium disk olsun, backup olsun.';
  const hits = findAliases(sentence);
  const aliases = hits.map((h) => h.alias);

  it('kesin urunleri cozuyor', () => {
    expect(aliases).toContain('premium disk');
    expect(aliases).toContain('backup');
    const premium = hits.find((h) => h.alias === 'premium disk');
    expect(premium?.product?.label).toBe('PortvMind-Premium-SSD');
  });

  it('"worker" ve "load balancer" BELIRSIZ olarak isaretleniyor, urune baglanmiyor', () => {
    const worker = hits.find((h) => h.alias === 'worker');
    expect(worker?.kind).toBe('concept');
    expect(worker?.concept?.ambiguous).toBe(true);

    const lb = hits.find((h) => h.alias === 'load balancer');
    expect(lb?.kind).toBe('concept');
    expect(lb?.concept?.ambiguous).toBe(true);
  });

  it('"sunucu" compute kavramina cozuluyor', () => {
    expect(hits.find((h) => h.alias === 'sunucu')?.concept?.concept).toBe('app-server');
  });

  it('en uzun eslesme kazaniyor — "premium disk" varken ayrica "premium" dondurmuyor', () => {
    expect(aliases.filter((a) => a === 'premium')).toEqual([]);
  });
});

describe('Faz 1.B — belirsizlik tuzaklari', () => {
  it('"app load balancer" App LB\'ye cozuluyor, belirsiz sayilmiyor', () => {
    const hits = findAliases('onunde app load balancer olsun');
    expect(hits.find((h) => h.kind === 'product')?.product?.productCode).toBe('LB-001');
    expect(hits.some((h) => h.alias === 'load balancer')).toBe(false);
  });

  it('"yedeklilik" (HA) ile "yedekleme" (backup) karistirilmiyor', () => {
    const ha = findAliases('yedeklilik istiyoruz');
    expect(ha.find((h) => h.alias === 'yedeklilik')?.concept?.concept).toBe('high-availability');
    expect(ha.some((h) => h.alias === 'yedek')).toBe(false);

    const backup = findAliases('yedekleme alsin');
    expect(backup.find((h) => h.alias === 'yedekleme')?.product?.productCode).toBe('BC-001');
  });

  it('bilinmeyen ifade sessizce urune eslesmiyor', () => {
    expect(resolveProductAlias('kuantum hizlandirici')).toBeUndefined();
  });
});

describe('Faz 1.B — katalog yardimcilari', () => {
  it('assertPriceable bilinmeyen kodu reddediyor', () => {
    expect(() => catalog.assertPriceable('UYDURMA-KOD', 'TL')).toThrow(/katalogda yok/);
  });

  it('assertPriceable gecerli kodu kabul ediyor', () => {
    expect(catalog.assertPriceable('LB-001', 'TL').productName).toContain('Loadbalancer');
  });

  it('GPU filtresi yalnizca vgpu>0 olanlari donduruyor', () => {
    const gpus = catalog.searchFlavors({ gpu: true });
    expect(gpus.length).toBeGreaterThan(0);
    expect(gpus.every((f) => f.vgpus > 0)).toBe(true);
  });

  it('minRamGb filtresi MB->GB cevirimini dogru yapiyor', () => {
    const big = catalog.searchFlavors({ minRamGb: 64 });
    expect(big.every((f) => f.ram >= 64 * 1024)).toBe(true);
    expect(big.some((f) => f.name === 'g1.4xlarge')).toBe(true);
  });
});
