import { CheckCircle2, XCircle } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { outOfScope, roadmapWeeks, successMetrics } from "@/data/vmind/roadmap";

export function RoadmapTab() {
  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-semibold text-foreground">30 gunluk MVP hedefi</h2>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
          Network ekibi ve stajyer kullanicilar, Problem KB + runbook + vRPMind/PortvMind
          dokumanlari uzerinden kaynakli cevap alir; SMAX yalnizca tekrar eden problem
          sinyallerini ve KB backlog onceligini besler. Bot kaynak yoksa cozum uretmez,
          gerekiyorsa KB maddesi taslagi ve insan devri uretir.
        </p>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {roadmapWeeks.map((week) => (
          <div key={week.week} className="rounded-md border border-border bg-surface-soft p-3">
            <p className="font-mono text-[11px] uppercase tracking-wider text-primary">{week.week}</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">{week.title}</p>
            <ul className="mt-2 space-y-1">
              {week.items.map((item) => (
                <li key={item} className="flex items-start gap-1.5 text-[12px] leading-snug text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success/70" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section>
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Basari metrikleri
          </h3>
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="text-[12px]">
                  <TableHead className="h-8">Metrik</TableHead>
                  <TableHead className="h-8 text-right">Hedef</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {successMetrics.map((m) => (
                  <TableRow key={m.metric} className="text-[13px]">
                    <TableCell className="py-1.5">{m.metric}</TableCell>
                    <TableCell className="py-1.5 text-right font-mono text-primary">{m.target}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Kapsam disi
          </h3>
          <ul className="space-y-1.5 rounded-md border border-border bg-surface-soft p-3">
            {outOfScope.map((item) => (
              <li key={item} className="flex items-start gap-1.5 text-[13px] leading-snug text-muted-foreground">
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive/70" />
                {item}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
