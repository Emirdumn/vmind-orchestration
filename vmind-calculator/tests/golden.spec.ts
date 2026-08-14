/**
 * FAZ 1.C — Golden fixture'lar (canli arayuzden)
 *
 * Differential harness (tests/pricing.spec.ts) portu platformun KODUNA karsi
 * dogruluyor. Bu dosya farkli bir soruyu yanitliyor:
 *
 *   "Ekranda satisciya GOSTERILEN rakam, o kodun urettigi rakam mi?
 *    Araya bir yuvarlama/bicimleme katmani girip tutari degistiriyor mu?"
 *
 * Fixture'lar calculator.portvmind.com uzerinde gercekten olusturuldu:
 *   01  -> /configure/compute ekraninda form doldurularak
 *   02..05 -> teklif localStorage.VCLOUD_ESTIMATE'e yazilip sayfa yeniden
 *             yuklenerek, /my-estimate ozet tablosundan okunarak
 *
 * Ikinci yontem form katmanini atlar — bilerek: burada test edilen sey form
 * degil, "store -> ServiceTotals -> ekran" yolu.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { calculateService, serviceTotals, type PricingContext } from '../src/core/pricing/engine.js';
import { SERVICE_CODES, type Currency, type ServiceCode } from '../src/core/schema/estimate.js';
import { DATA_SCHEMA_BY_SERVICE } from '../src/core/schema/estimate.js';
import type { ApiEnvelope, Product } from '../src/core/catalog/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const goldenDir = join(here, '..', 'fixtures', 'golden');
const PRODUCTS = (
  JSON.parse(readFileSync(join(here, '..', 'fixtures', 'catalog', 'products.json'), 'utf8')) as ApiEnvelope<Product>
).items;

const ctx = (currency: Currency): PricingContext => ({ currency, products: PRODUCTS, t: (k) => k });

const parseDisplayed = (s: string): number => Number(s.replace(/[^\d.]/g, ''));
const roundTo = (n: number, decimals: number): number =>
  Math.round(n * 10 ** decimals) / 10 ** decimals;

// ---------------------------------------------------------------------------
// Fixture 01 — konfigurasyon ekrani (tek servis, farkli ondalik hassasiyeti)
// ---------------------------------------------------------------------------

interface SingleServiceFixture {
  currency: Currency;
  service: ServiceCode;
  data: Record<string, unknown>;
  displayed: { hourly: string; monthly: string };
}

const fixture01 = JSON.parse(
  readFileSync(join(goldenDir, 'live-01-compute-storage-backup.json'), 'utf8'),
) as SingleServiceFixture;

describe('Faz 1.C — fixture 01 (konfigurasyon ekrani)', () => {
  const result = calculateService(ctx(fixture01.currency), fixture01.service, fixture01.data);

  // Bu ekran saatligi 6, aylik tutari 4 ondalikla gosteriyor —
  // ozet ekranindan (4 / 2) FARKLI. Bicimleme goruntuye ozel.
  it('saatlik tutar ekrandakiyle esisiyor (6 ondalik)', () => {
    expect(roundTo(result.totalHourCost, 6)).toBe(parseDisplayed(fixture01.displayed.hourly));
  });

  it('aylik tutar ekrandakiyle esisiyor (4 ondalik)', () => {
    expect(roundTo(result.totalMonthCost, 4)).toBe(parseDisplayed(fixture01.displayed.monthly));
  });

  it('aylik = saatlik x 720 kurali ekranda da geceriyor', () => {
    expect(result.totalMonthCost).toBeCloseTo(result.totalHourCost * 720, 9);
  });

  it('bicimleme YALNIZCA gosterim — ham deger daha fazla basamak tasiyor', () => {
    expect(result.totalMonthCost).not.toBe(parseDisplayed(fixture01.displayed.monthly));
    expect(Math.abs(result.totalMonthCost - parseDisplayed(fixture01.displayed.monthly))).toBeLessThan(0.0001);
  });

  it('canli data ComputeDataSchema ile uyumlu', () => {
    const parsed = DATA_SCHEMA_BY_SERVICE[fixture01.service].safeParse(fixture01.data);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fixture 02–05 — ozet ekrani (cok kalemli, satir kirilimli)
// ---------------------------------------------------------------------------

interface EstimateFixture {
  name: string;
  currency: Currency;
  _covers: ServiceCode[];
  list: Array<{ id: string; service: ServiceCode; data: Record<string, unknown> }>;
  displayed: { hourly: string; monthly: string; hourlyDecimals: number; monthlyDecimals: number };
  displayedLines: Array<{ label: string; hourly: string; monthly: string }>;
}

const ESTIMATE_FIXTURES: EstimateFixture[] = [
  'live-02-lb-compute-fip.json',
  'live-03-object-storage-transfer.json',
  'live-04-kubernetes.json',
  'live-05-router-storage-backup.json',
].map((file) => JSON.parse(readFileSync(join(goldenDir, file), 'utf8')) as EstimateFixture);

describe('Faz 1.C — fixture 02-05 (ozet ekrani)', () => {
  for (const fixture of ESTIMATE_FIXTURES) {
    describe(`${fixture.name} [${fixture.currency}]`, () => {
      const totals = serviceTotals({ products: PRODUCTS }, { currency: fixture.currency, list: fixture.list });

      it('toplam aylik tutar ekrandakiyle esisiyor', () => {
        expect(roundTo(totals.totalMonthCost, fixture.displayed.monthlyDecimals)).toBe(
          parseDisplayed(fixture.displayed.monthly),
        );
      });

      it('toplam saatlik tutar ekrandakiyle esisiyor', () => {
        expect(roundTo(totals.totalHourCost, fixture.displayed.hourlyDecimals)).toBe(
          parseDisplayed(fixture.displayed.hourly),
        );
      });

      it('satir sayisi ekrandakiyle ayni', () => {
        expect(totals.lines).toHaveLength(fixture.displayedLines.length);
      });

      it('her satirin aylik tutari ekrandakiyle esisiyor', () => {
        totals.lines.forEach((line, index) => {
          const displayed = fixture.displayedLines[index]!;
          expect(
            roundTo(line.monthly, fixture.displayed.monthlyDecimals),
            `${index}. satir (${displayed.label})`,
          ).toBe(parseDisplayed(displayed.monthly));
        });
      });

      it('data transfer satirlari ekranda "-" olarak gosteriliyor (saatlige girmiyor)', () => {
        totals.lines.forEach((line, index) => {
          const displayed = fixture.displayedLines[index]!;
          if (displayed.hourly === '-') {
            expect(line.hourly, `${index}. satir (${displayed.label})`).toBe('-');
          } else {
            expect(typeof line.hourly).toBe('number');
          }
        });
      });

      it('saatlik toplam = yalnizca saatlik satirlarin toplami', () => {
        // Tuhaflik #5'in ekranda dogrulanmasi: "-" satirlari toplama katilmaz.
        const sumOfHourlyLines = totals.lines
          .map((line) => (typeof line.hourly === 'number' ? line.hourly : 0))
          .reduce((a, b) => a + b, 0);
        expect(totals.totalHourCost).toBeCloseTo(sumOfHourlyLines, 9);
      });

      it('tum kalemler semadan geciyor', () => {
        for (const item of fixture.list) {
          const parsed = DATA_SCHEMA_BY_SERVICE[item.service].safeParse(item.data);
          expect(parsed.success, `${item.service}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// PLAN 1.C GATE kriterleri
// ---------------------------------------------------------------------------

describe('Faz 1.C GATE', () => {
  it('5 fixture kayitli', () => {
    expect(1 + ESTIMATE_FIXTURES.length).toBe(5);
  });

  it('fixture\'lar 9 servis kodunun en az 7\'sini kapsiyor', () => {
    const covered = new Set<ServiceCode>([fixture01.service]);
    // Fixture 01'in ic ice kalemleri de kapsama sayilir (compute.storage / compute.backup).
    covered.add('storage');
    covered.add('backup');
    for (const fixture of ESTIMATE_FIXTURES) {
      for (const service of fixture._covers) covered.add(service);
    }
    const missing = SERVICE_CODES.filter((code) => !covered.has(code));
    expect(covered.size, `kapsanmayan: ${missing.join(', ')}`).toBeGreaterThanOrEqual(7);
  });

  it('her fixture semadan HATASIZ geciyor', () => {
    const all = [
      { service: fixture01.service, data: fixture01.data },
      ...ESTIMATE_FIXTURES.flatMap((fixture) => fixture.list),
    ];
    for (const item of all) {
      expect(DATA_SCHEMA_BY_SERVICE[item.service].safeParse(item.data).success).toBe(true);
    }
  });

  it('her iki para birimi de kapsanmis', () => {
    const currencies = new Set<Currency>([
      fixture01.currency,
      ...ESTIMATE_FIXTURES.map((fixture) => fixture.currency),
    ]);
    expect([...currencies].sort()).toEqual(['TL', 'USD']);
  });
});

/**
 * PLATFORM HATASI — canli arayuzde tespit edildi.
 *
 * Compute icindeki Backup bolumunde arayuz GB/TB secici sunuyor ve secimi
 * `data.backup.unit` alanina yaziyor. Ancak fiyat motoru compute dalinda birimi
 * SABIT "GB" olarak gecirir ve `backup.unit` alanini HIC OKUMAZ:
 *
 *     Calculate(est, backup.productCode, count * backup.sourceSize * estimatedCount, "GB")
 *
 * Sonuc: satisci "1 TB" secse bile teklif 1 GB olarak fiyatlanir -> 1024 kat
 * dusuk tutar, hata veya uyari yok. Standalone `backup` servisinde ayni hata YOK;
 * orada `unit === "TB"` acikca kontrol edilir (fixture 05 bunu ekranda dogruluyor).
 *
 * Bu test, portun platformla ayni (hatali) davranisi urettigini KILITLER — port
 * dogru olmali, "duzeltilmis" degil. Duzeltme kural motorunun isi (Faz 4):
 * COMPUTE_BACKUP_TB_IGNORED blocker'i.
 */
