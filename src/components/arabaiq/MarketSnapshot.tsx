import { useEffect, useState } from "react";
import { Database, TrendingDown, TrendingUp, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { allResolvedVariants, type ResolvedVariant } from "@/data/dbCatalog";

interface MarketStat {
  car_variant_id: number;
  sample_size: number;
  avg_price: number | null;
  median_price: number | null;
  min_price: number | null;
  max_price: number | null;
  avg_mileage: number | null;
  price_mileage_corr: number | null;
}

interface MarketListing {
  id: number;
  car_variant_id: number;
  title: string;
  price: number;
  mileage_km: number | null;
  city: string | null;
  seller_type: string | null;
  url: string | null;
  listing_date: string | null;
}

export const MarketSnapshot = () => {
  const [stats, setStats] = useState<MarketStat[]>([]);
  const [listings, setListings] = useState<MarketListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const variants = allResolvedVariants();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [s, l] = await Promise.all([
          supabase.from("market_stats").select("*"),
          supabase
            .from("market_listings")
            .select(
              "id, car_variant_id, title, price, mileage_km, city, seller_type, url, listing_date"
            )
            .eq("is_active", true)
            .order("listing_date", { ascending: false }),
        ]);
        if (cancelled) return;
        if (s.error) throw s.error;
        if (l.error) throw l.error;
        setStats((s.data ?? []) as MarketStat[]);
        setListings((l.data ?? []) as MarketListing[]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Yüklenemedi");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const variantById = new Map<number, ResolvedVariant>(
    variants.map((v) => [v.variant.id, v])
  );

  const fmtPrice = (n: number | null) =>
    n == null ? "—" : `${Math.round(n).toLocaleString("tr-TR")} ₺`;

  return (
    <section className="bg-card rounded-3xl p-6 md:p-8 ring-1 ring-foreground/5 shadow-soft">
      <div className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
        <Database className="size-3" />
        Pazar Görüntüsü
      </div>
      <h3 className="text-xl font-semibold mt-1">Katalog Varyantları & Canlı İstatistikler</h3>
      <p className="text-xs text-muted-foreground mt-1">
        {variants.length} varyant · Cloud DB'den anlık çekilen ilanlar ve hesaplanmış metrikler.
      </p>

      {loading && (
        <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Yükleniyor…
        </div>
      )}

      {error && (
        <div className="mt-4 px-4 py-3 rounded-2xl bg-destructive/10 text-destructive text-sm ring-1 ring-destructive/20">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          {stats.map((s) => {
            const v = variantById.get(s.car_variant_id);
            if (!v) return null;
            const variantListings = listings.filter(
              (l) => l.car_variant_id === s.car_variant_id
            );
            const corrPositive = (s.price_mileage_corr ?? 0) >= 0;
            return (
              <div
                key={s.car_variant_id}
                className="rounded-2xl ring-1 ring-foreground/5 bg-background p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      {v.brand.name} · {v.segment.name}
                    </p>
                    <h4 className="text-base font-semibold mt-0.5">
                      {v.model.name}{" "}
                      <span className="text-muted-foreground font-light">
                        · {v.variant.year}
                      </span>
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {v.variant.trim_name} · {v.variant.fuel_type} ·{" "}
                      {v.variant.horsepower} HP
                    </p>
                  </div>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-success/15 text-success shrink-0">
                    {s.sample_size} ilan
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-secondary/50 p-2">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      Min
                    </p>
                    <p className="text-xs font-semibold mt-0.5">
                      {fmtPrice(s.min_price)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-primary/10 p-2">
                    <p className="text-[10px] text-primary uppercase tracking-wider font-semibold">
                      Medyan
                    </p>
                    <p className="text-sm font-semibold mt-0.5 text-primary">
                      {fmtPrice(s.median_price)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-secondary/50 p-2">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      Max
                    </p>
                    <p className="text-xs font-semibold mt-0.5">
                      {fmtPrice(s.max_price)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    {corrPositive ? (
                      <TrendingUp className="size-3" />
                    ) : (
                      <TrendingDown className="size-3" />
                    )}
                    Fiyat-km korelasyon: {s.price_mileage_corr?.toFixed(2) ?? "—"}
                  </span>
                  <span>
                    · Ort. km:{" "}
                    {s.avg_mileage != null
                      ? Math.round(s.avg_mileage).toLocaleString("tr-TR")
                      : "—"}
                  </span>
                </div>

                {variantListings.length > 0 && (
                  <ul className="mt-3 pt-3 border-t border-foreground/5 space-y-1.5">
                    {variantListings.slice(0, 3).map((l) => (
                      <li
                        key={l.id}
                        className="flex items-center justify-between gap-2 text-[11px]"
                      >
                        <span className="text-muted-foreground truncate">
                          {l.city ?? "—"} ·{" "}
                          {l.mileage_km?.toLocaleString("tr-TR") ?? "—"} km ·{" "}
                          {l.seller_type ?? ""}
                        </span>
                        <span className="font-semibold shrink-0">
                          {l.price.toLocaleString("tr-TR")} ₺
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
