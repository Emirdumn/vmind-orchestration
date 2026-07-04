import { useEffect, useState } from "react";
import { Loader2, Globe, ExternalLink, Sparkles, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface ScrapedListing {
  title: string;
  price: number | null;
  year: number | null;
  km: number | null;
  city?: string | null;
  url: string;
  image?: string | null;
  source: string;
}

interface Diff {
  added: number;
  priceUpdated: number;
  unchanged: number;
}

const PRESETS = [
  { label: "carvak.com", url: "https://www.carvak.com/tr/satilik-arac" },
  { label: "arabam.com", url: "https://www.arabam.com/ikinci-el" },
  {
    label: "arabam – İstanbul",
    url: "https://www.arabam.com/ikinci-el/otomobil-istanbul",
  },
  {
    label: "sahibinden – BMW 3",
    url: "https://www.sahibinden.com/bmw-3-serisi?sorting=yil-nu_desc",
  },
];

export const FirecrawlScraper = () => {
  const [url, setUrl] = useState(PRESETS[2].url);
  const [loading, setLoading] = useState(false);
  const [cacheLoading, setCacheLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [results, setResults] = useState<ScrapedListing[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [fromCache, setFromCache] = useState(false);

  // Load cached listings whenever URL changes
  useEffect(() => {
    let cancelled = false;
    const loadCache = async () => {
      setCacheLoading(true);
      setError(null);
      setWarning(null);
      setDiff(null);
      try {
        const { data, error: fnError } = await supabase.functions.invoke(
          "scrape-listings",
          { body: { url, mode: "cache" } }
        );
        if (cancelled) return;
        if (fnError) throw new Error(fnError.message);
        if (!data?.success) throw new Error(data?.error ?? "Cache okunamadı");
        setResults(data.listings ?? []);
        setSource(data.source ?? null);
        setFromCache(true);
      } catch (e) {
        if (!cancelled) {
          // Cache miss is not a real error — just empty
          setResults([]);
          setFromCache(false);
        }
      } finally {
        if (!cancelled) setCacheLoading(false);
      }
    };
    loadCache();
    return () => {
      cancelled = true;
    };
  }, [url]);

  const handleScrape = async () => {
    setLoading(true);
    setError(null);
    setWarning(null);
    setDiff(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        "scrape-listings",
        { body: { url } }
      );
      if (fnError) throw new Error(fnError.message);
      if (!data?.success) throw new Error(data?.error ?? "Bilinmeyen hata");
      setResults(data.listings ?? []);
      setSource(data.source ?? null);
      setWarning(data.warning ?? null);
      setDiff(data.diff ?? null);
      setFromCache(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scrape başarısız");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="bg-card rounded-3xl p-6 md:p-8 ring-1 ring-foreground/5 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
            <Sparkles className="size-3" />
            Canlı İlan Çekici
          </div>
          <h3 className="text-xl font-semibold mt-1">Firecrawl ile Anlık Veri</h3>
          <p className="text-xs text-muted-foreground mt-1">
            İlanlar otomatik kaydedilir. Tekrar çekildiğinde sadece değişenler güncellenir.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {PRESETS.map((p) => (
          <button
            key={p.url}
            onClick={() => setUrl(p.url)}
            className={`text-[11px] px-3 py-1.5 rounded-full ring-1 transition-colors ${
              url === p.url
                ? "bg-primary text-primary-foreground ring-primary"
                : "bg-secondary text-muted-foreground ring-foreground/5 hover:text-foreground"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-full bg-secondary ring-1 ring-foreground/5">
          <Globe className="size-4 text-muted-foreground shrink-0" />
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.carvak.com/tr/satilik-arac"
            className="flex-1 bg-transparent text-sm focus:outline-none"
          />
        </div>
        <button
          onClick={handleScrape}
          disabled={loading || !url}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 hover:bg-primary/90 transition-colors"
        >
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Çekiliyor…
            </>
          ) : (
            <>
              <RefreshCw className="size-4" /> Canlı Çek
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="mt-4 px-4 py-3 rounded-2xl bg-destructive/10 text-destructive text-sm ring-1 ring-destructive/20">
          {error}
        </div>
      )}

      {warning && !error && (
        <div className="mt-4 px-4 py-3 rounded-2xl bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 text-sm ring-1 ring-yellow-500/20">
          ⚠️ {warning}
        </div>
      )}

      {diff && (
        <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold">
          <span className="px-2.5 py-1 rounded-full bg-success/15 text-success">
            +{diff.added} yeni
          </span>
          <span className="px-2.5 py-1 rounded-full bg-primary/15 text-primary">
            {diff.priceUpdated} fiyat güncellendi
          </span>
          <span className="px-2.5 py-1 rounded-full bg-secondary text-muted-foreground">
            {diff.unchanged} değişmedi
          </span>
        </div>
      )}

      {(results.length > 0 || cacheLoading) && (
        <div className="mt-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-muted-foreground">
              {cacheLoading
                ? "Önbellekten yükleniyor…"
                : `${results.length} ilan ${fromCache ? "(önbellek)" : "bulundu"}`}
            </p>
            {source && !cacheLoading && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-success/15 text-success">
                Kaynak: {source}
              </span>
            )}
          </div>
          {!cacheLoading && (
            <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {results.map((l, i) => (
                <li
                  key={`${l.url}-${i}`}
                  className="rounded-2xl ring-1 ring-foreground/5 bg-background overflow-hidden flex flex-col"
                >
                  {l.image ? (
                    <img
                      src={l.image}
                      alt={l.title}
                      loading="lazy"
                      className="w-full h-36 object-cover bg-secondary"
                    />
                  ) : (
                    <div className="w-full h-36 bg-secondary" />
                  )}
                  <div className="p-3 flex flex-col gap-1.5 flex-1">
                    <p className="text-sm font-semibold line-clamp-2">{l.title}</p>
                    <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                      {l.year && <span>{l.year}</span>}
                      {l.km != null && <span>· {l.km.toLocaleString("tr-TR")} km</span>}
                      {l.city && <span>· {l.city}</span>}
                    </div>
                    {l.price != null && (
                      <p className="text-base font-semibold mt-auto">
                        {l.price.toLocaleString("tr-TR")} ₺
                      </p>
                    )}
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline mt-1"
                    >
                      {l.source} <ExternalLink className="size-3" />
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
};
