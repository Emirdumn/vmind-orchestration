/**
 * FAZ 7.B — PII taramasi
 *
 * Musteri kimlik bilgisinin teklif metnine, prompt'a veya denetim izine
 * sizmasini yakalar.
 *
 * TASARIM KARARI — GERCEK ALGORITMALAR, DESEN DEGIL:
 * TCKN icin 11 hane deseni, kart icin 16 hane deseni yeterli GORUNUR ama
 * yanlis pozitif yagdirir: bu projedeki `productCode` degerleri UUID,
 * fiyatlar ondalikli, `sourceSize` sayisal. Bir denetim izi her fiyat
 * degisikliginde "PII buldum" derse satisci uyarilari kapatir — Faz 4.C'nin
 * "yanlis pozitif = 0" disiplininin aynisi burada da geciyor.
 *
 * Bu yuzden TCKN checksum'i ve kart icin Luhn DOGRULANIYOR.
 */

export type PiiKind = 'email' | 'phone' | 'tckn' | 'iban' | 'creditCard';

export interface PiiFinding {
  kind: PiiKind;
  /** Bulgunun metindeki konumu. */
  start: number;
  end: number;
  /** Maskelenmis hali — ham deger ASLA saklanmaz/loglanmaz. */
  masked: string;
}

/**
 * Ham degeri maskeler: bas ve son birkac karakter disinda yildiz.
 * Denetim izine yalnizca bu gider — izin kendisi bir sizinti kaynagi olmamali.
 */
export function mask(value: string): string {
  const clean = value.trim();
  if (clean.length <= 4) return '*'.repeat(clean.length);
  const head = clean.slice(0, 2);
  const tail = clean.slice(-2);
  return `${head}${'*'.repeat(Math.max(3, clean.length - 4))}${tail}`;
}

// ---------------------------------------------------------------------------
// Dogrulayicilar
// ---------------------------------------------------------------------------

/**
 * T.C. Kimlik Numarasi checksum'i.
 *
 * Kurallar: 11 hane, ilk hane 0 olamaz, 10. hane
 * ((tek konumlarin toplami * 7) - cift konumlarin toplami) mod 10,
 * 11. hane ilk 10 hanenin toplami mod 10.
 *
 * Bu dogrulama olmadan her 11 haneli sayi PII sayilirdi.
 */
export function isValidTckn(value: string): boolean {
  if (!/^[1-9][0-9]{10}$/.test(value)) return false;
  const d = [...value].map(Number) as number[];

  const oddSum = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
  const evenSum = d[1]! + d[3]! + d[5]! + d[7]!;

  const tenth = (oddSum * 7 - evenSum) % 10;
  if (((tenth + 10) % 10) !== d[9]!) return false;

  const first10Sum = d.slice(0, 10).reduce((a, b) => a + b, 0);
  return first10Sum % 10 === d[10]!;
}

