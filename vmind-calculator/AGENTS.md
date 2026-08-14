# VMind Teklif Ajanı — oturum notları

Mimari, faz planı ve keşif bulguları: [PLAN.md](PLAN.md). Durum ve komutlar:
[README.md](README.md). Bu dosya yalnızca **koddan türetilemeyen** şeyleri içerir.

---

## ⛔ `src/core/pricing/engine.ts`'i DÜZELTMEYE ÇALIŞMA

Bu dosya platformun üretim bundle'ından **birebir port**. İçindeki 12 tuhaflık
bilerek korunuyor ve hepsi dosyada numaralı yorumlarla işaretli. "Bariz hata"
gibi görünen her biri kasıtlı:

- Aylık = saatlik × **720** (ayın gerçek uzunluğu yok sayılır)
- Data transfer kalemleri **saatlik toplama eklenmez**, satırda `hourly: "-"`
- `unit !== "GB"` ise miktar **×1024** (yani `"MB"` de şişirir)
- `backup.estimatedCount === 0` → kalem **tamamen atlanır**, satır bile oluşmaz
- Bilinmeyen `productCode` → sessizce `0`, hata yok

Bir sapma, teklifin müşterinin ekranda gördüğü tutardan farklı çıkması demek.
Gerekçeler: [docs/pricing-port-notes.md](docs/pricing-port-notes.md).

**`tests/reference/vmind-reference.mjs` elle düzenlenmez.** Platformun kendi
kodunun bozulmamış kopyası; testlerde *oracle* olarak çalışıyor. Sapmayı ancak
bozulmadığı sürece yakalar. Bundle değişirse yeniden çıkarılır (port-notes §5).

## 🔑 İki farklı anahtar — karıştırmak yarım saat kaybettirdi

| Anahtar | Ne için | Durum |
|---|---|---|
| `VMIND_API_KEY` | Katalog, fiyat, teklif kaydetme | Opsiyonel — bundle'daki public anahtarla çalışıyor |
| `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` | Satışçı cümlesini anlayan model | **Yok** — `npm run eval` bunu ister |

VMind anahtarı Türkçe cümle yorumlamaz; LLM anahtarı fiyat vermez. `npm run eval`
"kimlik bilgisi yok" derse eksik olan **LLM** anahtarıdır.

## Platform gerçekleri (belgelerde yazmıyor)

- Para birimi kodu **`TL`** — `TRY` değil. `TRY` hiçbir fiyatla eşleşmez, her
  kalem sessizce 0 olur.
- Yalnızca **TL ve USD** kullanılabilir. Katalogda EUR fiyatı da var ama 6
  üründe eksik; EUR seçilse platformun hesaplayıcısı `undefined.price` ile çöker.
- `flavor.id` **doğrudan** `productCode`'dur. Ayrı bir eşleme yok.
- **`compute.backup.unit` bir platform hatasıdır.** Arayüz GB/TB seçici sunuyor
  ve seçimi bu alana yazıyor, ama fiyat motoru compute dalında birimi sabit
  `"GB"` geçirip alanı hiç okumuyor → TB seçilirse teklif **1024 kat düşük**.
  Standalone `backup` servisinde bu hata yok. Port bunu aynen taşıyor;
  düzeltme `COMPUTE_BACKUP_TB_IGNORED` kuralının işi.
- Teklif `localStorage.VCLOUD_ESTIMATE`'e **base64** olarak kaydediliyor:
  `btoa(unescape(encodeURIComponent(JSON.stringify(e))))`. Golden fixture'lar
  bu yolla toplandı.
- Backend teklifi **hiç doğrulamıyor** — ne gönderilirse saklıyor. Bu yüzden
  kural motoru (Faz 4) opsiyonel değil.
