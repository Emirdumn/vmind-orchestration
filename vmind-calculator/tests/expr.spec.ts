/**
 * FAZ 4.A — Kural ifadesi degerlendiricisi
 *
 * Kurallari satis ekibi yazacak; degerlendirici hem dogru hem GUVENLI olmali:
 * bir kural ifadesi state degistirememeli, sonsuz donguye girememeli.
 */
import { describe, expect, it } from 'vitest';
import { ExpressionError, evaluateExpression, parseExpression } from '../src/core/rules/expr.js';

const evaluate = (source: string, scope: Record<string, unknown> = {}): unknown =>
  evaluateExpression(source, scope);

describe('degerler ve operatorler', () => {
  it('sayi, metin, boolean, null', () => {
    expect(evaluate('42')).toBe(42);
    expect(evaluate('3.5')).toBe(3.5);
    expect(evaluate("'metin'")).toBe('metin');
    expect(evaluate('"metin"')).toBe('metin');
    expect(evaluate('true')).toBe(true);
    expect(evaluate('null')).toBe(null);
  });

  it('karsilastirma', () => {
    expect(evaluate('2 < 3')).toBe(true);
    expect(evaluate('3 <= 3')).toBe(true);
    expect(evaluate("'a' == 'a'")).toBe(true);
    expect(evaluate("'a' != 'b'")).toBe(true);
    expect(evaluate('1 === 1')).toBe(true);
  });

  it('aritmetik ve oncelik', () => {
    expect(evaluate('2 + 3 * 4')).toBe(14);
    expect(evaluate('(2 + 3) * 4')).toBe(20);
    expect(evaluate('10 % 3')).toBe(1);
    expect(evaluate('-5 + 2')).toBe(-3);
  });

  it('mantiksal operatorler ve oncelik', () => {
    expect(evaluate('true && false')).toBe(false);
    expect(evaluate('true || false')).toBe(true);
    expect(evaluate('!true')).toBe(false);
    // && , || dan once baglanmali
    expect(evaluate('false && false || true')).toBe(true);
  });

  it('?? yalnizca null/undefined icin devreye giriyor', () => {
    expect(evaluate('null ?? 5')).toBe(5);
    expect(evaluate('0 ?? 5')).toBe(0);
    expect(evaluate('yok ?? 7')).toBe(7);
  });

  it('&& kisa devre yapiyor — sag taraf degerlendirilmiyor', () => {
    let called = false;
    evaluate('false && patla()', {
      patla: () => {
        called = true;
        return true;
      },
    });
    expect(called).toBe(false);
  });
});

describe('yol erisimi', () => {
  const scope = { item: { data: { backup: { estimatedCount: 0 }, storage: null } } };

  it('ic ice alan okuyor', () => {
    expect(evaluate('item.data.backup.estimatedCount', scope)).toBe(0);
  });

  it('var olmayan yol PATLAMIYOR, undefined donuyor', () => {
    // Kural yazarinin her yolu once kontrol etmesi gerekmemeli.
    expect(evaluate('item.data.network.traffic', scope)).toBeUndefined();
    expect(evaluate('bilinmeyen.a.b.c', scope)).toBeUndefined();
  });

  it('null uzerinden erisim de guvenli', () => {
    expect(evaluate('item.data.storage.size', scope)).toBeUndefined();
  });

  it('gercek kural kaliplari', () => {
    expect(evaluate('!item.data.network', scope)).toBe(true);
    expect(evaluate('(item.data.backup.estimatedCount ?? 0) == 0', scope)).toBe(true);
  });
});

describe('yardimci fonksiyon cagrilari', () => {
  const scope = {
    has: (service: unknown) => service === 'compute',
    count: () => 3,
    anyItemHas: (service: unknown, field: unknown) => service === 'compute' && field === 'floatingIp',
  };

  it('argumansiz ve argumanli cagri', () => {
    expect(evaluate("has('compute')", scope)).toBe(true);
    expect(evaluate("has('kubernetes')", scope)).toBe(false);
    expect(evaluate('count()', scope)).toBe(3);
  });

  it('cok argumanli cagri', () => {
    expect(evaluate("anyItemHas('compute', 'floatingIp')", scope)).toBe(true);
    expect(evaluate("anyItemHas('compute', 'network')", scope)).toBe(false);
  });

  it('cagri sonucu karsilastirmada kullanilabiliyor', () => {
    expect(evaluate('count() < 2', scope)).toBe(false);
    expect(evaluate("has('compute') && count() >= 3", scope)).toBe(true);
  });

  it('tanimsiz fonksiyon cagrisi anlamli hata veriyor', () => {
    expect(() => evaluate('olmayanFonksiyon()', scope)).toThrow(ExpressionError);
    expect(() => evaluate('olmayanFonksiyon()', scope)).toThrow(/yardimci fonksiyon degil/);
  });
});

describe('guvenlik — ifade dili kasitli olarak dar', () => {
  it('atama yok', () => {
    expect(() => parseExpression('a = 5')).toThrow(ExpressionError);
  });

  it('fonksiyon tanimi / arrow yok', () => {
    expect(() => parseExpression('i => i.data')).toThrow(ExpressionError);
  });

  it('noktali virgulle ifade zincirleme yok', () => {
    expect(() => parseExpression('1; 2')).toThrow(ExpressionError);
  });

  it('global erisim yok — window/process/globalThis sadece tanimsiz ad', () => {
    expect(evaluate('process.env.SECRET')).toBeUndefined();
    expect(evaluate('globalThis.process')).toBeUndefined();
  });

  it('prototip zinciri KAPALI — constructor uzerinden Function\'a ulasilamiyor', () => {
    // Duz `scope[name]` kullanilsaydi `constructor` -> Object, `.constructor` -> Function
    // olur ve Function('return process')() ile kum havuzu delinirdi.
    expect(evaluate('constructor')).toBeUndefined();
    expect(evaluate('constructor.constructor')).toBeUndefined();
    expect(() => evaluate('constructor()')).toThrow(ExpressionError);
    expect(() => evaluate("constructor.constructor('return process')()")).toThrow(ExpressionError);
  });

  it('__proto__ ve prototype okunamiyor', () => {
    expect(evaluate('item.__proto__', { item: {} })).toBeUndefined();
    expect(evaluate('item.constructor.prototype', { item: {} })).toBeUndefined();
  });

  it('miras alinan metotlar cagrilmiyor, yalnizca kendi alanlari okunuyor', () => {
    expect(evaluate('item.toString', { item: { a: 1 } })).toBeUndefined();
    expect(evaluate('item.a', { item: { a: 1 } })).toBe(1);
  });
});

describe('sozdizimi hatalari yukleme aninda yakalaniyor', () => {
  it('kapanmamis parantez', () => {
    expect(() => parseExpression("has('compute'")).toThrow(ExpressionError);
  });

  it('kapanmamis tirnak', () => {
    expect(() => parseExpression("has('compute)")).toThrow(/Kapanmamis tirnak/);
  });

  it('eksik operand', () => {
    expect(() => parseExpression('1 +')).toThrow(ExpressionError);
  });

  it('hata mesaji ifadeyi iceriyor', () => {
    expect(() => parseExpression('1 +')).toThrow(/ifade: `1 \+`/);
  });
});
