/**
 * FAZ 7.B — PII taramasi testleri
 *
 * En onemli test grubu YANLIS POZITIF testleri: bu projede UUID'ler,
 * ondalikli fiyatlar ve sayisal boyutlar her yerde. Tarayici bunlara
 * "PII" derse satisci uyarilari kapatir ve tarama degersizlesir.
 */
import { describe, expect, it } from 'vitest';

import {
  isValidLuhn,
  isValidTckn,
  isValidTrIban,
  mask,
  redactPii,
  scanPii,
  summarizePii,
} from '../src/core/telemetry/pii.js';
import { CODE } from './helpers.js';

const kinds = (text: string): string[] => scanPii(text).map((f) => f.kind);

describe('Faz 7.B — dogrulayicilar', () => {
  it('TCKN checksum: gecerli numara kabul, bozulmus reddediliyor', () => {
    // Checksum kurallarina uyacak sekilde uretilmis sentetik numara.
    const valid = '10000000146';
    expect(isValidTckn(valid)).toBe(true);
    // Son hane bozulunca reddedilmeli.
    expect(isValidTckn('10000000147')).toBe(false);
    // 10. hane bozulunca reddedilmeli.
    expect(isValidTckn('10000000246')).toBe(false);
  });

  it('TCKN: 0 ile baslayamaz, 11 hane olmali', () => {
    expect(isValidTckn('01234567890')).toBe(false);
    expect(isValidTckn('1234567890')).toBe(false);
    expect(isValidTckn('123456789012')).toBe(false);
  });

  it('Luhn: gecerli test karti kabul, bir hane bozulunca red', () => {
    expect(isValidLuhn('4111111111111111')).toBe(true);
    expect(isValidLuhn('4111111111111112')).toBe(false);
  });

  it('TR IBAN mod-97 dogrulamasi', () => {
    // TR330006100519786457841326 — yaygin kullanilan gecerli ornek.
    expect(isValidTrIban('TR330006100519786457841326')).toBe(true);
    expect(isValidTrIban('TR33 0006 1005 1978 6457 8413 26')).toBe(true);
    // Kontrol hanesi bozulunca red.
    expect(isValidTrIban('TR340006100519786457841326')).toBe(false);
  });

  it('mask ham degeri sizdirmiyor', () => {
    const masked = mask('4111111111111111');
    expect(masked).not.toContain('1111111111');
    expect(masked.startsWith('41')).toBe(true);
    expect(masked.endsWith('11')).toBe(true);
  });
});

