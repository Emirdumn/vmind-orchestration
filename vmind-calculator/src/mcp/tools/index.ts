/**
 * FAZ 3 — Tool katmani
 *
 * Ajanin dunyaya dokundugu TEK yuzey. Dar, tipli, yan etkisi belli.
 *
 * Tool'lar MCP transport'undan BAGIMSIZ tanimlandi: burada saf fonksiyonlar var,
 * `src/mcp/server.ts` yalnizca ince bir adaptor. Boylece tool davranisi
 * (ozellikle HITL kapisi) MCP olmadan test edilebiliyor.
 *
 * DEGISMEZ KURALLAR (PLAN §1.2):
 *   1. Fiyat hesaplamanin tek yolu `price.calculate`
 *   2. `productCode` uydurma yok — katalogda olmayan kod reddedilir
 *   3. Sessiz varsayim yok — eksikler `validate.check` ile Gap olur
 *   4. `publish.*` insan onayi olmadan calismaz
 */
import { z } from 'zod';

import { Catalog } from '../../core/catalog/catalog.js';
import { EstimateSession } from '../../core/estimate/session.js';
import { RuleEngine } from '../../core/rules/engine.js';
import { serviceTotals } from '../../core/pricing/engine.js';
import {
  CurrencySchema,
  SERVICE_CODES,
  SERVICE_TITLES,
  ServiceCodeSchema,
  type ServiceCode,
} from '../../core/schema/estimate.js';
import { PlatformApiClient } from '../../platform/api-client.js';
import type { AuditTrail } from '../../core/telemetry/audit.js';
import type { ValidationReport } from '../../core/rules/types.js';

/** HITL onayi olmadan yayinlama denemesi. */
export class ApprovalRequiredError extends Error {
  constructor(operation: string, reason: string) {
    super(`${operation} reddedildi: ${reason}`);
    this.name = 'ApprovalRequiredError';
  }
}

export class BlockersPresentError extends Error {
  constructor(readonly report: ValidationReport) {
    super(
      `Yayinlanamaz: cozulmemis ${report.blockers.length} blocker var — ` +
        report.blockers.map((b) => b.ruleId).join(', '),
    );
    this.name = 'BlockersPresentError';
  }
}

export interface ToolContext {
  catalog: Catalog;
  session: EstimateSession;
  rules: RuleEngine;
  client?: PlatformApiClient;
  /**
   * HITL onay kapisi. Orchestrator, satisci onay ekranindan gectikten SONRA
   * bunu true yapar. Varsayilan false — hicbir yayinlama kazara gerceklesemez.
   */
  approval: { granted: boolean; grantedBy?: string; at?: string };
  /**
   * FAZ 7.B — denetim izi. Verilirse `callTool` her cagriyi (basarili ve
   * reddedilen) buraya yazar. Verilmezse telemetri sessizce atlanir; tool
   * davranisi degismez.
   */
  audit?: AuditTrail;
}

export function createToolContext(
  catalog: Catalog,
  rules: RuleEngine,
  options: { session?: EstimateSession; client?: PlatformApiClient; audit?: AuditTrail } = {},
): ToolContext {
  return {
    catalog,
    rules,
    session: options.session ?? new EstimateSession(catalog),
    ...(options.client ? { client: options.client } : {}),
    ...(options.audit ? { audit: options.audit } : {}),
    approval: { granted: false },
  };
}

// ---------------------------------------------------------------------------
// 3.A — Salt-okunur katalog tool'lari (cache'ten, yazma yok)
// ---------------------------------------------------------------------------

export const catalogTools = {
  listServices(ctx: ToolContext) {
    return SERVICE_CODES.map((code) => ({
      code,
      title: SERVICE_TITLES[code],
      productCount: ctx.catalog.search('', undefined).filter(() => true).length,
    })).map(({ code, title }) => ({ code, title }));
  },

  searchProducts(ctx: ToolContext, input: { query?: string; service?: string; limit?: number }) {
    const results = ctx.catalog.search(input.query ?? '', input.service);
    const currency = ctx.session.read().currency;
    return results.slice(0, input.limit ?? 50).map((p) => ({
      productCode: p.productCode,
      productName: p.productName,
      service: p.service,
      price: p.prices.find((x) => x.currency === currency)?.price,
      pricingUnit: p.prices.find((x) => x.currency === currency)?.pricingUnit,
      currency,
    }));
  },

  searchFlavors(ctx: ToolContext, input: { minVcpu?: number; minRamGb?: number; gpu?: boolean; limit?: number }) {
    const currency = ctx.session.read().currency;
    const filter: { minVcpu?: number; minRamGb?: number; gpu?: boolean } = {};
    if (input.minVcpu !== undefined) filter.minVcpu = input.minVcpu;
    if (input.minRamGb !== undefined) filter.minRamGb = input.minRamGb;
    if (input.gpu !== undefined) filter.gpu = input.gpu;

    return ctx.catalog
      .searchFlavors(filter)
      .slice(0, input.limit ?? 50)
      .map((f) => ({
        // Onemli: flavor.id DOGRUDAN productCode olarak kullanilir.
        productCode: f.id,
        name: f.name,
        vcpus: f.vcpus,
        ramGb: f.ram / 1024,
        gpus: f.vgpus,
        family: f.computeFamily,
        price: ctx.catalog.priceOf(f.id, currency),
        currency,
      }));
  },

  listVolumeTypes(ctx: ToolContext) {
    const currency = ctx.session.read().currency;
    return ctx.catalog.volumeTypes.map((v) => ({
      productCode: v.productCode,
      name: v.name,
      price: ctx.catalog.priceOf(v.productCode, currency),
      currency,
    }));
  },
} as const;

