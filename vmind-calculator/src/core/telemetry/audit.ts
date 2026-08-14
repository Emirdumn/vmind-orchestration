/**
 * FAZ 7.B — Denetim izi (audit trail)
 *
 * Kabul kriteri: "Her teklif için tam denetim izi saklanıyor."
 *
 * Neden gerekli: teklif müşteriye gittikten sonra "bu rakam nereden çıktı"
 * sorusunun cevabı olmalı. Hangi kod nereden seçildi, hangi soru soruldu,
 * satışçı ne cevapladı, neyi varsaydık, kim onayladı.
 *
 * TASARIM KARARLARI
 *
 * 1. **Ham girdi saklanmaz, ÖZETİ saklanır.** Tool girdileri müşteri metni
 *    içerebilir; ize koymak izi bir sızıntı kaynağına çevirir. Bu yüzden her
 *    metin `redactPii`'den geçer ve büyük nesneler özetlenir.
 *
 * 2. **Zaman kaynağı enjekte edilebilir.** `Date.now()` doğrudan çağrılsaydı
 *    iz testlenemezdi; deterministik test için saat dışarıdan verilir.
 *
 * 3. **İz asla hata fırlatmaz.** Telemetri, işin kendisini bozmamalı: kayıt
 *    sırasında bir sorun olursa sessizce atlanır (`recordFailures` sayacına
 *    yazılır) — bir logging hatası yüzünden teklif kaybedilmez.
 */
import { redactPii, summarizePii, type PiiKind } from './pii.js';

export type AuditEventType =
  | 'session.start'
  | 'stage'
  | 'tool.call'
  | 'tool.rejected'
  | 'llm.usage'
  | 'pii.detected'
  | 'question.asked'
  | 'question.answered'
  | 'assumption'
  | 'price.snapshot'
  | 'validation'
  | 'approval'
  | 'publish'
  | 'reconcile'
  | 'halt';

export interface AuditEvent {
  seq: number;
  at: string;
  type: AuditEventType;
  /** Kısa, insan-okunur özet. */
  summary: string;
  /** Yapısal ayrıntı — PII'den arındırılmış. */
  detail?: Record<string, unknown>;
}

/** Normalize edilmiş LLM kullanımı — iki sağlayıcı da buna çevrilir. */
export interface LlmUsage {
  provider: 'openrouter' | 'anthropic';
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Sağlayıcı bildirdiyse USD maliyet; hesaplanmaz, uydurulmaz. */
  costUsd?: number;
  /** Önbellekten okunan token (varsa) — maliyet analizi için. */
  cacheReadTokens?: number;
  routeTier?: 'fast' | 'balanced' | 'strong';
  routeReason?: string;
}

export interface AuditSummary {
  estimateId?: string;
  eventCount: number;
  /** Ajanın kaç kez katalogda olmayan kod denediği (PLAN 7.B metriği). */
  fabricatedCodeAttempts: number;
  /** Tool katmanının reddettiği toplam çağrı (şema hataları dahil). */
  rejectedToolCalls: number;
  toolCallCount: number;
  llm: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd?: number;
  };
  pii: {
    detections: number;
    kinds: Partial<Record<PiiKind, number>>;
  };
  questionsAsked: number;
  assumptions: number;
  approvedBy?: string;
  published: boolean;
  /** Kayıt sırasında yutulan hata sayısı — telemetri kendini de raporlar. */
  recordFailures: number;
}

export interface AuditTrailOptions {
  /** Test için enjekte edilebilir saat. */
  now?: () => number;
  /** `detail` içindeki metinleri bu uzunlukta kırpar. */
  maxTextLength?: number;
}

/** Büyük/iç içe nesneleri ize sığacak hale getirir. */
function summarizeValue(value: unknown, maxText: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    const safe = redactPii(value);
    return safe.length > maxText ? `${safe.slice(0, maxText)}…(+${safe.length - maxText})` : safe;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    // Uzun dizilerin tamamı ize girmez; sayı ve ilk birkaç öğe yeter.
    const head = value.slice(0, 3).map((v) => summarizeValue(v, maxText));
    return value.length > 3 ? { count: value.length, head } : head;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = summarizeValue(v, maxText);
  }
  return out;
}

