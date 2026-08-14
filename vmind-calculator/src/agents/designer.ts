/**
 * FAZ 5.B — Solution Designer
 *
 * RequirementSpec -> EstimateDraft. Yalnizca catalog.* ve estimate.* tool'larini
 * kullanabilir; publish.* ve approval.* bu ajana HIC verilmez — yetkiyi promptla
 * degil, tool listesiyle sinirlariz.
 *
 * PLAN 5.B kabul kriteri "hic uydurma productCode yok" — tool katmani bunu zaten
 * reddediyor, bu yuzden asil olculen sey REDDEDILME SAYISI: sifira ne kadar
 * yakinsa ajanin katalogla calisma disiplini o kadar iyi demektir.
 */
import { callTool, type ToolContext, type ToolName } from '../mcp/tools/index.js';
import type { LlmClient, ToolDefinition, ToolInputSchema } from './llm.js';
import { reconcileBackupItems } from './backup-reconciler.js';
import { reconcileNetworkTopology } from './network-reconciler.js';
import { DESIGNER_SYSTEM } from './prompts.js';
import type { EstimateDraft, RequirementSpec, ScenarioNote } from './types.js';

/** Designer'a acilan tool'lar. publish.* / approval.* BILEREK yok. */
export const DESIGNER_TOOLS: readonly ToolName[] = [
  'catalog.listServices',
  'catalog.searchProducts',
  'catalog.searchFlavors',
  'catalog.listVolumeTypes',
  'estimate.create',
  'estimate.addItem',
  'estimate.updateItem',
  'estimate.removeItem',
  'estimate.read',
  'estimate.undo',
];

const EMPTY_INPUT = { type: 'object', properties: {}, required: [] } as const;

/**
 * Tool girdi semalari — Zod'dan uretilmiyor, ELLE yazildi.
 *
 * Sebep: bu semalar modelin tool secimini yonlendiren birincil sinyaldir.
 * Zod'dan otomatik uretim alan aciklamalarini kaybeder; "size GB cinsinden"
 * gibi bir aciklamanin dusmesi, sessizce yanlis birimde kalem eklenmesi demek.
 * Calisma zamani dogrulamasi yine Zod ile yapiliyor (callTool icinde) — bu
 * semalar yalnizca modele ne gonderecegini anlatir.
 */
const STORAGE_SPEC = {
  type: 'object',
  description: 'Block storage. productCode catalog.listVolumeTypes ciktisindan alinir.',
  properties: {
    productCode: { type: 'string' },
    size: { type: 'number', description: 'Disk boyutu, `unit` cinsinden.' },
    unit: { type: 'string', enum: ['GB', 'TB'] },
    volumeTypeName: { type: 'string', description: 'Yalnizca etiket; fiyata girmez.' },
  },
  required: ['productCode', 'size', 'unit'],
} as const;

const NETWORK_SPEC = {
  type: 'object',
  description: 'Disari cikan trafik (egress). productCode genelde NETW-OUT-001.',
  properties: {
    productCode: { type: 'string' },
    traffic: { type: 'number' },
    unit: { type: 'string', enum: ['GB', 'TB'] },
  },
  required: ['productCode', 'traffic', 'unit'],
} as const;

