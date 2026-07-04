import { Eye, Lock, ScrollText, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { accessibleClasses } from "@/lib/vmind/permissions";
import { roleLabels } from "@/data/vmind/scenarios";
import type { AgentAnswer, DataClass, Role } from "@/lib/vmind/types";

const dataClassLabels: Record<DataClass, string> = {
  public: "Public",
  internal: "Internal",
  confidential: "Confidential",
  pii: "PII",
  financial: "Financial",
  secret: "Secret",
};

const actionModeLabels = {
  read_only: "Read-only",
  draft: "Taslak",
  approved: "Onayli",
} as const;

interface SafetyPanelProps {
  role: Role;
  lastAnswer?: AgentAnswer;
  auditLog: string[];
}

export function SafetyPanel({ role, lastAnswer, auditLog }: SafetyPanelProps) {
  const allowed = accessibleClasses(role);

  return (
    <aside className="flex flex-col gap-4">
      <section>
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <ShieldCheck className="h-3 w-3" /> Yetki durumu
        </p>
        <div className="rounded-md border border-border bg-surface-soft p-2.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Rol</span>
            <span className="font-medium text-foreground/90">{roleLabels[role]}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {(Object.keys(dataClassLabels) as DataClass[]).map((dc) => {
              const ok = allowed.includes(dc);
              return (
                <Badge
                  key={dc}
                  variant="outline"
                  className={cn(
                    "h-5 rounded-sm px-1.5 text-[10px]",
                    ok ? "border-success/50 text-success" : "border-border text-muted-foreground line-through opacity-60",
                  )}
                >
                  {dataClassLabels[dc]}
                </Badge>
              );
            })}
          </div>
        </div>
      </section>

      <section>
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <Eye className="h-3 w-3" /> Son cevap
        </p>
        <div className="rounded-md border border-border bg-surface-soft p-2.5 text-sm">
          {lastAnswer ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Veri sinifi</span>
                <Badge variant="outline" className="h-5 rounded-sm px-1.5 text-[10px]">
                  {dataClassLabels[lastAnswer.dataClass]}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Aksiyon modu</span>
                <Badge
                  variant="outline"
                  className={cn(
                    "h-5 rounded-sm px-1.5 text-[10px]",
                    lastAnswer.actionMode === "draft"
                      ? "border-warning/50 text-warning"
                      : "border-success/50 text-success",
                  )}
                >
                  {actionModeLabels[lastAnswer.actionMode]}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Sonuc</span>
                <span
                  className={cn(
                    "text-[12px] font-medium",
                    lastAnswer.kind === "answer" ? "text-success" : "text-warning",
                  )}
                >
                  {lastAnswer.kind === "answer" ? "Kaynakli cevap" : "Red / sinirli"}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-muted-foreground">Henuz soru sorulmadi.</p>
          )}
        </div>
      </section>

      <section>
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <ScrollText className="h-3 w-3" /> Audit izi
        </p>
        <div className="rounded-md border border-border bg-surface-soft p-2.5">
          {auditLog.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">Kayit yok.</p>
          ) : (
            <ul className="space-y-1">
              {auditLog.slice(-5).map((line, i) => (
                <li key={i} className="break-all font-mono text-[10px] leading-snug text-muted-foreground">
                  {line}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="rounded-md border border-border bg-surface-soft p-2.5">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <Lock className="h-3 w-3" /> Guvenlik varsayilanlari
        </p>
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] leading-snug text-muted-foreground">
          <li>Yazma islemleri her zaman taslak</li>
          <li>Silme / release / odeme / yetki degisikligi kapali</li>
          <li>Kaynak yoksa cevap uretilmez</li>
          <li>Secret degerler bilgi tabanina alinmaz</li>
        </ul>
      </section>
    </aside>
  );
}
