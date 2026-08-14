/**
 * FAZ 1.A kabul kriteri:
 * "EK-A.4'teki her ic ice alan semada mevcut ve optional olma durumu platformdaki ile AYNI."
 *
 * Sema bilerek gevsek olan yerleri de test eder: platformun kabul ettigi bir teklifi
 * bizim reddetmemiz, platformdan geri okunan teklifi dogrulayamamak demektir.
 */
import { describe, expect, it } from 'vitest';
import {
  BackupDataSchema,
  ComputeDataSchema,
  CurrencySchema,
  DATA_SCHEMA_BY_SERVICE,
  EstimateSchema,
  KubernetesDataSchema,
  LoadBalancerDataSchema,
  ObjectStorageDataSchema,
  RouterDataSchema,
  SERVICE_CODES,
  StorageDataSchema,
  UnitSchema,
} from '../src/core/schema/estimate.js';
import { MULTI_ITEM_ESTIMATES, SCENARIOS } from './scenarios.js';

describe('Faz 1.A — birim ve para birimi kisitlari', () => {
  it('unit yalnizca GB | TB', () => {
    expect(UnitSchema.safeParse('GB').success).toBe(true);
    expect(UnitSchema.safeParse('TB').success).toBe(true);
    // "MB" motorda sessizce x1024 yapar -> miktar 1024 kat siser.
    expect(UnitSchema.safeParse('MB').success).toBe(false);
    expect(UnitSchema.safeParse('gb').success).toBe(false);
  });

  it('currency yalnizca TL | USD', () => {
    expect(CurrencySchema.safeParse('TL').success).toBe(true);
    expect(CurrencySchema.safeParse('USD').success).toBe(true);
    // Katalog kodu "TL"; "TRY" hicbir fiyatla eslesmez -> her kalem 0 olurdu.
    expect(CurrencySchema.safeParse('TRY').success).toBe(false);
    // EUR'da 6 urunun fiyati yok -> hesaplayici coker.
    expect(CurrencySchema.safeParse('EUR').success).toBe(false);
  });
});

describe('Faz 1.A — EK-A.4 ic ice alanlarinin varligi ve optional durumu', () => {
  const minimalCompute = { productCode: 'X', count: 1 };

  it('compute: yalnizca productCode + count zorunlu', () => {
    expect(ComputeDataSchema.safeParse(minimalCompute).success).toBe(true);
    expect(ComputeDataSchema.safeParse({ productCode: 'X' }).success).toBe(false);
    expect(ComputeDataSchema.safeParse({ count: 1 }).success).toBe(false);
  });

  it.each(['network', 'storage', 'backup', 'floatingIp', 'router'] as const)(
    'compute.%s opsiyonel (platformdaki gibi)',
    (field) => {
      const parsed = ComputeDataSchema.parse(minimalCompute) as Record<string, unknown>;
      expect(parsed[field]).toBeUndefined();
    },
  );

  it('compute.storage tam alan kumesi (volumeTypeName opsiyonel)', () => {
    expect(
      ComputeDataSchema.safeParse({
        ...minimalCompute,
        storage: { productCode: 'V', size: 100, unit: 'GB' },
      }).success,
    ).toBe(true);
    expect(
      ComputeDataSchema.safeParse({
        ...minimalCompute,
        storage: { productCode: 'V', size: 100, unit: 'GB', volumeTypeName: 'Premium' },
      }).success,
    ).toBe(true);
  });

  it('compute.backup unit alani KORUNUYOR ama fiyata etki etmiyor', () => {
    // Canli arayuzde dogrulandi: UI bu alani yaziyor, motor okumuyor.
    // Alani semadan atmak, platformdan okunan teklifte veri kaybi demek olurdu.
    const parsed = ComputeDataSchema.parse({
      ...minimalCompute,
      backup: { productCode: 'B', sourceSize: 50, estimatedCount: 3, unit: 'TB' },
    });
    expect(parsed.backup?.unit).toBe('TB');
    // Fiyata etkisizligi tests/golden.spec.ts icinde kilitlendi.
  });

  it('compute.description korunuyor (arayuz uretiyor)', () => {
    const parsed = ComputeDataSchema.parse({ ...minimalCompute, description: 'web sunuculari' });
    expect(parsed.description).toBe('web sunuculari');
  });

  it('standalone backup unit alani ICERIR (TB -> x1024)', () => {
    expect(
      BackupDataSchema.safeParse({ productCode: 'B', sourceSize: 2, unit: 'TB', estimatedCount: 5 }).success,
    ).toBe(true);
    expect(BackupDataSchema.safeParse({ productCode: 'B', sourceSize: 2, estimatedCount: 5 }).success).toBe(false);
  });

  it('compute.router ic ice floatingIp/network tasiyor, ikisi de opsiyonel', () => {
    expect(RouterDataSchema.safeParse({}).success).toBe(true);
    expect(
      ComputeDataSchema.safeParse({
        ...minimalCompute,
        router: { floatingIp: { productCode: 'F', count: 1 }, network: { productCode: 'N', traffic: 5, unit: 'GB' } },
      }).success,
    ).toBe(true);
  });

  it('object-storage: storage ve network IKISI DE opsiyonel — bos kalem gecerli', () => {
    // Bu sessiz sifirin ana kaynagi. Sema izin verir, kural motoru (Faz 4) yakalar.
    expect(ObjectStorageDataSchema.safeParse({}).success).toBe(true);
  });

  it('load-balancer.network opsiyonel, productCode zorunlu', () => {
    expect(LoadBalancerDataSchema.safeParse({ productCode: 'LB-001' }).success).toBe(true);
    expect(LoadBalancerDataSchema.safeParse({}).success).toBe(false);
  });

  it('kubernetes: master ve worker zorunlu, storage opsiyonel', () => {
    expect(
      KubernetesDataSchema.safeParse({
        master: { productCode: 'M', count: 1 },
        worker: { productCode: 'W', count: 3 },
      }).success,
    ).toBe(true);
    expect(KubernetesDataSchema.safeParse({ master: { productCode: 'M', count: 1 } }).success).toBe(false);
    expect(
      KubernetesDataSchema.safeParse({
        master: { productCode: 'M', count: 1, storage: { productCode: 'V', size: 50, unit: 'GB' } },
        worker: { productCode: 'W', count: 3, storage: { productCode: 'V', size: 500, unit: 'GB' } },
      }).success,
    ).toBe(true);
  });

  it('storage (standalone) StorageSpec ile ayni sekle sahip', () => {
    expect(StorageDataSchema.safeParse({ productCode: 'V', size: 10, unit: 'TB' }).success).toBe(true);
  });
});