export class AuditTrail {
  private readonly events: AuditEvent[] = [];
  private readonly now: () => number;
  private readonly maxTextLength: number;
  private seq = 0;

  private fabricatedCodeAttempts = 0;
  private rejectedToolCalls = 0;
  private toolCallCount = 0;
  private llmCalls = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private costUsd: number | undefined;
  private piiDetections = 0;
  private piiKinds: Partial<Record<PiiKind, number>> = {};
  private questionsAsked = 0;
  private assumptionCount = 0;
  private approvedBy: string | undefined;
  private published = false;
  private estimateId: string | undefined;
  private recordFailures = 0;

  constructor(options: AuditTrailOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.maxTextLength = options.maxTextLength ?? 200;
  }

  /**
   * Olay kaydeder. ASLA hata firlatmaz — telemetri isin kendisini bozmamali.
   */
  private push(type: AuditEventType, summary: string, detail?: Record<string, unknown>): void {
    try {
      const event: AuditEvent = {
        seq: ++this.seq,
        at: new Date(this.now()).toISOString(),
        type,
        summary: redactPii(summary),
      };
      if (detail !== undefined) {
        event.detail = summarizeValue(detail, this.maxTextLength) as Record<string, unknown>;
      }
      this.events.push(event);
    } catch {
      this.recordFailures++;
    }
  }

  // --- olay kaydedicileri -------------------------------------------------

  sessionStart(info: { estimateId?: string; currency?: string; provider?: string; model?: string }): void {
    if (info.estimateId) this.estimateId = info.estimateId;
    this.push('session.start', 'Oturum basladi', info as Record<string, unknown>);
  }

  stage(name: string, message: string): void {
    this.push('stage', `[${name}] ${message}`);
  }

  /** Basarili tool cagrisi. */
  toolCall(name: string, input: unknown): void {
    this.toolCallCount++;
    this.push('tool.call', `${name} calisti`, { tool: name, input });
  }

  /**
   * Reddedilen tool cagrisi.
   *
   * `UnknownProductCodeError` ozel olarak sayilir — PLAN 7.B'nin istedigi
   * "ajan kac kez uydurma kod denedi" metrigi bu.
   */
  toolRejected(name: string, input: unknown, errorName: string, errorMessage: string): void {
    this.rejectedToolCalls++;
    const fabricated = errorName === 'UnknownProductCodeError';
    if (fabricated) this.fabricatedCodeAttempts++;
    this.push('tool.rejected', `${name} REDDEDILDI: ${errorName}`, {
      tool: name,
      input,
      errorName,
      errorMessage,
      fabricatedCode: fabricated,
    });
  }

  llmUsage(usage: LlmUsage): void {
    this.llmCalls++;
    this.inputTokens += usage.inputTokens;
    this.outputTokens += usage.outputTokens;
    if (usage.costUsd !== undefined) this.costUsd = (this.costUsd ?? 0) + usage.costUsd;
    this.push('llm.usage', `${usage.provider}/${usage.model}: ${usage.inputTokens}+${usage.outputTokens} token`, {
      ...usage,
    });
  }

  /** Metinde PII bulunduysa kaydeder. Ham deger ize GIRMEZ. */
  scanText(label: string, text: string): void {
    const summary = summarizePii(text);
    if (!summary.found) return;
    this.piiDetections += summary.findings.length;
    for (const [kind, count] of Object.entries(summary.countByKind)) {
      const key = kind as PiiKind;
      this.piiKinds[key] = (this.piiKinds[key] ?? 0) + (count ?? 0);
    }
    this.push('pii.detected', `${label}: ${summary.findings.length} PII bulgusu`, {
      label,
      countByKind: summary.countByKind,
      masked: summary.findings.map((f) => `${f.kind}:${f.masked}`),
    });
  }

  questionAsked(ruleId: string, question: string, round: number): void {
    this.questionsAsked++;
    this.push('question.asked', `Tur ${round}: ${ruleId}`, { ruleId, question, round });
  }

  questionAnswered(ruleId: string, answer: string): void {
    this.push('question.answered', `${ruleId} cevaplandi`, { ruleId, answer });
  }

  assumption(ruleId: string, question: string, assumed: string): void {
    this.assumptionCount++;
    this.push('assumption', `${ruleId}: "${assumed}" varsayildi`, { ruleId, question, assumed });
  }

