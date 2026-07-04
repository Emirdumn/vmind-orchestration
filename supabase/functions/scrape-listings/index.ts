// Scrapes car listings from carvak.com / arabam.com / sahibinden via Firecrawl
// Caches results in `scraped_listings` table and reports diffs (new / updated).
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";

interface Listing {
  title: string;
  price: number | null;
  year: number | null;
  km: number | null;
  city?: string | null;
  url: string;
  image?: string | null;
  source: string;
}

const ListingsSchema = {
  type: "object",
  properties: {
    listings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Full car title (brand + model + trim)" },
          price: { type: "number", description: "Price in TRY (number only, no currency)" },
          year: { type: "number", description: "Model year, e.g. 2020" },
          km: { type: "number", description: "Kilometers, integer" },
          city: { type: "string", description: "City / location" },
          url: { type: "string", description: "Absolute URL to the listing detail page" },
          image: { type: "string", description: "Main image URL (absolute)" },
        },
        required: ["title", "url"],
      },
    },
  },
  required: ["listings"],
};

function detectSource(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) {
      return new Response(
        JSON.stringify({ error: "FIRECRAWL_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(SUPABASE_URL, SERVICE_ROLE);

    const body = await req.json().catch(() => ({}));
    const url: string | undefined = body?.url;
    const mode: "scrape" | "cache" = body?.mode === "cache" ? "cache" : "scrape";

    if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      return new Response(
        JSON.stringify({ error: "Geçerli bir URL gönderin (http/https)." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const source = detectSource(url);

    // -------------- Cache-only read --------------
    if (mode === "cache") {
      const { data, error } = await db
        .from("scraped_listings")
        .select("title, price, year, km, city, url, image, source, last_seen_at")
        .eq("search_url", url)
        .order("last_seen_at", { ascending: false })
        .limit(100);
      if (error) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          source,
          fromCache: true,
          count: data?.length ?? 0,
          listings: data ?? [],
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // -------------- Live scrape --------------
    const HARD_SITES = ["sahibinden.com", "letgo.com", "n11.com"];
    const isHardSite = HARD_SITES.some((d) => source.endsWith(d));
    const proxyMode = body?.proxy ?? (isHardSite ? "stealth" : "auto");
    const waitFor = body?.waitFor ?? (isHardSite ? 5000 : 2500);

    const fcRes = await fetch(`${FIRECRAWL_V2}/scrape`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: [
          {
            type: "json",
            schema: ListingsSchema,
            prompt:
              "Extract every car listing visible on the page. For price, return numeric Turkish Lira value only (no symbols, no thousand separators). For km, return numeric kilometers only. URLs must be absolute. Skip ads, banners, login forms and unrelated cards. If the page is a login wall, return an empty listings array.",
          },
          "links",
        ],
        onlyMainContent: true,
        waitFor,
        proxy: proxyMode,
        blockAds: true,
      }),
    });

    const fcData = await fcRes.json();
    if (!fcRes.ok) {
      console.error("Firecrawl error", fcRes.status, fcData);
      return new Response(
        JSON.stringify({
          error: `Firecrawl isteği başarısız (${fcRes.status})`,
          details: fcData?.error ?? fcData,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const root = fcData?.data ?? fcData;
    const meta = root?.metadata ?? {};
    const finalUrl: string = meta?.url ?? meta?.sourceURL ?? url;

    const hitLoginWall =
      /\/(login|giris|sign[-_]?in)/i.test(finalUrl) ||
      /\.(login|giris)\./i.test(finalUrl);

    const payload = root?.json ?? {};
    const rawListings: any[] = Array.isArray(payload?.listings) ? payload.listings : [];

    const listings: Listing[] = rawListings
      .map((l) => ({
        title: String(l?.title ?? "").trim(),
        price: Number.isFinite(Number(l?.price)) ? Number(l.price) : null,
        year: Number.isFinite(Number(l?.year)) ? Number(l.year) : null,
        km: Number.isFinite(Number(l?.km)) ? Number(l.km) : null,
        city: l?.city ? String(l.city) : null,
        url: String(l?.url ?? "").trim(),
        image: l?.image ? String(l.image) : null,
        source,
      }))
      .filter((l) => l.title && l.url);

    // -------------- Diff against existing cache --------------
    let added = 0;
    let priceUpdated = 0;
    let unchanged = 0;

    if (listings.length > 0) {
      const urls = listings.map((l) => l.url);
      const { data: existing } = await db
        .from("scraped_listings")
        .select("url, price")
        .in("url", urls);

      const existingMap = new Map<string, number | null>();
      for (const row of existing ?? []) {
        existingMap.set(row.url, row.price === null ? null : Number(row.price));
      }

      for (const l of listings) {
        if (!existingMap.has(l.url)) {
          added++;
        } else if (existingMap.get(l.url) !== l.price) {
          priceUpdated++;
        } else {
          unchanged++;
        }
      }

      const now = new Date().toISOString();
      const rows = listings.map((l) => ({
        source: l.source,
        url: l.url,
        title: l.title,
        price: l.price,
        year: l.year,
        km: l.km,
        city: l.city,
        image: l.image,
        search_url: url,
        last_seen_at: now,
      }));

      const { error: upsertError } = await db
        .from("scraped_listings")
        .upsert(rows, { onConflict: "url" });

      if (upsertError) {
        console.error("upsert error", upsertError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        source,
        finalUrl,
        proxyMode,
        hitLoginWall,
        warning: hitLoginWall
          ? "Site bot korumasıyla login sayfasına yönlendirdi. İlan çekilemedi."
          : listings.length === 0
          ? "Bu sayfada yapılandırılmış ilan tespit edilemedi. Farklı bir liste sayfası deneyin."
          : null,
        count: listings.length,
        diff: { added, priceUpdated, unchanged },
        listings,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("scrape-listings fatal", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
