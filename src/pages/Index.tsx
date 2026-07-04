import { useMemo, useState } from "react";
import { Navbar } from "@/components/arabaiq/Navbar";
import { SearchHero, SearchValues } from "@/components/arabaiq/SearchHero";
import { PriceGauge } from "@/components/arabaiq/PriceGauge";
import { ReliabilityScore } from "@/components/arabaiq/ReliabilityScore";
import { ProblemCard } from "@/components/arabaiq/ProblemCard";
import { DemandMeter } from "@/components/arabaiq/DemandMeter";
import { OwnerReviews } from "@/components/arabaiq/OwnerReviews";
import { ComparisonTable } from "@/components/arabaiq/ComparisonTable";
import { RiskAssessment } from "@/components/arabaiq/RiskAssessment";
import { PriceNegotiator } from "@/components/arabaiq/PriceNegotiator";
import { SpecsCard } from "@/components/arabaiq/SpecsCard";
import { Footer } from "@/components/arabaiq/Footer";
import { SimilarListings } from "@/components/arabaiq/SimilarListings";
import { FirecrawlScraper } from "@/components/arabaiq/FirecrawlScraper";
import { MarketSnapshot } from "@/components/arabaiq/MarketSnapshot";
import { KnownProblems } from "@/components/ui/KnownProblems";
import { calculateMarketPrice, getVerdict, resolveMarketPrice, Severity } from "@/data/cars";
import { CATALOG_INDEX, findEntry, hasRealResearchData, resolveCar } from "@/data/catalog";
import { averageKm, hasListings, medianMarketPrice, similarListings } from "@/data/listings";
import { ClipboardCheck, ChevronRight, Sparkles, Database } from "lucide-react";


