/**
 * HTTP sunucusu testleri — gercek soket uzerinden.
 *
 * Nicin gercek sunucu: bu katmanin isi yetki, kota ve izolasyon. Bunlari
 * fonksiyon cagirarak test etmek, HTTP tarafinda kalan bir bosluk (cerez
 * okunmuyor, 401 donmuyor, baskasinin oturumu goruluyor) yakalayamaz.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

import { Catalog } from '../src/core/catalog/catalog.js';
import { RuleEngine } from '../src/core/rules/engine.js';
import { BudgetLedger } from '../src/web/budget.js';
import {
  DisabledAuthProvider,
  PublicGuestAuthProvider,
  SharedSecretAuthProvider,
  type AuthProvider,
} from '../src/web/auth.js';
import { AdminApiAuth } from '../src/web/admin-auth.js';
import { PublicAccessGuard } from '../src/web/public-access.js';
import { FlowSession, FlowSessionRegistry } from '../src/web/flow-session.js';
import { createAgentServer, parseLocalLlmCredential } from '../src/web/server.js';
import type { RuntimeStore } from '../src/web/runtime-store.js';
import { FakeLlm } from './fake-llm.js';
import type { ApiEnvelope, Flavor, Product, VolumeType } from '../src/core/catalog/types.js';

const PASSWORD = 'cok-uzun-bir-sifre-2026';
// `new URL(...).pathname` Windows'ta "/C:/..." verir; fileURLToPath dogrusu.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** `res.json()` `unknown` doner; testlerde alan okumak icin daraltma. */
const json = async (response: Response): Promise<Record<string, any>> =>
  (await response.json()) as Record<string, any>;

const read = <T>(name: string): ApiEnvelope<T> =>
  JSON.parse(readFileSync(join(root, 'fixtures', 'catalog', name), 'utf8'));

const catalog = Catalog.fromEnvelopes(
  read<Product>('products.json'),
  read<Flavor>('flavors.json'),
  read<VolumeType>('volume-types.json'),
);
const rules = RuleEngine.fromYaml(
  readFileSync(join(root, 'rules', 'estimate-rules.yaml'), 'utf8'),
  catalog,
);

let dir: string;
let base: string;
let close: () => void;
let budget: BudgetLedger;
let registry: FlowSessionRegistry;
/** Akis basina uretilen sahte istemcilerin maliyet callback'leri. */
let costSinks: Array<(costUsd: number | undefined) => void>;

describe('yerel LLM anahtari dosyasi', () => {
  it('ham OpenRouter anahtarini taniyor', () => {
    expect(parseLocalLlmCredential('sk-or-v1-test-key\n')).toEqual({
      envName: 'OPENROUTER_API_KEY',
      value: 'sk-or-v1-test-key',
    });
  });

  it('env atamasi ve yorum satirini destekliyor', () => {
    expect(parseLocalLlmCredential('# local\nANTHROPIC_API_KEY="sk-ant-test"\n')).toEqual({
      envName: 'ANTHROPIC_API_KEY',
      value: 'sk-ant-test',
    });
  });

  it('tanimlanmayan metni anahtar saymiyor', () => {
    expect(parseLocalLlmCredential('not-a-key')).toBeNull();
  });
});

/**
 * Sunucuyu kurar.
 *
 * `withLlm` varsayilan olarak ACIK: kota testlerinin bir baska hatadan (503)
 * kota gectigini CIKARSAMASI kirilgan olurdu. Sahte LLM ile uretim
 * siralamasinin aynisi test edilir.
 */
