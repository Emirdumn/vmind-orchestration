import { AlertTriangle, CheckCircle2, DatabaseZap, LockKeyhole, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  averageReadiness,
  connectorProfiles,
  connectorStageLabels,
  countProfilesByStage,
} from "@/data/vmind/connectors";
import { dataSources } from "@/data/vmind/sources";
import { cn } from "@/lib/utils";
import type { ConnectorProfile, ConnectorRisk, ConnectorStage, DataClass } from "@/lib/vmind/types";

const riskStyles: Record<ConnectorRisk, string> = {
  low: "border-success/50 text-success",
  medium: "border-warning/50 text-warning",
  high: "border-warning/70 text-warning",
  critical: "border-destructive/70 text-destructive",
};

const stageStyles: Record<ConnectorStage, string> = {
  mock: "border-border text-muted-foreground",
  export_ready: "border-primary/50 text-primary",
  read_only_ready: "border-success/50 text-success",
  approval_required: "border-warning/60 text-warning",
  blocked: "border-destructive/70 text-destructive",
};

const dataClassLabels: Record<DataClass, string> = {
  public: "Public",
  internal: "Internal",
  confidential: "Confidential",
  pii: "PII",
  financial: "Financial",
  secret: "Secret",
};

function sourceName(id: ConnectorProfile["id"]) {
  return dataSources.find((source) => source.id === id)?.name ?? id;
}

function readinessTone(readiness: number) {
  if (readiness >= 80) return "text-success";
  if (readiness >= 60) return "text-warning";
  return "text-destructive";
}

export function ConnectorReadinessTab() {
  const stageCounts = countProfilesByStage();
  const avg = averageReadiness();
  const blockers = connectorProfiles.reduce((sum, profile) => sum + profile.blockers.length, 0);

  return (
    <div className="space-y-5">
      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-md border border-border bg-surface-soft p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <DatabaseZap className="h-3 w-3" /> Connector readiness
          </p>
          <div className="mt-2 flex items-end justify-between gap-3">
            <span className={cn("font-mono text-3xl font-semibold", readinessTone(avg))}>{avg}%</span>
            <span className="pb-1 text-[12px] text-muted-foreground">ortalama hazirlik</span>
          </div>
          <Progress value={avg} className="mt-2 h-1.5" />
        </div>

        <div className="rounded-md border border-border bg-surface-soft p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <ShieldAlert className="h-3 w-3" /> Risk kapilari
          </p>
          <div className="mt-2 flex items-end justify-between gap-3">
            <span className="font-mono text-3xl font-semibold text-warning">{blockers}</span>
            <span className="pb-1 text-[12px] text-muted-foreground">acik blokaj</span>
          </div>
          <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
            Blokajlar cozulmeden write action, finansal veri ve PII canli sisteme acilmamalidir.
          </p>
        </div>

        <div className="rounded-md border border-border bg-surface-soft p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <CheckCircle2 className="h-3 w-3" /> Asama dagilimi
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(Object.keys(stageCounts) as ConnectorStage[]).map((stage) => (
              <Badge key={stage} variant="outline" className={cn("h-5 rounded-sm px-1.5 text-[10px]", stageStyles[stage])}>
                {connectorStageLabels[stage]} · {stageCounts[stage]}
              </Badge>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-3 xl:grid-cols-2">
        {connectorProfiles.map((profile) => (
          <article key={profile.id} className="rounded-md border border-border bg-surface-soft p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-foreground">{sourceName(profile.id)}</h2>
                <p className="mt-0.5 text-[12px] text-muted-foreground">{profile.owner}</p>
              </div>
              <div className="flex flex-wrap justify-end gap-1.5">
                <Badge variant="outline" className={cn("h-5 rounded-sm px-1.5 text-[10px]", stageStyles[profile.stage])}>
                  {connectorStageLabels[profile.stage]}
                </Badge>
                <Badge variant="outline" className={cn("h-5 rounded-sm px-1.5 text-[10px] uppercase", riskStyles[profile.risk])}>
                  {profile.risk}
                </Badge>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_160px]">
              <div className="space-y-2">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Ingestion modu
                  </p>
                  <p className="mt-0.5 text-[13px] leading-snug text-foreground/85">{profile.ingestionMode}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Sonraki adimlar
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {profile.nextActions.map((action) => (
                      <li key={action} className="flex items-start gap-1.5 text-[12px] leading-snug text-muted-foreground">
                        <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success/70" />
                        {action}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="space-y-2 rounded-md border border-border bg-background/30 p-2.5">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">Hazirlik</span>
                    <span className={cn("font-mono text-[12px]", readinessTone(profile.readiness))}>
                      {profile.readiness}%
                    </span>
                  </div>
                  <Progress value={profile.readiness} className="mt-1 h-1.5" />
                </div>
                <div className="flex flex-wrap gap-1">
                  {profile.dataClasses.map((dataClass) => (
                    <Badge key={dataClass} variant="outline" className="h-5 rounded-sm px-1.5 text-[10px]">
                      {dataClassLabels[dataClass]}
                    </Badge>
                  ))}
                </div>
                <p className="flex items-center gap-1.5 text-[11px] leading-snug text-muted-foreground">
                  <LockKeyhole className="h-3 w-3 shrink-0" />
                  {profile.allowedActions.map((mode) => (mode === "read_only" ? "Read-only" : "Taslak")).join(" + ")}
                </p>
                <p className="text-[11px] leading-snug text-muted-foreground">{profile.refreshCadence}</p>
              </div>
            </div>

            {profile.blockers.length > 0 && (
              <div className="mt-3 rounded-md border border-warning/30 bg-warning-soft/20 p-2">
                <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-warning">
                  <AlertTriangle className="h-3 w-3" /> Blokaj
                </p>
                <ul className="mt-1 space-y-0.5">
                  {profile.blockers.map((blocker) => (
                    <li key={blocker} className="text-[12px] leading-snug text-foreground/80">
                      {blocker}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
