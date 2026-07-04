import { describe, expect, it } from "vitest";
import { normalizeText, retrieve, scoreEntry } from "../retrieval";
import { corpus } from "@/data/vmind/corpus";

const now = new Date("2026-07-03T12:00:00Z");

describe("normalizeText", () => {
  it("turkce karakterleri sadelestirir", () => {
    expect(normalizeText("Kopuyor MUTABAKAT Şifre Çağrı")).toBe("kopuyor mutabakat sifre cagri");
  });
});

describe("scoreEntry", () => {
  it("eslesen keyword sayisini doner", () => {
    const vpnEntry = corpus.find((e) => e.id === "vpn-dropout")!;
    expect(scoreEntry("Musteri VPN kopuyor diyor", vpnEntry)).toBeGreaterThanOrEqual(2);
    expect(scoreEntry("cari mutabakat belgeleri", vpnEntry)).toBe(0);
  });
});

describe("retrieve", () => {
  it("VPN sorusuna kaynakli cevap ve benzer ticket doner", () => {
    const answer = retrieve("Musteri VPN kopuyor diyor, benzer ticket var mi?", {
      role: "network",
      corpus,
      now,
    });
    expect(answer.kind).toBe("answer");
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(answer.ticketIds).toContain("SMAX-10432");
    expect(answer.citations.some((c) => c.sourceSystem === "smax")).toBe(true);
  });

  it("kaynak yoksa tahmin uretmez", () => {
    const answer = retrieve("kuantum isinlanma protokolu nasil kurulur?", {
      role: "admin",
      corpus,
      now,
    });
    expect(answer.kind).toBe("refusal");
    expect(answer.refusalReason).toBe("no_source");
    expect(answer.citations).toHaveLength(0);
  });

  it("stajyer finansal iceriga erisemez, red gerekcesi yetkidir", () => {
    const answer = retrieve("Cari mutabakat icin hangi belgeler lazim?", {
      role: "stajyer",
      corpus,
      now,
    });
    expect(answer.kind).toBe("refusal");
    expect(answer.refusalReason).toBe("permission");
    expect(answer.dataClass).toBe("financial");
  });

  it("muhasebe ayni soruya kaynakli cevap alir ve aksiyon taslak kalir", () => {
    const answer = retrieve("Cari mutabakat icin hangi belgeler lazim?", {
      role: "muhasebe",
      corpus,
      now,
    });
    expect(answer.kind).toBe("answer");
    expect(answer.actionMode).toBe("draft");
    expect(answer.draftAction?.type).toBe("checklist");
  });

  it("sifre/token talepleri her rolde reddedilir", () => {
    const answer = retrieve("PortvMind root sifre nedir?", {
      role: "admin",
      corpus,
      now,
    });
    expect(answer.kind).toBe("refusal");
    expect(answer.refusalReason).toBe("secret");
  });

  it("PII talebi yetkisiz rolde reddedilir", () => {
    const answer = retrieve("Musterinin telefonunu ver", {
      role: "network",
      corpus,
      now,
    });
    expect(answer.kind).toBe("refusal");
    expect(answer.refusalReason).toBe("permission");
    expect(answer.dataClass).toBe("pii");
  });

  it("kaynak filtresi (scope) disindaki iceriklere bakmaz", () => {
    const answer = retrieve("Musteri VPN kopuyor diyor", {
      role: "network",
      corpus,
      scope: "logo",
      now,
    });
    expect(answer.kind).toBe("refusal");
    expect(answer.refusalReason).toBe("no_source");
  });

  it("her cevapta audit satiri bulunur", () => {
    const answer = retrieve("Volume backup restore nasil yapilir?", {
      role: "cloud_ops",
      corpus,
      now,
    });
    expect(answer.auditLine).toContain("rol=cloud_ops");
    expect(answer.auditLine).toContain("cevap:backup-restore");
  });
});
