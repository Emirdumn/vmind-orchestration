import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  BRAND_LIST,
  CATALOG_INDEX,
  CatalogVariant,
  findEntry,
  modelsForBrand,
} from "@/data/catalog";
import { totalListings } from "@/data/listings";


export interface SearchValues {
  carId: string;
  brand: string;
  model: string;
  year: number;
  trim: string;
  km: number;
  askingPrice: number;
}

interface SearchHeroProps {
  initial: SearchValues;
  onSearch: (values: SearchValues) => void;
}

export function SearchHero({ initial, onSearch }: SearchHeroProps) {
  const [brand, setBrand] = useState(initial.brand);
  const [carId, setCarId] = useState(initial.carId);
  const [year, setYear] = useState(initial.year);
  const [trim, setTrim] = useState(initial.trim);
  const [km, setKm] = useState(initial.km);
  const [askingPrice, setAskingPrice] = useState(initial.askingPrice);

  const brandModels = useMemo(() => modelsForBrand(brand), [brand]);
  const entry = useMemo(() => findEntry(carId), [carId]);

  // When brand changes → first model of brand
  useEffect(() => {
    if (!entry || entry.brand !== brand) {
      const first = brandModels[0];
      if (first) setCarId(first.id);
    }
  }, [brand, brandModels, entry]);

  // When model changes → reset year/trim to first available
  useEffect(() => {
    if (!entry) return;
    if (!entry.years.includes(year)) {
      setYear(entry.years[entry.years.length - 1]);
    }
    const trimsForYear = entry.variants.filter((v) => v.year === (entry.years.includes(year) ? year : entry.years[entry.years.length - 1]));
    if (!trimsForYear.find((v) => v.trim === trim)) {
      setTrim(trimsForYear[0]?.trim ?? "");
    }
  }, [carId]); // eslint-disable-line react-hooks/exhaustive-deps

  const trimsForYear: CatalogVariant[] = useMemo(
    () => entry?.variants.filter((v) => v.year === year) ?? [],
    [entry, year]
  );

  return (
    <section className="pt-16 pb-12 px-6 bg-gradient-hero">
      <div className="max-w-4xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-card ring-1 ring-foreground/5 shadow-soft mb-6">
          <span className="size-1.5 rounded-full bg-success animate-pulse" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {totalListings().toLocaleString("tr-TR")} canlı arabam.com ilanı · {CATALOG_INDEX.length} model · {BRAND_LIST.length} marka
          </span>

        </div>

        <h1 className="text-4xl md:text-6xl font-light tracking-tight leading-[1.05] text-balance">
          Veri ile <span className="font-semibold text-brand">navigasyon</span> yapın,
          <br />
          aracınızın geleceğini görün.
        </h1>
        <p className="mt-6 text-muted-foreground max-w-[55ch] mx-auto text-lg leading-relaxed">
          İkinci el piyasasını yapay zeka destekli fiyat analizi ve gerçek sahip deneyimleriyle çözün.
          Türk pazarına özel kronik sorun veritabanı.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!entry) return;
            onSearch({
              carId: entry.id,
              brand: entry.brand,
              model: entry.model,
              year,
              trim,
              km,
              askingPrice,
            });
          }}
          className="mt-12 p-2 bg-card rounded-2xl shadow-elevated ring-1 ring-foreground/5 flex flex-col md:flex-row gap-2 text-left"
        >
          <div className="flex-1 px-4 py-3 border-b md:border-b-0 md:border-r border-border min-w-0">
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-1">
              Marka
            </label>
            <select
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="w-full bg-transparent border-none p-0 focus:ring-0 focus:outline-none text-sm font-medium text-foreground"
            >
              {BRAND_LIST.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 px-4 py-3 border-b md:border-b-0 md:border-r border-border min-w-0">
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-1">
              Model
            </label>
            <select
              value={carId}
              onChange={(e) => setCarId(e.target.value)}
              className="w-full bg-transparent border-none p-0 focus:ring-0 focus:outline-none text-sm font-medium text-foreground"
            >
              {brandModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.model}
                </option>
              ))}
            </select>
          </div>

          <div className="px-4 py-3 border-b md:border-b-0 md:border-r border-border md:w-24">
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-1">
              Yıl
            </label>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-full bg-transparent border-none p-0 focus:ring-0 focus:outline-none text-sm font-medium text-foreground"
            >
              {entry?.years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          {trimsForYear.length > 0 && (
            <div className="flex-1 px-4 py-3 border-b md:border-b-0 md:border-r border-border min-w-0">
              <label className="block text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-1">
                Donanım
              </label>
              <select
                value={trim}
                onChange={(e) => setTrim(e.target.value)}
                className="w-full bg-transparent border-none p-0 focus:ring-0 focus:outline-none text-sm font-medium text-foreground"
              >
                {trimsForYear.map((v) => (
                  <option key={v.trim} value={v.trim}>
                    {v.trim}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="px-4 py-3 border-b md:border-b-0 md:border-r border-border md:w-32">
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-1">
              Kilometre
            </label>
            <input
              type="number"
              value={km}
              onChange={(e) => setKm(Number(e.target.value))}
              step={1000}
              className="w-full bg-transparent border-none p-0 focus:ring-0 focus:outline-none text-sm font-medium text-foreground"
            />
          </div>

          <div className="px-4 py-3 md:w-36">
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-1">
              İlan Fiyatı (₺)
            </label>
            <input
              type="number"
              value={askingPrice}
              onChange={(e) => setAskingPrice(Number(e.target.value))}
              step={5000}
              className="w-full bg-transparent border-none p-0 focus:ring-0 focus:outline-none text-sm font-medium text-foreground"
            />
          </div>

          <button
            type="submit"
            className="bg-brand hover:bg-primary text-brand-foreground px-8 py-3.5 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 shrink-0"
          >
            <Search className="size-4" />
            Analiz Et
          </button>
        </form>
      </div>
    </section>
  );
}
