/**
 * Sunucu sözleşmesi — tek yer.
 *
 * Oturum HttpOnly çerezle taşınıyor; tarayıcı JS'i token'a HİÇ dokunmuyor.
 * Bu yüzden burada `credentials: 'same-origin'` dışında kimlik yönetimi yok.
 */

export interface AuthField {
  name: string;
  label: string;
  secret: boolean;
}

export interface AuthConfig {
  kind: 'shared-secret' | 'vmind-token' | 'disabled';
  fields: AuthField[];
}

export interface Me {
  displayName: string;
  llm: string;
  budget: { total: number | null; user: number | null };
  catalog: { products: number; flavors: number };
  rules: number;
  publishEnabled: boolean;
  crmEnabled: boolean;
}

export interface CustomerCrmContext {
  phoneE164: string;
  name?: string;
  company?: string;
}

export interface FlowEvent {
  stage: string;
  message: string;
}

export interface CriticalUnknown {
  question: string;
  reason: string;
}

export interface AuditQuestion {
  ruleId: string;
  question: string;
  defaultAnswer: string;
  severity: 'blocker' | 'recommended' | 'optional';
}

export interface PriceLine {
  productName?: string;
  count?: string | number;
  hourly?: string | number;
  monthly?: string | number;
  service?: string;
}

export interface PriceSnapshot {
  currency: string;
  lines: PriceLine[];
  totalHourCost: number;
  totalMonthCost: number;
}

export interface Gap {
  ruleId: string;
  severity: 'blocker' | 'recommended' | 'optional';
  message: string;
}

export interface AuditReport {
  summary: string;
  gaps: Gap[];
  contextualNotes: string[];
  publishable: boolean;
}

export interface AssumptionRecord {
  ruleId: string;
  question: string;
  assumed: string;
}

export interface RequirementSpec {
  customerName?: string;
  currency?: 'TL' | 'USD';
  workload?: string;
  internetFacingRoles?: string[];
  compute?: {
    count?: number;
    sizeHint?: string;
    needsGpu?: boolean;
    highMemory?: boolean;
    storage?: { tier: 'premium' | 'standard' | 'unspecified'; sizeGbPerInstance?: number };
  };
  computeGroups?: Array<{
    role: string;
    count?: number;
    vcpuPerInstance?: number;
    ramGbPerInstance?: number;
    sizeHint?: string;
    software?: string[];
    needsGpu?: boolean;
    highMemory?: boolean;
    storage?: { tier: 'premium' | 'standard' | 'unspecified'; sizeGbPerInstance?: number };
    backup?: {
      kind: 'snapshot' | 'pitr' | 'unspecified';
      countPerMonth?: number;
      sourceSizeGb?: number;
    };
  }>;
  scenarioRequests?: Array<{
    kind: 'ha' | 'commitment' | 'architecture-alternative';
    label: string;
    termYears?: 1 | 2 | 3;
    details?: string;
  }>;
  egressBandwidthMbps?: number;
  egressUtilizationPercent?: number;
  kubernetes?: { masterCount?: number; workerCount?: number };
  loadBalancer?: { kind: 'app' | 'net' | 'unspecified' };
  standaloneStorage?: { tier: 'premium' | 'standard' | 'unspecified'; sizeGb?: number };
  objectStorage?: { sizeGb?: number };
  backup?: { countPerMonth?: number; sourceSizeGb?: number };
  egressGb?: number;
  floatingIpCount?: number;
  router?: { egressGb?: number; floatingIpCount?: number };
  unknowns: string[];
  rationale: string;
}

export interface EstimateDraft {
  choices: Array<{ service: string; itemId: string; rationale: string }>;
  finalText: string;
  rejectedToolCalls: number;
  scenarioNotes: Array<{
    kind: 'baseline' | 'ha' | 'commitment' | 'architecture-alternative';
    label: string;
    status: 'current-estimate' | 'needs-input' | 'catalog-unavailable';
    message: string;
    termYears?: 1 | 2 | 3;
  }>;
}