// ---------------------------------------------------------------------------
// 3.B — Yerel state tool'lari (platforma YAZMAZ)
// ---------------------------------------------------------------------------

export const estimateTools = {
  create(ctx: ToolContext, input: { name?: string; currency?: string }) {
    if (input.name !== undefined) ctx.session.setName(input.name);
    if (input.currency !== undefined) {
      ctx.session.setCurrency(CurrencySchema.parse(input.currency));
    }
    return ctx.session.read();
  },

  addItem(ctx: ToolContext, input: { service: string; data: unknown }) {
    const service = ServiceCodeSchema.parse(input.service);
    // Gecersiz productCode BURADA reddedilir — sessiz sifirin ilk savunma hatti.
    return ctx.session.addItem(service, input.data);
  },

  updateItem(ctx: ToolContext, input: { itemId: string; patch: Record<string, unknown> }) {
    return ctx.session.updateItem(input.itemId, input.patch);
  },

  removeItem(ctx: ToolContext, input: { itemId: string }) {
    return ctx.session.removeItem(input.itemId);
  },

  read(ctx: ToolContext) {
    return ctx.session.read();
  },

  undo(ctx: ToolContext) {
    const undone = ctx.session.undo();
    return { undone, state: ctx.session.read() };
  },
} as const;

export const priceTools = {
  /** Tutar uretmenin TEK yolu. Ajanin kendi aritmetigi yasak. */
  calculate(ctx: ToolContext) {
    const state = ctx.session.read();
    const totals = serviceTotals(
      { products: ctx.catalog.products },
      { currency: state.currency, list: state.list as { service: ServiceCode; data: unknown }[] },
    );
    return {
      currency: state.currency,
      totalHourCost: totals.totalHourCost,
      totalMonthCost: totals.totalMonthCost,
      lines: totals.lines,
    };
  },
} as const;

export const validateTools = {
  /** Kural motorunu calistirir — LLM yok, deterministik. */
  check(ctx: ToolContext): ValidationReport {
    const state = ctx.session.read();
    return ctx.rules.check({ currency: state.currency, list: state.list });
  },
} as const;

// ---------------------------------------------------------------------------
// 3.C — Yayinlama tool'lari (HITL kapisi arkasinda)
// ---------------------------------------------------------------------------

export const approvalTools = {
  /**
   * Insan onayini kaydeder. Bunu YALNIZCA orchestrator, satisci onay ekranindan
   * gectikten sonra cagirmali; ajan kendi kendine cagirmamali.
   */
  grant(ctx: ToolContext, input: { approvedBy: string }) {
    const report = validateTools.check(ctx);
    // Cozulmemis blocker varken onay dahi alinamaz — onay ekrani zaten kapali olmali.
    if (!report.publishable) throw new BlockersPresentError(report);
    ctx.approval = { granted: true, grantedBy: input.approvedBy, at: new Date().toISOString() };
    return { granted: true, approvedBy: input.approvedBy };
  },

  revoke(ctx: ToolContext) {
    ctx.approval = { granted: false };
    return { granted: false };
  },
} as const;

export const publishTools = {
  /**
   * Teklifi platforma kaydeder.
   *
   * UC KAPI, sirasiyla:
   *   1. `dryRun` VARSAYILAN true — gercek yazma acik parametre ister
   *   2. Cozulmemis blocker varsa reddedilir
   *   3. HITL onayi yoksa reddedilir
   *
   * Backend hicbir dogrulama yapmiyor; ne gonderirsek sakliyor. Kapilar burada.
   */
  async save(ctx: ToolContext, input: { dryRun?: boolean } = {}) {
    const dryRun = input.dryRun ?? true;
    const estimate = ctx.session.toEstimate();
    const report = validateTools.check(ctx);
    const price = priceTools.calculate(ctx);

    if (!report.publishable) throw new BlockersPresentError(report);

    if (dryRun) {
      return {
        dryRun: true as const,
        wouldSave: estimate,
        totals: { totalHourCost: price.totalHourCost, totalMonthCost: price.totalMonthCost },
        shareUrl: PlatformApiClient.shareUrl(estimate.id),
        note: 'Kaydedilmedi. Gercek yazma icin dryRun:false ve insan onayi gerekir.',
      };
    }

    if (!ctx.approval.granted) {
      throw new ApprovalRequiredError(
        'publish.save',
        'insan onayi (HITL) alinmamis. Once onay ekrani gosterilip approval.grant cagrilmali.',
      );
    }

    if (!ctx.client) {
      throw new Error('publish.save icin API istemcisi yapilandirilmamis.');
    }

    const response = await ctx.client.saveEstimate(estimate);
    return {
      dryRun: false as const,
      saved: true,
      estimateId: estimate.id,
      shareUrl: PlatformApiClient.shareUrl(estimate.id),
      approvedBy: ctx.approval.grantedBy,
      response,
    };
  },
} as const;

