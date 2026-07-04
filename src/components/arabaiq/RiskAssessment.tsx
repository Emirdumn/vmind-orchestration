import { CarModel, calculateMarketPrice } from "@/data/cars";
import { AlertTriangle, ShieldCheck } from "lucide-react";

interface RiskAssessmentProps {
  car: CarModel;
  km: number;
}

export function RiskAssessment({ car, km }: RiskAssessmentProps) {
  // Risks that will trigger within next 12k km
  const upcomingRisks = car.commonProblems
    .filter((p) => p.triggerKm > km && p.triggerKm <= km + 25000)
    .sort((a, b) => b.reportedFrequency - a.reportedFrequency);

  const passedRisks = car.commonProblems.filter((p) => p.triggerKm <= km);

  return (
    <div className="bg-card rounded-3xl p-8 ring-1 ring-foreground/5 shadow-soft">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Riskler & Kronik Sorunlar</h3>
          <p className="text-xl font-semibold mt-1">Önümüzdeki 12 Ay</p>
        </div>
        <AlertTriangle className="size-5 text-warning" />
      </div>

      {upcomingRisks.length === 0 ? (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-success-soft">
          <ShieldCheck className="size-5 text-success shrink-0" />
          <p className="text-sm text-foreground">Belirtilen kilometre aralığında yakın vadeli kritik risk öngörülmüyor.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {upcomingRisks.map((risk, i) => (
            <div key={i} className="flex items-start gap-3 p-4 rounded-2xl bg-warning-soft">
              <div className="size-8 rounded-lg bg-warning/20 flex items-center justify-center shrink-0">
                <AlertTriangle className="size-4 text-warning" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">{risk.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  ~{risk.triggerKm.toLocaleString("tr-TR")} km'de tetiklenir • Tahmini {risk.repairCostMin.toLocaleString("tr-TR")} ₺
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {passedRisks.length > 0 && (
        <p className="mt-4 text-[11px] text-muted-foreground">
          <span className="font-semibold text-foreground">{passedRisks.length}</span> sorun kategorisi mevcut kilometrede zaten kontrol edilmeli.
        </p>
      )}
    </div>
  );
}
