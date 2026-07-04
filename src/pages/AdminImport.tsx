import { useState } from "react";
import { Link } from "react-router-dom";
import { Upload, Loader2, ArrowLeft, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Stats {
  total: number;
  inserted: number;
  skipped: number;
  modelsCreated: number;
  variantsCreated: number;
}

export default function AdminImport() {
  const [file, setFile] = useState<File | null>(null);
  const [brand, setBrand] = useState("BMW");
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setStats(null);
    try {
      const csv = await file.text();
      const { data, error: fnError } = await supabase.functions.invoke(
        "import-listings",
        { body: { csv, brand } },
      );
      if (fnError) throw new Error(fnError.message);
      if (!data?.success) throw new Error(data?.error ?? "Yükleme başarısız");
      setStats(data.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="size-4" /> Ana sayfa
        </Link>

        <div className="bg-card rounded-3xl p-8 ring-1 ring-foreground/5 shadow-soft">
          <div className="flex items-center gap-3 mb-2">
            <div className="size-10 rounded-2xl bg-primary/15 text-primary grid place-items-center">
              <Upload className="size-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">CSV İlan İçe Aktarımı</h1>
              <p className="text-xs text-muted-foreground">
                sahibinden.com export'unu market_listings tablosuna aktarır.
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Marka
              </label>
              <select
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="w-full px-4 py-2.5 rounded-2xl bg-secondary ring-1 ring-foreground/5 text-sm focus:outline-none focus:ring-primary"
              >
                <option value="BMW">BMW</option>
                <option value="Toyota">Toyota</option>
                <option value="Nissan">Nissan</option>
                <option value="Hyundai">Hyundai</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                CSV Dosyası
              </label>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2.5 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
              />
              {file && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {file.name} · {(file.size / 1024).toFixed(1)} KB
                </p>
              )}
            </div>

            <button
              onClick={handleUpload}
              disabled={!file || loading}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 hover:bg-primary/90 transition-colors"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Yükleniyor…
                </>
              ) : (
                <>
                  <Upload className="size-4" /> İçe Aktar
                </>
              )}
            </button>

            {error && (
              <div className="flex items-start gap-2 px-4 py-3 rounded-2xl bg-destructive/10 text-destructive text-sm ring-1 ring-destructive/20">
                <AlertCircle className="size-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {stats && (
              <div className="px-4 py-4 rounded-2xl bg-success/10 text-success ring-1 ring-success/20">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="size-5" />
                  <p className="font-semibold">Yükleme tamamlandı</p>
                </div>
                <ul className="text-xs grid grid-cols-2 gap-y-1 text-foreground/80">
                  <li>Toplam satır: <strong>{stats.total}</strong></li>
                  <li>Eklenen ilan: <strong>{stats.inserted}</strong></li>
                  <li>Atlanan: <strong>{stats.skipped}</strong></li>
                  <li>Yeni model: <strong>{stats.modelsCreated}</strong></li>
                  <li>Yeni varyant: <strong>{stats.variantsCreated}</strong></li>
                </ul>
              </div>
            )}
          </div>

          <div className="mt-8 pt-6 border-t border-foreground/10">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Beklenen sütunlar
            </p>
            <p className="text-xs text-muted-foreground">
              Resim · Seri · Model · İlan Başlığı · Yıl · KM · Renk · Fiyat · İlan Tarihi · İl / İlçe · İlan Linki
            </p>
            <p className="text-[11px] text-muted-foreground mt-2">
              Ayraç: <code className="px-1.5 py-0.5 rounded bg-secondary">;</code> · Encoding: UTF-8
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
