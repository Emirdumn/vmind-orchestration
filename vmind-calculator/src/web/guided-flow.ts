import { z } from 'zod';

import { resolveProductAlias } from '../core/catalog/aliases.js';
import { callTool, type ToolContext } from '../mcp/tools/index.js';
import { reconcileBackupItems } from '../agents/backup-reconciler.js';
import { reconcileNetworkTopology } from '../agents/network-reconciler.js';
import { scenarioNotes } from '../agents/designer.js';
import type { EstimateDraft, RequirementSpec } from '../agents/types.js';

export const GuidedQuoteInputSchema = z.object({
  profile: z.enum(['recommended', 'balanced', 'economy']),
  workload: z.enum(['web', 'business', 'database', 'general']),
  exposure: z.enum(['public', 'internal', 'vpn']),
  capacity: z.enum(['starter', 'standard', 'powerful']),
  instanceCount: z.number().int().min(1).max(99),
  diskTier: z.enum(['premium', 'standard']),
  diskGb: z.number().int().min(10).max(1_000_000),
  loadBalancer: z.enum(['app', 'net', 'none']),
  backupCount: z.number().int().min(0).max(90),
  egressGb: z.number().int().min(1).max(100_000_000),
  floatingIpCount: z.number().int().min(1).max(20),
  currency: z.enum(['TL', 'USD']),
  /** Not yalnız rapora girer; deterministik yol serbest metni yorumlamaz. */
  notes: z.string().max(1_000),
}).strict();

export type GuidedQuoteInput = z.infer<typeof GuidedQuoteInputSchema>;

const CAPACITY = {
  starter: { vcpu: 2, ramGb: 4 },
  standard: { vcpu: 4, ramGb: 8 },
  powerful: { vcpu: 8, ramGb: 16 },
} as const;

const WORKLOAD = {
  web: 'web sitesi veya internet uygulaması',
  business: 'şirket içi kurumsal uygulama',
  database: 'veritabanı iş yükü',
  general: 'genel amaçlı sunucu iş yükü',
} as const;

export function guidedQuoteToSpec(input: GuidedQuoteInput): RequirementSpec {
  const capacity = CAPACITY[input.capacity];
  const publicRoles = input.exposure === 'public' ? ['web/API/uygulama'] : undefined;
  return {
    currency: input.currency,
    workload: WORKLOAD[input.workload],
    networkExposure: input.exposure,
    ...(publicRoles ? { internetFacingRoles: publicRoles } : {}),
    compute: {
      count: input.instanceCount,
      sizeHint: `${capacity.vcpu} vCPU / ${capacity.ramGb} GB RAM`,
      needsGpu: false,
      highMemory: input.workload === 'database',
      storage: {
        tier: input.diskTier,
        sizeGbPerInstance: input.diskGb,
      },
    },
    ...(input.loadBalancer !== 'none'
      ? { loadBalancer: { kind: input.loadBalancer } }
      : {}),
    ...(input.backupCount > 0
      ? {
          backup: {
            countPerMonth: input.backupCount,
            sourceSizeGb: input.diskGb * input.instanceCount,
          },
        }
      : {}),
    egressGb: input.egressGb,
    router: {
      egressGb: input.egressGb,
      ...(input.exposure === 'public' ? { floatingIpCount: input.floatingIpCount } : {}),
    },
    unknowns: [],
    rationale:
      `Tıklamalı ${input.profile} profil: ${input.instanceCount} sunucu, ` +
      `${capacity.vcpu} vCPU/${capacity.ramGb} GB, ${input.diskGb} GB ${input.diskTier} disk, ` +
      `${input.exposure} erişim.` +
      (input.notes.trim() ? ` Kullanıcı notu (yorumlanmadı): ${input.notes.trim()}` : ''),
  };
}

/**
 * Tıklamalı ve şeması doğrulanmış giriş için model çağırmadan ürün seçer.
 * Katalog kodları yine canlı snapshot'tan bulunur ve bütün değişiklikler tool
 * katmanından geçer; fiyat veya productCode sabit metinden uydurulmaz.
 */
