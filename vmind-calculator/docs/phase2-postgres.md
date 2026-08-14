# Faz 2 — Calculator PostgreSQL telemetrisi

## Servis sınırı

CRM, OpenClaw VM'indeki `vmind` veritabanında kalır. Calculator/LLM çalışma
verisi Calculator VM'indeki `vmind_runtime` veritabanında tutulur. İki VM
arasında sağlayıcı güvenlik grubu doğu-batı trafiğini engellediği için 5432
internete açılmamıştır. Servisler arası birleşik yönetim daha sonra API katmanı
üzerinden yapılmalıdır; uygulamaların birbirinin veritabanına doğrudan yazması
beklenmez.

Calculator PostgreSQL yalnızca şuralarda dinler:

```text
127.0.0.1:5432
172.29.77.1:5432  (vmind-agent-runtime adlı host-içi Docker köprüsü)
```

Uygulama `vmind_calculator` rolünü kullanır. Rolün DDL, superuser, rol veya
veritabanı oluşturma yetkisi yoktur; yalnızca gereken identity/agent/billing/
calculator tablolarında sınırlı okuma-yazma hakkı vardır.

## Yazılan kayıtlar

| Şema/tablo | İçerik |
|---|---|
| `identity.principals` | kimliği doğrulanmış aktör/service principal |
| `agent.conversations` | kanal ve akış yaşam döngüsü |
| `agent.messages` | PII-maskeli girdi, kapı cevabı ve sonuç özeti |
| `agent.runs` | model çalışması, durum, hata ve sonuç özeti |
| `agent.llm_usage` | çağrı başına token/cache/maliyet |
| `agent.tool_calls` | başarılı veya reddedilmiş tool çağrısı |
| `agent.audit_events` | sıralı tam denetim izi |
| `billing.usage_ledger` | kotanın yetkili kullanım defteri |
| `billing.quota_policies` | tenant ve principal günlük limitleri |
| `calculator.estimates` | dry-run dâhil Calculator çıktısı |

Ham telefon, e-posta, TCKN, IBAN ve kart bilgisi telemetriye yazılmaz; metinler
`redactPii` ile maskelenir. İç içe yapıların metin alanları da aynı filtreden
geçer ve boyut/depth sınırı uygulanır.

## Raporlama sorguları

Son çalışmalar:

```sql
SELECT *
FROM agent.run_overview
ORDER BY started_at DESC
LIMIT 50;
```

Günlük model tüketimi:

```sql
SELECT *
FROM billing.daily_usage
ORDER BY usage_day_utc DESC, cost_usd DESC;
```

Akış denetim izi:

```sql
SELECT event_seq, event_type, summary, detail, occurred_at
FROM agent.audit_events
WHERE run_id = $1
ORDER BY event_seq;
```

## Kota davranışı

`LLM_DAILY_TOTAL_USD` tenant günlüğüne, `LLM_DAILY_PER_USER_USD` principal
günlüğüne yazılır. Akış başlamadan hem PostgreSQL hem geçiş dönemi JSON aynası
kontrol edilir. Her LLM kullanımında iki kayıt aynı transaction içinde yazılır:

1. `agent.llm_usage`
2. `billing.usage_ledger`

PostgreSQL kullanımı yazılamazsa tamamlanmış teklif kullanıcıdan saklanmaz,
fakat süreç `degraded` olur ve restart/uzlaştırmaya kadar yeni LLM harcaması
başlatılmaz.

## Kimlik sınırı

Bugün web kullanıcıları kendi doğrulanmış principal'ına yazılır. OpenClaw
istemcisi `User-Agent` üzerinden `whatsapp` kanalı olarak ayırt edilir; fakat
Calculator çağrısı hâlâ ortak/service aktörüyle yapılır. WhatsApp'taki gerçek
müşteri principal'ı ve kişi bazlı token paketi Faz 3'te güvenilir imzalı bağlam
ile taşınmalıdır. Modelin serbest metinden telefon çıkarıp kimlik üretmesine izin
verilmemelidir.

## Yedek ve geri dönüş

`vmind-runtime-postgres-backup.timer` her gece Europe/Istanbul 03:00 civarında
custom-format dump üretir, `pg_restore --list` ile doğrular ve 14 günden eski
kopyaları siler:

```text
/var/backups/vmind-runtime-postgres/vmind-runtime-*.dump
```

Canlı geçiş öncesi uygulama ve JSON volume yedeği şuradadır:

```text
/opt/vmind-agent-backups/phase2-20260813T090826Z
```

Acil geri dönüşte önce uygulama durdurulur, yedek dizindeki uygulama ve önceki
image geri alınır, `.env` içindeki `VMIND_DATABASE_URL` kaldırılır ve compose
yeniden başlatılır. Bu durumda JSON defteri yeniden yetkili kaynak olur.