export interface EstimateState {
  id: string;
  name: string;
  currency: 'TL' | 'USD';
  list: Array<{ id: string; service: string; data: Record<string, unknown> }>;
}

export interface PublishSummary {
  price?: PriceSnapshot;
  audit?: AuditReport;
  assumptions: AssumptionRecord[];
  estimate: EstimateState;
  spec?: RequirementSpec;
  draft?: EstimateDraft;
}

export type Gate =
  | { kind: 'clarify'; id: string; unknowns: CriticalUnknown[] }
  | { kind: 'questions'; id: string; round: number; questions: AuditQuestion[] }
  | { kind: 'approve'; id: string; summary: PublishSummary };

export interface ReconcileResult {
  ok: boolean;
  monthlyDiff: number;
  message: string;
}

export interface FlowResult {
  stage: string;
  spec?: RequirementSpec;
  draft?: EstimateDraft;
  audit?: AuditReport;
  price?: PriceSnapshot;
  assumptions: AssumptionRecord[];
  rounds: number;
  published: boolean;
  /** `calculator.portvmind.com/my-estimate/{id}` — sistemin asıl teslimatı. */
  shareUrl?: string;
  /** Kaydedilen teklif geri okunup tutar karşılaştırıldı mı. */
  reconcile?: ReconcileResult;
  haltReason?: string;
}

export interface SessionView {
  sessionId: string;
  state: 'running' | 'waiting' | 'done' | 'failed' | 'expired';
  events: FlowEvent[];
  gate: Gate | null;
  result: FlowResult | null;
  error: string | null;
  spentUsd: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Kota hatalarında 'total' | 'user'. */
    readonly scope?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Gövdesiz yanıt (204 vb.) olabilir.
  }

  if (!response.ok) {
    const payload = (body ?? {}) as { error?: string; scope?: string };
    throw new ApiError(
      response.status,
      payload.error ?? `Sunucu ${response.status} döndü.`,
      payload.scope,
    );
  }
  return body as T;
}

export const api = {
  authConfig: () => call<AuthConfig>('/api/auth/config'),

  login: (input: Record<string, string>) =>
    call<{ displayName: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  logout: () => call<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  me: () => call<Me>('/api/me'),

  startFlow: (salesText: string, customer?: CustomerCrmContext) =>
    call<{ sessionId: string }>('/api/flow', {
      method: 'POST',
      body: JSON.stringify({ salesText, ...(customer ? { customer } : {}) }),
    }),

  /**
   * Akışın durumunu okur.
   *
   * `waitMs` verilirse sunucu DEĞİŞİKLİK OLANA KADAR bekler (uzun yoklama).
   * Sabit aralıklı yoklamaya göre iki kazancı var: aşama olayları anında
   * görünüyor, ve boşa dönen istek sayısı düşüyor.
   */
  flow: (sessionId: string, waitMs = 0) =>
    call<SessionView>(`/api/flow/${sessionId}${waitMs > 0 ? `?wait=${waitMs}` : ''}`),

  answer: (sessionId: string, gateId: string, payload: unknown) =>
    call<{ accepted: boolean; view: SessionView }>(`/api/flow/${sessionId}/answer`, {
      method: 'POST',
      body: JSON.stringify({ gateId, payload }),
    }),

  edit: (sessionId: string, gateId: string, instruction: string) =>
    call<{ accepted: boolean; message?: string; view: SessionView }>(
      `/api/flow/${sessionId}/edit`,
      {
        method: 'POST',
        body: JSON.stringify({ gateId, instruction }),
      },
    ),

  close: (sessionId: string) =>
    call<{ ok: true }>(`/api/flow/${sessionId}/close`, { method: 'POST' }),
};

/** Fiyatları Türkçe biçimde gösterir. */
export const money = (value: number, currency: string): string =>
  `${value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
