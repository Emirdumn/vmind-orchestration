import { ClipboardList, PenLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { DraftAction } from "@/lib/vmind/types";

const typeLabels: Record<DraftAction["type"], string> = {
  smax_ticket: "SMAX ticket taslagi",
  vrpmind_task: "vRPMind gorev taslagi",
  checklist: "Kontrol listesi taslagi",
};

interface DraftActionCardProps {
  draft: DraftAction;
}

export function DraftActionCard({ draft }: DraftActionCardProps) {
  return (
    <div className="rounded-md border border-primary/30 bg-brand-soft/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-primary">
          {draft.type === "checklist" ? (
            <ClipboardList className="h-3 w-3" />
          ) : (
            <PenLine className="h-3 w-3" />
          )}
          {typeLabels[draft.type]}
        </p>
        <Badge variant="outline" className="h-4 rounded-sm border-warning/50 px-1 text-[10px] uppercase text-warning">
          Taslak - otomatik gonderilmez
        </Badge>
      </div>
      <p className="mt-1.5 text-sm font-medium text-foreground/90">{draft.title}</p>
      <dl className="mt-2 space-y-1">
        {draft.fields.map((field) => (
          <div key={field.label} className="flex gap-2 text-[12px] leading-snug">
            <dt className="w-28 shrink-0 text-muted-foreground">{field.label}</dt>
            <dd className="text-foreground/85">{field.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11px] text-muted-foreground">{draft.note}</p>
      <div className="mt-2 flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          className="h-7 text-xs"
          onClick={() =>
            toast.info("Onay akisi MVP kapsaminda degil", {
              description: "Taslak kaydedildi; gonderim yetkili onayi gerektirir.",
            })
          }
        >
          Onaya gonder
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-muted-foreground"
          onClick={() => toast("Taslak atlandi")}
        >
          Atla
        </Button>
      </div>
    </div>
  );
}
