export interface RoadmapWeek {
  week: string;
  title: string;
  items: string[];
}

/** 04-mvp-roadmap.md iceriginden. */
export const roadmapWeeks: RoadmapWeek[] = [
  {
    week: "Hafta 1",
    title: "Kaynak ve izin",
    items: [
      "En cok tekrar eden 10 problem kategorisini SMAX'tan anonim sinyal olarak cikar",
      "Network runbook/prosedurlerini Problem KB maddelerine donustur",
      "vRPMind surec dokumanlarini topla",
      "PortvMind console yardim metinlerini topla",
      "Logo icin sadece surec dokumanlariyla basla",
      "Veri sinifi ve RBAC tablosunu onaylat",
      "30-50 soruluk ilk eval seti yaz",
    ],
  },
  {
    week: "Hafta 2",
    title: "RAG temel demo",
    items: [
      "Markdown/Obsidian tabanli Problem KB deposu kur",
      "Chunk metadata semasini uygula",
      "Vector DB sec: Qdrant veya pgvector",
      "Hybrid retrieval kur: vector + keyword",
      "Cevaplarda kaynak goster",
      "\"Kaynak yoksa cevap verme\" kuralini test et",
      "Basit web chat veya CLI demo hazirla",
    ],
  },
  {
    week: "Hafta 3",
    title: "Tool/API taslaklari",
    items: [
      "SMAX read-only / export tabanli problem trend sinyali",
      "PortvMind modul envanteri ve read-only mock API",
      "vRPMind process mock veya test ortami endpoint'i",
      "Problem KB maddesi taslagi ureten ama otomatik yayinlamayan aksiyon",
      "Audit log: soru, kaynak, karar, kullanici, zaman",
    ],
  },
  {
    week: "Hafta 4",
    title: "Pilot ve olcum",
    items: [
      "Network ekibiyle 10-20 gercek soru testi",
      "Halusinasyon ve yetki reddi testleri",
      "KB kapsam skoru: sorularin yuzde kaci makaleyle karsilaniyor",
      "Eksik makale/dokuman listesi",
      "Demo anlatimi ve 5 slaytlik yonetici ozeti",
    ],
  },
];

export interface SuccessMetric {
  metric: string;
  target: string;
}

export const successMetrics: SuccessMetric[] = [
  { metric: "Kaynakli cevap dogrulugu", target: "%85+" },
  { metric: "Kaynak olmayan soruda uydurmama", target: "%95+" },
  { metric: "Problem KB kapsama orani", target: "%70+" },
  { metric: "Ilk cevap suresi", target: "< 5 sn" },
  { metric: "Yetkisiz veri reddi", target: "%100" },
  { metric: "Pilot memnuniyet", target: "4/5+" },
];

export const outOfScope: string[] = [
  "Otomatik muhasebe kaydi",
  "Silme, release, payment, permission degisikligi gibi riskli cloud islemleri",
  "Musteri verisiyle genis pilot",
  "Fine-tuning",
  "Tum sirket sistemlerine ayni anda entegrasyon",
];
