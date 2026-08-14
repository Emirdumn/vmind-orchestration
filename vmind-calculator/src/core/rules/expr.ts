/**
 * FAZ 4.A — Kural ifadesi degerlendiricisi
 *
 * `rules/*.yaml` icindeki `when:` ifadelerini calistirir.
 *
 * NEDEN `eval` / `new Function` DEGIL:
 * Kurallari satis ekibi yazacak. `eval` orada sonsuz dongu, exception veya
 * yanlislikla state mutasyonu anlamina gelir; bir kural hatasi tum teklif akisini
 * cokertir. Bu degerlendirici yalnizca IFADE calistirir: atama yok, dongu yok,
 * fonksiyon tanimi yok, global erisim yok. Bilinmeyen bir yol `undefined` doner,
 * patlamaz.
 *
 * Desteklenen dilbilgisi:
 *   deger      : sayi | 'metin' | "metin" | true | false | null
 *   yol        : a.b.c            (ara deger yoksa undefined - opsiyonel zincir gibi)
 *   cagri      : fn(arg, ...)     (yalnizca context'te TANIMLI yardimcilar)
 *   operatorler: ! - * / % + - < <= > >= == != === !== && || ??
 *   gruplama   : ( ... )
 */

export class ExpressionError extends Error {
  constructor(
    message: string,
    readonly expression: string,
    readonly position?: number,
  ) {
    super(`${message} — ifade: \`${expression}\``);
    this.name = 'ExpressionError';
  }
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenType = 'number' | 'string' | 'name' | 'punct' | 'eof';

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

const PUNCT = [
  '===',
  '!==',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '??',
  '(',
  ')',
  ',',
  '.',
  '!',
  '<',
  '>',
  '+',
  '-',
  '*',
  '/',
  '%',
];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i]!;

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      const start = i;
      i++;
      let value = '';
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i++;
        value += source[i];
        i++;
      }
      if (i >= source.length) throw new ExpressionError('Kapanmamis tirnak', source, start);
      i++; // kapanis tirnagi
      tokens.push({ type: 'string', value, pos: start });
      continue;
    }

    if (/[0-9]/.test(ch)) {
      const start = i;
      while (i < source.length && /[0-9.]/.test(source[i]!)) i++;
      tokens.push({ type: 'number', value: source.slice(start, i), pos: start });
      continue;
    }

    if (/[A-Za-z_$]/.test(ch)) {
      const start = i;
      while (i < source.length && /[A-Za-z0-9_$]/.test(source[i]!)) i++;
      tokens.push({ type: 'name', value: source.slice(start, i), pos: start });
      continue;
    }

    const punct = PUNCT.find((p) => source.startsWith(p, i));
    if (!punct) throw new ExpressionError(`Taninmayan karakter "${ch}"`, source, i);
    tokens.push({ type: 'punct', value: punct, pos: i });
    i += punct.length;
  }

  tokens.push({ type: 'eof', value: '', pos: source.length });
  return tokens;
}

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

type Node =
  | { kind: 'literal'; value: unknown }
  | { kind: 'name'; name: string }
  | { kind: 'member'; object: Node; property: string }
  | { kind: 'call'; callee: Node; args: Node[] }
  | { kind: 'unary'; op: string; operand: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node };

