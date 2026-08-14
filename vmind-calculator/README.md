# VMind Teklif Ajanı

Satış ekibinin doğal dille verdiği ihtiyacı, `calculator.portvmind.com` üzerinde
tutarlı bir teklife çeviren multi-agent sistem. Mimari ve faz planı: [PLAN.md](PLAN.md).

> **Mimarinin tek cümlesi:** LLM planlar, deterministik kod fiyatlar, LLM açıklar.

## Durum

| Faz | Adım | Durum |
|---|---|---|
| 0 | 0.A Keşif | ✅ (PLAN EK-A) |
| 0 | 0.B Kimlik doğrulama | ✅ — [docs/auth.md](docs/auth.md) · **test hesabı gerekmedi** |
| 0 | 0.C Katalog snapshot `GATE` | ✅ — [docs/catalog-report.md](docs/catalog-report.md) |
| 1 | 1.A Şema | ✅ — `src/core/schema/estimate.ts` |
| 1 | 1.B Katalog + jargon sözlüğü | ✅ — `src/core/catalog/` |
| 1 | 1.C Golden fixture `GATE` | ✅ — 5/5 fixture canlı arayüzden, 9/9 servis kapsandı |
| 2 | 2.A Fiyat motoru portu | ✅ — `src/core/pricing/engine.ts` |
| 2 | 2.B Diff harness | ✅ — 162 test, platformun kendi koduna karşı |
| 2 | 2.C Drift dedektörü `GATE` | ✅ — `npm run drift` + günlük CI |
| 3 | 3.A/3.B Tool katmanı | ✅ — `src/mcp/tools/` · [docs/tools.md](docs/tools.md) |
| 3 | 3.C Yayınlama + HITL `GATE` | ✅ — dört kapı, testle kanıtlı |
| 4 | 4.A/4.B Kural motoru | ✅ — 21 kural · [docs/rules.md](docs/rules.md) |
| 4 | 4.C Regresyon seti `GATE` | ✅ — kural başına pozitif/negatif, yanlış-pozitif = 0 |
| 5 | 5.A Extractor `GATE` | ✅ — **10/10 ölçüldü** (kriter ≥9) |
| 5 | 5.B Designer `GATE` | ✅ JSON eval kapısı: ≥%90 servis, uydurma kod = 0, rejected tool = 0; gerçek model koşusu anahtar/bütçe ister |
| 5 | 5.C Auditor + Reconciler + Orchestrator `GATE` | ✅ — akış, tur limiti, mutabakat testli |
| 6 | 6.A/6.B Soru turu + onay ekranı | ✅ — ≤5 soru, hepsi varsayılanlı, varsayımlar raporda |
| 6 | 6.C Teslim `GATE` | ✅ canlı yazma, geri okuma ve calculator linki doğrulandı |
| 7 | 7.A Regresyon + envanter | ✅ golden/regresyon, JSON eval ve seçilebilir ürün/flavor kapıları |
| 7 | 7.B Telemetri + denetim izi | ✅ — PostgreSQL kalıcılığı, PII maskeleme, LLM/tool/kota kaydı |
| 7 | 7.C Pilot | ⬜ baz süre ölçümü bekliyor |

**741 test yeşil**, typecheck ve üretim arayüzü build'i temiz. MCP sunucusu ayakta (15 tool).
LLM sağlayıcı olarak **OpenRouter veya Anthropic** kullanılabilir.
Uçtan uca akış canlı doğrulandı — bkz. aşağıdaki demo.

## Sistemi denemek — `npm run demo`

Sistemi elle görmenin en hızlı yolu. Akışın her adımını ekrana yazar:
ne anladığı → hangi ürünleri seçtiği → kural motorunun bulduğu eksikler →
fiyat → satışçıya sorular → onay ekranı → denetim izi → harcama.

**Kredi harcamayan mod** (LLM anahtarı gerekmez) — hazır ama bilerek eksik
bir teklifle deterministik yarıyı gösterir; kural motorunun neyi yakaladığı görülür:

```bash
npm run demo
```

**Doğal dille** (LLM anahtarı gerekir, ~$0.30/çalıştırma):