describe('Faz 1.C — compute.backup TB birimi sessizce yok sayiliyor (platform hatasi)', () => {
  const base = {
    productCode: '73dee111-ff30-4837-b3c1-9284c422485e',
    count: 1,
    backup: { productCode: 'BC-001', sourceSize: 1, estimatedCount: 1 },
  };

  it('TB ve GB ayni tutari veriyor — 1024 kat fark KAYBOLUYOR', () => {
    const asGb = calculateService(ctx('USD'), 'compute', { ...base, backup: { ...base.backup, unit: 'GB' } });
    const asTb = calculateService(ctx('USD'), 'compute', { ...base, backup: { ...base.backup, unit: 'TB' } });
    expect(asTb.totalMonthCost).toBe(asGb.totalMonthCost);
  });

  it('standalone backup servisinde ayni hata YOK — orada TB gercekten x1024', () => {
    const asGb = calculateService(ctx('USD'), 'backup', {
      productCode: 'BC-001',
      sourceSize: 1,
      unit: 'GB',
      estimatedCount: 1,
    });
    const asTb = calculateService(ctx('USD'), 'backup', {
      productCode: 'BC-001',
      sourceSize: 1,
      unit: 'TB',
      estimatedCount: 1,
    });
    expect(asTb.totalMonthCost).toBeCloseTo(asGb.totalMonthCost * 1024, 6);
  });
});
