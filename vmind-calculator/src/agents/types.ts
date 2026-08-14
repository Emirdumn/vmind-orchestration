/**
 * FAZ 5 — Ajan katmani sozlesmeleri
 *
 * Ajanlar arasindaki HER veri bu dosyadaki tiplerden gecer. Amac, bir ajanin
 * cikti hatasini digerinin girdi hatasindan ayirabilmek (PLAN §1.1).
 */
import { z } from 'zod';
import type { Currency, ServiceCode } from '../core/schema/estimate.js';
import type { Gap } from '../core/rules/types.js';
import type { PriceLine } from '../core/pricing/engine.js';

// ---------------------------------------------------------------------------
// 5.A — Requirement Extractor ciktisi
// ---------------------------------------------------------------------------

/** Satisci "premium disk" der; hangi urun oldugunu Designer secer. */
export const StorageTierSchema = z.enum(['premium', 'standard', 'unspecified']);

/** Ciplak "load balancer" belirsizdir: App (katman 7) ile Net (katman 4) arasi fiyat farki buyuk. */
export const LoadBalancerKindSchema = z.enum(['app', 'net', 'unspecified']);

/**
 * Uygulamanin erisim siniri. `vpn`, servisin internete acik oldugu anlamina
 * gelmez; yalnizca VPN/site-to-site gibi kontrollu bir giris noktasindan
 * erisilecegini anlatir.
 */
export const NetworkExposureSchema = z.enum(['internal', 'public', 'vpn', 'unspecified']);

/** Bir compute rolune bagli disk ihtiyaci. */
export const AttachedStorageRequirementSchema = z.object({
  tier: StorageTierSchema,
  sizeGbPerInstance: z.number().positive().optional(),
});

/** Rol bazli backup/PITR istegi; fiyatlamak icin miktarlar yine acik olmalidir. */
export const GroupBackupRequirementSchema = z.object({
  kind: z.enum(['snapshot', 'pitr', 'unspecified']),
  countPerMonth: z.number().int().nonnegative().optional(),
  sourceSizeGb: z.number().positive().optional(),
});

/**
 * Ayni teklifte farkli kaynak profilleri olan uygulama/veritabani rolleri.
 * `count` replica sayisi, CPU/RAM degerleri INSTANCE BASINADIR.
 */
export const ComputeGroupSchema = z.object({
  role: z.string(),
  count: z.number().int().positive().optional(),
  vcpuPerInstance: z.number().positive().optional(),
  ramGbPerInstance: z.number().positive().optional(),
  sizeHint: z.string().optional(),
  software: z.array(z.string()).optional(),
  needsGpu: z.boolean().optional(),
  highMemory: z.boolean().optional(),
  storage: AttachedStorageRequirementSchema.optional(),
  backup: GroupBackupRequirementSchema.optional(),
});

/** Fiyat tablosunun disinda ayrica istenen mimari/ticari senaryo. */
export const ScenarioRequestSchema = z.object({
  kind: z.enum(['ha', 'commitment', 'architecture-alternative']),
  label: z.string(),
  termYears: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  details: z.string().optional(),
});

