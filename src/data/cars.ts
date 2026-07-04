export type Severity = "low" | "medium" | "high";
export type Category = "engine" | "transmission" | "electrical" | "suspension" | "body" | "interior";

export interface CommonProblem {
  title: string;
  description: string;
  severity: Severity;
  category: Category;
  repairCostMin: number;
  repairCostMax: number;
  reportedFrequency: number; // 0-100
  triggerKm: number;
}

export interface OwnerReview {
  name: string;
  yearsOwned: number;
  source: string;
  text: string;
}

export interface Alternative {
  name: string;
  trim: string;
  year: number;
  marketPrice: number;
  reliabilityScore: number;
  tag: "economy" | "performance" | "similar";
}

export interface CarModel {
  id: string;
  brand: string;
  model: string;
  years: number[];
  basePrice: number; // 2024 base reference price (TL) for newest year, lowest km
  depreciationPerYear: number; // % per year
  pricePerKm: number; // TL deducted per km over baseline
  baselineKm: number;
  reliabilityScore: number; // 0-100
  reliabilityBreakdown: {
    engine: number;
    electronics: number;
    transmission: number;
    interior: number;
  };
  demand: "fast" | "moderate" | "slow";
  averageDaysOnMarket: number;
  commonProblems: CommonProblem[];
  ownerReviews: OwnerReview[];
  alternatives: Alternative[];
}

