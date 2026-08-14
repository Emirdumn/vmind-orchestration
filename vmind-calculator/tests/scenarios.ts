/**
 * Differential test senaryolari.
 *
 * Amac: motorun HER dalini ve platformdaki her tuhafligi en az bir kez tetiklemek.
 * Buradaki productCode'lar fixtures/catalog/products.json'dan gercek kodlardir.
 */
import type { ServiceCode } from '../src/core/schema/estimate.js';

// --- gercek katalog kodlari -------------------------------------------------
export const CODE = {
  /** g1.small — COMPUTE, HOUR */
  flavorSmall: '73dee111-ff30-4837-b3c1-9284c422485e',
  /** g1.medium — COMPUTE, HOUR */
  flavorMedium: 'fd9ee6ed-a56d-483e-98c9-1a05d634ffcb',
  /** gpu.t4s.xlarge — COMPUTE, HOUR */
  flavorGpu: 'a5bb79dc-3453-493d-8e85-3092c3316f24',
  /** PortvMind-Premium-SSD — VOLUME, HOUR */
  volumePremium: '096439fe-26d6-4bd0-bdf0-11e40f73753e',
  /** PortvMind-Standard-HDD — VOLUME, HOUR */
  volumeStandard: 'bd0bbcfb-c178-4d21-b661-1b67c43b8c60',
  /** Volume-GB — VOLUME, HOUR */
  volumeGeneric: 'VL-001',
  /** Snapshot-GB — VOLUME, HOUR */
  snapshot: 'VL-002',
  /** Outbound Trafik — NETWORK, pricingUnit "GB" (x720 YOK) */
  netOut: 'NETW-OUT-001',
  /** FloatingIp — NETWORK, HOUR */
  floatingIp: 'FIP-001',
  /** App Loadbalancer — HOUR */
  lbApp: 'LB-001',
  /** Net Loadbalancer — HOUR */
  lbNet: 'LB-002',
  /** Object Storage Standart — HOUR */
  objectStorage: 'OBS-001',
  /** Backup Volume — HOUR */
  backup: 'BC-001',
  /** pvExpress Small — pricingUnit "UNIT" (x720 YOK) */
  vpsUnit: 'pvExpress-Small',
  /** Katalogda OLMAYAN kod — sessiz sifir davranisini test eder */
  bogus: 'UYDURMA-KOD-999',
} as const;

export interface Scenario {
  name: string;
  service: ServiceCode;
  data: unknown;
}

