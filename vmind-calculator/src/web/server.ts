/**
 * HTTP sunucusu — satışçı arayüzünün arka ucu.
 *
 * Node'un yerleşik `http` modülü kullanıldı; Express eklenmedi. Sebep: proje
 * dört bağımlılıkla yürüyor ve burada gereken şey birkaç rota, JSON gövdesi ve
 * uzun yoklama. Çerçeve kazancı, bağımlılık yüzeyini haklı çıkarmıyor.
 *
 * ## Güvenlik sınırları (bunlar tasarım, tercih değil)
 *
 * - **LLM anahtarı tarayıcıya HİÇ gitmez.** Model çağrıları yalnızca burada.
 * - **VMind token'ı tarayıcıya geri dönmez.** Girişte alınır, bellekte kalır.
 * - **`publish.save` varsayılan dryRun.** Gerçek yayınlama yalnızca sunucu
 *   `WEB_ALLOW_PUBLISH=1` ile bilinçli olarak açıldığında ve satışçı onay
 *   verdiğinde yapılır. Blocker kontrolü ve HITL kapısı her durumda yerindedir.
 * - **Harcama defteri her akıştan ÖNCE kontrol edilir.** Akışın ortasında
 *   kesmek satışçıyı yarı yolda bırakır.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve as resolvePath, sep } from 'node:path';

import { Catalog } from '../core/catalog/catalog.js';
import { RuleEngine } from '../core/rules/engine.js';
import { EstimateSession } from '../core/estimate/session.js';
import { AuditTrail } from '../core/telemetry/audit.js';
import { createToolContext, priceTools } from '../mcp/tools/index.js';
import { ApprovalEditor } from '../agents/approval-editor.js';
import { Auditor } from '../agents/auditor.js';
import { RequirementExtractor } from '../agents/extractor.js';
import { SolutionDesigner } from '../agents/designer.js';
import { SolutionReviser } from '../agents/reviser.js';
import {
  RoutedLlm,
  modelRouterConfigFromEnv,
  type ModelRouteDecision,
} from '../agents/model-router.js';
import { Orchestrator } from '../agents/orchestrator.js';
import type { AuditQuestion } from '../agents/types.js';
import {
  MissingCredentialsError,
  createLlm,
  type LlmClient,
  type LlmProvider,
  type UsageReport,
  type UsageSink,
} from '../agents/llm.js';
import { PlatformApiClient } from '../platform/api-client.js';
import type { ApiEnvelope, Flavor, Product, VolumeType } from '../core/catalog/types.js';

import {
  BudgetExceededError,
  BudgetLedger,
  DEFAULT_LEDGER_PATH,
  limitsFromEnv,
} from './budget.js';
import {
  authConfigFromEnv,
  createAuthProvider,
  serviceApiKeyAuthFromEnv,
  type AuthProvider,
  type Identity,
  type ServiceApiKeyAuth,
} from './auth.js';
import { adminApiAuthFromEnv, type AdminApiAuth } from './admin-auth.js';
import { FlowCapacityError, FlowSession, FlowSessionRegistry } from './flow-session.js';
import {
  RuntimeStoreUnavailableError,
  runtimeStoreFromEnv,
  type RuntimeRun,
  type RuntimeStore,
} from './runtime-store.js';
import {
  crmSyncFromEnv,
  normalizeCustomerPhone,
  type CrmCustomerContext,
  type CrmSync,
} from './crm-sync.js';
import {
  PublicAccessError,
  publicAccessFromEnv,
  type PublicAccessGuard,
} from './public-access.js';
import {
  DeterministicGuidedDesigner,
  GuidedQuoteInputSchema,
  guidedQuoteToSpec,
  type GuidedQuoteInput,
} from './guided-flow.js';
import { parseSpreadsheetBuffer } from './structured-import.js';

const SESSION_COOKIE = 'vmind_agent_session';
const MAX_BODY_BYTES = 64 * 1024;
const MAX_SPREADSHEET_BYTES = 2 * 1024 * 1024;
const MAX_SALES_TEXT = 4000;

export interface ServerDeps {
  catalog: Catalog;
  rules: RuleEngine;
  auth: AuthProvider;
  /** Site/müşteri oturumundan ayrı, yalnızca yönetim API'sine ait Bearer sınırı. */
  adminAuth?: AdminApiAuth;
  /** Public müşteri modunda IP-hash limitleri ve Turnstile doğrulaması. */
  publicAccess?: PublicAccessGuard;
  // OpenClaw gibi makine istemcileri icin cerezden bagimsiz Bearer kimligi.
  serviceAuth?: ServiceApiKeyAuth;
  budget: BudgetLedger;
  /** Faz 2: kalıcı akış/LLM/tool telemetrisi ve PostgreSQL kota defteri. */
  runtimeStore?: RuntimeStore;
  /** Imzali site -> CRM senkronu. Yoksa teklif akisi CRM'den bagimsiz devam eder. */
  crmSync?: CrmSync;
  registry: FlowSessionRegistry;
  llmLabel: string;
  llmProvider?: LlmProvider;
  llmModel?: string;
  /** Statik dosyaların kökü (derlenmiş frontend). Yoksa yalnızca API çalışır. */
  staticRoot?: string;
  /**
   * Onaydan sonra teklifin VMind'a GERÇEKTEN yazılmasına izin verir.
   *
   * Bu, sistemin asıl işini mümkün kılan anahtar: kayıt olmadan
   * `calculator.portvmind.com/my-estimate/{id}` linki üretilemez ve satışçı
   * hesabı yine elle girmek zorunda kalır.
   *
   * ⛔ Açıkken ONAYLANAN HER TEKLİF VMind'da KALICI bir kayıt bırakır ve
   * bilinen bir silme ucu yoktur. Bu yüzden varsayılan `false`: yanlış
   * yapılandırılmış bir sunucu sessizce kayıt üretmesin.
   *
   * Dört kapı açıkken de yerinde durur:
   *   dryRun varsayılan → blocker kontrolü → insan onayı → bu izin.
   */
  allowPublish?: boolean;
  /**
   * AKIŞ BAŞINA yeni bir LLM istemcisi üretir; maliyet callback'i o akışa bağlanır.
   *
   * ⛔ Paylaşılan tek istemci + `activeSession` değişkeni KULLANILMAZ.
   * İlk sürüm öyleydi ve eşzamanlı iki akışta harcamayı YANLIŞ KULLANICIYA
   * yazıyordu: `activeSession` tek bir değişken olduğu için olay döngüsünde
   * araya giren ikinci akış birincinin üzerine yazıyor. Kişi başı harcama
   * sınırının tamamen anlamsızlaştığı bir hata — bu yüzden atıf istemci
   * seviyesinde, kapanış (closure) ile yapılıyor.
   *
   * `undefined` ise sunucuda LLM anahtarı yok; doğal dil akışı çalışmaz.
   */
  createLlm?: (onUsage: UsageSink) => LlmClient;
}

