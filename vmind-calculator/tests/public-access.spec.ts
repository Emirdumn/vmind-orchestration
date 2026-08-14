import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import {
  PublicAccessError,
  PublicAccessGuard,
  TurnstileVerifier,
  publicAccessFromEnv,
} from '../src/web/public-access.js';

function request(ip = '203.0.113.10', forwarded?: string): any {
  const req = new EventEmitter() as any;
  req.headers = forwarded ? { 'x-forwarded-for': forwarded } : {};
  req.socket = { remoteAddress: ip };
  return req;
}

describe('PublicAccessGuard', () => {
  it('istek ve akış limitlerini ham IP saklamadan uygular', async () => {
    let now = 1_000;
    const guard = new PublicAccessGuard({
      ipHashSecret: 'x'.repeat(32),
      requestLimitPerMinute: 2,
      flowLimitPerHour: 1,
      privacyNoticeVersion: '2026-08-14',
      now: () => now,
    });
    const req = request();
    guard.assertRequest(req);
    guard.assertRequest(req);
    expect(() => guard.assertRequest(req)).toThrow(PublicAccessError);
    await guard.assertFlowStart(req, undefined);
    await expect(guard.assertFlowStart(req, undefined)).rejects.toMatchObject({ status: 429 });
    now += 60 * 60 * 1000;
    await expect(guard.assertFlowStart(req, undefined)).resolves.toBeUndefined();
  });

  it('proxy başlığı yalnız açık güven ayarında kullanılır', () => {
    const direct = new PublicAccessGuard({
      ipHashSecret: 'x'.repeat(32),
      requestLimitPerMinute: 1,
      privacyNoticeVersion: 'v1',
    });
    direct.assertRequest(request('10.0.0.5', '198.51.100.1'));
    expect(() => direct.assertRequest(request('10.0.0.5', '198.51.100.2'))).toThrow();

    const proxied = new PublicAccessGuard({
      ipHashSecret: 'y'.repeat(32),
      requestLimitPerMinute: 1,
      trustProxy: true,
      privacyNoticeVersion: 'v1',
    });
    proxied.assertRequest(request('10.0.0.5', '198.51.100.1'));
    expect(() => proxied.assertRequest(request('10.0.0.5', '198.51.100.2'))).not.toThrow();
  });
});

describe('TurnstileVerifier', () => {
  it('siteverify success ve doğru hostname ile geçer', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ success: true, hostname: 'teklif.example.com' }), { status: 200 }),
    );
    const verifier = new TurnstileVerifier({
      secretKey: 'secret-key-for-test',
      expectedHostname: 'teklif.example.com',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await expect(verifier.verify('valid-token')).resolves.toBeUndefined();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(String(init.body)).toContain('idempotency_key');
    expect(String(init.body)).toContain('valid-token');
  });

  it('eksik, başarısız ve yanlış hostname tokenı reddeder', async () => {
    const failed = new TurnstileVerifier({
      secretKey: 'secret-key-for-test',
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 })) as any,
    });
    await expect(failed.verify(undefined)).rejects.toMatchObject({ status: 403 });
    await expect(failed.verify('bad')).rejects.toMatchObject({ status: 403 });

    const wrongHost = new TurnstileVerifier({
      secretKey: 'secret-key-for-test',
      expectedHostname: 'teklif.example.com',
      fetchImpl: vi.fn(async () =>
        new Response(JSON.stringify({ success: true, hostname: 'evil.example' }), { status: 200 }),
      ) as any,
    });
    await expect(wrongHost.verify('token')).rejects.toMatchObject({ status: 403 });
  });
});

describe('publicAccessFromEnv', () => {
  it('public modda secret, KVKK sürümü ve Turnstile olmadan açılmaz', () => {
    expect(() => publicAccessFromEnv('public-guest', {})).toThrow(/TURNSTILE/);
    expect(() =>
      publicAccessFromEnv('public-guest', { WEB_PUBLIC_ALLOW_NO_TURNSTILE: '1' }),
    ).toThrow(/IP_HASH_SECRET/);
  });

  it('yerel test bypassı açıkça verilirse Turnstile olmadan kurulur', () => {
    const guard = publicAccessFromEnv('public-guest', {
      WEB_PUBLIC_ALLOW_NO_TURNSTILE: '1',
      WEB_PUBLIC_IP_HASH_SECRET: 'x'.repeat(32),
      WEB_PRIVACY_NOTICE_VERSION: 'v1',
    });
    expect(guard).toBeInstanceOf(PublicAccessGuard);
  });

  it('public olmayan modlarda yapılandırma istemez', () => {
    expect(publicAccessFromEnv('shared-secret', {})).toBeUndefined();
  });
});
