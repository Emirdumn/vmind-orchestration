import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, api, type AuthConfig, type CustomerCrmContext, type Me } from './api';
import {
  ApproveGate,
  ApprovalEditPanel,
  Assumptions,
  AuditPanel,
  ClarifyGate,
  Events,
  PriceTable,
  QuestionsGate,
  RecommendationsPanel,
  RequirementOverview,
} from './components';
import { AdminDashboard } from './AdminDashboard';
import { GuidedQuoteBuilder } from './GuidedQuoteBuilder';
import { useFlow } from './useFlow';

const ORNEK =
  'Müşteri 4 sunucu istiyor, her birine 200 GB premium disk, aylık 2 TB internet trafiği, önüne uygulama load balancer koyalım.';

declare global {
  interface Window {
    turnstile?: {
      render: (
        element: HTMLElement,
        options: {
          sitekey: string;
          theme: 'auto';
          size: 'flexible';
          callback: (token: string) => void;
          'expired-callback': () => void;
          'error-callback': () => void;
        },
      ) => string;
      remove: (widgetId: string) => void;
    };
  }
}

function TurnstileWidget({
  siteKey,
  resetKey,
  onToken,
}: {
  siteKey: string;
  resetKey: number;
  onToken: (token: string | null) => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;
    const render = (): void => {
      if (cancelled || !host.current || !window.turnstile) return;
      widgetId = window.turnstile.render(host.current, {
        sitekey: siteKey,
        theme: 'auto',
        size: 'flexible',
        callback: (token) => onToken(token),
        'expired-callback': () => onToken(null),
        'error-callback': () => onToken(null),
      });
    };

    if (window.turnstile) {
      render();
    } else {
      const source = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      let script = document.querySelector<HTMLScriptElement>(`script[src="${source}"]`);
      if (!script) {
        script = document.createElement('script');
        script.src = source;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      script.addEventListener('load', render, { once: true });
    }

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
      onToken(null);
    };
  }, [siteKey, resetKey, onToken]);

  return <div className="turnstile-box" ref={host} aria-label="Robot doğrulaması" />;
}

export default function App() {
  return window.location.pathname.startsWith('/admin') ? <AdminDashboard /> : <CustomerApp />;
}

function CustomerApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [booting, setBooting] = useState(true);

  const refreshMe = useCallback(async () => {
    try {
      setMe(await api.me());
    } catch {
      setMe(null);
      // Oturum yoksa giriş formunun şeklini öğren.
      try {
        const config = await api.authConfig();
        setAuthConfig(config);
        if (config.automatic) {
          await api.login({});
          setMe(await api.me());
        }
      } catch {
        setAuthConfig(null);
      }
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  if (booting) return <div className="app muted">Yükleniyor…</div>;
  if (!me) return <Login config={authConfig} onDone={refreshMe} />;
  return <Workspace me={me} onLogout={refreshMe} onSpend={refreshMe} />;
}

// ---------------------------------------------------------------------------

function Login({ config, onDone }: { config: AuthConfig | null; onDone: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(values);
      onDone();
    } catch (caught) {
      setError((caught as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app login">
      <h1 style={{ fontSize: 20 }}>VMind Teklif Ajanı</h1>
      {config?.kind === 'vmind-token' && (
        <p className="muted small">
          VMind konsoluna girdikten sonra oturum token’ınızı buraya yapıştırın. Token
          sunucuda kalır; tarayıcıya geri gönderilmez ve diske yazılmaz.
        </p>
      )}
      <form className="panel" onSubmit={submit}>
        {(config?.fields ?? []).map((field) => (
          <label key={field.name}>
            <span>{field.label}</span>
            <input
              type={field.secret ? 'password' : 'text'}
              autoComplete={field.secret ? 'current-password' : 'username'}
              value={values[field.name] ?? ''}
              onChange={(event) =>
                setValues((previous) => ({ ...previous, [field.name]: event.target.value }))
              }
            />
          </label>
        ))}
        {error && <p className="error small">{error}</p>}
        <button disabled={busy} type="submit">
          {busy ? 'Kontrol ediliyor…' : 'Giriş'}
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Workspace({
  me,
  onLogout,
  onSpend,
}: {
  me: Me;
  onLogout: () => void;
  onSpend: () => void;
}) {
  const [text, setText] = useState('');
  const [customer, setCustomer] = useState<{
    phoneE164: string;
    name?: string;
    company?: string;
    privacyConsent: boolean;
  }>({ phoneE164: '', privacyConsent: false });
  const [formError, setFormError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);
  const { view, error, starting, start, answer, edit, reset } = useFlow();

  const crmCustomer: CustomerCrmContext | undefined =
    customer.phoneE164.trim() && customer.privacyConsent && me.privacyNoticeVersion
    ? {
        phoneE164: customer.phoneE164,
        ...(customer.name?.trim() ? { name: customer.name.trim() } : {}),
        ...(customer.company?.trim() ? { company: customer.company.trim() } : {}),
        privacyConsent: true,
        privacyNoticeVersion: me.privacyNoticeVersion,
      }
    : undefined;
  const beginFlow = (salesText: string): void => {
    setFormError(null);
    if (customer.phoneE164.trim() && !customer.privacyConsent) {
      setFormError('Telefon bilgisini CRM’e kaydetmek için veri işleme onayı gereklidir.');
      return;
    }
    if (customer.phoneE164.trim() && !me.privacyNoticeVersion) {
      setFormError('Gizlilik bildirimi sürümü yapılandırılmadığı için müşteri kaydı alınamıyor.');
      return;
    }
    if (me.turnstileSiteKey && !turnstileToken) {
      setFormError('Devam etmek için robot doğrulamasını tamamlayın.');
      return;
    }
    const proof = turnstileToken ?? undefined;
    if (me.turnstileSiteKey) {
      setTurnstileToken(null);
      setTurnstileReset((current) => current + 1);
    }
    void start(salesText, crmCustomer, proof);
  };
  const resetWorkspace = (): void => {
    reset();
    setText('');
    setCustomer({ phoneE164: '', privacyConsent: false });
    setFormError(null);
  };

  // Akış bitince kalan bütçeyi tazele — satışçı ne harcadığını görsün.
  useEffect(() => {
    if (view?.state === 'done' || view?.state === 'failed') onSpend();
  }, [view?.state, onSpend]);

  const gate = view?.gate ?? null;
  const running = view !== null && (view.state === 'running' || view.state === 'waiting');

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>VMind Teklif Ajanı</h1>
          <div className="muted small">
            {me.catalog.products} ürün · {me.catalog.flavors} instance tipi · {me.rules} kural
          </div>
        </div>
        <div className="meta">
          <div>{me.displayName}</div>
          <div>{me.llm}</div>
          {me.budget.user !== null && <div>kalan bütçeniz: ${me.budget.user.toFixed(2)}</div>}
          <div style={{ marginTop: 6 }}>
            <span className={`badge ${me.publishEnabled ? 'warn' : 'ok'}`}>
              {me.publishEnabled ? 'YAYINLAMA AÇIK' : 'yayınlama kapalı'}
            </span>
          </div>
          <button
            className="ghost"
            style={{ marginTop: 8, padding: '4px 10px', fontSize: 12 }}
            onClick={async () => {
              await api.logout();
              onLogout();
            }}
          >
            Çıkış
          </button>
        </div>
      </header>

      {!view && (
        <div className="panel">
          {me.crmEnabled && (
            <details className="customer-context">
              <summary>Müşteri bilgileri <span>(CRM kaydı için isteğe bağlı)</span></summary>
              <div className="guided-details">
                <label>
                  <span>Telefon</span>
                  <input
                    type="tel"
                    autoComplete="tel"
                    value={customer.phoneE164}
                    onChange={(event) =>
                      setCustomer((previous) => ({ ...previous, phoneE164: event.target.value }))
                    }
                    placeholder="0555 123 45 67"
                  />
                </label>
                <label>
                  <span>Ad / yetkili</span>
                  <input
                    value={customer.name ?? ''}
                    onChange={(event) =>
                      setCustomer((previous) => ({ ...previous, name: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Şirket</span>
                  <input
                    value={customer.company ?? ''}
                    onChange={(event) =>
                      setCustomer((previous) => ({ ...previous, company: event.target.value }))
                    }
                  />
                </label>
              </div>
              <p className="muted small">
                Telefon girilirse ihtiyaç ve Calculator sonucu otomatik olarak aynı müşteri fırsatına
                bağlanır. Bu bilgiler LLM’e gönderilmez.
              </p>
              <label className="privacy-consent">
                <input
                  type="checkbox"
                  checked={customer.privacyConsent}
                  onChange={(event) =>
                    setCustomer((previous) => ({
                      ...previous,
                      privacyConsent: event.target.checked,
                    }))
                  }
                />
                <span>
                  İletişim bilgilerimin teklifin hazırlanması ve satış takibi amacıyla işlenmesini
                  kabul ediyorum. Bildirim: {me.privacyNoticeVersion ?? 'yapılandırılmadı'}
                </span>
              </label>
            </details>
          )}
          {me.turnstileSiteKey && (
            <TurnstileWidget
              siteKey={me.turnstileSiteKey}
              resetKey={turnstileReset}
              onToken={setTurnstileToken}
            />
          )}
          <GuidedQuoteBuilder
            starting={starting}
            onStart={beginFlow}
            onEditText={(guidedText) => {
              setText(guidedText);
              requestAnimationFrame(() =>
                document.querySelector('#custom-request')?.scrollIntoView({ behavior: 'smooth' }),
              );
            }}
          />
          <div className="custom-request" id="custom-request">
            <h2>Veya yazarak özelleştir</h2>
            <p className="muted small" style={{ marginTop: 0 }}>
              Hazır seçimleri metne aktarıp değiştirebilir veya ihtiyacınızı kendi cümlelerinizle
              anlatabilirsiniz.
            </p>
          <textarea
            rows={4}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={ORNEK}
          />
          <div className="row">
            <button
              disabled={starting || text.trim().length === 0}
              onClick={() => beginFlow(text)}
            >
              {starting ? 'Başlatılıyor…' : 'Teklif hazırla'}
            </button>
            <button className="ghost" onClick={() => setText(ORNEK)}>
              Örnek cümleyi doldur
            </button>
          </div>
          </div>
          <div className="scope-chips" aria-label="Değerlendirilen hizmetler">
            {[
              'Compute',
              'Block Storage',
              'Data Transfer',
              'Floating IP',
              'Load Balancer',
              'Kubernetes',
              'Object Storage',
              'Router',
              'Backup',
            ].map((service) => (
              <span key={service}>{service}</span>
            ))}
          </div>
          {(formError || error) && <p className="error small">{formError ?? error}</p>}
        </div>
      )}

      {view && (
        <>
          <Events events={view.events} />

          {gate?.kind === 'clarify' && (
            <ClarifyGate
              unknowns={gate.unknowns}
              onSubmit={(answers) => void answer(gate.id, answers)}
            />
          )}

          {gate?.kind === 'questions' && (
            <QuestionsGate
              questions={gate.questions}
              round={gate.round}
              onSubmit={(answers) => void answer(gate.id, answers)}
            />
          )}

          {gate?.kind === 'approve' && (
            <>
              <RequirementOverview
                spec={gate.summary.spec}
                draft={gate.summary.draft}
                audit={gate.summary.audit}
              />
              {gate.summary.price && <PriceTable price={gate.summary.price} />}
              {gate.summary.audit && <AuditPanel audit={gate.summary.audit} />}
              <ApprovalEditPanel
                summary={gate.summary}
                onEdit={(instruction) => edit(gate.id, instruction)}
              />
              <Assumptions assumptions={gate.summary.assumptions} />
              <ApproveGate
                summary={gate.summary}
                publishEnabled={me.publishEnabled}
                onDecide={(approved) =>
                  void answer(gate.id, {
                    approved,
                    publish: approved && me.publishEnabled,
                    approvedBy: me.displayName,
                  })
                }
              />
            </>
          )}

          {running && !gate && <p className="muted small">Ajan çalışıyor…</p>}

          {view.state === 'done' && view.result && (
            <>
              <RequirementOverview
                spec={view.result.spec}
                draft={view.result.draft}
                audit={view.result.audit}
              />
              {view.result.audit && <AuditPanel audit={view.result.audit} />}
              <RecommendationsPanel audit={view.result.audit} />
              {view.result.price && <PriceTable price={view.result.price} />}
              <Assumptions assumptions={view.result.assumptions} />
              <div className="panel">
                <h2>Sonuç</h2>

                {/*
                  Sistemin asıl teslimatı bu link. Satışçı buraya tıklayınca
                  calculator KENDİ arayüzünde, kalemler dolu ve düzenlenebilir
                  halde açılır — elle tek tek girmenin yerine geçen şey bu.
                */}
                {view.result.shareUrl ? (
                  <>
                    <p>Teklif hazır ve VMind'a kaydedildi.</p>
                    <div className="row">
                      <a
                        href={view.result.shareUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="cta"
                      >
                        Calculator'da aç →
                      </a>
                      <button
                        className="ghost"
                        onClick={() => {
                          void navigator.clipboard?.writeText(view.result!.shareUrl!);
                        }}
                      >
                        Linki kopyala
                      </button>
                    </div>
                    <p className="muted small" style={{ marginTop: 10 }}>
                      Kalemler düzenlenebilir; calculator üzerinde değişiklik yapıp
                      müşteriyle paylaşabilirsiniz.
                    </p>
                    <p className="muted small">
                      <code>{view.result.shareUrl}</code>
                    </p>
                  </>
                ) : (
                  <p>
                    Yayınlandı: <strong>HAYIR</strong>
                    {view.result.haltReason && ` — ${view.result.haltReason}`}
                  </p>
                )}

                {view.result.reconcile && !view.result.reconcile.ok && (
                  // Mutabakatsızlık sessiz kalmamalı: kaydedilen teklifin
                  // tutarı bizim gösterdiğimizden farklıysa satışçı bilmeli.
                  <p className="error small">
                    Uyarı: kaydedilen teklifin tutarı gösterilenden farklı —{' '}
                    {view.result.reconcile.message}
                  </p>
                )}

                <p className="muted small">Bu çalıştırma: ${view.spentUsd.toFixed(4)}</p>
                <button className="ghost" onClick={resetWorkspace}>
                  Yeni teklif
                </button>
              </div>
            </>
          )}

          {(view.state === 'failed' || view.state === 'expired') && (
            <div className="panel">
              <h2>Akış tamamlanamadı</h2>
              <p className="error small">{view.error ?? 'Oturum süresi doldu.'}</p>
              <button onClick={resetWorkspace}>Yeniden dene</button>
            </div>
          )}

          {error && <p className="error small">{error}</p>}
        </>
      )}
    </div>
  );
}
