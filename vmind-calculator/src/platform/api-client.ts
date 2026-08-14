/**
 * FAZ 0.B/0.C — Platform API istemcisi
 *
 * KIMLIK DOGRULAMA BULGUSU (bkz. docs/auth.md):
 * Calculator kullanici girisi YAPMIYOR. Uretim bundle'i her istege sabit bir
 * anahtar ekliyor:
 *
 *   axios.interceptors.request.use(cfg => {
 *     cfg.headers.set("X-Lang", cookie.get("APP_LANG"));
 *     cfg.headers.Authorization = "Bearer " + appConfig.apiKey;   // bundle'da gomulu
 *   })
 *
 * Yani `billing/products`, `compute/flavors`, `compute/volume-types` ve
 * `billing/estimateplan` icin AYRI BIR TEST HESABI GEREKMIYOR.
 * PLAN.md'deki "test hesabi gecikirse Faz 0.B+ bloke" riski katalog tarafinda dustu.
 * (`billing/account` gibi hesaba ozel uclar icin hala gerekebilir.)
 *
 * Anahtar gizli degil: calculator.portvmind.com'u acan herkesin tarayicisina
 * gonderiliyor. Yine de env ile gecersiz kilinabilir birakildi.
 */
import type { ApiEnvelope, Flavor, Product, VolumeType } from '../core/catalog/types.js';

/** Bundle'daki `appConfig.wsUrl` + "/api/v1" */
const DEFAULT_BASE_URL = 'https://tr-ist-01-api.portvmind.com/api/v1';

/** Bundle'daki `appConfig.apiKey` — herkese acik olarak servis ediliyor. */
const BUNDLE_API_KEY = '$2a$11$pXDEqHtbrZ/CXZv9Z8fd5OveBQZm2HO9cfEtq4k9LCsQqgjnf/Dw.';

export interface ApiClientOptions {
  baseUrl?: string;
  apiKey?: string;
  /** "tr" | "en" — platformun X-Lang basligi. */
  lang?: string;
  timeoutMs?: number;
  /**
   * Yazma islemleri (teklif kaydetme) varsayilan olarak KAPALI.
   * PLAN 3.C: `dry_run: true` varsayilan; gercek yazma acik parametre gerektirir.
   */
  allowWrites?: boolean;
}

export class PlatformApiError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${path} -> HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = 'PlatformApiError';
  }
}

export class WriteNotAllowedError extends Error {
  constructor(operation: string) {
    super(
      `${operation} engellendi: istemci salt-okunur modda. ` +
        `Gercek yazma icin allowWrites:true gerekir ve bu yalnizca insan onayindan (HITL) sonra verilir.`,
    );
    this.name = 'WriteNotAllowedError';
  }
}

export class PlatformApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly lang: string;
  private readonly timeoutMs: number;
  private readonly allowWrites: boolean;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? process.env['VMIND_API_BASE_URL'] ?? DEFAULT_BASE_URL;
    this.apiKey = options.apiKey ?? process.env['VMIND_API_KEY'] ?? BUNDLE_API_KEY;
    this.lang = options.lang ?? process.env['VMIND_LANG'] ?? 'tr';
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.allowWrites = options.allowWrites ?? false;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'X-Lang': this.lang,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const text = await response.text();
    if (!response.ok) throw new PlatformApiError(path, response.status, text);

    const json = JSON.parse(text) as { result?: { success?: boolean; message?: string | null } };
    // Platform 200 dondurup govdede basarisizlik bildirebiliyor.
    if (json.result && json.result.success === false) {
      throw new PlatformApiError(path, response.status, json.result.message ?? 'result.success = false');
    }
    return json as T;
  }

  getProducts(): Promise<ApiEnvelope<Product>> {
    return this.request<ApiEnvelope<Product>>('/billing/products');
  }

  getFlavors(): Promise<ApiEnvelope<Flavor>> {
    return this.request<ApiEnvelope<Flavor>>('/compute/flavors');
  }

  getVolumeTypes(): Promise<ApiEnvelope<VolumeType>> {
    return this.request<ApiEnvelope<VolumeType>>('/compute/volume-types');
  }

  /** Kaydedilmis teklifi geri okur — Reconciler (Faz 5.C) bunu kullanir. */
  getEstimate(id: string): Promise<unknown> {
    return this.request(`/billing/estimateplan/${encodeURIComponent(id)}`);
  }

  /**
   * Teklifi platforma yazar. Backend hicbir DOGRULAMA YAPMAZ — ne gonderirsek saklar.
   * Bu yuzden cagrilmadan once kural motorunun (Faz 4) temiz raporu ve HITL onayi sart.
   */
  async saveEstimate(estimate: { id: string }): Promise<unknown> {
    if (!this.allowWrites) throw new WriteNotAllowedError('saveEstimate');
    return this.request('/billing/estimateplan', {
      method: 'POST',
      body: JSON.stringify({ key: estimate.id, json: JSON.stringify(estimate) }),
    });
  }

  /**
   * Paylasim linki. Bundle'daki `PrintView`'dan birebir:
   *   `${appConfig.calculatorUrl}/my-estimate/${input.data.id}`
   * Tarayici GEREKMEZ — kaydettikten sonra link saf API ile uretilebilir.
   */
  static shareUrl(estimateId: string, calculatorUrl = 'https://calculator.portvmind.com'): string {
    return `${calculatorUrl}/my-estimate/${estimateId}`;
  }
}
