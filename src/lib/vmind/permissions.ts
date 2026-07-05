import type { ActionMode, ActionType, DataClass, Role } from "./types";

/**
 * 03-data-permissions.md RBAC matrisinin kod karsiligi.
 * `secret` sinifi hicbir role acilmaz; embedding'e de girmez.
 */
const roleAccess: Record<Role, DataClass[]> = {
  stajyer: ["public"],
  network: ["public", "internal"],
  muhasebe: ["public", "internal", "financial"],
  cloud_ops: ["public", "internal"],
  satis_cs: ["public", "internal", "confidential"],
  admin: ["public", "internal", "confidential", "pii", "financial"],
};

export function canAccess(role: Role, dataClass: DataClass): boolean {
  if (dataClass === "secret") return false;
  return roleAccess[role].includes(dataClass);
}

export function accessibleClasses(role: Role): DataClass[] {
  return roleAccess[role];
}

const riskyActions: ActionType[] = [
  "delete",
  "release",
  "payment",
  "permission_change",
  "accounting_entry",
];

const draftActions: ActionType[] = [
  "ticket_draft",
  "task_draft",
  "checklist_draft",
  "kb_article_draft",
];

export interface ActionDecision {
  allowed: boolean;
  mode: ActionMode;
  reason: string;
}

/**
 * MVP kurali: okuma islemleri read-only, yazma islemleri her zaman taslak,
 * riskli islemler rol farketmeksizin reddedilir (onay/audit altyapisi yok).
 */
export function resolveActionMode(role: Role, action: ActionType): ActionDecision {
  if (riskyActions.includes(action)) {
    return {
      allowed: false,
      mode: "read_only",
      reason:
        "Riskli islem: MVP'de silme, release, odeme, yetki degisikligi ve muhasebe kaydi otomatik yapilmaz. Onay akisi gerektirir.",
    };
  }
  if (draftActions.includes(action)) {
    return {
      allowed: true,
      mode: "draft",
      reason: "Yazma islemleri taslak olarak hazirlanir; otomatik gonderilmez.",
    };
  }
  return {
    allowed: true,
    mode: "read_only",
    reason: role === "admin" ? "Read-only sorgu (admin)" : "Read-only sorgu",
  };
}
