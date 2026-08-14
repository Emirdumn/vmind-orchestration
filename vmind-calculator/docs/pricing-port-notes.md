# Fiyat Motoru Portu — Kaynak ve Doğrulama Notları

> **Faz 2.A / 2.B çıktısı.** Bu belge, `src/core/pricing/engine.ts`'in *neden* böyle
> yazıldığını açıklar. Motorda bir şey "yanlış" görünüyorsa cevap büyük ihtimalle burada.

## 1. Kaynak nasıl elde edildi

PLAN EK-A.5 yalnızca `Calculate()` fonksiyonunu içeriyordu; **servis dallanmaları
(`CalculateService`) belgelenmemişti.** Tahminle port etmek yerine üretim bundle'ı
indirilip fonksiyonlar birebir çıkarıldı:

```
https://calculator.portvmind.com/assets/index-DsenZ_4u.js   (1.939.751 bayt)
```

Minify sonrası da fonksiyon adları korunmuş (`Calculate`, `CalculateService`,
`ServiceTotals`, `blockStorageLineName`), bu yüzden tam gövdeler çıkarılabildi.

Çıkarılan kod `tests/reference/vmind-reference.mjs` içinde **bozulmamış** duruyor
ve testlerde *oracle* olarak kullanılıyor. Yani Faz 2.B'nin doğruladığı şey
"port kendi içinde tutarlı mı" değil, **"port platformun kendi koduyla aynı sonucu
veriyor mu"**.

> ⚠ Bu dosya elle düzenlenmemeli. Bundle güncellendiğinde yeniden çıkarılmalı
> (aşağıdaki §5).

## 2. Korunan platform tuhaflıkları

Hiçbiri düzeltilmedi. Düzeltmek, teklifin müşterinin ekranda gördüğü tutardan
farklı çıkması demek.

| # | Davranış | Sonucu |
|---|---|---|
| 1 | Bilinmeyen `productCode` → sessizce `0`, hata yok | Uydurma kod fark edilmeden teklife girer → tool katmanında reddetme zorunlu |
| 2 | Aylık = saatlik × **720** | Ayın gerçek uzunluğu yok sayılır |
| 3 | `unit !== "GB"` ise miktar **×1024** | `"MB"` yazılırsa 1024 kat şişer → şema `GB \| TB` ile sınırlı |
| 4 | `pricingUnit !== "HOUR"` ise aylık = `fiyat × miktar` | `NETW-OUT-001` (GB) ve `pvExpress-*` (UNIT) ×720 almaz |
| 5 | Data transfer kalemleri **saatlik toplama eklenmez** | Satırda `hourly: "-"`, yalnızca aylık toplanır |
| 6 | `backup.estimatedCount === 0` → kalem **tamamen atlanır** | Satır bile oluşmaz; sessiz 0 TL |
| 7 | `compute.storage` miktarı `size × count`; **kubernetes'te ise sonuç** `count` ile çarpılır | Aynı matematik, farklı sıra — aynen korundu |
| 8 | `load-balancer` için özet satırı yazılmaz (yalnızca `lines` kaydı) | Sunumdaki asimetri kasıtlı değil ama korunuyor |
| 9 | Standalone `backup`'ta TB→GB çevrimi **Calculate dışında** yapılır, sonra `"GB"` geçilir | Çift ×1024 olmaz; compute içindeki backup'ta `unit` alanı hiç yoktur |
| 10 | compute alt kalemlerinin `flavorCode` alanına **compute'un** kodu yazılır | Network satırında bile flavor kodu görünür |
| 11 | Özet metinlerinde çift boşluk (`100 GB␣␣Block Storage`) | Metin karşılaştırması yapan testler için önemli |

### 12. `compute.backup.unit` yazılıyor ama hiç okunmuyor — **platform hatası**

Canlı arayüzde doğrulandı. Compute içindeki Backup bölümü GB/TB seçici sunuyor ve
seçimi `data.backup.unit` alanına yazıyor:

```json
"backup": { "productCode": "BC-001", "sourceSize": 1, "unit": "GB", "estimatedCount": 1 }
```

Ancak fiyat motoru compute dalında birimi **sabit `"GB"`** geçirir ve bu alanı hiç okumaz:

```js
Calculate(est, backup.productCode, count * backup.sourceSize * estimatedCount, "GB")
```

Sonuç: satışçı **"1 TB" seçse bile teklif 1 GB olarak fiyatlanır** — 1024 kat düşük,
hata yok, uyarı yok. Standalone `backup` servisinde bu hata **yok**; orada
`unit === "TB"` açıkça kontrol edilir.

Port bu davranışı aynen taşır (düzeltmek sapma olurdu) ve `tests/golden.spec.ts`
ile kilitlenmiştir. Düzeltme kural motorunun işi: `compute.backup.unit === "TB"`
görülürse **blocker** üretilmeli.

> EK-A.4 bu alanı hiç listelemiyordu — yalnızca canlı arayüzde ortaya çıktı.

### Tek kasıtlı sapma

