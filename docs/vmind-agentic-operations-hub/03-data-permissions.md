---
title: Veri Kaynaklari ve Izin Matrisi
status: draft
tags:
  - data-governance
  - kvkk
  - rbac
created: 2026-07-03
---

# Veri Kaynaklari ve Izin Matrisi

## Kaynak envanteri

| Kaynak | Ilk kullanim | Risk | MVP modu |
|---|---|---:|---|
| vRPMind dokumanlari | Surec, gorev, teklif ve departman akislari | Orta | RAG + read-only |
| PortvMind console dokumanlari | Cloud kaynak rehberi, quota, backup, network, K8s | Orta | RAG + read-only |
| SMAX ticketlari | Incident cozum hafizasi, kategori/oncelik onerisi | Yuksek | Anonim export + RAG |
| Logo surec dokumanlari | Fatura, cari, mutabakat, odeme akis rehberi | Yuksek | RAG |
| Logo API/veri | Fatura/cari durum sorgu | Cok yuksek | Read-only pilot |
| Public VMind web | Urun aciklamasi, satis dili, public bilgi | Dusuk | RAG |
| Kurum ici politika/runbook | Prosedur ve teknik cozum | Orta/Yuksek | RAG + RBAC |

## Veri siniflari

- `public`: public web, urun sayfasi, genel dokuman.
- `internal`: kurum ici prosedur, teknik kilavuz, egitim notu.
- `confidential`: musteri sozlesmesi, fiyat, ticari bilgi.
- `pii`: kisi adi, telefon, e-posta, TCKN, adres, calisan bilgisi.
- `financial`: fatura, cari, tahsilat, odeme, banka verisi.
- `secret`: API key, sifre, private key, token, lisans anahtari.

## MVP icin minimum guvenlik

- SSO veya LDAP rol bilgisi olmadan departman verisi acilmaz.
- SMAX exportlari anonimlestirilmeden vector store'a alinmaz.
- Logo verisi ilk fazda sadece dokuman seviyesinde islenir.
- Secret degerler asla embedding'e girmez.
- Her cevap icin kaynak ve audit trace tutulur.
- Kullanici yetkisizse cevap yerine dogru surec/ekip yonlendirmesi yapilir.

## RBAC matrisi

| Rol | Gorebilecegi bilgi | Yapabilecegi islem |
|---|---|---|
| Stajyer | Public + secili internal onboarding | Soru sorma, kaynak gorme |
| Network | Network runbook, anonim/izinli SMAX ticket | Ticket ozetleme, taslak cozum |
| Muhasebe | Logo surec dokumani, izinli finans ozetleri | Fatura surec sorusu, taslak kontrol listesi |
| Cloud Ops | PortvMind kaynak rehberi ve read-only durum | Kaynak durum sorgu, risk raporu |
| Satis/CS | vRPMind surec, public urun, musteri notlari | Teklif/surec ozeti, takip taslagi |
| Admin | Sistem ayarlari, audit, connector sagligi | Yetki, kaynak ve connector yonetimi |

## Ingestion kontrol listesi

- Kaynak sahibi belli mi?
- Veri sinifi belli mi?
- Yetki grubu belli mi?
- Guncel mi?
- PII/secret taramasi yapildi mi?
- Chunk'lar kaynakla geri izlenebilir mi?
- Cevap eval setine eklendi mi?
- Retention suresi belli mi?

## SMAX ticketlari icin on isleme

1. Ticket ID korunabilir, kisi/musteri bilgisi maskelenir.
2. Baslik, kategori, etki, oncelik, cozum, kapanis notu ayrilir.
3. "Cozuldu" ve "tekrar acildi" bilgisi etiketlenir.
4. Benzer ticket gruplari cluster edilir.
5. Her cozum adimi guven skoru alir.
6. Bot cevaplarinda "gecmis ticketlara gore" ifadesi kullanilir.

## Logo icin guvenli baslangic

Logo entegrasyonu ilk fazda otomatik muhasebe kaydi yapmamali.

Baslangic senaryolari:

- "Bu fatura sureci icin hangi belgeler lazim?"
- "Cari mutabakat adimlari neler?"
- "Bu tip odeme icin hangi onaylar gerekir?"
- "Eksik belge kontrol listesi cikar."

Read-only pilot sonrasi:

- Fatura durum sorgu.
- Cari ozet.
- Vade/odeme hatirlatma.
- Mutabakat taslagi.

