import { ExternalLink, MapPin, Gauge, Calendar } from "lucide-react";
import { Listing } from "@/data/listings";
import { formatTL } from "@/data/cars";

interface SimilarListingsProps {
  listings: Listing[];
  marketPrice: number;
}

export function SimilarListings({ listings, marketPrice }: SimilarListingsProps) {
  if (listings.length === 0) {
    return (
      <div className="bg-card rounded-3xl p-8 ring-1 ring-foreground/5 shadow-soft">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
          Benzer İlanlar
        </h3>
        <p className="text-sm text-muted-foreground mt-4 text-center py-8">
          Bu model/yıl için ikinci el pazarda uygun ilan bulunamadı.
        </p>
      </div>
    );
  }

  // Aggregate sources for the header summary (e.g. "otoplus.com · carvak.com")
  const sources = Array.from(
    new Set(listings.map((l) => l.source).filter(Boolean) as string[])
  );

  return (
    <div className="bg-card rounded-3xl p-8 ring-1 ring-foreground/5 shadow-soft">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
            Benzer İlanlar
          </h3>
          <p className="text-xl font-semibold mt-1">
            İkinci el pazardan {listings.length} sonuç
          </p>
          {sources.length > 0 && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Kaynak: {sources.join(" · ")}
            </p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Renk noktaları pazar medianına göre konumu gösterir
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {listings.map((l) => {
          const delta = ((l.price - marketPrice) / marketPrice) * 100;
          const tone =
            delta < -8
              ? "bg-success text-success-foreground"
              : delta < -2
              ? "bg-success/15 text-success"
              : delta <= 5
              ? "bg-secondary text-muted-foreground"
              : delta <= 12
              ? "bg-warning/15 text-warning"
              : "bg-destructive/15 text-destructive";

          return (
            <a
              key={l.id}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative flex flex-col rounded-2xl ring-1 ring-foreground/5 bg-secondary/40 hover:ring-brand/40 hover:shadow-elevated transition-all overflow-hidden"
            >
              <div className="aspect-[4/3] bg-muted overflow-hidden">
                {l.image ? (
                  <img
                    src={l.image}
                    alt={l.title}
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                    Görsel yok
                  </div>
                )}
                <div className={`absolute top-3 left-3 px-2.5 py-1 rounded-full text-[10px] font-bold ${tone}`}>
                  {delta > 0 ? "+" : ""}
                  {delta.toFixed(1)}%
                </div>
                {l.source && (
                  <div className="absolute top-3 right-3 px-2 py-1 rounded-full text-[10px] font-semibold bg-background/85 backdrop-blur text-foreground/80 ring-1 ring-foreground/10">
                    {l.source}
                  </div>
                )}
              </div>
              <div className="p-4 flex-1 flex flex-col">
                <h4 className="text-sm font-semibold leading-snug line-clamp-2 min-h-[2.5rem]">
                  {l.title}
                </h4>
                <div className="mt-2 text-lg font-bold text-brand">{formatTL(l.price)}</div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {l.year && (
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="size-3" />
                      {l.year}
                    </span>
                  )}
                  {l.km != null && (
                    <span className="inline-flex items-center gap-1">
                      <Gauge className="size-3" />
                      {l.km.toLocaleString("tr-TR")} km
                    </span>
                  )}
                  {l.city && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3" />
                      {l.city}
                    </span>
                  )}
                </div>
                <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-brand opacity-0 group-hover:opacity-100 transition-opacity">
                  {l.source ? `${l.source}'da görüntüle` : "İlanı görüntüle"}
                  <ExternalLink className="size-3" />
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