export const RequirementSpecSchema = z.object({
  /** Musteri/teklif adi, metinde geciyorsa. */
  customerName: z.string().optional(),
  currency: z.enum(['TL', 'USD']).optional(),
  /** E-ticaret, veritabani, arsiv, statik dosya gibi mimari secimi yonlendiren ham baglam. */
  workload: z.string().optional(),
  /** Internal, herkese acik internet veya yalnizca VPN/ozel erisim. */
  networkExposure: NetworkExposureSchema.optional(),

  /**
   * Public edge varsa Load Balancer arkasindan disariya acilacak rol/sunucu adlari.
   * Diger compute rolleri private/VPN tarafinda kalir. Provisioning asamasinda
   * modelin yeniden tahmin yapmamasi icin simdiden yapisal tutulur.
   */
  internetFacingRoles: z.array(z.string().min(1)).optional(),

  compute: z
    .object({
      /**
       * Sunucu adedi. OPSIYONEL — cunku adet bilinmezken disk tipi bilinebilir:
       * "web icin sunucular, veritabani icin hizli disk" -> count yok,
       * storage.tier = 'premium'. `count` zorunlu olsaydi bu bilgi kaybolurdu
       * (nesting sonrasi eval'de ortaya cikti).
       *
       * Adet yoksa Designer compute kalemi EKLEMEZ; once sorulur.
       */
      count: z.number().int().positive().optional(),
      /** "kucuk", "8 vcpu", "gpu" gibi ham ipucu — Designer flavor'a cevirir. */
      sizeHint: z.string().optional(),
      needsGpu: z.boolean().optional(),
      highMemory: z.boolean().optional(),
      /**
       * Sunuculara BAGLI disk. `compute` ICINDE olmasi kasitli.
       *
       * Ilk surumde `storage` ust seviyede, `compute` ile ayni hizadaydi ve
       * eval'de yakalandi: Designer bunu "ayri bir depolama ihtiyaci" diye
       * okuyup 3 tane STANDALONE `storage` kalemi ekledi ve compute kalemini
       * HIC eklemedi — sunucular fiyatlanmadi.
       *
       * Platformda da disk sunucunun altinda (`compute.storage`); sema artik
       * platformu birebir yansitiyor ve yanlis okuma YAPISAL OLARAK mumkun degil.
       */
      storage: AttachedStorageRequirementSchema.optional(),
    })
    .optional(),

  /** Farkli kaynak profilleri varsa `compute` yerine rol bazli bu dizi kullanilir. */
  computeGroups: z.array(ComputeGroupSchema).optional(),

  /** HA, taahhut veya alternatif mimari talepleri; mevcut toplamdan ayri tutulur. */
  scenarioRequests: z.array(ScenarioRequestSchema).optional(),

  kubernetes: z
    .object({
      masterCount: z.number().int().positive().optional(),
      workerCount: z.number().int().positive().optional(),
    })
    .optional(),

  loadBalancer: z.object({ kind: LoadBalancerKindSchema }).optional(),

  /** Sunucudan bagimsiz block storage ihtiyaci. */
  standaloneStorage: z
    .object({
      tier: StorageTierSchema,
      sizeGb: z.number().positive().optional(),
    })
    .optional(),

  objectStorage: z.object({ sizeGb: z.number().positive().optional() }).optional(),

  backup: z
    .object({
      countPerMonth: z.number().int().nonnegative().optional(),
      sourceSizeGb: z.number().positive().optional(),
    })
    .optional(),

  /** Internet portu/kapasitesi; aylik GB degildir. */
  egressBandwidthMbps: z.number().positive().optional(),
  /** Mbps kapasitesinin ay boyunca ortalama kullanimi. */
  egressUtilizationPercent: z.number().positive().max(100).optional(),
  /** Aylik disari cikan trafik (GB). */
  egressGb: z.number().positive().optional(),
  floatingIpCount: z.number().int().positive().optional(),
  router: z
    .object({
      egressGb: z.number().positive().optional(),
      floatingIpCount: z.number().int().positive().optional(),
    })
    .optional(),

  /**
   * Metinden ANLASILMAYAN her sey buraya yazilir.
   * DEGISMEZ KURAL: burasi dolmak yerine deger UYDURULAMAZ.
   */
  unknowns: z.array(z.string()),

  /** Cikarimin gerekcesi — satisciya "seni dogru anladim mi?" diye gosterilir. */
  rationale: z.string(),
});

export type RequirementSpec = z.infer<typeof RequirementSpecSchema>;

/**
 * `RequirementSpecSchema`'nin JSON Schema karsiligi — API'ye structured output
 * kisiti olarak gonderilir.
 *
 * Elle yazildi (Zod 3 <-> SDK'nin Zod 4 yardimcisi uyusmuyor) ve bu bir avantaj:
 * `description` alanlari modelin cikarimini dogrudan yonlendiriyor. Ikisinin
 * senkron kalmasi tests/agents.spec.ts tarafindan zorlanir.
 *
 * ⛔ SAYISAL KISIT KULLANMAYIN — `minimum` / `maximum` / `multipleOf` /
 * `minLength` / `maxLength` structured output'ta DESTEKLENMIYOR ve istek
 * HTTP 400 ile reddedilir:
 *
 *   "output_config.format.schema: For 'integer' type, property 'minimum'
 *    is not supported"
 *
 * Bu canli calistirmada ogrenildi (ilk surumde 5 tane `minimum` vardi).
 * Kisitlar Zod tarafinda YASIYOR (`.positive()`, `.int()`, `.nonnegative()`) —
 * yani dogrulama kaybolmuyor, yalnizca API'ye gonderilmiyor. Model semadan
 * sapan bir sayi uretirse Zod reddeder.
 *
 * `tests/agents.spec.ts` bu kisitlarin geri sizmadigini test ediyor.
 */
