import { Ticket as TicketIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Ticket } from "@/lib/vmind/types";

const priorityStyles: Record<Ticket["priority"], string> = {
  low: "text-muted-foreground border-border",
  medium: "text-warning border-warning/40",
  high: "text-warning border-warning/60",
  critical: "text-destructive border-destructive/60",
};

const statusLabels: Record<Ticket["status"], string> = {
  resolved: "Cozuldu",
  reopened: "Tekrar acildi",
  open: "Acik",
};

interface SimilarTicketsProps {
  tickets: Ticket[];
}

export function SimilarTickets({ tickets }: SimilarTicketsProps) {
  if (tickets.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <TicketIcon className="h-3 w-3" /> Benzer SMAX ticketlari (gecmis kayitlara gore)
      </p>
      <div className="grid gap-2 lg:grid-cols-2">
        {tickets.map((ticket) => (
          <div key={ticket.id} className="rounded-md border border-border bg-surface-soft p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-[11px] text-primary">{ticket.id}</p>
                <p className="truncate text-sm text-foreground/90" title={ticket.title}>
                  {ticket.title}
                </p>
              </div>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                %{Math.round(ticket.similarity * 100)} benzer
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="h-4 rounded-sm px-1 text-[10px]">
                {ticket.category}
              </Badge>
              <Badge
                variant="outline"
                className={cn("h-4 rounded-sm px-1 text-[10px] uppercase", priorityStyles[ticket.priority])}
              >
                {ticket.priority}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  "h-4 rounded-sm px-1 text-[10px]",
                  ticket.status === "resolved" ? "border-success/50 text-success" : "border-warning/50 text-warning",
                )}
              >
                {statusLabels[ticket.status]}
              </Badge>
            </div>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[12px] leading-snug text-muted-foreground">
              {ticket.resolutionSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
