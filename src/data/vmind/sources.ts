import type { DataSource } from "@/lib/vmind/types";

export const dataSources: DataSource[] = [
  {
    id: "smax",
    name: "SMAX",
    description: "Incident ve request ticket hafizasi, cozum notlari",
    status: "mock",
    docCount: 84,
    mvpMode: "Anonim export + RAG",
  },
  {
    id: "vrpmind",
    name: "vRPMind",
    description: "Surec, gorev, teklif ve departman akislari",
    status: "mock",
    docCount: 37,
    mvpMode: "RAG + read-only",
  },
  {
    id: "portvmind",
    name: "PortvMind",
    description: "Cloud kaynak rehberi: compute, volume, network, K8s, quota",
    status: "mock",
    docCount: 52,
    mvpMode: "RAG + read-only",
  },
  {
    id: "logo",
    name: "Logo",
    description: "Fatura, cari, mutabakat ve odeme surec dokumanlari",
    status: "mock",
    docCount: 21,
    mvpMode: "Sadece surec dokumani",
  },
  {
    id: "runbooks",
    name: "Runbooks",
    description: "Network ve operasyon prosedurleri, kontrol listeleri",
    status: "mock",
    docCount: 29,
    mvpMode: "RAG + RBAC",
  },
];
