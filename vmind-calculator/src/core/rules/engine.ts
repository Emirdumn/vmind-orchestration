/**
 * FAZ 4 — Kural motoru
 *
 * "Object storage dedin ama data transfer yok" diyen katman. Projenin asil degeri.
 *
 * TAMAMEN DETERMINISTIK: LLM yok, ag yok, rastgelelik yok. Ayni teklif her zaman
 * ayni Gap listesini uretir. Ajan bu ciktiya guvenir; ureteceginden degil.
 */
import { parse as parseYaml } from 'yaml';
import { evaluateExpression, parseExpression } from './expr.js';
import { buildReport, type Gap, type Rule, type ValidationReport } from './types.js';
import type { Catalog } from '../catalog/catalog.js';
import type { Currency, ServiceCode } from '../schema/estimate.js';
import { calculateService, type PricingContext } from '../pricing/engine.js';

export interface EstimateItemLike {
  id: string;
  service: ServiceCode;
  data: Record<string, unknown>;
}

export interface EstimateLike {
  currency: Currency;
  list: EstimateItemLike[];
}

export class RuleSyntaxError extends Error {
  constructor(ruleId: string, cause: string) {
    super(`Kural "${ruleId}" yuklenemedi: ${cause}`);
    this.name = 'RuleSyntaxError';
  }
}

/** Bir kalemin icindeki TUM productCode alanlarini (ic ice dahil) toplar. */
export function collectProductCodes(data: unknown, found: string[] = []): string[] {
  if (data === null || typeof data !== 'object') return found;
  if (Array.isArray(data)) {
    for (const entry of data) collectProductCodes(entry, found);
    return found;
  }
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (key === 'productCode' && typeof value === 'string') found.push(value);
    else collectProductCodes(value, found);
  }
  return found;
}

export class RuleEngine {
  private readonly rules: Rule[];

  constructor(
    rules: Rule[],
    private readonly catalog?: Catalog,
  ) {
    for (const rule of rules) {
      if (!rule.id) throw new RuleSyntaxError('(id yok)', 'id alani zorunlu');
      if (!rule.when) throw new RuleSyntaxError(rule.id, '`when` alani zorunlu');
      if (!rule.message) throw new RuleSyntaxError(rule.id, '`message` alani zorunlu');
      if (!['blocker', 'recommended', 'optional'].includes(rule.severity)) {
        throw new RuleSyntaxError(rule.id, `gecersiz severity "${rule.severity}"`);
      }
      // Sozdizimi hatalarini calisma aninda degil YUKLEME aninda yakala.
      try {
        parseExpression(rule.when);
      } catch (error) {
        throw new RuleSyntaxError(rule.id, (error as Error).message);
      }
    }
    this.rules = rules;
  }

  static fromYaml(source: string, catalog?: Catalog): RuleEngine {
    const parsed = parseYaml(source) as { rules?: Rule[] } | Rule[] | null;
    const rules = Array.isArray(parsed) ? parsed : (parsed?.rules ?? []);
    return new RuleEngine(rules, catalog);
  }

  get ruleCount(): number {
    return this.rules.length;
  }

  listRules(): readonly Rule[] {
    return this.rules;
  }

