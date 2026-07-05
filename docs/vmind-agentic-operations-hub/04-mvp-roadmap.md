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

> Network ekibi ve stajyer kullanicilar, Problem KB + runbook + vRPMind/PortvMind dokumanlari uzerinden kaynakli cevap alir; SMAX yalnizca tekrar eden problem sinyali ve KB backlog onceligi icin kullanilir. Bot kaynak yoksa cozum uretmez, gerekiyorsa KB maddesi taslagi ve insan devri uretir.

## Kapsam disi

- Otomatik muhasebe kaydi.
- Silme, release, payment, permission degisikligi gibi riskli cloud islemleri.
- Musteri verisiyle genis pilot.
- Fine-tuning.
- Tum sirket sistemlerine ayni anda entegrasyon.

## Hafta 1 - Kaynak ve izin

- SMAX'tan tekrar eden 10 problem kategorisini anonim sinyal olarak cikar.
- Network runbook/prosedurlerini Problem KB maddelerine donustur.
- vRPMind surec dokumanlarini topla.
- PortvMind console yardim metinleri veya ekran rehberlerini topla.
- Logo icin sadece surec dokumanlariyla basla.
- Veri sinifi ve RBAC tablosunu onaylat.
- 30-50 soruluk ilk eval seti yaz.

## Hafta 2 - RAG temel demo

- Markdown/Obsidian tabanli Problem KB deposu kur.
- Chunk metadata semasini uygula.
- Vector DB sec: Qdrant veya pgvector.
- Hybrid retrieval kur: vector + keyword.
- Cevaplarda kaynak goster.
- "Kaynak yoksa cevap verme" kuralini test et.
- Basit web chat veya CLI demo hazirla.

## Hafta 3 - Tool/API taslaklari

- SMAX read-only veya export tabanli problem trend sinyali.
- PortvMind modul envanteri ve read-only mock API.
- vRPMind process mock veya test ortami endpoint'i.
- Problem KB maddesi taslagi ureten ama otomatik yayinlamayan aksiyon.
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
| Problem KB kapsama orani | %70+ |
| Ilk cevap suresi | < 5 sn |
| Yetkisiz veri reddi | %100 |
| Pilot memnuniyet | 4/5+ |

## Demo senaryolari

### Senaryo 1 - Network Problem KB onerisi

Kullanici:

> Musteri VPN kopuyor diyor, Problem KB'de hangi runbook'a bakmaliyim?

Beklenen:

- Problem KB/runbook maddesini kaynakli getirir.
- SMAX sinyallerini sadece tekrar eden problem kaniti olarak gosterir.
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
- Problem KB Assistant.
- vRPMind Process Copilot.
- Logo Finance Assistant.
- Customer Success Proposal Copilot.
