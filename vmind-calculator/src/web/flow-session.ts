/**
 * Akışı HTTP gidiş-dönüşleri arasında askıda bekletme.
 *
 * ## Çözülen problem
 *
 * `orchestrator.run()` BLOKE EDEN callback'lerle çalışıyor:
 *
 *   onClarify(unknowns)      -> Promise<cevaplar>
 *   onQuestions(questions)   -> Promise<cevaplar>
 *   onApprove(summary)       -> Promise<{approved}>
 *
 * CLI'da bu doğal: `readline` bekler. Web'de değil — arada bir HTTP yanıtı
 * dönmek, tarayıcının cevabını beklemek ve akışı kaldığı yerden sürdürmek
 * gerekiyor.
 *
 * ## Neden orchestrator'ı yeniden yazmadım
 *
 * İki seçenek vardı:
 *   (a) Orchestrator'ı sürdürülebilir bir durum makinesine çevirmek —
 *       yeniden başlatmaya dayanıklı olur, ama 5.C'de test edilmiş akış
 *       mantığının tamamına dokunmak demek.
 *   (b) Akışı sunucuda ASKIDA tutmak: callback bir `Promise` döndürür,
 *       o promise'in `resolve`'u saklanır, HTTP isteği geldiğinde çağrılır.
 *
 * (b) seçildi: test edilmiş kod hiç değişmiyor, kapı mantığı (tur limiti,
 * blocker kontrolü, HITL) olduğu gibi kalıyor. Bedeli aşağıda açıkça yazılı.
 *
 * ## Bu yaklaşımın BEDELİ — bilinen sınırlar
 *
 * 1. Oturum sunucunun BELLEĞİNDE. Sunucu yeniden başlarsa yarım akışlar
 *    kaybolur; satışçı baştan başlar. Kaydedilmiş teklif kaybolmaz (o
 *    platformda), yalnızca yarım oturum kaybolur.
 * 2. YATAY ÖLÇEKLENMEZ. İki sunucu varsa istek doğru sunucuya gitmeli
 *    (sticky session). Tek sunucu için sorun değil; çoğaltmadan önce
 *    (a) seçeneğine geçilmeli.
 * 3. Askıda kalan her akış bir kapı zaman aşımı taşır. Aksi halde satışçı
 *    sekmeyi kapattığında akış sonsuza kadar bekler ve bellekte kalır.
 */
import { randomUUID } from 'node:crypto';

import type { AuditQuestion, CriticalUnknown } from '../agents/types.js';
import type { FlowEvent, FlowResult, PublishSummary } from '../agents/orchestrator.js';

/** Satışçının cevaplaması beklenen kapı. */
export type PendingGate =
  | { kind: 'clarify'; id: string; unknowns: CriticalUnknown[] }
  | { kind: 'questions'; id: string; round: number; questions: AuditQuestion[] }
  | { kind: 'approve'; id: string; summary: PublishSummary };

export type SessionState = 'running' | 'waiting' | 'done' | 'failed' | 'expired';

export interface SessionView {
  sessionId: string;
  state: SessionState;
  events: FlowEvent[];
  gate: PendingGate | null;
  result: FlowResult | null;
  error: string | null;
  spentUsd: number;
}

interface Waiter {
  gate: PendingGate;
  resolve: (answer: unknown) => void;
  timer: NodeJS.Timeout;
}

export type ApprovalEditHandler = (
  instruction: string,
  current: PublishSummary,
) => Promise<{ summary: PublishSummary; message: string }>;

export interface FlowSessionOptions {
  /** Bir kapı cevapsız kalırsa ne kadar beklenir. */
  gateTimeoutMs?: number;
  /** Oturum bittikten sonra ne kadar okunabilir kalır. */
  retentionMs?: number;
}

const DEFAULT_GATE_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_RETENTION_MS = 30 * 60 * 1000;

