import type { KnowledgeArticle } from "@/lib/vmind/types";

/**
 * Knowledge base makaleleri (mock). Birincil cevap kaynagi bunlardir;
 * ticketlar sadece "kaynak vaka" olarak referans verilir.
 */
export const articles: KnowledgeArticle[] = [
  {
    id: "KB-001",
    title: "Site-to-site VPN tuneli periyodik kopuyor",
    category: "Network / VPN",
    problem: "IPsec VPN tuneli belirli araliklarla dusuyor ve kendiliginden geri geliyor.",
    symptoms: [
      "Tunel her X saatte bir kopup yeniden kuruluyor",
      "Kopma anlarinda iki yonde de trafik kesiliyor",
    ],
    rootCause:
      "En sik neden: iki ucta IKE/IPsec faz-2 lifetime uyusmazligi. Ikincil nedenler: NAT arkasinda NAT-T kapali olmasi ve MTU kaynakli fragmantasyon.",
    resolutionSteps: [
      "Iki ucta faz-2 lifetime degerlerini esitle",
      "Karsi uc NAT arkasindaysa NAT-T'yi aktif et",
      "Tunel MTU degerini 1400'e dusurup test et",
      "Hat kalitesini olc; %1+ paket kaybinda ISP eskalasyonu ac",
    ],
    verification: "Tunel 24 saat kesintisiz kaldiysa ve ping kaybi %0 ise cozum dogrulanmis sayilir.",
    owner: "Network Operasyon",
    lastVerified: "2026-06-18",
    sourceTicketIds: ["SMAX-10432", "SMAX-10287", "SMAX-9954"],
    relevance: 0.93,
  },
  {
    id: "KB-002",
    title: "Volume restore mevcut verinin uzerine yazar",
    category: "Cloud / Volume",
    problem: "Backup restore islemi hedef volume icerigini geri donussuz siler; yanlis hedefle instance boot edemez hale gelir.",
    symptoms: [
      "Restore sonrasi instance boot etmiyor",
      "Volume uzerindeki guncel veri kayboldu",
    ],
    rootCause:
      "Restore varsayilan olarak mevcut volume uzerine yazar; islem oncesi snapshot alinmamissa geri donus yolu kalmaz.",
    resolutionSteps: [
      "Restore oncesi mutlaka guncel snapshot al",
      "Mumkunse 'yeni volume olustur' hedefini sec",
      "Restore sonrasi attach/boot dogrulamasi yap",
    ],
    verification: "Instance yeni volume ile boot ediyor ve veri butunlugu kontrol edildi.",
    owner: "Cloud Ops",
    lastVerified: "2026-06-25",
    sourceTicketIds: ["SMAX-10511"],
    relevance: 0.9,
  },
  {
    id: "KB-003",
    title: "Floating IP kotasi dolunca instance'a erisilemez",
    category: "Cloud / Network",
    problem: "Kota dolu oldugunda yeni instance floating IP alamaz; calisir ama disaridan erisilemez.",
    symptoms: [
      "Instance aktif fakat public IP atanamiyor",
      "Quota ekraninda floating IP limiti dolu gorunuyor",
    ],
    rootCause: "Floating IP kotasi proje limitine ulasmis; kullanilmayan IP'ler release edilmemis.",
    resolutionSteps: [
      "Quota ekranindan floating IP kullanimini dogrula",
      "Kullanilmayan IP'leri tespit et",
      "Release islemi icin yetkili onayi al (riskli islem, otomatik yapilmaz)",
    ],
    verification: "Yeni instance IP alabiliyor ve erisim saglaniyor.",
    owner: "Cloud Ops",
    lastVerified: "2026-05-30",
    sourceTicketIds: ["SMAX-10120"],
    relevance: 0.82,
  },
  {
    id: "KB-004",
    title: "Teklif sureci: muhasebe onayi adimi",
    category: "vRPMind / Surec",
    problem: "Teklif 'muhasebe onayi bekliyor' asamasinda; sonraki adim ve sorumlular netlestirilmeli.",
    symptoms: ["Surec kartinda 'muhasebe onayi bekliyor' durumu gorunuyor"],
    rootCause: "Onay SLA'si (2 is gunu) icinde islem yapilmadiginda surec bekleme durumunda kalir.",
    resolutionSteps: [
      "Onay kuyrugundaki sorumluyu surec kartindan dogrula",
      "Teklif formu, fiyat onay tablosu ve indirim gerekcesini hazirla",
      "SLA asildiysa hatirlatma gorevi olustur",
      "Onay sonrasi surec otomatik 'sozlesme hazirligi' adimina gecer",
    ],
    verification: "Surec 'sozlesme hazirligi' adimina gecti ve satis sorumlusuna gorev acildi.",
    owner: "Satis Operasyon",
    lastVerified: "2026-06-10",
    sourceTicketIds: [],
    relevance: 0.85,
  },
  {
    id: "KB-005",
    title: "Cari mutabakat icin gerekli belgeler",
    category: "Logo / Finans",
    problem: "Cari mutabakat baslatilirken hangi belgelerin hazirlanacagi netlestirilmeli.",
    symptoms: ["Mutabakat surecinde eksik belge nedeniyle gecikme"],
    rootCause: "Belge kontrol listesi standardize edilmeden surec kisiye bagimli ilerliyor.",
    resolutionSteps: [
      "Donem sonu cari hesap ekstresi (iki taraf)",
      "Acik fatura listesi ve vade dokumu",
      "Iade/fiyat farki dekontlari",
      "Onayli mutabakat mektubu sablonu",
    ],
    verification: "Karsi tarafla imzali mutabakat mektubu arsivlendi.",
    owner: "Muhasebe",
    lastVerified: "2026-06-05",
    sourceTicketIds: [],
    relevance: 0.87,
  },
];

export function getArticlesByIds(ids: string[]): KnowledgeArticle[] {
  return ids
    .map((id) => articles.find((a) => a.id === id))
    .filter((a): a is KnowledgeArticle => Boolean(a));
}
