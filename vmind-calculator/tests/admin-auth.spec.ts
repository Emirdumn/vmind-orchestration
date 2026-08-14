import { describe, expect, it } from 'vitest';

import { AdminApiAuth, adminApiAuthFromEnv, monitorApiAuthFromEnv } from '../src/web/admin-auth.js';

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

  it('rotasyon penceresinde yeni ve önceki anahtarı birlikte kabul ediyor', () => {
    const previous = 'vmind-admin-previous-key-that-is-long-enough';
    const auth = new AdminApiAuth(KEY, previous);
    expect(auth.accepts(`Bearer ${KEY}`)).toBe(true);
    expect(auth.accepts(`Bearer ${previous}`)).toBe(true);
  });

  it('monitor anahtarını ayrı ortam değişkeninden kuruyor', () => {
    const monitor = monitorApiAuthFromEnv({ WEB_MONITOR_API_KEY: KEY });
    expect(monitor?.accepts(`Bearer ${KEY}`)).toBe(true);
    expect(monitorApiAuthFromEnv({})).toBeUndefined();
  });
});