export const CAR_DATABASE: CarModel[] = [
  {
    id: "fiat-egea",
    brand: "Fiat",
    model: "Egea",
    years: [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023],
    basePrice: 850000,
    depreciationPerYear: 9,
    pricePerKm: 1.2,
    baselineKm: 30000,
    reliabilityScore: 74,
    reliabilityBreakdown: { engine: 78, electronics: 65, transmission: 80, interior: 70 },
    demand: "fast",
    averageDaysOnMarket: 9,
    commonProblems: [
      {
        title: "DPF Tıkanması",
        description: "Şehir içi kullanımda DPF filtresi 70.000 km sonrası sıkça tıkanıyor. Uzun yol kullanımı önerilir.",
        severity: "high",
        category: "engine",
        repairCostMin: 18000,
        repairCostMax: 32000,
        reportedFrequency: 64,
        triggerKm: 70000,
      },
      {
        title: "Vites Topuzu Boşluğu",
        description: "Manuel şanzımanlı modellerde vites topuzu zamanla boşluk yapıyor.",
        severity: "low",
        category: "transmission",
        repairCostMin: 1200,
        repairCostMax: 2500,
        reportedFrequency: 42,
        triggerKm: 50000,
      },
      {
        title: "Multimedya Donması",
        description: "Yazılımsal hata; servis güncellemesi ile çözülebiliyor.",
        severity: "medium",
        category: "electrical",
        repairCostMin: 1500,
        repairCostMax: 3500,
        reportedFrequency: 38,
        triggerKm: 40000,
      },
      {
        title: "Ön Amortisör Üst Takozu",
        description: "Bozuk yollarda 80.000 km civarı ses yapmaya başlıyor.",
        severity: "medium",
        category: "suspension",
        repairCostMin: 4500,
        repairCostMax: 7800,
        reportedFrequency: 52,
        triggerKm: 80000,
      },
    ],
    ownerReviews: [
      {
        name: "Mehmet K.",
        yearsOwned: 4,
        source: "Egea Sahipleri Türkiye",
        text: "Yakıt tüketimi şehirde 5.5L civarı, çok ekonomik. Bagajı segmentinin en büyüğü. DPF'e dikkat etmek lazım.",
      },
      {
        name: "Ayşe D.",
        yearsOwned: 2,
        source: "Telegram - Egea Kulübü",
        text: "Yedek parça bol ve ucuz. Servis ağı geniş. İç malzeme kalitesi orta seviye.",
      },
      {
        name: "Burak T.",
        yearsOwned: 3,
        source: "Forum.Egea",
        text: "İlan verdim 3 günde sattım. Talep çok yüksek, fiyatlar düşmüyor.",
      },
    ],
    alternatives: [
      { name: "Renault Megane", trim: "1.3 TCe Joy", year: 2020, marketPrice: 920000, reliabilityScore: 76, tag: "similar" },
      { name: "Hyundai i20", trim: "1.4 MPI Style", year: 2021, marketPrice: 780000, reliabilityScore: 82, tag: "economy" },
      { name: "Skoda Scala", trim: "1.0 TSI Premium", year: 2021, marketPrice: 1080000, reliabilityScore: 80, tag: "performance" },
    ],
  },
  {
    id: "vw-passat",
    brand: "Volkswagen",
    model: "Passat",
    years: [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023],
    basePrice: 1850000,
    depreciationPerYear: 11,
    pricePerKm: 3.2,
    baselineKm: 40000,
    reliabilityScore: 78,
    reliabilityBreakdown: { engine: 82, electronics: 70, transmission: 72, interior: 88 },
    demand: "moderate",
    averageDaysOnMarket: 18,
    commonProblems: [
      {
        title: "DSG Mekatronik Arızası",
        description: "DSG7 şanzımanda 80-100 bin km arası mekatronik problemleri raporlanmıştır.",
        severity: "high",
        category: "transmission",
        repairCostMin: 38000,
        repairCostMax: 72000,
        reportedFrequency: 31,
        triggerKm: 80000,
      },
      {
        title: "Turbo Hortum Yağlanması",
        description: "EA888 motorlarda turbo besleme hattında yağ kaçağı görülebiliyor.",
        severity: "medium",
        category: "engine",
        repairCostMin: 8200,
        repairCostMax: 14500,
        reportedFrequency: 47,
        triggerKm: 90000,
      },
      {
        title: "AdBlue Sensörü",
        description: "Dizel modellerde AdBlue sensör arızaları sık görülüyor.",
        severity: "medium",
        category: "electrical",
        repairCostMin: 6500,
        repairCostMax: 11000,
        reportedFrequency: 55,
        triggerKm: 60000,
      },
      {
        title: "Pano Plastik Çıtırtıları",
        description: "Sıcak iklimde pano plastiklerinde ses oluşumu görülebiliyor.",
        severity: "low",
        category: "interior",
        repairCostMin: 800,
        repairCostMax: 2200,
        reportedFrequency: 60,
        triggerKm: 50000,
      },
    ],
    ownerReviews: [
      {
        name: "Selim K.",
        yearsOwned: 5,
        source: "Passat Sahipleri TR",
        text: "Otoyolda harika. Yakıt 5.8L. DSG bakımını mutlaka 60.000 km'de yaptırın, sonradan büyük masraf çıkarıyor.",
      },
      {
        name: "Merve D.",
        yearsOwned: 2,
        source: "Telegram VAG Grubu",
        text: "İç malzeme kalitesi premium. Multimedya bazen donuyor. Servis pahalı, yan sanayi güvenilir.",
      },
    ],
    alternatives: [
      { name: "Skoda Superb", trim: "2.0 TDI Elite", year: 2020, marketPrice: 1720000, reliabilityScore: 80, tag: "economy" },
      { name: "Audi A4", trim: "35 TDI Advanced", year: 2020, marketPrice: 2150000, reliabilityScore: 79, tag: "performance" },
      { name: "Ford Mondeo", trim: "2.0 TDCi Titanium", year: 2019, marketPrice: 1480000, reliabilityScore: 75, tag: "similar" },
    ],
  },
  {
    id: "renault-clio",
    brand: "Renault",
    model: "Clio",
    years: [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023],
    basePrice: 780000,
    depreciationPerYear: 8,
    pricePerKm: 1.0,
    baselineKm: 30000,
    reliabilityScore: 76,
    reliabilityBreakdown: { engine: 75, electronics: 72, transmission: 78, interior: 79 },
    demand: "fast",
    averageDaysOnMarket: 11,
    commonProblems: [
      {
        title: "Triger Kayışı Erken Yıpranması",
        description: "1.5 dCi motorlarda triger kayışı 80.000 km'de yenilenmeli, ihmal edilirse motor hasarı.",
        severity: "high",
        category: "engine",
        repairCostMin: 12000,
        repairCostMax: 22000,
        reportedFrequency: 58,
        triggerKm: 80000,
      },
      {
        title: "EDC Şanzıman Tepkimesi",
        description: "EDC çift kavramalı şanzımanda düşük hızda tepme hissi.",
        severity: "medium",
        category: "transmission",
        repairCostMin: 18000,
        repairCostMax: 35000,
        reportedFrequency: 36,
        triggerKm: 70000,
      },
      {
        title: "Cam Açma Düğmesi",
        description: "Sürücü tarafı cam düğmesi zamanla bozuluyor.",
        severity: "low",
        category: "electrical",
        repairCostMin: 600,
        repairCostMax: 1500,
        reportedFrequency: 65,
        triggerKm: 60000,
      },
    ],
    ownerReviews: [
      {
        name: "Deniz Y.",
        yearsOwned: 3,
        source: "Clio Türkiye Forum",
        text: "Şehirde manevra kabiliyeti süper, park etmek çok kolay. Yakıt 5L. Triger'i kaçırmamak lazım.",
      },
      {
        name: "Cem O.",
        yearsOwned: 4,
        source: "Telegram - Renault TR",
        text: "Yedek parça uygun. Bayi servisi iyi. İkinci elde değer kaybı az.",
      },
    ],
    alternatives: [
      { name: "Peugeot 208", trim: "1.2 PureTech Active", year: 2021, marketPrice: 820000, reliabilityScore: 73, tag: "similar" },
      { name: "Hyundai i20", trim: "1.4 MPI Style", year: 2021, marketPrice: 760000, reliabilityScore: 82, tag: "economy" },
      { name: "VW Polo", trim: "1.0 TSI Highline", year: 2020, marketPrice: 950000, reliabilityScore: 80, tag: "performance" },
    ],
  },
  {
    id: "toyota-corolla",
    brand: "Toyota",
    model: "Corolla",
    years: [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023],
    basePrice: 1450000,
    depreciationPerYear: 7,
    pricePerKm: 2.0,
    baselineKm: 30000,
    reliabilityScore: 92,
    reliabilityBreakdown: { engine: 95, electronics: 88, transmission: 94, interior: 86 },
    demand: "fast",
    averageDaysOnMarket: 7,
    commonProblems: [
      {
        title: "Hibrit Akü Kapasitesi",
        description: "Hibrit modellerde 200.000 km sonrası akü kapasitesinde düşüş görülebiliyor.",
        severity: "medium",
        category: "electrical",
        repairCostMin: 45000,
        repairCostMax: 85000,
        reportedFrequency: 18,
        triggerKm: 200000,
      },
      {
        title: "Multimedya Yavaşlığı",
        description: "Stok multimedya sistemi zaman zaman geç tepki veriyor.",
        severity: "low",
        category: "electrical",
        repairCostMin: 0,
        repairCostMax: 1500,
        reportedFrequency: 48,
        triggerKm: 30000,
      },
      {
        title: "Arka Fren Pabucu",
        description: "Hibrit modellerde rejeneratif fren nedeniyle arka pabuçlar paslanabiliyor.",
        severity: "low",
        category: "suspension",
        repairCostMin: 2200,
        repairCostMax: 4500,
        reportedFrequency: 42,
        triggerKm: 60000,
      },
    ],
    ownerReviews: [
      {
        name: "Hakan B.",
        yearsOwned: 4,
        source: "Corolla Hybrid TR",
        text: "Hibrit yakıt tüketimi şehirde 4.2L, inanılmaz. Sıfır arıza, sıfır servis sürprizi. İdeal aile aracı.",
      },
      {
        name: "Zeynep A.",
        yearsOwned: 3,
        source: "Telegram - Toyota Sahipleri",
        text: "İkinci elde altın değerinde. Sattığım gün 8 kişi aradı. Değer kaybı çok az.",
      },
      {
        name: "Okan M.",
        yearsOwned: 2,
        source: "Forum.Toyota.tr",
        text: "Tek eksiği multimedya sistemi. Onun dışında kusursuz. Servis maliyetleri makul.",
      },
    ],
    alternatives: [
      { name: "Honda Civic", trim: "1.5 VTEC Executive", year: 2021, marketPrice: 1620000, reliabilityScore: 87, tag: "performance" },
      { name: "Hyundai Elantra", trim: "1.6 MPI Elite", year: 2021, marketPrice: 1280000, reliabilityScore: 84, tag: "economy" },
      { name: "VW Jetta", trim: "1.4 TSI Highline", year: 2020, marketPrice: 1380000, reliabilityScore: 76, tag: "similar" },
    ],
  },
  {
    id: "honda-civic",
    brand: "Honda",
    model: "Civic",
    years: [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023],
    basePrice: 1620000,
    depreciationPerYear: 8,
    pricePerKm: 2.4,
    baselineKm: 30000,
    reliabilityScore: 87,
    reliabilityBreakdown: { engine: 90, electronics: 85, transmission: 88, interior: 84 },
    demand: "fast",
    averageDaysOnMarket: 10,
    commonProblems: [
      {
        title: "CVT Şanzıman Sesi",
        description: "CVT şanzımanda yüksek devirde uğultu sesi raporlanmıştır.",
        severity: "medium",
        category: "transmission",
        repairCostMin: 25000,
        repairCostMax: 48000,
        reportedFrequency: 28,
        triggerKm: 90000,
      },
      {
        title: "Klima Kompresörü",
        description: "Sıcak iklimde 80.000 km civarı klima kompresör arızaları.",
        severity: "medium",
        category: "electrical",
        repairCostMin: 14000,
        repairCostMax: 22000,
        reportedFrequency: 32,
        triggerKm: 80000,
      },
      {
        title: "Direksiyon Mili Sesi",
        description: "Soğuk havada direksiyon dönüşlerinde tıkırtı sesi.",
        severity: "low",
        category: "suspension",
        repairCostMin: 3500,
        repairCostMax: 6800,
        reportedFrequency: 44,
        triggerKm: 70000,
      },
    ],
    ownerReviews: [
      {
        name: "Emre Ş.",
        yearsOwned: 3,
        source: "Civic FC5 Türkiye",
        text: "Spor sürüş hissi muhteşem. Yakıt 6.5L civarı. Yedek parça biraz pahalı ama uzun ömürlü.",
      },
      {
        name: "Burcu N.",
        yearsOwned: 5,
        source: "Telegram - Honda TR",
        text: "5 yıldır kullanıyorum, sadece bakım yaptım. Değer kaybı düşük. Multimedya iyi çalışıyor.",
      },
    ],
    alternatives: [
      { name: "Toyota Corolla", trim: "1.8 Hybrid Flame", year: 2021, marketPrice: 1520000, reliabilityScore: 92, tag: "economy" },
      { name: "Mazda 3", trim: "Skyactiv-G Power", year: 2020, marketPrice: 1480000, reliabilityScore: 84, tag: "similar" },
      { name: "VW Jetta", trim: "1.4 TSI R-Line", year: 2021, marketPrice: 1580000, reliabilityScore: 76, tag: "performance" },
    ],
  },
];

