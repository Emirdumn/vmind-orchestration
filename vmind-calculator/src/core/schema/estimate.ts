/**
 * FAZ 1.A — EstimateModel semasi
 *
 * Kaynak: calculator.portvmind.com uretim bundle'indan cikarilan `CalculateService`
 * dallanmalari (bkz. docs/pricing-port-notes.md) + PLAN.md EK-A.4.
 *
 * TASARIM KURALI: bu sema platformun *optional* yapisini birebir yansitir.
 * Bilerek gevsek: `object-storage.storage` yoksa platform hata vermez, biz de vermeyiz.
 * Eksikleri yakalamak semanin degil KURAL MOTORUNUN isi (Faz 4).
 * Semayi sikilastirmak, platformdan okunan gecerli teklifleri reddetmemize yol acar.
 *
 * Sema yalnizca platformun *catlayacagi* veya *sessizce yanlis fiyatlayacagi*
 * girdileri reddeder:
 *   - unit yalnizca GB | TB  -> "MB" yazilirsa motor sessizce x1024 sisirir
 *   - currency yalnizca TL | USD -> EUR'da 6 urunun fiyati yok, hesaplayici cokuyor
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Temel tipler
// ---------------------------------------------------------------------------

/**
 * Motor `unit === "GB" ? 1 : 1024` yapiyor; yani "GB" disindaki HER deger
 * 1024 ile carpilir. "MB" yazmak miktari 1024 kat sisirir. Bu yuzden kapali liste.
 */
export const UnitSchema = z.enum(['GB', 'TB']);
export type Unit = z.infer<typeof UnitSchema>;

/**
 * Katalogdaki para birimi kodu "TL" (TRY degil). Arayuz yalnizca TL ve USD sunuyor:
 *   options:[{text:"₺",id:"TL"},{text:"$",id:"USD"}]
 * Katalogda EUR fiyatlari da var ama 6 urunde eksik -> `priceObj.price` TypeError.
 */
export const CurrencySchema = z.enum(['TL', 'USD']);
export type Currency = z.infer<typeof CurrencySchema>;

/** Bos olmayan urun kodu. Katalogda var mi kontrolu catalog katmaninda yapilir. */
const productCode = z.string().min(1, 'productCode bos olamaz');

const positive = z.number().positive('0 veya negatif olamaz');
const positiveInt = z.number().int().positive('0 veya negatif olamaz');

// ---------------------------------------------------------------------------
// Paylasilan alt yapilar
// ---------------------------------------------------------------------------

/** Network Data Transfer (egress). Motor bunun yalnizca AYLIK tutarini toplar. */
export const NetworkSpecSchema = z.object({
  productCode,
  traffic: positive,
  unit: UnitSchema,
});
export type NetworkSpec = z.infer<typeof NetworkSpecSchema>;

/** Block storage. `volumeTypeName` sadece satir etiketinde kullanilir, fiyata girmez. */
export const StorageSpecSchema = z.object({
  productCode,
  size: positive,
  unit: UnitSchema,
  volumeTypeName: z.string().optional(),
});
export type StorageSpec = z.infer<typeof StorageSpecSchema>;

export const FloatingIpSpecSchema = z.object({
  productCode,
  count: positiveInt,
});
export type FloatingIpSpec = z.infer<typeof FloatingIpSpecSchema>;

/**
 * Compute icindeki backup.
 *
 * DIKKAT — canli arayuzde dogrulandi: arayuz burada GB/TB secici sunuyor ve secimi
 * `unit` alanina yaziyor, ANCAK fiyat motoru compute dalinda birimi sabit "GB"
 * gecirir ve bu alani HIC OKUMAZ:
 *
 *     Calculate(code, count * sourceSize * estimatedCount, "GB")
 *
 * Yani "TB" secilirse teklif 1024 kat DUSUK cikar; hata da uyari da yoktur.
 * Alan semada tutuluyor (platform uretiyor, kaybetmemeliyiz) ama fiyata etkisi yok.
 * COMPUTE_BACKUP_TB_IGNORED kurali (Faz 4) bunu blocker olarak yakalamali.
 */
export const InlineBackupSpecSchema = z.object({
  productCode,
  sourceSize: positive,
  /** Arayuz yaziyor, motor OKUMUYOR. Bkz. yukaridaki uyari. */
  unit: UnitSchema.optional(),
  /**
   * 0 verilirse motor kalemi TAMAMEN ATLAR - hata yok, uyari yok, 0 TL.
   * Sema 0'a izin verir (platform veriyor) -> BACKUP_ZERO_COUNT kurali yakalar.
   */
  estimatedCount: z.number().int().min(0),
});
export type InlineBackupSpec = z.infer<typeof InlineBackupSpecSchema>;

export const RouterSpecSchema = z.object({
  floatingIp: FloatingIpSpecSchema.optional(),
  network: NetworkSpecSchema.optional(),
});
export type RouterSpec = z.infer<typeof RouterSpecSchema>;

/** Kubernetes master/worker havuzu. */
export const NodePoolSchema = z.object({
  productCode,
  count: positiveInt,
  storage: StorageSpecSchema.optional(),
});
export type NodePool = z.infer<typeof NodePoolSchema>;

// ---------------------------------------------------------------------------
// 9 servisin `data` semasi
// ---------------------------------------------------------------------------

