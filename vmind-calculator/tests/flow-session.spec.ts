/**
 * Askida-bekletme testleri.
 *
 * Bu katman sessizce bozulmaya en yatkin yer: bir kapi cozulmezse akis sonsuza
 * kadar bekler ve HICBIR HATA gorunmez — sadece teklif hic gelmez. O yuzden
 * testlerin agirligi "kapi her kosulda cozuluyor mu" uzerinde.
 */
import { describe, expect, it, vi } from 'vitest';

import { FlowSession, FlowSessionRegistry } from '../src/web/flow-session.js';
import type { AuditQuestion, CriticalUnknown } from '../src/agents/types.js';
import type { PublishSummary } from '../src/agents/orchestrator.js';

const unknowns: CriticalUnknown[] = [
  { question: 'Kac sunucu?', reason: 'adet olmadan fiyat cikmaz' },
];

const questions: AuditQuestion[] = [
  {
    ruleId: 'NO_BACKUP_ANYWHERE',
    severity: 'recommended',
    question: 'Yedekleme olsun mu?',
    defaultAnswer: 'Eklenmeyecek',
  },
  {
    ruleId: 'LB_NO_TRANSFER',
    severity: 'recommended',
    question: 'LB trafigi ne kadar?',
    defaultAnswer: '1 TB/ay',
  },
];

const summary = { assumptions: [] } as unknown as PublishSummary;

describe('FlowSession — kapi acilir ve cevaplanir', () => {
  it('kapi acildiginda durum waiting olur ve gate gorunur', async () => {
    const session = new FlowSession('u1');
    const pending = session.onClarify(unknowns);

    // Kapi mikro-gorev kuyrugunda aciliyor; bir tur bekle.
    await Promise.resolve();
    const view = session.view();
    expect(view.state).toBe('waiting');
    expect(view.gate?.kind).toBe('clarify');

    session.answer(view.gate!.id, { 'compute.count': '4' });
    await expect(pending).resolves.toEqual({ 'compute.count': '4' });
    expect(session.view().state).toBe('running');
  });

  it('yanlis gate id ile cevap kabul edilmez', async () => {
    const session = new FlowSession('u1');
    void session.onClarify(unknowns);
    await Promise.resolve();
    expect(session.answer('baska-id', {})).toBe(false);
    expect(session.view().state).toBe('waiting');
  });

  it('kapi yokken gelen cevap yutulur, cokme olmaz', () => {
    const session = new FlowSession('u1');
    expect(session.answer('herhangi', {})).toBe(false);
  });

  it('ayni kapi iki kez cevaplanamaz (yinelenen istek)', async () => {
    const session = new FlowSession('u1');
    void session.onClarify(unknowns);
    await Promise.resolve();
    const id = session.view().gate!.id;
    expect(session.answer(id, {})).toBe(true);
    expect(session.answer(id, {})).toBe(false);
  });

  it('ayni anda iki kapi acilmaya calisilirsa hata verir', async () => {
    const session = new FlowSession('u1');
    void session.onClarify(unknowns);
    await Promise.resolve();
    expect(() => session.onQuestions(questions, 1)).toThrow(/birden fazla kapı/);
  });
});