async function startServer(
  options: {
    withLlm?: boolean;
    allowPublish?: boolean;
    auth?: AuthProvider;
    publicAccess?: PublicAccessGuard;
    adminAuth?: AdminApiAuth;
    runtimeStore?: RuntimeStore;
  } = {},
): Promise<void> {
  const withLlm = options.withLlm ?? true;
  costSinks = [];

  const created = createAgentServer({
    catalog,
    rules,
    auth: options.auth ?? new SharedSecretAuthProvider(PASSWORD),
    ...(options.adminAuth ? { adminAuth: options.adminAuth } : {}),
    ...(options.publicAccess ? { publicAccess: options.publicAccess } : {}),
    ...(options.runtimeStore ? { runtimeStore: options.runtimeStore } : {}),
    budget,
    registry,
    ...(options.allowPublish !== undefined ? { allowPublish: options.allowPublish } : {}),
    llmLabel: withLlm ? 'fake/test-model' : 'YOK',
    ...(withLlm
      ? {
          createLlm: (onUsage) => {
            costSinks.push((costUsd) =>
              onUsage({
                model: 'test-model',
                inputTokens: 0,
                outputTokens: 0,
                ...(costUsd !== undefined ? { costUsd } : {}),
              }),
            );
            // Bos senaryo: extractor'in structured() cagrisi hata verir ->
            // akis `failed` olur. Kota/yetki kapilarini test etmek icin
            // akisin BASLAYABILMESI yeterli.
            return new FakeLlm();
          },
        }
      : {}),
  });
  await new Promise<void>((done) => created.server.listen(0, '127.0.0.1', done));
  const address = created.server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
  close = () => {
    created.close();
    created.server.close();
  };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vmind-web-'));
  budget = new BudgetLedger({ dailyTotalUsd: 5, dailyPerUserUsd: 1 }, join(dir, 'budget.json'));
  registry = new FlowSessionRegistry();
  await startServer();
});

afterEach(() => {
  close();
  rmSync(dir, { recursive: true, force: true });
});

/** Giris yapip cerezi doner. */
async function login(displayName = 'Emir'): Promise<string> {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName, password: PASSWORD }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie') ?? '';
  return cookie.split(';')[0] ?? '';
}

const withCookie = (cookie: string): Record<string, string> => ({ Cookie: cookie });

