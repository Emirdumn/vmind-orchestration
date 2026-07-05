import type { ConnectorProfile, ConnectorStage, SourceSystem } from "@/lib/vmind/types";

export const connectorStageLabels: Record<ConnectorStage, string> = {
  mock: "Mock",
  export_ready: "Export hazir",
  read_only_ready: "Read-only hazir",
  approval_required: "Onay gerekli",
  blocked: "Blokajli",
};

export const connectorProfiles: ConnectorProfile[] = [
  {
    id: "kb",
    owner: "Operasyon Enablement",
    stage: "read_only_ready",
    risk: "medium",
    dataClasses: ["public", "internal"],
    ingestionMode: "Dogrulanmis Problem KB makaleleri + runbook baglantilari",
    refreshCadence: "Pull request ile guncelleme",
    readiness: 88,
    allowedActions: ["read_only", "draft"],
    blockers: ["Her KB maddesi icin sahip ekip, son dogrulama tarihi ve kaynak vaka alani zorunlu olmali"],
    nextActions: [
      "Top 10 problem kategorisi icin KB maddesi ac",
      "VPN, backup ve quota makalelerini eval sorularina bagla",
      "SMAX sinyallerinden eksik KB maddesi listesi uret",
    ],
  },
  {
    id: "smax",
    owner: "Network Operasyon",
    stage: "export_ready",
    risk: "high",
    dataClasses: ["internal", "pii"],
    ingestionMode: "Anonim ticket trendleri + problem kategori sinyali",
    refreshCadence: "Haftalik trend export",
    readiness: 58,
    allowedActions: ["read_only", "draft"],
    blockers: ["Ticketlardan otomatik cozum uretilemez; KB maddesi ekip tarafindan dokumante edilmeli"],
    nextActions: [
      "En cok tekrar eden 10 problem kategorisini anonim say",
      "Kisi/musteri alanlarini maskele ve cozum metnini kaynak olarak kullanma",
      "Her kategori icin Problem KB madde taslagi ac",
    ],
  },
  {
    id: "vrpmind",
    owner: "Satis Operasyon",
    stage: "read_only_ready",
    risk: "medium",
    dataClasses: ["internal", "confidential"],
    ingestionMode: "Surec dokumani + read-only process snapshot",
    refreshCadence: "Haftalik dokuman senkronu",
    readiness: 78,
    allowedActions: ["read_only", "draft"],
    blockers: ["Test ortami endpoint sozlesmesi netlesmeli"],
    nextActions: [
      "Teklif sureci alanlarini sabitle",
      "SLA ve sorumlu alanlarini mock API ile dogrula",
      "Gorev taslagi payload formatini yaz",
    ],
  },
  {
    id: "portvmind",
    owner: "Cloud Ops",
    stage: "approval_required",
    risk: "high",
    dataClasses: ["internal", "confidential"],
    ingestionMode: "Console yardim metni + read-only quota/resource API",
    refreshCadence: "Saatlik read-only kaynak ozeti",
    readiness: 64,
    allowedActions: ["read_only", "draft"],
    blockers: ["Canli API erisimi icin servis hesabi ve RBAC onayi gerekli"],
    nextActions: [
      "Quota, backup, volume ve floating IP endpointlerini ayir",
      "Silme/release islemlerini approval gate arkasina al",
      "Audit log alanlarini PortvMind aksiyonlariyla eslestir",
    ],
  },
  {
    id: "logo",
    owner: "Muhasebe",
    stage: "blocked",
    risk: "critical",
    dataClasses: ["financial", "pii"],
    ingestionMode: "Surec dokumani; canli finans verisi yok",
    refreshCadence: "Manuel dokuman guncelleme",
    readiness: 38,
    allowedActions: ["read_only", "draft"],
    blockers: [
      "Finansal veri sinifi ve Logo API kapsam onayi yok",
      "Muhasebe kaydi icin onay/audit akisi tasarlanmadi",
    ],
    nextActions: [
      "Cari mutabakat ve fatura surec dokumanlarini tamamla",
      "Read-only fatura/cari ozet kapsamlarini belirle",
      "Accounting entry aksiyonunu MVP disinda tut",
    ],
  },
  {
    id: "runbooks",
    owner: "Operasyon Enablement",
    stage: "export_ready",
    risk: "medium",
    dataClasses: ["public", "internal"],
    ingestionMode: "Markdown/Obsidian runbook repository",
    refreshCadence: "Pull request ile guncelleme",
    readiness: 80,
    allowedActions: ["read_only", "draft"],
    blockers: ["Runbooklar KB maddelerine baglanmali; tek basina cevap kaynagi gibi davranmamali"],
    nextActions: [
      "Runbook metadata sablonu ekle",
      "VPN, backup ve quota runbooklarini ilgili KB maddelerine bagla",
      "Obsidian klasor yapisini KB / runbook ayrimina gore duzenle",
    ],
  },
];

export function getConnectorProfile(id: SourceSystem): ConnectorProfile | undefined {
  return connectorProfiles.find((profile) => profile.id === id);
}

export function averageReadiness(profiles: ConnectorProfile[] = connectorProfiles): number {
  if (profiles.length === 0) return 0;
  return Math.round(profiles.reduce((sum, profile) => sum + profile.readiness, 0) / profiles.length);
}

export function countProfilesByStage(
  profiles: ConnectorProfile[] = connectorProfiles,
): Record<ConnectorStage, number> {
  return profiles.reduce(
    (acc, profile) => {
      acc[profile.stage] += 1;
      return acc;
    },
    {
      mock: 0,
      export_ready: 0,
      read_only_ready: 0,
      approval_required: 0,
      blocked: 0,
    } satisfies Record<ConnectorStage, number>,
  );
}
