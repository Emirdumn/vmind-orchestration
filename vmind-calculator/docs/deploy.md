# Dağıtım — VMind public cloud üzerinde

Satışçı arayüzü tek konteynerde çalışır: Node API + derlenmiş React arayüzü.
Dışarıya ödenen tek şey **model API'si**; sunucu, disk ve trafik kendi
kredinizden karşılanır.

---

## 1. Sunucu boyutlandırma

Katalogdan hesaplandı (fiyatlar bu projenin kendi motoruyla, TL/ay):

| Flavor | vCPU / RAM | TL/ay | Değerlendirme |
|---|---|---|---|
| g1.micro | 1 / 1 GB | 229 | **Dar.** Node + konteyner sıkışır |
| **g1.small** | **1 / 2 GB** | **370** | **Yeterli** — önerilen |
| g1.medium | 2 / 4 GB | 740 | Eşzamanlı 10+ satışçı için pay bırakır |

Bu iş **CPU değil ağ bekleme** ağırlıklı: sunucu zamanının çoğunu LLM yanıtını
beklemekle geçirir. Bir akış ~60–90 saniye sürer ve o sürenin neredeyse tamamı
boştur.

**Önerilen kurulum:**

| Kalem | Seçim | TL/ay |
|---|---|---|
| Sunucu | g1.small (1 vCPU / 2 GB) | 370 |
| Disk | 25 GB PortvMind-Premium-SSD | 118 |
| Floating IP | 1 | 117 |
| **Toplam** | | **~605** |

Disk 25 GB yeterli: Ubuntu ~8 GB, Docker imajı 357 MB, kalanı log ve imaj
katmanları için pay. 50 GB isterseniz toplam ~724 TL/ay olur.

Trafik ihmal edilebilir: arayüz 50 kB (gzip), API yanıtları birkaç kB.

> **Düzeltme (31 Temmuz 2026):** Bu tablo önce disk için 709 TL/ay gösteriyordu.
> O rakam üç sunuculu bir örnek hesaptan kalmıştı — fiyat motoru compute
> kalemindeki disk boyutunu instance sayısıyla çarpar, tek sunucuda bu çarpan
> yok. Premium-SSD **4,73 TL/GB/ay**; doğrusu 25 GB için 118, 50 GB için 237 TL.

---

## 2. Sunucuyu hazırlama

VMind konsolundan bir Ubuntu 22.04+ sunucu oluşturun, sonra:

```bash
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # yeniden giriş yapın

# Projeyi kopyalayın (git veya scp)
git clone <repo> vmind-agent && cd vmind-agent
```

---

## 3. Yapılandırma

```bash
cp .env.example .env
```

`.env` içinde **en az** şunu doldurun:

```ini
OPENROUTER_API_KEY=<secret-manager-degeri>
OPENROUTER_MODEL_FAST=<erisilebilir-fast-model>
OPENROUTER_MODEL_BALANCED=<erisilebilir-balanced-model>
OPENROUTER_MODEL_STRONG=<erisilebilir-strong-model>
WEB_AUTH_MODE=public-guest
WEB_PUBLIC_IP_HASH_SECRET=<rastgele-en-az-32-karakter>
TURNSTILE_SITE_KEY=<site-key>
TURNSTILE_SECRET_KEY=<secret-key>
TURNSTILE_EXPECTED_HOSTNAME=teklif.sirketiniz.com
WEB_ALLOW_PUBLISH=0
LLM_DAILY_TOTAL_USD=5
LLM_DAILY_PER_USER_USD=1
```

`WEB_ALLOW_PUBLISH=0` ile önce giriş ve doğal dil akışını doğrulayın. Calculator
linki üretmeye hazır olduğunuzda bu değeri bilinçli olarak `1` yapın. Açıkken,
satışçının onayladığı her teklif VMind'da kalıcı kayıt bırakır; bilinen bir silme
ucu yoktur.

> **`.env` gitignore'da ve `.dockerignore`'da.** Anahtar imaja girmez.
> Docker imaj katmanları kalıcıdır — bir katmanda görünen dosya sonraki
> katmanda silinse bile imajı çeken herkes onu geri çıkarabilir. Anahtarı
> `ARG` ile **geçirmeyin**: build argümanları imaj geçmişinde durur.

