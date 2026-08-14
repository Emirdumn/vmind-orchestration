/**
 * Kimlik dogrulama testleri.
 *
 * Bu katman LLM anahtarinin ve VMind yazma yetkisinin onundeki kapi. Testler
 * "giris calisiyor mu"dan cok "GIRMEMESI gereken giremiyor mu" sorusuna bakiyor.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  PublicGuestAuthProvider,
  ServiceApiKeyAuth,
  SharedSecretAuthProvider,
  VmindTokenAuthProvider,
  authConfigFromEnv,
  createAuthProvider,
} from '../src/web/auth.js';

const PASSWORD = 'cok-uzun-bir-sifre-2026';

describe('Servis API anahtarı rotasyonu', () => {
  it('rotasyon sırasında yeni ve önceki Bearer anahtarını kabul ediyor', () => {
    const current = 'current-service-key-that-is-long-enough-2026';
    const previous = 'previous-service-key-that-is-long-enough-2026';
    const auth = new ServiceApiKeyAuth(current, { previousApiKey: previous });
    expect(auth.resolve(`Bearer ${current}`)?.actorType).toBe('service');
    expect(auth.resolve(`Bearer ${previous}`)?.actorType).toBe('service');
    expect(auth.resolve('Bearer wrong')).toBeNull();
  });
});

describe('SharedSecretAuthProvider', () => {
  it('dogru sifre ile giris ve oturum cozumu', async () => {
    const provider = new SharedSecretAuthProvider(PASSWORD);
    const result = await provider.login({ displayName: 'Emir', password: PASSWORD });
    expect(result).not.toBeNull();
    expect(result?.identity.displayName).toBe('Emir');
    expect(provider.resolve(result?.sessionToken)?.userId).toBe('shared:emir');
  });

  it('yanlis sifre reddedilir', async () => {
    const provider = new SharedSecretAuthProvider(PASSWORD);
    expect(await provider.login({ displayName: 'Emir', password: 'yanlis' })).toBeNull();
  });

  it('bos ad reddedilir — harcama sayaci kimliksiz calismaz', async () => {
    const provider = new SharedSecretAuthProvider(PASSWORD);
    expect(await provider.login({ displayName: '   ', password: PASSWORD })).toBeNull();
  });

  it('asiri uzun ad reddedilir', async () => {
    const provider = new SharedSecretAuthProvider(PASSWORD);
    expect(await provider.login({ displayName: 'a'.repeat(81), password: PASSWORD })).toBeNull();
  });

  /**
   * REGRESYON — Turkce 'I' tuzagi.
   *
   * Ilk surum `toLocaleLowerCase('tr')` kullaniyordu. Turkce'de 'I' -> 'ı'
   * (noktasiz) oldugu icin "EMIR" -> "emır", "Emir" -> "emir" olur: ayni kisi
   * buyuk harfle yazdiginda AYRI bir harcama sayacina duser ve kisi basi sinir
   * atlatilabilir. Kimlik anahtarlari yerelden BAGIMSIZ kucultulmeli.
   */
  it('ayni kisi farkli buyuk/kucuk harfle ayni sayaca yazar (Turkce I tuzagi)', async () => {
    const provider = new SharedSecretAuthProvider(PASSWORD);
    const a = await provider.login({ displayName: 'Emir', password: PASSWORD });
    const b = await provider.login({ displayName: 'EMIR', password: PASSWORD });
    const c = await provider.login({ displayName: 'emir', password: PASSWORD });
    expect(a?.identity.userId).toBe(b?.identity.userId);
    expect(a?.identity.userId).toBe(c?.identity.userId);
    // Gorunen ad orijinal haliyle korunur — normalize edilen yalnizca anahtar.
    expect(b?.identity.displayName).toBe('EMIR');
  });

  it('kisa ortak sifre kabul edilmez', () => {
    expect(() => new SharedSecretAuthProvider('kisa')).toThrow(/en az 12/);
  });

  it('gecersiz oturum anahtari cozulmez', () => {
    const provider = new SharedSecretAuthProvider(PASSWORD);
    expect(provider.resolve('uydurma')).toBeNull();
    expect(provider.resolve(undefined)).toBeNull();
  });

  it('cikis yapilan oturum bir daha cozulmez', async () => {
    const provider = new SharedSecretAuthProvider(PASSWORD);
    const result = await provider.login({ displayName: 'Emir', password: PASSWORD });
    provider.logout(result!.sessionToken);
    expect(provider.resolve(result!.sessionToken)).toBeNull();
  });

  it('suresi gecen oturum cozulmez', async () => {
    const provider = new SharedSecretAuthProvider(PASSWORD, { sessionTtlMs: -1 });
    const result = await provider.login({ displayName: 'Emir', password: PASSWORD });
    expect(provider.resolve(result!.sessionToken)).toBeNull();
  });
});