describe('FlowSession — zaman asimi HER KAPIDA cozulur', () => {
  it('netlestirme zaman asiminda BOS cevapla devam eder', async () => {
    vi.useFakeTimers();
    const session = new FlowSession('u1', { gateTimeoutMs: 1000 });
    const pending = session.onClarify(unknowns);
    await Promise.resolve();
    vi.advanceTimersByTime(1001);
    await expect(pending).resolves.toEqual({});
    vi.useRealTimers();
  });

  it('denetim sorulari zaman asiminda VARSAYILANLARA duser', async () => {
    vi.useFakeTimers();
    const session = new FlowSession('u1', { gateTimeoutMs: 1000 });
    const pending = session.onQuestions(questions, 1);
    await Promise.resolve();
    vi.advanceTimersByTime(1001);
    // Faz 6.A: her sorunun varsayilani var, hepsi atlanabilir.
    await expect(pending).resolves.toEqual([
      { ruleId: 'NO_BACKUP_ANYWHERE' },
      { ruleId: 'LB_NO_TRANSFER' },
    ]);
    vi.useRealTimers();
  });

  /**
   * EN ONEMLI TEST. Zaman asimi ONAY DEGILDIR. Satisci sekmeyi kapatip gittiyse
   * teklif YAYINLANMAMALI — sessizce onaylanmis sayilmasi, HITL kapisini
   * anlamsiz kilardi.
   */
  it('ONAY kapisi zaman asiminda ONAYLAMAZ', async () => {
    vi.useFakeTimers();
    const session = new FlowSession('u1', { gateTimeoutMs: 1000 });
    const pending = session.onApprove(summary);
    await Promise.resolve();
    vi.advanceTimersByTime(1001);
    await expect(pending).resolves.toEqual({ approved: false });
    vi.useRealTimers();
  });

  it('zaman asimi ize bir olay dusurur', async () => {
    vi.useFakeTimers();
    const session = new FlowSession('u1', { gateTimeoutMs: 1000 });
    void session.onApprove(summary);
    await Promise.resolve();
    vi.advanceTimersByTime(1001);
    expect(session.view().events.some((event) => /zaman aşımı/.test(event.message))).toBe(true);
    vi.useRealTimers();
  });
});

describe('FlowSession — dispose askida promise BIRAKMAZ', () => {
  /**
   * dispose() askidaki promise'i cozmezse orchestrator sonsuza kadar bekler:
   * akisin `finally` bloklari calismaz, bellek ve (varsa) LLM baglantisi
   * sizar. Hicbir hata gorunmez — bu yuzden ayrica test ediliyor.
   */
  it('onay kapisi askidayken dispose -> onaylanmadi olarak cozulur', async () => {
    const session = new FlowSession('u1');
    const pending = session.onApprove(summary);
    await Promise.resolve();
    session.dispose();
    await expect(pending).resolves.toEqual({ approved: false });
  });

  it('soru kapisi askidayken dispose -> varsayilanlara duser', async () => {
    const session = new FlowSession('u1');
    const pending = session.onQuestions(questions, 1);
    await Promise.resolve();
    session.dispose();
    await expect(pending).resolves.toHaveLength(2);
  });

  it('netlestirme askidayken dispose -> bos cozulur', async () => {
    const session = new FlowSession('u1');
    const pending = session.onClarify(unknowns);
    await Promise.resolve();
    session.dispose();
    await expect(pending).resolves.toEqual({});
  });

  it('fail() de askidaki kapiyi cozer', async () => {
    const session = new FlowSession('u1');
    const pending = session.onApprove(summary);
    await Promise.resolve();
    session.fail(new Error('LLM coktu'));
    await expect(pending).resolves.toEqual({ approved: false });
    expect(session.view().state).toBe('failed');
    expect(session.view().error).toBe('LLM coktu');
  });
});

