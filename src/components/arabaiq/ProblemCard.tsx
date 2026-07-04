import { CommonProblem } from "@/data/cars";
import { cn } from "@/lib/utils";
import { Cog, Zap, Settings2, CarFront, Sofa, Gauge } from "lucide-react";

interface ProblemCardProps {
  problem: CommonProblem;
}

const categoryIcon = {
  engine: Cog,
  transmission: Settings2,
  electrical: Zap,
  suspension: Gauge,
  body: CarFront,
  interior: Sofa,
};

const severityConfig = {
  low: { label: "Düşük Risk", bg: "bg-success-soft", text: "text-success", ring: "ring-success/20" },
  medium: { label: "Orta Risk", bg: "bg-warning-soft", text: "text-warning", ring: "ring-warning/20" },
  high: { label: "Kritik", bg: "bg-destructive-soft", text: "text-destructive", ring: "ring-destructive/20" },
};

export function ProblemCard({ problem }: ProblemCardProps) {
  const Icon = categoryIcon[problem.category];
  const sev = severityConfig[problem.severity];

  return (
    <div className="group p-5 rounded-2xl bg-surface-soft hover:bg-card hover:shadow-soft transition-all ring-1 ring-transparent hover:ring-foreground/5">
      <div className="flex items-start gap-4">
        <div className={cn("size-10 rounded-xl flex items-center justify-center shrink-0 ring-1", sev.bg, sev.ring)}>
          <Icon className={cn("size-5", sev.text)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 mb-1.5">
            <h4 className="text-sm font-semibold text-foreground">{problem.title}</h4>
            <span className={cn("px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider whitespace-nowrap", sev.bg, sev.text)}>
              {sev.label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{problem.description}</p>
          <div className="mt-3 pt-3 border-t border-border/60 flex justify-between items-center text-[11px] font-mono">
            <div className="flex gap-4 text-muted-foreground">
              <span>~{problem.triggerKm.toLocaleString("tr-TR")} km</span>
              <span>%{problem.reportedFrequency} bildirim</span>
            </div>
            <span className="font-semibold text-foreground tabular-nums">
              {problem.repairCostMin.toLocaleString("tr-TR")} - {problem.repairCostMax.toLocaleString("tr-TR")} ₺
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