export const REQUIREMENT_SPEC_JSON_SCHEMA = {
  type: 'object',
  properties: {
    customerName: { type: 'string', description: 'Musteri adi, metinde geciyorsa.' },
    currency: { type: 'string', enum: ['TL', 'USD'] },
    workload: {
      type: 'string',
      description:
        'Mimari ve alternatif secimini etkileyen ham is yuku: e-ticaret, veritabani, ' +
        'statik dosya, log, arsiv, yedek, container vb. Metinde gecmiyorsa uydurma.',
    },
    networkExposure: {
      type: 'string',
      enum: ['internal', 'public', 'vpn', 'unspecified'],
      description:
        'Sistemin erisim siniri: internal=yalnizca ozel ag, public=yalnizca secilen servislerin ' +
        'merkezi LB/Router edge uzerinden internet yayini, vpn=yalnizca VPN/site-to-site/ozel erisim. ' +
        'Public backend sunuculara dogrudan IP vermek demek degildir.',
    },
    internetFacingRoles: {
      type: 'array',
      description:
        'App LB/Router uzerinden internete acilacak sunucu veya rol adlari. Ornek: ["web", "Customer API"]. ' +
        'Veritabani ve yonetim rolleri burada degilse private/VPN tarafinda kalir. Metinde ad yoksa uydurma.',
      items: { type: 'string' },
    },
    compute: {
      type: 'object',
      description:
        'Sunucu ihtiyaci. Adet bilinmese bile disk/gpu bilgisi varsa bu nesneyi doldur.',
      properties: {
        count: {
          type: 'integer',
          description:
            'Sunucu adedi. Metinde ACIKCA yoksa BOS BIRAK ama diger bilgileri ' +
            '(disk, gpu) yine yaz ve adedi unknowns listesine soru olarak ekle.',
        },
        sizeHint: { type: 'string', description: 'Ham ipucu: "kucuk", "8 vcpu", "16 GB RAM".' },
        needsGpu: { type: 'boolean' },
        highMemory: { type: 'boolean' },
        storage: {
          type: 'object',
          description:
            'Sunuculara BAGLI disk. Disk her zaman buraya yazilir — ust seviyede ' +
            'ayri bir depolama alani YOK.',
          properties: {
            tier: { type: 'string', enum: ['premium', 'standard', 'unspecified'] },
            sizeGbPerInstance: {
              type: 'number',
              description:
                'INSTANCE BASINA disk boyutu, GB. TOPLAM DEGIL. ' +
                '"her birine 200 GB" -> 200 (600 degil). ' +
                '"toplam 600 GB, 3 sunucu" -> 200. TB soylendiyse 1024 ile carp.',
            },
          },
          required: ['tier'],
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    computeGroups: {
      type: 'array',
      description:
        'Farkli CPU/RAM/disk profilleri olan roller. Her rol ayri eleman olur. ' +
        'Bu alan doluysa ayni kaynaklari `compute` alaninda tekrar ETME.',
      items: {
        type: 'object',
        properties: {
          role: { type: 'string', description: 'Customer API, PostgreSQL, Redis gibi rol adi.' },
          count: { type: 'integer', description: 'Replica/instance adedi.' },
          vcpuPerInstance: {
            type: 'number',
            description:
              'INSTANCE BASINA vCPU. "2 replica toplam 4 vCPU" -> 2. Toplam degeri kopyalama.',
          },
          ramGbPerInstance: {
            type: 'number',
            description:
              'INSTANCE BASINA RAM (GB). "2 replica toplam 8 GB" -> 4.',
          },
          sizeHint: { type: 'string', description: 'Sayisal CPU/RAM yoksa ham boyut ipucu.' },
          software: {
            type: 'array',
            description: 'Bu rolde calisacak yazilimlar: PostgreSQL, Redis, RabbitMQ vb.',
            items: { type: 'string' },
          },
          needsGpu: { type: 'boolean' },
          highMemory: { type: 'boolean' },
          storage: {
            type: 'object',
            properties: {
              tier: { type: 'string', enum: ['premium', 'standard', 'unspecified'] },
              sizeGbPerInstance: { type: 'number', description: 'Instance basina disk, GB.' },
            },
            required: ['tier'],
            additionalProperties: false,
          },
          backup: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['snapshot', 'pitr', 'unspecified'] },
              countPerMonth: { type: 'integer', description: 'Aylik saklanacak yedek adedi.' },
              sourceSizeGb: { type: 'number', description: 'Yedeklenecek kaynak boyutu, GB.' },
            },
            required: ['kind'],
            additionalProperties: false,
          },
        },
        required: ['role'],
        additionalProperties: false,
      },
    },
    scenarioRequests: {
      type: 'array',
      description:
        'Mevcut liste fiyati disinda ayrica istenen HA, taahhut veya alternatif mimari senaryolari.',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['ha', 'commitment', 'architecture-alternative'] },
          label: { type: 'string' },
          termYears: { type: 'integer', enum: [1, 2, 3] },
          details: { type: 'string' },
        },
        required: ['kind', 'label'],
        additionalProperties: false,
      },
    },
    kubernetes: {
      type: 'object',
      properties: {
        masterCount: { type: 'integer' },
        workerCount: { type: 'integer' },
      },
      additionalProperties: false,
    },
    loadBalancer: {
      type: 'object',
      description: 'Tur belirtilmemisse kind="unspecified" ve unknowns\'a soru ekle.',
      properties: { kind: { type: 'string', enum: ['app', 'net', 'unspecified'] } },
      required: ['kind'],
      additionalProperties: false,
    },
    standaloneStorage: {
      type: 'object',
      description: 'Sunucudan BAGIMSIZ block storage. Sunucu diski compute.storage alanina yazilir.',
      properties: {
        tier: { type: 'string', enum: ['premium', 'standard', 'unspecified'] },
        sizeGb: { type: 'number', description: 'Toplam block storage boyutu, GB.' },
      },
      required: ['tier'],
      additionalProperties: false,
    },
    objectStorage: {
      type: 'object',
      properties: { sizeGb: { type: 'number' } },
      additionalProperties: false,
    },
    backup: {
      type: 'object',
      properties: {
        countPerMonth: { type: 'integer', description: 'Aylik yedek adedi.' },
        sourceSizeGb: { type: 'number' },
      },
      additionalProperties: false,
    },
    egressBandwidthMbps: {
      type: 'number',
      description:
        'Internet/bant genisligi Mbps. Bu bir HIZDIR; aylik egressGb yerine yazilmaz.',
    },
    egressUtilizationPercent: {
      type: 'number',
      description:
        'Mbps kapasitesinin ay boyunca ortalama kullanim yuzdesi. Metinde yoksa uydurma.',
    },
    egressGb: { type: 'number', description: 'Aylik disari cikan trafik, GB.' },
    floatingIpCount: { type: 'integer' },
    router: {
      type: 'object',
      description: 'Router istendiyse doldur. Router icin trafik ve/veya Floating IP fiyatlanir.',
      properties: {
        egressGb: { type: 'number', description: 'Router uzerinden aylik cikis trafigi, GB.' },
        floatingIpCount: { type: 'integer' },
      },
      additionalProperties: false,
    },
    unknowns: {
      type: 'array',
      description:
        'Metinden ANLASILMAYAN her sey. Bir degeri uydurmak yerine buraya soru yaz. ' +
        'Bos birakmak, yanlis doldurmaktan iyidir.',
      items: { type: 'string' },
    },
    rationale: {
      type: 'string',
      description: 'Cikariminin kisa Turkce gerekcesi; satisci bunu okuyup dogrulayacak.',
    },
  },
  required: ['unknowns', 'rationale'],
  additionalProperties: false,
} as const satisfies { type: 'object' } & Record<string, unknown>;

