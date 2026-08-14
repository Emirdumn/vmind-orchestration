/**
 * FAZ 3.B — Yerel teklif state'i
 *
 * Ajanin uzerinde calistigi teklif BURADA yasar; platforma yazilmaz.
 * Platforma yazma yalnizca `publish.save` ile ve insan onayindan sonra olur.
 *
 * Kabul kriteri geregi tum mutasyonlar UNDO LOG uzerinden geri alinabilir:
 * ajan yanlis bir kalem eklerse tur icinde geri alinabilmeli, satisciya
 * "bastan basla" dedirtmemeli.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import {
  DATA_SCHEMA_BY_SERVICE,
  type Currency,
  type Estimate,
  type ServiceCode,
} from '../schema/estimate.js';
import { Catalog, UnknownProductCodeError } from '../catalog/catalog.js';
import { collectProductCodes } from '../rules/engine.js';

export interface EstimateItemRecord {
  id: string;
  service: ServiceCode;
  data: Record<string, unknown>;
}

export interface EstimateState {
  id: string;
  name: string;
  currency: Currency;
  list: EstimateItemRecord[];
}

/** Undo log girdisi — her mutasyon oncesi tam state anlik goruntusu. */
interface UndoEntry {
  operation: string;
  before: EstimateState;
}

export class ItemNotFoundError extends Error {
  constructor(itemId: string) {
    super(`"${itemId}" kimlikli kalem teklifte yok.`);
    this.name = 'ItemNotFoundError';
  }
}

export class SchemaValidationError extends Error {
  constructor(
    readonly service: ServiceCode,
    readonly issues: z.ZodIssue[],
  ) {
    const detail = issues.map((i) => `${i.path.join('.') || '(kok)'}: ${i.message}`).join('; ');
    super(`"${service}" kalemi sema dogrulamasindan gecmedi — ${detail}`);
    this.name = 'SchemaValidationError';
  }
}

export class EstimateSession {
  private state: EstimateState;
  private readonly undoLog: UndoEntry[] = [];

  constructor(
    private readonly catalog: Catalog,
    options: { name?: string; currency?: Currency; id?: string } = {},
  ) {
    this.state = {
      id: options.id ?? randomUUID(),
      name: options.name ?? 'My Estimate',
      currency: options.currency ?? 'TL',
      list: [],
    };
  }

  /** Derin kopya — disariya verilen state degistirilerek ic state bozulamasin. */
  read(): EstimateState {
    return structuredClone(this.state);
  }

  /** Platforma gonderilecek bicim (lookup/undo gibi yerel alanlar haric). */
  toEstimate(): Estimate {
    return structuredClone(this.state) as Estimate;
  }

  get itemCount(): number {
    return this.state.list.length;
  }

  private snapshot(operation: string): void {
    this.undoLog.push({ operation, before: structuredClone(this.state) });
  }

  /**
   * Kalem verisini dogrular. IKI asamali ve sirasi onemli:
   *   1. Sema — alan/tip/birim dogru mu
   *   2. Katalog — her productCode GERCEKTEN var mi
   * Ikincisi olmadan ajanin uydurdugu bir kod sessizce 0 TL olarak teklife girer.
   */
  private validateData(service: ServiceCode, data: unknown): Record<string, unknown> {
    const schema = DATA_SCHEMA_BY_SERVICE[service];
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new SchemaValidationError(service, parsed.error.issues);

    const validated = parsed.data as Record<string, unknown>;
    for (const code of collectProductCodes(validated)) {
      if (!this.catalog.has(code)) throw new UnknownProductCodeError(code);
      // Secili para biriminde fiyati yoksa platformun hesaplayicisi coker.
      this.catalog.assertPriceable(code, this.state.currency);
    }
    return validated;
  }

  setName(name: string): EstimateState {
    this.snapshot('setName');
    this.state.name = name;
    return this.read();
  }

  /**
   * Para birimini degistirir. Mevcut kalemlerdeki tum urunlerin YENI para biriminde
   * fiyati olmali; yoksa platform coker, bu yuzden onceden reddedilir.
   */
  setCurrency(currency: Currency): EstimateState {
    for (const item of this.state.list) {
      for (const code of collectProductCodes(item.data)) {
        this.catalog.assertPriceable(code, currency);
      }
    }
    this.snapshot('setCurrency');
    this.state.currency = currency;
    return this.read();
  }

  addItem(service: ServiceCode, data: unknown): EstimateItemRecord {
    const validated = this.validateData(service, data);
    this.snapshot('addItem');
    const item: EstimateItemRecord = { id: randomUUID(), service, data: validated };
    this.state.list.push(item);
    return structuredClone(item);
  }

  /** Kismi guncelleme; birlestirilmis sonuc yeniden dogrulanir. */
  updateItem(itemId: string, patch: Record<string, unknown>): EstimateItemRecord {
    const index = this.state.list.findIndex((i) => i.id === itemId);
    if (index === -1) throw new ItemNotFoundError(itemId);
    const existing = this.state.list[index]!;

    // `undefined` bir alani bilincli olarak KALDIRMA semantigidir. Zod optional
    // alanlari `key: undefined` halinde koruyabildigi icin filtreleme burada
    // yapilmazsa fiyat motoru etkilenmese bile platform JSON'una hayalet alanlar
    // sizabilir ve topoloji uzlastirmasi gercek bir tasima yapmis olmaz.
    const merged = Object.fromEntries(
      Object.entries({ ...existing.data, ...patch }).filter(([, value]) => value !== undefined),
    );
    const validated = this.validateData(existing.service, merged);

    this.snapshot('updateItem');
    const updated: EstimateItemRecord = { ...existing, data: validated };
    this.state.list[index] = updated;
    return structuredClone(updated);
  }

  removeItem(itemId: string): EstimateItemRecord {
    const index = this.state.list.findIndex((i) => i.id === itemId);
    if (index === -1) throw new ItemNotFoundError(itemId);
    this.snapshot('removeItem');
    const [removed] = this.state.list.splice(index, 1);
    return structuredClone(removed!);
  }

  /** Son mutasyonu geri alir. Geri alinacak bir sey yoksa false doner. */
  undo(): boolean {
    const entry = this.undoLog.pop();
    if (!entry) return false;
    this.state = entry.before;
    return true;
  }

  /** Geri alinabilir islemlerin listesi (en yeni sonda). */
  undoHistory(): string[] {
    return this.undoLog.map((e) => e.operation);
  }
}
