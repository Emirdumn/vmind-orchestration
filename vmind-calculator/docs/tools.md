# Tool Katmanı (Faz 3)

Ajanın dünyaya dokunduğu **tek** yüzey. Dar, tipli, yan etkisi belli.

MCP transport'undan bağımsız yazıldı: mantık `src/mcp/tools/index.ts` içinde saf
fonksiyonlar; `src/mcp/server.ts` yalnızca ince bir adaptör. Böylece HITL kapısı
MCP olmadan test edilebiliyor.

## Çalıştırma

```bash
npm run mcp
```

Claude Code'a eklemek:

```bash
claude mcp add vmind -- npm run mcp --prefix "C:\Users\DELL\Desktop\vmind price calculator agent"
```

MCP adlarında nokta yerine alt çizgi kullanılır: `catalog.searchFlavors` → `catalog_searchFlavors`.

## 3.A — Salt-okunur

| Tool | İş |
|---|---|
| `catalog.listServices` | 9 servis + başlık |
| `catalog.searchProducts` | Ürün arama → `productCode` + ad + fiyat |
| `catalog.searchFlavors` | vCPU/RAM/GPU filtreli instance tipi arama |
| `catalog.listVolumeTypes` | Block storage tipleri |

Hepsi snapshot'tan çalışır, ağa çıkmaz. Ölçülen ortalama **< 50 ms** (test edilmiş).
Hiçbiri state değiştirmez (test edilmiş).

> `searchFlavors` çıktısındaki `productCode`, `flavor.id`'dir ve doğrudan
> `estimate.addItem`'a verilebilir. Ajanın kod türetmesine gerek yok.

## 3.B — Yerel state (platforma **yazmaz**)

| Tool | İş |
|---|---|
| `estimate.create` | Ad ve para birimi (TL / USD) |
| `estimate.addItem` | Kalem ekle — şema + katalog doğrulaması |
| `estimate.updateItem` | Kısmi güncelleme; birleşik sonuç yeniden doğrulanır |
| `estimate.removeItem` | Kalem sil |
| `estimate.read` | Tam JSON (derin kopya) |
| `estimate.undo` | Son değişikliği geri al |
| `price.calculate` | Satır kırılımı + toplamlar |
| `validate.check` | Kural motoru → `Gap[]` |

### İki aşamalı doğrulama — sıra önemli

1. **Şema** — alan/tip/birim doğru mu (`MB` reddedilir, `EUR` reddedilir)
2. **Katalog** — her `productCode` gerçekten var mı **ve** seçili para biriminde fiyatı var mı

İkincisi olmadan ajanın uydurduğu kod sessizce 0 TL olarak teklife girerdi.
İç içe alanlardaki kodlar da taranır (`compute.storage.productCode` dahil).

Reddedilen bir ekleme state'i kirletmez (test edilmiş).

### Undo

Her mutasyon öncesi tam state anlık görüntüsü alınır. Ajan yanlış kalem eklerse
tur içinde geri alınabilir; satışçıya "baştan başla" dedirtmez.

## 3.C — Yayınlama: üç kapı

`publish.save` sırasıyla üç kapıdan geçer:

1. **`dryRun` varsayılan `true`** — parametresiz çağrı asla yazmaz, sadece ne
   yazılacağını ve paylaşım linkini döndürür
2. **Çözülmemiş `blocker` varsa reddedilir** — dry-run'da bile
3. **HITL onayı yoksa reddedilir** — `ApprovalRequiredError`

Ayrıca `PlatformApiClient` de varsayılan olarak salt-okunur; onay alınmış olsa bile
`allowWrites: true` verilmemişse `WriteNotAllowedError` fırlatır. **Dördüncü kapı.**

```
publish.save({})                  → dry-run, yazma yok
publish.save({dryRun:false})      → ApprovalRequiredError
approval.grant({approvedBy})      → blocker varsa BlockersPresentError
publish.save({dryRun:false})      → istemci salt-okunursa WriteNotAllowedError
```

Hepsi `tests/tools.spec.ts` içinde test edilmiş. Yeni oturum **onaysız** başlar.

> `approval.grant`'ı **yalnızca orchestrator**, satışçı onay ekranından geçtikten
> sonra çağırmalı. Ajanın kendi kendine çağırmaması sistem promptuyla zorlanacak
> (Faz 5); tool katmanı bunu teknik olarak engelleyemez — bu bilinçli bir sınır.

## Hata davranışı

Hatalar ajana **metin olarak** döner (`isError: true`), exception olarak değil.
Böylece ajan reddedilme nedenini görüp düzeltebilir. Faz 7.B'deki
"ajan kaç kez uydurma kod denedi" sayacı bu hataları sayacak.

Örnek:

```
UnknownProductCodeError: "UYDURMA-999" katalogda yok. Fiyat motoru bunu sessizce
0 TL olarak gecer. Yalnizca catalog.searchProducts / searchFlavors ciktisindaki
kodlar kullanilabilir.
```
