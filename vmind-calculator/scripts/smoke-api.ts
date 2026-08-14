import assert from 'node:assert/strict';

const baseUrl = process.env['VMIND_SMOKE_BASE_URL']?.replace(/\/$/, '');
const apiKey = process.env['VMIND_SMOKE_SERVICE_KEY'];
if (!baseUrl || !apiKey) {
  throw new Error('VMIND_SMOKE_BASE_URL ve VMIND_SMOKE_SERVICE_KEY gerekli.');
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`);
  }
  return response;
}

const live = await (await fetch(`${baseUrl}/api/health/live`)).json() as { status?: string };
assert.equal(live.status, 'live');

const started = await (await request('/api/flow/guided', {
  method: 'POST',
  body: JSON.stringify({
    config: {
      profile: 'recommended', workload: 'web', exposure: 'public', capacity: 'powerful',
      instanceCount: 2, diskTier: 'premium', diskGb: 500, loadBalancer: 'app',
      backupCount: 4, egressGb: 1024, floatingIpCount: 1, currency: 'TL', notes: '',
    },
  }),
})).json() as { sessionId: string; route?: string };
assert.match(started.sessionId, /^[0-9a-f-]{36}$/i);
assert.equal(started.route, 'tool-first');

let completed: Record<string, unknown> | undefined;
for (let turn = 0; turn < 30; turn += 1) {
  const view = await (await request(`/api/flow/${started.sessionId}?wait=2000`)).json() as {
    state: string;
    spentUsd: number;
    error: string | null;
    gate: null | { kind: string; id: string; questions?: Array<{ ruleId: string }> };
    result: null | Record<string, unknown>;
  };
  if (view.state === 'failed') throw new Error(view.error ?? 'Akış başarısız.');
  if (view.state === 'done') {
    assert.equal(view.spentUsd, 0);
    assert.equal(view.result?.['published'], false);
    const price = view.result?.['price'] as { totalMonthCost?: number } | undefined;
    assert.ok((price?.totalMonthCost ?? 0) > 0);
    completed = view.result ?? undefined;
    break;
  }
  if (!view.gate) continue;
  const payload = view.gate.kind === 'questions'
    ? (view.gate.questions ?? []).map((question) => ({ ruleId: question.ruleId }))
    : view.gate.kind === 'approve'
      ? { approved: true, publish: false }
      : {};
  await request(`/api/flow/${started.sessionId}/answer`, {
    method: 'POST',
    body: JSON.stringify({ gateId: view.gate.id, payload }),
  });
}

assert.ok(completed, 'Guided dry-run 30 tur içinde tamamlanmadı.');
await request(`/api/flow/${started.sessionId}/close`, { method: 'POST' });
process.stdout.write(`${JSON.stringify({ ok: true, route: 'tool-first', published: false, spentUsd: 0 })}\n`);
