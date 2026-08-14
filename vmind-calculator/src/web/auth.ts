/**
 * Kimlik doğrulama katmanı — takılabilir.
 *
 * ## Neden seam, neden hemen VMind SSO değil
 *
 * Keşif sonucu (2026-07-30, konsol bundle'ından): VMind konsolu şöyle giriyor
 *
 *   POST /auth/signin  + header `X-Turnstile-Token`   ← Cloudflare Turnstile (CAPTCHA)
 *   POST /auth/mfa                                     ← ikinci faktör
 *   sonra: Authorization: "Bearer " + localStorage.USER_INFO.token
 *
 * Yani bir sunucunun kullanıcı adı/şifreyle arka planda giriş yapması mümkün
 * değil — CAPTCHA tam olarak bunu engellemek için var ve aşılmaya çalışılmaz.
 *
 * Doğru mekanizma platformda MEVCUT: `/api/access` sayfası Application
 * Credential üretiyor (`POST /iam/application-credentials`) ve `accessRules`
 * ile kimlik bilgisi tek tek uca kısıtlanabiliyor:
 *
 *   { name, description, secret, expiresAt, unrestricted, roleIds,
 *     accessRules: [{ service, method, path }] }
 *
 * Eksik olan tek şey: bu kimlik bilgisini token'a çevirme ucu konsol
 * bundle'ında GÖRÜNMÜYOR (konsolun kendisi şifreyle giriyor). Keystone bunu
 * native destekler; `tr-ist-01-api.portvmind.com` üzerinde açık mı, VMind'a
 * sorulmalı. Açıksa `VmindAppCredentialProvider` yazılacak yer burası.
 *
 * O yüzden bu dosya bir ARAYÜZ tanımlar ve iki uygulama sunar. Mekanizma
 * netleştiğinde değişen tek şey bu dosya olur — sunucu ve arayüz aynı kalır.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Akışı başlatan kişi. `userId` denetim izine ve harcama defterine gider. */
export interface Identity {
  /** Kararlı, kişiye özel kimlik. Harcama sayacının anahtarı. */
  userId: string;
  /** Onay ekranında ve izde görünen ad. */
  displayName: string;
  /**
   * VMind'a bu kişi adına istek atmak için kullanılacak token.
   * Yoksa sunucu bundle'ın public anahtarını kullanır (yalnızca katalog/okuma).
   * ⛔ Loglanmaz, denetim izine yazılmaz, tarayıcıya geri gönderilmez.
   */
  vmindToken?: string;
  // Servis hesaplarini insan oturumlarindan ayiran sunucu-ici isaret.
  actorType?: 'service';
  // Servis hesabinin kalici VMind teklifi olusturma yetkisi.
  canPublish?: boolean;
}

export interface LoginResult {
  identity: Identity;
  /** Tarayıcıya çerez olarak verilecek oturum anahtarı. */
  sessionToken: string;
}

export interface AuthProvider {
  /** Arayüzde gösterilecek ad ve giriş formunun şekli. */
  readonly kind: 'shared-secret' | 'vmind-token' | 'public-guest' | 'disabled';
  /** Giriş formunda ne isteneceğini arayüze anlatır. */
  readonly loginFields: ReadonlyArray<{ name: string; label: string; secret: boolean }>;
  /** Girişi dener. Başarısızsa `null` — sebep söylenmez (kullanıcı sayımı yapılmasın). */
  login(input: Record<string, string>): Promise<LoginResult | null>;
  /** Oturum anahtarından kimliği çözer. `null` = yetkisiz. */
  resolve(sessionToken: string | undefined): Identity | null;
  /** Oturumu kapatır. */
  logout(sessionToken: string): void;
}

// ---------------------------------------------------------------------------
// 3) Public ziyaretçi — şifresiz ama kişi ve kota ayrımı korunur
// ---------------------------------------------------------------------------