const TOOL_SPECS = {
  'catalog.listServices': {
    description: '9 teklif servisini ve basliklarini listeler.',
    input_schema: EMPTY_INPUT,
  },
  'catalog.searchProducts': {
    description:
      'Katalogda urun arar. Donen productCode DISINDA hicbir kod kullanilamaz. ' +
      'Load balancer, object storage, backup, floating IP ve data transfer urunleri buradan bulunur.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Urun adi veya kodunda gecen metin.' },
        service: {
          type: 'string',
          description: 'Katalog servis filtresi: LOAD_BALANCER | VOLUME | NETWORK | COMPUTE | OBJECT_STORAGE',
        },
        limit: { type: 'integer' },
      },
      required: [],
    },
  },
  'catalog.searchFlavors': {
    description:
      'Instance tipi (flavor) arar. Donen productCode DOGRUDAN compute kaleminin productCode alanidir.',
    input_schema: {
      type: 'object',
      properties: {
        minVcpu: { type: 'integer', description: 'En az bu kadar vCPU.' },
        minRamGb: { type: 'number', description: 'En az bu kadar RAM (GB).' },
        gpu: { type: 'boolean', description: 'true ise yalnizca GPU tipleri.' },
        limit: { type: 'integer' },
      },
      required: [],
    },
  },
  'catalog.listVolumeTypes': {
    description: 'Block storage tiplerini listeler: PortvMind-Premium-SSD ve PortvMind-Standard-HDD.',
    input_schema: EMPTY_INPUT,
  },
  'estimate.create': {
    description: 'Teklifin adini ve para birimini ayarlar.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        currency: { type: 'string', enum: ['TL', 'USD'] },
      },
      required: [],
    },
  },
  'estimate.addItem': {
    description:
      'Teklife kalem ekler. Sema veya katalog dogrulamasindan gecmezse REDDEDILIR ve nedeni doner. ' +
      'Reddedilirse ayni kodu tekrar deneme — once catalog.* ile dogru kodu bul.',
    input_schema: {
      type: 'object',
      properties: {
        service: {
          type: 'string',
          enum: [
            'compute',
            'storage',
            'data-transfer',
            'floating-ip',
            'load-balancer',
            'kubernetes',
            'object-storage',
            'router',
            'backup',
          ],
        },
        data: {
          type: 'object',
          description:
            'Servise gore degisir. ' +
            'compute: {productCode, count, storage?, network?, floatingIp?{productCode,count}}. ' +
            'Backup compute icine GOMULMEZ; bagimsiz backup hizmeti olarak ve tum diger kalemlerden sonra eklenir. ' +
            'load-balancer: {productCode, network?}. ' +
            'object-storage: {storage?, network?} — network olmazsa egress hic fiyatlanmaz. ' +
            'backup: {productCode, sourceSize, unit, estimatedCount} — estimatedCount 0 olursa kalem tamamen atlanir. ' +
            'kubernetes: {master:{productCode,count,storage?}, worker:{productCode,count,storage?}}. ' +
            'storage: StorageSpec. data-transfer: NetworkSpec. floating-ip: {productCode, count}.',
          properties: {
            productCode: { type: 'string' },
            count: { type: 'integer' },
            size: { type: 'number' },
            unit: { type: 'string', enum: ['GB', 'TB'] },
            traffic: { type: 'number' },
            sourceSize: { type: 'number' },
            estimatedCount: { type: 'integer' },
            storage: STORAGE_SPEC,
            network: NETWORK_SPEC,
            floatingIp: {
              type: 'object',
              properties: { productCode: { type: 'string' }, count: { type: 'integer' } },
              required: ['productCode', 'count'],
            },
            master: {
              type: 'object',
              properties: {
                productCode: { type: 'string' },
                count: { type: 'integer' },
                storage: STORAGE_SPEC,
              },
              required: ['productCode', 'count'],
            },
            worker: {
              type: 'object',
              properties: {
                productCode: { type: 'string' },
                count: { type: 'integer' },
                storage: STORAGE_SPEC,
              },
              required: ['productCode', 'count'],
            },
          },
        },
      },
      required: ['service', 'data'],
    },
  },
  'estimate.updateItem': {
    description: 'Kalemi kismi gunceller; birlesik sonuc yeniden dogrulanir.',
    input_schema: {
      type: 'object',
      properties: {
        itemId: { type: 'string' },
        patch: { type: 'object', description: 'Degistirilecek alanlar.' },
      },
      required: ['itemId', 'patch'],
    },
  },
  'estimate.removeItem': {
    description: 'Kalemi siler.',
    input_schema: {
      type: 'object',
      properties: { itemId: { type: 'string' } },
      required: ['itemId'],
    },
  },
  'estimate.read': {
    description: 'Teklifin guncel tam halini dondurur.',
    input_schema: EMPTY_INPUT,
  },
  'estimate.undo': {
    description: 'Son degisikligi geri alir.',
    input_schema: EMPTY_INPUT,
  },
} as unknown as Record<ToolName, { description: string; input_schema: ToolInputSchema }>;