export class DeterministicGuidedDesigner {
  constructor(private readonly input: GuidedQuoteInput) {}

  async design(ctx: ToolContext, spec: RequirementSpec): Promise<EstimateDraft> {
    const currency = this.input.currency;
    const capacity = CAPACITY[this.input.capacity];
    const priceable = ctx.catalog
      .searchFlavors({ minVcpu: capacity.vcpu, minRamGb: capacity.ramGb, gpu: false })
      .filter((flavor) => {
        try {
          ctx.catalog.assertPriceable(flavor.id, currency);
          return true;
        } catch {
          return false;
        }
      });
    const familyPreferred = priceable.filter((flavor) =>
      this.input.workload === 'database'
        ? flavor.name.toLowerCase().startsWith('m1.')
        : flavor.name.toLowerCase().startsWith('g1.'),
    );
    const candidates = familyPreferred.length > 0 ? familyPreferred : priceable;
    const flavor = candidates.sort(
      (left, right) =>
        left.vcpus - right.vcpus ||
        left.ram - right.ram ||
        (ctx.catalog.priceOf(left.id, currency) ?? Infinity) -
          (ctx.catalog.priceOf(right.id, currency) ?? Infinity),
    )[0];
    if (!flavor) {
      throw new Error(
        `Katalogda en az ${capacity.vcpu} vCPU / ${capacity.ramGb} GB fiyatlanabilir flavor yok.`,
      );
    }

    const alias = (name: string): { productCode: string; label: string } => {
      const product = resolveProductAlias(name);
      if (!product) throw new Error(`Ürün eşlemesi bulunamadı: ${name}`);
      ctx.catalog.assertPriceable(product.productCode, currency);
      return product;
    };
    const disk = alias(this.input.diskTier === 'premium' ? 'premium disk' : 'standard disk');
    const backup = this.input.backupCount > 0 ? alias('backup') : undefined;

    await callTool(ctx, 'estimate.create', {
      name: `VMind ${this.input.profile} teklif`,
      currency,
    });
    await callTool(ctx, 'estimate.addItem', {
      service: 'compute',
      data: {
        productCode: flavor.id,
        count: this.input.instanceCount,
        description: WORKLOAD[this.input.workload],
        storage: {
          productCode: disk.productCode,
          size: this.input.diskGb,
          unit: 'GB',
          volumeTypeName: disk.label,
        },
        ...(backup
          ? {
              backup: {
                productCode: backup.productCode,
                sourceSize: this.input.diskGb,
                unit: 'GB',
                estimatedCount: this.input.backupCount,
              },
            }
          : {}),
      },
    });

    if (this.input.loadBalancer !== 'none') {
      const lb = alias(this.input.loadBalancer === 'app' ? 'app lb' : 'net lb');
      await callTool(ctx, 'estimate.addItem', {
        service: 'load-balancer',
        data: { productCode: lb.productCode },
      });
    }

    const network = await reconcileNetworkTopology(ctx, spec);
    const backups = await reconcileBackupItems(ctx);
    const state = ctx.session.read();
    const rationaleByService: Record<string, string> = {
      compute:
        `${flavor.name}, seçilen ${capacity.vcpu} vCPU/${capacity.ramGb} GB alt sınırını ` +
        `karşılayan fiyatlanabilir ${this.input.workload === 'database' ? 'memory' : 'general'} flavor.`,
      'load-balancer': `${this.input.loadBalancer === 'app' ? 'HTTP/HTTPS App' : 'TCP/UDP Net'} Load Balancer seçildi.`,
      router: network.message,
      backup: backups.message,
    };
    return {
      finalText:
        `Tıklamalı giriş LLM kullanılmadan katalog ve tool katmanıyla oluşturuldu. ` +
        `${network.message} ${backups.message}`,
      choices: state.list.map((item) => ({
        service: item.service,
        itemId: item.id,
        rationale: rationaleByService[item.service] ?? 'Doğrulanmış tıklamalı seçim uygulandı.',
      })),
      rejectedToolCalls: 0,
      rejections: [],
      scenarioNotes: scenarioNotes(spec),
    };
  }
}
