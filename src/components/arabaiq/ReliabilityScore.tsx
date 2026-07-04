import { CarModel } from "@/data/cars";

interface ReliabilityScoreProps {
  car: CarModel;
}

const labels: Record<keyof CarModel["reliabilityBreakdown"], string> = {
  engine: "Motor & Aktarma",
  electronics: "Elektronik",
  transmission: "Şanzıman",
  interior: "İç Donanım",
};

export function ReliabilityScore({ car }: ReliabilityScoreProps) {
  const score = car.reliabilityScore;
  // SVG circle config
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const scoreColor = score >= 85 ? "hsl(var(--success))" : score >= 70 ? "hsl(var(--brand))" : "hsl(var(--warning))";

  return (
    <div className="bg-card rounded-3xl p-8 ring-1 ring-foreground/5 shadow-soft">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Güven Endeksi</h3>
          <p className="text-2xl font-semibold mt-1">Mekanik Kondisyon</p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-full text-[10px] font-semibold uppercase tracking-wider">
          <span className="size-1.5 rounded-full bg-brand animate-pulse" />
          Grup Doğrulanmış
        </div>
      </div>

      <div className="flex gap-8 items-center">
        <div className="relative size-32 flex items-center justify-center shrink-0">
          <svg className="size-32 -rotate-90" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r={radius} fill="none" stroke="hsl(var(--secondary))" strokeWidth="8" />
            <circle
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              stroke={scoreColor}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className="transition-all duration-1000 ease-out"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-4xl font-light font-mono tabular-nums">{score}</span>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">/ 100</span>
          </div>
        </div>

        <div className="flex-1 space-y-3.5">
          {(Object.keys(car.reliabilityBreakdown) as Array<keyof typeof car.reliabilityBreakdown>).map((key) => {
            const value = car.reliabilityBreakdown[key];
            return (
              <div key={key}>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-muted-foreground">{labels[key]}</span>
                  <span className="font-medium font-mono tabular-nums">%{value}</span>
                </div>
                <div className="h-1 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-1000"
                    style={{ width: `${value}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