/**
 * Müşteri-facing site için otomatik, rastgele ziyaretçi oturumu.
 *
 * Bu `disabled` modu değildir: her tarayıcı ayrı, iptal edilebilir bir HttpOnly
 * oturum ve ayrı kota anahtarı alır. Cookie silerek yeni kimlik alınabilir;
 * bunun maliyet sınırını aşması `PublicAccessGuard` IP-hash akış limitiyle
 * engellenir. Ham IP bu sağlayıcıya veya PostgreSQL'e hiç verilmez.
 */
export class PublicGuestAuthProvider implements AuthProvider {
  readonly kind = 'public-guest' as const;
  readonly loginFields = [] as const;
  private readonly store: SessionStore;

  constructor(options: { sessionTtlMs?: number } = {}) {
    this.store = new SessionStore(options.sessionTtlMs ?? 24 * 60 * 60 * 1000);
  }

  async login(_input: Record<string, string> = {}): Promise<LoginResult> {
    const suffix = randomBytes(16).toString('hex');
    const identity: Identity = {
      userId: `guest:${suffix}`,
      displayName: 'Ziyaretçi',
    };
    return { identity, sessionToken: this.store.create(identity) };
  }

  resolve(sessionToken: string | undefined): Identity | null {
    return this.store.resolve(sessionToken);
  }

  logout(sessionToken: string): void {
    this.store.delete(sessionToken);
  }
}

// ---------------------------------------------------------------------------
// Oturum deposu — her iki sağlayıcı da kullanıyor
// ---------------------------------------------------------------------------

interface StoredSession {
  identity: Identity;
  expiresAt: number;
}

/**
 * Bellekte oturum deposu. Sunucu yeniden başlarsa herkes yeniden giriş yapar —
 * bu bilinçli: oturum token'larını diske yazmak, VMind token'ını da diske
 * yazmak demek olurdu.
 */
class SessionStore {
  private readonly sessions = new Map<string, StoredSession>();

  constructor(private readonly ttlMs: number) {}

  create(identity: Identity): string {
    this.sweep();
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, { identity, expiresAt: Date.now() + this.ttlMs });
    return token;
  }

  resolve(token: string | undefined): Identity | null {
    if (!token) return null;
    const found = this.sessions.get(token);
    if (!found) return null;
    if (found.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    return found.identity;
  }

  delete(token: string): void {
    this.sessions.delete(token);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [token, session] of this.sessions) {
      if (session.expiresAt < now) this.sessions.delete(token);
    }
  }

  get size(): number {
    return this.sessions.size;
  }
}

/** Sabit süreli karşılaştırma — şifre uzunluğu üzerinden sızıntı olmasın. */
function secretEquals(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

// ---------------------------------------------------------------------------
// Makineden makineye erisim — OpenClaw / vGPT servis hesabi
// ---------------------------------------------------------------------------

export interface ServiceApiKeyOptions {
  serviceId?: string;
  displayName?: string;
  allowPublish?: boolean;
  previousApiKey?: string;
}

// Tarayici cerezinden bagimsiz, iptal edilebilir Bearer anahtari.
// Anahtar yalnizca ortam degiskeninde tutulur; istemciye geri donmez ve
// loglanmaz. Paylasilan insan sifresinden ayri oldugu icin sizarsa tek basina
// iptal edilip yenilenebilir.
export class ServiceApiKeyAuth {
  readonly identity: Identity;
  private readonly apiKeys: string[];

  constructor(apiKey: string, options: ServiceApiKeyOptions = {}) {
    const key = apiKey.trim();
    if (key.length < 32 || key.length > 512 || /\s/.test(key)) {
      throw new Error('WEB_SERVICE_API_KEY 32-512 karakterlik, bosluksuz bir anahtar olmali.');
    }
    const serviceId = (options.serviceId ?? 'openclaw').trim();
    const displayName = (options.displayName ?? 'OpenClaw WhatsApp').trim();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(serviceId)) {
      throw new Error('WEB_SERVICE_ID yalnizca harf, rakam, nokta, alt cizgi ve tire icerebilir.');
    }
    if (displayName.length === 0 || displayName.length > 80) {
      throw new Error('WEB_SERVICE_NAME 1-80 karakter olmali.');
    }
    const previous = options.previousApiKey?.trim();
    if (previous && (previous.length < 32 || previous.length > 512 || /\s/.test(previous))) {
      throw new Error('WEB_SERVICE_API_KEY_PREVIOUS 32-512 karakterlik, bosluksuz bir anahtar olmali.');
    }
    this.apiKeys = [...new Set([key, ...(previous ? [previous] : [])])];
    this.identity = {
      userId: `service:${serviceId.toLowerCase()}`,
      displayName,
      actorType: 'service',
      canPublish: options.allowPublish === true,
    };
  }

  resolve(authorization: string | string[] | undefined): Identity | null {
    if (typeof authorization !== 'string') return null;
    const match = /^Bearer ([^\s]+)$/i.exec(authorization);
    if (!match?.[1] || !this.apiKeys.some((apiKey) => secretEquals(match[1]!, apiKey))) return null;
    return this.identity;
  }
}

