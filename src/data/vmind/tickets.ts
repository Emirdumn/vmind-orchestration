import type { Ticket } from "@/lib/vmind/types";

/** Anonimlestirilmis SMAX-stili ticket export'u (mock). Kisi/musteri verisi maskelenmistir. */
export const tickets: Ticket[] = [
  {
    id: "SMAX-10432",
    title: "Site-to-site VPN tuneli periyodik kopuyor",
    category: "Network / VPN",
    priority: "high",
    status: "resolved",
    resolutionSteps: [
      "IKE/IPsec faz-2 lifetime uyusmazligi kontrol edildi",
      "Karsi uc firewall'da NAT-T aktif edildi",
      "MTU 1400'e dusuruldu, tunel stabilize oldu",
    ],
    similarity: 0.92,
  },
  {
    id: "SMAX-10287",
    title: "VPN kullanicisi baglaniyor ama ic kaynaklara erisemiyor",
    category: "Network / VPN",
    priority: "medium",
    status: "resolved",
    resolutionSteps: [
      "Split-tunnel route tablosu dogrulandi",
      "Security group'ta eksik subnet izni eklendi",
    ],
    similarity: 0.81,
  },
  {
    id: "SMAX-9954",
    title: "VPN kopmalari - ISP tarafinda paket kaybi",
    category: "Network / VPN",
    priority: "high",
    status: "reopened",
    resolutionSteps: [
      "Hat testi yapildi, %3 paket kaybi goruldu",
      "ISP'ye eskalasyon acildi; gecici olarak yedek hat aktif edildi",
    ],
    similarity: 0.77,
  },
  {
    id: "SMAX-10511",
    title: "Volume restore sonrasi instance boot etmiyor",
    category: "Cloud / Volume",
    priority: "critical",
    status: "resolved",
    resolutionSteps: [
      "Restore'un mevcut volume uzerine yazildigi tespit edildi",
      "Snapshot'tan yeni volume olusturulup attach edildi",
      "Runbook'a 'restore oncesi snapshot al' adimi eklendi",
    ],
    similarity: 0.88,
  },
  {
    id: "SMAX-10120",
    title: "Floating IP kotasi dolu, yeni instance aciliyor ama erisilemiyor",
    category: "Cloud / Network",
    priority: "medium",
    status: "resolved",
    resolutionSteps: [
      "Quota ekranindan floating IP limiti dogrulandi",
      "Kullanilmayan 3 IP release edildi (onayli islem)",
    ],
    similarity: 0.74,
  },
];

export function getTicketsByIds(ids: string[]): Ticket[] {
  return ids
    .map((id) => tickets.find((t) => t.id === id))
    .filter((t): t is Ticket => Boolean(t));
}
