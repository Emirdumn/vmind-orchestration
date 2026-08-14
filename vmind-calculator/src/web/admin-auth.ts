import { createHash, timingSafeEqual } from 'node:crypto';

const MIN_ADMIN_KEY_LENGTH = 32;

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Yönetim API'si için müşteri/site oturumundan tamamen ayrı bir yetki sınırı.
 * Ham anahtar bellekte yalnızca açılışta hash'lenene kadar tutulur; loglanmaz.
 */
export class AdminApiAuth {
  private readonly expectedHashes: Buffer[];

  constructor(secret: string, previousSecret?: string, label = 'WEB_ADMIN_API_KEY') {
    const secrets = [secret, previousSecret]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));
    if (secrets.some((value) => value.length < MIN_ADMIN_KEY_LENGTH)) {
      throw new Error(`${label} en az ${MIN_ADMIN_KEY_LENGTH} karakter olmalıdır.`);
    }
    this.expectedHashes = [...new Set(secrets)].map(digest);
  }

  accepts(authorization: string | undefined): boolean {
    const match = /^Bearer\s+([^\s]+)$/i.exec(authorization ?? '');
    if (!match?.[1]) return false;
    const actualHash = digest(match[1]);
    return this.expectedHashes.some((expectedHash) => timingSafeEqual(actualHash, expectedHash));
  }
}

export function adminApiAuthFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AdminApiAuth | undefined {
  const secret = env['WEB_ADMIN_API_KEY']?.trim();
  return secret ? new AdminApiAuth(secret, env['WEB_ADMIN_API_KEY_PREVIOUS']) : undefined;
}

/** İzleme anahtarı admin anahtarından ayrı döndürülür ve CRM verisi okuyamaz. */
export function monitorApiAuthFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AdminApiAuth | undefined {
  const secret = env['WEB_MONITOR_API_KEY']?.trim();
  return secret
    ? new AdminApiAuth(secret, env['WEB_MONITOR_API_KEY_PREVIOUS'], 'WEB_MONITOR_API_KEY')
    : undefined;
}
