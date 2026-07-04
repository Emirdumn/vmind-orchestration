import catalogJson from "./cars_catalog.json";
import { CAR_DATABASE, CarModel, CommonProblem, OwnerReview, Alternative } from "./cars";

// ============================================================================
// Raw catalog types (from cars_catalog.json — gerçek pazar verisi)
// ============================================================================
export interface CatalogVariant {
  trim: string;
  year: number;
  fuel: string;
  transmission: string;
  hp: number;
  cc: number;
  consumption_l100: number;
  luggage_l: number;
}

export interface CatalogModel {
  model: string;
  segment: string;
  body_type: string;
  variants: CatalogVariant[];
}

export interface CatalogBrand {
  brand: string;
  models: CatalogModel[];
}

export const CATALOG: CatalogBrand[] = catalogJson as CatalogBrand[];

// ============================================================================
// Lookup helpers
// ============================================================================
export const slug = (s: string) =>
  s
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

export const carIdFor = (brand: string, model: string) => `${slug(brand)}-${slug(model)}`;

export interface CatalogIndexEntry {
  id: string;
  brand: string;
  model: string;
  segment: string;
  bodyType: string;
  variants: CatalogVariant[];
  years: number[];
}

export const CATALOG_INDEX: CatalogIndexEntry[] = CATALOG.flatMap((b) =>
  b.models.map((m) => ({
    id: carIdFor(b.brand, m.model),
    brand: b.brand,
    model: m.model,
    segment: m.segment,
    bodyType: m.body_type,
    variants: m.variants,
    years: Array.from(new Set(m.variants.map((v) => v.year))).sort((a, b) => a - b),
  }))
);

export const BRAND_LIST: string[] = Array.from(new Set(CATALOG.map((b) => b.brand))).sort();

export const modelsForBrand = (brand: string): CatalogIndexEntry[] =>
  CATALOG_INDEX.filter((e) => e.brand === brand);

export const findEntry = (id: string): CatalogIndexEntry | undefined =>
  CATALOG_INDEX.find((e) => e.id === id);

// ============================================================================
// Synthetic CarModel generator (zenginleştirilmiş analitik veri)
// ----------------------------------------------------------------------------
// Mevcut cars.ts içindeki 5 model gerçek araştırma verisi içeriyor (kronik
// sorunlar, sahip yorumları). Diğer modeller için segment + yakıt + HP +
// şanzıman özelliklerine göre mantıklı tahminler üretiyoruz.
// ============================================================================

// Segment → 2024 baz fiyat haritası (TL, en yeni yıl, baz HP'de)
const SEGMENT_BASE_PRICE: Record<string, number> = {
  "A-Hatchback": 700_000,
  "B-Hatchback": 900_000,
  "B-Sedan": 950_000,
  "B-SUV": 1_350_000,
  "C-Hatchback": 1_250_000,
  "C-Sedan": 1_500_000,
  "C-SUV": 1_950_000,
  "D-Sedan": 2_400_000,
  "D-SUV": 2_900_000,
  "E-Sedan": 3_800_000,
  "E-SUV": 4_500_000,
  "F-Sedan": 6_500_000,
  "Pickup": 1_900_000,
  "MPV": 1_600_000,
  "Coupe": 3_200_000,
  "Cabrio": 3_800_000,
  "Sport": 5_500_000,
};

const PREMIUM_BRANDS = new Set([
  "Audi", "BMW", "Mercedes-Benz", "Mercedes", "Porsche", "Volvo",
  "Lexus", "Jaguar", "Land Rover", "Mini", "Tesla",
]);

const RELIABLE_BRANDS = new Set(["Toyota", "Honda", "Lexus", "Mazda", "Suzuki"]);
const RISKY_BRANDS = new Set(["Land Rover", "Jaguar", "Alfa Romeo", "Fiat"]);

const FAST_DEMAND = new Set(["Toyota", "Honda", "Dacia", "Renault", "Fiat", "Hyundai"]);

function pickBaselineVariant(entry: CatalogIndexEntry): CatalogVariant {
  // Newest year, lowest HP (entry trim)
  const newest = Math.max(...entry.years);
  const candidates = entry.variants.filter((v) => v.year === newest);
  return candidates.sort((a, b) => a.hp - b.hp)[0] ?? entry.variants[0];
}