Seçili para biriminde fiyat yoksa platform ham bir `TypeError` fırlatır
(`undefined.price`). Port aynı noktada tipli `MissingPriceError` fırlatır.
**Zamanlama ve değerler aynı**, yalnızca hata teşhis edilebilir.

## 3. Diff harness kapsamı

`tests/pricing.spec.ts` — **162 test**, hepsi referansa karşı toleranssız (`toBe`,
epsilon yok) karşılaştırma. Tutarlara ek olarak `lines[]` ve `summary[]` de
karşılaştırılır: metin ayrışması, tutar henüz tutuyorken mantığın ayrıldığının
erken sinyalidir.

| Grup | İçerik |
|---|---|
| Senaryolar | 9 servisin tüm dalları, TL ve USD için ayrı ayrı |
| Kombinatoryal | `compute`'un 5 opsiyonel alt dalının **32 kombinasyonu** |
| Çok kalemli | `ServiceTotals` yolu, boş teklif ve "sessiz sıfır tuzağı" dahil |
| Katalog taraması | **Her ürün tek tek**, kendi `pricingUnit`'i ile |

### Harness'in gerçekten başarısız olabildiği kanıtlandı

Bir diff harness'ın değeri, sapmayı yakaladığını göstermekten gelir. İki mutasyon denendi:

| Mutasyon | Sonuç |
|---|---|
| `720` → `730` | **137 / 162 test kırmızı** (geçen 25'i sıfır maliyetli veya `pricingUnit != HOUR` olanlar — doğru davranış) |
| `estimatedCount > 0` → `>= 0` | **2 test kırmızı** — tam olarak "backup adedi 0" senaryoları |

Her iki mutasyon geri alındı; `main` durumu 246/246 yeşil.

## 4. Ekran doğrulaması (Faz 1.C — tamamlandı)

Önceki sürümde "biçimleme yalnızca gösterim katmanı" **varsayılmıştı**. Artık
tarayıcıda ölçüldü ve `tests/golden.spec.ts` ile kilitlendi.

**5 fixture, 9/9 servis, her iki para birimi.** Toplamlar *ve satır kırılımı*
karşılaştırılıyor.

| Fixture | Kapsam | Para birimi |
|---|---|---|
| 01 | compute + inline storage + inline backup | USD |
| 02 | load-balancer, compute, floating-ip, data-transfer | USD |
| 03 | object-storage, data-transfer | USD |
| 04 | kubernetes (master/worker + disk) | TL |
| 05 | router, storage, backup | TL |

### Gösterim basamağı ekrana göre değişiyor

| Ekran | Hourly | Monthly |
|---|---|---|
| `/configure/*` | 6 ondalık | 4 ondalık |
| `/my-estimate` | 4 ondalık | 2 ondalık |

Her iki ekranda da yuvarlama **yalnızca gösterim** — ham değer daha fazla
basamak taşıyor ve tutar değişmiyor.

### Ekranda doğrulanan tuhaflıklar

- **#2 (×720)** — fixture 01'de doğrudan ölçüldü
- **#5 (data transfer saatliğe girmez)** — fixture 02'de toplam saatlik `0.1747`,
  data transfer'in `99.53`'ü dahil değil; ekranda o satır `-` gösteriliyor
- **#7b (kubernetes storage: sonuç × count)** — fixture 04'te worker disk satırı
  `Worker - 4 instances x 1 TB` ve tutar `14.3261 TL/saat`
- **#9 (standalone backup etiket tuhaflığı)** — fixture 05'te satır etiketi
  `3 backups x 2048 TB`: miktar GB'ye çevrilmiş ama **orijinal birimle** yazılmış

### Nasıl toplandı

Fixture 01 konfigürasyon formunu doldurarak alındı. Fixture 02–05 için teklif
`localStorage.VCLOUD_ESTIMATE`'e yazılıp (base64 +
`btoa(unescape(encodeURIComponent(...)))`) sayfa yeniden yüklendi, tutarlar
`/my-estimate` özet tablosundan okundu.

İkinci yöntem form katmanını atlıyor — bilerek: burada test edilen şey form
değil, **store → `ServiceTotals` → ekran** yolu. Testlerin başarısız olabildiği
iki mutasyonla doğrulandı (yanlış satır tutarı ve yanlış `-` işareti; ikisi de
doğru testte yakalandı).

## 5. Bundle değişirse ne yapılmalı

`index-DsenZ_4u.js` içindeki hash, içerik değişince değişir. Faz 2.C'deki drift
dedektörü bunu izlemeli. Bundle değiştiğinde:

1. Yeni bundle indirilir, `Calculate`/`CalculateService`/`ServiceTotals` yeniden çıkarılır
2. `tests/reference/vmind-reference.mjs` **değiştirilir**
3. `npm test` çalıştırılır — kırmızıya dönen her test, platformun mantığının
   değiştiği ve portun güncellenmesi gerektiği anlamına gelir

Bu, PLAN §5'teki "frontend bundle güncellenir, mantık değişir → sessiz sapma"
riskinin somut karşılığıdır.
