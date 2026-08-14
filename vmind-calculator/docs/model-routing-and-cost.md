# Model yönlendirme ve maliyet sözleşmesi

## Karar sırası

1. Tıklamalı yapılandırma ve tanınan Excel/CSV şablonu `tool-first/guided-v1`
   yolundan geçer. LLM çağrılmaz; katalog, kurallar ve fiyat motoru çalışır.
2. Serbest metinli ihtiyaç çıkarımı `model-router/v1` tarafından deterministik
   sinyallerle hızlı, dengeli veya güçlü modele yönlendirilir. Yönlendirme için
   ayrıca model çağrısı yapılmaz.
3. Fiyat, ürün kodu, ağ topolojisi, yedek ve yayınlama işlemleri hiçbir modelin
   serbest metin cevabından alınmaz; doğrulanmış tool katmanından geçer.

| İş | Katman |
|---|---|
| Kısa, tek iş yüklü ihtiyaç | `fast` |
| Orta karmaşıklıkta ihtiyaç ve sınırlı tool planı | `balanced` |
| Uzun/çok rollü, GPU, Kubernetes, migration veya belirsiz Excel | `strong` |
| Tıklamalı/standart tablo | LLM yok |

Model adları `OPENROUTER_MODEL_FAST`, `OPENROUTER_MODEL_BALANCED` ve
`OPENROUTER_MODEL_STRONG` ile verilir. Boş katmanlar `OPENROUTER_MODEL`
değerine düşer. Anthropic doğrudan kullanımında aynı sözleşmenin
`ANTHROPIC_MODEL_*` karşılıkları vardır.

## Güvenli exact cache

- Yalnızca birebir aynı yapısal istekler cache'lenir; semantik benzerlik yoktur.
- Anahtar model + prompt sürümü + sistem metni + kullanıcı metni + şema
  birleşiminin SHA-256 özetidir.
- Kullanıcı metninde telefon, e-posta, TCKN, IBAN veya kart gibi PII bulunursa
  cache tamamen atlanır.
- Cache sonucu her okumada Zod şemasıyla tekrar doğrulanır.
- Tool döngüleri ve yayınlama işlemleri cache'lenmez.
- PostgreSQL tablosu `agent.response_cache`; varsayılan TTL 24 saattir ve
  `VMIND_LLM_CACHE_TTL_SECONDS` ile değişir.
- Cache arızası teklif üretimini durdurmaz. Kota ve LLM kullanım kayıtları ise
  doğruluk sınırı oldukları için fail-closed davranmaya devam eder.

Yönetim ekranında cache hit sayısı, aktif kayıtlar, model/token/maliyet ve CRM
akışları birlikte görünür. `agent.llm_usage.route_tier` ve `route_reason`, bir
çağrının neden o modele gittiğini denetlenebilir tutar.