describe('Faz 7.B — tespit', () => {
  it('e-posta', () => {
    expect(kinds('musteri: ahmet.yilmaz@firma.com.tr')).toEqual(['email']);
  });

  it('TR cep telefonu, farkli yazimlarda', () => {
    expect(kinds('+90 532 123 45 67')).toEqual(['phone']);
    expect(kinds('0532 123 45 67')).toEqual(['phone']);
    expect(kinds('05321234567')).toEqual(['phone']);
  });

  it('gecerli TCKN', () => {
    expect(kinds('TCKN 10000000146 olarak kayitli')).toEqual(['tckn']);
  });

  it('IBAN', () => {
    expect(kinds('TR330006100519786457841326 hesabina')).toEqual(['iban']);
  });

  it('kredi karti', () => {
    expect(kinds('kart 4111 1111 1111 1111')).toEqual(['creditCard']);
  });

  it('birden fazla tur ayni metinde', () => {
    const summary = summarizePii(
      'Ahmet Yilmaz, ahmet@firma.com, 0532 123 45 67, TCKN 10000000146',
    );
    expect(summary.found).toBe(true);
    expect(summary.countByKind.email).toBe(1);
    expect(summary.countByKind.phone).toBe(1);
    expect(summary.countByKind.tckn).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// YANLIS POZITIF — en kritik grup
// ---------------------------------------------------------------------------

describe('Faz 7.B — YANLIS POZITIF uretmiyor', () => {
  it('productCode UUID\'leri PII sayilmiyor', () => {
    for (const code of Object.values(CODE)) {
      expect(scanPii(String(code)), String(code)).toEqual([]);
    }
  });

  it('ondalikli fiyatlar PII sayilmiyor', () => {
    const prices = '0.00015278 1.8954 195.835024 564.4912 28926.79 0.00002778';
    expect(scanPii(prices)).toEqual([]);
  });

  it('gercek bir teklif JSON\'u PII icermiyor', () => {
    const estimate = JSON.stringify({
      id: '11111111-2222-3333-4444-555555555552',
      currency: 'USD',
      list: [
        { service: 'compute', data: { productCode: CODE.flavorMedium, count: 3 } },
        { service: 'backup', data: { productCode: 'BC-001', sourceSize: 2048, estimatedCount: 14 } },
      ],
    });
    expect(scanPii(estimate)).toEqual([]);
  });

  it('gecersiz checksum\'li 11 haneli sayi TCKN sayilmiyor', () => {
    // Rastgele 11 hane — checksum tutmaz.
    expect(kinds('12345678901')).toEqual([]);
  });

  it('Luhn\'dan gecmeyen 16 haneli sayi kart sayilmiyor', () => {
    expect(kinds('1234567812345678')).toEqual([]);
  });

  it('gecersiz IBAN kontrol hanesi yakalanmiyor', () => {
    expect(kinds('TR340006100519786457841326')).toEqual([]);
  });

  it('UUID icindeki hane dizileri yakalanmiyor', () => {
    // Bu, kenar korumasi eklenmeden ONCE telefon olarak eslesiyordu:
    // ...-555555555552 -> "5555555552". Regresyon testi.
    expect(kinds('11111111-2222-3333-4444-555555555552')).toEqual([]);
    expect(kinds('id: 5afc50cd-3f80-47c5-8596-bb303dfa5e17')).toEqual([]);
  });

  it('daha uzun bir sayinin parcasi PII sayilmiyor', () => {
    // Gecerli bir kart numarasi daha uzun bir hane dizisinin icindeyse
    // "kart" degildir — muhtemelen bir kimlik/hash.
    expect(kinds('99411111111111111199')).toEqual([]);
    // Gecerli TCKN daha uzun dizinin parcasiysa sayilmaz.
    expect(kinds('9910000000146')).toEqual([]);
  });

  it('5 ile baslamayan telefon benzeri sayi yakalanmiyor', () => {
    // Sabit hat formatinda; TR cep kurali 5 ile baslar.
    expect(kinds('0312 123 45 67')).toEqual([]);
  });

  it('katalog raporundaki tarih ve boyutlar temiz', () => {
    const text = 'startDate 2023-12-31T21:00:00+00:00, 5120 GB, 262144 MB RAM, 64 vCPU';
    expect(scanPii(text)).toEqual([]);
  });
});

describe('Faz 7.B — maskeleme', () => {
  it('redactPii ham degeri metinden cikariyor', () => {
    const out = redactPii('iletisim: ahmet@firma.com ve 0532 123 45 67');
    expect(out).not.toContain('ahmet@firma.com');
    expect(out).not.toContain('5321234567');
    expect(out).toContain('[EMAIL:');
    expect(out).toContain('[PHONE:');
  });

  it('PII yoksa metin aynen donuyor', () => {
    const text = '3 x g1.medium, 100 GB premium disk';
    expect(redactPii(text)).toBe(text);
  });

  it('maskelenmis cikti orijinal uzunlugu ele vermiyor kadar kisa degil', () => {
    // Uzunluk bilgisi zararsiz; onemli olan degerin okunamamasi.
    const out = redactPii('kart 4111 1111 1111 1111');
    expect(out).not.toMatch(/4111\s?1111\s?1111\s?1111/);
  });
});
