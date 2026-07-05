import type { DataSource } from "@/lib/vmind/types";

export const dataSources: DataSource[] = [
  {
    id: "kb",
    name: "Knowledge Base",
    description: "Dokumante edilmis problem/cozum makaleleri; birincil cevap kaynagi",
    status: "mock",
    docCount: 34,
    mvpMode: "Birincil cevap kaynagi",
  },
  {
    id: "runbooks",
    name: "Runbooks",
    description: "Network ve operasyon prosedurleri, kontrol listeleri",
    status: "mock",
    docCount: 29,
    mvpMode: "RAG + RBAC",
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
    id: "smax",
    name: "SMAX",
    description: "Cevap kaynagi degil; en sik problemler KB makalesine cevrilir",
    status: "mock",
    docCount: 84,
    mvpMode: "Sinyal - dokumantasyon kuyrugu",
  },
];