describe('FlowSession — durum ve harcama', () => {
  it('olaylar sirayla birikiyor', () => {
    const session = new FlowSession('u1');
    session.onEvent({ stage: 'understand', message: 'bir' });
    session.onEvent({ stage: 'design', message: 'iki' });
    expect(session.view().events.map((event) => event.message)).toEqual(['bir', 'iki']);
  });

  it('harcama toplaniyor, gecersiz degerler yutuluyor', () => {
    const session = new FlowSession('u1');
    session.recordSpend(0.1);
    session.recordSpend(0.2);
    session.recordSpend(undefined);
    session.recordSpend(Number.NaN);
    session.recordSpend(-1);
    expect(session.view().spentUsd).toBeCloseTo(0.3, 10);
  });

  it('waitForChange kapi acilinca uyanir', async () => {
    const session = new FlowSession('u1');
    const woken = session.waitForChange(5000);
    void session.onClarify(unknowns);
    await expect(woken).resolves.toBeUndefined();
  });

  it('waitForChange degisiklik olmazsa zaman asimiyla doner', async () => {
    vi.useFakeTimers();
    const session = new FlowSession('u1');
    const woken = session.waitForChange(1000);
    vi.advanceTimersByTime(1001);
    await expect(woken).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});

describe('FlowSessionRegistry — sinirlar ve izolasyon', () => {
  it('baskasinin oturumu OKUNAMAZ', () => {
    const registry = new FlowSessionRegistry();
    const session = new FlowSession('sahibi');
    registry.register(session);
    expect(registry.get(session.sessionId, 'sahibi')).toBe(session);
    expect(registry.get(session.sessionId, 'baskasi')).toBeNull();
  });

  it('olmayan oturum null doner', () => {
    expect(new FlowSessionRegistry().get('yok', 'u1')).toBeNull();
  });

  it('kisi basi eszamanli akis siniri var', () => {
    const registry = new FlowSessionRegistry(50, 2);
    registry.register(new FlowSession('u1'));
    registry.register(new FlowSession('u1'));
    expect(() => registry.register(new FlowSession('u1'))).toThrow(/en fazla 2/);
    // Baska kullanici etkilenmez.
    expect(() => registry.register(new FlowSession('u2'))).not.toThrow();
  });

  it('toplam eszamanli akis siniri var', () => {
    const registry = new FlowSessionRegistry(2, 5);
    registry.register(new FlowSession('u1'));
    registry.register(new FlowSession('u2'));
    expect(() => registry.register(new FlowSession('u3'))).toThrow(/eşzamanlı akış/);
  });

  it('biten oturum saklama suresi sonunda toplanir', () => {
    const registry = new FlowSessionRegistry();
    const session = new FlowSession('u1', { retentionMs: 1000 });
    registry.register(session);
    session.complete({ stage: 'done', assumptions: [], rounds: 1, published: false, events: [] });

    expect(registry.sweep(Date.now())).toBe(0);
    expect(registry.sweep(Date.now() + 2000)).toBe(1);
    expect(registry.size).toBe(0);
  });

  it('cok uzun suredir acik kalan bitmemis oturum da toplanir', () => {
    const registry = new FlowSessionRegistry();
    const session = new FlowSession('u1', { gateTimeoutMs: 1000 });
    registry.register(session);
    // gateTimeoutMs * 3 sonrasi: akis takilmis kabul edilir.
    expect(registry.sweep(Date.now() + 3001)).toBe(1);
  });

  it('toplanan oturum dispose edilir (durum expired)', () => {
    const registry = new FlowSessionRegistry();
    const session = new FlowSession('u1', { gateTimeoutMs: 1000 });
    registry.register(session);
    registry.sweep(Date.now() + 3001);
    expect(session.view().state).toBe('expired');
  });

  it('remove oturumu kapatir', () => {
    const registry = new FlowSessionRegistry();
    const session = new FlowSession('u1');
    registry.register(session);
    registry.remove(session.sessionId);
    expect(registry.size).toBe(0);
    expect(registry.get(session.sessionId, 'u1')).toBeNull();
  });

  it('removeForUser yalnizca o kullanicinin akislarini kapatir', () => {
    const registry = new FlowSessionRegistry();
    const first = new FlowSession('u1');
    const second = new FlowSession('u1');
    const other = new FlowSession('u2');
    registry.register(first);
    registry.register(second);
    registry.register(other);

    expect(registry.removeForUser('u1')).toBe(2);
    expect(registry.size).toBe(1);
    expect(first.view().state).toBe('expired');
    expect(second.view().state).toBe('expired');
    expect(registry.get(other.sessionId, 'u2')).toBe(other);
  });

  it('sinira gelmis kayit once suresi gecenleri temizler', () => {
    const registry = new FlowSessionRegistry(1, 5);
    const eski = new FlowSession('u1', { retentionMs: -1 });
    registry.register(eski);
    eski.complete({ stage: 'done', assumptions: [], rounds: 0, published: false, events: [] });
    // Slot dolu ama eski oturum toplanabilir -> yeni kayit gecmeli.
    expect(() => registry.register(new FlowSession('u2'))).not.toThrow();
  });
});
