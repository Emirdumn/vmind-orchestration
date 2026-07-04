import type {
  AgentAnswer,
  CorpusEntry,
  Role,
  SourceSystem,
} from "./types";
import { canAccess, resolveActionMode } from "./permissions";

export interface RetrievalOptions {
  role: Role;
  /** Kaynak filtresi; bos ise tum kaynaklar taranir. */
  scope?: SourceSystem | "all";
  corpus: CorpusEntry[];
  now?: Date;
}

/** Turkce karakterleri sadelestirip kucuk harfe cevirir; mock keyword eslesmesi icin yeterli. */
export function normalizeText(text: string): string {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
}

const secretPatterns = [
  "sifre",
  "parola",
  "password",
  "token",
  "private key",
  "api key",
  "lisans anahtari",
  "license key",
];

const piiPatterns = [
  "telefonunu",
  "telefon numarasi",
  "tckn",
  "kimlik numarasi",
  "ev adresi",
  "e-posta adresini",
];

export function scoreEntry(query: string, entry: CorpusEntry): number {
  const normalizedQuery = normalizeText(query);
  let score = 0;
  for (const keyword of entry.keywords) {
    if (normalizedQuery.includes(normalizeText(keyword))) score += 1;
  }
  return score;
}

function buildAuditLine(role: Role, query: string, outcome: string, now: Date): string {
  const stamp = now.toISOString().slice(0, 16).replace("T", " ");
  return `[${stamp}] rol=${role} soru="${query.slice(0, 60)}" karar=${outcome}`;
}

/**
 * Mock retrieval: keyword skorlamasi ile en iyi corpus kaydini bulur ve
 * guardrail sirasini uygular (05-bot-guardrails-eval.md):
 * secret red > PII red > kaynak yoksa cevap yok > yetki kontrolu > kaynakli cevap.
 */
export function retrieve(query: string, options: RetrievalOptions): AgentAnswer {
  const { role, corpus, scope = "all" } = options;
  const now = options.now ?? new Date();
  const normalizedQuery = normalizeText(query);

  if (secretPatterns.some((p) => normalizedQuery.includes(p))) {
    return {
      kind: "refusal",
      refusalReason: "secret",
      text: "Sifre, token, private key veya lisans anahtari gibi gizli degerler hicbir rolde paylasilmaz. Bu tur degerler bilgi tabanina da alinmaz.",
      citations: [],
      ticketIds: [],
      confidence: 1,
      dataClass: "secret",
      actionMode: "read_only",
      auditLine: buildAuditLine(role, query, "red:secret", now),
    };
  }

  if (piiPatterns.some((p) => normalizedQuery.includes(p)) && !canAccess(role, "pii")) {
    return {
      kind: "refusal",
      refusalReason: "permission",
      text: "Bu soru kisi verisi (PII) iceriyor ve mevcut rolunuz bu sinifa erisemiyor. Ihtiyac gercekse talebi veri sahibi ekibe iletebilirim (insan devri).",
      citations: [],
      ticketIds: [],
      confidence: 1,
      dataClass: "pii",
      actionMode: "read_only",
      auditLine: buildAuditLine(role, query, "red:pii-yetki", now),
    };
  }

  const candidates = scope === "all" ? corpus : corpus.filter((e) => e.sourceSystem === scope);

  let best: CorpusEntry | undefined;
  let bestScore = 0;
  for (const entry of candidates) {
    const score = scoreEntry(query, entry);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }

  if (!best || bestScore === 0) {
    const scopeNote =
      scope === "all"
        ? "SMAX, vRPMind, PortvMind, Logo ve runbook kaynaklarinda"
        : `secili kaynakta (${scope})`;
    return {
      kind: "refusal",
      refusalReason: "no_source",
      text: `Bu soru icin ${scopeNote} yeterli kaynak bulamadim, bu yuzden tahmin uretmiyorum. Eksik dokuman listesine ekleyebilir veya soruyu ilgili ekibe devredebilirim.`,
      citations: [],
      ticketIds: [],
      confidence: 0,
      dataClass: "public",
      actionMode: "read_only",
      auditLine: buildAuditLine(role, query, "red:kaynak-yok", now),
    };
  }

  if (!canAccess(role, best.dataClass)) {
    return {
      kind: "refusal",
      refusalReason: "permission",
      text: `Bu icerik "${best.dataClass}" veri sinifinda ve mevcut rolunuz bu sinifa erisemiyor. Dogru yol: ilgili kaynak sahibi ekipten erisim talep etmek. Istersen devir ozeti hazirlayabilirim.`,
      citations: [],
      ticketIds: [],
      confidence: 1,
      dataClass: best.dataClass,
      actionMode: "read_only",
      auditLine: buildAuditLine(role, query, `red:yetki(${best.dataClass})`, now),
    };
  }

  const actionDecision = best.draftAction
    ? resolveActionMode(role, best.draftAction.type === "smax_ticket" ? "ticket_draft" : best.draftAction.type === "vrpmind_task" ? "task_draft" : "checklist_draft")
    : resolveActionMode(role, "read_query");

  return {
    kind: "answer",
    text: best.answerText,
    citations: best.citations,
    ticketIds: best.ticketIds,
    draftAction: actionDecision.allowed && actionDecision.mode === "draft" ? best.draftAction : undefined,
    confidence: best.confidence,
    dataClass: best.dataClass,
    actionMode: actionDecision.mode,
    auditLine: buildAuditLine(role, query, `cevap:${best.id} guven=${best.confidence}`, now),
  };
}
