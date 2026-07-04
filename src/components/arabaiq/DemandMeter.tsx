import { CarModel } from "@/data/cars";
import { TrendingUp } from "lucide-react";

interface DemandMeterProps {
  car: CarModel;
}

const demandConfig = {
  fast: { label: "Yüksek Likidite", bars: 5, color: "bg-brand" },
  moderate: { label: "Orta Talep", bars: 3, color: "bg-warning" },
  slow: { label: "Düşük Talep", bars: 2, color: "bg-muted-foreground" },
};

export function DemandMeter({ car }: DemandMeterProps) {
  const cfg = demandConfig[car.demand];

  return (
    <div className="bg-primary text-primary-foreground rounded-3xl p-6 shadow-soft">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xs font-semibold text-primary-foreground/40 uppercase tracking-widest">Talep Endeksi</h3>
        <TrendingUp className="size-4 text-brand" />
      </div>

      <div className="flex items-end gap-1.5 h-16 mb-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`flex-1 rounded-sm transition-all duration-700 ${
              i <= cfg.bars ? cfg.color : "bg-primary-foreground/10"
            }`}
            style={{ height: `${30 + i * 14}%` }}
          />
        ))}
      </div>

      <div className="flex items-baseline justify-between mb-3">
        <span className="text-3xl font-light font-mono tabular-nums">{car.averageDaysOnMarket}</span>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-brand">{cfg.label}</span>
      </div>
      <p className="text-xs text-primary-foreground/50 leading-relaxed">
        İlanlar ortalama <span className="text-primary-foreground font-semibold">{car.averageDaysOnMarket} gün</span> içinde kapanıyor. Mevcut fiyat bandında alıcı bulma ihtimali yüksek.
      </p>
    </div>
  );
}