// ---------------------------------------------------------------------------
// MCP tool tanimlari (girdi semalari)
// ---------------------------------------------------------------------------

export const TOOL_SCHEMAS = {
  'catalog.listServices': z.object({}),
  'catalog.searchProducts': z.object({
    query: z.string().optional(),
    service: z.string().optional(),
    limit: z.number().int().positive().optional(),
  }),
  'catalog.searchFlavors': z.object({
    minVcpu: z.number().int().positive().optional(),
    minRamGb: z.number().positive().optional(),
    gpu: z.boolean().optional(),
    limit: z.number().int().positive().optional(),
  }),
  'catalog.listVolumeTypes': z.object({}),

  'estimate.create': z.object({
    name: z.string().optional(),
    currency: CurrencySchema.optional(),
  }),
  'estimate.addItem': z.object({
    service: ServiceCodeSchema,
    data: z.unknown(),
  }),
  'estimate.updateItem': z.object({
    itemId: z.string(),
    patch: z.record(z.unknown()),
  }),
  'estimate.removeItem': z.object({ itemId: z.string() }),
  'estimate.read': z.object({}),
  'estimate.undo': z.object({}),

  'price.calculate': z.object({}),
  'validate.check': z.object({}),

  'approval.grant': z.object({ approvedBy: z.string().min(1) }),
  'approval.revoke': z.object({}),
  'publish.save': z.object({ dryRun: z.boolean().optional() }),
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;

/** Yan etkisi olan tool'lar — loglama ve denetim izi icin isaretli. */
export const MUTATING_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  'estimate.create',
  'estimate.addItem',
  'estimate.updateItem',
  'estimate.removeItem',
  'estimate.undo',
  'approval.grant',
  'approval.revoke',
  'publish.save',
]);

/** Platforma YAZAN tool'lar — HITL zorunlu. */
export const WRITING_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>(['publish.save']);

/**
 * Tool cagrisinin TEK giris noktasi.
 *
 * FAZ 7.B: denetim izi buraya baglandi — hicbir cagri kayit disi kalmasin.
 * Sema dogrulamasi HATASI da reddedilme sayilir; sayac "ajan kac kez gecersiz
 * cagri yapti" sorusunu tam yanitlamali.
 */
export async function callTool(ctx: ToolContext, name: ToolName, rawInput: unknown): Promise<unknown> {
  try {
    const result = await dispatchTool(ctx, name, rawInput);
    ctx.audit?.toolCall(name, rawInput);
    return result;
  } catch (error) {
    const e = error as Error;
    ctx.audit?.toolRejected(name, rawInput, e.name, e.message);
    throw error;
  }
}

async function dispatchTool(ctx: ToolContext, name: ToolName, rawInput: unknown): Promise<unknown> {
  const input = TOOL_SCHEMAS[name].parse(rawInput ?? {}) as never;

  switch (name) {
    case 'catalog.listServices':
      return catalogTools.listServices(ctx);
    case 'catalog.searchProducts':
      return catalogTools.searchProducts(ctx, input);
    case 'catalog.searchFlavors':
      return catalogTools.searchFlavors(ctx, input);
    case 'catalog.listVolumeTypes':
      return catalogTools.listVolumeTypes(ctx);

    case 'estimate.create':
      return estimateTools.create(ctx, input);
    case 'estimate.addItem':
      return estimateTools.addItem(ctx, input);
    case 'estimate.updateItem':
      return estimateTools.updateItem(ctx, input);
    case 'estimate.removeItem':
      return estimateTools.removeItem(ctx, input);
    case 'estimate.read':
      return estimateTools.read(ctx);
    case 'estimate.undo':
      return estimateTools.undo(ctx);

    case 'price.calculate':
      return priceTools.calculate(ctx);
    case 'validate.check':
      return validateTools.check(ctx);

    case 'approval.grant':
      return approvalTools.grant(ctx, input);
    case 'approval.revoke':
      return approvalTools.revoke(ctx);
    case 'publish.save':
      return publishTools.save(ctx, input);
  }
}
