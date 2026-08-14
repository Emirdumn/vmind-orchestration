/** FAZ 4.B — Severity semantigi ve Gap modeli */
import type { ServiceCode } from '../schema/estimate.js';

/**
 * | Seviye        | Anlam                                          | Davranis                                   |
 * |---------------|------------------------------------------------|--------------------------------------------|
 * | `blocker`     | Teklif matematiksel olarak yanlis/eksik olur    | Onay ekrani gecilemez, yayinlanamaz        |
 * | `recommended` | Calisir ama muhtemelen istenen bu degil        | Satisciya sorulur, "boyle kalsin" denebilir|
 * | `optional`    | Upsell firsati                                 | Yalnizca raporda listelenir                |
 */
export type Severity = 'blocker' | 'recommended' | 'optional';

export const SEVERITY_ORDER: Record<Severity, number> = {
  blocker: 0,
  recommended: 1,
  optional: 2,
};

/** Kural kapsami: her kalem icin mi, teklifin tamami icin mi calisir. */
export type RuleScope = 'item' | 'estimate';

export interface Rule {
  id: string;
  severity: Severity;
  /** 'item' varsayilan. */
  scope?: RuleScope;
  /** Yalnizca bu servis kodlarindaki kalemlerde calisir (scope: item icin). */
  services?: ServiceCode[];
  /** Kuralin tetiklenme kosulu — src/core/rules/expr.ts dilbilgisi. */
  when: string;
  /** Satisciya gosterilecek aciklama. */
  message: string;
  /** Satisciya sorulacak soru (varsa). */
  ask?: string;
  /** Cevap verilmezse kullanilacak varsayim (Faz 6.A: her sorunun varsayilani olmali). */
  default?: string;
}

/** Kuralin urettigi bulgu. */
export interface Gap {
  ruleId: string;
  severity: Severity;
  message: string;
  ask?: string;
  default?: string;
  /** Kalem bazli kurallarda ilgili kalemin id'si. */
  itemId?: string;
  service?: ServiceCode;
}

export interface ValidationReport {
  gaps: Gap[];
  blockers: Gap[];
  recommended: Gap[];
  optional: Gap[];
  /** blocker varsa yayinlanamaz. */
  publishable: boolean;
}

export function buildReport(gaps: Gap[]): ValidationReport {
  const sorted = [...gaps].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const blockers = sorted.filter((g) => g.severity === 'blocker');
  return {
    gaps: sorted,
    blockers,
    recommended: sorted.filter((g) => g.severity === 'recommended'),
    optional: sorted.filter((g) => g.severity === 'optional'),
    publishable: blockers.length === 0,
  };
}