```bash
npm run demo -- "Müşteri 4 sunucu istiyor, her birine 200 GB premium disk, önüne uygulama load balancer"
```

**Asla yayınlamaz.** `publish.save` yalnızca dry-run çağrılır; onay her zaman
reddedilir.

## Satışçı arayüzü — `npm run web`

Tarayıcıdan çalışan hali. Metin → canlı aşama akışı → netleştirme → sorular →
onay → fiyat. LLM anahtarı **yalnızca sunucuda** durur, tarayıcıya hiç gitmez.

```bash
npm run web:build     # arayüzü derler (web/dist)
npm run web           # sunucu — http://127.0.0.1:8080
```

Sunucuya dağıtım (tek konteyner, Node API + arayüz):

```bash
cp .env.example .env  # OPENROUTER_API_KEY doldurun
docker compose up -d --build
```

Ayrıntı, boyutlandırma ve TLS: [docs/deploy.md](docs/deploy.md).
Önerilen sunucu **g1.small + 25 GB Premium-SSD + Floating IP ≈ 605 TL/ay** —
dışarıya ödenen tek şey model API'si.

Public müşteri kullanımında PortVMind login gerekmez: `WEB_AUTH_MODE=public-guest`
ile HttpOnly ziyaretçi oturumu, Turnstile ve IP-HMAC limitleri kullanılır.
Geliştirici devir paketi [docs/handoff.md](docs/handoff.md), API sözleşmesi
[docs/openapi.json](docs/openapi.json), çalıştırılabilir örnekler
[docs/postman/](docs/postman/) altındadır.

**Yayınlama varsayılan olarak kapalıdır.** Canlı sunucuda
`WEB_ALLOW_PUBLISH=1` verildiğinde, satışçının açık onayından sonra teklif VMind'a
kalıcı olarak kaydedilir ve düzenlenebilir calculator linki üretilir.

## Faz 2 — PostgreSQL kullanım ve kalite kaydı

Canlı Calculator aşağıdaki verileri kendi VM'indeki PostgreSQL'e kalıcı yazar:

- PII-maskeli kullanıcı girdileri ve kapı cevapları
- akış durumu, hata kodu ve gösterilen sonuç özeti
- her LLM çağrısının sağlayıcı/model, input-output-cache token ve gerçek USD maliyeti
- başarılı/reddedilmiş tool çağrıları ve tam denetim olayları
- yayınlanmamış dry-run dâhil sürümlü Calculator çıktısı
- günlük tenant ve principal kota defteri

PostgreSQL genel ağda dinlemez; yalnızca `127.0.0.1` ve host üzerindeki sabit
Docker köprüsünden erişilir. `budget.json` bu fazda geri dönüş/uzlaştırma aynasıdır,
ancak canlı kota kontrolünün yetkili kaynağı PostgreSQL'dir. Kayıt başarısızlığı
olursa yeni LLM harcaması kapalı tarafa düşer.

Operasyon, sorgular, yedek ve geri dönüş: [docs/phase2-postgres.md](docs/phase2-postgres.md).

## Kurulum

```bash
npm install
npm test              # 741 test — anahtar gerekmez
npm run typecheck
npm run snapshot:catalog   # canlı katalogu tazeler + raporu üretir
npm run drift              # katalog & bundle sapması var mı
npm run mcp                # MCP sunucusu (15 tool)
npm run eval               # Faz 5 kabul kriterleri — API anahtarı ister
```

Claude Code'a tool katmanını eklemek:

```bash
claude mcp add vmind -- npm run mcp --prefix "C:\Users\DELL\Desktop\vmind price calculator agent"
```

Ortam değişkeni **gerekmiyor** — bkz. [docs/auth.md](docs/auth.md). Özelleştirme için
`.env.example`.

## Bu fazlarda ortaya çıkan iki önemli bulgu

### 1. Test hesabı kritik yolda değilmiş