/**
 * Tek bir satışçı akışı.
 *
 * Akış `start()` ile başlar ve kendi hızında yürür; bir kapıya geldiğinde
 * `waiting` durumuna geçip cevabı bekler. Tarayıcı `view()` ile durumu okur,
 * `answer()` ile kapıyı geçer.
 */
export class FlowSession {
  readonly sessionId = randomUUID();
  readonly userId: string;
  readonly startedAt = Date.now();

  private state: SessionState = 'running';
  private readonly eventLog: FlowEvent[] = [];
  private waiter: Waiter | null = null;
  private result: FlowResult | null = null;
  private error: string | null = null;
  private spentUsd = 0;
  private finishedAt: number | null = null;
  private approvalEditor: ApprovalEditHandler | null = null;
  private approvalEditInFlight = false;
  private approvalEditCount = 0;

  private readonly gateTimeoutMs: number;
  private readonly retentionMs: number;

  /** Yeni olay/kapı geldiğinde bekleyen HTTP isteklerini uyandırmak için. */
  private readonly listeners = new Set<() => void>();

  constructor(userId: string, options: FlowSessionOptions = {}) {
    this.userId = userId;
    this.gateTimeoutMs = options.gateTimeoutMs ?? DEFAULT_GATE_TIMEOUT_MS;
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
  }

  // --- akışın orchestrator'a verdiği callback'ler --------------------------

  /**
   * Kapıyı açar ve cevabı bekler. Orchestrator'ın gördüğü şey sıradan bir
   * `Promise`; onu kimin çözdüğünü bilmiyor.
   */
  private gate<T>(gate: PendingGate, onTimeout: () => T): Promise<T> {
    if (this.waiter) {
      // Aynı anda iki kapı olmamalı — olursa akış mantığı bozulmuş demektir.
      throw new Error('Aynı oturumda birden fazla kapı açık; bu bir akış hatasıdır.');
    }
    this.state = 'waiting';
    return new Promise<T>((resolve) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        this.state = 'running';
        // Zaman aşımında akış ÇÖKMEZ: varsayılanlarla devam eder. Satışçı
        // sekmeyi kapattığında teklifin yarım kalmaması için.
        this.pushEvent({
          stage: 'ask',
          message: 'Cevap gelmedi; varsayılanlarla devam edildi (zaman aşımı).',
        });
        resolve(onTimeout());
      }, this.gateTimeoutMs);
      // Zaman aşımı sunucunun kapanmasını engellemesin.
      timer.unref?.();

