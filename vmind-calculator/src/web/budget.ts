/**
 * LLM harcama koruması — günlük toplam + kişi başı sınır.
 *
 * Neden sunucuda: LLM anahtarı sunucuda duruyor, tarayıcıya hiç gitmiyor.
 * Yani arayüze erişen herkes anahtarı görmeden de kredi harcayabilir. Fren
 * burada olmak zorunda.
 *
 * `evals/run-eval.ts`'teki BudgetGuard'ın mantığı aynı ama iki fark var:
 *   1. Kişi bazlı takip (kim harcadı) — auth katmanından gelen kimliğe bağlı.
 *   2. KALICI. Eval tek seferlik bir süreç; sunucu yeniden başlar. Defter
 *      bellekte kalırsa her restart krediyi sıfırdan harcanabilir gösterir.
 *
 * ⛔ DEFTER OKUNAMIYORSA KAPALI TARAFA DÜŞÜLÜR.
 * Bozuk/okunamayan bir defter dosyasını "harcama yok" saymak, restart başına
 * bir günlük kotayı yeniden açar — sınırın var olma sebebini ortadan kaldırır.
 * Dosya HİÇ yoksa bu temiz kurulumdur ve sıfırdan başlanır; dosya VAR ama
 * okunamıyorsa hata verilir ve sunucu açılmaz.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

export interface BudgetLimits {
  /** Günlük toplam tavan (USD). 0 = sınırsız. */
  dailyTotalUsd: number;
  /** Kişi başı günlük tavan (USD). 0 = sınırsız. */
  dailyPerUserUsd: number;
}

export interface BudgetSnapshot {
  day: string;
  totalUsd: number;
  perUserUsd: Record<string, number>;
  limits: BudgetLimits;
  /** Diske yazma kaç kez başarısız oldu (0 olmalı). */
  writeFailures: number;
}

interface Ledger {
  day: string;
  totalUsd: number;
  perUserUsd: Record<string, number>;
}

export class BudgetExceededError extends Error {
  constructor(
    readonly scope: 'total' | 'user',
    readonly spentUsd: number,
    readonly limitUsd: number,
    readonly user?: string,
  ) {
    const who = scope === 'total' ? 'Günlük toplam' : `Kullanıcı (${user ?? '?'}) günlük`;
    super(
      `${who} LLM harcama sınırı aşıldı: $${spentUsd.toFixed(4)} / $${limitUsd.toFixed(2)}. ` +
        `Yarın sıfırlanır. Sınırı yükseltmek için sunucu ayarları değiştirilmeli.`,
    );
    this.name = 'BudgetExceededError';
  }
}

export class LedgerUnreadableError extends Error {
  constructor(path: string, cause: string) {
    super(
      `Harcama defteri okunamadı (${path}): ${cause}\n` +
        `Sunucu bilerek açılmıyor: bozuk defteri "harcama yok" saymak her yeniden ` +
        `başlatmada günlük kotayı yeniden açardı. Dosyayı düzeltin veya silin ` +
        `(silmek o günün harcamasını sıfırlar).`,
    );
    this.name = 'LedgerUnreadableError';
  }
}

/** `new Date()` enjekte edilebilir — audit.ts'teki aynı desen, test için. */
export type Clock = () => Date;

const dayKey = (date: Date): string => date.toISOString().slice(0, 10);

export class BudgetLedger {
  private ledger: Ledger;
  private writeFailures = 0;

  constructor(
    private readonly limits: BudgetLimits,
    private readonly filePath: string,
    private readonly clock: Clock = () => new Date(),
  ) {
    this.ledger = this.load();
  }

  private load(): Ledger {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch (error) {
      // ENOENT = temiz kurulum, sıfırdan başla. Diğer her hata (izin, I/O)
      // sessizce yutulamaz: defter var ama okunamıyor olabilir.
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return this.fresh();
      throw new LedgerUnreadableError(this.filePath, (error as Error).message);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new LedgerUnreadableError(this.filePath, `geçersiz JSON — ${(error as Error).message}`);
    }

    const candidate = parsed as Partial<Ledger>;
    if (
      typeof candidate.day !== 'string' ||
      typeof candidate.totalUsd !== 'number' ||
      !Number.isFinite(candidate.totalUsd) ||
      typeof candidate.perUserUsd !== 'object' ||
      candidate.perUserUsd === null
    ) {
      throw new LedgerUnreadableError(this.filePath, 'beklenen alanlar eksik veya yanlış tipte');
    }

    // Gün değiştiyse sıfırla — dosyada eski gün kalmış olabilir.
    if (candidate.day !== dayKey(this.clock())) return this.fresh();
    return {
      day: candidate.day,
      totalUsd: candidate.totalUsd,
      perUserUsd: { ...(candidate.perUserUsd as Record<string, number>) },
    };
  }

