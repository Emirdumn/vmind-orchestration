import { createHmac } from 'node:crypto';

import type { FlowResult } from '../agents/orchestrator.js';

const REQUEST_TIMEOUT_MS = 5_000;

export interface CrmCustomerContext {
  phoneE164: string;
  name?: string;
  company?: string;
}

export interface CrmSyncInput {
  flowSessionId: string;
  customer: CrmCustomerContext;
  result: FlowResult;
}

export interface CrmSyncResult {
  ok: true;
  event_id: string;
  contact_id: string;
  phone: string;
  opportunity: { opportunity_id: string; stage: string };
  calculation?: { calculation_id: string; calculator_id: string; version: number };
  calculation_created?: boolean;
}

export interface CrmSync {
  syncQuote(input: CrmSyncInput): Promise<CrmSyncResult>;
}

export class CrmSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrmSyncError';
  }
}

function text(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maxLength);
}

/** Form girdisini E.164'e cevirir; telefon LLM'e veya ham prompta girmez. */
export function normalizeCustomerPhone(value: string): string | null {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) digits = `90${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith('5')) digits = `90${digits}`;
  if (digits.length < 10 || digits.length > 15 || digits.startsWith('0')) return null;
  return `+${digits}`;
}

function requirementSummary(result: FlowResult): string {
  const spec = result.spec;
  const parts: string[] = [];
  if (spec?.workload) parts.push(`İş yükü: ${spec.workload}`);
  if (spec?.compute?.count) {
    parts.push(
      `Compute: ${spec.compute.count} adet${spec.compute.sizeHint ? ` (${spec.compute.sizeHint})` : ''}`,
    );
  }
  for (const group of spec?.computeGroups ?? []) {
    parts.push(
      `${group.role}: ${group.count ?? '?'} adet` +
        `${group.vcpuPerInstance ? `, ${group.vcpuPerInstance} vCPU` : ''}` +
        `${group.ramGbPerInstance ? `, ${group.ramGbPerInstance} GB RAM` : ''}`,
    );
  }
  if (spec?.kubernetes) {
    parts.push(
      `Kubernetes: ${spec.kubernetes.masterCount ?? '?'} master, ` +
        `${spec.kubernetes.workerCount ?? '?'} worker`,
    );
  }
  if (spec?.loadBalancer) parts.push(`Load Balancer: ${spec.loadBalancer.kind}`);
  if (spec?.standaloneStorage?.sizeGb) {
    parts.push(`Block Storage: ${spec.standaloneStorage.sizeGb} GB`);
  }
  if (spec?.objectStorage?.sizeGb) parts.push(`Object Storage: ${spec.objectStorage.sizeGb} GB`);
  if (spec?.backup?.sourceSizeGb) parts.push(`Backup kaynağı: ${spec.backup.sourceSizeGb} GB`);
  if (spec?.networkExposure) parts.push(`Ağ erişimi: ${spec.networkExposure}`);
  if (spec?.egressGb) parts.push(`Outbound: ${spec.egressGb} GB/ay`);
  if (spec?.floatingIpCount) parts.push(`Floating IP: ${spec.floatingIpCount}`);
  return (parts.join('; ') || 'Yapılandırılmış VMind altyapı teklifi').slice(0, 2_000);
}

function recommendedServices(result: FlowResult): string | undefined {
  const services = [...new Set((result.draft?.choices ?? []).map((choice) => choice.service))];
  return services.length > 0 ? services.join(', ').slice(0, 500) : undefined;
}

function configurationSummary(result: FlowResult): string {
  const lines = result.price?.lines ?? [];
  const summary = lines
    .map((line) => {
      const product = text(line.productName, 240) ?? text(line.service, 120) ?? 'Ürün';
      const count = line.count === undefined ? '' : ` × ${String(line.count).slice(0, 80)}`;
      return `${product}${count}`;
    })
    .join('; ');
  return (summary || 'VMind Calculator yapılandırması').slice(0, 4_000);
}

function calculatorId(shareUrl: string): string {
  const parsed = new URL(shareUrl);
  const id = parsed.pathname.split('/').filter(Boolean).at(-1);
  if (!id || id.length > 160) throw new CrmSyncError('Calculator bağlantısında kimlik bulunamadı.');
  return id;
}

export function buildCrmQuotePayload(input: CrmSyncInput): Record<string, unknown> {
  const phone = normalizeCustomerPhone(input.customer.phoneE164);
  if (!phone) throw new CrmSyncError('Müşteri telefonu geçerli E.164 biçimine çevrilemedi.');
  const recommended = recommendedServices(input.result);
  const calculation = input.result.shareUrl && input.result.price
    ? {
        calculator_id: calculatorId(input.result.shareUrl),
        calculator_url: input.result.shareUrl,
        configuration_summary: configurationSummary(input.result),
        estimated_amount: input.result.price.totalMonthCost,
        currency: input.result.price.currency === 'TL' ? 'TRY' : input.result.price.currency,
      }
    : undefined;

  return {
    event_id: `site-quote:${input.flowSessionId}`,
    flow_session_id: input.flowSessionId,
    customer: {
      phone_e164: phone,
      ...(text(input.customer.name, 160) ? { name: text(input.customer.name, 160) } : {}),
      ...(text(input.customer.company, 240) ? { company: text(input.customer.company, 240) } : {}),
    },
    opportunity: {
      customer_need: requirementSummary(input.result),
      ...(recommended ? { recommended_service: recommended } : {}),
      qualified: Boolean(input.result.price && input.result.audit?.publishable),
    },
    ...(calculation ? { calculation } : {}),
  };
}

function isPrivateHttpTarget(url: URL): boolean {
  if (url.protocol !== 'http:') return false;
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(url.hostname);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return false;
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export class SiteCrmSyncClient implements CrmSync {
  private readonly endpoint: URL;

  constructor(
    endpoint: string,
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.endpoint = new URL(endpoint);
    if (this.endpoint.username || this.endpoint.password) {
      throw new Error('VMIND_CRM_SITE_URL kullanıcı bilgisi içeremez.');
    }
    if (this.endpoint.protocol !== 'https:' && !isPrivateHttpTarget(this.endpoint)) {
      throw new Error('VMIND_CRM_SITE_URL HTTPS veya özel/yerel tünel adresi olmalıdır.');
    }
    if (secret.length < 32) throw new Error('VMIND_CRM_SITE_SECRET en az 32 karakter olmalıdır.');
  }

  async syncQuote(input: CrmSyncInput): Promise<CrmSyncResult> {
    const rawBody = JSON.stringify(buildCrmQuotePayload(input));
    const timestamp = String(Math.floor(this.now() / 1000));
    const signature = createHmac('sha256', this.secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-VMind-CRM-Timestamp': timestamp,
          'X-VMind-CRM-Signature': `v1=${signature}`,
        },
        body: rawBody,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new CrmSyncError('CRM bağlantısına ulaşılamadı.');
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new CrmSyncError(`CRM geçersiz yanıt verdi (${response.status}).`);
    }
    if (!response.ok || !payload || typeof payload !== 'object' || (payload as { ok?: unknown }).ok !== true) {
      throw new CrmSyncError(`CRM senkronu reddedildi (${response.status}).`);
    }
    return payload as CrmSyncResult;
  }
}

export function crmSyncFromEnv(env: NodeJS.ProcessEnv = process.env): CrmSync | undefined {
  const endpoint = String(env['VMIND_CRM_SITE_URL'] ?? '').trim();
  const secret = String(env['VMIND_CRM_SITE_SECRET'] ?? '').trim();
  if (!endpoint && !secret) return undefined;
  if (!endpoint || !secret) {
    throw new Error('VMIND_CRM_SITE_URL ve VMIND_CRM_SITE_SECRET birlikte tanımlanmalıdır.');
  }
  return new SiteCrmSyncClient(endpoint, secret);
}
