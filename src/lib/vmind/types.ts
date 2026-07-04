export type SourceSystem = "smax" | "vrpmind" | "portvmind" | "logo" | "runbooks";

export type DataClass =
  | "public"
  | "internal"
  | "confidential"
  | "pii"
  | "financial"
  | "secret";

export type Role =
  | "stajyer"
  | "network"
  | "muhasebe"
  | "cloud_ops"
  | "satis_cs"
  | "admin";

export type ActionMode = "read_only" | "draft" | "approved";

export type ActionType =
  | "answer"
  | "read_query"
  | "ticket_draft"
  | "task_draft"
  | "checklist_draft"
  | "delete"
  | "release"
  | "payment"
  | "permission_change"
  | "accounting_entry";

export type DocType =
  | "runbook"
  | "ticket"
  | "policy"
  | "invoice_process"
  | "product_doc"
  | "procedure"
  | "faq";

export interface DataSource {
  id: SourceSystem;
  name: string;
  description: string;
  status: "mock" | "read_only" | "planned";
  docCount: number;
  mvpMode: string;
}

export type ConnectorStage =
  | "mock"
  | "export_ready"
  | "read_only_ready"
  | "approval_required"
  | "blocked";

export type ConnectorRisk = "low" | "medium" | "high" | "critical";

export interface ConnectorProfile {
  id: SourceSystem;
  owner: string;
  stage: ConnectorStage;
  risk: ConnectorRisk;
  dataClasses: DataClass[];
  ingestionMode: string;
  refreshCadence: string;
  readiness: number;
  allowedActions: ActionMode[];
  blockers: string[];
  nextActions: string[];
}

export interface Citation {
  sourceSystem: SourceSystem;
  sourceUri: string;
  title: string;
  docType: DocType;
  snippet: string;
}

export interface Ticket {
  id: string;
  title: string;
  category: string;
  priority: "low" | "medium" | "high" | "critical";
  status: "resolved" | "reopened" | "open";
  resolutionSteps: string[];
  similarity: number;
}

export interface DraftActionField {
  label: string;
  value: string;
}

export interface DraftAction {
  id: string;
  type: "smax_ticket" | "vrpmind_task" | "checklist";
  targetSystem: SourceSystem;
  title: string;
  fields: DraftActionField[];
  note: string;
}

export type RefusalReason = "no_source" | "permission" | "secret" | "risky_action";

export interface AgentAnswer {
  kind: "answer" | "refusal";
  text: string;
  citations: Citation[];
  ticketIds: string[];
  draftAction?: DraftAction;
  confidence: number;
  dataClass: DataClass;
  actionMode: ActionMode;
  refusalReason?: RefusalReason;
  auditLine: string;
}

/**
 * A prepared corpus entry: the mock stand-in for a retrieved+generated answer.
 * Real connectors will replace `keywords` matching with vector+keyword retrieval,
 * but the answer contract (citations, data class, draft-only actions) stays the same.
 */
export interface CorpusEntry {
  id: string;
  sourceSystem: SourceSystem;
  dataClass: DataClass;
  keywords: string[];
  answerText: string;
  citations: Citation[];
  ticketIds: string[];
  draftAction?: DraftAction;
  confidence: number;
}

export interface ChatMessage {
  id: string;
  author: "user" | "assistant";
  text?: string;
  answer?: AgentAnswer;
  timestamp: string;
}