export const SCENARIOS: Scenario[] = [
  // --- compute: her alt dal ------------------------------------------------
  { name: 'compute / sade', service: 'compute', data: { productCode: CODE.flavorSmall, count: 1 } },
  { name: 'compute / cok adet', service: 'compute', data: { productCode: CODE.flavorMedium, count: 4 } },
  {
    name: 'compute / storage (size x count)',
    service: 'compute',
    data: {
      productCode: CODE.flavorMedium,
      count: 3,
      storage: { productCode: CODE.volumePremium, size: 100, unit: 'GB', volumeTypeName: 'PortvMind-Premium-SSD' },
    },
  },
  {
    name: 'compute / storage TB (x1024)',
    service: 'compute',
    data: {
      productCode: CODE.flavorSmall,
      count: 2,
      storage: { productCode: CODE.volumeStandard, size: 2, unit: 'TB' },
    },
  },
  {
    name: 'compute / storage tek instance (prefix yok)',
    service: 'compute',
    data: {
      productCode: CODE.flavorSmall,
      count: 1,
      storage: { productCode: CODE.volumeGeneric, size: 50, unit: 'GB' },
    },
  },
  {
    name: 'compute / network (yalnizca aylik)',
    service: 'compute',
    data: {
      productCode: CODE.flavorSmall,
      count: 2,
      network: { productCode: CODE.netOut, traffic: 500, unit: 'GB' },
    },
  },
  {
    name: 'compute / network TB',
    service: 'compute',
    data: {
      productCode: CODE.flavorSmall,
      count: 1,
      network: { productCode: CODE.netOut, traffic: 3, unit: 'TB' },
    },
  },
  {
    name: 'compute / backup adet 0 -> KALEM ATLANIR',
    service: 'compute',
    data: {
      productCode: CODE.flavorSmall,
      count: 2,
      backup: { productCode: CODE.backup, sourceSize: 200, estimatedCount: 0 },
    },
  },
  {
    name: 'compute / backup adet 7',
    service: 'compute',
    data: {
      productCode: CODE.flavorSmall,
      count: 2,
      backup: { productCode: CODE.backup, sourceSize: 200, estimatedCount: 7 },
    },
  },
  {
    name: 'compute / floating ip',
    service: 'compute',
    data: {
      productCode: CODE.flavorSmall,
      count: 1,
      floatingIp: { productCode: CODE.floatingIp, count: 2 },
    },
  },
  {
    name: 'compute / router (fip + network)',
    service: 'compute',
    data: {
      productCode: CODE.flavorSmall,
      count: 1,
      router: {
        floatingIp: { productCode: CODE.floatingIp, count: 1 },
        network: { productCode: CODE.netOut, traffic: 250, unit: 'GB' },
      },
    },
  },
  {
    name: 'compute / router yalnizca network',
    service: 'compute',
    data: {
      productCode: CODE.flavorSmall,
      count: 1,
      router: { network: { productCode: CODE.netOut, traffic: 10, unit: 'GB' } },
    },
  },
  {
    name: 'compute / TUM alt dallar birlikte',
    service: 'compute',
    data: {
      productCode: CODE.flavorGpu,
      count: 5,
      network: { productCode: CODE.netOut, traffic: 1, unit: 'TB' },
      storage: { productCode: CODE.volumePremium, size: 250, unit: 'GB', volumeTypeName: 'PortvMind-Premium-SSD' },
      backup: { productCode: CODE.backup, sourceSize: 250, estimatedCount: 4 },
      floatingIp: { productCode: CODE.floatingIp, count: 5 },
      router: {
        floatingIp: { productCode: CODE.floatingIp, count: 1 },
        network: { productCode: CODE.netOut, traffic: 100, unit: 'GB' },
      },
    },
  },
  {
    name: 'compute / UYDURMA productCode -> sessiz sifir',
    service: 'compute',
    data: { productCode: CODE.bogus, count: 3 },
  },
  {
    name: 'compute / uydurma storage kodu',
    service: 'compute',
    data: {
      productCode: CODE.flavorSmall,
      count: 1,
      storage: { productCode: CODE.bogus, size: 100, unit: 'GB' },
    },
  },

  // --- storage -------------------------------------------------------------
  {
    name: 'storage / GB',
    service: 'storage',
    data: { productCode: CODE.volumePremium, size: 500, unit: 'GB', volumeTypeName: 'PortvMind-Premium-SSD' },
  },
  { name: 'storage / TB', service: 'storage', data: { productCode: CODE.volumeStandard, size: 4, unit: 'TB' } },
  {
    name: 'storage / volumeTypeName yok -> "Default"',
    service: 'storage',
    data: { productCode: CODE.volumeGeneric, size: 80, unit: 'GB' },
  },
  { name: 'storage / snapshot urunu', service: 'storage', data: { productCode: CODE.snapshot, size: 120, unit: 'GB' } },

  // --- data-transfer -------------------------------------------------------
  { name: 'data-transfer / GB', service: 'data-transfer', data: { productCode: CODE.netOut, traffic: 1000, unit: 'GB' } },
  { name: 'data-transfer / TB', service: 'data-transfer', data: { productCode: CODE.netOut, traffic: 5, unit: 'TB' } },

  // --- floating-ip ---------------------------------------------------------
  { name: 'floating-ip / 1', service: 'floating-ip', data: { productCode: CODE.floatingIp, count: 1 } },
  { name: 'floating-ip / 12', service: 'floating-ip', data: { productCode: CODE.floatingIp, count: 12 } },

  // --- load-balancer -------------------------------------------------------
  { name: 'load-balancer / App', service: 'load-balancer', data: { productCode: CODE.lbApp } },
  { name: 'load-balancer / Net', service: 'load-balancer', data: { productCode: CODE.lbNet } },
  {
    name: 'load-balancer / App + network',
    service: 'load-balancer',
    data: { productCode: CODE.lbApp, network: { productCode: CODE.netOut, traffic: 2, unit: 'TB' } },
  },

  // --- object-storage ------------------------------------------------------
  {
    name: 'object-storage / storage + network',
    service: 'object-storage',
    data: {
      storage: { productCode: CODE.objectStorage, size: 2, unit: 'TB' },
      network: { productCode: CODE.netOut, traffic: 800, unit: 'GB' },
    },
  },
  {
    name: 'object-storage / network YOK -> egress fiyatlanmaz',
    service: 'object-storage',
    data: { storage: { productCode: CODE.objectStorage, size: 500, unit: 'GB' } },
  },
  { name: 'object-storage / TAMAMEN BOS -> 0 TL', service: 'object-storage', data: {} },

  // --- router --------------------------------------------------------------
  {
    name: 'router / fip + network',
    service: 'router',
    data: {
      floatingIp: { productCode: CODE.floatingIp, count: 3 },
      network: { productCode: CODE.netOut, traffic: 400, unit: 'GB' },
    },
  },
  { name: 'router / bos', service: 'router', data: {} },

  // --- backup (standalone) -------------------------------------------------
  {
    name: 'backup / GB',
    service: 'backup',
    data: { productCode: CODE.backup, sourceSize: 500, unit: 'GB', estimatedCount: 10 },
  },
  {
    name: 'backup / TB (burada x1024, Calculate icinde degil)',
    service: 'backup',
    data: { productCode: CODE.backup, sourceSize: 2, unit: 'TB', estimatedCount: 3 },
  },
  {
    name: 'backup / adet 0 -> KALEM ATLANIR',
    service: 'backup',
    data: { productCode: CODE.backup, sourceSize: 500, unit: 'GB', estimatedCount: 0 },
  },
  {
    name: 'backup / kesirli boyut (Math.round ozette)',
    service: 'backup',
    data: { productCode: CODE.backup, sourceSize: 33.7, unit: 'GB', estimatedCount: 3 },
  },

  // --- kubernetes ----------------------------------------------------------
  {
    name: 'kubernetes / master + worker',
    service: 'kubernetes',
    data: {
      master: { productCode: CODE.flavorMedium, count: 1 },
      worker: { productCode: CODE.flavorMedium, count: 3 },
    },
  },
  {
    name: 'kubernetes / storage (SONUC count ile carpilir)',
    service: 'kubernetes',
    data: {
      master: {
        productCode: CODE.flavorMedium,
        count: 3,
        storage: { productCode: CODE.volumePremium, size: 100, unit: 'GB', volumeTypeName: 'PortvMind-Premium-SSD' },
      },
      worker: {
        productCode: CODE.flavorGpu,
        count: 6,
        storage: { productCode: CODE.volumeStandard, size: 1, unit: 'TB' },
      },
    },
  },
  {
    name: 'kubernetes / yalnizca worker storage',
    service: 'kubernetes',
    data: {
      master: { productCode: CODE.flavorSmall, count: 1 },
      worker: { productCode: CODE.flavorSmall, count: 2, storage: { productCode: CODE.volumeGeneric, size: 40, unit: 'GB' } },
    },
  },

  // --- pricingUnit "HOUR" degil -> x720 uygulanmaz --------------------------
  {
    name: 'pricingUnit UNIT (pvExpress) — aylik carpani yok',
    service: 'compute',
    data: { productCode: CODE.vpsUnit, count: 2 },
  },
];