export function calculateMarketPrice(car: CarModel, year: number, km: number): number {
  const newestYear = Math.max(...car.years);
  const yearsOld = newestYear - year;
  const depreciationFactor = Math.pow(1 - car.depreciationPerYear / 100, yearsOld);
  const kmAdjustment = Math.max(0, km - car.baselineKm) * car.pricePerKm;
  return Math.round((car.basePrice * depreciationFactor - kmAdjustment) / 1000) * 1000;
}

export interface MarketPriceResult {
  price: number;
  source: "listings" | "model";
  sampleSize?: number;
  low?: number;
  high?: number;
}

/**
 * Resolve market price preferring real listing median (with km-adjustment vs the listing
 * pool's average km using the model's pricePerKm). Falls back to synthetic depreciation.
 */
export function resolveMarketPrice(
  carId: string,
  car: CarModel,
  year: number,
  km: number,
  median: { median: number; sampleSize: number; low: number; high: number } | null,
  poolAvgKm: number | null
): MarketPriceResult {
  if (median && poolAvgKm != null) {
    const kmDelta = km - poolAvgKm;
    const adjusted = median.median - kmDelta * car.pricePerKm;
    return {
      price: Math.round(adjusted / 1000) * 1000,
      source: "listings",
      sampleSize: median.sampleSize,
      low: median.low,
      high: median.high,
    };
  }
  if (median) {
    return {
      price: median.median,
      source: "listings",
      sampleSize: median.sampleSize,
      low: median.low,
      high: median.high,
    };
  }
  return { price: calculateMarketPrice(car, year, km), source: "model" };
}


export type Verdict = "great-deal" | "good-deal" | "fair" | "overpriced" | "very-overpriced";

export function getVerdict(askingPrice: number, marketPrice: number): { verdict: Verdict; deltaPercent: number } {
  const delta = ((askingPrice - marketPrice) / marketPrice) * 100;
  let verdict: Verdict;
  if (delta < -10) verdict = "great-deal";
  else if (delta < -3) verdict = "good-deal";
  else if (delta <= 5) verdict = "fair";
  else if (delta <= 12) verdict = "overpriced";
  else verdict = "very-overpriced";
  return { verdict, deltaPercent: Math.round(delta * 10) / 10 };
}

export function formatTL(value: number): string {
  return new Intl.NumberFormat("tr-TR").format(value) + " ₺";
}
