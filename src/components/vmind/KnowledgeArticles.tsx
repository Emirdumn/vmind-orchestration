import { BookOpen, CheckCircle2, Ticket as TicketIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { KnowledgeArticle } from "@/lib/vmind/types";

interface KnowledgeArticlesProps {
  articles: KnowledgeArticle[];
}

export function KnowledgeArticles({ articles }: KnowledgeArticlesProps) {
  if (articles.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <BookOpen className="h-3 w-3" /> Problem KB makaleleri
      </p>
      <div className="grid gap-2 lg:grid-cols-2">
        {articles.map((article) => (
          <div key={article.id} className="rounded-md border border-border bg-surface-soft p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-[11px] text-primary">{article.id}</p>
                <p className="truncate text-sm text-foreground/90" title={article.title}>
                  {article.title}
                </p>
              </div>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                %{Math.round(article.relevance * 100)} eslesme
              </span>
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="h-4 rounded-sm px-1 text-[10px]">
                {article.category}
              </Badge>
              <Badge variant="outline" className="h-4 rounded-sm px-1 text-[10px]">
                {article.owner}
              </Badge>
              <Badge variant="outline" className="h-4 rounded-sm px-1 font-mono text-[10px]">
                {article.lastVerified}
              </Badge>
            </div>

            <p className="mt-2 text-[12px] leading-snug text-foreground/80">{article.problem}</p>
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{article.rootCause}</p>

            <div className="mt-2 flex items-start gap-1.5 text-[12px] leading-snug text-success">
              <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{article.verification}</span>
            </div>

            {article.sourceTicketIds.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {article.sourceTicketIds.map((ticketId) => (
                  <Badge key={ticketId} variant="outline" className="h-4 rounded-sm px-1 text-[10px]">
                    <TicketIcon className="mr-1 h-2.5 w-2.5" />
                    {ticketId} sinyal
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