export function serviceApiKeyAuthFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ServiceApiKeyAuth | undefined {
  const key = (env['WEB_SERVICE_API_KEY'] ?? '').trim();
  if (!key) return undefined;
  return new ServiceApiKeyAuth(key, {
    serviceId: (env['WEB_SERVICE_ID'] ?? 'openclaw').trim(),
    displayName: (env['WEB_SERVICE_NAME'] ?? 'OpenClaw WhatsApp').trim(),
    allowPublish: env['WEB_SERVICE_ALLOW_PUBLISH'] === '1',
    previousApiKey: env['WEB_SERVICE_API_KEY_PREVIOUS'],
  });
}

// ---------------------------------------------------------------------------
// 1) Paylaşılan şifre — yalnızca yerel geliştirme / iç ağ
// ---------------------------------------------------------------------------

/**
 * Adı verilen kullanıcı + tek ortak şifre.
 *
 * Kişi ayrımı VAR (harcama sayacı ve denetim izi çalışsın diye) ama şifre
 * ortak — yani gerçek bir kimlik doğrulaması değil, kişinin kendi adını
 * bildirmesi. İç ağda veya yerel geliştirmede yeterli, internete açık
 * kurulumda değil. `requireStrongAuth` bunu zorlar.
 */
export class SharedSecretAuthProvider implements AuthProvider {
  readonly kind = 'shared-secret' as const;
  readonly loginFields = [
    { name: 'displayName', label: 'Adınız', secret: false },
    { name: 'password', label: 'Ortak şifre', secret: true },
  ] as const;

  private readonly store: SessionStore;

  constructor(
    private readonly password: string,
    options: { sessionTtlMs?: number } = {},
  ) {
    if (password.length < 12) {
      throw new Error(
        'WEB_SHARED_PASSWORD en az 12 karakter olmalı. Kısa bir ortak şifre, ' +
          'LLM anahtarının önündeki tek kapı olduğu için kabul edilmiyor.',
      );
    }
    this.store = new SessionStore(options.sessionTtlMs ?? 12 * 60 * 60 * 1000);
  }

  async login(input: Record<string, string>): Promise<LoginResult | null> {
    const displayName = (input['displayName'] ?? '').trim();
    const password = input['password'] ?? '';
    if (displayName.length === 0 || displayName.length > 80) return null;
    if (!secretEquals(password, this.password)) return null;

    const identity: Identity = {
      // Ortak şifrede kişi kendi adını bildirir; kimlik bunun normalize hali.
      //
      // ⛔ `toLocaleLowerCase('tr')` KULLANILMAZ. Türkçe'de 'I' → 'ı' (noktasız)
      // olduğu için "EMIR" → "emır", "Emir" → "emir" olur; aynı kişi büyük
      // harfle yazdığında AYRI bir harcama sayacına düşer ve kişi başı sınır
      // atlatılabilir. Bu bir kimlik anahtarı, görüntülenecek metin değil —
      // yerelden bağımsız küçültme doğrusu. Görünen ad orijinal haliyle kalır.
      userId: `shared:${displayName.toLowerCase()}`,
      displayName,
    };
    return { identity, sessionToken: this.store.create(identity) };
  }

