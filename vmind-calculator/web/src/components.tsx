import { useEffect, useRef, useState } from 'react';

import {
  money,
  type AuditQuestion,
  type AuditReport,
  type AssumptionRecord,
  type CriticalUnknown,
  type EstimateDraft,
  type FlowEvent,
  type PriceSnapshot,
  type PublishSummary,
  type RequirementSpec,
} from './api';
import { isNetworkAccessQuestion, quickAnswersForQuestion } from './guidedQuote';

const SEVERITY_LABEL: Record<string, string> = {
  blocker: 'ENGELLEYİCİ',
  recommended: 'ÖNERİLEN',
  optional: 'İSTEĞE BAĞLI',
};

const SERVICES: Array<{
  code: string;
  label: string;
  wanted: (spec: RequirementSpec) => boolean;
}> = [
  {
    code: 'compute',
    label: 'Compute',
    wanted: (spec) => spec.compute !== undefined || (spec.computeGroups?.length ?? 0) > 0,
  },
  {
    code: 'storage',
    label: 'Block Storage',
    wanted: (spec) =>
      spec.standaloneStorage !== undefined ||
      spec.compute?.storage !== undefined ||
      Boolean(spec.computeGroups?.some((group) => group.storage)),
  },
  {
    code: 'data-transfer',
    label: 'Data Transfer',
    wanted: (spec) => spec.egressGb !== undefined || spec.router?.egressGb !== undefined,
  },
  {
    code: 'floating-ip',
    label: 'Floating IP',
    wanted: (spec) =>
      spec.floatingIpCount !== undefined || spec.router?.floatingIpCount !== undefined,
  },
  {
    code: 'load-balancer',
    label: 'Load Balancer',
    wanted: (spec) => spec.loadBalancer !== undefined,
  },
  { code: 'kubernetes', label: 'Kubernetes', wanted: (spec) => spec.kubernetes !== undefined },
  {
    code: 'object-storage',
    label: 'Object Storage',
    wanted: (spec) => spec.objectStorage !== undefined,
  },
  { code: 'router', label: 'Router', wanted: (spec) => spec.router !== undefined },
  {
    code: 'backup',
    label: 'Backup',
    wanted: (spec) =>
      spec.backup !== undefined || Boolean(spec.computeGroups?.some((group) => group.backup)),
  },
];

const RULE_SERVICE: Record<string, string> = {
  SUGGEST_LOAD_BALANCER: 'load-balancer',
  SUGGEST_OBJECT_STORAGE: 'object-storage',
  SUGGEST_PREMIUM_SSD: 'storage',
  SUGGEST_BACKUP_FOR_STORAGE: 'backup',
  CONSIDER_BLOCK_STORAGE_FOR_OBJECT_WORKLOAD: 'storage',
};