      this.waiter = { gate, resolve: resolve as (answer: unknown) => void, timer };
      this.notify();
    });
  }

  onClarify = (unknowns: CriticalUnknown[]): Promise<Record<string, string>> =>
    this.gate<Record<string, string>>(
      { kind: 'clarify', id: randomUUID(), unknowns },
      // Netleştirme cevapsız kalırsa boş dönülür: Designer belirsiz alanları
      // atlar, kural motoru eksiği yakalar. Uydurmaktan iyidir.
      () => ({}),
    );

  onQuestions = (questions: AuditQuestion[], round: number): Promise<Array<{ ruleId: string; answer?: string }>> =>
    this.gate<Array<{ ruleId: string; answer?: string }>>(
      { kind: 'questions', id: randomUUID(), round, questions },
      // Faz 6.A: her sorunun varsayılanı var, satışçı hepsini atlayabilir.
      () => questions.map((question) => ({ ruleId: question.ruleId })),
    );

  onApprove = (
    summary: PublishSummary,
    editor?: ApprovalEditHandler,
  ): Promise<{ approved: boolean; approvedBy?: string }> => {
    this.approvalEditor = editor ?? null;
    this.approvalEditCount = 0;
    return this.gate<{ approved: boolean; approvedBy?: string }>(
      { kind: 'approve', id: randomUUID(), summary },
      // ⛔ Zaman aşımı ONAY DEĞİLDİR. Cevap gelmezse yayınlanmaz.
      () => ({ approved: false }),
    );
  };

  onEvent = (event: FlowEvent): void => {
    this.pushEvent(event);
  };

  /** LLM kullanımı — hem gösterim hem harcama defteri için. */
  recordSpend(costUsd: number | undefined): void {
    if (costUsd === undefined || !Number.isFinite(costUsd) || costUsd <= 0) return;
    this.spentUsd += costUsd;
  }

  // --- HTTP tarafının kullandığı yüzey ------------------------------------

  /**
   * Açık kapıyı cevaplar. Kapı yoksa veya id uyuşmuyorsa `false` döner —
   * geç gelen/yinelenen istek akışı bozmasın.
   */
  answer(gateId: string, payload: unknown): boolean {
    const waiter = this.waiter;
    if (!waiter || waiter.gate.id !== gateId) return false;
    // Edit tamamlanmadan baska sekmeden gelen onay eski fiyati yayinlamasin.
    if (waiter.gate.kind === 'approve' && this.approvalEditInFlight) return false;
    clearTimeout(waiter.timer);
    this.waiter = null;
    this.approvalEditor = null;
    this.state = 'running';
    waiter.resolve(payload);
    this.notify();
    return true;
  }

  /** Onay promise'ini cozmeden teklifi duzenler ve ayni kapiyi yeni ozetle acik tutar. */
  async editApproval(
    gateId: string,
    instruction: string,
  ): Promise<{ accepted: boolean; message?: string }> {
    const waiter = this.waiter;
    if (
      !waiter ||
      waiter.gate.kind !== 'approve' ||
      waiter.gate.id !== gateId ||
      !this.approvalEditor ||
      this.approvalEditInFlight ||
      this.approvalEditCount >= 10
    ) {
      return { accepted: false };
    }

    this.approvalEditInFlight = true;
    this.approvalEditCount += 1;
    this.state = 'running';
    this.pushEvent({ stage: 'revise', message: 'Onay öncesi teklif düzenlemesi uygulanıyor.' });

    try {
      const edited = await this.approvalEditor(instruction, waiter.gate.summary);
      // Onay kapisi baska bir istekle kapanmissa eski kapiyi geri getirme.
      if (this.waiter !== waiter) return { accepted: false };
      waiter.gate = { ...waiter.gate, summary: edited.summary };
      this.state = 'waiting';
      this.pushEvent({ stage: 'revise', message: edited.message });
      return { accepted: true, message: edited.message };
    } catch (error) {
      this.state = 'waiting';
      const message = error instanceof Error ? error.message : String(error);
      this.pushEvent({ stage: 'revise', message: `Düzenleme uygulanamadı: ${message}` });
      throw error;
    } finally {
      this.approvalEditInFlight = false;
      this.notify();
    }
  }

  view(): SessionView {
    return {
      sessionId: this.sessionId,
      state: this.state,
      events: [...this.eventLog],
      gate: this.waiter?.gate ?? null,
      result: this.result,
      error: this.error,
      spentUsd: this.spentUsd,
    };
  }

  /** Durum değişene kadar bekler (uzun yoklama / SSE için). */
  waitForChange(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.listeners.delete(finish);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      timer.unref?.();
      this.listeners.add(finish);
    });
  }

  /** Akış tamamlandığında çağrılır. */
  complete(result: FlowResult): void {
    this.result = result;
    this.state = 'done';
    this.finishedAt = Date.now();
    this.notify();
  }

  fail(error: unknown): void {
    this.error = error instanceof Error ? error.message : String(error);
    this.state = 'failed';
    this.finishedAt = Date.now();
    this.cancelWaiter();
    this.notify();
  }

  /** Süresi geçmiş oturum temizlenebilir mi? */
  isCollectable(now = Date.now()): boolean {
    if (this.finishedAt !== null) return now - this.finishedAt > this.retentionMs;
    // Bitmemiş ama çok uzun süredir açık olan oturum da toplanır: kapı zaman
    // aşımı akışı ilerletir, ama LLM tarafında takılmış bir akış olabilir.
    return now - this.startedAt > this.gateTimeoutMs * 3;
  }

  dispose(): void {
    this.cancelWaiter();
    this.listeners.clear();
    if (this.state === 'running' || this.state === 'waiting') this.state = 'expired';
  }

  private cancelWaiter(): void {
    if (!this.waiter) return;
    clearTimeout(this.waiter.timer);
    // Askıda kalan promise'i çöz — yoksa orchestrator sonsuza kadar bekler
    // ve akışın `finally` blokları hiç çalışmaz.
    const { gate, resolve } = this.waiter;
    this.waiter = null;
    this.approvalEditor = null;
    if (gate.kind === 'approve') resolve({ approved: false });
    else if (gate.kind === 'questions') resolve(gate.questions.map((q) => ({ ruleId: q.ruleId })));
    else resolve({});
  }

  private pushEvent(event: FlowEvent): void {
    this.eventLog.push(event);
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/**
 * Açık oturumları tutar ve süresi geçenleri toplar.
 *
 * Eşzamanlı oturum sayısı sınırlı: her açık oturum bellek ve (kapıda
 * beklemiyorsa) bir LLM akışı demek. Sınırsız bırakmak, tek bir sekme
 * yenilemesi döngüsünün krediyi tüketmesine izin vermek olurdu.
 */
export class FlowSessionRegistry {
  private readonly sessions = new Map<string, FlowSession>();

  constructor(
    private readonly maxSessions = 50,
    private readonly maxPerUser = 3,
  ) {}

  register(session: FlowSession): void {
    this.sweep();
    if (this.sessions.size >= this.maxSessions) {
      throw new FlowCapacityError(
        `Sunucu şu anda ${this.maxSessions} eşzamanlı akış taşıyor; yeni akış başlatılamıyor. ` +
          `Birkaç dakika sonra tekrar deneyin.`,
      );
    }
    const mine = [...this.sessions.values()].filter(
      (candidate) => candidate.userId === session.userId && !candidate.isCollectable(),
    );
    if (mine.length >= this.maxPerUser) {
      throw new FlowCapacityError(
        `Aynı anda en fazla ${this.maxPerUser} açık teklif akışınız olabilir. ` +
          `Açık olanları bitirin veya kapatın.`,
      );
    }
    this.sessions.set(session.sessionId, session);
  }

  /** Kimlik kontrolü DAHİL: başkasının oturumu okunamaz. */
  get(sessionId: string, userId: string): FlowSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (session.userId !== userId) return null;
    return session;
  }

  remove(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.dispose();
    this.sessions.delete(sessionId);
  }

  /**
   * Bir kullanıcıya ait bütün akışları kapatır.
   *
   * Kimlik doğrulamasının kapalı olduğu yerel modda bütün sekmeler aynı
   * kullanıcıyı paylaşır. Sayfa yenilenince tarayıcı eski sessionId'yi
   * kaybettiği için bu akışlar aksi halde kotayı doldurur. Yeni teklif,
   * yerel modda önce eskilerini bununla kapatır.
   */
  removeForUser(userId: string): number {
    let removed = 0;
    for (const [id, session] of this.sessions) {
      if (session.userId !== userId) continue;
      session.dispose();
      this.sessions.delete(id);
      removed++;
    }
    return removed;
  }

  sweep(now = Date.now()): number {
    let removed = 0;
    for (const [id, session] of this.sessions) {
      if (session.isCollectable(now)) {
        session.dispose();
        this.sessions.delete(id);
        removed++;
      }
    }
    return removed;
  }

  get size(): number {
    return this.sessions.size;
  }
}

/** Kullanıcı girdisi değil, kapasite/kota durumu; HTTP katmanı 429 döndürür. */
export class FlowCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlowCapacityError';
  }
}
