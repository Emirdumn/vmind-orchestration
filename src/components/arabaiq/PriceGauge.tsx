import { Verdict, formatTL } from "@/data/cars";
import { cn } from "@/lib/utils";

interface PriceGaugeProps {
  marketPrice: number;
  askingPrice: number;
  verdict: Verdict;
  deltaPercent: number;
}

const verdictConfig: Record<Verdict, { label: string; tagBg: string; tagText: string; needleColor: string }> = {
  "great-deal": { label: "Harika Fırsat", tagBg: "bg-success-soft", tagText: "text-success", needleColor: "bg-success" },
  "good-deal": { label: "İyi Fırsat", tagBg: "bg-success-soft", tagText: "text-success", needleColor: "bg-success" },
  "fair": { label: "Makul Değer", tagBg: "bg-brand-soft", tagText: "text-brand", needleColor: "bg-brand" },
  "overpriced": { label: "Fiyatı Yüksek", tagBg: "bg-warning-soft", tagText: "text-warning", needleColor: "bg-warning" },
  "very-overpriced": { label: "Aşırı Fiyatlı", tagBg: "bg-destructive-soft", tagText: "text-destructive", needleColor: "bg-destructive" },
};

export function PriceGauge({ marketPrice, askingPrice, verdict, deltaPercent }: PriceGaugeProps) {
  const cfg = verdictConfig[verdict];
  // Map delta -20..+20 to -90..+90 deg
  const clamped = Math.max(-20, Math.min(20, deltaPercent));
  const angle = (clamped / 20) * 90;

  return (
    <div className="bg-card rounded-3xl p-8 ring-1 ring-foreground/5 shadow-soft">
      <div className="flex justify-between items-start mb-8">
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Fiyat Analizi</h3>
          <p className="text-2xl font-semibold mt-1">{cfg.label}</p>
        </div>
        <div className={cn("px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider", cfg.tagBg, cfg.tagText)}>
          {deltaPercent > 0 ? "+" : ""}{deltaPercent}%
        </div>
      </div>

      <div className="relative flex flex-col items-center">
        <div className="relative w-64 h-32 overflow-hidden">
          {/* Track */}
          <div className="absolute inset-0 rounded-t-full border-[14px] border-b-0 border-secondary" />
          {/* Color zones using conic-gradient masked to arc */}
          <div
            className="absolute inset-0 rounded-t-full opacity-30"
            style={{
              background: "conic-gradient(from 270deg at 50% 100%, hsl(var(--success)) 0deg, hsl(var(--brand)) 60deg, hsl(var(--warning)) 120deg, hsl(var(--destructive)) 180deg)",
              WebkitMaskImage: "radial-gradient(circle at 50% 100%, transparent 56%, black 57%, black 76%, transparent 77%)",
              maskImage: "radial-gradient(circle at 50% 100%, transparent 56%, black 57%, black 76%, transparent 77%)",
            }}
          />
          {/* Needle */}
          <div
            className="absolute bottom-0 left-1/2 origin-bottom transition-transform duration-1000 ease-out"
            style={{ transform: `translateX(-50%) rotate(${angle}deg)`, height: "108px", width: "3px" }}
          >
            <div className={cn("w-full h-full rounded-full", cfg.needleColor)} />
          </div>
          <div className={cn("absolute bottom-0 left-1/2 -translate-x-1/2 size-4 rounded-full ring-4 ring-background", cfg.needleColor)} />
        </div>
        <div className="flex justify-between w-full mt-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          <span>Düşük</span>
          <span>Piyasa</span>
          <span>Yüksek</span>
        </div>
      </div>

      <div className="mt-8 pt-6 border-t border-border space-y-3">
        <div className="flex justify-between items-center text-sm">
          <span className="text-muted-foreground">Piyasa Ortalaması</span>
          <span className="font-mono font-semibold tabular-nums">{formatTL(marketPrice)}</span>
        </div>
        <div className="flex justify-between items-center text-sm">
          <span className="text-muted-foreground">İlan Fiyatı</span>
          <span className="font-mono font-semibold tabular-nums">{formatTL(askingPrice)}</span>
        </div>
      </div>
    </div>
  );
}