describe('VmindTokenAuthProvider', () => {
  const okFetch = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;

  it('platform 200 dondururse kimlik kabul edilir', async () => {
    const provider = new VmindTokenAuthProvider({ fetchImpl: okFetch });
    const result = await provider.login({ token: 'x'.repeat(40) });
    expect(result).not.toBeNull();
    expect(result?.identity.vmindToken).toBe('x'.repeat(40));
  });

  it('401 dondururse REDDEDILIR', async () => {
    const denied = vi.fn(async () => new Response('', { status: 401 })) as unknown as typeof fetch;
    const provider = new VmindTokenAuthProvider({ fetchImpl: denied });
    expect(await provider.login({ token: 'x'.repeat(40) })).toBeNull();
  });

  it('403 dondururse REDDEDILIR', async () => {
    const denied = vi.fn(async () => new Response('', { status: 403 })) as unknown as typeof fetch;
    const provider = new VmindTokenAuthProvider({ fetchImpl: denied });
    expect(await provider.login({ token: 'x'.repeat(40) })).toBeNull();
  });

  it('ag hatasi giris SAYILMAZ (fail closed)', async () => {
    const boom = vi.fn(async () => {
      throw new Error('ETIMEDOUT');
    }) as unknown as typeof fetch;
    const provider = new VmindTokenAuthProvider({ fetchImpl: boom });
    expect(await provider.login({ token: 'x'.repeat(40) })).toBeNull();
  });

  it('cok kisa token platforma HIC sorulmadan reddedilir', async () => {
    const spy = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const provider = new VmindTokenAuthProvider({ fetchImpl: spy });
    expect(await provider.login({ token: 'kisa' })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('token Authorization basligiyla gonderiliyor', async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const spy = (async (url: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(url), auth: headers.get('Authorization') });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new VmindTokenAuthProvider({ fetchImpl: spy, probeUrl: 'https://x/probe' });
    await provider.login({ token: 'y'.repeat(40) });
    expect(calls[0]?.url).toBe('https://x/probe');
    expect(calls[0]?.auth).toBe(`Bearer ${'y'.repeat(40)}`);
  });

  /**
   * JWT imzasi DOGRULANMIYOR — dogrulama platformun 200'u. Buradaki tek amac
   * sayac ve iz icin okunabilir bir ad cikarmak.
   */
  it('JWT icindeki email kimlik olarak kullaniliyor', async () => {
    const payload = Buffer.from(JSON.stringify({ email: 'satisci@vmind.com' })).toString('base64url');
    const jwt = `header.${payload}.imza`;
    const provider = new VmindTokenAuthProvider({ fetchImpl: okFetch });
    const result = await provider.login({ token: jwt });
    expect(result?.identity.userId).toBe('vmind:satisci@vmind.com');
    expect(result?.identity.displayName).toBe('satisci@vmind.com');
  });

  it('JWT olmayan token: kisi basi sayac YINE de calisir (hash kimlik)', async () => {
    const provider = new VmindTokenAuthProvider({ fetchImpl: okFetch });
    const a = await provider.login({ token: 'a'.repeat(40) });
    const b = await provider.login({ token: 'b'.repeat(40) });
    expect(a?.identity.userId).toMatch(/^vmind-anon:/);
    // Iki farkli token -> iki farkli sayac. Aksi halde kisi basi sinir anlamsiz olurdu.
    expect(a?.identity.userId).not.toBe(b?.identity.userId);
  });

  it('ayni token her zaman ayni kimlige cozulur', async () => {
    const provider = new VmindTokenAuthProvider({ fetchImpl: okFetch });
    const a = await provider.login({ token: 'z'.repeat(40) });
    const b = await provider.login({ token: 'z'.repeat(40) });
    expect(a?.identity.userId).toBe(b?.identity.userId);
  });

  it('bozuk JWT govdesi cokmez, hash kimlige duser', async () => {
    const provider = new VmindTokenAuthProvider({ fetchImpl: okFetch });
    const result = await provider.login({ token: 'header.!!!bozuk!!!.imza' + 'x'.repeat(30) });
    expect(result?.identity.userId).toMatch(/^vmind-anon:/);
  });
});

describe('PublicGuestAuthProvider', () => {
  it('her yeni ziyaretçiye ayrı ve çözülebilir kota kimliği verir', async () => {
    const provider = new PublicGuestAuthProvider();
    const first = await provider.login({});
    const second = await provider.login({});
    expect(first.identity.userId).toMatch(/^guest:[0-9a-f]{32}$/);
    expect(second.identity.userId).not.toBe(first.identity.userId);
    expect(provider.resolve(first.sessionToken)?.userId).toBe(first.identity.userId);
    expect(provider.loginFields).toEqual([]);
  });

  it('çıkış yapılan ziyaretçi oturumu tekrar kullanılamaz', async () => {
    const provider = new PublicGuestAuthProvider();
    const result = await provider.login({});
    provider.logout(result.sessionToken);
    expect(provider.resolve(result.sessionToken)).toBeNull();
  });
});

describe('Saglayici secimi — varsayilan GUVENLI taraf', () => {
  it('varsayilan mod vmind-token', () => {
    expect(authConfigFromEnv({}).mode).toBe('vmind-token');
  });

  it('varsayilan olarak zayif auth REDDEDILIR', () => {
    expect(authConfigFromEnv({}).requireStrongAuth).toBe(true);
  });

  /**
   * En onemli test: ortak sifre internete acik kurulumda sessizce kabul
   * edilmemeli. Yanlislikla `WEB_AUTH_MODE=shared-secret` birakan biri
   * LLM anahtarini tek bir paylasilan sifrenin arkasina koymus olur.
   */
  it('shared-secret acik izin olmadan calismaz', () => {
    const config = authConfigFromEnv({
      WEB_AUTH_MODE: 'shared-secret',
      WEB_SHARED_PASSWORD: PASSWORD,
    });
    expect(() => createAuthProvider(config)).toThrow(/WEB_ALLOW_WEAK_AUTH/);
  });

  it('acik izinle shared-secret calisir', () => {
    const config = authConfigFromEnv({
      WEB_AUTH_MODE: 'shared-secret',
      WEB_SHARED_PASSWORD: PASSWORD,
      WEB_ALLOW_WEAK_AUTH: '1',
    });
    expect(createAuthProvider(config).kind).toBe('shared-secret');
  });

  it('public-guest güçlü auth bayrağını düşürmeden kurulabilir', () => {
    const provider = createAuthProvider(authConfigFromEnv({ WEB_AUTH_MODE: 'public-guest' }));
    expect(provider.kind).toBe('public-guest');
    expect(provider).toBeInstanceOf(PublicGuestAuthProvider);
  });

  it('shared-secret sifresiz calismaz', () => {
    const config = authConfigFromEnv({ WEB_AUTH_MODE: 'shared-secret', WEB_ALLOW_WEAK_AUTH: '1' });
    expect(() => createAuthProvider(config)).toThrow(/WEB_SHARED_PASSWORD/);
  });

  it('disabled mod acik izin olmadan calismaz', () => {
    const config = authConfigFromEnv({ WEB_AUTH_MODE: 'disabled' });
    expect(() => createAuthProvider(config)).toThrow(/WEB_ALLOW_WEAK_AUTH/);
  });

  it('disabled mod acik izinle yerel kimligi dogrudan cozer', () => {
    const provider = createAuthProvider(
      authConfigFromEnv({ WEB_AUTH_MODE: 'disabled', WEB_ALLOW_WEAK_AUTH: '1' }),
    );
    expect(provider.kind).toBe('disabled');
    expect(provider.resolve(undefined)?.userId).toBe('local:developer');
    expect(provider.loginFields).toEqual([]);
  });

  it('gecersiz mod sessizce yutulmaz', () => {
    expect(() => authConfigFromEnv({ WEB_AUTH_MODE: 'hicbiri' })).toThrow(/geçersiz/);
  });
});