/**
 * Tool tanimlari. `SolutionReviser` de bunlari kullanir — iki ajanin ayni
 * semayi gormesi onemli: aciklamalar (ornegin "MB yazma") tek yerde durmali.
 */
export function toolDefinitions(): ToolDefinition[] {
  return DESIGNER_TOOLS.map((name) => ({
    // API tool adlarinda nokta kullanilamaz; alt cizgiye cevrilir.
    name: name.replace('.', '_'),
    description: TOOL_SPECS[name].description,
    input_schema: TOOL_SPECS[name].input_schema,
  }));
}

export const MAX_DESIGNER_ITERATIONS = 32;

/**
 * Basit teklifleri hizli tutar, rol ve servis sayisi arttikca gercek ilerlemeye
 * alan acar. Sabit 8 tur, sekiz compute rollu teklifleri dongu sanip kesiyordu.
 */
export function designerIterationLimit(spec: RequirementSpec): number {
  const computeGroupCount = spec.computeGroups?.length ?? (spec.compute ? 1 : 0);
  const serviceCount = [
    computeGroupCount > 0,
    Boolean(spec.kubernetes),
    Boolean(spec.loadBalancer),
    Boolean(spec.standaloneStorage),
    Boolean(spec.objectStorage),
    Boolean(spec.backup || spec.computeGroups?.some((group) => group.backup)),
    spec.egressGb !== undefined,
    spec.floatingIpCount !== undefined,
    Boolean(spec.router),
  ].filter(Boolean).length;

  return Math.min(
    MAX_DESIGNER_ITERATIONS,
    // Guclu VMind fallback'i tek bir belirsiz cevaptan compute + LB + Router
    // tasarlayabilir. Canli testte 3 servis icin 15 benzersiz/gecerli tool
    // cagrisi gerekti; 11 turluk eski taban tamamlanmadan kesiyordu.
    Math.max(12, 8 + computeGroupCount * 2 + serviceCount * 2),
  );
}

/** Ayrica istenen senaryolari fiyat uydurmadan durumlandirir. */
export function scenarioNotes(spec: RequirementSpec): ScenarioNote[] {
  const notes: ScenarioNote[] = [
    {
      kind: 'baseline',
      label: 'Temel / liste fiyatı',
      status: 'current-estimate',
      message: 'Ekrandaki toplam, açıkça belirtilen kaynaklarla oluşturulan temel senaryodur.',
    },
  ];

  for (const scenario of spec.scenarioRequests ?? []) {
    if (scenario.kind === 'commitment') {
      notes.push({
        kind: scenario.kind,
        label: scenario.label,
        status: 'catalog-unavailable',
        message:
          'PortvMind ürün kataloğunda taahhüt indirim oranı bulunmuyor; liste fiyatından indirim uydurulmadı.',
        ...(scenario.termYears !== undefined ? { termYears: scenario.termYears } : {}),
      });
      continue;
    }

    notes.push({
      kind: scenario.kind,
      label: scenario.label,
      status: 'needs-input',
      message:
        scenario.kind === 'ha'
          ? 'HA alternatifi ayrı tutuldu; replica/topoloji ayrıntıları netleşmeden temel toplama eklenmedi.'
          : 'Alternatif mimari ayrı tutuldu; kaynak profili netleşmeden fiyat uydurulmadı.',
    });
  }

  return notes;
}

export class SolutionDesigner {
  constructor(private readonly llm: LlmClient) {}