/** Luhn algoritmasi — kart numarasi dogrulamasi. */
export function isValidLuhn(digits: string): boolean {
  if (!/^[0-9]{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Turkiye IBAN'i: TR + 2 kontrol hanesi + 22 hane = 26 karakter. */
export function isValidTrIban(value: string): boolean {
  const clean = value.replace(/\s/g, '').toUpperCase();
  if (!/^TR[0-9]{24}$/.test(clean)) return false;

  // mod-97: ilk 4 karakter sona tasinir, harfler sayiya cevrilir (T=29, R=27).
  const rearranged = clean.slice(4) + clean.slice(0, 4);
  const numeric = [...rearranged]
    .map((ch) => (/[0-9]/.test(ch) ? ch : String(ch.charCodeAt(0) - 55)))
    .join('');

  // Buyuk sayi: parca parca mod al.
  let remainder = 0;
  for (const ch of numeric) {
    remainder = (remainder * 10 + Number(ch)) % 97;
  }
  return remainder === 1;
}

// ---------------------------------------------------------------------------
// Tarama
// ---------------------------------------------------------------------------

interface Matcher {
  kind: PiiKind;
  pattern: RegExp;
  /** Yakalanan degeri dogrular; false donerse bulgu SAYILMAZ. */
  validate?: (raw: string) => boolean;
  /** Dogrulama icin ham degeri normalize eder. */
  normalize?: (raw: string) => string;
}

const digitsOnly = (s: string): string => s.replace(/[^0-9]/g, '');

/**
 * Sayisal desenler icin kenar korumasi.
 *
 * `\b` YETMEZ: tire de kelime siniri sayilir, bu yuzden bir UUID
 * (`11111111-2222-3333-4444-555555555552`) icindeki hane dizisi telefon veya
 * kart gibi eslesiyor. Bu, kendi yanlis-pozitif testimizin yakaladigi gercek
 * bir hataydi. Cozum: eslesmenin ONUNDE ve ARKASINDA ne hane ne tire olmasin.
 *
 *   (?<![0-9-])  ... (?![0-9-])
 *
 * Boylece "daha uzun bir sayinin/UUID'nin parcasi" olan hicbir dizi sayilmaz.
 */
const NO_DIGIT_BEFORE = '(?<![0-9-])';
const NO_DIGIT_AFTER = '(?![0-9-])';

const guarded = (body: string, flags = 'g'): RegExp =>
  new RegExp(`${NO_DIGIT_BEFORE}(?:${body})${NO_DIGIT_AFTER}`, flags);

const MATCHERS: Matcher[] = [
  {
    kind: 'email',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    kind: 'iban',
    // Bosluklu yazim da yakalanir: TR12 3456 ...
    pattern: /\bTR[0-9]{2}(?:[ ]?[0-9]{4}){5}[ ]?[0-9]{2}\b/gi,
    validate: isValidTrIban,
  },
  {
    kind: 'tckn',
    pattern: guarded('[1-9][0-9]{10}'),
    validate: isValidTckn,
  },
  {
    kind: 'creditCard',
    // 13-19 hane, arada bosluk veya tire olabilir.
    pattern: guarded('(?:[0-9][ -]?){12,18}[0-9]'),
    normalize: digitsOnly,
    validate: (raw) => isValidLuhn(digitsOnly(raw)),
  },
  {
    kind: 'phone',
    // TR cep: +90 5xx, 0090 5xx, 05xx, 5xx (10 hane govde)
    pattern: guarded('(?:\\+90|0090|0)?[ -]?5[0-9]{2}[ -]?[0-9]{3}[ -]?[0-9]{2}[ -]?[0-9]{2}'),
    normalize: digitsOnly,
    validate: (raw) => {
      const d = digitsOnly(raw);
      // Ulke kodu soyulduktan sonra 10 hane ve 5 ile baslamali.
      const body = d.startsWith('90') ? d.slice(2) : d.startsWith('0') ? d.slice(1) : d;
      return body.length === 10 && body.startsWith('5');
    },
  },
];

/**
 * Metinde PII arar.
 *
 * Ortusme kurali: daha ONCE eslesen (daha spesifik) bulgu kazanir. Bir IBAN
 * icindeki hane dizisi ayrica "kart" olarak sayilmaz — MATCHERS sirasi bu
 * yuzden onemli (iban, tckn, kart, telefon).
 */
export function scanPii(text: string): PiiFinding[] {
  const findings: PiiFinding[] = [];
  const claimed: Array<[number, number]> = [];

  const overlaps = (start: number, end: number): boolean =>
    claimed.some(([s, e]) => start < e && s < end);

  for (const matcher of MATCHERS) {
    // Her tarama icin lastIndex sifirlanmali (global regex paylasimi).
    matcher.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = matcher.pattern.exec(text)) !== null) {
      const raw = match[0];
      const start = match.index;
      const end = start + raw.length;

      if (overlaps(start, end)) continue;
      if (matcher.validate && !matcher.validate(raw)) continue;

      claimed.push([start, end]);
      findings.push({
        kind: matcher.kind,
        start,
        end,
        masked: mask(matcher.normalize ? matcher.normalize(raw) : raw),
      });
    }
  }

  return findings.sort((a, b) => a.start - b.start);
}

/** Metindeki PII'yi maskeleyerek dondurur — loglama/izleme icin. */
export function redactPii(text: string): string {
  const findings = scanPii(text);
  if (findings.length === 0) return text;

  let result = '';
  let cursor = 0;
  for (const finding of findings) {
    result += text.slice(cursor, finding.start);
    result += `[${finding.kind.toUpperCase()}:${finding.masked}]`;
    cursor = finding.end;
  }
  return result + text.slice(cursor);
}

export interface PiiScanSummary {
  found: boolean;
  countByKind: Partial<Record<PiiKind, number>>;
  findings: PiiFinding[];
}

export function summarizePii(text: string): PiiScanSummary {
  const findings = scanPii(text);
  const countByKind: Partial<Record<PiiKind, number>> = {};
  for (const finding of findings) {
    countByKind[finding.kind] = (countByKind[finding.kind] ?? 0) + 1;
  }
  return { found: findings.length > 0, countByKind, findings };
}
