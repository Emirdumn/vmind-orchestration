import listingsJson from "./listings.json";

export interface Listing {
  id: string;
  title: string;
  price: number;
  year: number | null;
  km: number | null;
  color?: string | null;
  city?: string | null;
  date?: string | null;
  url: string;
  image?: string | null;
  /** Origin marketplace, e.g. "otoplus.com" or "carvak.com" */
  source?: string | null;
}

const RAW = listingsJson as Record<string, Listing[]>;

export function listingsForCar(carId: string): Listing[] {
  return RAW[carId] ?? [];
}

/**
 * Filter listings within ±yearWindow years of target year and remove obvious outliers.
 * Returns at most `limit` items, sorted by relevance (closest year & km).
 */
export function similarListings(
  carId: string,
  year: number,
  km: number,
  opts: { yearWindow?: number; limit?: number } = {}
): Listing[] {
  const yw = opts.yearWindow ?? 2;
  const limit = opts.limit ?? 9;
  const all = listingsForCar(carId);
  const filtered = all.filter(
    (l) => l.year != null && Math.abs((l.year as number) - year) <= yw
  );
  // Sort by combined score: year delta + km delta scaled
  const scored = filtered
    .map((l) => {
      const yearDelta = Math.abs((l.year as number) - year);
      const kmDelta = l.km != null ? Math.abs(l.km - km) / 20000 : 5;
      return { l, score: yearDelta * 2 + kmDelta };
    })
    .sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((s) => s.l);
}

/**
 * Compute the trimmed-median market price (TL) from real listings filtered by year ±window.
 * Returns null if not enough samples (<4) — caller should fall back to synthetic estimate.
 */
export function medianMarketPrice(
  carId: string,
  year: number,
  opts: { yearWindow?: number; minSamples?: number } = {}
): { median: number; sampleSize: number; low: number; high: number } | null {
  const yw = opts.yearWindow ?? 1;
  const minSamples = opts.minSamples ?? 4;
  const all = listingsForCar(carId);
  const pool = all.filter(
    (l) => l.year != null && Math.abs((l.year as number) - year) <= yw && l.price > 0
  );
  if (pool.length < minSamples) return null;
  const prices = pool.map((l) => l.price).sort((a, b) => a - b);
  // Trim outliers: drop bottom & top 10%
  const trimCount = Math.floor(prices.length * 0.1);
  const trimmed = prices.slice(trimCount, prices.length - trimCount);
  const median = trimmed[Math.floor(trimmed.length / 2)];
  const low = trimmed[Math.floor(trimmed.length * 0.25)];
  const high = trimmed[Math.floor(trimmed.length * 0.75)];
  return { median, sampleSize: prices.length, low, high };
}

export function hasListings(carId: string): boolean {
  return (RAW[carId]?.length ?? 0) > 0;
}

export function totalListings(): number {
  return Object.values(RAW).reduce((s, a) => s + a.length, 0);
}

/**
 * Average km of listings within ±yearWindow (used to anchor km-adjustment).
 */
export function averageKm(carId: string, year: number, yearWindow = 1): number | null {
  const pool = listingsForCar(carId).filter(
    (l) => l.year != null && Math.abs((l.year as number) - year) <= yearWindow && l.km != null
  );
  if (pool.length === 0) return null;
  return Math.round(pool.reduce((s, l) => s + (l.km as number), 0) / pool.length);
}