- **`estimateplan` zarfı POST ile GET'te farklı.** Aynı alan adı, farklı tip:

  | | Gövde |
  |---|---|
  | `POST /billing/estimateplan` | `{"result":{"success":true},"item":true}` — `item` **boolean** |
  | `GET /billing/estimateplan/{key}` | `{"result":{...},"item":"{\"id\":…}"}` — `item` **JSON string** |

  Gönderirken alan adı `json`, geri okurken `item`. `parseRemoteEstimate` ilk
  sürümde `json` bekliyordu; taklit veriyle tüm testler geçiyordu ama gerçek
  yayınlamada patlıyordu (2026-07-30'da ilk canlı yazmada görüldü).
- **Olmayan teklif için de HTTP 200 dönüyor**, gövdede
  `result.success: false` + `"Estimate plan not found."`. HTTP durumuna güvenmek
  boş teklifi "başarı" sayardı — `result.success` kontrolü zorunlu.
- **`shareUrl` doğru:** sakladığımız `key` ile geri okunan `data.id` **aynı**
  (canlı ölçüldü). Backend kendi id'sini atamıyor.
- Bundle'ın public anahtarı **yazma da yapabiliyor** — `POST estimateplan`
  200/`success:true` döndü. Yani yayınlamanın önündeki tek engel teknik değil,
  bizim koyduğumuz dört kapı.

## Çalışma sırası

**Katalog değişince:** `npm run snapshot:catalog` → sonra `npm test`. Testler
`fixtures/catalog/*.json` snapshot'ına karşı çalışır; sıra ters olursa testler
eski katalogla geçer.

**Kural eklerken:** `rules/estimate-rules.yaml` **veri**, kod değil — satış ekibi
düzenleyebilsin diye. Her yeni kuralın `tests/rules.spec.ts`'te pozitif **ve**
negatif vakası olmak zorunda; test vakası olmayan kural testi kırar.

**`ask` yazan her kuralın `default`'u olmalı** — Faz 6.A'nın "satışçı tüm
soruları atlayabilmeli" kriteri buna dayanıyor, test bunu zorluyor.

## Test disiplini

Bu projede bir test yazıldıktan sonra **başarısız olabildiği kanıtlanır.**
Fiyat motoru, drift dedektörü ve golden fixture'lar için mutasyon testi yapıldı
(`720`→`730`, `> 0`→`>= 0`, satır tutarı bozma). Yeni bir doğrulama katmanı
eklerken aynısını yap — geçen bir test, yakalayabildiğini kanıtlamaz.

## Yayınlama — dört kapı

`publish.save` sırasıyla: `dryRun` varsayılan `true` → blocker varsa red → HITL
onayı yoksa red → API istemcisi salt-okunursa red.

**`dryRun: false` 2026-07-30'da bir kez çalıştırıldı** (kullanıcı onayıyla,
`npm run publish:test -- --live`). VMind'da kalıcı bir `[TEST]` teklifi oluştu:
`1c659e42-fd08-44d8-9b86-1158513120d9`. **Silme ucu bilinmiyor.**

Her canlı çalıştırma kalıcı kayıt bırakır — kullanıcı onayı olmadan çalıştırma.
Auto mode denemeleri engelliyor; bu doğru davranış, aşmaya çalışma.

## 🎯 Sistemin asıl teslimatı: calculator linki

Ürünün amacı kendi ekranımızda fiyat göstermek **değil** — satışçının kalemleri
tek tek elle girmesini ortadan kaldırmak. Calculator bunu zaten destekliyor:

```js
// bundle: MyEstimate bileşeni
const { id } = useParams();                  // rota: /my-estimate/:id
ws.getEstimate(id).then(res => {
  dispatch(importEstimate(JSON.parse(res.item)))   // DÜZENLENEBİLİR duruma
```

Yani zincir: **cümle → ajan → `POST /billing/estimateplan` →
`calculator.portvmind.com/my-estimate/{id}` → hesap dolu ve düzenlenebilir.**

- `EstimateSession.toEstimate()` çıktısı calculator'ın sakladığı yapıyla
  **birebir aynı**: `{id, name, currency, list:[{id, service, data}]}`.
  `fixtures/golden/*` canlı arayüzden toplandığı için bu karşılaştırılabilir.
- 2026-07-31'de doğrulandı: dün kaydedilen teklif calculator'da tam olarak
  açıldı, tutar (₺2.143,15) motorumuzunkiyle birebir tuttu.
- **Bu yüzden SSO / Application Credential bir engel değil** — o yalnızca kendi
  arayüzümüze giriş içindi. Asıl akış VMind'dan hiçbir şey gerektirmiyor.

`WEB_ALLOW_PUBLISH=1` bunu açar. **Varsayılan kapalı** ve öyle kalmalı: yanlış
yapılandırılmış bir sunucu sessizce kalıcı kayıt üretmemeli.

`approval.grant`'ı ajanın kendi kendine çağırmaması tool katmanında teknik
olarak engellenemiyor — bilinçli bir sınır, sistem promptuyla zorlanıyor.

## Kural motorunda `eval` yok

`src/core/rules/expr.ts` küçük bir ifade değerlendiricisi. Kurallar satış
ekibince yazılacağı için prototip zinciri **kapalı**: `constructor` /
`__proto__` / `prototype` okunamaz. İlk sürümde bu açıktı ve
`constructor.constructor('...')()` ile kum havuzu delinebiliyordu. Alan okumasını
`scope[name]` haline geri döndürme.

## Dosya notları

- `key.key` — gitignore'da, **asla commit edilmez**
- `evals/` — gerçek LLM çağrısı yapar, `npm test`'e dahil değil
- `EVAL_LIMIT=2` ile ucuz duman testi; kısmi çalıştırma raporun sonuna
  "kabul kriteri ÖLÇÜLMEDİ" uyarısı basar