// ---------------------------------------------------------------------------
// Küçük yardımcılar
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    // Arayüz verisi hiçbir zaman önbelleklenmesin: fiyat ve durum değişir.
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    // Gövde sınırı: sınırsız okumak bir isteğin belleği tüketmesine izin verir.
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'İstek gövdesi çok büyük.');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Geçersiz JSON gövdesi.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'Gövde bir JSON nesnesi olmalı.');
  }
  return parsed as Record<string, unknown>;
}

async function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > maxBytes) throw new HttpError(413, 'Yüklenen dosya çok büyük.');
    chunks.push(buffer);
  }
  if (size === 0) throw new HttpError(400, 'Yüklenecek dosya gerekli.');
  return Buffer.concat(chunks);
}

function readCookie(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const str = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const CRM_STAGES = new Set([
  'New',
  'Need Identified',
  'Qualified',
  'Calculation Created',
  'Proposal Sent',
  'Follow-up',
  'Sales Contact Requested',
  'Won',
  'Lost',
]);

function boundedInteger(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new HttpError(400, `Sayısal parametre ${min}-${max} aralığında olmalıdır.`);
  }
  return parsed;
}

function customerContext(value: unknown): CrmCustomerContext | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'customer bir JSON nesnesi olmalıdır.');
  }
  const input = value as Record<string, unknown>;
  const extras = Object.keys(input).filter(
    (key) =>
      !['phoneE164', 'name', 'company', 'privacyConsent', 'privacyNoticeVersion'].includes(key),
  );
  if (extras.length > 0) throw new HttpError(400, 'customer bilinmeyen alan içeriyor.');
  const rawPhone = str(input['phoneE164'], 32);
  const phoneE164 = rawPhone ? normalizeCustomerPhone(rawPhone) : null;
  if (!phoneE164) throw new HttpError(400, 'Müşteri telefonu geçerli değil.');
  const name = str(input['name'], 160)?.trim();
  const company = str(input['company'], 240)?.trim();
  if (input['privacyConsent'] !== true) {
    throw new HttpError(400, 'Müşteri iletişim bilgisini kaydetmek için veri işleme onayı gerekli.');
  }
  const privacyNoticeVersion = str(input['privacyNoticeVersion'], 64)?.trim();
  if (!privacyNoticeVersion || !/^[A-Za-z0-9._-]+$/.test(privacyNoticeVersion)) {
    throw new HttpError(400, 'Gizlilik bildirimi sürümü geçersiz.');
  }
  return {
    phoneE164,
    ...(name ? { name } : {}),
    ...(company ? { company } : {}),
    privacyConsent: true,
    privacyNoticeVersion,
  };
}

function requestChannel(req: IncomingMessage, identity: Identity): string {
  const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '';
  if (/openclaw/i.test(userAgent)) return 'whatsapp';
  if (identity.actorType === 'service') return 'service';
  return 'web';
}

// ---------------------------------------------------------------------------
// Sunucu
// ---------------------------------------------------------------------------

