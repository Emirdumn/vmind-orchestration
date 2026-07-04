import type { CorpusEntry } from "@/lib/vmind/types";

/**
 * Mock bilgi tabani. Her kayit, RAG katmaninin "retrieve + generate" ciktisini
 * temsil eder: kaynakli cevap metni, citation listesi, benzer ticketlar ve
 * (varsa) taslak aksiyon. Gercek connectorlar geldiginde bu katman
 * vector+keyword retrieval ile degistirilecek; cevap sozlesmesi ayni kalacak.
 */
export const corpus: CorpusEntry[] = [
  {
    id: "vpn-dropout",
    sourceSystem: "smax",
    dataClass: "internal",
    keywords: ["vpn", "kopuyor", "kopma", "tunel", "ipsec", "disconnect", "baglanti"],
    answerText:
      "Gecmis kayitlara gore VPN kopma problemlerinde en sik ise yarayan ilk kontrol listesi:\n\n1. IKE/IPsec faz-2 lifetime degerlerinin iki ucta esit oldugunu dogrula (SMAX-10432'de kok neden buydu).\n2. Karsi uc NAT arkasindaysa NAT-T'nin acik oldugunu kontrol et.\n3. Tunel MTU degerini 1400'e dusurup paket fragmantasyonunu test et.\n4. Hat kalitesini olc; %1 uzeri paket kaybi varsa ISP eskalasyonu ac (SMAX-9954).\n\nBu adimlar kesin cozum degil, gecmiste ise yaramis adimlardir. Iki denemeden sonra cozum yoksa network ekibine devir onerilir.",
    citations: [
      {
        sourceSystem: "smax",
        sourceUri: "SMAX-10432",
        title: "Site-to-site VPN tuneli periyodik kopuyor",
        docType: "ticket",
        snippet: "Faz-2 lifetime uyusmazligi giderildi, MTU 1400'e dusuruldu.",
      },
      {
        sourceSystem: "runbooks",
        sourceUri: "runbooks/network/vpn-troubleshooting.md",
        title: "VPN Sorun Giderme Runbook",
        docType: "runbook",
        snippet: "Ilk kontrol: lifetime, NAT-T, MTU, hat kalitesi sirasiyla incelenir.",
      },
    ],
    ticketIds: ["SMAX-10432", "SMAX-10287", "SMAX-9954"],
    draftAction: {
      id: "draft-vpn-ticket",
      type: "smax_ticket",
      targetSystem: "smax",
      title: "SMAX ticket taslagi: VPN kopma incelemesi",
      fields: [
        { label: "Kategori", value: "Network / VPN" },
        { label: "Oncelik", value: "High" },
        { label: "Onerilen ekip", value: "Network Operasyon" },
        { label: "Ozet", value: "Musteri VPN tuneli periyodik kopuyor; lifetime/NAT-T/MTU kontrolleri uygulanacak." },
      ],
      note: "Taslak otomatik gonderilmez. Gondermeden once yetkili onayi gerekir.",
    },
    confidence: 0.86,
  },
  {
    id: "backup-restore",
    sourceSystem: "portvmind",
    dataClass: "internal",
    keywords: ["backup", "restore", "volume", "yedek", "geri yukleme", "snapshot"],
    answerText:
      "PortvMind'de volume backup restore akisi:\n\n1. Volumes > Backups ekranindan ilgili backup'i sec.\n2. Restore hedefini belirle: mevcut volume uzerine yazma veya yeni volume olusturma.\n3. Restore islemini baslatmadan once mutlaka guncel bir snapshot al.\n\nRisk uyarisi: Restore, hedef volume uzerindeki mevcut veriyi GERI DONUSSUZ sekilde uzerine yazar (SMAX-10511'de bu nedenle instance boot edememisti). Bu islem onay gerektirir; asistan restore'u kendisi baslatmaz, sadece taslak gorev olusturur.",
    citations: [
      {
        sourceSystem: "portvmind",
        sourceUri: "portvmind/docs/volumes/backup-restore.md",
        title: "Volume Backup & Restore Rehberi",
        docType: "product_doc",
        snippet: "Restore islemi hedef volume icerigini uzerine yazar; oncesinde snapshot onerilir.",
      },
      {
        sourceSystem: "smax",
        sourceUri: "SMAX-10511",
        title: "Volume restore sonrasi instance boot etmiyor",
        docType: "ticket",
        snippet: "Restore mevcut volume uzerine yazilmis; snapshot'tan yeni volume ile cozuldu.",
      },
    ],
    ticketIds: ["SMAX-10511"],
    draftAction: {
      id: "draft-backup-task",
      type: "vrpmind_task",
      targetSystem: "portvmind",
      title: "Gorev taslagi: Restore oncesi snapshot + onayli restore",
      fields: [
        { label: "Islem", value: "Volume restore (onay bekliyor)" },
        { label: "On kosul", value: "Guncel snapshot alinmasi" },
        { label: "Onay", value: "Cloud Ops yetkilisi" },
      ],
      note: "Riskli islem: onay ve yetki kontrolu olmadan calistirilmaz.",
    },
    confidence: 0.9,
  },
  {
    id: "vrpmind-proposal",
    sourceSystem: "vrpmind",
    dataClass: "internal",
    keywords: ["teklif", "onay", "muhasebe onayi", "surec", "asama", "termin"],
    answerText:
      "vRPMind teklif surecinde 'muhasebe onayi bekliyor' asamasindan sonraki adimlar:\n\n1. Sorumlu: Muhasebe onay kuyrugundaki yetkili (surec kartinda gorunur).\n2. Gerekli belgeler: teklif formu, fiyat onay tablosu ve varsa ozel indirim gerekcesi.\n3. Onay tamamlaninca surec otomatik olarak 'sozlesme hazirligi' adimina gecer; satis sorumlusuna gorev acilir.\n4. Termin: onay SLA'si 2 is gunu; asilirsa hatirlatma gorevi onerilir.\n\nIstersen bekleyen onay icin vRPMind'de hatirlatma gorevi taslagi hazirlayabilirim.",
    citations: [
      {
        sourceSystem: "vrpmind",
        sourceUri: "vrpmind/docs/processes/proposal-flow.md",
        title: "Teklif Sureci Akisi",
        docType: "procedure",
        snippet: "Muhasebe onayi > sozlesme hazirligi > imza adimlari; onay SLA 2 is gunu.",
      },
    ],
    ticketIds: [],
    draftAction: {
      id: "draft-proposal-reminder",
      type: "vrpmind_task",
      targetSystem: "vrpmind",
      title: "Gorev taslagi: Muhasebe onayi SLA hatirlatmasi",
      fields: [
        { label: "Gorev", value: "Teklif onay hatirlatmasi" },
        { label: "Sorumlu", value: "Muhasebe onay kuyrugu" },
        { label: "Termin", value: "SLA: 2 is gunu" },
      ],
      note: "Taslak otomatik atanmaz; satis sorumlusu onaylayinca olusturulur.",
    },
    confidence: 0.82,
  },
  {
    id: "logo-reconciliation",
    sourceSystem: "logo",
    dataClass: "financial",
    keywords: ["cari", "mutabakat", "belge", "fatura", "tahsilat", "odeme"],
    answerText:
      "Logo surec dokumanina gore cari mutabakat icin gerekli belgeler:\n\n1. Donem sonu cari hesap ekstresi (iki taraf icin).\n2. Acik fatura listesi ve vade dokumu.\n3. Varsa iade/fiyat farki dekontlari.\n4. Mutabakat mektubu sablonu (imza yetkilisi onayli).\n\nSurec: ekstre karsilastirmasi > fark analizi > mutabakat mektubu > karsilikli imza. Asistan muhasebe kaydi olusturmaz; sadece eksik belge kontrol listesi taslagi hazirlar.",
    citations: [
      {
        sourceSystem: "logo",
        sourceUri: "logo/docs/finance/cari-mutabakat.md",
        title: "Cari Mutabakat Proseduru",
        docType: "invoice_process",
        snippet: "Ekstre, acik fatura listesi, dekontlar ve mutabakat mektubu zorunlu belgelerdir.",
      },
    ],
    ticketIds: [],
    draftAction: {
      id: "draft-reconciliation-checklist",
      type: "checklist",
      targetSystem: "logo",
      title: "Kontrol listesi taslagi: Cari mutabakat belgeleri",
      fields: [
        { label: "1", value: "Cari hesap ekstresi (donem sonu)" },
        { label: "2", value: "Acik fatura listesi + vade dokumu" },
        { label: "3", value: "Iade / fiyat farki dekontlari" },
        { label: "4", value: "Onayli mutabakat mektubu sablonu" },
      ],
      note: "Bilgilendirme amaclidir; muhasebe kaydi olusturulmaz.",
    },
    confidence: 0.84,
  },
  {
    id: "quota-floating-ip",
    sourceSystem: "portvmind",
    dataClass: "internal",
    keywords: ["kota", "quota", "floating ip", "limit", "instance", "erisilemiyor"],
    answerText:
      "PortvMind'de kota ve floating IP durumu icin:\n\n1. Quota ekranindan compute/volume/network kotalarini kontrol et.\n2. Floating IP limiti doluysa yeni instance IP alamaz; instance calisir ama disaridan erisilemez (SMAX-10120).\n3. Kullanilmayan IP'lerin release edilmesi riskli islemdir: onay ve yetki gerektirir, asistan bunu kendisi yapmaz.\n\nRead-only kota durumu sorgusu Cloud Ops rolu icin acmaya uygundur.",
    citations: [
      {
        sourceSystem: "portvmind",
        sourceUri: "portvmind/docs/quota/quota-overview.md",
        title: "Quota Yonetimi Rehberi",
        docType: "product_doc",
        snippet: "Compute, volume ve network kotalari ayri ekranlarda izlenir.",
      },
      {
        sourceSystem: "smax",
        sourceUri: "SMAX-10120",
        title: "Floating IP kotasi dolu",
        docType: "ticket",
        snippet: "Kullanilmayan IP'ler onayli sekilde release edilerek cozuldu.",
      },
    ],
    ticketIds: ["SMAX-10120"],
    confidence: 0.8,
  },
  {
    id: "onboarding-overview",
    sourceSystem: "runbooks",
    dataClass: "public",
    keywords: ["vmind", "nedir", "onboarding", "portvmind nedir", "vrpmind nedir", "urun"],
    answerText:
      "VMind urun ailesi kisa ozet:\n\n- PortvMind: compute, volume, network, Kubernetes, load balancer, object storage, quota ve billing modulleri iceren cloud console.\n- vRPMind: departmanlar arasi workflow, gorev, teklif, termin ve dashboard yonetimi.\n- SMAX: incident/request ticket sistemi; network ekibinin cozum hafizasi.\n- Logo: muhasebe ve finans surecleri.\n\nYeni baslayanlar icin onboarding dokumanlarindaki 'ilk hafta kontrol listesi' onerilir.",
    citations: [
      {
        sourceSystem: "runbooks",
        sourceUri: "runbooks/onboarding/vmind-products.md",
        title: "VMind Urun Ailesi - Onboarding Notu",
        docType: "product_doc",
        snippet: "PortvMind cloud console, vRPMind surec motoru, SMAX ticket sistemi ozetleri.",
      },
    ],
    ticketIds: [],
    confidence: 0.78,
  },
];