  private fresh(): Ledger {
    return { day: dayKey(this.clock()), totalUsd: 0, perUserUsd: {} };
  }

  /** Gün döndüyse defteri sıfırlar. Her işlemden önce çağrılır. */
  private rollover(): void {
    const today = dayKey(this.clock());
    if (this.ledger.day !== today) {
      this.ledger = { day: today, totalUsd: 0, perUserUsd: {} };
      this.persist();
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      // Atomik yazma: yarım yazılmış dosya bir sonraki açılışta
      // LedgerUnreadableError'a düşer ve sunucuyu kilitler.
      const tmp = `${this.filePath}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.ledger), 'utf8');
      renameSync(tmp, this.filePath);
    } catch {
      // Yazma başarısızlığı akışı kesmez ama GÖRÜNÜR olur: /api/status
      // bunu raporlar, çünkü sessiz kayıp restart'ta kotayı yeniden açar.
      this.writeFailures++;
    }
  }

  /**
   * Akışa GİRMEDEN önce çağrılır — akışın ortasında kesmek satışçıyı
   * yarı yolda bırakır. Aşımda hata atar.
   */
  assertCanSpend(user: string): void {
    this.rollover();
    const { dailyTotalUsd, dailyPerUserUsd } = this.limits;
    if (dailyTotalUsd > 0 && this.ledger.totalUsd >= dailyTotalUsd) {
      throw new BudgetExceededError('total', this.ledger.totalUsd, dailyTotalUsd);
    }
    const spent = this.ledger.perUserUsd[user] ?? 0;
    if (dailyPerUserUsd > 0 && spent >= dailyPerUserUsd) {
      throw new BudgetExceededError('user', spent, dailyPerUserUsd, user);
    }
  }

  /** LLM kullanımını deftere yazar. `costUsd` yoksa sayaç ilerlemez. */
  record(user: string, costUsd: number | undefined): void {
    if (costUsd === undefined || !Number.isFinite(costUsd) || costUsd <= 0) return;
    this.rollover();
    this.ledger.totalUsd += costUsd;
    this.ledger.perUserUsd[user] = (this.ledger.perUserUsd[user] ?? 0) + costUsd;
    this.persist();
  }

  snapshot(): BudgetSnapshot {
    this.rollover();
    return {
      day: this.ledger.day,
      totalUsd: this.ledger.totalUsd,
      perUserUsd: { ...this.ledger.perUserUsd },
      limits: { ...this.limits },
      writeFailures: this.writeFailures,
    };
  }

  /** Kalan bütçe — arayüzde göstermek için. */
  remaining(user: string): { total: number | null; user: number | null } {
    this.rollover();
    const { dailyTotalUsd, dailyPerUserUsd } = this.limits;
    return {
      total: dailyTotalUsd > 0 ? Math.max(0, dailyTotalUsd - this.ledger.totalUsd) : null,
      user:
        dailyPerUserUsd > 0
          ? Math.max(0, dailyPerUserUsd - (this.ledger.perUserUsd[user] ?? 0))
          : null,
    };
  }
}

export const DEFAULT_LEDGER_PATH = join(process.cwd(), 'var', 'budget.json');

export function limitsFromEnv(env: NodeJS.ProcessEnv = process.env): BudgetLimits {
  const num = (name: string, fallback: number): number => {
    const raw = env[name];
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${name} geçersiz: "${raw}". Negatif olmayan bir sayı olmalı (0 = sınırsız).`);
    }
    return value;
  };
  return {
    dailyTotalUsd: num('LLM_DAILY_TOTAL_USD', 5),
    dailyPerUserUsd: num('LLM_DAILY_PER_USER_USD', 1),
  };
}
