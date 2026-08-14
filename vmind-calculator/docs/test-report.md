# Kabul testi raporu — 2026-08-14

## Sonuç

Kod seviyesi kabul kapıları geçmiştir. Canlı üretim aktivasyonu, müşteriye ait
Turnstile alan adı/anahtarları, seçilmiş OpenRouter tier model slug'ları,
PostgreSQL bağlantıları, offsite restic deposu ve alarm webhook'u verilmeden
tamamlanmış sayılmaz.

| Kapı | Sonuç |
|---|---|
| TypeScript tip kontrolü | Geçti |
| Calculator birim/regresyon testleri | 29 dosya, 741 test geçti |
| CRM/adapter test paketi | Geçti |
| React üretim derlemesi | Geçti |
| Katalog envanter kapısı | Hazır; 44 ürün, 20 seçilebilir public flavor, blocker yok |
| OpenAPI/Postman devir doğrulaması | 20 yol, 20 operation, secret-free ortam geçti |
| OpenAPI bağımsız lint | OpenAPI 3.1 geçerli, uyarı yok |
| Tool-first HTTP API smoke | Guided dry-run tamamlandı; publish=false, token maliyeti $0 |
| Calculator ve web production dependency audit | 0 high/critical bulgu |
| CRM eklenti production dependency audit | 0 high/critical; OpenClaw host ayrı upgrade/audit kapsamı |
| Docker Compose çözümleme ve konteyner health sözleşmesi | Geçti |
| Bash backup/restore/monitor sözdizimi | Geçti |
| PostgreSQL migration/store/schema guard | 001–006 migration, verify, CRM store temizliği, 8 schema-guard senaryosu ve runtime exact-cache geçti |

## Test edilen güvenlik özellikleri

- Public guest istek/IP-hash limitleri ve Turnstile fail-closed davranışı
- Ayrı service/admin/monitor kimlikleri ve current+previous anahtar rotasyonu
- Guest ve yetkisiz servis için kalıcı publish reddi
- Onay kimliğinin istemciden taklit edilememesi
- Dry-run, blocker, insan onayı ve yetki yayınlama kapıları
- PostgreSQL tenant filtreleri, PII maskeleme, kota fail-closed davranışı
- CRM HMAC zaman penceresi ve current+previous secret doğrulaması
- PII içeren istekte cache bypass; exact cache sonucunda şema doğrulaması
- Katalogda bulunmayan/uydurulmuş product code reddi
- Atomik backup, checksum, gerçek geçici DB restore ve temizlik sözleşmesi

## Eval durumu

Eval runner her çalışmada geçerli JSON raporu üretir ve şu kapıları uygular:

- extraction doğruluğu en az `%90`,
- design senaryolarının en az `%90`ında beklenen servislerin tamamı,
- uydurulmuş katalog kodu `0`,
- reddedilmiş tool çağrısı `0`.

Bu teslim sırasında ayrı bir eval bütçesi/üretim model anahtarıyla tam gerçek
model koşusu yapılmadı. Model tier'ları seçildikten sonra bütçeli eval raporu
alınmadan model değişikliği üretime çıkarılmamalıdır.

## Dış aktivasyon gerektirenler

1. Public üretim hostname'i için Turnstile site/secret çifti.
2. Fast/balanced/strong OpenRouter model slug'larının seçimi ve eval raporu.
3. Calculator ve CRM için PostgreSQL URL/rolleri ve açık migration çalıştırması.
4. Restic repository/password ve bulut obje deposu credentials.
5. Alarm webhook'u ve günlük maliyet alarm eşiği sahibi.
6. TLS/Caddy alan adı ve canlı dry-run smoke testi.
7. Publish'in açılması için iş sahibi değişiklik onayı.

Offsite credentials veya webhook yokken servisler bilerek etkin değildir; yerel
yedek ve journal log'u dış yedek/alarm varmış gibi raporlanmaz.