export function createAgentServer(deps: ServerDeps) {
  const mayPublish = (identity: Identity): boolean => {
    if (deps.allowPublish !== true) return false;
    if (identity.userId.startsWith('guest:')) return false;
    if (identity.actorType === 'service') return identity.canPublish === true;
    return true;
  };

  const requireIdentity = (req: IncomingMessage): Identity => {
    const identity =
      deps.auth.resolve(readCookie(req, SESSION_COOKIE)) ??
      deps.serviceAuth?.resolve(req.headers.authorization);
    if (!identity) throw new HttpError(401, 'Oturum yok veya süresi geçmiş. Yeniden giriş yapın.');
    return identity;
  };

  async function handleApi(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    const method = req.method ?? 'GET';
    deps.publicAccess?.assertRequest(req);

    // --- yönetim API'si: müşteri/site oturumundan bağımsız ----------------
    if (pathname.startsWith('/api/admin')) {
      if (!deps.adminAuth) throw new HttpError(404, 'Yönetim API’si yapılandırılmamış.');
      if (!deps.adminAuth.accepts(req.headers.authorization)) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="vmind-admin"');
        throw new HttpError(401, 'Geçerli yönetim Bearer anahtarı gerekli.');
      }
      if (!deps.runtimeStore) {
        throw new HttpError(503, 'Yönetim API’si için PostgreSQL kullanım defteri gerekli.');
      }

      const url = new URL(req.url ?? '/', 'http://localhost');
      if (pathname === '/api/admin/overview' && method === 'GET') {
        sendJson(res, 200, await deps.runtimeStore.adminOverview());
        return true;
      }
      if (pathname === '/api/admin/runs' && method === 'GET') {
        const limit = boundedInteger(url.searchParams.get('limit'), 50, 1, 200);
        sendJson(res, 200, { items: await deps.runtimeStore.adminRuns(limit) });
        return true;
      }
      const runMatch = new RegExp(`^/api/admin/runs/(${UUID_PATTERN})$`, 'i').exec(pathname);
      if (runMatch && method === 'GET') {
        const detail = await deps.runtimeStore.adminRunDetail(runMatch[1]!);
        if (!detail) throw new HttpError(404, 'Çalıştırma bulunamadı.');
        sendJson(res, 200, detail);
        return true;
      }
      if (pathname === '/api/admin/usage' && method === 'GET') {
        const days = boundedInteger(url.searchParams.get('days'), 30, 1, 366);
        sendJson(res, 200, { items: await deps.runtimeStore.adminDailyUsage(days) });
        return true;
      }
      if (pathname === '/api/admin/opportunities' && method === 'GET') {
        const limit = boundedInteger(url.searchParams.get('limit'), 50, 1, 200);
        const stage = url.searchParams.get('stage')?.trim() || undefined;
        if (stage && !CRM_STAGES.has(stage)) throw new HttpError(400, 'Geçersiz CRM aşaması.');
        sendJson(res, 200, {
          items: await deps.runtimeStore.adminOpportunities(limit, stage),
        });
        return true;
      }
      const opportunityMatch = new RegExp(
        `^/api/admin/opportunities/(${UUID_PATTERN})$`,
        'i',
      ).exec(pathname);
      if (opportunityMatch && method === 'PATCH') {
        const body = await readJsonBody(req);
        const extras = Object.keys(body).filter(
          (key) => !['stage', 'owner', 'nextFollowUp'].includes(key),
        );
        if (extras.length > 0) throw new HttpError(400, 'Bilinmeyen güncelleme alanı.');
        const stage = body['stage'] === undefined ? undefined : str(body['stage'], 64);
        if (body['stage'] !== undefined && (!stage || !CRM_STAGES.has(stage))) {
          throw new HttpError(400, 'Geçersiz CRM aşaması.');
        }
        const owner = body['owner'] === undefined ? undefined : str(body['owner'], 160)?.trim();
        if (body['owner'] !== undefined && !owner) throw new HttpError(400, 'owner geçersiz.');
        const nextFollowUp =
          body['nextFollowUp'] === undefined
            ? undefined
            : body['nextFollowUp'] === null
              ? null
              : str(body['nextFollowUp'], 10);
        if (
          body['nextFollowUp'] !== undefined &&
          nextFollowUp !== null &&
          (!nextFollowUp || !/^\d{4}-\d{2}-\d{2}$/.test(nextFollowUp))
        ) {
          throw new HttpError(400, 'nextFollowUp YYYY-MM-DD biçiminde veya null olmalıdır.');
        }
        if (stage === undefined && owner === undefined && nextFollowUp === undefined) {
          throw new HttpError(400, 'Güncellenecek en az bir alan gerekli.');
        }
        const updated = await deps.runtimeStore.adminUpdateOpportunity(
          opportunityMatch[1]!,
          {
            ...(stage !== undefined ? { stage } : {}),
            ...(owner !== undefined ? { owner } : {}),
            ...(nextFollowUp !== undefined ? { nextFollowUp } : {}),
          },
        );
        if (!updated) throw new HttpError(404, 'Fırsat bulunamadı.');
        sendJson(res, 200, updated);
        return true;
      }
      throw new HttpError(404, 'Bilinmeyen yönetim ucu.');
    }

    // --- giriş formunun şekli (kimlik gerekmez) ---------------------------
    if (pathname === '/api/auth/config' && method === 'GET') {
      sendJson(res, 200, {
        kind: deps.auth.kind,
        fields: deps.auth.loginFields,
        automatic: deps.auth.kind === 'public-guest',
        ...(deps.publicAccess?.turnstileSiteKey
          ? { turnstileSiteKey: deps.publicAccess.turnstileSiteKey }
          : {}),
        ...(deps.publicAccess
          ? { privacyNoticeVersion: deps.publicAccess.privacyNoticeVersion }
          : {}),
      });
      return true;
    }

    if (pathname === '/api/auth/login' && method === 'POST') {
      const body = await readJsonBody(req);
      const input: Record<string, string> = {};
      for (const [key, value] of Object.entries(body)) {
        if (typeof value === 'string' && value.length <= 8192) input[key] = value;
      }
      const result = await deps.auth.login(input);
      // Başarısızlıkta sebep söylenmez — kullanıcı/şifre ayrımı sızmasın.
      if (!result) {
        sendJson(res, 401, { error: 'Giriş başarısız.' });
        return true;
      }
      res.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=${result.sessionToken}; HttpOnly; SameSite=Strict; Path=/; ` +
          `Max-Age=${deps.auth.kind === 'public-guest' ? 86400 : 28800}` +
          (process.env['WEB_INSECURE_COOKIE'] === '1' ? '' : '; Secure'),
      );
      sendJson(res, 200, { displayName: result.identity.displayName });
      return true;
    }

    if (pathname === '/api/auth/logout' && method === 'POST') {
      const token = readCookie(req, SESSION_COOKIE);
      if (token) deps.auth.logout(token);
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
      sendJson(res, 200, { ok: true });
      return true;
    }

    // --- buradan sonrası kimlik gerektirir --------------------------------
    if (pathname === '/api/me' && method === 'GET') {
      const identity = requireIdentity(req);
      sendJson(res, 200, {
        displayName: identity.displayName,
        llm: deps.llmLabel,
        budget: deps.runtimeStore
          ? await deps.runtimeStore.remaining(identity)
          : deps.budget.remaining(identity.userId),
        catalog: { products: deps.catalog.products.length, flavors: deps.catalog.flavors.length },
        rules: deps.rules.ruleCount,
        // Arayüz bunu göstererek satışçıya onayın ne anlama geldiğini söyler:
        // açıkken onay kalıcı kayıt oluşturur, kapalıyken yalnızca dry-run.
        publishEnabled:
          mayPublish(identity),
        crmEnabled: Boolean(deps.crmSync),
        ...(deps.publicAccess?.turnstileSiteKey
          ? { turnstileSiteKey: deps.publicAccess.turnstileSiteKey }
          : {}),
        ...(deps.publicAccess
          ? { privacyNoticeVersion: deps.publicAccess.privacyNoticeVersion }
          : {}),
      });
      return true;
    }

    if (pathname === '/api/status' && method === 'GET') {
      requireIdentity(req);
      const legacySnapshot = deps.budget.snapshot();
      const snapshot = deps.runtimeStore ? await deps.runtimeStore.snapshot() : legacySnapshot;
      sendJson(res, 200, {
        budget: snapshot,
        openSessions: deps.registry.size,
        // Defter yazılamıyorsa GÖRÜNÜR olmalı: sessiz kayıp kotayı yeniden açar.
        ledgerHealthy: snapshot.writeFailures === 0 && legacySnapshot.writeFailures === 0,
        ledgerSource: deps.runtimeStore ? 'postgresql' : 'json',
        crmEnabled: Boolean(deps.crmSync),
      });
      return true;
    }

    if (pathname === '/api/import/spreadsheet' && method === 'POST') {
      requireIdentity(req);
      const encodedName = typeof req.headers['x-vmind-filename'] === 'string'
        ? req.headers['x-vmind-filename']
        : '';
      let fileName = '';
      try { fileName = decodeURIComponent(encodedName); } catch { /* aşağıdaki doğrulama */ }
      if (!fileName || fileName.length > 240 || !/\.(csv|xlsx)$/i.test(fileName)) {
        throw new HttpError(400, 'Dosya adı .csv veya .xlsx ile bitmelidir.');
      }
      const body = await readRawBody(req, MAX_SPREADSHEET_BYTES);
      try {
        sendJson(res, 200, await parseSpreadsheetBuffer(fileName, body));
      } catch {
        throw new HttpError(400, 'Dosya okunamadı veya desteklenen tablo biçimine uymuyor.');
      }
      return true;
    }

    if (pathname === '/api/flow/guided' && method === 'POST') {
      const identity = requireIdentity(req);
      await deps.publicAccess?.assertFlowStart(
        req,
        typeof req.headers['x-turnstile-token'] === 'string'
          ? req.headers['x-turnstile-token']
          : undefined,
      );
      const body = await readJsonBody(req);
      const parsed = GuidedQuoteInputSchema.safeParse(body['config']);
      if (!parsed.success) throw new HttpError(400, 'Tıklamalı teklif yapılandırması geçersiz.');
      const config = parsed.data;
      const spec = guidedQuoteToSpec(config);
      const customer = customerContext(body['customer']);

      if (deps.auth.kind === 'disabled') deps.registry.removeForUser(identity.userId);
      const session = new FlowSession(identity.userId);
      deps.registry.register(session);
      let runtimeRun: RuntimeRun | undefined;
      try {
        if (deps.runtimeStore) {
          runtimeRun = await deps.runtimeStore.startRun({
            sessionId: session.sessionId,
            identity,
            salesText: spec.rationale,
            channel: requestChannel(req, identity),
            provider: 'deterministic',
            model: 'tool-first/guided-v1',
          });
        }
      } catch (error) {
        deps.registry.remove(session.sessionId);
        throw error;
      }
      void runFlow(session, identity, spec.rationale, runtimeRun, customer, {
        kind: 'guided',
        config,
      });
      sendJson(res, 202, { sessionId: session.sessionId, route: 'tool-first' });
      return true;
    }

    if (pathname === '/api/flow' && method === 'POST') {
      const identity = requireIdentity(req);
      await deps.publicAccess?.assertFlowStart(
        req,
        typeof req.headers['x-turnstile-token'] === 'string'
          ? req.headers['x-turnstile-token']
          : undefined,
      );
      const body = await readJsonBody(req);
      const salesText = str(body['salesText'], MAX_SALES_TEXT);
      const customer = customerContext(body['customer']);
      if (!salesText) {
        throw new HttpError(400, `salesText gerekli (en fazla ${MAX_SALES_TEXT} karakter).`);
      }
      if (!deps.createLlm) {
        throw new HttpError(
          503,
          'LLM yapılandırılmamış: sunucuda OPENROUTER_API_KEY veya ANTHROPIC_API_KEY yok.',
        );
      }
      // ⛔ Bütçe kontrolü akıştan ÖNCE. Ortasında kesmek satışçıyı yarıda bırakır.
      deps.budget.assertCanSpend(identity.userId);
      if (deps.runtimeStore) await deps.runtimeStore.assertCanSpend(identity);

      // Yerel modda her sekme aynı sabit kullanıcıdır. Tarayıcı yenilenince
      // eski sessionId kaybolduğu için bekleyen akışlar kişi kotasını doldurur.
      // Bu uygulama yerelde tek aktif teklif olarak çalışır: yeni başlangıç,
      // önceki yerel akışların yerine geçer. Gerçek kimlikli kurulumlarda
      // çoklu teklif desteği ve kişi başı sınır aynen korunur.
      if (deps.auth.kind === 'disabled') {
        deps.registry.removeForUser(identity.userId);
      }

      const session = new FlowSession(identity.userId);
      deps.registry.register(session);
      let runtimeRun: RuntimeRun | undefined;
      try {
        if (deps.runtimeStore) {
          if (!deps.llmProvider || !deps.llmModel) {
            throw new HttpError(503, 'LLM sağlayıcı bilgisi telemetri için yapılandırılmamış.');
          }
          runtimeRun = await deps.runtimeStore.startRun({
            sessionId: session.sessionId,
            identity,
            salesText,
            channel: requestChannel(req, identity),
            provider: deps.llmProvider,
            model: deps.llmModel,
          });
        }
      } catch (error) {
        deps.registry.remove(session.sessionId);
        throw error;
      }
      void runFlow(session, identity, salesText, runtimeRun, customer, { kind: 'natural' });
      sendJson(res, 202, { sessionId: session.sessionId });
      return true;
    }

    const flowMatch = /^\/api\/flow\/([0-9a-f-]{36})(\/answer|\/edit|\/close)?$/.exec(pathname);
    if (flowMatch) {
      const identity = requireIdentity(req);
      const sessionId = flowMatch[1] as string;
      const session = deps.registry.get(sessionId, identity.userId);
      if (!session) throw new HttpError(404, 'Akış bulunamadı veya size ait değil.');

      if (!flowMatch[2] && method === 'GET') {
        // Uzun yoklama: durum değişene kadar bekler, boş dönüş sayısını azaltır.
        const wait = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('wait') ?? '0');
        if (Number.isFinite(wait) && wait > 0) {
          await session.waitForChange(Math.min(wait, 25_000));
        }
        sendJson(res, 200, session.view());
        return true;
      }

      if (flowMatch[2] === '/answer' && method === 'POST') {
        const body = await readJsonBody(req);
        const gateId = str(body['gateId'], 64);
        if (!gateId) throw new HttpError(400, 'gateId gerekli.');
        let payload = body['payload'];
        const activeGate = session.view().gate;
        const approvalPayload =
          activeGate?.kind === 'approve' &&
          payload !== null &&
          typeof payload === 'object' &&
          !Array.isArray(payload)
            ? (payload as Record<string, unknown>)
            : undefined;
        if (approvalPayload?.['approved'] === true) {
          // Geriye uyum: `publish` verilmemiş onay eski istemcide yayın talebiydi.
          const requestsPublish = approvalPayload['publish'] !== false;
          if (requestsPublish && !mayPublish(identity)) {
            throw new HttpError(
              403,
              'Bu kullanıcı veya servis kalıcı VMind teklifi yayınlama yetkisine sahip değil.',
            );
          }
          // Hiçbir istemci approvedBy alanında başka birini taklit edemez.
          payload = {
            approved: true,
            publish: requestsPublish,
            approvedBy: identity.displayName,
          };
        }
        if (deps.runtimeStore && activeGate?.id === gateId) {
          await deps.runtimeStore.appendInteraction(
            sessionId,
            'inbound',
            JSON.stringify(payload ?? null),
            { kind: 'flow.answer', gateKind: activeGate.kind },
          );
        }
        const accepted = session.answer(gateId, payload);
        // 409: kapı kapanmış (zaman aşımı veya yinelenen istek). Hata değil,
        // istemcinin durumu yenilemesi gereken bir durum.
        sendJson(res, accepted ? 200 : 409, { accepted, view: session.view() });
        return true;
      }

      if (flowMatch[2] === '/edit' && method === 'POST') {
        deps.budget.assertCanSpend(identity.userId);
        if (deps.runtimeStore) await deps.runtimeStore.assertCanSpend(identity);
        const body = await readJsonBody(req);
        const gateId = str(body['gateId'], 64);
        const instruction = str(body['instruction'], 2000);
        if (!gateId || !instruction) {
          throw new HttpError(400, 'gateId ve en fazla 2000 karakterlik düzenleme talebi gerekli.');
        }
        if (deps.runtimeStore) {
          await deps.runtimeStore.appendInteraction(sessionId, 'inbound', instruction, {
            kind: 'flow.edit',
          });
        }
        const edited = await session.editApproval(gateId, instruction);
        sendJson(res, edited.accepted ? 200 : 409, { ...edited, view: session.view() });
        return true;
      }

      if (flowMatch[2] === '/close' && method === 'POST') {
        deps.registry.remove(sessionId);
        sendJson(res, 200, { ok: true });
        return true;
      }
    }

    return false;
  }

  /** Akışı arka planda yürütür. Hata olursa oturuma yazılır, sunucu düşmez. */
  async function runFlow(
    session: FlowSession,
    identity: Identity,
    salesText: string,
    runtimeRun?: RuntimeRun,
    customer?: CrmCustomerContext,
    workflow:
      | { kind: 'natural' }
      | { kind: 'guided'; config: GuidedQuoteInput } = { kind: 'natural' },
  ): Promise<void> {
    const trail = new AuditTrail();
    trail.sessionStart({
      currency: 'TL',
      ...(deps.llmProvider ? { provider: deps.llmProvider } : {}),
      ...(deps.llmModel ? { model: deps.llmModel } : {}),
    });
    // Satışçının kendi VMind token'ı varsa onunla; yoksa bundle'ın public
    // anahtarı. Yazma yalnızca sunucu açıkça izin verdiyse mümkün — ve o
    // durumda bile insan onayı olmadan `publish.save` reddeder.
    const client = new PlatformApiClient({
      allowWrites:
        mayPublish(identity),
      ...(identity.vmindToken ? { apiKey: identity.vmindToken } : {}),
    });
    const ctx = createToolContext(deps.catalog, deps.rules, {
      session: new EstimateSession(deps.catalog, { currency: 'TL', name: 'Web Teklif' }),
      audit: trail,
      client,
    });

    // Harcama atıfı BU akışa kapanışla bağlı — eşzamanlı akışlar karışmaz.
    const pendingUsageWrites: Array<Promise<unknown>> = [];
    const llm = workflow.kind === 'natural' ? deps.createLlm?.((usage) => {
      const provider = deps.llmProvider ?? 'openrouter';
      trail.llmUsage({ provider, ...usage });
      session.recordSpend(usage.costUsd);
      // JSON defteri Faz 2 boyunca geri dönüş/uzlaştırma kopyasıdır.
      deps.budget.record(session.userId, usage.costUsd);
      if (deps.runtimeStore && runtimeRun) {
        pendingUsageWrites.push(
          deps.runtimeStore.recordUsage(runtimeRun, usage).then(
            () => null,
            (error) => error,
          ),
        );
      }
    }) : undefined;

    const initialSpec =
      workflow.kind === 'guided' ? guidedQuoteToSpec(workflow.config) : undefined;
    const guidedDesigner =
      workflow.kind === 'guided' ? new DeterministicGuidedDesigner(workflow.config) : undefined;

    const orchestrator = new Orchestrator({
      catalog: deps.catalog,
      // Kural motoru zaten tum blocker/recommended/optional bulgulari
      // deterministik uretiyor. Her denetim turunda yeniden LLM'e baglamsal
      // not sordurmak akisi saniyeler yerine dakikalara tasiyordu.
      auditor: new Auditor(deps.rules),
      ...(guidedDesigner
        ? { designer: guidedDesigner }
        : llm
        ? {
            extractor: new RequirementExtractor(llm),
            designer: new SolutionDesigner(llm),
          }
        : {}),
    });

    // Son turda sorulan sorular — `onRevise` cevabı hangi soruya ait olduğunu
    // bilmek zorunda (ruleId tek başına soru metnini vermiyor).
    let lastQuestions: AuditQuestion[] = [];
    const reviser = llm ? new SolutionReviser(llm) : undefined;
    const approvalEditor = llm ? new ApprovalEditor(llm) : undefined;

    let result: Awaited<ReturnType<Orchestrator['run']>> | undefined;
    let flowError: unknown;
    try {
      result = await orchestrator.run(ctx, salesText, {
        onClarify: session.onClarify,
        onQuestions: async (questions, round) => {
          lastQuestions = questions;
          return session.onQuestions(questions, round);
        },
        // ⛔ Bu callback OLMADAN cevaplar teklife HİÇ işlenmiyordu: satışçı
        // "3 TB" yazıyor, arayüz kabul ediyor, fiyat değişmiyor ve aynı eksik
        // bir sonraki denetimde yine çıkıyor. Canlı arayüz testinde görüldü.
        ...(reviser
          ? {
              onRevise: async (answers, context) => {
                const revision = await reviser.revise(context, answers, lastQuestions);
                // "100 Mbps" gibi anlasilan ama aylik GB'a cevrilemeyen cevap
                // sessizce kaybolmasin; satisci neden tekrar soruldugunu gorsun.
                if (revision.summary) {
                  session.onEvent({ stage: 'revise', message: revision.summary });
                }
                return { unresolvedRuleIds: revision.unresolvedRuleIds };
              },
            }
          : {}),
        onApprove: async (summary) =>
          session.onApprove(
            summary,
            approvalEditor
              ? async (instruction, current) => {
                  const edit = await approvalEditor.edit(ctx, instruction);
                  const state = ctx.session.read();
                  const price = priceTools.calculate(ctx);
                  const audit = await new Auditor(deps.rules).audit({
                    currency: state.currency,
                    list: state.list,
                    ...(current.spec ? { spec: current.spec } : {}),
                  });
                  const draft = current.draft
                    ? {
                        ...current.draft,
                        finalText: [current.draft.finalText, edit.summary]
                          .filter(Boolean)
                          .join('\n'),
                        choices: state.list.map((item) => ({
                          service: item.service,
                          itemId: item.id,
                          rationale:
                            current.draft?.choices.find((choice) => choice.itemId === item.id)
                              ?.rationale ?? 'Onay öncesi düzenleme ile eklendi.',
                        })),
                      }
                    : undefined;
                  return {
                    summary: {
                      ...current,
                      estimate: state,
                      price,
                      audit,
                      ...(draft ? { draft } : {}),
                    },
                    message:
                      `${edit.summary} Yeni toplam: ` +
                      `${price.totalMonthCost.toLocaleString('tr-TR')} ${price.currency}/ay.`,
                  };
                }
              : undefined,
          ),
        onEvent: session.onEvent,
      }, initialSpec);
      if (customer && deps.crmSync) {
        try {
          const synced = await deps.crmSync.syncQuote({
            flowSessionId: session.sessionId,
            customer,
            result,
          });
          session.onEvent({
            stage: 'crm',
            message: `CRM kaydı güncellendi (${synced.opportunity.stage}).`,
          });
        } catch (error) {
          // CRM hatasi bitmis teklifi kullanicidan saklamaz; telefon veya istek
          // govdesi loglanmaz. Calculator PostgreSQL sonucu zaten korur.
          console.error('[crm] site senkronu tamamlanamadı:', error instanceof Error ? error.name : 'Error');
          session.onEvent({
            stage: 'crm',
            message: 'Teklif tamamlandı; CRM kaydı şu anda güncellenemedi.',
          });
        }
      }
      session.complete(result);
    } catch (error) {
      flowError = error;
      trail.halt(error instanceof Error ? error.message : String(error));
      session.fail(error);
    } finally {
      const usageResults = await Promise.all(pendingUsageWrites);
      for (const usageError of usageResults) {
        if (usageError) console.error('[telemetry] LLM kullanımı yazılamadı:', usageError);
      }
      if (deps.runtimeStore && runtimeRun) {
        try {
          await deps.runtimeStore.finishRun(runtimeRun, {
            ...(result ? { result } : {}),
            ...(flowError !== undefined ? { error: flowError } : {}),
            trail,
          });
        } catch (error) {
          // Telemetri, tamamlanmış bir teklif sonucunu müşteriden saklamaz.
          // JSON bütçe aynası bu durumda harcamayı korumaya devam eder.
          console.error('[telemetry] Akış sonucu yazılamadı:', error);
        }
      }
    }
  }

  // --- statik dosyalar -----------------------------------------------------

  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
  };

  function serveStatic(res: ServerResponse, pathname: string): void {
    const root = deps.staticRoot;
    if (!root) {
      sendJson(res, 404, { error: 'Arayüz derlenmemiş. `npm run web:build` çalıştırın.' });
      return;
    }
    // Yol geçişi (path traversal) koruması: normalize edip kökün ALTINDA
    // olduğunu doğrula. `..` içeren istek kök dışına çıkamaz.
    const requested = pathname === '/' ? '/index.html' : pathname;
    const candidate = resolvePath(join(root, normalize(requested)));
    const rootResolved = resolvePath(root);
    if (candidate !== rootResolved && !candidate.startsWith(rootResolved + sep)) {
      sendJson(res, 403, { error: 'Yasak yol.' });
      return;
    }

    let body: Buffer;
    let file = candidate;
    try {
      body = readFileSync(file);
    } catch {
      // SPA: bilinmeyen yol index.html'e düşer (istemci tarafı yönlendirme).
      try {
        file = join(rootResolved, 'index.html');
        body = readFileSync(file);
      } catch {
        sendJson(res, 404, { error: 'Bulunamadı.' });
        return;
      }
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'X-Content-Type-Options': 'nosniff',
      // Arayüz tek origin'den servis edilir; harici kaynak yüklemesi yok.
      'Content-Security-Policy':
        deps.publicAccess?.turnstileSiteKey
          ? "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; " +
            "frame-src https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com"
          : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data:; connect-src 'self'",
      'Referrer-Policy': 'same-origin',
    });
    res.end(body);
  }

  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

    void (async () => {
      try {
        if (pathname.startsWith('/api/')) {
          const handled = await handleApi(req, res, pathname);
          if (!handled) sendJson(res, 404, { error: `Bilinmeyen uç: ${pathname}` });
          return;
        }
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'Yalnızca GET.' });
          return;
        }
        serveStatic(res, pathname);
      } catch (error) {
        if (error instanceof HttpError) {
          sendJson(res, error.status, { error: error.message });
          return;
        }
        if (error instanceof PublicAccessError) {
          if (error.retryAfterSeconds) {
            res.setHeader('Retry-After', String(error.retryAfterSeconds));
          }
          sendJson(res, error.status, { error: error.message, scope: 'public-access' });
          return;
        }
        if (error instanceof BudgetExceededError) {
          // 429: sunucu hatası değil, kota. İstemci bunu kullanıcıya
          // anlaşılır bir mesajla göstermeli.
          sendJson(res, 429, { error: error.message, scope: error.scope });
          return;
        }
        if (error instanceof RuntimeStoreUnavailableError) {
          sendJson(res, 503, { error: 'Kullanım defteri geçici olarak erişilemiyor; lütfen tekrar deneyin.' });
          return;
        }
        if (error instanceof FlowCapacityError) {
          // Kullanıcıya eyleme dönük sebebi göster; bu bir sunucu çökmesi değil.
          sendJson(res, 429, { error: error.message, scope: 'flow-capacity' });
          return;
        }
        // Beklenmeyen hatanın DETAYI istemciye gitmez (yığın izi, dosya yolu).
        console.error('[web] beklenmeyen hata:', error);
        sendJson(res, 500, { error: 'Sunucu hatası.' });
      }
    })();
  });

  // Süresi geçen oturumları düzenli topla.
  const sweeper = setInterval(() => deps.registry.sweep(), 60_000);
  sweeper.unref?.();

  return { server, close: () => clearInterval(sweeper) };
}

// ---------------------------------------------------------------------------
// Önyükleme
// ---------------------------------------------------------------------------

export function loadCatalogAndRules(root: string): { catalog: Catalog; rules: RuleEngine } {
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
  return { catalog, rules };
}

export interface LocalLlmCredential {
  envName: 'OPENROUTER_API_KEY' | 'ANTHROPIC_API_KEY';
  value: string;
}

/**
 * `key.key` icin desteklenen iki bicim:
 *   sk-or-v1-...                 (ham OpenRouter anahtari)
 *   OPENROUTER_API_KEY=sk-or-... (env atamasi)
 *
 * Anahtar hicbir zaman loglanmaz. Taninmayan satirlar yok sayilir; boylece
 * rastgele bir metin yanlislikla kimlik bilgisi olarak bir servise gonderilmez.
 */
export function parseLocalLlmCredential(contents: string): LocalLlmCredential | null {
  const lines = contents.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const assignment = /^(OPENROUTER_API_KEY|ANTHROPIC_API_KEY)\s*=\s*(.+)$/.exec(line);
    if (assignment?.[1] && assignment[2]) {
      const envName = assignment[1] as LocalLlmCredential['envName'];
      const value = assignment[2].trim().replace(/^(['"])(.*)\1$/, '$2');
      if (value.length > 0) return { envName, value };
      continue;
    }

    if (line.startsWith('sk-or-v1-')) return { envName: 'OPENROUTER_API_KEY', value: line };
    if (line.startsWith('sk-ant-')) return { envName: 'ANTHROPIC_API_KEY', value: line };
  }
  return null;
}

/**
 * Yerel gelistirme kolayligi: ortamda anahtar yoksa gitignore'daki key.key
 * dosyasina bakar. Repo kokunun bir ustu de desteklenir; bu projede anahtar
 * kaynak kod klasorunun disinda tutuluyor.
 */
export function loadLocalLlmCredential(root: string): string | null {
  if (
    process.env['OPENROUTER_API_KEY'] ||
    process.env['ANTHROPIC_API_KEY'] ||
    process.env['ANTHROPIC_AUTH_TOKEN']
  ) {
    return null;
  }

  const configuredFile = process.env['LLM_KEY_FILE'];
  const candidates = configuredFile
    ? [resolvePath(configuredFile)]
    : [join(root, 'key.key'), join(root, '..', 'key.key')];

  for (const candidate of candidates) {
    let contents: string;
    try {
      contents = readFileSync(candidate, 'utf8');
    } catch {
      continue;
    }
    const credential = parseLocalLlmCredential(contents);
    if (!credential) continue;
    process.env[credential.envName] = credential.value;
    return candidate;
  }
  return null;
}

export async function startFromEnv(root: string): Promise<void> {
  loadLocalLlmCredential(root);
  const { catalog, rules } = loadCatalogAndRules(root);
  const auth = createAuthProvider(authConfigFromEnv());
  const adminAuth = adminApiAuthFromEnv();
  const publicAccess = publicAccessFromEnv(auth.kind);
  const serviceAuth = serviceApiKeyAuthFromEnv();
  const limits = limitsFromEnv();
  const budget = new BudgetLedger(limits, process.env['BUDGET_FILE'] ?? DEFAULT_LEDGER_PATH);
  const runtimeStore = runtimeStoreFromEnv(limits);
  if (runtimeStore) {
    await runtimeStore.init();
    await runtimeStore.reconcileLegacyBudget(budget.snapshot());
  }
  const registry = new FlowSessionRegistry();
  const crmSync = crmSyncFromEnv();

  // Anahtarın varlığı bir kez, açılışta denenir — her akışta patlamasın.
  let llmAvailable = false;
  let llmLabel = 'YOK — sunucuda LLM anahtarı tanımlı değil';
  let llmProvider: LlmProvider | undefined;
  let llmModel: string | undefined;
  let routerConfig: ReturnType<typeof modelRouterConfigFromEnv> | undefined;
  try {
    const probe = createLlm({ onUsage: () => {} });
    llmLabel = `${probe.provider} / ${probe.model}`;
    llmProvider = probe.provider;
    routerConfig = modelRouterConfigFromEnv(probe.provider);
    llmModel = 'model-router/v1';
    llmLabel =
      `${probe.provider} router · hızlı=${routerConfig.fastModel} · ` +
      `dengeli=${routerConfig.balancedModel} · güçlü=${routerConfig.strongModel}`;
    llmAvailable = true;
  } catch (error) {
    if (!(error instanceof MissingCredentialsError)) throw error;
  }

  // Varsayılan KAPALI: yanlış yapılandırılmış bir sunucu sessizce kalıcı
  // kayıt üretmesin. Açmak bilinçli bir tercih olmalı.
  const allowPublish = process.env['WEB_ALLOW_PUBLISH'] === '1';

  const staticRoot = join(root, 'web', 'dist');
  const { server } = createAgentServer({
    catalog,
    rules,
    auth,
    ...(adminAuth ? { adminAuth } : {}),
    ...(publicAccess ? { publicAccess } : {}),
    ...(serviceAuth ? { serviceAuth } : {}),
    budget,
    ...(runtimeStore ? { runtimeStore } : {}),
    ...(crmSync ? { crmSync } : {}),
    registry,
    llmLabel,
    ...(llmProvider ? { llmProvider } : {}),
    ...(llmModel ? { llmModel } : {}),
    staticRoot,
    allowPublish,
    // Akış başına yeni istemci: maliyet callback'i o akışa bağlı.
    ...(llmAvailable && routerConfig
      ? {
          createLlm: (onUsage: UsageSink): LlmClient =>
            new RoutedLlm(
              routerConfig,
              (decision: ModelRouteDecision) =>
                createLlm({
                  model: decision.model,
                  onUsage: (usage) =>
                    onUsage({
                      ...usage,
                      routeTier: decision.tier,
                      routeReason: decision.reason,
                    }),
                }).client,
              {
                ...(runtimeStore ? { cache: runtimeStore } : {}),
                promptVersion: process.env['VMIND_PROMPT_VERSION'] ?? 'phase2',
                cacheTtlSeconds: Number(process.env['VMIND_LLM_CACHE_TTL_SECONDS'] ?? 86_400),
              },
            ),
        }
      : {}),
  });

  const port = Number(process.env['PORT'] ?? 8080);
  const host = process.env['HOST'] ?? '127.0.0.1';
  server.listen(port, host, () => {
    console.log(`VMind Teklif Ajanı — http://${host}:${port}`);
    console.log(`  kimlik doğrulama : ${auth.kind}`);
    console.log(`  yönetim API'si   : ${adminAuth ? 'ayrı Bearer anahtarıyla açık' : 'kapalı'}`);
    console.log(
      `  public koruma      : ${publicAccess ? `IP-hash limit${publicAccess.turnstileSiteKey ? ' + Turnstile' : ' (yerel bypass)'}` : 'kapalı'}`,
    );
    console.log(
      serviceAuth
        ? `  servis hesabi      : ${serviceAuth.identity.displayName} (${serviceAuth.identity.canPublish ? 'yayinlama yetkili' : 'taslak yetkili'})`
        : `  servis hesabi      : kapali`,
    );
    console.log(`  LLM              : ${llmLabel}`);
    console.log(`  kullanım defteri : ${runtimeStore ? 'PostgreSQL (JSON geri dönüş aynası)' : 'JSON'}`);
    console.log(`  CRM senkronu     : ${crmSync ? 'imzalı site API' : 'kapalı'}`);
    console.log(`  katalog          : ${catalog.products.length} ürün, ${rules.ruleCount} kural`);
    console.log(
      `  harcama sınırı   : günlük $${limits.dailyTotalUsd}, kişi başı $${limits.dailyPerUserUsd}`,
    );
    console.log(
      allowPublish
        ? `  yayınlama        : AÇIK — onaylanan teklif VMind'da KALICI kayıt oluşturur`
        : `  yayınlama        : kapalı (yalnızca dry-run) — açmak için WEB_ALLOW_PUBLISH=1`,
    );
  });
}