/** Dusuk sayi = dusuk oncelik. */
const BINARY_PRECEDENCE: Record<string, number> = {
  '??': 1,
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '===': 3,
  '!==': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly source: string,
  ) {}

  private peek(): Token {
    return this.tokens[this.index]!;
  }

  private next(): Token {
    return this.tokens[this.index++]!;
  }

  private expect(value: string): void {
    const token = this.next();
    if (token.value !== value) {
      throw new ExpressionError(`"${value}" bekleniyordu, "${token.value || 'son'}" bulundu`, this.source, token.pos);
    }
  }

  parse(): Node {
    const node = this.parseBinary(0);
    const token = this.peek();
    if (token.type !== 'eof') {
      throw new ExpressionError(`Beklenmeyen "${token.value}"`, this.source, token.pos);
    }
    return node;
  }

  private parseBinary(minPrecedence: number): Node {
    let left = this.parseUnary();

    for (;;) {
      const token = this.peek();
      if (token.type !== 'punct') break;
      const precedence = BINARY_PRECEDENCE[token.value];
      if (precedence === undefined || precedence < minPrecedence) break;
      this.next();
      const right = this.parseBinary(precedence + 1);
      left = { kind: 'binary', op: token.value, left, right };
    }

    return left;
  }

  private parseUnary(): Node {
    const token = this.peek();
    if (token.type === 'punct' && (token.value === '!' || token.value === '-')) {
      this.next();
      return { kind: 'unary', op: token.value, operand: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Node {
    let node = this.parsePrimary();

    for (;;) {
      const token = this.peek();
      if (token.type === 'punct' && token.value === '.') {
        this.next();
        const property = this.next();
        if (property.type !== 'name') {
          throw new ExpressionError('Nokta sonrasi alan adi bekleniyor', this.source, property.pos);
        }
        node = { kind: 'member', object: node, property: property.value };
      } else if (token.type === 'punct' && token.value === '(') {
        this.next();
        const args: Node[] = [];
        if (this.peek().value !== ')') {
          for (;;) {
            args.push(this.parseBinary(0));
            if (this.peek().value === ',') {
              this.next();
              continue;
            }
            break;
          }
        }
        this.expect(')');
        node = { kind: 'call', callee: node, args };
      } else {
        break;
      }
    }

    return node;
  }

  private parsePrimary(): Node {
    const token = this.next();

    if (token.type === 'number') return { kind: 'literal', value: Number(token.value) };
    if (token.type === 'string') return { kind: 'literal', value: token.value };

    if (token.type === 'name') {
      if (token.value === 'true') return { kind: 'literal', value: true };
      if (token.value === 'false') return { kind: 'literal', value: false };
      if (token.value === 'null') return { kind: 'literal', value: null };
      if (token.value === 'undefined') return { kind: 'literal', value: undefined };
      return { kind: 'name', name: token.value };
    }

    if (token.value === '(') {
      const node = this.parseBinary(0);
      this.expect(')');
      return node;
    }

    throw new ExpressionError(`Beklenmeyen "${token.value || 'ifade sonu'}"`, this.source, token.pos);
  }
}

// ---------------------------------------------------------------------------
// Degerlendirme
// ---------------------------------------------------------------------------

export type Scope = Record<string, unknown>;

/** Prototip zincirinden asla okunmayan, kum havuzunu delebilecek alan adlari. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Yalnizca nesnenin KENDI ozelligini okur.
 *
 * Prototip zinciri kapali olmasaydi `constructor.constructor` uzerinden `Function`
 * elde edilip ifade dilinden rastgele kod calistirilabilirdi. Kural dosyalarini
 * satis ekibi duzenleyecegi icin bu sinir gercek.
 */
function own(object: Record<string, unknown>, key: string): unknown {
  if (FORBIDDEN_KEYS.has(key)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(object, key)) return undefined;
  return object[key];
}

function evaluateNode(node: Node, scope: Scope, source: string): unknown {
  switch (node.kind) {
    case 'literal':
      return node.value;

    case 'name': {
      // Tanimsiz ad HATA degil undefined doner: kural yazari `item.data.network`
      // gibi var olmayabilecek yollari serbestce yazabilsin diye.
      //
      // GUVENLIK: yalnizca KENDI ozelligi okunur. Duz `scope[name]` yazilsaydi
      // `constructor` prototip zincirinden Object'e cozulur, `constructor.constructor`
      // ise Function'a ulasir ve `Function('return process')()` ile kum havuzu delinirdi.
      return own(scope, node.name);
    }

    case 'member': {
      const object = evaluateNode(node.object, scope, source);
      if (object === null || object === undefined) return undefined;
      return own(object as Record<string, unknown>, node.property);
    }

    case 'call': {
      const callee = evaluateNode(node.callee, scope, source);
      if (typeof callee !== 'function') {
        const name = node.callee.kind === 'name' ? node.callee.name : 'ifade';
        throw new ExpressionError(`"${name}" bir yardimci fonksiyon degil`, source);
      }
      const args = node.args.map((arg) => evaluateNode(arg, scope, source));
      return (callee as (...a: unknown[]) => unknown)(...args);
    }

    case 'unary': {
      const value = evaluateNode(node.operand, scope, source);
      if (node.op === '!') return !value;
      return -(value as number);
    }

    case 'binary': {
      // Kisa devre operatorleri sagi degerlendirmeden once karar verir.
      if (node.op === '&&') {
        const left = evaluateNode(node.left, scope, source);
        return left ? evaluateNode(node.right, scope, source) : left;
      }
      if (node.op === '||') {
        const left = evaluateNode(node.left, scope, source);
        return left ? left : evaluateNode(node.right, scope, source);
      }
      if (node.op === '??') {
        const left = evaluateNode(node.left, scope, source);
        return left ?? evaluateNode(node.right, scope, source);
      }

      const left = evaluateNode(node.left, scope, source) as never;
      const right = evaluateNode(node.right, scope, source) as never;

      switch (node.op) {
        case '==':
        case '===':
          return left === right;
        case '!=':
        case '!==':
          return left !== right;
        case '<':
          return left < right;
        case '<=':
          return left <= right;
        case '>':
          return left > right;
        case '>=':
          return left >= right;
        case '+':
          return (left as number) + (right as number);
        case '-':
          return (left as number) - (right as number);
        case '*':
          return (left as number) * (right as number);
        case '/':
          return (left as number) / (right as number);
        case '%':
          return (left as number) % (right as number);
        default:
          throw new ExpressionError(`Bilinmeyen operator "${node.op}"`, source);
      }
    }
  }
}

const cache = new Map<string, Node>();

/** Ifadeyi ayristirir (sonuc onbellege alinir) ve verilen kapsamda calistirir. */
export function evaluateExpression(source: string, scope: Scope): unknown {
  let ast = cache.get(source);
  if (!ast) {
    ast = new Parser(tokenize(source), source).parse();
    cache.set(source, ast);
  }
  return evaluateNode(ast, scope, source);
}

/** Ifadeyi yalnizca ayristirir — kural dosyasini yuklerken sozdizimi dogrulamak icin. */
export function parseExpression(source: string): void {
  if (cache.has(source)) return;
  cache.set(source, new Parser(tokenize(source), source).parse());
}
