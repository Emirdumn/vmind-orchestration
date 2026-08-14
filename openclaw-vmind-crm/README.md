# VMind CRM

WhatsApp asistanı ve VMind Teklif sitesi için yapılandırılmış CRM katmanı.
PostgreSQL üretim veri kaynağıdır; SQLite yalnız yerel test ve acil geri dönüş
adaptörü olarak korunur. Airtable ana veri kaynağı değildir ve yalnızca isteğe
bağlı dış hedef olabilir.

## Teklif sitesi API'si

OpenClaw gateway, `VMIND_CRM_SITE_SECRET` tanımlıysa şu eklenti rotasını açar:

```text
POST /vmind-crm/v1/site/quotes
GET  /vmind-crm/v1/site/health
```

İstekler `timestamp + "." + ham JSON gövdesi` üzerinden SHA-256 HMAC ile
imzalanır. Beş dakikadan eski, imzası bozuk veya bilinmeyen alan içeren istekler
CRM store'a ulaşmadan reddedilir. Site ham konuşmayı göndermez; yalnız güvenilir
müşteri telefonu, yapılandırılmış ihtiyaç özeti, katalog servisleri ve varsa
Calculator sonucu taşınır.

`health` rotası da aynı HMAC sözleşmesini kullanır ve kayıt oluşturmaz. Dağıtım
kapısında tünel, imza doğrulaması ve PostgreSQL şema erişimini birlikte sınamak
için kullanılır.

Canlıda gateway yalnız `127.0.0.1` üzerinde kalır. Calculator VM, bu rotaya
hostlar arasındaki kısıtlı SSH port-forward tüneliyle erişir; CRM için genel
internete yeni HTTP portu açılmaz. Aynı `flow_session_id` ve Calculator kimliği
tekrar geldiğinde store mevcut fırsat/hesaplamayı döndürür.

## Veri kaynağı

Üretim ayarları:

```text
VMIND_CRM_BACKEND=postgres
PGHOST=/var/run/postgresql
PGDATABASE=vmind
PGUSER=openclaw
VMIND_TENANT_ID=00000000-0000-0000-0000-000000000001
```

PostgreSQL aynı VM'deki Unix socket üzerinden `peer` kimlik doğrulamasıyla
kullanılır. Parola yoktur ve 5432 internete açılmaz.

## Komutlar

```bash
npm test
npm run db:migrate
npm run db:import-sqlite
npm run db:verify
```

`db:import-sqlite` idempotenttir. Her tablonun kayıt sayısını ve sıralı kimlik
özetini transaction tamamlanmadan karşılaştırır; fark varsa rollback yapar.
Cutover anında `VMIND_VERIFY_SQLITE=1 npm run db:verify` eski SQLite ile birebir
kimlik karşılaştırması da yapar. Cutover sonrasında SQLite donduğu için normal
`db:verify` yalnız PostgreSQL ilişki bütünlüğünü denetler.

## Şemalar

- `identity`: tenant, principal ve hashlenmiş API anahtarı kayıtları
- `crm`: kişi, fırsat, hesaplama, aşama olayı, satış görevi ve dış hedef kuyruğu
- `agent`: konuşma, mesaj, model çalışması, LLM kullanımı ve tool çağrıları
- `billing`: kota politikaları ve kullanım defteri
- `calculator`: sürümlü Calculator teklifleri
- `platform`: uygulanmış migration kayıtları

Faz 1'de OpenClaw üretim yazma/okuma `crm` şemasına geçirilmiştir. Faz 2'de aynı
migration setinin `agent`, `billing` ve `calculator` bölümü Calculator VM'indeki
servis-yerel `vmind_runtime` veritabanına uygulanır. `003_runtime_reporting_views.sql`
çalışma ve günlük tüketim için `agent.run_overview` ile `billing.daily_usage`
görünümlerini sağlar. İki servis birbirinin veritabanına doğrudan yazmaz.

## Geri dönüş

PostgreSQL geçişinde eski SQLite dosyası ve eski eklenti dizini tarihli backup
altında korunur. Acil geri dönüşte gateway durdurulur, önceki eklenti yerine
alınır, `vmind-postgres.conf` drop-in kaldırılır ve gateway yeniden başlatılır.
PostgreSQL'e geçişten sonra oluşan yeni kayıtlar SQLite'a otomatik geri yazılmaz;
geri dönüşten önce PostgreSQL delta export edilmelidir.

## Yedek

`vmind-postgres-backup.timer` her gece custom-format `pg_dump` üretir, dump
kataloğunu doğrular ve 14 günden eski yerel kopyaları siler. Yerel VM yedeği
operasyonel geri dönüş sağlar; VM kaybına karşı ayrı Object Storage/off-site
kopyası sonraki altyapı adımıdır.