/** Tasarima gecmeden once mutlaka sorulmasi gereken belirsizlik. */
export interface CriticalUnknown {
  question: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// 5.B — Solution Designer ciktisi
// ---------------------------------------------------------------------------

/** Her secim icin gerekce zorunlu: "premium disk -> PortvMind-Premium-SSD". */
export interface DesignChoice {
  service: ServiceCode;
  itemId: string;
  rationale: string;
}

export interface EstimateDraft {
  choices: DesignChoice[];
  /** Ajanin kapanis ozeti — kalem eklenmediyse GEREKCESI burada. */
  finalText: string;
  /**
   * Tool katmani tarafindan REDDEDILEN cagri sayisi (uydurma productCode, sema hatasi).
   * PLAN 5.B: "reddedilme sayisi da metrik, sifira yakin olmali".
   */
  rejectedToolCalls: number;
  rejections: string[];
  scenarioNotes: ScenarioNote[];
}

export interface ScenarioNote {
  kind: 'baseline' | 'ha' | 'commitment' | 'architecture-alternative';
  label: string;
  status: 'current-estimate' | 'needs-input' | 'catalog-unavailable';
  message: string;
  termYears?: 1 | 2 | 3;
}

// ---------------------------------------------------------------------------
// 5.C — Auditor / Reconciler ciktilari
// ---------------------------------------------------------------------------

/** Satisciya sorulacak, varsayilan cevabi olan soru. */
export interface AuditQuestion {
  ruleId: string;
  question: string;
  /** Bos birakilirsa ne varsayilacak. */
  defaultAnswer: string;
  severity: Gap['severity'];
  itemId?: string;
}

export interface AuditReport {
  gaps: Gap[];
  /** Tek turda en fazla 5 soru (PLAN 6.A). */
  questions: AuditQuestion[];
  /** Turkce ozet — satisciya gosterilir. */
  summary: string;
  publishable: boolean;
  /** LLM'in kurallarin yakalayamadigi baglamsal gozlemleri (opsiyonel). */
  contextualNotes: string[];
}

export interface ReconcileResult {
  ok: boolean;
  localHourly: number;
  localMonthly: number;
  remoteHourly: number;
  remoteMonthly: number;
  hourlyDiff: number;
  monthlyDiff: number;
  /** Satir sayisi/tutari uyusmayan kalemler. */
  lineMismatches: string[];
  message: string;
}

export interface PriceSnapshot {
  currency: Currency;
  totalHourCost: number;
  totalMonthCost: number;
  lines: PriceLine[];
}
