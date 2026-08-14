/**
 * Harcama korumasi testleri.
 *
 * Bu katmanin varlik sebebi tek bir cumle: "krediyi tuketme". O yuzden testler
 * yalnizca mutlu yolu degil, KACAK YOLLARI kontrol eder — gun donmesi, bozuk
 * defter, restart, maliyet bildirilmemesi.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BudgetExceededError,
  BudgetLedger,
  LedgerUnreadableError,
  limitsFromEnv,
} from '../src/web/budget.js';

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vmind-budget-'));
  path = join(dir, 'budget.json');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const at = (iso: string) => () => new Date(iso);
const limits = { dailyTotalUsd: 5, dailyPerUserUsd: 1 };

describe('BudgetLedger — sinirlar', () => {
  it('temiz kurulumda harcamaya izin verir', () => {
    const ledger = new BudgetLedger(limits, path, at('2026-07-30T10:00:00Z'));
    expect(() => ledger.assertCanSpend('a@x.com')).not.toThrow();
    expect(ledger.snapshot().totalUsd).toBe(0);
  });

  it('kisi basi sinira gelince O KULLANICIYI reddeder, digerini etkilemez', () => {
    const ledger = new BudgetLedger(limits, path, at('2026-07-30T10:00:00Z'));
    ledger.record('a@x.com', 1.0);
    expect(() => ledger.assertCanSpend('a@x.com')).toThrow(BudgetExceededError);
    // b hala harcayabilir — kisi basi sinir kisiye ozel olmali.
    expect(() => ledger.assertCanSpend('b@x.com')).not.toThrow();
  });

  it('gunluk toplam sinira gelince HERKESI reddeder', () => {
    const ledger = new BudgetLedger(limits, path, at('2026-07-30T10:00:00Z'));
    // Bes ayri kullanici, her biri kisi basi sinirin altinda ama toplam tavanda.
    for (const user of ['a', 'b', 'c', 'd', 'e']) ledger.record(`${user}@x.com`, 1.0);
    expect(() => ledger.assertCanSpend('f@x.com')).toThrow(/Günlük toplam/);
  });

  it('maliyet bildirilmezse sayac ilerlemez', () => {
    const ledger = new BudgetLedger(limits, path, at('2026-07-30T10:00:00Z'));
    ledger.record('a@x.com', undefined);
    ledger.record('a@x.com', 0);
    ledger.record('a@x.com', Number.NaN);
    expect(ledger.snapshot().totalUsd).toBe(0);
  });

  it('sinir 0 ise sinirsiz demektir', () => {
    const ledger = new BudgetLedger({ dailyTotalUsd: 0, dailyPerUserUsd: 0 }, path, at('2026-07-30T10:00:00Z'));
    ledger.record('a@x.com', 9999);
    expect(() => ledger.assertCanSpend('a@x.com')).not.toThrow();
    expect(ledger.remaining('a@x.com')).toEqual({ total: null, user: null });
  });

  it('kalan butce dogru hesaplaniyor', () => {
    const ledger = new BudgetLedger(limits, path, at('2026-07-30T10:00:00Z'));
    ledger.record('a@x.com', 0.4);
    expect(ledger.remaining('a@x.com')).toEqual({ total: 4.6, user: 0.6 });
    // Baska kullanicinin kalani toplamdan etkilenir ama kendi sayaci temiz.
    expect(ledger.remaining('b@x.com')).toEqual({ total: 4.6, user: 1 });
  });
});

describe('BudgetLedger — kaliciligi (restart ve gun donmesi)', () => {
  it('yeniden baslatmada harcama KAYBOLMAZ', () => {
    const first = new BudgetLedger(limits, path, at('2026-07-30T10:00:00Z'));
    first.record('a@x.com', 1.0);

    // Sunucu yeniden basladi: ayni dosya, yeni nesne.
    const second = new BudgetLedger(limits, path, at('2026-07-30T11:00:00Z'));
    expect(second.snapshot().totalUsd).toBe(1.0);
    expect(() => second.assertCanSpend('a@x.com')).toThrow(BudgetExceededError);
  });

  it('gun donunce sifirlanir', () => {
    const first = new BudgetLedger(limits, path, at('2026-07-30T23:00:00Z'));
    first.record('a@x.com', 1.0);
    expect(() => first.assertCanSpend('a@x.com')).toThrow();

    const nextDay = new BudgetLedger(limits, path, at('2026-07-31T01:00:00Z'));
    expect(nextDay.snapshot().totalUsd).toBe(0);
    expect(() => nextDay.assertCanSpend('a@x.com')).not.toThrow();
  });

  it('sunucu ayakta kalirken gun donerse de sifirlanir', () => {
    let now = new Date('2026-07-30T23:59:00Z');
    const ledger = new BudgetLedger(limits, path, () => now);
    ledger.record('a@x.com', 1.0);
    expect(() => ledger.assertCanSpend('a@x.com')).toThrow();

    now = new Date('2026-07-31T00:01:00Z');
    expect(() => ledger.assertCanSpend('a@x.com')).not.toThrow();
    expect(ledger.snapshot().totalUsd).toBe(0);
  });

  it('diske gercekten yaziliyor ve okunabilir JSON', () => {
    const ledger = new BudgetLedger(limits, path, at('2026-07-30T10:00:00Z'));
    ledger.record('a@x.com', 0.25);
    const onDisk = JSON.parse(readFileSync(path, 'utf8'));
    expect(onDisk.day).toBe('2026-07-30');
    expect(onDisk.totalUsd).toBe(0.25);
    expect(onDisk.perUserUsd['a@x.com']).toBe(0.25);
  });
});

describe('BudgetLedger — bozuk defter KAPALI tarafa duser', () => {
  /**
   * En onemli test. Bozuk bir defteri "harcama yok" saymak, her yeniden
   * baslatmada gunluk kotayi yeniden acardi — sinirin varlik sebebini yok eder.
   * Bu yuzden acilis BASARISIZ olmali, sessizce sifirlanmamali.
   */
  it('gecersiz JSON -> hata, sessizce sifirlanmaz', () => {
    writeFileSync(path, '{ bu json degil', 'utf8');
    expect(() => new BudgetLedger(limits, path, at('2026-07-30T10:00:00Z'))).toThrow(
      LedgerUnreadableError,
    );
  });

  it('alanlar eksik/yanlis tipte -> hata', () => {
    writeFileSync(path, JSON.stringify({ day: '2026-07-30', totalUsd: 'cok' }), 'utf8');
    expect(() => new BudgetLedger(limits, path, at('2026-07-30T10:00:00Z'))).toThrow(
      LedgerUnreadableError,
    );
  });

  it('totalUsd sonsuz/NaN -> hata', () => {
    writeFileSync(path, '{"day":"2026-07-30","totalUsd":null,"perUserUsd":{}}', 'utf8');
    expect(() => new BudgetLedger(limits, path, at('2026-07-30T10:00:00Z'))).toThrow(
      LedgerUnreadableError,
    );
  });

  it('dosya HIC yoksa temiz kurulumdur, hata vermez', () => {
    expect(() => new BudgetLedger(limits, join(dir, 'yok.json'), at('2026-07-30T10:00:00Z'))).not.toThrow();
  });

  it('hata mesaji ne yapilacagini soyluyor', () => {
    writeFileSync(path, 'bozuk', 'utf8');
    try {
      new BudgetLedger(limits, path, at('2026-07-30T10:00:00Z'));
      expect.unreachable('hata atmaliydi');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('düzeltin veya silin');
      expect(message).toContain(path);
    }
  });
});

