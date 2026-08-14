# Kimlik Doğrulama & Yetki Modeli (Faz 0.B)

> **Ana bulgu: calculator, kullanıcı girişi yapmıyor. Katalog erişimi için ayrı bir
> test hesabına gerek yok.** PLAN'daki "test hesabı gecikirse Faz 0.B ve sonrası
> bloke" riski katalog tarafında ortadan kalktı.

## 1. Mekanizma

Üretim bundle'ındaki axios interceptor her isteğe **sabit** bir anahtar ekliyor:

```js
axios.interceptors.request.use(function (cfg) {
  cfg.timeout = cfg.timeout * 1e3;
  cfg.headers = cfg.headers || {};
  cfg.headers.set("X-Lang", func.cookie.get("APP_LANG"));
  cfg.headers.Authorization = "Bearer " + appConfig.apiKey;   // ← bundle'da gömülü
  return cfg;
});
```

`appConfig` da aynı bundle'da:

```js
const apiKey = "$2a$11$pXDEqHtbrZ/CXZv9Z8fd5OveBQZm2HO9cfEtq4k9LCsQqgjnf/Dw.";
const calculatorUrl = "https://calculator.portvmind.com";
const panelUrl = "https://tr-ist-01-console.portvmind.com";
const wsUrl = "https://tr-ist-01-api.portvmind.com";
const _wsurl = appConfig.wsUrl + "/api/v1";
```

`POST /auth/signin`, PLAN EK-A.2'de "Giriş" olarak listelenmişti; bundle'da bu string
bir **API çağrısı değil**, konsola giden bir bağlantı (`href`):

```js
<a href={`${appConfig.panelUrl}/auth/signin`}>Sign In</a>
```

Yani calculator'ın kendi akışında oturum açma adımı yok.

## 2. Canlı doğrulama

Bundle'daki anahtarla, hesapsız:

| Uç nokta | Sonuç |
|---|---|
| `GET /api/v1/billing/products` | **200** — 44 ürün |
| `GET /api/v1/compute/flavors` | **200** — 24 instance tipi |
| `GET /api/v1/compute/volume-types` | **200** — 2 volume type |

`npm run snapshot:catalog` bu üçünü çekip `fixtures/catalog/` altına yazar.

## 3. Anahtarın niteliği — dikkat

Bu anahtar **gizli değil**: `calculator.portvmind.com` adresini açan herkesin
tarayıcısına gönderiliyor, herkese açık bir JS dosyasının içinde duruyor. Katalog
okumak için kullanmak, siteyi ziyaret etmekle aynı erişimi kullanmak demek.

Yine de bu bir **ürün kararı** ve VMind'a sorulmalı:

- [ ] Ajanın kendi servis hesabı/anahtarı olmalı mı? (denetim izi, iptal edilebilirlik,
      rate limit ayrımı için tercih edilir)
- [ ] `POST /billing/estimateplan` ile **yazma** işlemi de bu anahtarla mı yapılmalı,
      yoksa satış temsilcisinin kimliğiyle mi? Teklifin kime ait göründüğü buna bağlı.
- [ ] `GET /billing/account` gibi hesaba özel uçlar gerekiyorsa gerçek hesap gerekir —
      bunlar henüz test edilmedi.

Kod, anahtarı `VMIND_API_KEY` ortam değişkeniyle değiştirilebilir bırakıyor
(`src/platform/api-client.ts`); VMind bir servis hesabı verirse tek satır değişikliği yeter.

## 4. Yazma işlemleri

`PlatformApiClient` varsayılan olarak **salt-okunur**. `saveEstimate()` çağrılırsa
`WriteNotAllowedError` fırlatır; gerçek yazma için `allowWrites: true` gerekir.
Bu bayrak yalnızca insan onayından (HITL, Faz 6.B) sonra verilmelidir.

**Backend teklifi doğrulamıyor** — ne gönderilirse saklıyor. Doğrulama sorumluluğu
tamamen bizde; kural motoru (Faz 4) bu yüzden zorunlu.

## 5. Yenileme / süre

Anahtar bir bcrypt hash görünümünde, JWT değil; **son kullanma tarihi taşımıyor**.
Dolayısıyla PLAN 0.B'deki "token süresi dolduğunda otomatik yenileme" maddesi bu
mekanizma için geçersiz. Anahtar sunucu tarafında iptal edilirse istekler 401 döner;
istemci bunu `PlatformApiError` olarak yüzeye çıkarır.

> Kalan iş: VMind'ın anahtarı ne sıklıkla döndürdüğü (rotate) bilinmiyor. Drift
> dedektörüne (Faz 2.C) 401 tespiti eklenmeli.