describe('Faz 1.A — sessiz sifir uretebilen girdiler BILEREK kabul ediliyor', () => {
  it('backup.estimatedCount = 0 semadan geciyor (kural motoru yakalayacak)', () => {
    // Platform bunu kabul edip kalemi tamamen atliyor. Semanin reddetmesi,
    // platformdan okunan gecerli bir teklifi dogrulayamamamiza yol acardi.
    expect(BackupDataSchema.safeParse({ productCode: 'B', sourceSize: 100, unit: 'GB', estimatedCount: 0 }).success).toBe(
      true,
    );
  });

  it('negatif adet reddediliyor (platform bunu asla uretmez)', () => {
    expect(BackupDataSchema.safeParse({ productCode: 'B', sourceSize: 100, unit: 'GB', estimatedCount: -1 }).success).toBe(
      false,
    );
    expect(ComputeDataSchema.safeParse({ productCode: 'X', count: 0 }).success).toBe(false);
  });

  it('bos productCode reddediliyor', () => {
    expect(ComputeDataSchema.safeParse({ productCode: '', count: 1 }).success).toBe(false);
  });
});

describe('Faz 1.A — sema motorun isledigi HER senaryoyu kabul etmeli', () => {
  // Sema ile motor arasinda bosluk kalirsa, ajanin uretebildigi ama
  // dogrulayamadigimiz (ya da tersi) teklifler olusur.
  for (const scenario of SCENARIOS) {
    it(scenario.name, () => {
      const schema = DATA_SCHEMA_BY_SERVICE[scenario.service];
      const result = schema.safeParse(scenario.data);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    });
  }
});

describe('Faz 1.A — tam teklif zarfi', () => {
  it('9 servis kodu tanimli', () => {
    expect(SERVICE_CODES).toHaveLength(9);
    expect(Object.keys(DATA_SCHEMA_BY_SERVICE).sort()).toEqual([...SERVICE_CODES].sort());
  });

  it('cok kalemli teklifler discriminated union\'dan geciyor', () => {
    for (const estimate of MULTI_ITEM_ESTIMATES) {
      const result = EstimateSchema.safeParse({
        id: '3f1a4c9e-2b6d-4f8a-9c1e-7d5b8a2f6e01',
        name: estimate.name,
        currency: 'TL',
        list: estimate.list,
      });
      expect(result.success, `${estimate.name}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it('yanlis servis/data eslesmesi reddediliyor', () => {
    const result = EstimateSchema.safeParse({
      id: '3f1a4c9e-2b6d-4f8a-9c1e-7d5b8a2f6e01',
      name: 'X',
      currency: 'TL',
      // compute kalemine backup verisi verilmis
      list: [{ id: '1', service: 'compute', data: { productCode: 'B', sourceSize: 10, unit: 'GB', estimatedCount: 1 } }],
    });
    expect(result.success).toBe(false);
  });
});