describe('Yetkilendirme', () => {
  it('giris formunun sekli kimlik gerektirmez', async () => {
    const response = await fetch(`${base}/api/auth/config`);
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.kind).toBe('shared-secret');
    expect(body.fields).toHaveLength(2);
  });

  it('kimliksiz /api/me 401', async () => {
    expect((await fetch(`${base}/api/me`)).status).toBe(401);
  });

  it('kimliksiz akis baslatma 401', async () => {
    const response = await fetch(`${base}/api/flow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salesText: '3 sunucu' }),
    });
    expect(response.status).toBe(401);
  });

  it('yanlis sifre 401 ve sebep SOYLENMEZ', async () => {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Emir', password: 'yanlis' }),
    });
    expect(response.status).toBe(401);
    const body = await json(response);
    // "kullanici yok" / "sifre yanlis" ayrimi sizmamali: tek bir mesaj.
    expect(body.error).toMatch(/başarısız/);
  });

  it('cerez HttpOnly ve SameSite=Strict', async () => {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Emir', password: PASSWORD }),
    });
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('giristen sonra /api/me calisiyor', async () => {
    const cookie = await login();
    const response = await fetch(`${base}/api/me`, { headers: withCookie(cookie) });
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.displayName).toBe('Emir');
  });

  it('cikistan sonra oturum gecersiz', async () => {
    const cookie = await login();
    await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: withCookie(cookie) });
    expect((await fetch(`${base}/api/me`, { headers: withCookie(cookie) })).status).toBe(401);
  });
});

describe('Yönetim API sınırı', () => {
  const adminKey = 'test-admin-key-with-more-than-thirty-two-characters';
  const opportunity = {
    opportunityId: '11111111-1111-4111-8111-111111111111',
    contactId: '22222222-2222-4222-8222-222222222222',
    phoneE164: '+905551111111',
    name: 'Test',
    company: null,
    communicationStatus: 'opted_in',
    consentUpdatedAt: new Date(0).toISOString(),
    consentNoticeVersion: '2026-08-14',
    consentSource: 'Website',
    customerNeed: '2 sunucu',
    recommendedService: 'Compute',
    stage: 'Qualified',
    estimatedAmountMinor: 10000,
    currency: 'TRY',
    owner: 'unassigned',
    nextFollowUp: null,
    source: 'Website',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    calculation: null,
  };
  const store: RuntimeStore = {
    init: async () => {},
    assertCanSpend: async () => {},
    remaining: async () => ({ total: 5, user: 1 }),
    snapshot: async () => ({
      day: '2026-08-14', totalUsd: 0, perUserUsd: {},
      limits: { dailyTotalUsd: 5, dailyPerUserUsd: 1 }, writeFailures: 0,
    }),
    reconcileLegacyBudget: async () => {},
    startRun: async () => { throw new Error('bu testte çağrılmamalı'); },
    appendInteraction: async () => {},
    recordUsage: async () => {},
    finishRun: async () => {},
    adminOverview: async () => ({
      generatedAt: new Date(0).toISOString(), principals: 1,
      runs: { total: 2, running: 0, completed: 1, failed: 1 },
      estimates: { total: 1, published: 0 },
      crm: { contacts: 1, opportunities: 1, openOpportunities: 1 },
      today: { llmCalls: 2, inputTokens: 100, outputTokens: 50, costUsd: 0.01 },
    }),
    adminRuns: async () => [],
    adminRunDetail: async () => null,
    adminDailyUsage: async () => [],
    adminOpportunities: async () => [opportunity],
    adminUpdateOpportunity: async (_id, update) => ({ ...opportunity, ...update }),
    close: async () => {},
  };

  it('yapılandırılmamış yönetim yüzeyini kapalı tutuyor', async () => {
    expect((await fetch(`${base}/api/admin/overview`)).status).toBe(404);
  });

  it('normal site çerezi admin yetkisi vermiyor; ayrı Bearer gerekiyor', async () => {
    close();
    await startServer({ adminAuth: new AdminApiAuth(adminKey), runtimeStore: store });
    const cookie = await login();
    expect((await fetch(`${base}/api/admin/overview`, { headers: withCookie(cookie) })).status).toBe(401);
    expect((await fetch(`${base}/api/admin/overview`, {
      headers: { Authorization: 'Bearer wrong-key' },
    })).status).toBe(401);
    const response = await fetch(`${base}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${adminKey}` },
    });
    expect(response.status).toBe(200);
    expect((await json(response)).today.costUsd).toBe(0.01);
  });

  it('CRM güncellemesini alan ve aşama listesiyle sınırlandırıyor', async () => {
    close();
    await startServer({ adminAuth: new AdminApiAuth(adminKey), runtimeStore: store });
    const headers = { Authorization: `Bearer ${adminKey}`, 'Content-Type': 'application/json' };
    const invalid = await fetch(`${base}/api/admin/opportunities/${opportunity.opportunityId}`, {
      method: 'PATCH', headers, body: JSON.stringify({ stage: 'Hacked' }),
    });
    expect(invalid.status).toBe(400);
    const updated = await fetch(`${base}/api/admin/opportunities/${opportunity.opportunityId}`, {
      method: 'PATCH', headers, body: JSON.stringify({ stage: 'Proposal Sent', owner: 'Emir' }),
    });
    expect(updated.status).toBe(200);
    expect((await json(updated)).stage).toBe('Proposal Sent');
  });
});

describe('Public müşteri oturumu', () => {
  it('şifresiz ama ayrı cookie kimliği ve IP-hash akış limiti kullanır', async () => {
    close();
    registry = new FlowSessionRegistry();
    await startServer({
      auth: new PublicGuestAuthProvider(),
      publicAccess: new PublicAccessGuard({
        ipHashSecret: 'public-test-secret'.padEnd(32, 'x'),
        requestLimitPerMinute: 50,
        flowLimitPerHour: 1,
        privacyNoticeVersion: '2026-08-14',
      }),
    });

    const configResponse = await fetch(`${base}/api/auth/config`);
    expect(configResponse.status).toBe(200);
    expect(await json(configResponse)).toMatchObject({
      kind: 'public-guest',
      automatic: true,
      privacyNoticeVersion: '2026-08-14',
    });

    const loginResponse = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(loginResponse.status).toBe(200);
    const cookie = (loginResponse.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    expect(cookie).toContain('vmind_agent_session=');
    const me = await fetch(`${base}/api/me`, { headers: withCookie(cookie) });
    expect(me.status).toBe(200);
    expect((await json(me)).displayName).toBe('Ziyaretçi');

    const flow = () => fetch(`${base}/api/flow`, {
      method: 'POST',
      headers: { ...withCookie(cookie), 'Content-Type': 'application/json' },
      body: JSON.stringify({ salesText: '2 sunucu' }),
    });
    expect((await flow()).status).toBe(202);
    const limited = await flow();
    expect(limited.status).toBe(429);
    expect((await json(limited)).scope).toBe('public-access');
  });
});

describe('Akis ucu', () => {
  it('LLM yoksa 503 ve sebebi soyluyor', async () => {
    close();
    await startServer({ withLlm: false });
    const cookie = await login();
    const response = await fetch(`${base}/api/flow`, {
      method: 'POST',
      headers: { ...withCookie(cookie), 'Content-Type': 'application/json' },
      body: JSON.stringify({ salesText: '3 sunucu' }),
    });
    expect(response.status).toBe(503);
    expect((await json(response)).error).toMatch(/OPENROUTER_API_KEY/);
  });

  it('gecerli istek 202 ve sessionId doner', async () => {
    const cookie = await login();
    const response = await fetch(`${base}/api/flow`, {
      method: 'POST',
      headers: { ...withCookie(cookie), 'Content-Type': 'application/json' },
      body: JSON.stringify({ salesText: '3 sunucu, premium disk' }),
    });
    expect(response.status).toBe(202);
    expect((await json(response)).sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('CRM musteri telefonu prompttan ayri ve E.164 dogrulanmis alinir', async () => {
    const cookie = await login();
    const response = await fetch(`${base}/api/flow`, {
      method: 'POST',
      headers: { ...withCookie(cookie), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salesText: '2 sunucu, premium disk',
        customer: {
          phoneE164: '0555 123 45 67',
          name: 'Deniz',
          company: 'Örnek AŞ',
          privacyConsent: true,
          privacyNoticeVersion: '2026-08-14',
        },
      }),
    });
    expect(response.status).toBe(202);
  });

  it('CRM telefonu açık veri işleme onayı olmadan kabul edilmez', async () => {
    const cookie = await login();
    const response = await fetch(`${base}/api/flow`, {
      method: 'POST',
      headers: { ...withCookie(cookie), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salesText: '2 sunucu',
        customer: { phoneE164: '0555 123 45 67' },
      }),
    });
    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatch(/onayı/);
  });

  it('gecersiz CRM telefonu akis baslatmadan 400 doner', async () => {
    const cookie = await login();
    const response = await fetch(`${base}/api/flow`, {
      method: 'POST',
      headers: { ...withCookie(cookie), 'Content-Type': 'application/json' },
      body: JSON.stringify({ salesText: '2 sunucu', customer: { phoneE164: '123' } }),
    });
    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatch(/telefon/);
  });

  it('CRM customer nesnesinde bilinmeyen alani reddeder', async () => {
    const cookie = await login();
    const response = await fetch(`${base}/api/flow`, {
      method: 'POST',
      headers: { ...withCookie(cookie), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salesText: '2 sunucu',
        customer: { phoneE164: '0555 123 45 67', admin: true },
      }),
    });
    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatch(/bilinmeyen/);
  });

  it('akış kapasitesi dolunca 500 yerine açıklamalı 429 döner', async () => {
    close();
    registry = new FlowSessionRegistry(50, 1);
    await startServer();
    const cookie = await login();
    const start = () =>
      fetch(`${base}/api/flow`, {
        method: 'POST',
        headers: { ...withCookie(cookie), 'Content-Type': 'application/json' },
        body: JSON.stringify({ salesText: '3 sunucu' }),
      });

    expect((await start()).status).toBe(202);
    const response = await start();
    expect(response.status).toBe(429);
    const body = await json(response);
    expect(body.scope).toBe('flow-capacity');
    expect(body.error).toMatch(/en fazla 1 açık teklif/);
  });

  it('kimliksiz yerel modda yeni teklif eski akışın yerine geçer', async () => {
    close();
    registry = new FlowSessionRegistry(50, 1);
    await startServer({ auth: new DisabledAuthProvider() });
    const start = () =>
      fetch(`${base}/api/flow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salesText: '3 sunucu' }),
      });

    expect((await start()).status).toBe(202);
    expect((await start()).status).toBe(202);
    expect(registry.size).toBe(1);
  });

  it('salesText yoksa 400', async () => {
    const cookie = await login();
    const response = await fetch(`${base}/api/flow`, {
      method: 'POST',
      headers: { ...withCookie(cookie), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });

  it('asiri uzun salesText reddedilir', async () => {
    const cookie = await login();
    const response = await fetch(`${base}/api/flow`, {
      method: 'POST',
      headers: { ...withCookie(cookie), 'Content-Type': 'application/json' },
      body: JSON.stringify({ salesText: 'a'.repeat(5000) }),
    });
    expect(response.status).toBe(400);
  });

  it('gecersiz JSON 400', async () => {
    const cookie = await login();
    const response = await fetch(`${base}/api/flow`, {
      method: 'POST',
      headers: { ...withCookie(cookie), 'Content-Type': 'application/json' },
      body: '{bozuk',
    });
    expect(response.status).toBe(400);
  });

  it('olmayan akis 404', async () => {
    const cookie = await login();
    const response = await fetch(`${base}/api/flow/00000000-0000-0000-0000-000000000000`, {
      headers: withCookie(cookie),
    });
    expect(response.status).toBe(404);
  });

  /**
   * IZOLASYON — baska satiscinin teklifi gorunmemeli. Kayit defteri kimligi
   * kontrol ediyor ama HTTP tarafinda dogru kimligin gectigini de dogrulamak
   * gerekiyor.
   */
  it('baskasinin akisi 404 doner (izolasyon)', async () => {
    const other = new FlowSession('shared:baskasi');
    registry.register(other);

    const cookie = await login('Emir');
    const response = await fetch(`${base}/api/flow/${other.sessionId}`, {
      headers: withCookie(cookie),
    });
    expect(response.status).toBe(404);
  });

  it('kendi akisi okunabiliyor', async () => {
    const cookie = await login('Emir');
    const mine = new FlowSession('shared:emir');
    registry.register(mine);

    const response = await fetch(`${base}/api/flow/${mine.sessionId}`, {
      headers: withCookie(cookie),
    });
    expect(response.status).toBe(200);
    expect((await json(response)).sessionId).toBe(mine.sessionId);
  });

  it('kapi cevaplama: dogru gateId 200, yinelenen 409', async () => {
    const cookie = await login('Emir');
    const session = new FlowSession('shared:emir');
    registry.register(session);
    void session.onClarify([{ question: 'Kac sunucu?', reason: 'gerekli' }]);
    await Promise.resolve();
    const gateId = session.view().gate!.id;

    const ok = await fetch(`${base}/api/flow/${session.sessionId}/answer`, {
      method: 'POST',
      headers: { ...withCookie(cookie), 'Content-Type': 'application/json' },
      body: JSON.stringify({ gateId, payload: {} }),
    });
    expect(ok.status).toBe(200);

    // Yinelenen istek: kapi kapandi -> 409, hata degil.
    const again = await fetch(`${base}/api/flow/${session.sessionId}/answer`, {
      method: 'POST',
      headers: { ...withCookie(cookie), 'Content-Type': 'application/json' },
      body: JSON.stringify({ gateId, payload: {} }),
    });
    expect(again.status).toBe(409);
  });

  it('gateId yoksa 400', async () => {
    const cookie = await login('Emir');
    const session = new FlowSession('shared:emir');
    registry.register(session);
    const response = await fetch(`${base}/api/flow/${session.sessionId}/answer`, {
      method: 'POST',
      headers: { ...withCookie(cookie), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });

  it('akis kapatilabiliyor', async () => {
    const cookie = await login('Emir');
    const session = new FlowSession('shared:emir');
    registry.register(session);

    const response = await fetch(`${base}/api/flow/${session.sessionId}/close`, {
      method: 'POST',
      headers: withCookie(cookie),
    });
    expect(response.status).toBe(200);
    expect(registry.size).toBe(0);
  });
});

/**
 * YAYINLAMA IZNI — onaylanan her teklif VMind'da KALICI kayit birakir ve
 * bilinen bir silme ucu yoktur. Bu yuzden varsayilanin KAPALI olmasi ve
 * yalnizca acik izinle acilmasi testle kilitleniyor.
 */
describe('Yayinlama izni', () => {
  it('VARSAYILAN KAPALI — allowPublish verilmezse', async () => {
    const cookie = await login();
    const body = await json(await fetch(`${base}/api/me`, { headers: withCookie(cookie) }));
    expect(body.publishEnabled).toBe(false);
  });

  it('allowPublish:false acikca verilse de kapali', async () => {
    close();
    await startServer({ allowPublish: false });
    const cookie = await login();
    const body = await json(await fetch(`${base}/api/me`, { headers: withCookie(cookie) }));
    expect(body.publishEnabled).toBe(false);
  });

  it('allowPublish:true ile ACIK ve arayuze bildiriliyor', async () => {
    close();
    await startServer({ allowPublish: true });
    const cookie = await login();
    const body = await json(await fetch(`${base}/api/me`, { headers: withCookie(cookie) }));
    // Arayuz bunu onay ekraninda gosterir: "kalici kayit olusur".
    expect(body.publishEnabled).toBe(true);
  });

  it('global yayın açık olsa bile public ziyaretçiye kalıcı yayın yetkisi verilmez', async () => {
    close();
    const guestAuth = new PublicGuestAuthProvider();
    await startServer({
      allowPublish: true,
      auth: guestAuth,
      publicAccess: new PublicAccessGuard({
        ipHashSecret: 'public-test-secret'.padEnd(32, 'x'),
        privacyNoticeVersion: '2026-08-14',
      }),
    });
    const loginResponse = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const cookie = (loginResponse.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const body = await json(await fetch(`${base}/api/me`, { headers: withCookie(cookie) }));
    expect(body.publishEnabled).toBe(false);
  });
});

describe('Harcama kotasi HTTP tarafinda', () => {
  it('kisi basi kota dolunca 429 ve anlasilir mesaj', async () => {
    const cookie = await login('Emir');
    budget.record('shared:emir', 1.0);

    const response = await fetch(`${base}/api/flow`, {
      method: 'POST',
      headers: { ...withCookie(cookie), 'Content-Type': 'application/json' },
      body: JSON.stringify({ salesText: '3 sunucu' }),
    });
    // 500 degil 429: bu bir sunucu hatasi degil, kota.
    expect(response.status).toBe(429);
    const body = await json(response);
    expect(body.scope).toBe('user');
    expect(body.error).toMatch(/sınırı aşıldı/);
  });

  it('bir kullanicinin kotasi digerini kilitlemez', async () => {
    budget.record('shared:emir', 1.0);
    const other = await login('Ayse');
    const response = await fetch(`${base}/api/flow`, {
      method: 'POST',
      headers: { ...withCookie(other), 'Content-Type': 'application/json' },
      body: JSON.stringify({ salesText: '3 sunucu' }),
    });
    // 202: kota kapisini gecti ve akis basladi.
    expect(response.status).toBe(202);
  });

  /**
   * ESZAMANLI ATIF — en onemli harcama testi.
   *
   * Ilk surumde sunucu tek bir `activeSession` degiskeni tutuyordu ve olay
   * dongusunde araya giren ikinci akis birincinin uzerine yaziyordu: harcama
   * YANLIS KULLANICIYA yaziliyor, kisi basi sinir tamamen anlamsizlasiyordu.
   * Atif artik akis basina uretilen istemciye kapanisla bagli.
   */
  it('eszamanli iki akisin harcamasi DOGRU kullaniciya yazilir', async () => {
    const emir = await login('Emir');
    const ayse = await login('Ayse');

    const startFlow = (cookie: string) =>
      fetch(`${base}/api/flow`, {
        method: 'POST',
        headers: { ...withCookie(cookie), 'Content-Type': 'application/json' },
        body: JSON.stringify({ salesText: '3 sunucu' }),
      });

    await startFlow(emir);
    await startFlow(ayse);
    expect(costSinks).toHaveLength(2);

    // Iki akis "ayni anda" harcama bildirsin — siralari karisik olsun.
    const [emirSink, ayseSink] = costSinks as [
      (c: number | undefined) => void,
      (c: number | undefined) => void,
    ];
    ayseSink(0.10);
    emirSink(0.30);
    ayseSink(0.05);

    const snapshot = budget.snapshot();
    expect(snapshot.perUserUsd['shared:emir']).toBeCloseTo(0.3, 10);
    expect(snapshot.perUserUsd['shared:ayse']).toBeCloseTo(0.15, 10);
  });

  it('gunluk toplam dolunca herkes 429', async () => {
    for (const who of ['a', 'b', 'c', 'd', 'e']) budget.record(`shared:${who}`, 1.0);
    const cookie = await login('Zeynep');
    const response = await fetch(`${base}/api/flow`, {
      method: 'POST',
      headers: { ...withCookie(cookie), 'Content-Type': 'application/json' },
      body: JSON.stringify({ salesText: '3 sunucu' }),
    });
    expect(response.status).toBe(429);
    expect((await json(response)).scope).toBe('total');
  });

  it('/api/status defter sagligini bildiriyor', async () => {
    const cookie = await login();
    const response = await fetch(`${base}/api/status`, { headers: withCookie(cookie) });
    const body = await json(response);
    expect(body.ledgerHealthy).toBe(true);
    expect(body.budget.limits.dailyPerUserUsd).toBe(1);
  });

  it('/api/status kimliksiz okunamaz', async () => {
    expect((await fetch(`${base}/api/status`)).status).toBe(401);
  });
});

describe('Statik servis ve guvenlik basliklari', () => {
  it('arayuz derlenmemisse anlamli mesaj', async () => {
    const response = await fetch(`${base}/`);
    expect(response.status).toBe(404);
    expect((await json(response)).error).toMatch(/web:build/);
  });

  it('bilinmeyen API ucu 404', async () => {
    expect((await fetch(`${base}/api/yok`)).status).toBe(404);
  });

  it('API disinda POST 405', async () => {
    expect((await fetch(`${base}/bir-sey`, { method: 'POST' })).status).toBe(405);
  });

  it('JSON yanitlar onbelleklenmez', async () => {
    const response = await fetch(`${base}/api/auth/config`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
