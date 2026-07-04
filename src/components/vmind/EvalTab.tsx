import { ListChecks, ShieldAlert, Workflow } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  behaviorSequence,
  evalCases,
  evalDimensions,
  refusalRules,
} from "@/data/vmind/guardrails";

export function EvalTab() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-md border border-border bg-surface-soft p-3">
          <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <Workflow className="h-3 w-3" /> Bot davranis sirasi
          </h3>
          <ol className="mt-2 space-y-1">
            {behaviorSequence.map((step, i) => (
              <li key={step} className="flex items-baseline gap-2 text-[13px] text-foreground/85">
                <span className="font-mono text-[11px] text-primary">{i + 1}.</span>
                {step}
              </li>
            ))}
          </ol>
        </section>

        <section className="rounded-md border border-border bg-surface-soft p-3">
          <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <ShieldAlert className="h-3 w-3" /> Red kurallari
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {refusalRules.map((rule) => (
              <li key={rule} className="text-[13px] leading-snug text-foreground/85">
                {rule}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <ListChecks className="h-3 w-3" /> Eval set ornekleri
        </h3>
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow className="text-[12px]">
                <TableHead className="h-8">Soru</TableHead>
                <TableHead className="h-8">Beklenen davranis</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {evalCases.map((c) => (
                <TableRow key={c.question} className="text-[13px]">
                  <TableCell className="py-1.5 font-medium text-foreground/90">"{c.question}"</TableCell>
                  <TableCell className="py-1.5 text-muted-foreground">{c.expected}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Degerlendirme boyutlari
        </h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {evalDimensions.map((d) => (
            <div key={d.key} className="rounded-md border border-border bg-surface-soft p-2.5">
              <p className="font-mono text-[12px] text-primary">{d.key}</p>
              <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{d.description}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