Calculator kullanıcı girişi yapmıyor; üretim bundle'ında **herkese açık servis edilen**
sabit bir anahtarı `Authorization: Bearer` olarak gönderiyor. `billing/products`,
`compute/flavors`, `compute/volume-types` bu anahtarla 200 dönüyor. PLAN'daki
_"test hesabı gecikirse Faz 0.B ve sonrası bloke"_ riski katalog tarafında düştü.
(Hesaba özel uçlar — `billing/account` — hâlâ test edilmedi.)

### 2. Fiyat motoru tahminle değil, kaynaktan porte edildi

PLAN EK-A.5 yalnızca `Calculate()`'i içeriyordu; **servis dallanmaları belgelenmemişti.**
Üretim bundle'ı indirilip `CalculateService` ve `ServiceTotals` birebir çıkarıldı
(minify sonrası fonksiyon adları korunmuş). Çıkarılan kod
`tests/reference/vmind-reference.mjs` içinde bozulmadan duruyor ve testlerde **oracle**
olarak çalışıyor.

Yani Faz 2.B'nin cevapladığı soru "port kendi içinde tutarlı mı" değil,
**"port platformun kendi koduyla bit-bit aynı mı"**. Ayrıntı ve korunan 12 platform
tuhaflığı: [docs/pricing-port-notes.md](docs/pricing-port-notes.md).

### 3. Canlı arayüzde bir platform hatası bulundu

Compute içindeki Backup bölümü **GB/TB seçici sunuyor** ve seçimi `backup.unit`
alanına yazıyor — ama fiyat motoru compute dalında birimi sabit `"GB"` geçirip bu
alanı **hiç okumuyor**. Satışçı "1 TB" seçse bile teklif **1 GB** olarak fiyatlanır:
1024 kat düşük, hata yok, uyarı yok. Standalone `backup` servisinde bu hata yok.

Port bu davranışı aynen taşıyor (düzeltmek sapma olurdu) ve `tests/golden.spec.ts`
ile kilitlendi. Kural motorunda (Faz 4) `COMPUTE_BACKUP_TB_IGNORED` blocker'ı olmalı.
Bu alan EK-A.4'te hiç listelenmemişti — yalnızca canlı arayüzde ortaya çıktı.

## Üretimde dışarıdan etkinleştirilecekler

Kod kapıları tamamdır; ortam sahibinin sağlaması gerekenler açıkça ayrıdır:

1. Üretim alan adı için Turnstile site/secret çifti.
2. OpenRouter fast/balanced/strong model slug'ları ve bütçeli gerçek eval raporu.
3. PostgreSQL roller/URL'leri ve açık `db:migrate` + `db:verify` adımı.
4. VM dışı restic deposu ve alarm webhook'u.
5. TLS, Postman dry-run smoke ve iş sahibi onayından sonra publish aktivasyonu.

Public Cloud kaynak provision etme bu sürümde bilinçli olarak yoktur; teklif
çıktısının gerçekten instance açması sonraki, ayrı RBAC/idempotency/approval
fazıdır. Ayrıntılı kabul listesi: [docs/test-report.md](docs/test-report.md).

## Dizin yapısı

```
src/
  core/
    schema/     estimate.ts        9 servisin Zod şeması
    pricing/    engine.ts          platform portu — DÜZELTME YAPMAYIN
    catalog/    catalog.ts · aliases.ts · drift.ts · types.ts
    estimate/   session.ts         yerel teklif state'i + undo log
    rules/      expr.ts · engine.ts · types.ts
  mcp/          server.ts · tools/index.ts
  agents/       llm.ts · prompts.ts · extractor.ts · designer.ts
                auditor.ts · reconciler.ts · orchestrator.ts
  platform/     api-client.ts      salt-okunur varsayılan
rules/          estimate-rules.yaml   21 kural (kod değil veri)
scripts/        snapshot-catalog.ts · catalog-drift.ts
evals/          scenarios.ts · run-eval.ts   (API anahtarı ister)
tests/          pricing · schema · catalog · drift · golden · rules · expr · tools · agents
                + reference/ (verbatim oracle) · fake-llm.ts
fixtures/       catalog/ (canlı snapshot) · golden/
docs/           auth.md · catalog-report.md · pricing-port-notes.md
                rules.md · tools.md · agents.md
```