export function RequirementOverview({
  spec,
  draft,
  audit,
}: {
  spec: RequirementSpec | undefined;
  draft: EstimateDraft | undefined;
  audit: AuditReport | undefined;
}) {
  if (!spec) return null;
  const added = new Set((draft?.choices ?? []).map((choice) => choice.service));
  const suggested = new Set(
    (audit?.gaps ?? [])
      .filter((gap) => gap.severity === 'optional')
      .map((gap) => RULE_SERVICE[gap.ruleId])
      .filter((service): service is string => service !== undefined),
  );

  return (
    <div className="panel">
      <h2>Anladığım ihtiyaç ve kapsam</h2>
      <p style={{ marginTop: 0 }}>{spec.rationale}</p>
      {spec.workload && (
        <p className="small">
          <strong>İş yükü:</strong> {spec.workload}
        </p>
      )}
      {(spec.internetFacingRoles?.length ?? 0) > 0 && (
        <p className="small">
          <strong>İnternete açılacak roller:</strong> {spec.internetFacingRoles?.join(', ')}
        </p>
      )}
      {spec.egressBandwidthMbps !== undefined && (
        <p className="small">
          <strong>İnternet kapasitesi:</strong> {spec.egressBandwidthMbps} Mbps
          {spec.egressUtilizationPercent !== undefined
            ? ` · ortalama %${spec.egressUtilizationPercent} kullanım · ${spec.egressGb ?? '?'} GB/ay egress`
            : ' · aylık egress için ortalama kullanım yüzdesi bekleniyor'}
        </p>
      )}
      {(spec.computeGroups?.length ?? 0) > 0 && (
        <div className="q">
          <strong>Rol bazlı compute grupları</strong>
          {(spec.computeGroups ?? []).map((group, index) => (
            <div className="hint" key={`${group.role}-${index}`}>
              {group.role}: {group.count ?? '?'} instance ·{' '}
              {group.vcpuPerInstance ?? '?'} vCPU · {group.ramGbPerInstance ?? '?'} GB RAM
              {group.storage?.sizeGbPerInstance
                ? ` · ${group.storage.sizeGbPerInstance} GB ${group.storage.tier} disk`
                : ''}
            </div>
          ))}
        </div>
      )}
      {(draft?.scenarioNotes?.length ?? 0) > 0 && (
        <div className="q">
          <strong>Senaryolar</strong>
          {(draft?.scenarioNotes ?? []).map((scenario, index) => (
            <div className="hint" key={`${scenario.kind}-${scenario.label}-${index}`}>
              {scenario.label}: {scenario.message}
            </div>
          ))}
        </div>
      )}
      <div className="service-grid">
        {SERVICES.map((service) => {
          const status = added.has(service.code)
            ? 'added'
            : service.wanted(spec)
              ? 'wanted'
              : suggested.has(service.code)
                ? 'suggested'
                : 'idle';
          const label =
            status === 'added'
              ? 'Teklife eklendi'
              : status === 'wanted'
                ? 'İhtiyaçta var / netleşiyor'
                : status === 'suggested'
                  ? 'Alternatif olarak önerildi'
                  : 'Belirtilmedi';
          return (
            <div className={`service-card ${status}`} key={service.code}>
              <strong>{service.label}</strong>
              <span>{label}</span>
            </div>
          );
        })}
      </div>
      {spec.unknowns.length > 0 && (
        <p className="muted small" style={{ marginBottom: 0 }}>
          İlk metinde {spec.unknowns.length} belirsiz nokta bulundu; fiyatı etkileyenler ayrıca soruldu.
        </p>
      )}
    </div>
  );
}

