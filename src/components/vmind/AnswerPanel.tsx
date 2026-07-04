import { AlertTriangle, BookOpen, ShieldX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AgentAnswer, RefusalReason } from "@/lib/vmind/types";

const refusalLabels: Record<RefusalReason, string> = {
  no_source: "Kaynak yok - cevap uretilmedi",
  permission: "Yetki reddi",
  secret: "Gizli deger talebi reddedildi",
  risky_action: "Riskli islem reddedildi",
};

interface AnswerPanelProps {
  answer: AgentAnswer;
}

export function AnswerPanel({ answer }: AnswerPanelProps) {
  if (answer.kind === "refusal") {
    const Icon = answer.refusalReason === "no_source" ? AlertTriangle : ShieldX;
    return (
      <div className="rounded-md border border-warning/40 bg-warning-soft/30 p-3">
        <div className="mb-1 flex items-center gap-2">
          <Icon className="h-4 w-4 text-warning" />
          <span className="text-xs font-semibold uppercase tracking-wide text-warning">
            {answer.refusalReason ? refusalLabels[answer.refusalReason] : "Sinirli cevap"}
          </span>
        </div>
        <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">{answer.text}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">{answer.text}</p>

      {answer.citations.length > 0 && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <BookOpen className="h-3 w-3" /> Kaynaklar
          </p>
          <div className="flex flex-wrap gap-1.5">
            {answer.citations.map((citation) => (
              <span
                key={citation.sourceUri}
                title={citation.snippet}
                className="inline-flex max-w-full items-center gap-1.5 rounded border border-border bg-surface-soft px-2 py-1 text-[11px] leading-tight"
              >
                <Badge variant="outline" className="h-4 rounded-sm px-1 font-mono text-[10px] uppercase">
                  {citation.sourceSystem}
                </Badge>
                <span className="truncate text-foreground/80">{citation.title}</span>
                <span className="hidden truncate font-mono text-muted-foreground sm:inline">
                  {citation.sourceUri}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">Guven</span>
        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-secondary">
          <div
            className={cn(
              "h-full rounded-full",
              answer.confidence >= 0.8 ? "bg-success" : answer.confidence >= 0.6 ? "bg-warning" : "bg-destructive",
            )}
            style={{ width: `${Math.round(answer.confidence * 100)}%` }}
          />
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">
          {Math.round(answer.confidence * 100)}%
        </span>
      </div>
    </div>
  );
}