function reliabilityFor(entry: CatalogIndexEntry, baseline: CatalogVariant) {
  let score = 76;
  if (RELIABLE_BRANDS.has(entry.brand)) score += 12;
  if (RISKY_BRANDS.has(entry.brand)) score -= 10;
  if (PREMIUM_BRANDS.has(entry.brand)) score -= 2; // elektronik karmaşıklığı
  if (baseline.fuel === "Hibrit" || baseline.fuel === "Elektrik") score += 3;
  if (baseline.transmission === "Manuel") score += 2;

  // Add per-category breakdown around the base score
  const clamp = (v: number) => Math.max(40, Math.min(98, v));
  const engine = clamp(score + (baseline.fuel === "Dizel" ? -3 : 2));
  const electronics = clamp(score - (PREMIUM_BRANDS.has(entry.brand) ? 6 : 2));
  const transmission = clamp(score + (baseline.transmission === "Manuel" ? 4 : -2));
  const interior = clamp(score + (PREMIUM_BRANDS.has(entry.brand) ? 8 : 0));

  return {
    score: clamp(score),
    breakdown: { engine, electronics, transmission, interior },
  };
}

function genericProblems(entry: CatalogIndexEntry, baseline: CatalogVariant): CommonProblem[] {
  const problems: CommonProblem[] = [];
  const isPremium = PREMIUM_BRANDS.has(entry.brand);
  const costMul = isPremium ? 2.2 : 1;

  if (baseline.fuel === "Dizel") {
    problems.push({
      title: "DPF / EGR Tıkanması",
      description: "Şehir içi yoğun kullanımda DPF filtresi ve EGR valfi 80.000 km sonrası tıkanma riski taşıyor. Düzenli uzun yol önerilir.",
      severity: "high",
      category: "engine",
      repairCostMin: Math.round(15_000 * costMul),
      repairCostMax: Math.round(32_000 * costMul),
      reportedFrequency: 55,
      triggerKm: 80_000,
    });
  }
  if (baseline.fuel === "Benzin" && baseline.cc <= 1600 && baseline.hp >= 130) {
    problems.push({
      title: "Turbo Yağ Kaçağı",
      description: "Küçük hacimli turbo motorlarda 90.000 km civarı turbo besleme hattında yağ sızıntısı görülebilir.",
      severity: "medium",
      category: "engine",
      repairCostMin: Math.round(7_500 * costMul),
      repairCostMax: Math.round(14_000 * costMul),
      reportedFrequency: 40,
      triggerKm: 90_000,
    });
  }
  if (baseline.transmission === "Otomatik" && !["Toyota", "Lexus"].includes(entry.brand)) {
    problems.push({
      title: "Otomatik Şanzıman Yağ Bakımı İhmali",
      description: "Üretici 'ömürlük' dese de 60-80.000 km'de yağ değişimi yapılmazsa mekatronik hasarı riski artar.",
      severity: "medium",
      category: "transmission",
      repairCostMin: Math.round(20_000 * costMul),
      repairCostMax: Math.round(55_000 * costMul),
      reportedFrequency: 35,
      triggerKm: 80_000,
    });
  }
  if (entry.bodyType === "SUV") {
    problems.push({
      title: "Ön Salıncak ve Rotil Yıpranması",
      description: "Ağır gövde nedeniyle 70.000 km civarı ön süspansiyon parçalarında yıpranma raporlanmıştır.",
      severity: "medium",
      category: "suspension",
      repairCostMin: Math.round(5_500 * costMul),
      repairCostMax: Math.round(11_000 * costMul),
      reportedFrequency: 48,
      triggerKm: 70_000,
    });
  }
  if (isPremium) {
    problems.push({
      title: "Elektronik Modül Arızaları",
      description: "Konfor donanımı (jest kontrolü, panoramik tavan, elektrikli koltuk) yaşlandıkça ara sıra hata verebiliyor.",
      severity: "medium",
      category: "electrical",
      repairCostMin: Math.round(6_000 * costMul),
      repairCostMax: Math.round(18_000 * costMul),
      reportedFrequency: 38,
      triggerKm: 100_000,
    });
  }
  problems.push({
    title: "Multimedya / Yazılım Donmaları",
    description: "Stok multimedya sisteminde nadiren donma; yazılım güncellemesi ile çözülür.",
    severity: "low",
    category: "electrical",
    repairCostMin: 0,
    repairCostMax: 2_500,
    reportedFrequency: 32,
    triggerKm: 30_000,
  });

  return problems;
}