export function RecommendationsPanel({ audit }: { audit: AuditReport | undefined }) {
  if (!audit) return null;
  const recommendations = [
    ...audit.gaps
      .filter((gap) => gap.severity === 'optional')
      .map((gap) => ({ id: gap.ruleId, text: gap.message })),
    ...audit.contextualNotes.map((text, index) => ({ id: `context-${index}`, text })),
  ];
  if (recommendations.length === 0) return null;

  return (
    <div className="panel recommendations">
      <h2>Mimari öneriler ve alternatifler</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Bunlar teklif kalemi değildir; kullanım şekline göre daha uygun veya ekonomik seçeneği gösterir.
      </p>
      {recommendations.map((recommendation) => (
        <div className="recommendation" key={recommendation.id}>
          {recommendation.text.replace(/\s+/g, ' ')}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Events({ events }: { events: FlowEvent[] }) {
  if (events.length === 0) return null;
  return (
    <div className="panel">
      <h2>Akış</h2>
      <div className="events">
        {events.map((event, index) => (
          <div key={index}>
            <span className="stage">[{event.stage}]</span> {event.message}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Tasarımdan önce sorulan kritik netleştirme soruları. */
export function ClarifyGate({
  unknowns,
  onSubmit,
}: {
  unknowns: CriticalUnknown[];
  onSubmit: (answers: Record<string, string>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);

  const submit = (payload: Record<string, string>): void => {
    setSent(true);
    onSubmit(payload);
  };

  return (
    <div className="panel">
      <h2>Önce şunları netleştirelim</h2>
      <p className="muted small">
        Bunlar fiyatı değiştiren noktalar. Bilmiyorsanız boş bırakabilir veya “bilmiyorum”
        yazabilirsiniz; sistem güçlü VMind önerisini uygular ve varsayımı sonuçta gösterir.
      </p>
      {unknowns.map((unknown, index) => (
        <div className="q" key={index}>
          <div>{unknown.question}</div>
          <div className="hint">
            {isNetworkAccessQuestion(unknown.question) ? 'VMind önerisi: ' : 'neden önemli: '}
            {unknown.reason}
          </div>
          {quickAnswersForQuestion(unknown.question).length > 0 && (
            <div className="quick-answers" aria-label="Hazır cevaplar">
              {quickAnswersForQuestion(unknown.question).map((option) => (
                <button
                  type="button"
                  className={`${option.recommended ? 'recommended-answer' : ''} ${option.description ? 'detailed-answer' : ''}`}
                  disabled={sent}
                  onClick={() =>
                    setAnswers((previous) => ({
                      ...previous,
                      [unknown.question]: option.value,
                    }))
                  }
                  key={option.label}
                >
                  <span>
                    {option.label}
                    {option.recommended && <small>önerilen</small>}
                  </span>
                  {option.description && <em>{option.description}</em>}
                </button>
              ))}
            </div>
          )}
          <input
            style={{ marginTop: 8 }}
            disabled={sent}
            value={answers[unknown.question] ?? ''}
            onChange={(event) =>
              setAnswers((previous) => ({ ...previous, [unknown.question]: event.target.value }))
            }
            placeholder={
              isNetworkAccessQuestion(unknown.question)
                ? 'Örn. web-1, web-2 ve API dışarı açık; database yalnızca VPN’de'
                : 'cevabınız — bilmiyorsanız VMind önerisi uygulanır'
            }
          />
        </div>
      ))}
      <div className="row">
        <button disabled={sent} onClick={() => submit(answers)}>
          Devam et
        </button>
        <button className="ghost" disabled={sent} onClick={() => submit({})}>
          Hepsini atla
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Denetim soruları.
 *
 * Faz 6.A kriteri: satışçı HEPSİNİ atlayabilmeli ve her sorunun varsayılanı
 * görünür olmalı. "Hepsini atla" birinci sınıf bir düğme, gizli bir seçenek değil.
 */
export function QuestionsGate({
  questions,
  round,
  onSubmit,
}: {
  questions: AuditQuestion[];
  round: number;
  onSubmit: (answers: Array<{ ruleId: string; answer?: string }>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);

  const send = (skipAll: boolean): void => {
    setSent(true);
    onSubmit(
      questions.map((question) => {
        const value = skipAll ? '' : (answers[question.ruleId] ?? '').trim();
        return value ? { ruleId: question.ruleId, answer: value } : { ruleId: question.ruleId };
      }),
    );
  };

  return (
    <div className="panel">
      <h2>Sorular — tur {round}</h2>
      {questions.map((question) => (
        <div className="q" key={question.ruleId}>
          <div>
            <span className={`badge ${question.severity === 'blocker' ? 'warn' : ''}`}>
              {SEVERITY_LABEL[question.severity] ?? question.severity}
            </span>{' '}
            {question.question}
          </div>
          {quickAnswersForQuestion(question.question, question.ruleId).length > 0 && (
            <div className="quick-answers" aria-label="Hazır cevaplar">
              {quickAnswersForQuestion(question.question, question.ruleId).map((option) => (
                <button
                  type="button"
                  className={`${option.recommended ? 'recommended-answer' : ''} ${option.description ? 'detailed-answer' : ''}`}
                  disabled={sent}
                  onClick={() =>
                    setAnswers((previous) => ({
                      ...previous,
                      [question.ruleId]: option.value,
                    }))
                  }
                  key={option.label}
                >
                  <span>
                    {option.label}
                    {option.recommended && <small>önerilen</small>}
                  </span>
                  {option.description && <em>{option.description}</em>}
                </button>
              ))}
            </div>
          )}
          <input
            style={{ marginTop: 8 }}
            disabled={sent}
            value={answers[question.ruleId] ?? ''}
            onChange={(event) =>
              setAnswers((previous) => ({ ...previous, [question.ruleId]: event.target.value }))
            }
            placeholder={`boş bırakırsanız: ${question.defaultAnswer}`}
          />
          <div className="hint">boş bırakırsanız: {question.defaultAnswer}</div>
        </div>
      ))}
      <div className="row">
        <button disabled={sent} onClick={() => send(false)}>
          Gönder
        </button>
        <button className="ghost" disabled={sent} onClick={() => send(true)}>
          Hepsini atla (varsayılanları kullan)
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function PriceTable({ price }: { price: PriceSnapshot }) {
  if (price.lines.length === 0) return null;
  return (
    <div className="panel">
      <h2>Fiyat</h2>
      <table>
        <thead>
          <tr>
            <th>Kalem</th>
            <th>Miktar</th>
            <th className="num">Aylık</th>
          </tr>
        </thead>
        <tbody>
          {price.lines.map((line, index) => (
            <tr key={index}>
              <td>{line.productName ?? '—'}</td>
              <td className="muted">{line.count ?? ''}</td>
              <td className="num">
                {typeof line.monthly === 'number'
                  ? money(line.monthly, price.currency)
                  : String(line.monthly ?? '—')}
              </td>
            </tr>
          ))}
          <tr className="total">
            <td>TOPLAM</td>
            <td />
            <td className="num">{money(price.totalMonthCost, price.currency)}</td>
          </tr>
          <tr>
            <td />
            <td />
            <td className="num muted small">
              {price.totalHourCost.toFixed(6)} {price.currency}/saat
            </td>
          </tr>
        </tbody>
      </table>
      <p className="muted small" style={{ marginBottom: 0 }}>
        Tutarlar platformun kendi hesaplayıcısıyla bit-bit aynı motordan geliyor.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function AuditPanel({ audit }: { audit: AuditReport }) {
  const findings = audit.gaps.filter((gap) => gap.severity !== 'optional');
  return (
    <div className="panel">
      <h2>Denetim</h2>
      <p style={{ marginTop: 0 }}>{audit.summary}</p>
      {findings.length === 0 && <p className="muted small">Kritik veya önerilen düzeltme yok.</p>}
      {findings.map((gap) => (
        <div className={`gap ${gap.severity}`} key={gap.ruleId}>
          <div className="rid">
            [{SEVERITY_LABEL[gap.severity] ?? gap.severity}] {gap.ruleId}
          </div>
          <div>{gap.message.replace(/\s+/g, ' ')}</div>
        </div>
      ))}
      {/*
        Auditor'ın bağlamsal notları TEK bir metin olarak gelir ama satırlara
        bölünmüş bir dizi halinde taşınır. İlk sürüm her satırın başına
        "Gözlem:" ekliyordu; sonuç, markdown başlıklarının ("## Özet") ve
        madde işaretlerinin ayrı ayrı "Gözlem:" etiketiyle görünmesiydi —
        okunmaz ve kural listesini tekrar ediyordu. Tek blok olarak, markdown
        süsleri temizlenerek gösteriliyor.
      */}
      <p style={{ marginBottom: 0 }}>
        <span className={`badge ${audit.publishable ? 'ok' : 'warn'}`}>
          {audit.publishable ? 'Yayınlanabilir' : 'Engelleyici var — yayınlanamaz'}
        </span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Assumptions({ assumptions }: { assumptions: AssumptionRecord[] }) {
  return (
    <div className="panel">
      <h2>Yapılan varsayımlar</h2>
      {assumptions.length === 0 ? (
        // Başlık BOŞ OLSA DA gösterilir: satışçı hangi bilginin nereden
        // geldiğini görebilmeli. Başlığın kaybolması "varsayım yok" ile
        // "bakmadım"ı ayırt edilemez yapardı.
        <p className="muted" style={{ margin: 0 }}>
          Varsayım yapılmadı.
        </p>
      ) : (
        assumptions.map((assumption, index) => (
          <div className="gap" key={index}>
            <div>{assumption.question}</div>
            <div className="muted small">→ {assumption.assumed}</div>
          </div>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

const SERVICE_LABELS: Record<string, string> = {
  compute: 'Compute',
  storage: 'Block Storage',
  'data-transfer': 'Data Transfer',
  'floating-ip': 'Floating IP',
  'load-balancer': 'Load Balancer',
  kubernetes: 'Kubernetes',
  'object-storage': 'Object Storage',
  router: 'Router',
  backup: 'Backup',
};

interface ApprovalChatMessage {
  id: number;
  role: 'assistant' | 'user';
  text: string;
  error?: boolean;
}

let approvalChatMessageId = 0;

const chatMessage = (
  role: ApprovalChatMessage['role'],
  text: string,
  error = false,
): ApprovalChatMessage => ({ id: ++approvalChatMessageId, role, text, error });

/**
 * Edit API'si tek mesaj aliyor. Son konusma baglamini sinirli bir transcript
 * olarak gondererek "500 GB olsun" gibi takip cevaplarini anlamli hale getirir.
 */
function approvalChatInstruction(
  currentMessage: string,
  previousMessages: ApprovalChatMessage[],
): string {
  const current = currentMessage.trim().slice(0, 1400);
  const heading =
    'Bu bir teklif asistani konusmasidir. Onceki mesajlari baglam olarak kullan; ' +
    'yalnizca YENI SATISCI MESAJI icin gereken islemi yap.\n\nONCEKI KONUSMA:\n';
  const ending = `\n\nYENI SATISCI MESAJI:\n${current}`;
  const historyBudget = Math.max(0, 2000 - heading.length - ending.length);
  const historyLines: string[] = [];
  let used = 0;

  for (const message of previousMessages.slice(-8).reverse()) {
    const role = message.role === 'assistant' ? 'ASISTAN' : 'SATISCI';
    const line = `${role}: ${message.text.replace(/\s+/g, ' ').trim()}\n`;
    if (used + line.length > historyBudget) {
      const remaining = historyBudget - used;
      if (remaining > role.length + 20) historyLines.unshift(line.slice(0, remaining));
      break;
    }
    historyLines.unshift(line);
    used += line.length;
  }

  return `${heading}${historyLines.join('') || '(ilk mesaj)'}${ending}`;
}

/** Onay kapisini kapatmadan mevcut taslagi LLM ile sohbet ederek duzenler. */
export function ApprovalEditPanel({
  summary,
  onEdit,
}: {
  summary: PublishSummary;
  onEdit: (instruction: string) => Promise<string>;
}) {
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ApprovalChatMessage[]>([
    chatMessage(
      'assistant',
      'Teklifi doğal dille birlikte revize edebiliriz. Ne eklemek, çıkarmak veya değiştirmek istediğinizi yazın. Bir öneri için fiyatı etkileyen bilgi eksikse size tek bir net soru soracağım.',
    ),
  ]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, busy]);

  const recommendations = [
    ...(summary.audit?.gaps ?? [])
      .filter((gap) => gap.severity === 'optional')
      .map((gap) => ({ id: gap.ruleId, text: gap.message.replace(/\s+/g, ' ') })),
    ...(summary.audit?.contextualNotes ?? []).map((text, index) => ({
      id: `context-${index}`,
      text: text.replace(/\s+/g, ' '),
    })),
  ].filter((recommendation) => !dismissed.has(recommendation.id));

  const send = async (text = instruction): Promise<void> => {
    const clean = text.trim();
    if (!clean || busy) return;
    const transcript = approvalChatInstruction(clean, messages);
    setMessages((current) => [...current, chatMessage('user', clean)]);
    setInstruction('');
    setBusy(true);
    try {
      const response = await onEdit(transcript);
      setMessages((current) => [...current, chatMessage('assistant', response)]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        chatMessage(
          'assistant',
          `Bu değişikliği işleyemedim: ${(error as Error).message}`,
          true,
        ),
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel approval-editor">
      <h2>Teklif asistanı</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Onaydan önce asistanla konuşarak kalem ekleyebilir, çıkarabilir veya miktarları
        değiştirebilirsiniz. Her başarılı değişiklikte fiyat ve denetim yeniden hesaplanır;
        hiçbir değişiklik kendiliğinden yayınlanmaz.
      </p>

      <h3>Mevcut kalemler</h3>
      <div className="edit-items">
        {summary.estimate.list.map((item) => {
          const description = String(item.data['description'] ?? '');
          const title = description || SERVICE_LABELS[item.service] || item.service;
          return (
            <div className="edit-item" key={item.id}>
              <div>
                <strong>{title}</strong>
                <div className="muted small">{SERVICE_LABELS[item.service] ?? item.service}</div>
              </div>
              <details>
                <summary>Teknik detaylar</summary>
                <pre>{JSON.stringify(item.data, null, 2)}</pre>
              </details>
            </div>
          );
        })}
      </div>

      {recommendations.length > 0 && (
        <>
          <h3>Ajan önerileri — karar sizde</h3>
          {recommendations.map((recommendation) => (
            <div className="recommendation decision" key={recommendation.id}>
              <div>{recommendation.text}</div>
              <div className="row compact">
                <button
                  className="ghost"
                  disabled={busy}
                  onClick={() =>
                    void send(
                      `Şu öneriyi birlikte değerlendirelim ve uygunsa teklife ekleyelim: ${recommendation.text} ` +
                        'Fiyatı etkileyen bilgi eksikse önce bana tek bir net soru sor.',
                    )
                  }
                >
                  Asistana sor
                </button>
                <button
                  className="ghost"
                  disabled={busy}
                  onClick={() =>
                    setDismissed((current) => new Set([...current, recommendation.id]))
                  }
                >
                  Bu teklifte kullanma
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      <h3>Asistanla revize et</h3>
      <div className="assistant-chat">
        <div className="chat-log" aria-live="polite">
          {messages.map((message) => (
            <div
              className={`chat-message ${message.role}${message.error ? ' chat-error' : ''}`}
              key={message.id}
            >
              <span>{message.role === 'assistant' ? 'Teklif asistanı' : 'Siz'}</span>
              <div>{message.text}</div>
            </div>
          ))}
          {busy && (
            <div className="chat-message assistant chat-thinking">
              <span>Teklif asistanı</span>
              <div>Teklifi ve katalog fiyatlarını kontrol ediyorum…</div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
        <div className="chat-compose">
          <textarea
            rows={3}
            maxLength={1400}
            disabled={busy}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey) return;
              event.preventDefault();
              void send();
            }}
            aria-label="Teklif asistanına mesaj"
            placeholder="Örn: Customer API sayısını 3 yap veya 500 GB Object Storage ekle."
          />
          <div className="chat-compose-actions">
            <span className="muted small">Enter gönderir · Shift+Enter yeni satır</span>
            <button disabled={busy || instruction.trim().length === 0} onClick={() => void send()}>
              {busy ? 'İşleniyor…' : 'Gönder'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Onay ekranı — HITL kapısı.
 *
 * "Onaylama" düğmesi ilk sırada DEĞİL ve varsayılan seçim yok: onay bilinçli
 * bir eylem olmalı. Cevap verilmezse (zaman aşımı) sunucu onaylanmadı sayar.
 */
export function ApproveGate({
  summary,
  publishEnabled,
  onDecide,
}: {
  summary: PublishSummary;
  publishEnabled: boolean;
  onDecide: (approved: boolean) => void;
}) {
  const [sent, setSent] = useState(false);
  const decide = (approved: boolean): void => {
    setSent(true);
    onDecide(approved);
  };

  return (
    <div className="panel">
      <h2>Onay</h2>
      {summary.price && (
        <p>
          Toplam: <strong>{money(summary.price.totalMonthCost, summary.price.currency)}/ay</strong>
        </p>
      )}
      {summary.assumptions.length > 0 && (
        <p className="muted small">
          {summary.assumptions.length} varsayım yapıldı — yukarıdaki listeye bakın.
        </p>
      )}

      {(summary.estimate.list.length === 0 || summary.audit?.publishable === false) && (
        <p className="error small">
          Teklif boş veya engelleyici bulgu içeriyor. Düzenleme bölümünde eksikleri
          çözmeden onaylanamaz.
        </p>
      )}

      <p className="small">
        {publishEnabled ? (
          <>
            Onaylarsanız teklif VMind'a <strong>kalıcı olarak</strong> kaydedilir ve
            size calculator linki verilir. Kayıt sonradan silinemez.
          </>
        ) : (
          <>
            <span className="badge ok">Yayınlama kapalı</span> Bu sunucu gerçek teklif
            oluşturmaz; onaylasanız da yalnızca dry-run sonucu üretilir ve
            calculator linki oluşmaz.
          </>
        )}
      </p>

      <div className="row">
        <button className="ghost" disabled={sent} onClick={() => decide(false)}>
          Onaylama
        </button>
        <button
          disabled={
            sent || summary.estimate.list.length === 0 || summary.audit?.publishable === false
          }
          onClick={() => decide(true)}
        >
          Onaylıyorum
        </button>
      </div>
    </div>
  );
}
