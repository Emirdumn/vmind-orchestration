# Ajan Katmanı (Faz 5)

Faz 2–4'te kurulan deterministik iskeleti doğal dile bağlayan katman.

## Mimarinin tek kuralı, koda çevrilmiş hâli

> **LLM planlar, deterministik kod fiyatlar, LLM açıklar.**

Bu, dosya sınırlarıyla zorlanıyor — niyet beyanı değil:

| Bileşen | LLM kullanır mı | Neden |
|---|---|---|
| Requirement Extractor | ✅ | Doğal dil anlama; başka yolu yok |
| Solution Designer | ✅ | Katalogdan ürün seçimi bir yargı işi |
| **Auditor** | 🟡 kısmi | `Gap` listesi ve `publishable` kararı **tamamen** kural motorundan; LLM yalnızca `contextualNotes` ekleyebilir |
| **Reconciler** | ❌ | İki sayının eşitliği dil problemi değil |
| **Orchestrator** | ❌ | "Kaç tur soruldu", "onay alındı mı" olasılıksal olamaz |

Sonuç: **Faz 5'in çoğu API anahtarı olmadan test edilebiliyor** — 40 test, hepsi
sahte LLM ile. Bu bir kolaylık değil, mimarinin doğrulaması.

## Yetki, promptla değil tool listesiyle sınırlanıyor

Solution Designer'a `publish.*` ve `approval.*` tool'ları **hiç verilmiyor**
(`DESIGNER_TOOLS`). Sistem promptunda "yayınlama yapma" yazması ilk savunma;
asıl güvence, o tool'un ajanın elinde olmaması. Yetki dışı bir çağrı denenirse
`runTool` reddediyor ve reddedilme metriğe yazılıyor.

## Sessiz varsayım nasıl imkânsızlaştırıldı

Üç ayrı noktada:

1. **Extractor** — `unknowns` ve `rationale` JSON Schema'da **zorunlu**.
   Model "bilmiyorum" demeyi atlayamaz; `additionalProperties: false` ile
   uydurma alan da ekleyemez.
2. **Sözlük yedeği** — model bir belirsizliği kaçırırsa `mergeDeterministicUnknowns`
   Faz 1.B sözlüğünden deterministik olarak ekliyor. "worker" ve çıplak
   "load balancer" bu yolla her hâlükârda yakalanıyor.
3. **Orchestrator** — cevaplanmayan her soru `assumptions` listesine yazılıyor
   ve onay ekranında ayrı başlıkta görünüyor. Atlanan soru sessizce kaybolmuyor.

## Yapısal sınırlar (testle zorlanıyor)

| Sınır | Değer | Nerede |
|---|---|---|
| Denetim turu | ≤ 3 | `MAX_AUDIT_ROUNDS` |
| Tek turda soru | ≤ 5 | `MAX_QUESTIONS_PER_ROUND` |
| Mutabakat toleransı | < 0.01 | `RECONCILE_TOLERANCE` |
| `optional` kural sorulur mu | asla | `prioritizeQuestions` |

## Reconciler ne doğruluyor

Yaygın yanlış anlama: Reconciler iki *motoru* karşılaştırmıyor — motorun
platformla aynı olduğu Faz 2.B'de ayrıca kanıtlandı. Burada karşılaştırılan
**veri**: gönderdiğimiz teklif ile platformun sakladığı teklif aynı mı.

Backend hiçbir doğrulama yapmadığı için, JSON serileştirmede bir alanın
(iç içe bir `storage`, bir `unit`) düşmesi sessizce geçerdi. Testler bunu
doğrudan simüle ediyor: `storage` alanı silinmiş bir yanıt mutabakatsızlık
üretiyor. Fark varsa akış **duruyor**.

## İki anahtar karıştırılmasın

| Anahtar | Ne için | Nereden |
|---|---|---|
| **VMind** | Katalog, fiyat, teklif kaydetme | `console.portvmind.com/api/access` |
| **LLM** | Satışçı cümlesini anlayan model | OpenRouter **veya** Anthropic |

