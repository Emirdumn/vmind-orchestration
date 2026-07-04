import type { Role } from "@/lib/vmind/types";

export interface SuggestedQuestion {
  question: string;
  persona: string;
}

/** 04-mvp-roadmap.md'deki demo senaryolarindan uretilen ornek sorular. */
export const suggestedQuestions: SuggestedQuestion[] = [
  {
    question: "Musteri VPN kopuyor diyor, daha once benzer ticket var mi?",
    persona: "Network",
  },
  {
    question: "Volume backup restore nasil yapilir, riskleri neler?",
    persona: "Cloud Ops",
  },
  {
    question: "Teklif surecinde muhasebe onayi bekliyor, sonraki adim ne olmali?",
    persona: "Satis/CS",
  },
  {
    question: "Cari mutabakat icin hangi belgeler lazim?",
    persona: "Muhasebe",
  },
  {
    question: "Floating IP kotasi doldu, instance'a neden erisilemiyor?",
    persona: "Cloud Ops",
  },
  {
    question: "PortvMind ve vRPMind nedir, nereden baslamaliyim?",
    persona: "Stajyer",
  },
];

export const roleLabels: Record<Role, string> = {
  stajyer: "Stajyer",
  network: "Network",
  muhasebe: "Muhasebe",
  cloud_ops: "Cloud Ops",
  satis_cs: "Satis / CS",
  admin: "Admin",
};
