---
title: VMind Agentic Operations Hub
status: draft
owner: Emir
tags:
  - vmind
  - rag
  - agentic-ai
  - product-strategy
created: 2026-07-03
---

# VMind Agentic Operations Hub

Calisma adi: **VMind Agentic Operations Hub**.

Amac: VMind'in mevcut guclu taraflarini, yani PortvMind cloud operasyonlari, vRPMind surec yonetimi, SMAX ticket verisi, Logo muhasebe akislari ve kurum ici dokuman hafizasini tek bir RAG + agent orkestrasyon katmaninda birlestirmek.

Bu fikir klasik chatbot degil. Dogru konumlandirma: **dokumandan cevap veren, sistemden veri okuyan, uygun durumda islem baslatan ve riskli durumda insana temiz baglamla devreden operasyon asistani**.

## Neden VMind icin mantikli?

- VMind zaten cloud, managed service ve is sureci tarafinda gercek operasyon verisine sahip.
- vRPMind, public sayfada satis otomasyonu ve surec yonetimini departmanlar arasi workflow, gorev, kaynak, termin, faturalama, hedef takibi ve dashboard mantigi ile anlatiliyor.
- PortvMind console yuzeyi compute, network, volume, backup, Kubernetes, load balancer, object storage, quota, support, API access, IAM ve billing gibi operasyonel modullere sahip.
- Network ekibi SMAX ticket verisiyle tekrar eden sorun/cevap kaliplarini uretebilir.
- Muhasebe Logo kullandigi icin fatura, cari, tahsilat, mutabakat ve masraf akislari icin net tool adaylari var.
- Kurum ici dokumanlar, prosedurler ve ticket gecmisi iyi islenirse VMind'e ozel bir bilgi avantaji olusur.

## Urun pozisyonu

**Tek cumle:** VMind Agentic Operations Hub, calisanlarin ve musterilerin VMind sistemleriyle dogal dil uzerinden guvenli, kaynakli ve aksiyon alabilir sekilde calismasini saglayan kurumsal AI operasyon katmanidir.

Rakipten ayrisma noktasi:

- Orbina tarafindaki "Bilgi -> Aksiyon -> Devir" mantigi korunur.
- VMind tarafinda buna cloud operasyon bilgisi, vRPMind surec motoru, SMAX ticket hafizasi ve Logo finans gercekligi eklenir.
- Yani sadece musteri deneyimi asistani degil, **IT + cloud + surec + finans operasyon yardimcisi** olur.

## Katman modeli

```mermaid
flowchart LR
    U["Kullanici kanallari\nWeb chat, Slack/Teams, WhatsApp, portal, vRPMind"]
    G["Guardrails\nKVKK, RBAC, rate limit, policy check"]
    O["Primary Orchestrator\nintent, routing, confidence"]
    R["RAG Knowledge Layer\ndokuman, runbook, ticket hafizasi"]
    T["Tool/API Layer\nSMAX, Logo, vRPMind, PortvMind, CRM"]
    H["Human Handoff\nnetwork, muhasebe, destek, satis"]
    A["Audit + Observability\ntrace, kaynak, karar, maliyet, latency"]

    U --> G --> O
    O --> R
    O --> T
    O --> H
    R --> O
    T --> O
    O --> A
```

## Progressif urun paketleri

### Katman 1 - Bilgi

Sadece dokuman ve ticket hafizasi uzerinden kaynakli cevap verir.

Ornekler:

- "Bu hata daha once nasil cozulmus?"
- "vRPMind'de teklif sureci hangi asamada ilerler?"
- "Musteriye VPS yedekleme politikasini nasil anlatirim?"
- "Logo'da fatura mutabakati icin hangi belge gerekir?"

### Katman 2 - Okuma ve sorgulama

Yetkili sistemlerden read-only veri ceker.

Ornekler:

- SMAX ticket durumu ve benzer ticketlar.
- PortvMind kota, instance, volume, backup veya floating IP durumu.
- vRPMind surec asamasi, sahip, termin, bekleyen gorev.
- Logo cari/fatura durum ozeti.

### Katman 3 - Kontrollu aksiyon

Kullanici onayi ve audit ile islem baslatir.

Ornekler:

- SMAX ticket taslagi olusturma veya kategori onerisini uygulama.
- vRPMind'de gorev acma, sorumlu atama, SLA hatirlatma.
- Logo tarafinda muhasebe kaydi degil, once taslak/onerilen islem olusturma.
- PortvMind icin backup gorevi veya destek talebi taslagi olusturma.

### Katman 4 - Agentic operasyon

Birden fazla sistemi sirali ve kuralli calistirir.

Ornek:

1. Musteri "sunucum yavas" der.
2. Asistan PortvMind kaynak durumunu okur.
3. Benzer SMAX ticketlarini getirir.
4. Runbook'a gore ilk kontrol listesini uygular.
5. Cozum bulunmazsa network ekibine temiz ozetle devir yapar.
6. vRPMind'de musteri surecine not duser.

## Ilk hedef persona'lar

- Network ekibi: ticket triage, tekrar eden incident cozumleri, runbook arama.
- Muhasebe: Logo dokumanlari, fatura/cari surec sorulari, mutabakat kontrol listesi.
- Satis ve operasyon: vRPMind surecleri, teklif ve musteri takip bilgisi.
- Cloud operasyon: PortvMind kaynak, kota, backup, network, Kubernetes ve support akis bilgisi.
- Stajyer / yeni calisan: kurum ici bilgiye guvenli erisim ve onboarding.

## Ilgili notlar

- [01 - Orbina ve VMind Firsat Analizi](01-orbina-vmind-analysis.md)
- [02 - RAG ve Agent Mimari Semasi](02-rag-agent-architecture.md)
- [03 - Veri Kaynaklari ve Izin Matrisi](03-data-permissions.md)
- [04 - MVP Backlog ve Yol Haritasi](04-mvp-roadmap.md)
- [05 - Bot Davranis Kurallari ve Degerlendirme](05-bot-guardrails-eval.md)
