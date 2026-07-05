import type { CorpusEntry } from "@/lib/vmind/types";

/**
 * Mock bilgi tabani. Her kayit, RAG katmaninin "retrieve + generate" ciktisini
 * temsil eder: kaynakli cevap metni, citation listesi, ilgili KB makaleleri ve
 * (varsa) taslak aksiyon.
 *
 * KB-first ilke: cevaplar dokumante edilmis knowledge base makalelerine ve
 * surec dokumanlarina dayanir. SMAX ticketlari cevap kaynagi degildir; sadece
 * KB makalelerinde "kaynak vaka" olarak gorunur.
 */
export const corpus: CorpusEntry[] = [
  {
    id: "vpn-dropout",
    sourceSystem: "kb",
    dataClass: "internal",
    keywords: ["vpn", "kopuyor", "kopma", "tunel", "ipsec", "disconnect", "baglanti"],
    answerText:
      "KB-001 makalesine gore VPN kopma probleminde dokumante edilmis kok neden ve kontrol sirasi:\n\nKok neden (en sik): iki ucta IKE/IPsec faz-2 lifetime uyusmazligi.\n\n1. Iki ucta faz-2 lifetime degerlerini esitle.\n2. Karsi uc NAT arkasindaysa NAT-T'nin acik oldugunu kontrol et.\n3. Tunel MTU degerini 1400'e dusurup fragmantasyonu test et.\n4. Hat kalitesini olc; %1 uzeri paket kaybinda ISP eskalasyonu ac.\n\nDogrulama: tunel 24 saat kesintisiz kalirsa cozum dogrulanmis sayilir. Makale, gecmisteki 3 vakadan (SMAX kayitlari) uretildi ve 18.06.2026'da dogrulandi. Iki denemeden sonra cozum yoksa network ekibine devir onerilir.",
    citations: [
      {
        sourceSystem: "kb",
        sourceUri: "KB-001",
        title: "Site-to-site VPN tuneli periyodik kopuyor",
        docType: "kb_article",
        snippet: "Kok neden: faz-2 lifetime uyusmazligi; NAT-T ve MTU ikincil nedenler.",
      },
      {
        sourceSystem: "runbooks",
        sourceUri: "runbooks/network/vpn-troubleshooting.md",
        title: "VPN Sorun Giderme Runbook",
        docType: "runbook",
        snippet: "Ilk kontrol: lifetime, NAT-T, MTU, hat kalitesi sirasiyla incelenir.",
      },
    ],
    articleIds: ["KB-001"],
    draftAction: {
      id: "draft-vpn-kb-article",
      type: "kb_article",
      targetSystem: "kb",
      title: "Problem KB taslagi: VPN kopma kontrol listesi",
      fields: [
        { label: "Problem", value: "Site-to-site VPN tuneli periyodik kopuyor" },
        { label: "Sahip ekip", value: "Network Operasyon" },
        { label: "KB onceligi", value: "High - SMAX tekrar sinyali var" },
        { label: "Kontrol listesi", value: "Lifetime, NAT-T, MTU ve hat kalitesi dogrulanacak" },
      ],
      note: "Bu bir knowledge base maddesi taslagidir; ticket cozumunden otomatik uretilmez ve ekip dogrulamasi gerektirir.",
    },
    confidence: 0.9,
  },
  {
    id: "backup-restore",
    sourceSystem: "kb",
    dataClass: "internal",
    keywords: ["backup", "restore", "volume", "yedek", "geri yukleme", "snapshot"],
    answerText:
      "KB-002 makalesi ve PortvMind rehberine gore volume backup restore akisi:\n\n1. Volumes > Backups ekranindan ilgili backup'i sec.\n2. Restore hedefini belirle: mumkunse 'yeni volume olustur' secenegini kullan.\n3. Restore islemini baslatmadan once mutlaka guncel bir snapshot al.\n\nDokumante edilmis risk: Restore, hedef volume uzerindeki mevcut veriyi GERI DONUSSUZ sekilde uzerine yazar. Bu islem onay gerektirir; asistan restore'u kendisi baslatmaz, sadece taslak gorev olusturur.",
    citations: [
      {
        sourceSystem: "kb",
        sourceUri: "KB-002",
        title: "Volume restore mevcut verinin uzerine yazar",
        docType: "kb_article",
        snippet: "Restore oncesi snapshot zorunlu; mumkunse yeni volume hedefi secilir.",
      },
      {
        sourceSystem: "portvmind",
        sourceUri: "portvmind/docs/volumes/backup-restore.md",
        title: "Volume Backup & Restore Rehberi",
        docType: "product_doc",
        snippet: "Restore islemi hedef volume icerigini uzerine yazar; oncesinde snapshot onerilir.",
      },
    ],
    articleIds: ["KB-002"],
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
      "vRPMind surec dokumani ve KB-004 makalesine gore 'muhasebe onayi bekliyor' asamasindan sonraki adimlar:\n\n1. Sorumlu: Muhasebe onay kuyrugundaki yetkili (surec kartinda gorunur).\n2. Gerekli belgeler: teklif formu, fiyat onay tablosu ve varsa ozel indirim gerekcesi.\n3. Onay tamamlaninca surec otomatik olarak 'sozlesme hazirligi' adimina gecer; satis sorumlusuna gorev acilir.\n4. Termin: onay SLA'si 2 is gunu; asilirsa hatirlatma gorevi onerilir.\n\nIstersen bekleyen onay icin vRPMind'de hatirlatma gorevi taslagi hazirlayabilirim.",
    citations: [
      {
        sourceSystem: "vrpmind",
        sourceUri: "vrpmind/docs/processes/proposal-flow.md",
        title: "Teklif Sureci Akisi",
        docType: "procedure",
        snippet: "Muhasebe onayi > sozlesme hazirligi > imza adimlari; onay SLA 2 is gunu.",
      },
      {
        sourceSystem: "kb",
        sourceUri: "KB-004",
        title: "Teklif sureci: muhasebe onayi adimi",
        docType: "kb_article",
        snippet: "SLA asiminda hatirlatma gorevi; onay sonrasi otomatik adim gecisi.",
      },
    ],
    articleIds: ["KB-004"],
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
      "Logo surec dokumani ve KB-005 makalesine gore cari mutabakat icin gerekli belgeler:\n\n1. Donem sonu cari hesap ekstresi (iki taraf icin).\n2. Acik fatura listesi ve vade dokumu.\n3. Varsa iade/fiyat farki dekontlari.\n4. Mutabakat mektubu sablonu (imza yetkilisi onayli).\n\nSurec: ekstre karsilastirmasi > fark analizi > mutabakat mektubu > karsilikli imza. Asistan muhasebe kaydi olusturmaz; sadece eksik belge kontrol listesi taslagi hazirlar.",
    citations: [
      {
        sourceSystem: "logo",
        sourceUri: "logo/docs/finance/cari-mutabakat.md",
        title: "Cari Mutabakat Proseduru",
        docType: "invoice_process",
        snippet: "Ekstre, acik fatura listesi, dekontlar ve mutabakat mektubu zorunlu belgelerdir.",
      },
      {
        sourceSystem: "kb",
        sourceUri: "KB-005",
        title: "Cari mutabakat icin gerekli belgeler",
        docType: "kb_article",
        snippet: "Standart belge kontrol listesi; surec kisiye bagimliliktan cikarilir.",
      },
    ],
    articleIds: ["KB-005"],
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
    sourceSystem: "kb",
    dataClass: "internal",
    keywords: ["kota", "quota", "floating ip", "limit", "instance", "erisilemiyor"],
    answerText:
      "KB-003 makalesine gore floating IP kotasi doldugunda:\n\nKok neden: kota proje limitine ulasmis; yeni instance IP alamadigi icin calisir ama disaridan erisilemez.\n\n1. Quota ekranindan floating IP kullanimini dogrula.\n2. Kullanilmayan IP'leri tespit et.\n3. Release islemi icin yetkili onayi al - bu riskli bir islemdir, asistan otomatik yapmaz.\n\nRead-only kota durumu sorgusu Cloud Ops rolu icin uygundur.",
    citations: [
      {
        sourceSystem: "kb",
        sourceUri: "KB-003",
        title: "Floating IP kotasi dolunca instance'a erisilemez",
        docType: "kb_article",
        snippet: "Kota dolulugunda instance IP alamaz; release onay gerektirir.",
      },
      {
        sourceSystem: "portvmind",
        sourceUri: "portvmind/docs/quota/quota-overview.md",
        title: "Quota Yonetimi Rehberi",
        docType: "product_doc",
        snippet: "Compute, volume ve network kotalari ayri ekranlarda izlenir.",
      },
    ],
    articleIds: ["KB-003"],
    confidence: 0.82,
  },
  {
    id: "onboarding-overview",
    sourceSystem: "runbooks",
    dataClass: "public",
    keywords: ["vmind", "nedir", "onboarding", "portvmind nedir", "vrpmind nedir", "urun"],
    answerText:
      "VMind urun ailesi kisa ozet:\n\n- PortvMind: compute, volume, network, Kubernetes, load balancer, object storage, quota ve billing modulleri iceren cloud console.\n- vRPMind: departmanlar arasi workflow, gorev, teklif, termin ve dashboard yonetimi.\n- SMAX: incident/request ticket sistemi; en sik problemler knowledge base makalesine cevrilir.\n- Logo: muhasebe ve finans surecleri.\n\nYeni baslayanlar icin onboarding dokumanlarindaki 'ilk hafta kontrol listesi' onerilir.",
    citations: [
      {
        sourceSystem: "runbooks",
        sourceUri: "runbooks/onboarding/vmind-products.md",
        title: "VMind Urun Ailesi - Onboarding Notu",
        docType: "product_doc",
        snippet: "PortvMind cloud console, vRPMind surec motoru, Problem KB ve SMAX sinyal sistemi ozetleri.",
      },
    ],
    articleIds: [],
    confidence: 0.78,
  },
];