describe('limitsFromEnv', () => {
  it('varsayilanlar: gunde $5 toplam, kisi basi $1', () => {
    expect(limitsFromEnv({})).toEqual({ dailyTotalUsd: 5, dailyPerUserUsd: 1 });
  });

  it('ortam degiskeni okunuyor', () => {
    expect(limitsFromEnv({ LLM_DAILY_TOTAL_USD: '20', LLM_DAILY_PER_USER_USD: '2.5' })).toEqual({
      dailyTotalUsd: 20,
      dailyPerUserUsd: 2.5,
    });
  });

  it('bos string varsayilana duser', () => {
    expect(limitsFromEnv({ LLM_DAILY_TOTAL_USD: '  ' }).dailyTotalUsd).toBe(5);
  });

  /**
   * Yanlis yazilmis bir sinir SESSIZCE sinirsiza dusmemeli.
   * `LLM_DAILY_TOTAL_USD=5$` yazan biri sinir koydugunu sanir.
   */
  it('gecersiz deger sessizce yutulmaz', () => {
    expect(() => limitsFromEnv({ LLM_DAILY_TOTAL_USD: '5$' })).toThrow(/geçersiz/);
    expect(() => limitsFromEnv({ LLM_DAILY_PER_USER_USD: '-1' })).toThrow(/geçersiz/);
  });
});
