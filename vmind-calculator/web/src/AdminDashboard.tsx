import { useState } from 'react';

import {
  adminApi,
  ApiError,
  type AdminOpportunity,
  type AdminOverview,
  type AdminRun,
  type AdminRunDetail,
} from './api';

const STAGES = [
  'New', 'Need Identified', 'Qualified', 'Calculation Created', 'Proposal Sent',
  'Follow-up', 'Sales Contact Requested', 'Won', 'Lost',
] as const;

const shortDate = (value: string | null): string =>
  value ? new Date(value).toLocaleString('tr-TR') : '—';

function OpportunityEditor({
  item,
  onSaved,
  apiKey,
}: {
  item: AdminOpportunity;
  onSaved: (item: AdminOpportunity) => void;
  apiKey: string;
}) {
  const [stage, setStage] = useState(item.stage);
  const [owner, setOwner] = useState(item.owner);
  const [nextFollowUp, setNextFollowUp] = useState(item.nextFollowUp ?? '');
  const [saving, setSaving] = useState(false);

  return (
    <tr>
      <td>
        <strong>{item.name ?? item.phoneE164}</strong>
        <div>{item.company ?? 'Şirket yok'}</div>
        <div className="muted small">{item.phoneE164}</div>
        <div className="muted tiny">
          {item.communicationStatus} · {item.consentNoticeVersion ?? 'onay sürümü yok'}
        </div>
      </td>
      <td>
        <div className="admin-need">{item.customerNeed}</div>
        <div className="muted small">{item.recommendedService ?? 'Öneri oluşmadı'}</div>
        {item.calculation && (
          <a href={item.calculation.calculatorUrl} target="_blank" rel="noreferrer">
            Calculator #{item.calculation.version}
          </a>
        )}
      </td>
      <td>
        <select value={stage} onChange={(event) => setStage(event.target.value)}>
          {STAGES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <input value={owner} onChange={(event) => setOwner(event.target.value)} aria-label="Sorumlu" />
        <input
          type="date"
          value={nextFollowUp}
          onChange={(event) => setNextFollowUp(event.target.value)}
          aria-label="Takip tarihi"
        />
        <button
          className="ghost"
          disabled={saving || owner.trim().length === 0}
          onClick={async () => {
            setSaving(true);
            try {
              onSaved(await adminApi.updateOpportunity(apiKey, item.opportunityId, {
                stage,
                owner: owner.trim(),
                nextFollowUp: nextFollowUp || null,
              }));
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
      </td>
      <td>
        {item.estimatedAmountMinor === null
          ? '—'
          : `${(item.estimatedAmountMinor / 100).toLocaleString('tr-TR', {
              minimumFractionDigits: 2,
            })} ${item.currency ?? ''}`}
        <div className="muted small">{shortDate(item.updatedAt)}</div>
      </td>
    </tr>
  );
}

export function AdminDashboard() {
  const [apiKey, setApiKey] = useState('');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [runs, setRuns] = useState<AdminRun[]>([]);
  const [opportunities, setOpportunities] = useState<AdminOpportunity[]>([]);
  const [runDetail, setRunDetail] = useState<AdminRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (key: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [nextOverview, nextRuns, nextOpportunities] = await Promise.all([
        adminApi.overview(key), adminApi.runs(key), adminApi.opportunities(key),
      ]);
      setOverview(nextOverview);
      setRuns(nextRuns.items);
      setOpportunities(nextOpportunities.items);
    } catch (caught) {
      setOverview(null);
      setError(caught instanceof ApiError ? caught.message : 'Yönetim verisi alınamadı.');
    } finally {
      setLoading(false);
    }
  };

  if (!overview) {
    return (
      <div className="app login">
        <h1>VMind Yönetim</h1>
        <p className="muted small">
          Bu anahtar müşteri girişinden ayrıdır ve yalnızca bu sekmenin belleğinde tutulur.
        </p>
        <form className="panel" onSubmit={(event) => {
          event.preventDefault();
          void load(apiKey.trim());
        }}>
          <label>
            <span>Admin API anahtarı</span>
            <input type="password" autoComplete="off" value={apiKey}
              onChange={(event) => setApiKey(event.target.value)} />
          </label>
          {error && <p className="error small">{error}</p>}
          <button disabled={loading || apiKey.trim().length < 32} type="submit">
            {loading ? 'Yükleniyor…' : 'Yönetimi aç'}
          </button>
        </form>
        <a href="/" className="muted small">Teklif ekranına dön</a>
      </div>
    );
  }

  return (
    <div className="app admin-app">
      <header className="top">
        <div>
          <h1>VMind Yönetim</h1>
          <div className="muted small">PostgreSQL · {shortDate(overview.generatedAt)}</div>
        </div>
        <div className="row">
          <button className="ghost" onClick={() => void load(apiKey)}>Yenile</button>
          <button className="ghost" onClick={() => {
            setApiKey(''); setOverview(null); setRuns([]); setOpportunities([]); setRunDetail(null);
          }}>Kilitle</button>
          <a href="/" className="cta">Teklif ekranı</a>
        </div>
      </header>

      {error && <p className="error small">{error}</p>}
      <section className="admin-metrics" aria-label="Sistem özeti">
        <div><span>Bugünkü LLM maliyeti</span><strong>${overview.today.costUsd.toFixed(4)}</strong></div>
        <div><span>Bugünkü token</span><strong>{(overview.today.inputTokens + overview.today.outputTokens).toLocaleString('tr-TR')}</strong></div>
        <div><span>Akışlar</span><strong>{overview.runs.total}</strong><small>{overview.runs.failed} hatalı</small></div>
        <div><span>Teklifler</span><strong>{overview.estimates.total}</strong><small>{overview.estimates.published} yayınlandı</small></div>
        <div><span>Açık fırsatlar</span><strong>{overview.crm.openOpportunities}</strong><small>{overview.crm.contacts} kişi</small></div>
      </section>

      <section className="panel admin-section">
        <h2>CRM fırsatları</h2>
        <p className="muted small">Telefon bilgisi kişisel veridir; yalnızca satış takibi amacıyla kullanın.</p>
        <div className="admin-table-wrap"><table className="admin-table">
          <thead><tr><th>Müşteri</th><th>İhtiyaç / teklif</th><th>Satış yönetimi</th><th>Değer</th></tr></thead>
          <tbody>{opportunities.map((item) => (
            <OpportunityEditor key={item.opportunityId} item={item} apiKey={apiKey}
              onSaved={(saved) => setOpportunities((current) => current.map((entry) =>
                entry.opportunityId === saved.opportunityId ? saved : entry))} />
          ))}</tbody>
        </table></div>
      </section>

      <section className="panel admin-section">
        <h2>Son ajan çalıştırmaları</h2>
        <div className="admin-table-wrap"><table className="admin-table">
          <thead><tr><th>Zaman / kullanıcı</th><th>Model</th><th>Durum</th><th>Token / maliyet</th><th /></tr></thead>
          <tbody>{runs.map((run) => (
            <tr key={run.runId}>
              <td>{shortDate(run.startedAt)}<div className="muted small">{run.displayName ?? run.principalKey ?? '—'}</div></td>
              <td>{run.provider}<div className="muted small">{run.model}</div></td>
              <td>{run.status}<div className="muted small">{run.resultStage ?? '—'} · {run.toolCalls} tool</div></td>
              <td>{(run.inputTokens + run.outputTokens).toLocaleString('tr-TR')}<div className="muted small">${run.costUsd.toFixed(4)}</div></td>
              <td><button className="ghost" onClick={async () => {
                try { setRunDetail(await adminApi.run(apiKey, run.runId)); }
                catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Detay alınamadı.'); }
              }}>Detay</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>

      {runDetail && (
        <section className="panel admin-section">
          <div className="row spread"><h2>Çalıştırma detayı</h2><button className="ghost" onClick={() => setRunDetail(null)}>Kapat</button></div>
          <code>{runDetail.run.runId}</code>
          <h3>PII filtreli mesajlar</h3>
          {runDetail.messages.map((message, index) => (
            <div className="admin-message" key={`${message.createdAt}-${index}`}>
              <strong>{message.direction}</strong> · {shortDate(message.createdAt)}
              <pre>{message.contentRedacted ?? '—'}</pre>
            </div>
          ))}
          <details><summary>Denetim olayları ({runDetail.auditEvents.length})</summary>
            <pre>{JSON.stringify(runDetail.auditEvents, null, 2)}</pre>
          </details>
        </section>
      )}
    </div>
  );
}
