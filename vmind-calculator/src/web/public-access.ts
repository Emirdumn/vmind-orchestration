import { createHmac, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export class PublicAccessError extends Error {
  constructor(
    readonly status: 403 | 429,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'PublicAccessError';
  }
}

interface WindowState {
  timestamps: number[];
  touchedAt: number;
}

class MemoryWindowLimiter {
  private readonly windows = new Map<string, WindowState>();
  private operations = 0;

  constructor(private readonly now: () => number) {}

  consume(key: string, limit: number, windowMs: number): void {
    const now = this.now();
    const cutoff = now - windowMs;
    const current = this.windows.get(key) ?? { timestamps: [], touchedAt: now };
    current.timestamps = current.timestamps.filter((timestamp) => timestamp > cutoff);
    current.touchedAt = now;
    if (current.timestamps.length >= limit) {
      const oldest = current.timestamps[0] ?? now;
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      throw new PublicAccessError(429, 'Çok fazla istek gönderdiniz; lütfen biraz bekleyin.', retryAfter);
    }
    current.timestamps.push(now);
    this.windows.set(key, current);

    // Benzersiz IP hash'leri belleği sınırsız büyütmesin.
    this.operations++;
    if (this.operations % 200 === 0) {
      const stale = now - Math.max(windowMs, 60 * 60 * 1000);
      for (const [candidate, state] of this.windows) {
        if (state.touchedAt < stale) this.windows.delete(candidate);
      }
    }
  }
}

export interface TurnstileVerifierOptions {
  secretKey: string;
  expectedHostname?: string;
  fetchImpl?: typeof fetch;
}

export class TurnstileVerifier {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: TurnstileVerifierOptions) {
    if (options.secretKey.trim().length < 10) {
      throw new Error('TURNSTILE_SECRET_KEY geçerli bir gizli anahtar olmalıdır.');
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async verify(token: string | undefined): Promise<void> {
    const responseToken = String(token ?? '').trim();
    if (!responseToken || responseToken.length > 2048) {
      throw new PublicAccessError(403, 'Robot doğrulaması gerekli.');
    }

    let response: Response;
    try {
      response = await this.fetchImpl(TURNSTILE_VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: this.options.secretKey,
          response: responseToken,
          idempotency_key: randomUUID(),
        }),
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new PublicAccessError(403, 'Robot doğrulaması şu anda tamamlanamıyor.');
    }

    let payload: { success?: unknown; hostname?: unknown };
    try {
      payload = (await response.json()) as { success?: unknown; hostname?: unknown };
    } catch {
      throw new PublicAccessError(403, 'Robot doğrulaması geçersiz yanıt verdi.');
    }
    if (!response.ok || payload.success !== true) {
      throw new PublicAccessError(403, 'Robot doğrulaması başarısız veya süresi geçmiş.');
    }
    const expected = this.options.expectedHostname?.trim().toLowerCase();
    const received = typeof payload.hostname === 'string' ? payload.hostname.toLowerCase() : '';
    if (expected && received !== expected) {
      throw new PublicAccessError(403, 'Robot doğrulaması bu alan adı için geçerli değil.');
    }
  }
}

export interface PublicAccessOptions {
  ipHashSecret: string;
  requestLimitPerMinute?: number;
  flowLimitPerHour?: number;
  trustProxy?: boolean;
  turnstileSiteKey?: string;
  turnstileVerifier?: TurnstileVerifier;
  privacyNoticeVersion: string;
  now?: () => number;
}

function positiveInt(value: number | undefined, fallback: number, label: string): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < 1 || result > 100_000) {
    throw new Error(`${label} 1-100000 arasında tam sayı olmalıdır.`);
  }
  return result;
}