export const ComputeDataSchema = z.object({
  productCode,
  count: positiveInt,
  /** Arayuzun "Description" alani. Fiyata girmez ama platform uretir, korunmali. */
  description: z.string().optional(),
  /** Yoksa egress HIC fiyatlanmaz - sessiz sifir. */
  network: NetworkSpecSchema.optional(),
  /** Miktar `size * count` olarak hesaplanir (her instance'a ayri disk). */
  storage: StorageSpecSchema.optional(),
  backup: InlineBackupSpecSchema.optional(),
  floatingIp: FloatingIpSpecSchema.optional(),
  router: RouterSpecSchema.optional(),
});
export type ComputeData = z.infer<typeof ComputeDataSchema>;

/** Standalone block storage: compute'un aksine count ile CARPILMAZ. */
export const StorageDataSchema = StorageSpecSchema;
export type StorageData = z.infer<typeof StorageDataSchema>;

export const DataTransferDataSchema = NetworkSpecSchema;
export type DataTransferData = z.infer<typeof DataTransferDataSchema>;

export const FloatingIpDataSchema = FloatingIpSpecSchema;
export type FloatingIpData = z.infer<typeof FloatingIpDataSchema>;

export const LoadBalancerDataSchema = z.object({
  /** LB-001 = App Loadbalancer, LB-002 = Net Loadbalancer. Miktar her zaman 1. */
  productCode,
  network: NetworkSpecSchema.optional(),
});
export type LoadBalancerData = z.infer<typeof LoadBalancerDataSchema>;

/**
 * Ikisi de opsiyonel: bos bir object-storage kalemi 0 TL olarak gecer.
 * En sik gorulen sessiz sifir kaynagi (bkz. OBJ_STORAGE_NO_TRANSFER kurali).
 */
export const ObjectStorageDataSchema = z.object({
  storage: StorageSpecSchema.optional(),
  network: NetworkSpecSchema.optional(),
});
export type ObjectStorageData = z.infer<typeof ObjectStorageDataSchema>;

export const RouterDataSchema = RouterSpecSchema;
export type RouterData = z.infer<typeof RouterDataSchema>;

/** Standalone backup: compute icindekinin aksine `unit` alani VAR (TB -> x1024). */
export const BackupDataSchema = z.object({
  productCode,
  sourceSize: positive,
  unit: UnitSchema,
  estimatedCount: z.number().int().min(0),
});
export type BackupData = z.infer<typeof BackupDataSchema>;

export const KubernetesDataSchema = z.object({
  master: NodePoolSchema,
  worker: NodePoolSchema,
});
export type KubernetesData = z.infer<typeof KubernetesDataSchema>;

// ---------------------------------------------------------------------------
// Servis kodlari ve kalem birlesimi
// ---------------------------------------------------------------------------

export const SERVICE_CODES = [
  'compute',
  'storage',
  'data-transfer',
  'floating-ip',
  'load-balancer',
  'kubernetes',
  'object-storage',
  'router',
  'backup',
] as const;

export const ServiceCodeSchema = z.enum(SERVICE_CODES);
export type ServiceCode = z.infer<typeof ServiceCodeSchema>;

const itemId = z.string().min(1);

export const EstimateItemSchema = z.discriminatedUnion('service', [
  z.object({ id: itemId, service: z.literal('compute'), data: ComputeDataSchema }),
  z.object({ id: itemId, service: z.literal('storage'), data: StorageDataSchema }),
  z.object({ id: itemId, service: z.literal('data-transfer'), data: DataTransferDataSchema }),
  z.object({ id: itemId, service: z.literal('floating-ip'), data: FloatingIpDataSchema }),
  z.object({ id: itemId, service: z.literal('load-balancer'), data: LoadBalancerDataSchema }),
  z.object({ id: itemId, service: z.literal('kubernetes'), data: KubernetesDataSchema }),
  z.object({ id: itemId, service: z.literal('object-storage'), data: ObjectStorageDataSchema }),
  z.object({ id: itemId, service: z.literal('router'), data: RouterDataSchema }),
  z.object({ id: itemId, service: z.literal('backup'), data: BackupDataSchema }),
]);
export type EstimateItem = z.infer<typeof EstimateItemSchema>;

export const EstimateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  currency: CurrencySchema,
  list: z.array(EstimateItemSchema),
});
export type Estimate = z.infer<typeof EstimateSchema>;

/** Servis kodu -> `data` semasi. `estimate.addItem` tool'u bunu kullanir. */
export const DATA_SCHEMA_BY_SERVICE = {
  compute: ComputeDataSchema,
  storage: StorageDataSchema,
  'data-transfer': DataTransferDataSchema,
  'floating-ip': FloatingIpDataSchema,
  'load-balancer': LoadBalancerDataSchema,
  kubernetes: KubernetesDataSchema,
  'object-storage': ObjectStorageDataSchema,
  router: RouterDataSchema,
  backup: BackupDataSchema,
} as const satisfies Record<ServiceCode, z.ZodTypeAny>;

/** Platformdaki basliklar (bundle'daki `services` dizisinden). */
export const SERVICE_TITLES = {
  compute: 'Compute',
  storage: 'Block Storage',
  'data-transfer': 'Network Data Transfer',
  'floating-ip': 'Floating IP',
  'load-balancer': 'Load Balancer',
  kubernetes: 'Kubernetes',
  'object-storage': 'Object Storage',
  router: 'Router',
  backup: 'Backup',
} as const satisfies Record<ServiceCode, string>;
