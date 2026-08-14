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
  private readonly expectedHash: Buffer;

  constructor(secret: string) {
    if (secret.trim().length < MIN_ADMIN_KEY_LENGTH) {
      throw new Error(`WEB_ADMIN_API_KEY en az ${MIN_ADMIN_KEY_LENGTH} karakter olmalıdır.`);
    }
    this.expectedHash = digest(secret.trim());
  }

  accepts(authorization: string | undefined): boolean {
    const match = /^Bearer\s+([^\s]+)$/i.exec(authorization ?? '');
    if (!match?.[1]) return false;
    const actualHash = digest(match[1]);
    return timingSafeEqual(actualHash, this.expectedHash);
  }
}

export function adminApiAuthFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AdminApiAuth | undefined {
  const secret = env['WEB_ADMIN_API_KEY']?.trim();
  return secret ? new AdminApiAuth(secret) : undefined;
}
