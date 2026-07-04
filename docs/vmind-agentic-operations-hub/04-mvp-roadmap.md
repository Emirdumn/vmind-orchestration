---
title: MVP Backlog ve Yol Haritasi
status: draft
tags:
  - mvp
  - roadmap
  - product
created: 2026-07-03
---

# MVP Backlog ve Yol Haritasi

## MVP hedefi

30 gun icinde calisan bir demo:

> Network ekibi ve stajyer kullanicilar, SMAX ticket gecmisi + runbook + vRPMind/PortvMind dokumanlari uzerinden kaynakli cevap alir; bot benzer ticket bulur, cozum adimi onerir, gerekiyorsa ticket taslagi ve insan devri uretir.

## Kapsam disi

- Otomatik muhasebe kaydi.
- Silme, release, payment, permission degisikligi gibi riskli cloud islemleri.
- Musteri verisiyle genis pilot.
- Fine-tuning.
- Tum sirket sistemlerine ayni anda entegrasyon.

## Hafta 1 - Kaynak ve izin

- SMAX'tan 50-100 anonim ticket export'u al.
- Network runbook/prosedurlerini topla.
- vRPMind surec dokumanlarini topla.
- PortvMind console yardim metinleri veya ekran rehberlerini topla.
- Logo icin sadece surec dokumanlariyla basla.
- Veri sinifi ve RBAC tablosunu onaylat.
- 30-50 soruluk ilk eval seti yaz.

## Hafta 2 - RAG temel demo

- Markdown/Obsidian tabanli kaynak deposu kur.
- Chunk metadata semasini uygula.
- Vector DB sec: Qdrant veya pgvector.
- Hybrid retrieval kur: vector + keyword.
- Cevaplarda kaynak goster.
- "Kaynak yoksa cevap verme" kuralini test et.
- Basit web chat veya CLI demo hazirla.

## Hafta 3 - Tool/API taslaklari

- SMAX read-only veya export tabanli benzer ticket arama.
- PortvMind modul envanteri ve read-only mock API.
- vRPMind process mock veya test ortami endpoint'i.
- Ticket taslagi ureten ama otomatik gondermeyen aksiyon.
- Audit log: soru, kaynak, karar, kullanici, zaman.

## Hafta 4 - Pilot ve olcum

- Network ekibiyle 10-20 gercek soru testi.
- Halusinasyon ve yetki reddi testleri.
- Kaynak kalitesi skoru.
- Eksik dokuman listesi.
- Demo anlatimi ve 5 slaytlik yonetici ozeti.

## Basari metrikleri

| Metrik | Hedef |
|---|---:|
| Kaynakli cevap dogrulugu | %85+ |
| Kaynak olmayan soruda uydurmama | %95+ |
| Benzer ticket bulma isabeti | %70+ |
| Ilk cevap suresi | < 5 sn |
| Yetkisiz veri reddi | %100 |
| Pilot memnuniyet | 4/5+ |

## Demo senaryolari

### Senaryo 1 - Network ticket cozum onerisi

Kullanici:

> Musteri VPN kopuyor diyor, daha once benzer ticket var mi?

Beklenen:

- Benzer SMAX ticketlari listeler.
- En sik cozum adimlarini kaynakli ozetler.
- Ilk kontrol listesini verir.
- Emin degilse network ekibine devreder.

### Senaryo 2 - PortvMind backup rehberi

Kullanici:

> Volume backup restore nasil yapilir, riskleri neler?

Beklenen:

- PortvMind backup/restore dokumanindan cevap verir.
- Restore'un hedef volume uzerine yazma riski gibi uyari verir.
- Islem yapmadan once onay gerektigini soyler.

### Senaryo 3 - vRPMind surec yardimi

Kullanici:

> Teklif surecinde muhasebe onayi bekliyor, sonraki adim ne olmali?

Beklenen:

- vRPMind surec mantigini aciklar.
- Sorumlu, termin ve gerekli belge kontrol listesini verir.
- Gerekirse gorev taslagi hazirlar.

### Senaryo 4 - Logo surec sorusu

Kullanici:

> Cari mutabakat icin hangi belgeler lazim?

Beklenen:

- Logo surec dokumanindan kaynakli yanit verir.
- Finans verisi gerekirse yetki kontrolu ister.
- Otomatik kayit yapmaz.

## Urunlestirme sonrasi paketler

- Internal Ops Assistant.
- Cloud Console Assistant.
- SMAX Ticket Resolver.
- vRPMind Process Copilot.
- Logo Finance Assistant.
- Customer Success Proposal Copilot.

