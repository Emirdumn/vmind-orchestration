import { useState } from "react";
import { Boxes } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SourceNav } from "@/components/vmind/SourceNav";
import { ChatWorkbench } from "@/components/vmind/ChatWorkbench";
import { SafetyPanel } from "@/components/vmind/SafetyPanel";
import { RoadmapTab } from "@/components/vmind/RoadmapTab";
import { EvalTab } from "@/components/vmind/EvalTab";
import { ConnectorReadinessTab } from "@/components/vmind/ConnectorReadinessTab";
import { corpus } from "@/data/vmind/corpus";
import { roleLabels } from "@/data/vmind/scenarios";
import { retrieve } from "@/lib/vmind/retrieval";
import type { AgentAnswer, ChatMessage, Role, SourceSystem } from "@/lib/vmind/types";

let messageCounter = 0;
const nextId = () => `msg-${++messageCounter}`;

export default function OperationsHub() {
  const [role, setRole] = useState<Role>("network");
  const [scope, setScope] = useState<SourceSystem | "all">("all");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [auditLog, setAuditLog] = useState<string[]>([]);

  const lastAnswer: AgentAnswer | undefined = [...messages]
    .reverse()
    .find((m) => m.author === "assistant")?.answer;

  const handleAsk = (question: string) => {
    const answer = retrieve(question, { role, scope, corpus });
    const timestamp = new Date().toISOString();
    setMessages((prev) => [
      ...prev,
      { id: nextId(), author: "user", text: question, timestamp },
      { id: nextId(), author: "assistant", answer, timestamp },
    ]);
    setAuditLog((prev) => [...prev, answer.auditLine]);
  };

  return (
    <div className="flex h-screen min-w-0 flex-col bg-background">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2.5 sm:px-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-soft">
            <Boxes className="h-4 w-4 text-primary" />
          </span>
          <div>
            <h1 className="text-sm font-semibold leading-tight text-foreground">
              VMind Agentic Operations Hub
            </h1>
            <p className="text-[11px] leading-tight text-muted-foreground">
              Kaynakli cevap · read-only sorgu · taslak aksiyon · insan devri
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Rol</span>
          <Select value={role} onValueChange={(v) => setRole(v as Role)}>
            <SelectTrigger className="h-8 w-36 rounded-md bg-surface-soft text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(roleLabels) as Role[]).map((r) => (
                <SelectItem key={r} value={r} className="text-xs">
                  {roleLabels[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <Tabs defaultValue="workbench" className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 overflow-x-auto border-b border-border px-3 sm:px-4">
          <TabsList className="h-9 min-w-max rounded-none bg-transparent p-0">
            <TabsTrigger
              value="workbench"
              className="rounded-none border-b-2 border-transparent px-3 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent"
            >
              Calisma Alani
            </TabsTrigger>
            <TabsTrigger
              value="roadmap"
              className="rounded-none border-b-2 border-transparent px-3 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent"
            >
              MVP Yol Haritasi
            </TabsTrigger>
            <TabsTrigger
              value="connectors"
              className="rounded-none border-b-2 border-transparent px-3 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent"
            >
              Connectorlar
            </TabsTrigger>
            <TabsTrigger
              value="eval"
              className="rounded-none border-b-2 border-transparent px-3 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent"
            >
              Kurallar & Eval
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="workbench" className="mt-0 min-h-0 flex-1 focus-visible:outline-none">
          <div className="grid h-full min-h-0 grid-cols-1 gap-0 overflow-y-auto lg:grid-cols-12 lg:overflow-hidden">
            <div className="min-h-0 border-b border-border p-3 lg:col-span-3 lg:overflow-y-auto lg:border-b-0 lg:border-r xl:col-span-2">
              <SourceNav scope={scope} onScopeChange={setScope} />
            </div>
            <div className="flex min-h-[520px] flex-col p-3 sm:p-4 lg:col-span-6 lg:min-h-0 xl:col-span-7">
              <ChatWorkbench messages={messages} onAsk={handleAsk} />
            </div>
            <div className="min-h-0 border-t border-border p-3 lg:col-span-3 lg:overflow-y-auto lg:border-l lg:border-t-0">
              <SafetyPanel role={role} lastAnswer={lastAnswer} auditLog={auditLog} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="roadmap" className="mt-0 min-h-0 flex-1 overflow-y-auto p-4 focus-visible:outline-none">
          <RoadmapTab />
        </TabsContent>

        <TabsContent value="connectors" className="mt-0 min-h-0 flex-1 overflow-y-auto p-4 focus-visible:outline-none">
          <ConnectorReadinessTab />
        </TabsContent>

        <TabsContent value="eval" className="mt-0 min-h-0 flex-1 overflow-y-auto p-4 focus-visible:outline-none">
          <EvalTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