VMind anahtarı Türkçe cümle yorumlamıyor; LLM anahtarı fiyat vermiyor. İkisi
ayrı işler. `npm run eval` yalnızca ikincisini istiyor.

## LLM sağlayıcı — iki uygulama, tek arayüz

`createLlm()` ortamdan seçiyor: `OPENROUTER_API_KEY` varsa OpenRouter,
yoksa `ANTHROPIC_API_KEY`. Ajanların hiçbiri hangisinin kullanıldığını bilmiyor.

| | Anthropic (`llm.ts`) | OpenRouter (`llm-openrouter.ts`) |
|---|---|---|
| Yüzey | Anthropic Messages API | OpenAI-uyumlu |
| Varsayılan model | `claude-opus-5` | `anthropic/claude-opus-5` |
| Fiyat | $5 / $25 per MTok | **aynı** ($5 / $25) |
| İstemci | `@anthropic-ai/sdk` | `fetch` (ek bağımlılık yok) |

Aynı modele iki yoldan gidilebildiği için promptlar her iki sağlayıcıda da
tuned kalıyor. Daha ucuz seçenek: `anthropic/claude-sonnet-5` ($2/$10) —
ama prompt'lar Opus'a göre ayarlı, değiştirilirse yeniden ölçülmeli.

### Eşlenen farklar

OpenRouter'ın yüzeyi Anthropic'inkinden farklı; adaptör bunları çeviriyor:

| Anthropic | OpenRouter |
|---|---|
| `system` ayrı alan | `messages[0] = {role:'system'}` |
| `output_config.format` | `response_format.json_schema` (`strict: true`) |
| `thinking:{type:'adaptive'}` | `reasoning:{effort:'high'}` |
| `content[].type==='tool_use'` | `message.tool_calls[].function` |
| tool girdisi **nesne** | `function.arguments` JSON **string** |
| `{type:'tool_result'}` bloğu | `{role:'tool', tool_call_id, content}` |

Son iki satır en kolay gözden kaçanlar; `tests/llm-openrouter.spec.ts` ikisini
de doğrudan test ediyor. Testler `fetch` enjekte edilebildiği için **ağa
çıkmıyor ve anahtar istemiyor** — 16 test.

## Structured output

Extractor'da zorunlu ve **iki katmanlı**: API tarafında JSON Schema kısıtı
(`strict: true`), sonra Zod ile ikinci doğrulama. İkisi ayrışırsa Zod kazanır ve
test bunu zorluyor (`REQUIREMENT_SPEC_JSON_SCHEMA` ↔ `RequirementSpecSchema`
alan kümeleri birebir aynı olmak zorunda).

> JSON Schema neden Zod'dan üretilmiyor: projede Zod 3 var, SDK'nın zod
> yardımcısı Zod 4 bekliyor. Elle yazmak ayrıca `description` alanlarını
> koruyor — modelin çıkarımını asıl yönlendiren şey onlar.

## Eval — API anahtarı gerektirir

```bash
npm run eval            # 5.A + 5.B
npm run eval extract    # yalnızca Extractor
npm run eval design     # yalnızca Designer
```

`evals/scenarios.ts` içinde 10 çıkarım + 10 tasarım senaryosu var. Beklentiler
kasıtlı olarak "doğru cevap" değil **doğrulanabilir iddialar**: modelin ne
yazacağı değil, neyi yakalaması (ve neyi uydurmaması) gerektiği ölçülüyor.

Örnek — "birkaç sunucu lazım" cümlesinde beklenen, `compute`'un **üretilmemesi**
ve adedin sorulması. Uydurulmuş bir `count: 3` bu senaryoyu düşürür.

**Durum:** harness yazıldı ve anahtarsız temiz çıkıyor, ancak **kabul kriterleri
henüz ölçülmedi** — bu ortamda hiçbir LLM anahtarı tanımlı değil.

```bash
setx OPENROUTER_API_KEY "sk-or-..."
npm run eval
```

Çalıştığında ilk satır hangi sağlayıcı ve modelin kullanıldığını yazar.
