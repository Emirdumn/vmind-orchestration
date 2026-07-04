import { Database, FileText, Layers, Network, Ticket, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { dataSources } from "@/data/vmind/sources";
import type { SourceSystem } from "@/lib/vmind/types";

const sourceIcons: Record<SourceSystem, typeof Database> = {
  smax: Ticket,
  vrpmind: Layers,
  portvmind: Network,
  logo: Wallet,
  runbooks: FileText,
};

interface SourceNavProps {
  scope: SourceSystem | "all";
  onScopeChange: (scope: SourceSystem | "all") => void;
}

export function SourceNav({ scope, onScopeChange }: SourceNavProps) {
  return (
    <nav className="flex flex-col gap-1">
      <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Veri kaynaklari
      </p>
      <button
        onClick={() => onScopeChange("all")}
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
          scope === "all"
            ? "bg-secondary text-foreground"
            : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
        )}
      >
        <Database className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">Tum kaynaklar</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {dataSources.reduce((sum, s) => sum + s.docCount, 0)}
        </span>
      </button>
      {dataSources.map((source) => {
        const Icon = sourceIcons[source.id];
        const active = scope === source.id;
        return (
          <button
            key={source.id}
            onClick={() => onScopeChange(source.id)}
            className={cn(
              "flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-left",
              active
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            <span className="flex items-center gap-2 text-sm">
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">{source.name}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{source.docCount}</span>
            </span>
            <span className="pl-[22px] text-[11px] leading-tight text-muted-foreground">
              {source.mvpMode}
            </span>
          </button>
        );
      })}
      <p className="mt-3 border-t border-border px-2 pt-2 text-[11px] leading-snug text-muted-foreground">
        Tum kaynaklar mock modda. Gercek connector eklenince ayni sozlesme ile degistirilecek.
      </p>
    </nav>
  );
}
