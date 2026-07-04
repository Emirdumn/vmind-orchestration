// CSV ilan içe aktarımı — service role ile market_listings'e yazar.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SERIES_MAP: Record<string, string> = {
  "1 Serisi": "1 Serisi",
  "3 Serisi": "3 Serisi",
  "4 Serisi": "4 Serisi",
  "5 Serisi": "5 Serisi",
  "6 Serisi": "6 Serisi",
  "7 Serisi": "7 Serisi",
  "i Serisi": "i Serisi",
  "X Serisi": "X Serisi",
};

const MONTHS: Record<string, number> = {
  Ocak: 1, Şubat: 2, Mart: 3, Nisan: 4, Mayıs: 5, Haziran: 6,
  Temmuz: 7, Ağustos: 8, Eylül: 9, Ekim: 10, Kasım: 11, Aralık: 12,
};

function parseInt2(s: string | null): number | null {
  if (!s) return null;
  const n = s.replace(/[^\d]/g, "");
  return n ? Number(n) : null;
}

function parseDate(s: string | null): string | null {
  if (!s) return null;
  const parts = s.trim().split(/\s+/);
  if (parts.length === 3 && MONTHS[parts[1]]) {
    const d = parseInt(parts[0], 10);
    const m = MONTHS[parts[1]];
    const y = parseInt(parts[2], 10);
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

// Minimal CSV parser supporting ; delimiter and quoted fields with embedded ;.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQ = false;
      else cell += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ";") { cur.push(cell); cell = ""; }
      else if (c === "\n") { cur.push(cell); rows.push(cur); cur = []; cell = ""; }
      else if (c === "\r") { /* skip */ }
      else cell += c;
    }
  }
  if (cell.length || cur.length) { cur.push(cell); rows.push(cur); }
  return rows.filter((r) => r.length > 1);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { csv, brand = "BMW" } = await req.json();
    if (!csv || typeof csv !== "string") {
      return new Response(JSON.stringify({ error: "csv field required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve brand
    const { data: brandRow, error: brandErr } = await supabase
      .from("brands").select("id").eq("name", brand).maybeSingle();
    if (brandErr || !brandRow) throw new Error(`Brand not found: ${brand}`);
    const brandId = brandRow.id;

    const rows = parseCsv(csv);
    const header = rows[0].map((h) => h.replace(/^\uFEFF/, "").trim());
    const idx = (name: string) => header.indexOf(name);
    const ci = {
      seri: idx("Seri"),
      model: idx("Model"),
      title: idx("İlan Başlığı"),
      year: idx("Yıl"),
      km: idx("KM"),
      price: idx("Fiyat"),
      date: idx("İlan Tarihi"),
      loc: idx("İl / İlçe"),
      url: idx("İlan Linki"),
    };
    if (ci.seri < 0 || ci.model < 0 || ci.title < 0 || ci.price < 0) {
      throw new Error("CSV başlıkları beklenenden farklı");
    }

    const data = rows.slice(1);
    const stats = { total: data.length, inserted: 0, skipped: 0, modelsCreated: 0, variantsCreated: 0 };

    // Cache models / variants
    const modelCache = new Map<string, number>(); // key: brandId|name
    const variantCache = new Map<string, number>(); // key: modelId|trim

    async function getOrCreateModel(name: string): Promise<number> {
      const k = `${brandId}|${name}`;
      if (modelCache.has(k)) return modelCache.get(k)!;
      const { data: m } = await supabase
        .from("models").select("id").eq("brand_id", brandId).eq("name", name).maybeSingle();
      if (m) { modelCache.set(k, m.id); return m.id; }
      const { data: maxRow } = await supabase
        .from("models").select("id").order("id", { ascending: false }).limit(1).maybeSingle();
      const newId = (maxRow?.id ?? 100) + 1;
      const { error } = await supabase.from("models").insert({
        id: newId, brand_id: brandId, name, body_type: "Sedan",
      });
      if (error) throw error;
      stats.modelsCreated++;
      modelCache.set(k, newId);
      return newId;
    }

    async function getOrCreateVariant(modelId: number, trim: string): Promise<number> {
      const k = `${modelId}|${trim}`;
      if (variantCache.has(k)) return variantCache.get(k)!;
      const { data: v } = await supabase
        .from("car_variants").select("id").eq("model_id", modelId).eq("trim_name", trim).maybeSingle();
      if (v) { variantCache.set(k, v.id); return v.id; }
      const { data: ins, error } = await supabase
        .from("car_variants").insert({ model_id: modelId, trim_name: trim }).select("id").single();
      if (error) throw error;
      stats.variantsCreated++;
      variantCache.set(k, ins.id);
      return ins.id;
    }

    const toInsert: any[] = [];
    for (const r of data) {
      try {
        const seri = (r[ci.seri] || "").trim();
        const trim = (r[ci.model] || "").trim();
        if (!seri || !trim) { stats.skipped++; continue; }
        const modelName = SERIES_MAP[seri] || seri;
        const modelId = await getOrCreateModel(modelName);
        const variantId = await getOrCreateVariant(modelId, trim);

        const loc = (r[ci.loc] || "").split("/");
        const city = loc[0]?.trim() || null;
        const district = loc[1]?.trim() || null;

        toInsert.push({
          car_variant_id: variantId,
          source_name: "sahibinden",
          title: (r[ci.title] || trim).slice(0, 500),
          price: parseInt2(r[ci.price]) ?? 0,
          currency: "TRY",
          model_year: parseInt2(r[ci.year]),
          mileage_km: parseInt2(r[ci.km]),
          city,
          district,
          url: r[ci.url] || null,
          listing_date: parseDate(r[ci.date]),
        });
      } catch (e) {
        stats.skipped++;
      }
    }

    if (toInsert.length) {
      // Chunked insert
      for (let i = 0; i < toInsert.length; i += 100) {
        const batch = toInsert.slice(i, i + 100);
        const { error } = await supabase.from("market_listings").insert(batch);
        if (error) throw error;
        stats.inserted += batch.length;
      }
    }

    return new Response(JSON.stringify({ success: true, stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