function genericReviews(entry: CatalogIndexEntry, baseline: CatalogVariant): OwnerReview[] {
  return [
    {
      name: "Topluluk Ortalaması",
      yearsOwned: 3,
      source: `${entry.brand} Sahipleri TR`,
      text: `${baseline.consumption_l100}L/100km tüketim ortalaması. ${baseline.transmission} şanzıman ile günlük kullanımda konforlu. Yedek parça temininde belirgin sorun raporlanmamıştır.`,
    },
    {
      name: "Forum Özeti",
      yearsOwned: 2,
      source: "Telegram Grupları",
      text: `${entry.segment} segmentinde rakiplerine göre ${PREMIUM_BRANDS.has(entry.brand) ? "premium iç mekan ve sürüş hissi" : "ekonomik işletme maliyeti"} öne çıkıyor. Bagaj ${baseline.luggage_l}L.`,
    },
  ];
}

function pickAlternatives(entry: CatalogIndexEntry, baseline: CatalogVariant): Alternative[] {
  const sameSegment = CATALOG_INDEX.filter(
    (e) => e.segment === entry.segment && e.id !== entry.id
  );
  const picks = sameSegment.slice(0, 3);
  if (picks.length === 0) return [];
  return picks.map((p, i) => {
    const v = pickBaselineVariant(p);
    const tag: Alternative["tag"] = i === 0 ? "similar" : i === 1 ? "economy" : "performance";
    return {
      name: `${p.brand} ${p.model}`,
      trim: v.trim,
      year: v.year,
      marketPrice: estimateBasePrice(p, v),
      reliabilityScore: reliabilityFor(p, v).score,
      tag,
    };
  });
}

function estimateBasePrice(entry: CatalogIndexEntry, baseline: CatalogVariant): number {
  const seg = SEGMENT_BASE_PRICE[entry.segment] ?? 1_400_000;
  const premiumMul = PREMIUM_BRANDS.has(entry.brand) ? 1.35 : 1;
  // HP scaling: each 50hp over 120 adds ~7%
  const hpFactor = 1 + Math.max(0, baseline.hp - 120) / 50 * 0.07;
  // Fuel adjustment
  const fuelMul =
    baseline.fuel === "Hibrit" ? 1.1 :
    baseline.fuel === "Elektrik" ? 1.25 :
    baseline.fuel === "Dizel" ? 1.05 : 1;
  return Math.round((seg * premiumMul * hpFactor * fuelMul) / 1000) * 1000;
}

function buildSyntheticCar(entry: CatalogIndexEntry): CarModel {
  const baseline = pickBaselineVariant(entry);
  const reliability = reliabilityFor(entry, baseline);
  const isPremium = PREMIUM_BRANDS.has(entry.brand);
  const demand: CarModel["demand"] = FAST_DEMAND.has(entry.brand)
    ? "fast"
    : isPremium
    ? "slow"
    : "moderate";

  return {
    id: entry.id,
    brand: entry.brand,
    model: entry.model,
    years: entry.years.length > 1 ? entry.years : [entry.years[0] - 4, entry.years[0] - 3, entry.years[0] - 2, entry.years[0] - 1, entry.years[0]],
    basePrice: estimateBasePrice(entry, baseline),
    depreciationPerYear: isPremium ? 12 : RELIABLE_BRANDS.has(entry.brand) ? 7 : 9,
    pricePerKm: isPremium ? 3.5 : 1.8,
    baselineKm: 30_000,
    reliabilityScore: reliability.score,
    reliabilityBreakdown: reliability.breakdown,
    demand,
    averageDaysOnMarket: demand === "fast" ? 9 : demand === "moderate" ? 18 : 32,
    commonProblems: genericProblems(entry, baseline),
    ownerReviews: genericReviews(entry, baseline),
    alternatives: pickAlternatives(entry, baseline),
  };
}

// ============================================================================
// Public resolver: id → CarModel (gerçek veri varsa onu, yoksa sentetik)
// ============================================================================

const REAL_BY_ID = new Map<string, CarModel>();
for (const c of CAR_DATABASE) {
  REAL_BY_ID.set(c.id, c);
  // Also map by catalog-style id (slug brand+model) for cross-reference
  REAL_BY_ID.set(carIdFor(c.brand, c.model), c);
}

const SYNTHETIC_CACHE = new Map<string, CarModel>();

export function resolveCar(id: string): CarModel | undefined {
  if (REAL_BY_ID.has(id)) return REAL_BY_ID.get(id);
  if (SYNTHETIC_CACHE.has(id)) return SYNTHETIC_CACHE.get(id);
  const entry = findEntry(id);
  if (!entry) return undefined;
  const built = buildSyntheticCar(entry);
  SYNTHETIC_CACHE.set(id, built);
  return built;
}

export function hasRealResearchData(id: string): boolean {
  return REAL_BY_ID.has(id);
}
