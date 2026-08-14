/**
 * FAZ 5.C — Reconciler
 *
 * "Rakam tutuyor mu" sorusunun TEK sahibi.
 *
 * BU AJANDA LLM YOK — ve olmamali. Iki sayinin esit olup olmadigi bir dil
 * problemi degil; buraya bir model sokmak, projenin tek guvenilir kontrolunu
 * olasiliksal hale getirirdi.
 *
 * Neyi dogruluyor: teklifi platforma yazip geri okudugumuzda, saklanan JSON'dan
 * yeniden hesaplanan tutar bizim gosterdigimiz tutarla ayni mi. Bu, JSON
 * serilestirmede alan kaybi (ornegin bir `unit` veya ic ice `storage`) olmadigini
 * kanitlar — backend hicbir dogrulama yapmadigi icin tek guvencemiz budur.
 */
import { serviceTotals, type PriceLine } from '../core/pricing/engine.js';
import type { Catalog } from '../core/catalog/catalog.js';
import type { Currency, ServiceCode } from '../core/schema/estimate.js';
import type { PriceSnapshot, ReconcileResult } from './types.js';

/** PLAN 5.C kabul kriteri: fark bunun altinda olmali. */
export const RECONCILE_TOLERANCE = 0.01;

export interface RemoteEstimate {
  id: string;
  currency: Currency;
  list: Array<{ id?: string; service: ServiceCode; data: unknown }>;
}

/**
 * Platformdan geri okunan `estimateplan` govdesini cozer.
 *
 * ZARF SEKLI TAHMIN DEGIL, OLCUM. Ilk surum `json` / `items[0].json` bekliyordu
 * — POST govdesinde alan adi `json` oldugu icin makul bir tahmindi ve tum
 * testler taklit veriyle gectigi icin yanlisligi gorunmedi. 2026-07-30'da ilk
 * gercek yazma yapildiginda GET'in bambaska bir sekil dondurdugu goruldu:
 *
 *   GET /billing/estimateplan/{key}
 *   {"result":{"success":true,...},"item":"{\"id\":\"...\",\"list\":[...]}"}
 *                                 ^^^^ tekil `item`, ve degeri JSON STRING
 *
 * (POST ayni alani `"item": true` olarak dondurur — ayni ad, farkli tip.)
 * Yani reconcile her gercek yayinlamada patlayacakti. Dordunu de deneyene
 * kadar goremedigimiz tek sey buydu.
 *
 * Eski adlar da kabul ediliyor: hangi ucun hangi sekli dondurdugu belgelenmemis,
 * ve bu fonksiyon yanlis alan adi yuzunden bir daha kor kalmamali.
 */
export function parseRemoteEstimate(payload: unknown): RemoteEstimate {
  const envelope = payload as {
    item?: unknown;
    json?: unknown;
    items?: Array<{ json?: unknown }>;
  };
  // `item` gercek olculen alan; digerleri savunma amacli.
  const candidates = [envelope.item, envelope.json, envelope.items?.[0]?.json];
  const raw = candidates.find((value) => typeof value === 'string');
  if (typeof raw !== 'string') {
    throw new Error(
      'Platform yaniti teklif JSON\'unu icermiyor: `item`, `json` veya `items[0].json` ' +
        'alanlarindan hicbiri string degil.',
    );
  }
  const parsed = JSON.parse(raw) as RemoteEstimate;
  if (!Array.isArray(parsed.list)) {
    throw new Error('Geri okunan teklifte `list` dizisi yok.');
  }
  return parsed;
}

const lineKey = (line: PriceLine): string =>
  `${line.service ?? '?'}|${line.productName}|${String(line.count)}`;

/**
 * Yerel hesap ile platformdan geri okunan teklifin hesabini karsilastirir.
 *
 * Not: her iki taraf da AYNI motorla hesaplanir. Karsilastirilan sey motorlar
 * degil, VERININ kendisi — gonderdigimiz teklif ile platformun sakladigi teklif
 * ayni mi. Motorun platformla ayni oldugu Faz 2.B'de ayri olarak kanitlandi.
 */
export function reconcile(
  catalog: Catalog,
  local: PriceSnapshot,
  remote: RemoteEstimate,
): ReconcileResult {
  const remoteTotals = serviceTotals(
    { products: catalog.products },
    { currency: remote.currency, list: remote.list },
  );

  const hourlyDiff = Math.abs(local.totalHourCost - remoteTotals.totalHourCost);
  const monthlyDiff = Math.abs(local.totalMonthCost - remoteTotals.totalMonthCost);

  const lineMismatches: string[] = [];

  if (local.currency !== remote.currency) {
    lineMismatches.push(
      `Para birimi uyusmuyor: yerel ${local.currency}, platform ${remote.currency}.`,
    );
  }
  if (local.lines.length !== remoteTotals.lines.length) {
    lineMismatches.push(
      `Satir sayisi uyusmuyor: yerel ${local.lines.length}, platform ${remoteTotals.lines.length}.`,
    );
  }

  // Satir sirasi onemli degil; icerik onemli.
  const remoteByKey = new Map<string, PriceLine[]>();
  for (const line of remoteTotals.lines) {
    const key = lineKey(line);
    if (!remoteByKey.has(key)) remoteByKey.set(key, []);
    remoteByKey.get(key)!.push(line);
  }

  for (const line of local.lines) {
    const key = lineKey(line);
    const candidates = remoteByKey.get(key);
    if (!candidates || candidates.length === 0) {
      lineMismatches.push(`Platform tarafinda karsiligi yok: ${key}`);
      continue;
    }
    const match = candidates.shift()!;
    if (Math.abs(match.monthly - line.monthly) > RECONCILE_TOLERANCE) {
      lineMismatches.push(
        `${key}: aylik tutar farkli (yerel ${line.monthly}, platform ${match.monthly}).`,
      );
    }
  }
  for (const [key, leftovers] of remoteByKey) {
    for (let i = 0; i < leftovers.length; i++) {
      lineMismatches.push(`Yerelde karsiligi yok, platformda var: ${key}`);
    }
  }

  const ok =
    hourlyDiff < RECONCILE_TOLERANCE && monthlyDiff < RECONCILE_TOLERANCE && lineMismatches.length === 0;

  return {
    ok,
    localHourly: local.totalHourCost,
    localMonthly: local.totalMonthCost,
    remoteHourly: remoteTotals.totalHourCost,
    remoteMonthly: remoteTotals.totalMonthCost,
    hourlyDiff,
    monthlyDiff,
    lineMismatches,
    message: ok
      ? `Mutabakat saglandi: aylik ${local.totalMonthCost.toFixed(4)} ${local.currency} (fark ${monthlyDiff.toFixed(6)}).`
      : `MUTABAKATSIZLIK: aylik fark ${monthlyDiff.toFixed(6)} ${local.currency}. ` +
        `Akis durdurulmali. ${lineMismatches.join(' ')}`,
  };
}
