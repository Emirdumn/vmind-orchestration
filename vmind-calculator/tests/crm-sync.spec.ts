import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import type { FlowResult } from '../src/agents/orchestrator.js';
import {
  SiteCrmSyncClient,
  buildCrmQuotePayload,
  crmSyncFromEnv,
  normalizeCustomerPhone,
} from '../src/web/crm-sync.js';

const flowResult = (published = true): FlowResult => ({
  stage: 'done',
  spec: {
    workload: 'web uygulaması',
    compute: { count: 2, sizeHint: '4 vCPU / 8 GB RAM' },
    loadBalancer: { kind: 'app' },
    networkExposure: 'public',
    egressGb: 1024,
    floatingIpCount: 1,
    unknowns: [],
    rationale: 'Ham kullanıcı cümlesi CRM tarafına gönderilmemeli.',
  },
  draft: {
    choices: [
      { service: 'compute', itemId: 'c1', rationale: 'iki sunucu' },
      { service: 'load-balancer', itemId: 'lb1', rationale: 'yüksek erişilebilirlik' },
    ],
    finalText: 'LLM serbest metni CRM gövdesinde kullanılmamalı.',
    rejectedToolCalls: 0,
    rejections: [],
    scenarioNotes: [],
  },
  audit: { summary: 'temiz', gaps: [], questions: [], contextualNotes: [], publishable: true },
  price: {
    currency: 'TL',
    totalHourCost: 5,
    totalMonthCost: 3991.92,
    lines: [
      { productName: 'g1.large', count: 2, hourly: 3.63, monthly: 2613.6 },
      { productName: 'App Load Balancer', count: 1, hourly: 2.18, monthly: 1566.22 },
    ],
  },
  assumptions: [],
  rounds: 1,
  published,
  events: [],
  ...(published
    ? { shareUrl: 'https://calculator.portvmind.com/my-estimate/ddd598c7-97fd-4161-8373-286e9b48b622' }
    : {}),
});

describe('site -> CRM payload', () => {
  it('yerel Turk telefonlarini E.164 bicimine ceviriyor', () => {
    expect(normalizeCustomerPhone('0555 123 45 67')).toBe('+905551234567');
    expect(normalizeCustomerPhone('555 123 45 67')).toBe('+905551234567');
    expect(normalizeCustomerPhone('+44 7418 375743')).toBe('+447418375743');
    expect(normalizeCustomerPhone('123')).toBeNull();
  });

  it('ham prompt yerine yapisal ihtiyac ve katalog sonucunu tasiyor', () => {
    const sessionId = randomUUID();
    const payload = buildCrmQuotePayload({
      flowSessionId: sessionId,
      customer: {
        phoneE164: '0555 123 45 67',
        name: 'Deniz',
        company: 'Örnek AŞ',
        privacyConsent: true,
        privacyNoticeVersion: '2026-08-14',
      },
      result: flowResult(),
    }) as Record<string, any>;

    expect(payload.event_id).toBe(`site-quote:${sessionId}`);
    expect(payload.customer.phone_e164).toBe('+905551234567');
    expect(payload.customer.communication_status).toBe('opted_in');
    expect(payload.customer.consent_notice_version).toBe('2026-08-14');
    expect(payload.opportunity.customer_need).toContain('Compute: 2 adet');
    expect(payload.opportunity.customer_need).not.toContain('Ham kullanıcı cümlesi');
    expect(payload.opportunity.recommended_service).toBe('compute, load-balancer');
    expect(payload.calculation.currency).toBe('TRY');
    expect(payload.calculation.estimated_amount).toBe(3991.92);
    expect(payload.calculation.configuration_summary).toContain('g1.large × 2');
  });

  it('yayinlanmamis sonuc icin opportunity yollar, sahte calculator linki uretmez', () => {
    const payload = buildCrmQuotePayload({
      flowSessionId: randomUUID(),
      customer: {
        phoneE164: '+905551234567',
        privacyConsent: true,
        privacyNoticeVersion: '2026-08-14',
      },
      result: flowResult(false),
    });
    expect(payload).not.toHaveProperty('calculation');
  });
});

describe('SiteCrmSyncClient', () => {
  it('govdeyi HMAC ile imzalayip yalniz sunucudan gonderiyor', async () => {
    const secret = 'calculator-to-crm-test-secret-32-bytes-minimum';
    const now = 1_786_698_000_000;
  const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = String(init?.body ?? '');
      const headers = new Headers(init?.headers);
      const timestamp = headers.get('x-vmind-crm-timestamp')!;
      const expected = createHmac('sha256', secret)
        .update(`${timestamp}.${body}`)
        .digest('hex');
      expect(headers.get('x-vmind-crm-signature')).toBe(`v1=${expected}`);
      expect(init?.method).toBe('POST');
      return new Response(
        JSON.stringify({
          ok: true,
          event_id: 'site-quote:test',
          contact_id: randomUUID(),
          phone: '+***4567',
          opportunity: { opportunity_id: randomUUID(), stage: 'Calculation Created' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    const client = new SiteCrmSyncClient(
      'http://127.0.0.1:18790/vmind-crm/v1/site/quotes',
      secret,
      fetchMock as typeof fetch,
      () => now,
    );
    const result = await client.syncQuote({
      flowSessionId: randomUUID(),
      customer: {
        phoneE164: '+905551234567',
        privacyConsent: true,
        privacyNoticeVersion: '2026-08-14',
      },
      result: flowResult(),
    });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('acik internette sifresiz HTTP hedefine izin vermiyor', () => {
    expect(
      () => new SiteCrmSyncClient('http://example.com/crm', 'x'.repeat(32)),
    ).toThrow(/HTTPS/);
  });

  it('URL ve sir birlikte verilmediyse acilista reddediyor', () => {
    expect(() => crmSyncFromEnv({ VMIND_CRM_SITE_URL: 'https://crm.example.com' })).toThrow(
      /birlikte/,
    );
  });
});