  async design(
    ctx: ToolContext,
    spec: RequirementSpec,
    clarifications: Record<string, string> = {},
  ): Promise<EstimateDraft> {
    const rejections: string[] = [];

    const result = await this.llm.toolLoop({
      system: DESIGNER_SYSTEM,
      userMessage: buildDesignPrompt(spec, clarifications),
      tools: toolDefinitions(),
      // Birden cok servis ve tool cagrisi tek turde 2200 token'i asabiliyor.
      // Ortam tavani yine OPENROUTER_MAX_TOKENS ile maliyeti sinirlar.
      maxTokens: 3200,
      maxIterations: designerIterationLimit(spec),
      // Model katalog sonucunu bir kez yeniden isteyebiliyor (ozellikle toplu
      // tool cevaplarindan sonra). Ikinci ayni aramaya izin ver; ucuncusu
      // artik olculebilir bir ilerlememe sinyalidir.
      maxRepeatedToolCalls: 2,
      runTool: async (name, input) => {
        const toolName = name.replace('_', '.') as ToolName;
        if (!DESIGNER_TOOLS.includes(toolName)) {
          // Prompt disiplini yetmezse ikinci savunma hatti: yetki disi tool.
          throw new Error(`"${name}" bu ajana acik degil.`);
        }
        return callTool(ctx, toolName, input);
      },
    });

    for (const call of result.toolCalls) {
      if (!call.ok && call.error) rejections.push(`${call.name}: ${call.error}`);
    }

    const networkReconcile = await reconcileNetworkTopology(ctx, spec);
    const backupReconcile = await reconcileBackupItems(ctx);

    const state = ctx.session.read();
    return {
      finalText: [
        result.finalText,
        networkReconcile.changed ? networkReconcile.message : '',
        backupReconcile.changed ? backupReconcile.message : '',
      ]
        .filter(Boolean)
        .join('\n'),
      choices: state.list.map((item) => ({
        service: item.service,
        itemId: item.id,
        rationale: extractRationale(result.finalText, item.service),
      })),
      rejectedToolCalls: rejections.length,
      rejections,
      scenarioNotes: scenarioNotes(spec),
    };
  }
}

export function buildDesignPrompt(
  spec: RequirementSpec,
  clarifications: Record<string, string> = {},
): string {
  const lines = [
    'Asagidaki ihtiyaci teklife cevir.',
    '',
    'RequirementSpec:',
    JSON.stringify(spec, null, 1),
    '',
    `Bu ihtiyaç için tool turu bütçesi: ${designerIterationLimit(spec)}.`,
    'İlerlerken aynı tool ve aynı girdiyi tekrar çağırma.',
    '',
  ];

  const answeredClarifications = Object.entries(clarifications).filter(
    ([, answer]) => answer.trim().length > 0,
  );
  if (answeredClarifications.length > 0) {
    lines.push(
      'SATISCININ NETLESTIRME CEVAPLARI — bunlar RequirementSpec uzerine yazilmis',
      'en guncel bilgidir. Tasarimda MUTLAKA uygula; eski belirsiz degeri gecersiz kilar:',
      ...answeredClarifications.map(([question, answer]) => `- ${question} -> ${answer}`),
      '',
    );
  }

  if (spec.unknowns.length > 0) {
    const unanswered = spec.unknowns.filter((unknown) => {
      const answer = clarifications[unknown];
      return answer === undefined || answer.trim().length === 0;
    });
    if (unanswered.length === 0) {
      lines.push('Tum kritik belirsizlikler satisci tarafindan cevaplandi.', '');
    } else {
      lines.push(
        'DIKKAT — asagidaki noktalar HENUZ BELIRSIZ. Bunlar icin kalem ekleme,',
        'deger uydurma; eksik birakip ozetinde belirt:',
        ...unanswered.map((unknown) => `- ${unknown}`),
        '',
      );
    }
  }

  lines.push(
    'Once catalog.* ile urunleri ara, sonra estimate.addItem ile ekle.',
    'Bitince yaptigin secimleri kisa Turkce ile ozetle (her secim icin bir satir).',
  );
  return lines.join('\n');
}

/** Ajanin ozet metninden ilgili servise ait gerekce satirini bulur. */
function extractRationale(finalText: string, service: string): string {
  const line = finalText
    .split('\n')
    .find((candidate) => candidate.toLowerCase().includes(service.toLowerCase()));
  return line?.replace(/^[-*•]\s*/, '').trim() ?? `${service} kalemi eklendi.`;
}
