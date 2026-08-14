/**
 * Ayni tool + ayni girdi tekrarini deterministik olarak yakalar.
 * Tur sayisi tek basina dongu kaniti degildir: buyuk teklifler gercekten daha
 * fazla katalog aramasi gerektirir. Tekrar ise olculebilir bir ilerlememe
 * sinyalidir.
 */

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stable(nested)]),
  );
}

export class ToolLoopProgressGuard {
  private readonly seen = new Map<string, number>();

  constructor(private readonly maxRepeatedCalls: number) {}

  record(name: string, input: unknown): void {
    const signature = `${name}:${JSON.stringify(stable(input))}`;
    const count = (this.seen.get(signature) ?? 0) + 1;
    this.seen.set(signature, count);
    if (count > this.maxRepeatedCalls) {
      throw new Error(
        `Tool dongusu ilerlemiyor: "${name}" ayni girdilerle ${count} kez cagrildi.`,
      );
    }
  }
}
