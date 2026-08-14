# Kural Motoru (Faz 4)

> Projenin asıl değeri. "Object storage dedin ama data transfer yok" diyen katman.

## Neden var

Platform, eksik doldurulmuş bir alanı **hata vermeden 0 TL** olarak geçiyor ve backend
teklifi **hiç doğrulamıyor**. Yani yanlış teklif sessizce üretiliyor. Kural motoru bu
boşlukları yakalayıp satışçıya soruyor.

## Tasarım kararları

**Deterministik — LLM yok.** Aynı teklif her zaman aynı `Gap` listesini üretir
(test edildi). Ajan bu çıktıya güvenir, kendi üretmez. Halüsinasyon yüzeyi sıfır.

**Kurallar veri, kod değil.** `rules/estimate-rules.yaml`. Satış ekibi kural
ekleyebilir; kod derlemesi gerekmez.

**`eval` kullanılmıyor.** `src/core/rules/expr.ts` içinde küçük bir ifade
değerlendiricisi var: atama yok, döngü yok, fonksiyon tanımı yok, global erişim yok.

> **Gerçek bir açık yakalandı ve kapatıldı.** İlk sürüm alan okumasını düz
> `scope[name]` ile yapıyordu. Bu, `constructor` → `Object`, `constructor.constructor`
> → `Function` zincirini açık bırakıyor ve `Function('return process')()` ile kum
> havuzunun delinmesine izin veriyordu. Artık **yalnızca kendi özellikleri** okunuyor
> ve `__proto__` / `constructor` / `prototype` tamamen yasak. `tests/expr.spec.ts`
> bu kaçışı doğrudan test ediyor.

**Var olmayan yol patlamaz.** `data.backup.unit` gibi bir yol yoksa `undefined` döner.
Kural yazarının her adımı önceden kontrol etmesi gerekmez.

## Severity semantiği (Faz 4.B)

| Seviye | Anlam | Davranış |
|---|---|---|
| `blocker` | Teklif matematiksel olarak yanlış/eksik olur | Onay ekranı geçilemez, yayınlanamaz |
| `recommended` | Teknik olarak çalışır ama muhtemelen istenen bu değil | Satışçıya sorulur, "böyle kalsın" ile geçilebilir |
| `optional` | Upsell fırsatı | Sadece raporda listelenir |

`blocker` varsa `publishable = false` ve `publish.save` **dry-run'da bile** reddeder.

## Kurallar

21 kural — blocker 9, recommended 7, optional 5.

### blocker

| id | Yakaladığı |
|---|---|
| `UNKNOWN_PRODUCT_CODE` | Katalogda olmayan kod — motor sessizce 0 TL geçer |
| `ZERO_COST_ITEM` | Aylık tutarı 0 olan kalem (sonucu yakalayan güvenlik ağı) |
| `OBJ_STORAGE_NO_TRANSFER` | Object Storage var, egress yok |
| `OBJ_STORAGE_EMPTY` | Object Storage kalemi tamamen boş |
| `BACKUP_ZERO_COUNT` | Yedek adedi 0 — platform kalemi atlıyor |
| `COMPUTE_BACKUP_ZERO_COUNT` | Sunucu yedeklemesinde adet 0 |
| `COMPUTE_BACKUP_TB_IGNORED` | **Platform hatası** — TB seçilmiş ama GB olarak fiyatlanıyor (1024× düşük) |
| `FLOATING_IP_DOUBLE_COUNT` | Floating IP hem ayrı hem compute altında |
| `ROUTER_EMPTY` | Router kalemi boş |

`UNKNOWN_PRODUCT_CODE` ve `ZERO_COST_ITEM` **bilerek** örtüşüyor: biri nedeni
(uydurma kod), diğeri sonucu (0 TL) yakalıyor. Savunma derinliği.

### recommended

`COMPUTE_NO_BLOCK_STORAGE` · `COMPUTE_NO_TRANSFER` · `LB_NO_TRANSFER` ·
`LB_WITHOUT_HA` · `NO_PUBLIC_ACCESS` · `K8S_WORKER_NO_STORAGE` · `NO_BACKUP_ANYWHERE`

### optional

`SUGGEST_LOAD_BALANCER` · `SUGGEST_OBJECT_STORAGE` · `SUGGEST_PREMIUM_SSD` ·
`SUGGEST_BACKUP_FOR_STORAGE` · `CONSIDER_BLOCK_STORAGE_FOR_OBJECT_WORKLOAD`

## Kural yazmak

```yaml
- id: BENZERSIZ_KOD
  severity: blocker | recommended | optional
  scope: item          # varsayılan; 'estimate' teklifin tamamı için
  services: [compute]  # yalnızca bu servislerde çalış (scope: item)
  when: "!data.network"
  message: "Satışçının göreceği açıklama."
  ask: "Sorulacak soru?"
  default: "Cevap gelmezse yapılacak varsayım"
```

**`ask` yazan her kuralın `default`'u olmak zorunda** — testle zorlanıyor. Faz 6.A
"satışçı 5 sorunun tamamını atlayabilmeli" kriteri buna dayanıyor.

### Kullanılabilir yardımcılar

`item` `data` `service` `currency` `itemCount`
`has(servis)` `count(servis)` `hasStandalone(servis)` `totalComputeCount()`
`anyItemHas(servis, alan)` `anyFloatingIp()` `anyDataTransfer()` `anyBackup()`
`itemMonthly()` `totalMonthly()` `hasUnknownProductCode()`

Söz dizimi hataları **yükleme anında** yakalanır (`RuleSyntaxError`), çalışma anında değil.

## Regresyon (Faz 4.C)

- Her kural için **1 pozitif + 1 negatif** fixture — `tests/rules.spec.ts`
- Bir kuralın test vakası yoksa test kırılır (kapsam boşluğu sessiz kalamaz)
- **Yanlış pozitif blocker = 0**: canlı golden fixture ve iyi kurulmuş tam bir teklif
  üzerinde hiç blocker üretilmiyor
- Kural motoru katalogsuz da çalışıyor (fiyat gerektiren kurallar sessizce atlanır)
