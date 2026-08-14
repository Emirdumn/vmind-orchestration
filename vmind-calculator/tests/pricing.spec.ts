/**
 * FAZ 2.B — Diff harness
 *
 * Portu (src/core/pricing/engine.ts) platformun KENDI kodu ile karsilastirir.
 * Referans, uretim bundle'indan verbatim cikarilmistir; yani bu test
 * "benim yeniden yazdigim mantik kendi kendine tutarli mi" degil,
 * "platformla bit-bit ayni mi" sorusunu yanitlar.
 *
 * Karsilastirma toleranssiz: kayan nokta sonuclari birebir esit olmali.
 * PLAN'daki "< 0.01" kriteri tavan; burada 0 hedefleniyor.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Verbatim referans (minified, tipsiz) — tipleri allowJs ile cikarsaniyor.
import { CalculateService, ServiceTotals } from './reference/vmind-reference.mjs';

import { calculateService, serviceTotals, type PricingContext } from '../src/core/pricing/engine.js';
import type { Currency, ServiceCode } from '../src/core/schema/estimate.js';
import type { ApiEnvelope, Product } from '../src/core/catalog/types.js';
import { MULTI_ITEM_ESTIMATES, SCENARIOS } from './scenarios.js';

const here = dirname(fileURLToPath(import.meta.url));
const catalog: ApiEnvelope<Product> = JSON.parse(
  readFileSync(join(here, '..', 'fixtures', 'catalog', 'products.json'), 'utf8'),
);
const PRODUCTS = catalog.items;

/** Platform i18n'i; testte kimlik fonksiyonu (iki tarafta da ayni). */
const t = (key: string): string => key;

/** Referansin bekledigi `estimate` sekli: lookup.products.result.items */
function referenceEstimate(currency: Currency, list: unknown[] = []) {
  return {
    id: 'test',
    name: 'Test',
    currency,
    list,
    lookup: { products: { result: { items: PRODUCTS } } },
  };
}

function portContext(currency: Currency): PricingContext {
  return { currency, products: PRODUCTS, t };
}

const CURRENCIES: Currency[] = ['TL', 'USD'];

describe('Faz 2.B — port, platformun verbatim kodu ile ayni sonucu vermeli', () => {
  for (const currency of CURRENCIES) {
    describe(`para birimi: ${currency}`, () => {
      for (const scenario of SCENARIOS) {
        it(scenario.name, () => {
          const expected = CalculateService(
            t,
            referenceEstimate(currency),
            scenario.service,
            scenario.data,
          );
          const actual = calculateService(portContext(currency), scenario.service, scenario.data);

          // Tutarlar: toleranssiz esitlik.
          expect(actual.totalHourCost).toBe(expected.totalHourCost);
          expect(actual.totalMonthCost).toBe(expected.totalMonthCost);

          // Satir kirilimi ve ozet metinleri de esitlenmeli:
          // sapma buradan basliyorsa tutar henuz tutuyor olsa bile mantik ayrilmistir.
          expect(actual.lines).toEqual(expected.lines);
          expect(actual.summary).toEqual(expected.summary);
        });
      }
    });
  }
});

describe('Faz 2.B — cok kalemli teklifler (ServiceTotals yolu)', () => {
  for (const currency of CURRENCIES) {
    for (const estimate of MULTI_ITEM_ESTIMATES) {
      it(`${estimate.name} [${currency}]`, () => {
        const expected = ServiceTotals(t, referenceEstimate(currency, estimate.list));
        const actual = serviceTotals(
          { products: PRODUCTS, t },
          { currency, list: estimate.list as { service: ServiceCode; data: unknown }[] },
        );

        expect(actual.totalHourCost).toBe(expected.totalHourCost);
        expect(actual.totalMonthCost).toBe(expected.totalMonthCost);
        expect(actual.lines).toEqual(expected.lines);
      });
    }
  }
});

/**
 * Kombinatoryal tarama: compute'un 5 opsiyonel alt dalinin 32 kombinasyonu.
 * Elle yazilan senaryolarin kacirdigi bir dallanma varsa burada yakalanir.
 */
describe('Faz 2.B — compute alt dallarinin tum kombinasyonlari', () => {
  const OPTIONALS = {
    network: { productCode: 'NETW-OUT-001', traffic: 750, unit: 'GB' },
    storage: { productCode: '096439fe-26d6-4bd0-bdf0-11e40f73753e', size: 120, unit: 'GB' },
    backup: { productCode: 'BC-001', sourceSize: 120, estimatedCount: 5 },
    floatingIp: { productCode: 'FIP-001', count: 2 },
    router: {
      floatingIp: { productCode: 'FIP-001', count: 1 },
      network: { productCode: 'NETW-OUT-001', traffic: 300, unit: 'GB' },
    },
  } as const;
  const keys = Object.keys(OPTIONALS) as (keyof typeof OPTIONALS)[];

  for (let mask = 0; mask < 1 << keys.length; mask++) {
    const data: Record<string, unknown> = {
      productCode: 'fd9ee6ed-a56d-483e-98c9-1a05d634ffcb',
      count: 3,
    };
    const active: string[] = [];
    keys.forEach((key, i) => {
      if (mask & (1 << i)) {
        data[key] = OPTIONALS[key];
        active.push(key);
      }
    });

    it(`compute + [${active.join(', ') || 'sade'}]`, () => {
      const expected = CalculateService(t, referenceEstimate('TL'), 'compute', data);
      const actual = calculateService(portContext('TL'), 'compute', data);
      expect(actual.totalHourCost).toBe(expected.totalHourCost);
      expect(actual.totalMonthCost).toBe(expected.totalMonthCost);
      expect(actual.lines).toEqual(expected.lines);
      expect(actual.summary).toEqual(expected.summary);
    });
  }
});

describe('Faz 2.B — katalogdaki HER urun tek tek', () => {
  // Her urunun kendi fiyatlandirma birimiyle (HOUR / GB / UNIT) dogru davrandigini
  // dogrular; "x720 uygulanmamasi gereken" urunleri kacirmamak icin.
  for (const product of PRODUCTS) {
    const currency: Currency = product.prices.some((p) => p.currency === 'TL') ? 'TL' : 'USD';
    it(`${product.productCode} (${product.prices.find((p) => p.currency === currency)?.pricingUnit})`, () => {
      const data = { productCode: product.productCode, size: 7, unit: 'GB' as const };
      const expected = CalculateService(t, referenceEstimate(currency), 'storage', data);
      const actual = calculateService(portContext(currency), 'storage', data);
      expect(actual.totalHourCost).toBe(expected.totalHourCost);
      expect(actual.totalMonthCost).toBe(expected.totalMonthCost);
    });
  }
});
