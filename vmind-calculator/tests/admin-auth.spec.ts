import { describe, expect, it } from 'vitest';

import { AdminApiAuth, adminApiAuthFromEnv } from '../src/web/admin-auth.js';

const KEY = 'vmind-admin-test-key-that-is-long-enough-2026';

describe('Admin API kimliği', () => {
  it('yalnızca doğru Bearer anahtarını kabul ediyor', () => {
    const auth = new AdminApiAuth(KEY);
    expect(auth.accepts(`Bearer ${KEY}`)).toBe(true);
    expect(auth.accepts(`bearer ${KEY}`)).toBe(true);
    expect(auth.accepts('Bearer yanlış-anahtar')).toBe(false);
    expect(auth.accepts(undefined)).toBe(false);
  });

  it('kısa anahtarla fail-closed açılmıyor', () => {
    expect(() => new AdminApiAuth('kısa')).toThrow(/en az 32/);
  });

  it('ortam değişkeni yoksa yönetim yüzeyini kapalı bırakıyor', () => {
    expect(adminApiAuthFromEnv({})).toBeUndefined();
  });
});