  resolve(sessionToken: string | undefined): Identity | null {
    return this.store.resolve(sessionToken);
  }

  logout(sessionToken: string): void {
    this.store.delete(sessionToken);
  }
}

// ---------------------------------------------------------------------------
// 2) VMind konsol token'ı — gerçek kimlik VMind'dan gelir
// ---------------------------------------------------------------------------

export interface VmindTokenAuthOptions {
  /** Token'ı doğrulamak için çağrılacak hesaba özel uç. */
  probeUrl?: string;
  sessionTtlMs?: number;
  /** Test için enjekte edilebilir. */
  fetchImpl?: typeof fetch;
}

/**
 * Kullanıcı VMind konsoluna normal yoldan girer (CAPTCHA + MFA tarayıcıda),
 * sonra konsol oturumunun token'ını bu uygulamaya bir kez yapıştırır.
 *
 * Kimlik VMind tarafından doğrulanır: token'la hesaba özel bir uç çağrılır
 * (`/system/user/notifications` — konsol her sayfa yüklemesinde çağırıyor,
 * hafif ve hesaba bağlı). 200 dönerse kişi gerçek bir VMind kullanıcısıdır.
 *
 * Bu, tıklamalı SSO değil — ama kimliğin KAYNAĞI VMind, ve konsoldan çıkış
 * yapmak/token'ın süresi dolmak bu uygulamadaki erişimi de bitirir. Doğrulama
 * bizde değil platformda olduğu için ayrı bir kullanıcı veritabanı gerekmiyor.
 *
 * ⛔ Token sunucuda bellekte kalır; diske yazılmaz, loglanmaz, ize girmez.
 */
export class VmindTokenAuthProvider implements AuthProvider {
  readonly kind = 'vmind-token' as const;
  readonly loginFields = [
    { name: 'token', label: 'VMind konsol token’ı', secret: true },
  ] as const;