  /** Teklif genelinde kullanilabilen yardimcilar. */
  private estimateScope(estimate: EstimateLike): Record<string, unknown> {
    const items = estimate.list;
    const catalog = this.catalog;

    const itemsOf = (service: string): EstimateItemLike[] => items.filter((i) => i.service === service);

    const pricingCtx = (): PricingContext | undefined =>
      catalog ? { currency: estimate.currency, products: catalog.products } : undefined;

    /** Kalemin aylik tutari. Katalog yoksa undefined. */
    const itemMonthly = (item: EstimateItemLike): number | undefined => {
      const ctx = pricingCtx();
      if (!ctx) return undefined;
      try {
        return calculateService(ctx, item.service, item.data).totalMonthCost;
      } catch {
        return undefined;
      }
    };

    return {
      estimate,
      currency: estimate.currency,
      itemCount: items.length,

      /** Teklifte bu servisten en az bir kalem var mi. */
      has: (service: unknown) => itemsOf(String(service)).length > 0,

      /** Bu servisten kac kalem var (kalem sayisi, instance sayisi degil). */
      count: (service: unknown) => itemsOf(String(service)).length,

      /** compute kalemlerindeki toplam instance adedi. */
      totalComputeCount: () =>
        itemsOf('compute').reduce((sum, i) => sum + (Number(i.data['count']) || 0), 0),

      /** Bagimsiz (standalone) bir servis kalemi var mi — ic ice olan sayilmaz. */
      hasStandalone: (service: unknown) => itemsOf(String(service)).length > 0,

      /** Belirli servisteki herhangi bir kalemde bu alan dolu mu. */
      anyItemHas: (service: unknown, field: unknown) =>
        itemsOf(String(service)).some((i) => {
          const value = i.data[String(field)];
          return value !== undefined && value !== null;
        }),

      /** Teklifin herhangi bir yerinde floating IP var mi (bagimsiz, compute alti veya router alti). */
      anyFloatingIp: () =>
        items.some((i) => {
          if (i.service === 'floating-ip') return true;
          const data = i.data as Record<string, unknown>;
          if (data['floatingIp']) return true;
          const router = data['router'] as Record<string, unknown> | undefined;
          return Boolean(router?.['floatingIp']);
        }),

      /** Teklifin herhangi bir yerinde egress (data transfer) tanimli mi. */
      anyDataTransfer: () =>
        items.some((i) => {
          if (i.service === 'data-transfer') return true;
          const data = i.data as Record<string, unknown>;
          if (data['network']) return true;
          const router = data['router'] as Record<string, unknown> | undefined;
          return Boolean(router?.['network']);
        }),

      /** Teklifin herhangi bir yerinde yedekleme var mi. */
      anyBackup: () =>
        items.some((i) => i.service === 'backup' || Boolean((i.data as Record<string, unknown>)['backup'])),

      /** Teklifin toplam aylik tutari. */
      totalMonthly: () => items.reduce((sum, i) => sum + (itemMonthly(i) ?? 0), 0),
    };
  }

  /** Kalem bazli kurallara ek yardimcilar. */
  private itemScope(item: EstimateItemLike, estimate: EstimateLike): Record<string, unknown> {
    const catalog = this.catalog;

    return {
      ...this.estimateScope(estimate),
      item,
      service: item.service,
      data: item.data,

      /** Bu kalemin aylik tutari (katalog yoksa undefined). */
      itemMonthly: () => {
        if (!catalog) return undefined;
        try {
          return calculateService(
            { currency: estimate.currency, products: catalog.products },
            item.service,
            item.data,
          ).totalMonthCost;
        } catch {
          return undefined;
        }
      },

      /**
       * Bu kalemde katalogda BULUNMAYAN bir productCode var mi.
       * Motor boyle bir kodu sessizce 0 TL gecer — en tehlikeli sessiz hata.
       */
      hasUnknownProductCode: () => {
        if (!catalog) return false;
        return collectProductCodes(item.data).some((code) => !catalog.has(code));
      },

      /** Bu kalemdeki bilinmeyen kodlarin listesi (mesajda kullanmak icin degil, testte). */
      unknownProductCodes: () => {
        if (!catalog) return [];
        return collectProductCodes(item.data).filter((code) => !catalog.has(code));
      },
    };
  }

  /** Teklifi denetler ve Gap listesi uretir. */
  check(estimate: EstimateLike): ValidationReport {
    const gaps: Gap[] = [];

    for (const rule of this.rules) {
      const scope = rule.scope ?? 'item';

      if (scope === 'estimate') {
        if (this.matches(rule, this.estimateScope(estimate))) {
          gaps.push(this.toGap(rule));
        }
        continue;
      }

      for (const item of estimate.list) {
        if (rule.services && !rule.services.includes(item.service)) continue;
        if (this.matches(rule, this.itemScope(item, estimate))) {
          gaps.push(this.toGap(rule, item));
        }
      }
    }

    return buildReport(gaps);
  }

  private matches(rule: Rule, scope: Record<string, unknown>): boolean {
    try {
      return Boolean(evaluateExpression(rule.when, scope));
    } catch (error) {
      // Bir kuralin patlamasi tum denetimi durdurmamali; kural hatasi olarak yuzeye cikar.
      throw new RuleSyntaxError(rule.id, (error as Error).message);
    }
  }

  private toGap(rule: Rule, item?: EstimateItemLike): Gap {
    return {
      ruleId: rule.id,
      severity: rule.severity,
      message: rule.message,
      ...(rule.ask !== undefined ? { ask: rule.ask } : {}),
      ...(rule.default !== undefined ? { default: rule.default } : {}),
      ...(item ? { itemId: item.id, service: item.service } : {}),
    };
  }
}
