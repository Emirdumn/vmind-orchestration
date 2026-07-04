import { CatalogVariant } from "@/data/catalog";
import { Fuel, Gauge, Cog, Briefcase, Zap, Settings2 } from "lucide-react";

interface SpecsCardProps {
  variant: CatalogVariant;
  segment: string;
  bodyType: string;
}

export function SpecsCard({ variant, segment, bodyType }: SpecsCardProps) {
  const items = [
    { icon: Zap, label: "Motor Gücü", value: `${variant.hp} HP` },
    { icon: Cog, label: "Motor Hacmi", value: `${variant.cc} cc` },
    { icon: Fuel, label: "Yakıt", value: variant.fuel },
    { icon: Settings2, label: "Şanzıman", value: variant.transmission },
    { icon: Gauge, label: "Tüketim", value: `${variant.consumption_l100} L/100km` },
    { icon: Briefcase, label: "Bagaj", value: `${variant.luggage_l} L` },
  ];

  return (
    <div className="bg-card rounded-3xl p-8 ring-1 ring-foreground/5 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
            Teknik Özellikler
          </h3>
          <p className="text-xl font-semibold mt-1">{variant.trim}</p>
        </div>
        <div className="flex gap-2">
          <span className="px-3 py-1 rounded-full bg-secondary text-[11px] font-semibold text-foreground">
            {segment}
          </span>
          <span className="px-3 py-1 rounded-full bg-secondary text-[11px] font-semibold text-foreground">
            {bodyType}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {items.map(({ icon: Icon, label, value }) => (
          <div
            key={label}
            className="flex items-center gap-3 p-3.5 rounded-2xl bg-secondary/60 ring-1 ring-foreground/5"
          >
            <div className="size-9 rounded-xl bg-card flex items-center justify-center shrink-0 shadow-soft">
              <Icon className="size-4 text-brand" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">
                {label}
              </div>
              <div className="text-sm font-semibold text-foreground truncate">{value}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
