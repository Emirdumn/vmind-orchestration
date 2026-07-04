import { useEffect, useRef, useState } from "react";
import { CornerDownLeft, Sparkles, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AnswerPanel } from "./AnswerPanel";
import { SimilarTickets } from "./SimilarTickets";
import { DraftActionCard } from "./DraftActionCard";
import { getTicketsByIds } from "@/data/vmind/tickets";
import { suggestedQuestions } from "@/data/vmind/scenarios";
import type { ChatMessage } from "@/lib/vmind/types";

interface ChatWorkbenchProps {
  messages: ChatMessage[];
  onAsk: (question: string) => void;
}

export function ChatWorkbench({ messages, onAsk }: ChatWorkbenchProps) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  const submit = () => {
    const question = input.trim();
    if (!question) return;
    setInput("");
    onAsk(question);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {messages.length === 0 && (
          <div className="rounded-md border border-border bg-surface-soft p-4">
            <p className="text-sm text-foreground/90">
              Operasyonel bir soru sorun. Cevaplar SMAX, vRPMind, PortvMind, Logo ve runbook
              kaynaklarina dayanir; kaynak yoksa tahmin uretilmez.
            </p>
            <p className="mb-1.5 mt-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Ornek senaryolar
            </p>
            <div className="flex flex-col items-start gap-1">
              {suggestedQuestions.map((sq) => (
                <button
                  key={sq.question}
                  onClick={() => onAsk(sq.question)}
                  className="group flex items-baseline gap-2 rounded px-1 py-0.5 text-left text-[13px] text-foreground/80 hover:text-primary"
                >
                  <span className="w-16 shrink-0 font-mono text-[10px] uppercase text-muted-foreground group-hover:text-primary/70">
                    {sq.persona}
                  </span>
                  {sq.question}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) =>
          message.author === "user" ? (
            <div key={message.id} className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-secondary">
                <User className="h-3 w-3 text-muted-foreground" />
              </span>
              <p className="text-sm font-medium text-foreground">{message.text}</p>
            </div>
          ) : (
            <div key={message.id} className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-brand-soft">
                <Sparkles className="h-3 w-3 text-primary" />
              </span>
              <div className="min-w-0 flex-1 space-y-3">
                {message.answer && (
                  <>
                    <AnswerPanel answer={message.answer} />
                    <SimilarTickets tickets={getTicketsByIds(message.answer.ticketIds)} />
                    {message.answer.draftAction && <DraftActionCard draft={message.answer.draftAction} />}
                  </>
                )}
              </div>
            </div>
          ),
        )}
        <div ref={bottomRef} />
      </div>

      <div className="mt-3 flex items-end gap-2 border-t border-border pt-3">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Operasyonel sorunuzu yazin... (Enter ile gonder)"
          className="min-h-[44px] max-h-32 resize-none rounded-md bg-surface-soft text-sm"
          rows={1}
        />
        <Button onClick={submit} size="sm" className="h-[44px] shrink-0 px-3" disabled={!input.trim()}>
          <CornerDownLeft className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
