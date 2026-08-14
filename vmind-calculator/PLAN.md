# VMind Teklif Ajanı — Mimari & Faz Planı

> **Amaç:** VMind satış ekibinin doğal dille verdiği müşteri ihtiyacını (`"4 sunucu, load balancer olsun, worker olsun, premium disk, backup alsın"`) alıp,
> `calculator.portvmind.com` üzerinde eksiksiz ve tutarlı bir teklif (estimate) haline getiren, eksikleri **tespit edip öneren** multi-agent yapı.
>
> **Durum:** Faz 0–4 ve 6 tamamlandı, Faz 5 kodu bitti (eval ölçülmedi), Faz 7 başlamadı.
> Güncel durum ve komutlar: [README.md](README.md). Oturum notları: [CLAUDE.md](CLAUDE.md).

---

## ⚠ UYGULAMA SIRASINDA DÜZELTİLEN PLAN HATALARI

Bu plan Faz 0.A keşfine dayanıyordu. Uygulama sırasında **beş maddesi yanlış veya
eksik çıktı.** Aşağıda düzeltildi, ama okuyan kişi bilsin diye burada da toplu:

| # | Plandaki iddia | Gerçek |
|---|---|---|
| 1 | "Test hesabı kritik yolda, bugün talep edilmeli" (§5 risk tablosu) | **Hesap gerekmedi.** Calculator giriş yapmıyor; bundle'da herkese açık bir anahtar var. Katalog uçları hesapsız 200 dönüyor. |
| 2 | `POST /auth/signin` bir endpoint (EK-A.2) | **Endpoint değil.** Bundle'da bu string konsola giden bir `href`. Dolayısıyla 0.B'deki "token ömrü / otomatik yenileme" maddeleri de geçersiz — anahtar JWT değil. |
| 3 | EK-A.5 fiyat formülünü veriyor | **Yalnızca `Calculate()`'i veriyor.** Asıl mantık olan `CalculateService` (servis dallanmaları, 11 ek tuhaflık) hiç belgelenmemiş. Buna dayanıp port yazmak tahmin olurdu. |
| 4 | `compute.backup` şemasında `unit` yok (EK-A.4) | **Var** — ve motor onu okumadığı için **1024 kat düşük fiyatlama** yapan bir platform hatası. `description` alanı da eksikti. |
| 5 | 1.C: "platformda **elle** 5 teklif hazırlanır" | Form katmanı tıkandı; teklif `localStorage`'a yazılıp özet ekranından okundu. Daha hızlı ve **doğru katmanı** test ediyor (form değil, store→hesap→ekran). |

Ayrıca Faz 7'de iki **plan boşluğu** var — bkz. 7.A ve 7.C notları.

---

## 0. Yönetici Özeti — Mimarinin Tek Cümlelik Kuralı

> **LLM planlar, deterministik kod fiyatlar, LLM açıklar.**

Keşifte ortaya çıkan en kritik gerçek: **fiyat motoru sunucuda değil, frontend bundle'ının içinde.**
`CalculateService()` fonksiyonu tarayıcıda çalışıyor, backend sadece ürün kataloğunu veriyor ve teklif JSON'unu saklıyor.

Bunun üç sonucu var:

| Sonuç | Etkisi |
|---|---|
| Fiyat mantığı okunabilir ve **birebir porte edilebilir** | Ajan, tahmin yerine platformla %100 aynı sonucu üretebilir |
| Backend teklifi **doğrulamıyor**, ne gönderirsek onu saklıyor | Doğrulama sorumluluğu tamamen bizde → Kural Motoru (Faz 4) zorunlu |
| Kalem eklemek "opsiyonel alan doldurmak" demek | Eksik alan hata vermez, **sessizce 0 TL** olarak geçer → asıl risk bu |

**Sessiz sıfır problemi** bu projenin varlık sebebi. Örnek: Object Storage eklenir, `network` alanı boş bırakılır → data transfer hiç fiyatlanmaz, teklif düşük çıkar, müşteri faturayı görünce sorun yaşar. Ajanın birincil işi hesap yapmak değil, **bu boşlukları yakalayıp satışçıya sormak.**

---

## 1. Sistem Mimarisi

```
┌─────────────────────────────────────────────────────────────────┐
│  KATMAN 4 — AJANLAR (LLM / Claude Agent SDK)                    │
│  Orchestrator ─┬─ Requirement Extractor                          │
│                ├─ Solution Designer                              │
│                ├─ Completeness Auditor   ← projenin kalbi        │
│                └─ Reconciler & Presenter                         │
├─────────────────────────────────────────────────────────────────┤
│  KATMAN 3 — TOOL KATMANI (MCP Server, deterministik)            │
│  catalog.* │ estimate.* │ price.* │ validate.* │ publish.*       │
├─────────────────────────────────────────────────────────────────┤
│  KATMAN 2 — ÇEKİRDEK (saf TypeScript, LLM yok)                  │
│  Pricing Engine (port) │ Rule Engine │ Estimate Model            │
├─────────────────────────────────────────────────────────────────┤
│  KATMAN 1 — PLATFORM ERİŞİMİ                                     │
│  API Client (Bearer) │ Katalog Cache │ Playwright (yalnız PDF)   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
      tr-ist-01-api.portvmind.com/api/v1   +   calculator.portvmind.com
```

### 1.1 Neden bu ajan bölümlemesi

Ajan sayısını "çok ajan = iyi" diye değil, **farklı başarısızlık modlarını ayrıştırmak** için böldük:

| Ajan | Sorumluluk | Neden ayrı |
|---|---|---|
| **Requirement Extractor** | Serbest TR/EN metin → `RequirementSpec` (JSON) | Anlama hatası ile tasarım hatasını karıştırmamak için. Çıktısı satışçıya gösterilir: "seni doğru anladım mı?" |
| **Solution Designer** | `RequirementSpec` → `EstimateDraft` (servis kalemleri + `productCode`'lar) | Katalogdan ürün seçimi ayrı bir uzmanlık. **Kod uydurmak yasak**, sadece katalogdan seçebilir |
| **Completeness Auditor** | Draft'ı denetler → `Gap[]` (blocker / recommended / optional) | Tasarımı yapan, kendi eksiğini göremez. Bilinçli olarak **ayrı ve şüpheci** bir ajan |
| **Reconciler & Presenter** | Yerel hesap ↔ platform hesabı karşılaştırması, TR özet, link, PDF | Sunum ile doğrulama tek yerde; "rakam tutuyor mu" sorusunun tek sahibi |
| **Orchestrator** | Akış, insan onayı (HITL), tur yönetimi | Diğerleri stateless kalsın diye |

> **Not:** Auditor'ın kararlarının çoğu **kural motorundan** (deterministik) gelir. LLM sadece kuralların yakalayamadığı bağlamsal boşluklar için devreye girer ("müşteri e-ticaret dedi ama hiç yedeklilik yok"). Bu, halüsinasyon yüzeyini minimuma indirir.

### 1.2 Değişmez kurallar (tüm ajanlar için sistem promptunda)

1. **Fiyat hesaplama yok.** Tutar üretmenin tek yolu `price.calculate` tool'u.
2. **`productCode` uydurma yok.** Sadece `catalog.*` çıktısındaki kodlar kullanılır.
3. **Sessiz varsayım yok.** Bir alan doldurulmadıysa Gap kaydı açılır; "muhtemelen istememiştir" gerekçesi geçersiz.
4. **Yayınlama insan onayına bağlı.** `publish.*` tool'ları HITL onayı olmadan çağrılamaz.
5. **Birim yalnızca `GB` veya `TB`.** (Motorun davranışı için bkz. [EK-A.5](#a5--fiyat-motorunun-davranışı-kritik))

---

## 2. Faz Planı

Her faz **A / B / C** adımlarından oluşur. Her adımın somut bir **çıktısı** ve ölçülebilir bir **kabul kriteri** vardır.
**Faz sonundaki `GATE` geçilmeden sonraki faza başlanmaz.**

---

### FAZ 0 — Keşif & Erişim Doğrulama

**Hedef:** Platformun teknik gerçeğini varsayımsız olarak sabitlemek.

#### 0.A — Uç nokta ve veri modeli envanteri ✅ *(tamamlandı)*
- **Çıktı:** [EK-A](#ek-a--keşif-bulguları-doğrulanmış) — endpoint listesi, estimate şeması, 9 servis kodu, fiyat formülü
- **Kabul:** Teklif oluşturma akışının tüm endpoint'leri ve `list[].data` şeması belgelenmiş ✅

#### 0.B — Kimlik doğrulama & yetki modeli ✅ *(tamamlandı — plan yanlıştı)*

> **DÜZELTME (bkz. hata #1 ve #2).** Bu adım "servis/test hesabı gerekiyor, erken
> talep edilmeli" diye yazılmıştı. **Gerekmedi.** Calculator kullanıcı girişi
> yapmıyor; üretim bundle'ındaki axios interceptor her isteğe herkese açık bir
> anahtarı `Authorization: Bearer` olarak ekliyor:
>
> ```js
> cfg.headers.Authorization = "Bearer " + appConfig.apiKey;  // bundle'da gömülü
> ```
>
> `POST /auth/signin` bir API çağrısı değil, konsola giden bir bağlantı. Anahtar
> bcrypt görünümünde, JWT değil — **son kullanma tarihi taşımıyor**, dolayısıyla
> "token ömrü / otomatik yenileme" maddesi geçersiz.

- **Çıktı:** [docs/auth.md](docs/auth.md) + `.env.example`
- **Kabul:** ✅ `billing/products`, `compute/flavors`, `compute/volume-types` hesapsız **200** dönüyor
- **Kalan iş:** `billing/account` gibi hesaba özel uçlar **test edilmedi** — onlar için gerçek hesap gerekebilir. Ayrıca ajanın public anahtar yerine kendi servis hesabını kullanması bir **ürün kararı** (denetim izi, iptal edilebilirlik) ve VMind'a sorulmalı.

#### 0.C — Canlı katalog snapshot'ı `GATE` ✅
- **Yapılacak:** `billing/products`, `compute/flavors`, `compute/volume-types` çıktıları diske alınır; her ürünün `USD` ve `TRY` fiyatının **varlığı** kontrol edilir
- **Çıktı:** `fixtures/catalog/*.json` + `docs/catalog-report.md`
- **Kabul (GATE):**
  - [ ] 9 servis kodunun her biri için en az bir `productCode` eşleşiyor
  - [ ] Kullanılacak para biriminde fiyatı **olmayan** ürünler listelenmiş *(bu ürünler hesaplayıcıyı çökertir — bkz. EK-A.5)*
  - [ ] Share-link formatı canlıda teyit edilmiş — koddan çıkan format: `{calculatorUrl}/my-estimate/{estimateId}` (bkz. [EK-A.6](#a6--pdf-ve-paylaşım-linki-mekanizması))

---

### FAZ 1 — Domain Modeli & Şema Sözleşmesi

**Hedef:** Ajanların ürettiği her şeyin geçeceği tip güvenli sözleşmeyi kurmak.

#### 1.A — `EstimateModel` şeması ✅
- **Yapılacak:** 9 servisin `data` şeması JSON Schema + Zod olarak yazılır (EK-A.4'teki yapıya birebir uyumlu)
- **Çıktı:** `src/core/schema/*.ts`
- **Kabul:** EK-A.4'teki her iç içe alan (`compute.storage`, `compute.backup`, `object-storage.network`, `kubernetes.worker.storage` …) şemada mevcut ve **`optional` olma durumu platformdaki ile aynı**

#### 1.B — Katalog normalizasyonu ✅
- **Yapılacak:** `productCode ↔ flavor ↔ volumeType` eşleme tablosu; "premium disk", "worker", "app LB" gibi **satışçı jargonunu** koda çeviren sözlük
- **Çıktı:** `src/core/catalog/aliases.ts`
- **Kabul:** Sözlükte en az 30 Türkçe/İngilizce takma ad var; hiçbiri birden fazla `productCode`'a belirsiz eşleşmiyor

#### 1.C — Golden fixture'lar `GATE` ✅ *(tamamlandı — yöntem değişti)*

> **DÜZELTME (bkz. hata #5).** Plan "platformda **elle** 5 teklif hazırlanır"
> diyordu. Fixture 01 böyle alındı, ama form katmanı tıkandı (Cloudscape birim
> seçici üç farklı yöntemle de seçilmedi). Fixture 02–05 için teklif doğrudan
> `localStorage.VCLOUD_ESTIMATE`'e yazılıp sayfa yenilendi, tutarlar `/my-estimate`
> özet tablosundan okundu:
>
> ```js
> localStorage.setItem('VCLOUD_ESTIMATE', btoa(unescape(encodeURIComponent(JSON.stringify(estimate)))))
> ```
>
> Bu yöntem form katmanını **atlıyor** — bilerek: burada test edilen şey form
> değil, **store → `ServiceTotals` → ekran** yolu. Formun kendisi ayrı bir konu.

- **Çıktı:** `fixtures/golden/live-0{1..5}-*.json` + `tests/golden.spec.ts`
- **Kabul (GATE):**
  - [x] 5 fixture kayıtlı (ekran görüntüsü yerine **satır kırılımı** kaydedildi — daha güçlü: her satırın tutarı ayrı doğrulanıyor)
  - [x] Her fixture şemadan hatasız geçiyor
  - [x] **9 servis kodunun tamamı** kapsandı (plan ≥7 istiyordu); her iki para birimi de
  - [x] Testlerin başarısız olabildiği iki mutasyonla kanıtlandı

**Ekranda doğrulanan bonus:** gösterim basamağı ekrana göre değişiyor
(`/configure` 6/4 ondalık, `/my-estimate` 4/2) ve her ikisinde de yuvarlama
**yalnızca gösterim** — tutar değişmiyor. Detay: [docs/pricing-port-notes.md](docs/pricing-port-notes.md) §4.

---

### FAZ 2 — Deterministik Fiyat Motoru (Port) & Doğrulama

**Hedef:** Platformla **bit-bit aynı** hesap yapan, LLM'siz bir motor. Ajanın hiçbir zaman aritmetik yapmaması bu fazın çıktısına bağlı.

#### 2.A — `Calculate` / `CalculateService` portu ✅
- **Yapılacak:** EK-A.5'teki formül ve EK-A.4'teki servis dallanmaları TypeScript'e çevrilir. **Platformdaki tuhaflıklar dahil aynen kopyalanır** (720 saat kabulü, `GB` dışındaki birimin 1024 katsayısı, `estimatedCount = 0` iken backup'ın atlanması). Düzeltme yapılmaz — sapma, teklifin platformdan farklı çıkması demektir
- **Çıktı:** `src/core/pricing/engine.ts`
- **Kabul:** 5 golden fixture'ın tamamında toplam farkı **< 0.01**

#### 2.B — Diff harness ✅
- **Yapılacak:** `fixture → yerel motor → beklenen tutar` karşılaştırma testi; ayrıca satır bazlı (`lines[]`) karşılaştırma
- **Çıktı:** `tests/pricing.spec.ts`
- **Kabul:** Toplam **ve** satır kırılımı eşleşiyor (satır sırası hariç)

#### 2.C — Katalog drift dedektörü `GATE` ✅
- **Yapılacak:** Canlı katalog snapshot'ı ile fixture katalog karşılaştırılır; fiyat/ürün değişiminde uyarı üretilir. Günlük çalışacak
- **Çıktı:** `scripts/catalog-drift.ts` + CI adımı
- **Kabul (GATE):**
  - [ ] Testler CI'da yeşil
  - [ ] Fiyat değişimi simüle edildiğinde dedektör uyarı veriyor
  - [ ] **Karar:** drift tespit edildiğinde ajan durur mu, uyarıyla devam mı eder? Belgelenmiş olmalı

> 💡 Bu faz bittiğinde elinizde ajan olmadan da değerli bir şey var: **teklif fiyatını CLI'dan hesaplayan bir kütüphane.** Faz 5 gecikse bile bu kullanılabilir.

---

### FAZ 3 — Tool Katmanı (MCP Server)

**Hedef:** Ajanın dünyaya dokunduğu tek yüzey. Dar, tipli, yan etkisi belli.

#### 3.A — Salt-okunur tool'lar ✅
```
catalog.listServices()          → 9 servis + açıklama
catalog.searchProducts(q, svc)  → productCode + isim + fiyat
catalog.searchFlavors(vcpu?, ram?, gpu?)
catalog.listVolumeTypes()
```
- **Kabul:** Her tool cache'ten çalışıyor, ortalama < 50 ms; hiçbiri yazma yapmıyor

#### 3.B — Yerel state tool'ları *(platforma yazmaz)* ✅
```
estimate.create(name, currency)
estimate.addItem(service, data)     → şema doğrulaması, geçmezse hata
estimate.updateItem(id, patch)
estimate.removeItem(id)
estimate.read()                     → tam JSON
price.calculate()                   → satır kırılımı + toplamlar
validate.check()                    → Gap[] (Faz 4'te dolacak)
```
- **Kabul:** `addItem` geçersiz `productCode`'u **reddediyor**; tüm mutasyonlar geri alınabilir (undo log)

#### 3.C — Yayınlama tool'ları `GATE` ✅
```
publish.save()        → POST /billing/estimateplan  → { id, shareUrl }
publish.exportPdf()   → [opsiyonel] linki tarayıcıda açıp sitenin kendi PDF'ini indirir
```

**PDF'i site kendi üretiyor — biz üretmiyoruz.** Mekanizma ([EK-A.6](#a6--pdf-ve-paylaşım-linki-mekanizması)): `PrintView` bileşeni açıldığında DOM'u `html2canvas` ile görüntüye çevirip jsPDF ile A4 sayfalara bölüyor ve `doc.save()` ile indiriyor. Yani PDF, sayfanın **ekran görüntüsü**; kendi şablonumuzu yazmıyoruz, sadece var olan akışı tetikliyoruz.

Bunun iki sonucu var:

1. **`publish.exportPdf` kapsam dışına alınabilir.** `publish.save()` linki döndürdüğü an satışçı linki açıp PDF butonuna kendisi basabilir. Playwright'ın tek katkısı bu tıklamayı otomatikleştirmek — **fayda/karmaşıklık oranı düşük.** Öneri: **Faz 6'ya kadar sadece link teslim edilsin**, PDF otomasyonu pilot geri bildirimine göre eklensin.
2. **Yapılırsa tek gerçek katma değeri dosya adı.** Site PDF'i `crypto.randomUUID().pdf` olarak kaydediyor; satışçı için anlamsız. Otomasyon `{müşteri}-{tarih}.pdf` şeklinde yeniden adlandırmalı.

- **Kabul (GATE):**
  - [ ] `publish.*` çağrıları HITL onayı olmadan **reddediliyor** (testle kanıtlanmış)
  - [ ] `dry_run: true` varsayılan; gerçek yazma açık parametre gerektiriyor
  - [ ] Kaydedilen bir teklif linkten açıldığında **ajanın hesapladığı tutarı** gösteriyor
  - [ ] **Karar kaydı:** PDF otomasyonu bu sürümde var mı, yok mu — gerekçesiyle yazılmış

---

### FAZ 4 — Kural Motoru: Bağımlılık & Eksik Tespiti

**Hedef:** Projenin asıl değeri. "Object storage dedin ama data transfer yok" diyen katman.

#### 4.A — `rules.yaml` ✅
Kurallar veri olarak tutulur; satış ekibi kod yazmadan kural ekleyebilir.

```yaml
- id: OBJ_STORAGE_NO_TRANSFER
  severity: blocker
  when:  "item.service == 'object-storage' && !item.data.network"
  message: "Object Storage eklendi ama Network Data Transfer tanımlanmadı — dışarı çıkan trafik fiyatlanmıyor."
  ask: "Aylık tahmini indirme (egress) trafiği ne kadar? (GB/TB)"

- id: COMPUTE_NO_BLOCK_STORAGE
  severity: recommended
  when:  "item.service == 'compute' && !item.data.storage"
  message: "Sunucuda yalnızca flavor'ın yerel diski var; kalıcı block storage yok."

- id: LB_WITHOUT_HA
  severity: recommended
  when:  "has('load-balancer') && totalComputeCount < 2"
  message: "Load Balancer var ama arkasında tek sunucu — yüksek erişilebilirlik sağlanmıyor."

- id: BACKUP_ZERO_COUNT
  severity: blocker
  when:  "item.data.backup && (item.data.backup.estimatedCount ?? 0) == 0"
  message: "Backup seçili ama saklanacak yedek adedi 0 — platform bu kalemi 0 TL olarak geçiyor."

- id: FLOATING_IP_DOUBLE_COUNT
  severity: blocker
  when:  "hasStandalone('floating-ip') && anyItem('compute', i => i.data.floatingIp)"
  message: "Floating IP hem ayrı servis hem compute altında tanımlı — çift fiyatlanma riski."

- id: NO_PUBLIC_ACCESS
  severity: recommended
  when:  "has('compute') && !anyFloatingIp() && !has('load-balancer')"
  message: "Hiçbir kaynağın public IP'si yok; dışarıdan erişim planlanmamış."
```

- **Çıktı:** `rules/*.yaml` + `src/core/rules/engine.ts`
- **Kabul:** ≥ 15 kural; her kuralın `severity` + `message` + (gerekiyorsa) `ask` alanı dolu

#### 4.B — Severity semantiği ✅
| Seviye | Anlam | Davranış |
|---|---|---|
| `blocker` | Teklif matematiksel olarak yanlış/eksik olur | Onay ekranı geçilemez, çözülmeden yayınlanamaz |
| `recommended` | Teknik olarak çalışır ama muhtemelen istenen bu değil | Satışçıya sorulur, "biliyorum, böyle kalsın" ile geçilebilir |
| `optional` | Upsell fırsatı | Sadece raporda listelenir |

- **Kabul:** Her severity için ≥ 3 kural mevcut

#### 4.C — Regresyon seti `GATE` ✅
- **Yapılacak:** Her kural için 1 pozitif (kural tetiklenmeli) + 1 negatif (tetiklenmemeli) fixture
- **Kabul (GATE):**
  - [ ] Tüm kurallar için pozitif/negatif testler geçiyor
  - [ ] **Yanlış pozitif oranı** ölçülmüş: 5 golden fixture üzerinde hatalı `blocker` sayısı **= 0**
  - [ ] Kural motoru LLM'siz çalışıyor (bağımsız çalıştırılabilir)

---

### FAZ 5 — Multi-Agent Katmanı

**Hedef:** Faz 2–4'te kurulan deterministik iskeleti doğal dile bağlamak.

#### 5.A — Requirement Extractor 🟡 *(kod bitti, eval ÖLÇÜLMEDİ)*
- **Yapılacak:** TR/EN serbest metin → `RequirementSpec` (structured output zorunlu). Belirsizlikler `unknowns[]` alanına yazılır, **uydurulmaz**
- **Kabul:** 10 gerçek satış cümlesinden ≥ 9'unda çıkarılan spec insan değerlendirmesiyle doğru

#### 5.B — Solution Designer 🟡 *(kod bitti, eval ÖLÇÜLMEDİ)*
- **Yapılacak:** `RequirementSpec` → `EstimateDraft`. Yalnızca `catalog.*` + `estimate.*` tool'larını kullanır. Her seçim için `rationale` yazar ("premium disk → `VT-SSD-PREM`")
- **Kabul:** 10 senaryoda hiç uydurma `productCode` yok (tool zaten reddeder — **reddedilme sayısı da metrik**, sıfıra yakın olmalı)

#### 5.C — Auditor + Reconciler + Orchestrator `GATE` ✅ *(deterministik iskelet testli)*
- **Yapılacak:**
  - Auditor: `validate.check()` çalıştırır, kural çıktısını satışçının anlayacağı Türkçeye çevirir, üstüne bağlamsal gözlem ekler
  - Reconciler: yerel `price.calculate()` ↔ platformdan geri okunan teklif toplamı karşılaştırması
  - Orchestrator: `Anla → Tasarla → Denetle → Sor → Düzelt → Onay → Yayınla` döngüsü
- **Kabul (GATE):**
  - [ ] Uçtan uca senaryo (aşağıdaki [§3](#3-uçtan-uca-örnek-akış)) tam çalışıyor
  - [ ] Reconciler farkı **< 0.01**; fark varsa akış **durup** rapor ediyor
  - [ ] Auditor tur sayısı ≤ 3 (sonsuz soru-cevap döngüsü yok)

---

### FAZ 6 — İnsan Onayı (HITL) & Sunum

#### 6.A — Soru turu disiplini ✅
- **Yapılacak:** Auditor'ın soruları önceliklendirilir; **tek turda en fazla 5 soru**, hepsi varsayılan cevaplı ("boş bırakırsan: 1 TB egress varsayacağım")
- **Kabul:** Satışçı 5 sorunun tamamını atlayabiliyor; sistem varsayılanlarla ilerleyip **hangi varsayımı yaptığını raporda yazıyor**

#### 6.B — Onay ekranı ✅
- **Yapılacak:** Yayın öncesi tablo: kalemler, birim, adet, aylık tutar, toplam + çözülmemiş Gap listesi. `blocker` varsa onay butonu kapalı
- **Kabul:** Onaysız hiçbir `publish.*` çağrısı yapılamıyor (log ile kanıt)

#### 6.C — Teslim `GATE` 🟡 *(link ✅, PDF kapsam dışı, gerçek yayın HİÇ çalıştırılmadı)*
- **Yapılacak:** `publish.save()` → link; `publish.exportPdf()` → PDF; Türkçe kapanış özeti + upsell notları
- **Kabul (GATE):**
  - [ ] Link açıldığında platform, ajanın gösterdiği tutarı gösteriyor
  - [ ] PDF iniyor ve okunabilir
  - [ ] Özet, yapılan **varsayımları** ve **önerilen eklemeleri** ayrı başlıkta listeliyor

---

### FAZ 7 — Eval & Üretim

#### 7.A — Eval seti ❌
- **Yapılacak:** 20 senaryo, her biri için beklenen kalem seti + tutar aralığı
- **Kabul:** ≥ %90 senaryoda kalem seti doğru, ≥ %95'inde tutar beklenen aralıkta

> **✅ KARAR (2026-08-06):** Geçmiş teklif beklenmeyecek. Planın önceki hali
> senaryoları "gerçek geçmiş tekliflerden türetilmiş" diye şartlıyordu ve bu
> maddeyi VMind'a bağımlı kılıyordu. **Bu bağımlılık kaldırıldı.**
>
> Gerekçe: sistemin doğruluk ölçütü "geçmişte ne teklif edilmiş"e benzemek değil,
> **teklifin teknik olarak tutarlı olması.** Bunun referansı zaten elimizde —
> katalog (24 flavor, 44 ürün) ve platformun kendi fiyat motoru. Senaryolar
> Faz 8'deki envanter kısıtlarından türetilecek.
>
> **Not:** Faz 5 için 10+10 senaryoluk eval harness'ı zaten var (`evals/`),
> ama ölçülmedi — LLM anahtarı gerekiyor. 7.A onun üstüne kurulur.

#### 7.B — Guardrail & telemetri ❌
- **Yapılacak:** Tool çağrı logları, token/maliyet takibi, "ajan kaç kez uydurma kod denedi" sayacı, PII taraması
- **Kabul:** Her teklif için tam denetim izi (audit trail) saklanıyor

#### 7.C — Pilot `GATE` ❌
- **Yapılacak:** 2 satış temsilcisiyle 2 hafta paralel kullanım (ajan + elle, karşılaştırmalı)

> **⚠ PLAN BOŞLUĞU:** "%60 azalmış" kriteri **ölçülemez** — çünkü şu anki elle
> hazırlama süresi hiç ölçülmemiş. Baseline olmadan yüzde hesaplanamaz.
> **Pilot başlamadan önce** 2 satışçının mevcut süreçle kaç dakikada teklif
> hazırladığı ölçülmeli (birkaç günlük basit kayıt yeterli). Aksi halde bu
> GATE hiçbir zaman kanıtlanamaz.

- **Kabul (GATE):**
  - [ ] Teklif hazırlama süresi **≥ %60 azalmış** *(baseline ölçümü önkoşul)*
  - [ ] Ajanın yakaladığı, insanın kaçırdığı eksik sayısı raporlanmış
  - [ ] Kritik hata (yanlış tutarla müşteriye giden teklif) sayısı **= 0**

---

### FAZ 8 — Configurator Zekâsı: Envanter-Farkında Doğrulama

**Hedef:** Cisco'nun kendi configurator'ındaki davranış. Orada bir cihaz kurmaya
kalkınca sistem *"storage seçmeyi unuttun"* ya da *"bu power supply buna yetersiz
kalır"* der. Bizde **birincisi var, ikincisi yok.**

#### Neden yeni bir faz — mevcut kural motorunun sınırı

`rules/estimate-rules.yaml` içindeki 20 kural incelendiğinde iki sınıf ortaya çıkıyor:

| Sınıf | Soru | Örnek | Durum |
|---|---|---|---|
| **1 — Eksik bileşen** | "Alan boş mu?" | `OBJ_STORAGE_NO_TRANSFER`, `COMPUTE_NO_BLOCK_STORAGE` | ✅ 20/20 kural bu sınıfta |
| **2 — Yetersizlik / uyumsuzluk** | "Seçilen şey bu işi kaldırır mı?" | *"bu makinenin yerel diski yok"*, *"3 master gerekir"* | ❌ **hiç yok** |

Teknik sebep net: **kural motoru envanteri göremiyor.** `src/core/rules/engine.ts`
katalogu yalnızca `hasUnknownProductCode()` için kullanıyor; ifade kapsamında
`flavor.vcpus`, `flavor.disk`, `computeFamily` gibi tek bir alan bile yok. Yani
kurallar *"alan dolu mu"* diye sorabiliyor, *"seçilen makine bu işi kaldırır mı"*
diye soramıyor. Sınıf 2'nin tamamı bu yüzden yazılamamış.

#### 8.A — Envanter erişimi (ifade kapsamı genişletmesi)
- **Yapılacak:** `expr` kapsamına salt-okunur katalog yardımcıları eklenir:
  `flavor(code)` → `{name, vcpus, ram, disk, ephemeralDisk, vgpus, vram, computeFamily}`
  `product(code)` → `{service, productName, prices}` · `volumeType(code)`
  Türev yardımcılar: `sumBlockStorageGB()`, `instanceCount()`, `sumEgressGB()`
- **⚠ Kısıt:** `expr.ts`'in prototip zinciri kapalı; alan okuması `scope[name]`
  haline **geri döndürülmeyecek** (bkz. CLAUDE.md — kum havuzu ilk sürümde delinmişti)
- **Kabul:** Her yardımcı için pozitif/negatif test; kum havuzu testleri hâlâ geçiyor

#### 8.B — Yetersizlik kuralları
**Katalogdan çıkan en kritik bulgu:** 24 flavor'ın **20'sinde `disk = 0` ve
`ephemeralDisk = 0`. Bu makinelerin yerel diski yok** — block storage eklenmezse
işletim sistemi kurulacak yer yok, instance açılmaz. Bugün bu durum yalnızca
`recommended` seviyesinde (`COMPUTE_NO_BLOCK_STORAGE`) ve **flavor'a hiç bakmıyor.**
Yerel diski olan 4 flavor için gereksiz uyarı, olmayan 20 flavor için ise
yetersiz uyarı üretiyor. Sınıf 2'nin varlık sebebi tam olarak bu.

Kural taslakları:

| id | severity | koşul (özet) |
|---|---|---|
| `FLAVOR_NO_LOCAL_DISK` | **blocker** | `flavor(pc).disk == 0 && flavor(pc).ephemeralDisk == 0 && !data.storage` |
| `K8S_MASTER_QUORUM` | **blocker** | `master.count` ∈ {1,3,5} değil → etcd çoğunluğu kurulamaz |
| `BACKUP_EXCEEDS_SOURCE` | recommended | `backup.sourceSize > sumBlockStorageGB()` — yedeklenecek veri sağlanan diskten büyük |
| `BACKUP_UNDER_PROTECTED` | recommended | `backup.sourceSize < sumBlockStorageGB() * 0.5` |
| `GPU_NEEDS_FAST_DISK` | recommended | `flavor(pc).computeFamily == 'GPU'` ve standart HDD seçili |
| `EGRESS_IMPLAUSIBLE` | recommended | `sumEgressGB() > storedGB * 100` — oransız trafik tahmini |
| `FIP_EXCEEDS_INSTANCES` | recommended | `floatingIp.count > instanceCount()` — atıl IP |
| `LB_BACKEND_CAPACITY` | recommended | `LB-001` (2C2GB) arkasında eşiğin üzerinde sunucu |
| `HIGH_MEM_FAMILY_MISMATCH` | optional | `computeFamily == 'High Memory Purpose'` ama iş yükü profili bunu gerektirmiyor |

- **Kabul:** ≥ 9 yeni kural; her biri için pozitif **ve** negatif fixture;
  5 golden fixture üzerinde **yanlış pozitif = 0**

#### 8.C — İş yükü profili & öneri motoru `GATE`
- **Yapılacak:** LLM girdiden `workloadProfile` çıkarır (e-ticaret · veritabanı ·
  dev/test · video-CDN · K8s platformu). Profil başına **beklenen bileşen seti**
  YAML'da veri olarak tutulur; kural motoru profile göre eksikleri raporlar.
  Öneriler **fiyat etkisiyle** sunulur: *"+2 sunucu ≈ +1.210 TL/ay"*
- **Rol dağılımı:** profil çıkarımı LLM'in, kontrol deterministik motorun.
  LLM asla "şu yetersiz" demez — yalnızca profili adlandırır
- **Kabul (GATE):**
  - [ ] 5 profil tanımlı, her biri için beklenen bileşen listesi
  - [ ] Her öneri fiyat etkisiyle birlikte gösteriliyor
  - [ ] 5 golden fixture üzerinde yanlış pozitif = 0
  - [ ] **Cisco testi:** bilerek bozulmuş 10 teklifin **10'unda** doğru uyarı üretiliyor
        (disksiz flavor, 2 master, atıl IP, oransız egress, aşırı backup …)

> **Performans notu — Redis gerekir mi?**
> Şu an gerekmiyor. Deterministik yol (katalog → şema → fiyat → kural) tamamen
> bellekte ve **milisaniye** ölçeğinde; 635 test 8,5 saniyede koşuyor. Tek gerçek
> gecikme kaynağı **LLM çağrısı** (saniyeler) ve onu Redis hızlandırmaz.
> Önce sırasıyla: ① prompt caching ② extractor/designer çağrılarının
> paralelleştirilmesi ③ profil çıkarımı için küçük model.
> Redis'i **çok örnekli (multi-instance) dağıtıma geçilirse** — oturum state'i ve
> katalog cache'i paylaşmak için — gündeme al. Tek konteyner + birkaç satışçıda
> eklenen karmaşıklık kazancından büyük.

---

## 3. Uçtan Uca Örnek Akış

**Girdi (satışçı):**
> "Müşteri 4 sunucu istiyor, load balancer olsun, worker olsun, premium disk olsun, backup olsun."

| # | Aktör | Eylem |
|---|---|---|
| 1 | Requirement Extractor | `{compute: {count: 4}, loadBalancer: true, storage: "premium", backup: true, unknowns: ["worker → Kubernetes worker node mu, uygulama sunucusu mu?", "egress trafiği", "backup adedi", "disk boyutu"]}` |
| 2 | Orchestrator | `unknowns` içinde **kritik belirsizlik** var → tasarıma geçmeden 1 netleştirme sorusu: *"'Worker' derken Kubernetes worker node mu kastediliyor?"* |
| 3 | Solution Designer | Cevaba göre `compute` × 4 + `load-balancer` + her compute'a `storage` (premium volume type) + `backup` |
| 4 | Completeness Auditor | Kural motoru → **3 blocker**: ① backup adedi 0 ② LB'de data transfer yok ③ hiçbir kaynakta public IP yok. **2 recommended**: object storage önerisi, ikinci AZ |
| 5 | Orchestrator | Satışçıya 5 soruluk tek tur (hepsi varsayılanlı) |
| 6 | Solution Designer | Cevaplarla draft güncellenir |
| 7 | Reconciler | Yerel toplam **=** platform toplamı ✓ |
| 8 | Presenter | Onay ekranı → onay → link + PDF + *"Şu varsayımları yaptım: … Şunları eklemenizi öneririm: …"* |

**Kritik nokta:** 4. adımdaki 3 blocker'ın hepsi, elle hazırlanan tekliflerde **sessizce 0 TL** olarak geçerdi. Sistemin geri dönüşü buradan geliyor.

---

## 4. Teknoloji Seçimleri

| Katman | Seçim | Gerekçe |
|---|---|---|
| Dil | **TypeScript** | Platformun modeli zaten JS; port bire bir yapılabilir, şema paylaşılır |
| Ajan | **Claude Agent SDK** | Alt-ajan, structured output, tool orkestrasyon hazır |
| Tool | **MCP Server** | Tool katmanı ajandan bağımsız test edilebilir; Claude Code'dan da çağrılır |
| Şema | **Zod + JSON Schema** | Tek kaynak, hem runtime hem LLM tool tanımı |
| Kural | **YAML + küçük evaluator** | Satış ekibi kural ekleyebilsin |
| PDF | **Playwright** | Client-side üretim, başka yolu yok |
| Test | **Vitest** | Golden fixture diff'leri için yeterli |

### Önerilen dizin yapısı
```
vmind-price-calculator-agent/
├── PLAN.md
├── docs/            auth.md · catalog-report.md · findings.md
├── fixtures/        catalog/ · golden/
├── rules/           *.yaml
├── src/
│   ├── platform/    api-client.ts · auth.ts · pdf.ts
│   ├── core/        schema/ · pricing/ · rules/ · catalog/
│   ├── mcp/         server.ts · tools/
│   └── agents/      orchestrator · extractor · designer · auditor · presenter
└── tests/
```

---

## 5. Riskler

| Risk | Etki | Önlem |
|---|---|---|
| **Fiyat motoru portu sapar** | Teklif platformdan farklı çıkar, güven biter | Faz 2 golden fixture testleri + günlük drift kontrolü |
| Frontend bundle güncellenir, mantık değişir | Sessiz sapma | Bundle hash izleme; değişince Faz 2 testleri zorunlu tekrar |
| Katalog `productCode` değişir | Ajan geçersiz kod üretir | Tool seviyesinde reddetme + drift dedektörü |
| Seçili para biriminde fiyatı olmayan ürün | **Hesaplayıcı çöker** (bkz. EK-A.5) | Faz 0.C'de tespit, tool seviyesinde ön kontrol |
| Auditor gereksiz uyarı yağdırır | Satışçı sistemi kapatır | Faz 4.C yanlış-pozitif = 0 kriteri; severity disiplini |
| ~~Test hesabı gecikir~~ | ~~Faz 0.B ve sonrası bloke~~ | ✅ **RİSK DÜŞTÜ (hata #1).** Hesap gerekmedi; katalog erişimi bundle'daki public anahtarla çalışıyor. Yalnızca **yazma** (`POST /billing/estimateplan`) ve `billing/account` için hesap kararı gerekiyor. |
| Ajan onaysız teklif yayınlar | Müşteriye yanlış teklif gider | `dry_run` varsayılan + HITL testi (3.C) |

---

## 6. Sıradaki Adım

> Bu bölüm başlangıçta "VMind test hesabı talebi" ile başlıyordu — o adım
> **gereksiz çıktı** (hata #1). Güncel hâli:

### Hiçbir şeye bağlı olmayan (şimdi yapılabilir)

1. **Faz 7.B** — telemetri, denetim izi, "kaç kez uydurma kod denendi" sayacı, PII taraması
2. Kural sayısını artırmak, sunum katmanını zenginleştirmek

### Bekleyen — VMind / bütçe kararı

| # | İş | Bağlı olduğu |
|---|---|---|
| 3 | Faz 5.A/5.B eval **ölçümü** | ~$5 LLM kredisi (OpenRouter veya Anthropic) |
| 4 | Faz 6.C gerçek yayın + canlı mutabakat | VMind yazma erişimi **+ açık onay** (gerçek teklif oluşur) |
| 5 | Faz 7.A 20 senaryo | **geçmiş gerçek teklifler** — bkz. 7.A boşluk notu |
| 6 | Faz 7.C pilot | 2 satışçı × 2 hafta **+ baseline süre ölçümü** — bkz. 7.C boşluk notu |
| 7 | `billing/account` ucu | VMind hesabı |
| 8 | Servis hesabı kararı (public anahtar mı, kendi hesabı mı) | VMind |
| 9 | `compute.backup` TB hatasının VMind'a bildirimi | VMind |

### Kararı belgelenmemiş konular

- **%20 fiyat drift eşiği** (`MAJOR_PRICE_CHANGE_RATIO`) VMind'ın olağan zam aralığına göre teyit edilmeli
- **PDF otomasyonu** kapsam dışı bırakıldı (3.C'nin önerdiği gibi) — onay bekliyor
- **20 kuralın severity ataması** satış ekibince gözden geçirilmeli (`rules/estimate-rules.yaml` kod bilmeden düzenlenebilir)

---

# EK-A — Keşif Bulguları *(doğrulanmış)*

> Kaynak: `https://calculator.portvmind.com/assets/index-DsenZ_4u.js` (1.94 MB, `Last-Modified: 2026-07-13`) statik analizi + canlı endpoint probe'ları.

### A.1 — Teknoloji
- Vite + React + Redux Toolkit SPA, **AWS Cloudscape** tasarım sistemi
- Cloudflare arkasında; PDF için `jsPDF` + `html2canvas` (**client-side**)
- API host: `https://tr-ist-01-api.portvmind.com/api/v1`
- Panel/konsol: `https://tr-ist-01-console.portvmind.com`

### A.2 — Endpoint'ler
| Endpoint | Kullanım |
|---|---|
| ~~`POST /auth/signin`~~ | ⛔ **ENDPOINT DEĞİL** (hata #2). Bundle'da bu string konsola giden bir `href`: `<a href={`${panelUrl}/auth/signin`}>`. Calculator hiç giriş yapmıyor. |
| `GET /billing/products` | Ürün + fiyat kataloğu |
| `GET /compute/flavors` | Instance tipleri (`id, name, vcpus, ram, vgpus, vram, disk`) |
| `GET /compute/volume-types` | Block storage tipleri |
| `POST /billing/estimateplan` | Teklif kaydet → `{ key: <uuid>, json: "<stringified estimate>" }` |
| `GET /billing/estimateplan/{id}` | Teklif oku (paylaşım linkinin temeli) |
| `GET /billing/account` | Hesap bilgisi |

**Doğrulandı:** `estimate/products`, `estimate/flavors`, `billing/products` → kimliksiz **401**. Bearer token zorunlu.
*(`estimate/products` ve `estimate/flavors` string'leri Redux thunk adları; HTTP yolu değil.)*

> **EK (0.B'de bulundu):** "Bearer token zorunlu" doğru ama yanıltıcı — token
> **bundle'da gömülü ve herkese açık**. Her ziyaretçinin tarayıcısı bunu
> gönderiyor. Hesap gerekmiyor; bkz. 0.B ve [docs/auth.md](docs/auth.md).

### A.3 — Estimate modeli
```jsonc
{
  "id": "<uuid>",              // crypto.randomUUID()
  "name": "My Estimate",
  "currency": "USD",
  "list": [
    { "id": "<uuid>", "service": "<serviceCode>", "data": { /* A.4 */ } }
  ]
}
```
Kaydetme: `POST /billing/estimateplan` body → `{ key: estimate.id, json: JSON.stringify(estimate) }`

### A.4 — 9 servis kodu ve `data` şemaları

| Kod | Başlık |
|---|---|
| `compute` | Compute |
| `storage` | Block Storage |
| `data-transfer` | Network Data Transfer |
| `floating-ip` | Floating IP |
| `load-balancer` | Load Balancer |
| `kubernetes` | Kubernetes |
| `object-storage` | Object Storage |
| `router` | Router |
| `backup` | Backup |

> **DÜZELTME (hata #4):** aşağıdaki `compute` şeması iki alan eksikti —
> `description` ve `backup.unit`. İkincisi bir **platform hatası** barındırıyor.

```ts
compute: {
  productCode, count,
  description?,                                     // ← EKSİKTİ: arayüz üretiyor, fiyata girmez
  network?:    { productCode, traffic, unit },      // ← yoksa egress fiyatlanmaz
  storage?:    { productCode, size, unit, volumeTypeName? },  // size × count
  backup?:     { productCode, sourceSize, estimatedCount,
                 unit? },                           // ← EKSİKTİ ve ⛔ MOTOR BU ALANI OKUMUYOR
                                                    //    (aşağıdaki uyarı)
  floatingIp?: { productCode, count },
  router?:     { floatingIp?: {...}, network?: {...} }
}
storage:        { productCode, size, unit, volumeTypeName? }
data-transfer:  { productCode, traffic, unit }
floating-ip:    { productCode, count }
backup:         { productCode, sourceSize, unit, estimatedCount }   // unit==="TB" → ×1024
load-balancer:  { productCode /* LB-001=App, diğeri=Net */, network?: {...} }
object-storage: { storage?: {...}, network?: {...} }               // ← ikisi de opsiyonel!
router:         { floatingIp?: {...}, network?: {...} }
kubernetes:     { master: { productCode, count, storage? },
                  worker: { productCode, count, storage? } }
```

> ### ⛔ PLATFORM HATASI — `compute.backup.unit` yazılıyor ama okunmuyor
>
> Arayüz compute içindeki Backup bölümünde **GB/TB seçici** sunuyor ve seçimi
> `data.backup.unit` alanına yazıyor. Ancak fiyat motoru compute dalında birimi
> **sabit `"GB"`** geçiriyor ve bu alanı hiç okumuyor:
>
> ```js
> Calculate(est, backup.productCode, count * backup.sourceSize * estimatedCount, "GB")
> ```
>
> Sonuç: satışçı **"1 TB" seçse bile teklif 1 GB olarak fiyatlanır** — 1024 kat
> düşük, hata yok, uyarı yok. Standalone `backup` servisinde bu hata **yok**;
> orada `unit === "TB"` açıkça kontrol ediliyor.
>
> Bu hata **bizim ajanımızdan bağımsız** — elle hazırlanan tekliflerde de var.
> Port davranışı aynen taşıyor (düzeltmek sapma olurdu); yakalama işi
> `COMPUTE_BACKUP_TB_IGNORED` kuralında. **VMind'a bildirilmeli.**

### A.5 — Fiyat motorunun davranışı *(kritik)*

> ### ⛔ DÜZELTME (hata #3) — bu bölüm formülün YALNIZCA YARISI
>
> Aşağıdaki `Calculate()` tek bir kalemin tutarını hesaplıyor. Ama teklifin
> tutarını belirleyen şey **hangi kalemin nasıl toplandığı** — yani
> `CalculateService()`. O fonksiyon bu planda **hiç belgelenmemiş** ve içinde
> aşağıdaki 4 tuhaflığa ek olarak **7 tuhaflık daha** var:
>
> - Data transfer kalemleri **saatlik toplama eklenmez** (satırda `hourly: "-"`)
> - `compute.storage` miktarı `size × count`; **kubernetes'te ise sonuç** `count` ile çarpılır
> - `load-balancer` için özet satırı yazılmaz, yalnızca `lines` kaydı
> - Standalone `backup` TB→GB çevrimini `Calculate` **dışında** yapıp `"GB"` geçer
> - Backup satır etiketi miktarı GB'ye çevirir ama **orijinal birimle** yazar (`3 backups x 2048 TB`)
> - compute alt kalemlerinin `flavorCode` alanına **compute'un** kodu yazılır
> - Özet metinlerinde çift boşluk
>
> **Bu bölüme dayanıp port yazmak tahmin olurdu.** Uygulama sırasında üretim
> bundle'ı indirilip `CalculateService` ve `ServiceTotals` birebir çıkarıldı;
> çıkarılan kod `tests/reference/vmind-reference.mjs` içinde test *oracle*'ı
> olarak duruyor. 12 tuhaflığın tamamı ve gerekçeleri:
> [docs/pricing-port-notes.md](docs/pricing-port-notes.md).

```js
Calculate(estimate, productCode, qty = 1, unit) {
  const product = estimate.lookup.products.result.items
                    .find(p => p.productCode === productCode);
  if (!product) return { hourly: 0, monthly: 0 };            // ⚠ sessiz sıfır

  const priceObj = product.prices.find(p => p.currency === estimate.currency);
  const price    = priceObj.price;                            // ⚠ priceObj yoksa TypeError

  if (unit) qty *= (unit === "GB" ? 1 : 1024);                // ⚠ "MB" de ×1024 olur
  const hourly  = price * qty;
  let   monthly = price * qty * 720;
  if (priceObj.pricingUnit !== "HOUR") monthly = price * qty; // saatlik değilse doğrudan
  return { hourly, monthly };
}
```

**Kural motorunu doğrudan besleyen dört davranış:**

1. **Bilinmeyen `productCode` → 0 TL, hata yok.** Ajanın uydurduğu bir kod fark edilmeden teklife girer → tool seviyesinde reddetme zorunlu.
2. **Seçili para biriminde fiyat yoksa `undefined.price` → hesaplayıcı çöker.** Faz 0.C'de tüm katalog taranmalı.
3. **Birim `"GB"` değilse otomatik ×1024.** `"MB"` yazılırsa 1024 kat şişer → şema `GB | TB` ile sınırlanmalı.
4. **Aylık = saatlik × 720.** Sabit kabul; ay uzunluğu dikkate alınmaz. Port bunu aynen korumalı.

**Toplam:** `ServiceTotals` tüm `list` kalemlerini gezip `CalculateService` sonuçlarını toplar. Backend hiçbir doğrulama yapmaz.

### A.6 — PDF ve paylaşım linki mekanizması

`PrintView` bileşeninden (bundle'dan sadeleştirilmiş):

```js
function PrintView({ input }) {
  const ref = useRef(null);
  const shareUrl = `${appConfig.calculatorUrl}/my-estimate/${input.data.id}`;

  const generate = async () => {
    const canvas = await html2canvas(ref.current, { scale: 2, useCORS: true });
    const img    = canvas.toDataURL("image/png");
    const doc    = new jsPDF("p", "mm", "a4");
    const w = doc.internal.pageSize.getWidth();
    const h = doc.internal.pageSize.getHeight();
    const ratio = w / canvas.width;
    const imgH  = canvas.height * ratio;
    let left = imgH, offset = 0;
    while (left > 0) {                       // A4 sayfalarına böl
      doc.addImage(img, "PNG", 0, offset, w, imgH);
      left -= h;
      if (left > 0) { doc.addPage(); offset = -(imgH - left); }
    }
    doc.save(`${crypto.randomUUID()}.pdf`);  // ⚠ rastgele dosya adı
  };

  useEffect(() => { setTimeout(() => generate().finally(dismiss), 1); }, []);
}
```

**Çıkarımlar:**

| Bulgu | Sonuç |
|---|---|
| PDF = DOM'un `html2canvas` görüntüsü | Metin **aranabilir/seçilebilir değil**, görsel. Kendi şablonumuzu yazmıyoruz |
| `useEffect` içinde otomatik tetikleniyor | Modal açıldığı an üretim başlıyor; buton tıklama yarışı yok |
| Dosya adı `crypto.randomUUID().pdf` | Satışçı için anlamsız → otomasyon yapılırsa yeniden adlandırma şart |
| Üretim sonrası modal kendini kapatıyor (`dismiss`) | Otomasyonun indirme olayını beklemesi gerekir, DOM'u değil |
| **Paylaşım linki: `{calculatorUrl}/my-estimate/{estimateId}`** | `estimate.id` = `POST /billing/estimateplan` gövdesindeki `key`. Yani link **saf API ile**, tarayıcısız üretilebilir |

Son satır pratikte en önemlisi: **teklif linkini hiç tarayıcı açmadan verebiliyoruz.** `publish.save()` → `id` → link. Tarayıcı yalnızca PDF için gerekli, o da opsiyonel.
