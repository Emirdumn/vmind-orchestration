---
title: Orbina ve VMind Firsat Analizi
status: draft
tags:
  - orbina
  - competitor-analysis
  - vmind
created: 2026-07-03
---

# Orbina ve VMind Firsat Analizi

## Kullanilan kaynaklar

- `/Users/emir/Downloads/Orbina Shared.pdf`
- `/Users/emir/Downloads/Orbina CXOS · Sektörel Sunum.pdf`
- `/Users/emir/Downloads/Orbina Ürünleri İçin Müşteri Analizi.docx`
- `/Users/emir/Downloads/Orbina Ürünleri İçin Müşteri Analizi-1.docx`
- Public vRPMind sayfasi: `https://www.vmind.com.tr/en/vrpmind`
- PortvMind public cloud login ve frontend rota envanteri: `https://tr-ist-01-console.portvmind.com/overview`

Not: PortvMind marketplace/overview ekrani login arkasinda kaldigi icin gercek UI davranisi dogrulanmadi. Frontend bundle icinde gorunen route/modul isimleri ayri sekilde isaretlendi.

## Orbina'dan cikan ana fikir

Orbina'nin guclu anlatimi:

- Tek AI beyni, coklu ajan.
- Bilgi, aksiyon ve insana devir seklinde uc katman.
- RAG ile dokuman omurgasi.
- API/tool entegrasyonlariyla siparis, iade, stok, randevu, ticket, belge isleme gibi aksiyonlar.
- Edge-case durumlarini insana temiz baglamla devretme.
- Kurumsal gosterimler: RBAC, LDAP/SSO, audit log, on-premise, air-gapped, local cloud, vLLM, Qdrant/RagFlow, MCP hub, Langfuse.

Orbina Shared sunumunda ozellikle su teknik iddialar one cikiyor:

- Sekiz cekirdek katman: Experience/UI, LLM access/routing, orchestration/agent workflow, IDP, observability, tooling/integrations, model runtime, RAG/knowledge layer.
- 15 modular HR tool: izin, bordro, resmi dokuman talebi, fazla mesai, egitim, masraf, kariyer, aday onerisi, yan hak, performans, payroll dispute, onboarding/offboarding, kidem/emeklilik, yan hak secimi, feedback.
- Agentic document extraction: tek OCR'a guvenmeyip birden fazla OCR/model ciktisini karsilastirma.
- Grounding: sayfa numarasi, koordinat/bounding box, semantik chunk ve markdown cikti.
- Kurumsal guvenlik: on-premise, air-gapped, veri ulke disina cikmaz iddiasi, Docker/container, obfuscated code.
- RBAC/LDAP/data lifecycle: departman bazli izolasyon, retention policy, audit logging.
- API-first entegrasyon: schema/prompt registry, HMAC-SHA256 webhook, SAP/RPA/CRM baglantilari.
- Performans: async processing, queue/retry, high concurrency.

## Orbina CXOS sunumundan cikan pazar mantigi

Orbina CXOS sektorel sunumu "10 sektor, 3 katman, tek operasyon" dilini kullaniyor.

Ana katmanlar:

- Katman 1: Bilgi. Dokuman, SSS, sirket politikalari.
- Katman 2: Aksiyon. Basit entegrasyonlar ve web altyapi entegrasyonlari.
- Katman 3: Kurumsal. Kullandiginiz uygulamalarla entegrasyon ve ozel gelistirme.

Sektorler:

- E-ticaret/D2C: siparis, iade, stok, marketplace.
- Perakende: LOGO, Mikro, Nebim, magaza bazli stok/kampanya/iade.
- Sigorta: police, hasar, yenileme, lead.
- Hospitality: PMS, rezervasyon, sikayet.
- Fintech: KYC, islem, kart, abonelik.
- Telekom: tarife, fatura, teknik destek.
- Saglik: HBYS, randevu, sonuc bildirimi.
- Otomotiv: DMS, servis randevu, model/fiyat.
- Lojistik: takip, sikayet, kurumsal musteri.
- Restoran: rezervasyon, siparis, alerjen, sikayet.

VMind icin bu mantik "sektor sunumu" yerine "kurum ici operasyon ve musteri operasyonu" halinde tekrar kurulabilir.

## VMind'in dogal avantaji

VMind'in rakipten daha iyi urun fikri gelistirebilecegi alanlar:

- Cloud operasyon verisi VMind'in kendi altyapisinda.
- PortvMind console zaten compute, volume, network, Kubernetes, load balancer, object storage, backup ve quota gibi somut moduller tasiyor.
- vRPMind zaten surec, gorev, workflow ve departmanlar arasi koordinasyon diline sahip.
- SMAX ticketlari, network ekibinin gercek incident hafizasi olarak cok degerli.
- Logo muhasebe kullanimi, finans sureclerine dokunan gercek kurumsal workflow firsati veriyor.
- VMind yerel cloud/on-prem/KVKK anlatimini kendi marka gucuyle daha inandirici kurabilir.

## PortvMind console route envanteri

Login arkasinda oldugu icin ekranlar test edilmedi, fakat public frontend bundle'da su yuzeyler gorundu:

- Overview ve dashboard.
- Compute: instances, instance create/detail, keypairs, snapshots, server groups.
- Volumes: volumes, volume detail, backup, restore.
- Network: security groups, networks, subnets, routers, ports, floating IPs.
- Kubernetes: home, clusters, cluster detail.
- Load balancer: load balancers, listener, pool, health monitor, pool member, key manager.
- Object storage: buckets, bucket detail, S3 API access keys.
- Product checkout: VPS checkout.
- Support ve API access.
- Quota: compute, volume, network, combined.
- Root kullanici modulleri: IAM users, billing home/account/cost management/payments/transactions/statement/invoices.

Bu envanter, ilk RAG botunun PortvMind icin "kullanim kilavuzu + operasyon rehberi + destek ticket triage" gorevlerini tasimasina yeterli bir isaret veriyor.

## Urun fikri

**VMind Agentic Operations Hub**, Orbina'nin musteri deneyimi asistanindan daha genis bir mantikla kurulabilir:

- Internal ops copilot.
- Cloud console copilot.
- vRPMind workflow copilot.
- SMAX ticket resolver.
- Logo finance assistant.
- Customer success / proposal assistant.

Kritik fark: VMind'in botu sadece "musteriyle konusmaz"; VMind ekiplerinin operasyonel islerini de hizlandirir.

## Ilk anlatim cumlesi

> VMind Agentic Operations Hub, VMind'in cloud, ticket, ERP/VRP ve muhasebe sistemlerindeki kurumsal hafizayi tek bir guvenli AI operasyon katmanina cevirir; cevap verir, kaynak gosterir, sistemden veri okur, onayli aksiyon baslatir ve kritik durumda dogru ekibe devreder.

