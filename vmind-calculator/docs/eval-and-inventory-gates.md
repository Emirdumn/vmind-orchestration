# Eval ve envanter yayın kapıları

## Deterministik kapı

Her build aşağıdakileri ücretsiz çalıştırır:

```bash
npm run typecheck
npm test
npm run inventory:check
```

`inventory:check`, TL/USD fiyatlarını, dokuz hizmet için ürün varlığını,
public/etkin flavor listesini, GPU flavor'larını ve volume type eşleşmesini JSON
olarak denetler. Blocker varsa süreç `1` ile çıkar. Fiyat kataloğunda olup
Calculator flavor seçicisinde görünmeyen compute kodları ayrıca uyarıdır ve
çalışma zamanında `EstimateSession` tarafından reddedilir.

Raporu saklamak için:

```bash
npm run inventory:check -- --output=var/evals/inventory.json
```

## Gerçek model eval'i

Gerçek model çağrıları yalnız açık bütçe ve secret ile çalıştırılmalıdır:

```bash
OPENROUTER_API_KEY=... \
EVAL_BUDGET_USD=1 \
npm run eval -- --report=var/evals/full.json
```

Kısmi duman testi:

```bash
EVAL_LIMIT=2 EVAL_BUDGET_USD=.25 npm run eval -- extract
```

Rapor her durumda JSON yazılır; kimlik bilgisi yoksa veya bütçe kapısı akışı
durdurursa sebep `fatalError`/case status alanında görünür. `var/` gitignore'dadır.

Tam kabul kriterleri:

- Extractor: 10 senaryonun en az 9'u tüm kontrolleri geçer.
- Designer: 10 senaryonun en az 9'unda beklenen servis seti tam oluşur.
- Uydurma productCode: `0`.
- Reddedilmiş tool çağrısı: `0`.
- Bütçe nedeniyle atlanan vaka: `0`.
- `EVAL_LIMIT` kullanıldıysa `acceptanceMeasured=false`; duman testi tam kabul
  olarak sunulamaz.

JSON ayrıca hızlı/dengeli/güçlü route sayılarını, seçilen model adlarını, vaka
gecikmelerini, tokenları ve sağlayıcı bildiriyorsa gerçek USD maliyetini içerir.
Bu rapor model veya prompt değişikliğinin kalite/maliyet farkını karşılaştırmak
için release kanıtıdır.
