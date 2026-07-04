import { Alternative, CarModel, formatTL, calculateMarketPrice } from "@/data/cars";
import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";

interface ComparisonTableProps {
  car: CarModel;
  year: number;
  km: number;
}

const tagConfig = {
  economy: { label: "Daha Ekonomik", color: "text-success" },
  performance: { label: "Performans Odaklı", color: "text-brand" },
  similar: { label: "Benzer Seçenek", color: "text-muted-foreground" },
};

export function ComparisonTable({ car, year, km }: ComparisonTableProps) {
  const selfPrice = calculateMarketPrice(car, year, km);
  const items: (Alternative & { isSelf?: boolean })[] = [
    {
      name: `${car.brand} ${car.model}`,
      trim: "Seçili Araç",
      year,
      marketPrice: selfPrice,
      reliabilityScore: car.reliabilityScore,
      tag: "similar",
      isSelf: true,
    },
    ...car.alternatives,
  ];

  return (
    <div className="bg-card rounded-3xl p-8 ring-1 ring-foreground/5 shadow-soft">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Alternatif Rotalar</h3>
          <p className="text-xl font-semibold mt-1">Segment Karşılaştırması</p>
        </div>
        <button className="hidden md:flex items-center gap-1.5 text-xs font-semibold text-brand hover:gap-2.5 transition-all">
          Tüm karşılaştırma
          <ArrowRight className="size-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {items.map((item, i) => {
          const cfg = item.isSelf ? { label: "Seçili Araç", color: "text-brand" } : tagConfig[item.tag];
          const delta = item.isSelf ? 0 : Math.round(((item.marketPrice - selfPrice) / selfPrice) * 1000) / 10;
          return (
            <div
              key={i}
              className={cn(
                "p-5 rounded-2xl transition-all",
                item.isSelf
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-soft hover:bg-card hover:shadow-soft ring-1 ring-transparent hover:ring-foreground/5"
              )}
            >
              <span className={cn("text-[10px] font-bold uppercase tracking-wider mb-3 block", item.isSelf ? "text-brand" : cfg.color)}>
                {cfg.label}
              </span>
              <h4 className={cn("font-semibold text-sm leading-tight mb-1", item.isSelf ? "text-primary-foreground" : "text-foreground")}>
                {item.name}
              </h4>
              <p className={cn("text-xs mb-4", item.isSelf ? "text-primary-foreground/50" : "text-muted-foreground")}>
                {item.trim} • {item.year}
              </p>
              <div className={cn("pt-4 border-t", item.isSelf ? "border-primary-foreground/10" : "border-border")}>
                <div className="font-mono text-base font-semibold tabular-nums">{formatTL(item.marketPrice)}</div>
                <div className="flex items-center justify-between mt-2 text-[10px] font-semibold uppercase tracking-wider">
                  <span className={item.isSelf ? "text-primary-foreground/40" : "text-muted-foreground"}>
                    Güven {item.reliabilityScore}
                  </span>
                  {!item.isSelf && (
                    <span className={delta < 0 ? "text-success" : "text-destructive"}>
                      {delta > 0 ? "+" : ""}{delta}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
