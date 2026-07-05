import { describe, expect, it } from "vitest";
import { canAccess, resolveActionMode } from "../permissions";
import type { Role } from "../types";

const allRoles: Role[] = ["stajyer", "network", "muhasebe", "cloud_ops", "satis_cs", "admin"];

describe("canAccess", () => {
  it("secret sinifi hicbir role acilmaz", () => {
    for (const role of allRoles) {
      expect(canAccess(role, "secret")).toBe(false);
    }
  });

  it("stajyer sadece public gorebilir", () => {
    expect(canAccess("stajyer", "public")).toBe(true);
    expect(canAccess("stajyer", "internal")).toBe(false);
    expect(canAccess("stajyer", "financial")).toBe(false);
    expect(canAccess("stajyer", "pii")).toBe(false);
  });

  it("network internal gorebilir ama finansal veriye erisemez", () => {
    expect(canAccess("network", "internal")).toBe(true);
    expect(canAccess("network", "financial")).toBe(false);
  });

  it("muhasebe finansal veriye erisebilir", () => {
    expect(canAccess("muhasebe", "financial")).toBe(true);
    expect(canAccess("muhasebe", "confidential")).toBe(false);
  });

  it("admin pii ve finansal dahil erisebilir, secret haric", () => {
    expect(canAccess("admin", "pii")).toBe(true);
    expect(canAccess("admin", "financial")).toBe(true);
    expect(canAccess("admin", "secret")).toBe(false);
  });
});

describe("resolveActionMode", () => {
  it("riskli islemler her rolde reddedilir", () => {
    const riskyActions = ["delete", "release", "payment", "permission_change", "accounting_entry"] as const;
    for (const role of allRoles) {
      for (const action of riskyActions) {
        const decision = resolveActionMode(role, action);
        expect(decision.allowed).toBe(false);
      }
    }
  });

  it("yazma islemleri her zaman taslak modunda kalir", () => {
    for (const action of ["ticket_draft", "task_draft", "checklist_draft", "kb_article_draft"] as const) {
      const decision = resolveActionMode("network", action);
      expect(decision.allowed).toBe(true);
      expect(decision.mode).toBe("draft");
    }
  });

  it("okuma islemleri read-only doner", () => {
    const decision = resolveActionMode("cloud_ops", "read_query");
    expect(decision.allowed).toBe(true);
    expect(decision.mode).toBe("read_only");
  });
});