  priceSnapshot(label: string, totals: { currency: string; totalHourCost: number; totalMonthCost: number; lineCount: number }): void {
    this.push('price.snapshot', `${label}: ${totals.totalMonthCost.toFixed(4)} ${totals.currency}/ay`, totals);
  }

  validation(result: { gapCount: number; blockerCount: number; publishable: boolean; ruleIds: string[] }): void {
    this.push(
      'validation',
      `${result.gapCount} bulgu (${result.blockerCount} blocker), yayinlanabilir: ${result.publishable}`,
      result,
    );
  }

  approval(approvedBy: string): void {
    this.approvedBy = approvedBy;
    this.push('approval', `Onay verildi: ${approvedBy}`, { approvedBy });
  }

  publish(info: { estimateId: string; shareUrl: string; dryRun: boolean }): void {
    if (!info.dryRun) this.published = true;
    this.estimateId = info.estimateId;
    this.push('publish', info.dryRun ? 'Dry-run (yazilmadi)' : `Yayinlandi: ${info.shareUrl}`, info);
  }

  reconcile(result: { ok: boolean; monthlyDiff: number; message: string }): void {
    this.push('reconcile', result.ok ? 'Mutabakat saglandi' : 'MUTABAKATSIZLIK', result);
  }

  halt(reason: string): void {
    this.push('halt', `Akis durdu: ${reason}`);
  }

  // --- okuma --------------------------------------------------------------

  /** Olaylarin kopyasi — disariya verilen dizi degistirilerek iz bozulamaz. */
  list(): AuditEvent[] {
    return structuredClone(this.events);
  }

  summary(): AuditSummary {
    return {
      ...(this.estimateId !== undefined ? { estimateId: this.estimateId } : {}),
      eventCount: this.events.length,
      fabricatedCodeAttempts: this.fabricatedCodeAttempts,
      rejectedToolCalls: this.rejectedToolCalls,
      toolCallCount: this.toolCallCount,
      llm: {
        calls: this.llmCalls,
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
        ...(this.costUsd !== undefined ? { costUsd: this.costUsd } : {}),
      },
      pii: { detections: this.piiDetections, kinds: { ...this.piiKinds } },
      questionsAsked: this.questionsAsked,
      assumptions: this.assumptionCount,
      ...(this.approvedBy !== undefined ? { approvedBy: this.approvedBy } : {}),
      published: this.published,
      recordFailures: this.recordFailures,
    };
  }

  /** Diske yazilabilir tam iz. */
  toJSON(): { summary: AuditSummary; events: AuditEvent[] } {
    return { summary: this.summary(), events: this.list() };
  }

  /** Insan-okunur dokum — onay ekraninin altina veya loga. */
  render(): string {
    const s = this.summary();
    const lines: string[] = [];
    lines.push('=== DENETIM IZI ===');
    if (s.estimateId) lines.push(`Teklif: ${s.estimateId}`);
    lines.push(
      `${s.eventCount} olay | ${s.toolCallCount} tool cagrisi | ` +
        `${s.rejectedToolCalls} red (${s.fabricatedCodeAttempts} uydurma kod)`,
    );
    lines.push(
      `LLM: ${s.llm.calls} cagri, ${s.llm.inputTokens}+${s.llm.outputTokens} token` +
        (s.llm.costUsd !== undefined ? `, $${s.llm.costUsd.toFixed(4)}` : ''),
    );
    lines.push(`Soru: ${s.questionsAsked} | Varsayim: ${s.assumptions}`);
    if (s.pii.detections > 0) {
      lines.push(`PII: ${s.pii.detections} bulgu ${JSON.stringify(s.pii.kinds)}`);
    }
    lines.push(`Onay: ${s.approvedBy ?? '(yok)'} | Yayinlandi: ${s.published ? 'evet' : 'hayir'}`);
    if (s.recordFailures > 0) lines.push(`UYARI: ${s.recordFailures} olay kaydedilemedi`);
    lines.push('');
    for (const event of this.events) {
      lines.push(`  ${String(event.seq).padStart(3)}. [${event.type}] ${event.summary}`);
    }
    return lines.join('\n');
  }
}
