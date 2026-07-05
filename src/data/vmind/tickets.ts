import type { Ticket } from "@/lib/vmind/types";

/**
 * Anonimlestirilmis SMAX ticketlari (mock). Cevap kaynagi degildir;
 * KB makalelerine "kaynak vaka" referansi olarak baglanir ve hangi
 * problemlerin dokumante edilecegini onceliklendirmek icin sinyal uretir.
 */
export const tickets: Ticket[] = [
  {
    id: "SMAX-10432",
    title: "Site-to-site VPN tuneli periyodik kopuyor",
    category: "Network / VPN",
    priority: "high",
    status: "resolved",
  },
  {
    id: "SMAX-10287",
    title: "VPN kullanicisi baglaniyor ama ic kaynaklara erisemiyor",
    category: "Network / VPN",
    priority: "medium",
    status: "resolved",
  },
  {
    id: "SMAX-9954",
    title: "VPN kopmalari - ISP tarafinda paket kaybi",
    category: "Network / VPN",
    priority: "high",
    status: "reopened",
  },
  {
    id: "SMAX-10511",
    title: "Volume restore sonrasi instance boot etmiyor",
    category: "Cloud / Volume",
    priority: "critical",
    status: "resolved",
  },
  {
    id: "SMAX-10120",
    title: "Floating IP kotasi dolu, yeni instance aciliyor ama erisilemiyor",
    category: "Cloud / Network",
    priority: "medium",
    status: "resolved",
  },
];

export function getTicketsByIds(ids: string[]): Ticket[] {
  return ids
    .map((id) => tickets.find((t) => t.id === id))
    .filter((t): t is Ticket => Boolean(t));
}
