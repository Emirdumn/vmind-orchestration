/**
 * FAZ 5.A / 5.B eval senaryolari
 *
 * PLAN kabul kriterleri:
 *   5.A — 10 gercek satis cumlesinden >= 9'unda cikarilan spec dogru
 *   5.B — 10 senaryoda hic uydurma productCode yok (reddedilme sayisi ~0)
 *
 * Bu senaryolar GERCEK LLM ile calisir; `npm run eval` API anahtari ister.
 * Beklentiler kasitli olarak "dogru cevap" degil, DOGRULANABILIR IDDIALAR:
 * modelin kelimesi kelimesine ne yazacagini degil, neyi yakalamasi/yakalamamasi
 * gerektigini olcuyoruz.
 */
import type { RequirementSpec } from '../src/agents/types.js';

export interface ExtractionCase {
  name: string;
  text: string;
  /** Cikarilan spec bu kontrolleri gecmeli. Hepsi gecerse senaryo BASARILI. */
  checks: Array<{ label: string; assert: (spec: RequirementSpec) => boolean }>;
}

const hasUnknownAbout = (spec: RequirementSpec, keyword: string): boolean =>
  spec.unknowns.some((unknown) => unknown.toLowerCase().includes(keyword.toLowerCase()));

export const EXTRACTION_CASES: ExtractionCase[] = [
  {
    name: 'PLAN §3 ornegi',
    text: 'Müşteri 4 sunucu istiyor, load balancer olsun, worker olsun, premium disk olsun, backup olsun.',
    checks: [
      { label: 'compute.count = 4', assert: (s) => s.compute?.count === 4 },
      { label: 'storage premium', assert: (s) => s.compute?.storage?.tier === 'premium' },
      { label: 'LB turu belirsiz isaretlendi', assert: (s) => s.loadBalancer?.kind === 'unspecified' },
      { label: '"worker" belirsizligi yakalandi', assert: (s) => hasUnknownAbout(s, 'worker') },
      { label: 'disk boyutu sorulmus', assert: (s) => hasUnknownAbout(s, 'disk') || hasUnknownAbout(s, 'boyut') },
    ],
  },
  {
    name: 'net sayilar, belirsizlik yok',
    text: '3 adet 4 vCPU 16 GB RAM sunucu, her birine 200 GB premium SSD, aylik 2 TB egress. Para birimi USD.',
    checks: [
      { label: 'compute.count = 3', assert: (s) => s.compute?.count === 3 },
      { label: 'storage 200 GB', assert: (s) => s.compute?.storage?.sizeGbPerInstance === 200 },
      { label: 'egress 2048 GB', assert: (s) => s.egressGb === 2048 },
      { label: 'currency USD', assert: (s) => s.currency === 'USD' },
      { label: 'gereksiz belirsizlik uretilmedi', assert: (s) => s.unknowns.length <= 1 },
    ],
  },
  {
    name: 'belirsiz adet — UYDURMA YASAK',
    text: 'Müşteriye birkaç sunucu lazım, üzerinde de biraz disk olsun.',
    checks: [
      { label: 'sunucu sayisi UYDURULMADI', assert: (s) => s.compute?.count === undefined },
      { label: 'adet soruldu', assert: (s) => hasUnknownAbout(s, 'sunucu') || hasUnknownAbout(s, 'kac') },
      { label: 'disk boyutu soruldu', assert: (s) => hasUnknownAbout(s, 'disk') || hasUnknownAbout(s, 'boyut') },
    ],
  },
  {
    name: 'Ingilizce girdi',
    text: 'Customer needs a Kubernetes cluster with 3 masters and 5 workers, plus 1 TB object storage.',
    checks: [
      { label: 'master = 3', assert: (s) => s.kubernetes?.masterCount === 3 },
      { label: 'worker = 5', assert: (s) => s.kubernetes?.workerCount === 5 },
      { label: 'object storage 1024 GB', assert: (s) => s.objectStorage?.sizeGb === 1024 },
    ],
  },
  {
    name: 'yedeklilik / yedekleme tuzagi',
    text: 'Sistemde yedeklilik olsun, iki sunucu birbirini yedeklesin.',
    checks: [
      {
        label: 'HA ile backup karistirilmadi (backup kalemi uretilmedi)',
        assert: (s) => s.backup === undefined,
      },
      { label: 'compute.count = 2', assert: (s) => s.compute?.count === 2 },
    ],
  },
  {
    name: 'App LB acikca belirtilmis',
    text: 'Önüne katman 7 uygulama load balancer koyalım, arkasında 4 web sunucusu.',
    checks: [
      { label: 'LB = app', assert: (s) => s.loadBalancer?.kind === 'app' },
      { label: 'LB belirsiz olarak sorulmadi', assert: (s) => !hasUnknownAbout(s, 'katman') },
      { label: 'compute.count = 4', assert: (s) => s.compute?.count === 4 },
    ],
  },
  {
    name: 'GPU sinifi belirsiz',
    text: 'Yapay zeka eğitimi için 2 GPU sunucu istiyorlar.',
    checks: [
      { label: 'compute.count = 2', assert: (s) => s.compute?.count === 2 },
      { label: 'GPU ihtiyaci isaretlendi', assert: (s) => s.compute?.needsGpu === true },
      { label: 'GPU sinifi soruldu', assert: (s) => hasUnknownAbout(s, 'gpu') },
    ],
  },
  {
    name: 'backup adedi belirtilmemis',
    text: '2 sunucu, her birinde 500 GB disk, düzenli yedek alsınlar.',
    checks: [
      { label: 'compute.count = 2', assert: (s) => s.compute?.count === 2 },
      { label: 'disk 500 GB', assert: (s) => s.compute?.storage?.sizeGbPerInstance === 500 },
      {
        label: 'yedek adedi uydurulmadi',
        assert: (s) => s.backup?.countPerMonth === undefined,
      },
      { label: 'yedek adedi soruldu', assert: (s) => hasUnknownAbout(s, 'yedek') },
    ],
  },
  {
    name: 'object storage + egress',
    text: 'Sadece object storage lazım, 5 TB veri, ayda 10 TB indirme trafiği bekliyoruz.',
    checks: [
      { label: 'object storage 5120 GB', assert: (s) => s.objectStorage?.sizeGb === 5120 },
      { label: 'egress 10240 GB', assert: (s) => s.egressGb === 10240 },
      { label: 'compute uretilmedi', assert: (s) => s.compute === undefined },
    ],
  },
  {
    name: 'karma + eksik bilgi',
    text: 'E-ticaret sitesi taşıyacağız. Web tarafı için sunucular, load balancer, veritabanı için hızlı disk. Detayları sonra netleştiririz.',
    checks: [
      { label: 'sunucu sayisi uydurulmadi', assert: (s) => s.compute?.count === undefined },
      { label: 'hizli disk = premium', assert: (s) => s.compute?.storage?.tier === 'premium' },
      { label: 'LB turu belirsiz', assert: (s) => s.loadBalancer?.kind === 'unspecified' },
      { label: 'birden fazla belirsizlik kaydedildi', assert: (s) => s.unknowns.length >= 2 },
    ],
  },
];

