import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, api, type CustomerCrmContext, type SessionView } from './api';

/**
 * Akışı başlatır ve durumunu canlı takip eder.
 *
 * ## Neden uzun yoklama, neden SSE değil
 *
 * SSE (EventSource) çerez gönderir ve tek yönlüdür — ama akışın yarısı ZATEN
 * istek/yanıt (kapı cevaplama). İki taşıma katmanı tutmak yerine tek bir
 * `GET ?wait=` yeterli: sunucu durum değişene kadar bekliyor, değişince
 * dönüyor. Aşama olayları anında geliyor, boşa dönen istek neredeyse yok.
 *
 * ## Sızıntı koruması
 *
 * Bileşen sökülürse (`unmount`) veya oturum değişirse döngü DURMALI. Aksi
 * halde arka planda sonsuza kadar istek atan bir döngü kalır. `alive` bayrağı
 * ve `AbortController` bunu garantiler.
 */
export function useFlow() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [view, setView] = useState<SessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  /** Döngünün hâlâ geçerli olup olmadığı — sökülmede false olur. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const start = useCallback(async (salesText: string, customer?: CustomerCrmContext) => {
    setError(null);
    setView(null);
    setStarting(true);
    try {
      const { sessionId: id } = await api.startFlow(salesText, customer);
      if (!alive.current) return;
      setSessionId(id);
    } catch (caught) {
      if (!alive.current) return;
      const problem = caught as ApiError;
      setError(
        problem.status === 429
          ? `${problem.message}${problem.scope === 'total' ? ' (günlük toplam)' : ''}`
          : problem.message,
      );
    } finally {
      if (alive.current) setStarting(false);
    }
  }, []);

  // Yoklama döngüsü — sessionId varken çalışır.
  useEffect(() => {
    if (!sessionId) return;
    let stopped = false;

    const loop = async (): Promise<void> => {
      // İlk okuma beklemesiz: ekran hemen dolsun.
      let wait = 0;
      while (!stopped && alive.current) {
        try {
          const next = await api.flow(sessionId, wait);
          if (stopped || !alive.current) return;
          setView(next);
          if (next.state === 'done' || next.state === 'failed' || next.state === 'expired') return;
          wait = 20_000;
        } catch (caught) {
          if (stopped || !alive.current) return;
          setError((caught as Error).message);
          return;
        }
      }
    };

    void loop();
    return () => {
      stopped = true;
    };
  }, [sessionId]);

  const answer = useCallback(
    async (gateId: string, payload: unknown) => {
      if (!sessionId) return;
      try {
        const { view: next } = await api.answer(sessionId, gateId, payload);
        if (alive.current) setView(next);
      } catch (caught) {
        if (alive.current) setError((caught as Error).message);
      }
    },
    [sessionId],
  );

  const edit = useCallback(
    async (gateId: string, instruction: string): Promise<string> => {
      if (!sessionId) throw new Error('Açık teklif oturumu yok.');
      setError(null);
      try {
        const result = await api.edit(sessionId, gateId, instruction);
        if (alive.current) setView(result.view);
        return result.message ?? 'Teklif güncellendi.';
      } catch (caught) {
        if (alive.current) setError((caught as Error).message);
        throw caught;
      }
    },
    [sessionId],
  );

  const reset = useCallback(() => {
    // Sunucudaki oturumu da kapat — bellekte asılı kalmasın.
    if (sessionId) void api.close(sessionId).catch(() => undefined);
    setSessionId(null);
    setView(null);
    setError(null);
  }, [sessionId]);

  return { sessionId, view, error, starting, start, answer, edit, reset };
}