/** Cok kalemli, gercege yakin teklifler (ServiceTotals yolunu test eder). */
export const MULTI_ITEM_ESTIMATES: { name: string; list: { id: string; service: ServiceCode; data: unknown }[] }[] = [
  {
    name: 'LB + 3 compute + egress',
    list: [
      { id: '1', service: 'load-balancer', data: { productCode: CODE.lbApp } },
      {
        id: '2',
        service: 'compute',
        data: {
          productCode: CODE.flavorMedium,
          count: 3,
          storage: { productCode: CODE.volumePremium, size: 100, unit: 'GB' },
        },
      },
      { id: '3', service: 'data-transfer', data: { productCode: CODE.netOut, traffic: 2, unit: 'TB' } },
      { id: '4', service: 'floating-ip', data: { productCode: CODE.floatingIp, count: 1 } },
    ],
  },
  {
    name: 'kubernetes + object storage + backup',
    list: [
      {
        id: '1',
        service: 'kubernetes',
        data: {
          master: { productCode: CODE.flavorMedium, count: 3, storage: { productCode: CODE.volumePremium, size: 50, unit: 'GB' } },
          worker: { productCode: CODE.flavorGpu, count: 4, storage: { productCode: CODE.volumeStandard, size: 500, unit: 'GB' } },
        },
      },
      {
        id: '2',
        service: 'object-storage',
        data: {
          storage: { productCode: CODE.objectStorage, size: 10, unit: 'TB' },
          network: { productCode: CODE.netOut, traffic: 3, unit: 'TB' },
        },
      },
      { id: '3', service: 'backup', data: { productCode: CODE.backup, sourceSize: 1, unit: 'TB', estimatedCount: 14 } },
      { id: '4', service: 'router', data: { floatingIp: { productCode: CODE.floatingIp, count: 2 } } },
    ],
  },
  {
    name: 'bos teklif',
    list: [],
  },
  {
    name: 'sessiz sifir tuzagi: bos object-storage + backup adet 0',
    list: [
      { id: '1', service: 'object-storage', data: {} },
      { id: '2', service: 'backup', data: { productCode: CODE.backup, sourceSize: 500, unit: 'GB', estimatedCount: 0 } },
      { id: '3', service: 'compute', data: { productCode: CODE.bogus, count: 10 } },
    ],
  },
];