export interface DesignCase {
  name: string;
  spec: RequirementSpec;
  /** Beklenen servis kodlari (sirasiz). */
  expectedServices: string[];
}

export const DESIGN_CASES: DesignCase[] = [
  {
    name: 'tek compute',
    spec: { compute: { count: 1, sizeHint: 'kucuk' }, unknowns: [], rationale: '' },
    expectedServices: ['compute'],
  },
  {
    name: 'compute + premium disk',
    spec: {
      compute: { count: 3, storage: { tier: 'premium', sizeGbPerInstance: 100 } },
      unknowns: [],
      rationale: '',
    },
    expectedServices: ['compute'],
  },
  {
    name: 'App LB + compute',
    spec: {
      compute: { count: 2 },
      loadBalancer: { kind: 'app' },
      unknowns: [],
      rationale: '',
    },
    expectedServices: ['compute', 'load-balancer'],
  },
  {
    name: 'Net LB',
    spec: { compute: { count: 2 }, loadBalancer: { kind: 'net' }, unknowns: [], rationale: '' },
    expectedServices: ['compute', 'load-balancer'],
  },
  {
    name: 'kubernetes',
    spec: {
      kubernetes: { masterCount: 3, workerCount: 5 },
      unknowns: [],
      rationale: '',
    },
    expectedServices: ['kubernetes'],
  },
  {
    name: 'object storage + egress',
    spec: {
      objectStorage: { sizeGb: 5120 },
      egressGb: 10240,
      unknowns: [],
      rationale: '',
    },
    expectedServices: ['object-storage'],
  },
  {
    name: 'GPU',
    spec: { compute: { count: 2, needsGpu: true }, unknowns: [], rationale: '' },
    expectedServices: ['compute'],
  },
  {
    name: 'yuksek bellek',
    spec: { compute: { count: 2, highMemory: true }, unknowns: [], rationale: '' },
    expectedServices: ['compute'],
  },
  {
    name: 'standart disk + backup',
    spec: {
      compute: { count: 1, storage: { tier: 'standard', sizeGbPerInstance: 500 } },
      backup: { countPerMonth: 4, sourceSizeGb: 500 },
      unknowns: [],
      rationale: '',
    },
    expectedServices: ['compute'],
  },
  {
    name: 'floating ip + egress',
    spec: {
      compute: { count: 2 },
      floatingIpCount: 2,
      egressGb: 500,
      unknowns: [],
      rationale: '',
    },
    expectedServices: ['compute'],
  },
];