const Index = () => {
  // Default: pick the first model that has real research data
  const defaultEntry =
    CATALOG_INDEX.find((e) => hasRealResearchData(e.id)) ?? CATALOG_INDEX[0];
  const defaultCar = resolveCar(defaultEntry.id)!;
  const defaultYear = defaultEntry.years[defaultEntry.years.length - 1];
  const defaultVariant = defaultEntry.variants.find((v) => v.year === defaultYear) ?? defaultEntry.variants[0];
  const defaultKm = 65000;
  const defaultMarket = calculateMarketPrice(defaultCar, defaultYear, defaultKm);

  const [search, setSearch] = useState<SearchValues>({
    carId: defaultEntry.id,
    brand: defaultEntry.brand,
    model: defaultEntry.model,
    year: defaultYear,
    trim: defaultVariant.trim,
    km: defaultKm,
    askingPrice: Math.round(defaultMarket * 0.97),
  });
  const [severityFilter, setSeverityFilter] = useState<Severity | "all">("all");

  const entry = useMemo(() => findEntry(search.carId)!, [search.carId]);
  const car = useMemo(() => resolveCar(search.carId)!, [search.carId]);
  const variant = useMemo(
    () =>
      entry.variants.find((v) => v.year === search.year && v.trim === search.trim) ??
      entry.variants.find((v) => v.year === search.year) ??
      entry.variants[0],
    [entry, search.year, search.trim]
  );
  const isResearched = hasRealResearchData(search.carId);
  const hasRealListings = hasListings(search.carId);
  const marketResult = useMemo(() => {
    const median = medianMarketPrice(search.carId, search.year);
    const poolKm = averageKm(search.carId, search.year);
    return resolveMarketPrice(search.carId, car, search.year, search.km, median, poolKm);
  }, [search.carId, car, search.year, search.km]);
  const marketPrice = marketResult.price;
  const { verdict, deltaPercent } = useMemo(() => getVerdict(search.askingPrice, marketPrice), [search.askingPrice, marketPrice]);
  const matchingListings = useMemo(
    () => similarListings(search.carId, search.year, search.km, { yearWindow: 2, limit: 9 }),
    [search.carId, search.year, search.km]
  );


  const filteredProblems = useMemo(() => {
    if (severityFilter === "all") return car.commonProblems;
    return car.commonProblems.filter((p) => p.severity === severityFilter);
  }, [car, severityFilter]);

  const filterTabs: { value: Severity | "all"; label: string }[] = [
    { value: "all", label: "Tümü" },
    { value: "high", label: "Kritik" },
    { value: "medium", label: "Orta" },
    { value: "low", label: "Bakım" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <SearchHero initial={search} onSearch={(v) => setSearch(v)} />

      {/* Vehicle header */}
      <section className="px-6 pt-8 pb-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Analiz Raporu
              </span>
              {marketResult.source === "listings" ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success/15 text-[10px] font-semibold text-success">
                  <Database className="size-2.5" />
                  Canlı Pazar Verisi · {marketResult.sampleSize} ilan
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary text-[10px] font-semibold text-muted-foreground">
                  <Sparkles className="size-2.5" />
                  Model Tahmini
                </span>
              )}
              {!isResearched && hasRealListings && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary text-[10px] font-semibold text-muted-foreground">
                  <Sparkles className="size-2.5" />
                  Sorun Verisi: Tahmini
                </span>
              )}
            </div>

            <h2 className="text-3xl md:text-4xl font-semibold mt-1 tracking-tight">
              {car.brand} {car.model}{" "}
              <span className="text-muted-foreground font-light">· {search.year}</span>
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {variant.trim} · {search.km.toLocaleString("tr-TR")} km · İlan{" "}
              {search.askingPrice.toLocaleString("tr-TR")} ₺
            </p>
          </div>
          <button className="flex items-center gap-2 px-5 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-full text-sm font-semibold transition-all shadow-soft">
            <ClipboardCheck className="size-4" />
            Detaylı Ekspertiz Al
            <ChevronRight className="size-4" />
          </button>
        </div>
      </section>

      <main className="max-w-7xl mx-auto px-6 pb-16 animate-fade-in">
        {/* Top row: Price gauge | Reliability | Demand */}
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-4">
            <PriceGauge
              marketPrice={marketPrice}
              askingPrice={search.askingPrice}
              verdict={verdict}
              deltaPercent={deltaPercent}
            />
          </div>
          <div className="col-span-12 lg:col-span-5">
            <ReliabilityScore car={car} />
          </div>
          <div className="col-span-12 lg:col-span-3">
            <DemandMeter car={car} />
          </div>
        </div>

        {/* Specs card (real catalog data) */}
        <div className="mt-6">
          <SpecsCard variant={variant} segment={entry.segment} bodyType={entry.bodyType} />
        </div>

        {/* Negotiator */}
        <div className="mt-6">
          <PriceNegotiator
            car={car}
            year={search.year}
            km={search.km}
            askingPrice={search.askingPrice}
            onChange={(v) => setSearch((s) => ({ ...s, askingPrice: v }))}
          />
        </div>

        {/* Real listings from arabam.com */}
        <div className="mt-6">
          <SimilarListings listings={matchingListings} marketPrice={marketPrice} />
        </div>

        {/* Live Firecrawl scraper */}
        <div className="mt-6">
          <FirecrawlScraper />
        </div>

        {/* Catalog-backed market snapshot */}
        <div className="mt-6">
          <MarketSnapshot />
        </div>


        {/* Problems + Risk */}
        <div className="mt-6 grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-8">
            <div className="bg-card rounded-3xl p-8 ring-1 ring-foreground/5 shadow-soft">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Kronik Sorunlar</h3>
                  <p className="text-xl font-semibold mt-1">Sahiplerin Bildirdiği Arızalar</p>
                </div>
                <div className="flex items-center gap-1 p-1 bg-secondary rounded-full">
                  {filterTabs.map((tab) => (
                    <button
                      key={tab.value}
                      onClick={() => setSeverityFilter(tab.value)}
                      className={`px-3.5 py-1.5 rounded-full text-[11px] font-semibold transition-all ${
                        severityFilter === tab.value
                          ? "bg-card text-foreground shadow-soft"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                {filteredProblems.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Bu filtre için sorun bulunamadı.</p>
                ) : (
                  filteredProblems.map((p, i) => <ProblemCard key={i} problem={p} />)
                )}
              </div>
            </div>
          </div>
          <div className="col-span-12 lg:col-span-4">
            <RiskAssessment car={car} km={search.km} />
          </div>
        </div>

        {/* Known problems (US market reports) */}
        <div className="mt-6">
          <KnownProblems brand={car.brand} model={car.model} locale="tr" />
        </div>

        {/* Owner reviews */}
        <div className="mt-6">
          <OwnerReviews reviews={car.ownerReviews} />
        </div>

        {/* Comparison */}
        <div className="mt-6">
          <ComparisonTable car={car} year={search.year} km={search.km} />
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default Index;