---

## 4. Çalıştırma

```bash
docker compose up -d --build
docker compose logs -f agent
```

Açılışta şunu görmelisiniz:

```
VMind Teklif Ajanı — http://0.0.0.0:8080
  kimlik doğrulama : public-guest
  LLM              : openrouter / model-router-v1
  katalog          : 44 ürün, 21 kural
  harcama sınırı   : günlük $5, kişi başı $1
  yayınlama        : KAPALI (yalnızca dry-run)
```

**Sunucu bilerek patlar** şu durumlarda: harcama defteri okunamıyorsa,
`shared-secret` açık izin olmadan seçilmişse, sınır değerleri geçersizse.
Yanlış yapılandırılmış bir sunucunun sessizce açılması korumaların hiç
olmamasından kötüdür — var sanılır.

---

## 5. TLS — zorunlu

Konteyner yalnızca `127.0.0.1:8080`'e bağlanır. Önüne ters vekil koyun:

```bash
sudo apt install -y caddy
```

`/etc/caddy/Caddyfile`:

```
teklif.sirketiniz.com {
    reverse_proxy 127.0.0.1:8080
}
```

```bash
sudo systemctl reload caddy
```

Caddy sertifikayı otomatik alır. **TLS'siz çalıştırmayın:** oturum çerezi
`Secure` bayrağıyla gönderiliyor ve satışçının VMind token'ı düz metin
taşınırdı. (`WEB_INSECURE_COOKIE=1` yalnızca yerel denemeler içindir.)

---

## 6. Güncelleme ve geri alma

```bash
git pull && docker compose up -d --build
```

Harcama defteri `budget` volume'unda; yeniden derleme onu **silmez**. Bu
kasıtlı: konteyner her yeniden yaratıldığında defter sıfırlansaydı günlük
kota da sıfırlanır ve sınır anlamını yitirirdi.

Geri almak için:

```bash
git checkout <onceki-commit> && docker compose up -d --build
```

---

## 7. Sağlık ve izleme

```bash
docker compose ps              # HEALTHCHECK durumu
docker compose logs --tail=50 agent
```

Süreç ve bağımlılık sağlığı:

```bash
curl https://teklif.sirketiniz.com/api/health/live
curl -H "Authorization: Bearer $WEB_MONITOR_API_KEY" \
  https://teklif.sirketiniz.com/api/health/ready
```

Readiness 503 dönerse PostgreSQL, katalog veya LLM bileşenlerinden biri hazır
değildir. Ayrıntılı systemd alarm ve restore zinciri:
`docs/operations-runbook.md`.

---

## 8. Bu kurulumun bilinen sınırları

Dürüstçe, gizlemeden:

1. **Tek sunucu.** Yarım akışlar sunucunun belleğinde tutuluyor; yeniden
   başlatma onları düşürür (kaydedilmiş teklif kaybolmaz, yalnızca yarım
   oturum). İki kopya çalıştırmak için akışın sürdürülebilir bir durum
   makinesine çevrilmesi gerekir — bkz. `src/web/flow-session.ts` başındaki
   not.
2. **Yayınlama varsayılan KAPALI.** `WEB_ALLOW_PUBLISH=1` verildiğinde dört kapı
   yerinde kalır: dry-run varsayılanı, blocker kontrolü, açık insan onayı ve
   yazma yetkisi. Bu yol canlı yazma + geri okuma + calculator'da açma ile
   doğrulandı. Açıkken her onaylanan teklif kalıcı kayıt bırakır.
3. **Public müşteri login'i yoktur.** `public-guest` ayrı HttpOnly oturum,
   Turnstile ve IP-HMAC limiti kullanır. Sunucu entegrasyonları PortVMind
   parolası değil ayrı, iptal edilebilir `WEB_SERVICE_API_KEY` Bearer kullanır.
4. **Eşzamanlı akış sınırı** 50 toplam / kişi başı 3. Aşan istek anlaşılır bir
   mesajla reddedilir.