  private readonly store: SessionStore;
  private readonly probeUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: VmindTokenAuthOptions = {}) {
    this.probeUrl =
      options.probeUrl ?? 'https://tr-ist-01-api.portvmind.com/api/v1/system/user/notifications';
    this.store = new SessionStore(options.sessionTtlMs ?? 8 * 60 * 60 * 1000);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async login(input: Record<string, string>): Promise<LoginResult | null> {
    const token = (input['token'] ?? '').trim();
    if (token.length < 20 || token.length > 8192) return null;

    let ok = false;
    try {
      const response = await this.fetchImpl(this.probeUrl, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      // Platform "bulunamadı" için de 200 dönebiliyor (bkz. CLAUDE.md), ama
      // YETKISIZ istekte 401/403 döner — doğrulama için bakılan şey bu.
      ok = response.status === 200;
    } catch {
      return null;
    }
    if (!ok) return null;

    const claims = decodeJwtClaims(token);
    const subject =
      pickString(claims, 'email') ?? pickString(claims, 'sub') ?? pickString(claims, 'user_id');

    const identity: Identity = {
      // Subject yoksa token'ın hash'i kullanılır: kim olduğunu bilmesek de
      // KİŞİ BAŞI harcama sayacı çalışmaya devam etsin. (Token yenilenince
      // sayaç sıfırlanır — bilinen sınır, sınırsız olmasından iyi.)
      userId: subject ? `vmind:${subject}` : `vmind-anon:${shortHash(token)}`,
      displayName: subject ?? `VMind kullanıcısı (${shortHash(token).slice(0, 6)})`,
      vmindToken: token,
    };
    return { identity, sessionToken: this.store.create(identity) };
  }

  resolve(sessionToken: string | undefined): Identity | null {
    return this.store.resolve(sessionToken);
  }

  logout(sessionToken: string): void {
    this.store.delete(sessionToken);
  }
}

/**
 * JWT gövdesini okur — YALNIZCA kimlik etiketi için.
 *
 * İmza DOĞRULANMIYOR ve doğrulanmasına gerek yok: token'ın geçerliliği
 * platformun 200 dönmesiyle kanıtlandı. Buradaki tek amaç sayaç ve iz için
 * okunabilir bir ad çıkarmak. Token JWT değilse `null` döner ve hash'e düşülür.
 */
function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = Buffer.from(parts[1] ?? '', 'base64url').toString('utf8');
    const parsed = JSON.parse(payload) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function pickString(claims: Record<string, unknown> | null, key: string): string | undefined {
  if (!claims) return undefined;
  const value = claims[key];
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : undefined;
}

function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Sağlayıcı seçimi
// ---------------------------------------------------------------------------

export interface AuthConfig {
  mode: 'shared-secret' | 'vmind-token' | 'public-guest' | 'disabled';
  sharedPassword?: string;
  /** true ise paylaşılan şifre reddedilir — internete açık kurulumlar için. */
  requireStrongAuth: boolean;
}

export function authConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const mode = (env['WEB_AUTH_MODE'] ?? 'vmind-token').trim();
  if (
    mode !== 'shared-secret' &&
    mode !== 'vmind-token' &&
    mode !== 'public-guest' &&
    mode !== 'disabled'
  ) {
    throw new Error(
      `WEB_AUTH_MODE geçersiz: "${mode}". "vmind-token", "shared-secret", ` +
        `"public-guest" veya "disabled" olmalı.`,
    );
  }
  return {
    mode,
    ...(env['WEB_SHARED_PASSWORD'] !== undefined
      ? { sharedPassword: env['WEB_SHARED_PASSWORD'] }
      : {}),
    // Varsayılan GÜVENLİ taraf: dışa açık kabul edilir, zayıf auth reddedilir.
    // Yerel geliştirmede WEB_ALLOW_WEAK_AUTH=1 ile açılır.
    requireStrongAuth: env['WEB_ALLOW_WEAK_AUTH'] !== '1',
  };
}

export function createAuthProvider(config: AuthConfig): AuthProvider {
  if (config.mode === 'vmind-token') return new VmindTokenAuthProvider();
  if (config.mode === 'public-guest') return new PublicGuestAuthProvider();

  if (config.mode === 'disabled') {
    if (config.requireStrongAuth) {
      throw new Error(
        'WEB_AUTH_MODE=disabled kimlik doğrulamasını tamamen kapatır. Yalnızca yerel ' +
          'geliştirmede WEB_ALLOW_WEAK_AUTH=1 ile kullanılabilir.',
      );
    }
    return new DisabledAuthProvider();
  }

  if (config.requireStrongAuth) {
    throw new Error(
      'WEB_AUTH_MODE=shared-secret ortak şifre kullanır ve gerçek kimlik doğrulaması ' +
        'değildir — LLM anahtarının önündeki tek kapı bu olmamalı. Yerel ' +
        'geliştirmede WEB_ALLOW_WEAK_AUTH=1 ile açın, sunucuda "vmind-token" kullanın.',
    );
  }
  if (!config.sharedPassword) {
    throw new Error('WEB_AUTH_MODE=shared-secret için WEB_SHARED_PASSWORD gerekli.');
  }
  return new SharedSecretAuthProvider(config.sharedPassword);
}

// ---------------------------------------------------------------------------
// 4) Kimliksiz yerel gelistirme — acik izin olmadan olusturulamaz
// ---------------------------------------------------------------------------

export class DisabledAuthProvider implements AuthProvider {
  readonly kind = 'disabled' as const;
  readonly loginFields = [] as const;
  private readonly identity: Identity = {
    userId: 'local:developer',
    displayName: 'Yerel kullanıcı',
  };

  async login(): Promise<LoginResult> {
    return { identity: this.identity, sessionToken: 'local-no-auth' };
  }

  resolve(): Identity {
    return this.identity;
  }

  logout(): void {
    // Kimlik dogrulama kapali oldugu icin kapatilacak oturum yok.
  }
}