function remoteAddress(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    if (first && first.length <= 64) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export class PublicAccessGuard {
  readonly turnstileSiteKey?: string;
  readonly privacyNoticeVersion: string;
  private readonly requestLimit: number;
  private readonly flowLimit: number;
  private readonly limiter: MemoryWindowLimiter;
  private readonly secret: string;
  private readonly trustProxy: boolean;
  private readonly verifier?: TurnstileVerifier;

  constructor(options: PublicAccessOptions) {
    this.secret = options.ipHashSecret.trim();
    if (this.secret.length < 32) {
      throw new Error('WEB_PUBLIC_IP_HASH_SECRET en az 32 karakter olmalıdır.');
    }
    this.privacyNoticeVersion = options.privacyNoticeVersion.trim();
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(this.privacyNoticeVersion)) {
      throw new Error('WEB_PRIVACY_NOTICE_VERSION 1-64 karakterlik sürüm etiketi olmalıdır.');
    }
    this.requestLimit = positiveInt(
      options.requestLimitPerMinute,
      120,
      'WEB_PUBLIC_REQUESTS_PER_MINUTE',
    );
    this.flowLimit = positiveInt(options.flowLimitPerHour, 5, 'WEB_PUBLIC_FLOWS_PER_HOUR');
    this.trustProxy = options.trustProxy === true;
    this.turnstileSiteKey = options.turnstileSiteKey?.trim() || undefined;
    this.verifier = options.turnstileVerifier;
    if (Boolean(this.turnstileSiteKey) !== Boolean(this.verifier)) {
      throw new Error('Turnstile site ve secret yapılandırması birlikte verilmelidir.');
    }
    this.limiter = new MemoryWindowLimiter(options.now ?? (() => Date.now()));
  }

  private fingerprint(req: IncomingMessage): string {
    return createHmac('sha256', this.secret)
      .update(remoteAddress(req, this.trustProxy))
      .digest('hex')
      .slice(0, 32);
  }

  assertRequest(req: IncomingMessage): void {
    this.limiter.consume(`request:${this.fingerprint(req)}`, this.requestLimit, 60_000);
  }

  async assertFlowStart(req: IncomingMessage, turnstileToken: string | undefined): Promise<void> {
    this.limiter.consume(`flow:${this.fingerprint(req)}`, this.flowLimit, 60 * 60 * 1000);
    if (this.verifier) await this.verifier.verify(turnstileToken);
  }
}

function envInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = String(env[name] ?? '').trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) throw new Error(`${name} tam sayı olmalıdır.`);
  return parsed;
}

export function publicAccessFromEnv(
  authKind: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): PublicAccessGuard | undefined {
  if (authKind !== 'public-guest') return undefined;
  const siteKey = String(env['TURNSTILE_SITE_KEY'] ?? '').trim();
  const secretKey = String(env['TURNSTILE_SECRET_KEY'] ?? '').trim();
  const allowNoTurnstile = env['WEB_PUBLIC_ALLOW_NO_TURNSTILE'] === '1';
  if ((!siteKey || !secretKey) && !allowNoTurnstile) {
    throw new Error(
      'public-guest modunda TURNSTILE_SITE_KEY ve TURNSTILE_SECRET_KEY zorunludur. ' +
        'Yalnızca yerel testte WEB_PUBLIC_ALLOW_NO_TURNSTILE=1 kullanın.',
    );
  }
  if (Boolean(siteKey) !== Boolean(secretKey)) {
    throw new Error('TURNSTILE_SITE_KEY ve TURNSTILE_SECRET_KEY birlikte tanımlanmalıdır.');
  }
  return new PublicAccessGuard({
    ipHashSecret: String(env['WEB_PUBLIC_IP_HASH_SECRET'] ?? ''),
    requestLimitPerMinute: envInt(env, 'WEB_PUBLIC_REQUESTS_PER_MINUTE', 120),
    flowLimitPerHour: envInt(env, 'WEB_PUBLIC_FLOWS_PER_HOUR', 5),
    trustProxy: env['WEB_TRUST_PROXY'] === '1',
    privacyNoticeVersion: String(env['WEB_PRIVACY_NOTICE_VERSION'] ?? ''),
    ...(siteKey
      ? {
          turnstileSiteKey: siteKey,
          turnstileVerifier: new TurnstileVerifier({
            secretKey,
            expectedHostname: String(env['TURNSTILE_EXPECTED_HOSTNAME'] ?? '').trim() || undefined,
            fetchImpl,
          }),
        }
      : {}),
  });
}
