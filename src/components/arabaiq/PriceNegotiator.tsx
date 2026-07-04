import { CarModel, calculateMarketPrice, formatTL } from "@/data/cars";
import { useState } from "react";
import { Slider } from "@/components/ui/slider";

interface PriceNegotiatorProps {
  car: CarModel;
  year: number;
  km: number;
  askingPrice: number;
  onChange: (value: number) => void;
}

export function PriceNegotiator({ car, year, km, askingPrice, onChange }: PriceNegotiatorProps) {
  const market = calculateMarketPrice(car, year, km);
  const min = Math.round(market * 0.7);
  const max = Math.round(market * 1.3);

  const delta = ((askingPrice - market) / market) * 100;

  return (
    <div className="bg-card rounded-3xl p-6 ring-1 ring-foreground/5 shadow-soft">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Pazarlık Simülatörü</h3>
          <p className="text-xs text-muted-foreground mt-1">Fiyat değişimini analiz edin</p>
        </div>
        <div className="text-right">
          <div className="font-mono text-2xl font-semibold tabular-nums">{formatTL(askingPrice)}</div>
          <div className={`text-[11px] font-semibold ${delta < 0 ? "text-success" : delta > 5 ? "text-destructive" : "text-brand"}`}>
            {delta > 0 ? "+" : ""}{delta.toFixed(1)}% piyasaya göre
          </div>
        </div>
      </div>
      <Slider
        value={[askingPrice]}
        min={min}
        max={max}
        step={5000}
        onValueChange={(v) => onChange(v[0])}
        className="my-4"
      />
      <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
        <span>{formatTL(min)}</span>
        <span>Piyasa: {formatTL(market)}</span>
        <span>{formatTL(max)}</span>
      </div>
    </div>
  );
}
