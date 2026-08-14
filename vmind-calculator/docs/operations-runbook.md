# Üretim işletim runbook'u

Bu belge iki ayrı veri düzlemini kapsar:

- Calculator/runtime PostgreSQL (`vmind_runtime`)
- CRM PostgreSQL (`vmind`)

## Sağlık ve alarm

- `GET /api/health/live`: kimliksiz, yalnız sürecin ayakta olduğunu bildirir.
- `GET /api/health/ready`: `WEB_MONITOR_API_KEY` Bearer ister; PostgreSQL,
  katalog envanteri ve LLM yapılandırmasını denetler. Admin/CRM verisi döndürmez.
- `vmind-health-check.timer`: iki dakikada bir readiness kontrol eder. Admin
  URL/key ayrıca verilirse bugünkü LLM maliyetini `VMIND_ALERT_DAILY_COST_USD`
  eşiğiyle karşılaştırır. `VMIND_CRM_HEALTH_URL` ve
  `VMIND_CRM_SITE_SECRET` verilirse CRM'nin imzalı health ucunu ve CRM
  PostgreSQL bağlantısını da denetler.
- Hata her zaman systemd journal'a yazılır. `VMIND_ALERT_WEBHOOK_URL` verilirse
  aynı olay webhook'a da gider. Webhook tanımlı değilse harici bildirim **etkin
  değildir**; yalnız journal/systemd failure görülür.

Kurulum özeti:

```bash
sudo install -d -m 700 /etc/vmind
sudo install -m 600 deploy/monitor.env.example /etc/vmind/monitor.env
sudo install -m 755 deploy/vmind-health-check /usr/local/sbin/vmind-health-check
sudo install -m 644 deploy/vmind-health-check.service deploy/vmind-health-check.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vmind-health-check.timer
sudo systemctl start vmind-health-check.service
sudo journalctl -u vmind-health-check.service -n 50 --no-pager
```

## Yedek zinciri

1. Gece `pg_dump --format=custom` atomik geçici dosyaya alınır.
2. `pg_restore --list` ve SHA-256 doğrulanmadan kalıcı ada taşınmaz.
3. Yerel dump + checksum 14 gün tutulur.
4. `restic` etkinse son dump şifreli, VM dışı depoya gönderilir; günlük 14,
   haftalık 8, aylık 12 snapshot tutulur ve `restic check` çalışır.
5. Ayda bir dump yeni, sabit ön ekli geçici veritabanına gerçekten restore
   edilir. Şema doğrulanır ve geçici DB silinir. Başarı zamanı
   `/var/lib/*-restore-drill/last-success` dosyasına yazılır.

Yerel backup tek başına VM kaybına karşı koruma değildir. Offsite repository,
restic parola dosyası ve S3 credentials girilmeden offsite koruma **etkin
değildir**.

Calculator restore drill kurulumu:

```bash
sudo install -m 755 deploy/vmind-runtime-postgres-restore-drill /usr/local/sbin/
sudo install -m 644 deploy/vmind-runtime-postgres-restore-drill.service \
  deploy/vmind-runtime-postgres-restore-drill.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vmind-runtime-postgres-restore-drill.timer
sudo systemctl start vmind-runtime-postgres-restore-drill.service
```

Offsite restic kurulumu:

```bash
sudo apt-get install restic
sudo install -m 600 deploy/offsite-backup.env.example /etc/vmind/offsite-backup.env
sudo touch /etc/vmind/restic-password
sudo chmod 600 /etc/vmind/restic-password
sudo install -m 755 deploy/vmind-postgres-offsite-backup /usr/local/sbin/
sudo install -m 644 deploy/vmind-postgres-offsite-backup.service \
  deploy/vmind-postgres-offsite-backup.timer /etc/systemd/system/
# /etc/vmind içindeki boş değerleri secret manager çıktılarıyla doldurduktan sonra:
sudo systemctl daemon-reload
sudo systemctl enable --now vmind-postgres-offsite-backup.timer
sudo systemctl start vmind-postgres-offsite-backup.service
```

Gerçek felaket geri dönüşü önce yeni bir veritabanına yapılır; doğrulanmadan canlı
DB üzerine restore edilmez. Uygulama kapatılır, son dump checksum'ı doğrulanır,
yeni DB restore edilir, `npm run db:verify` çalışır, sonra bağlantı adresi yeni
DB'ye çevrilir. Eski DB olay incelemesi bitene kadar silinmez.

CRM VM'de aynı sözleşmenin `openclaw-vmind-crm/deploy/vmind-postgres-restore-drill*`
dosyaları kullanılır. Root servis backup dosyasını yalnız okur; restore işlemini
`postgres` kullanıcısıyla sabit `vmind_crm_restore_drill_` ön ekli geçici DB'ye
yapar ve her durumda bu geçici DB'yi temizler.

## Secret rotasyonu

Secret'lar birbirinin yerine kullanılmaz: OpenRouter, admin, monitor, servis,
CRM HMAC, Turnstile ve PostgreSQL parolaları ayrıdır.

Admin/monitor/servis Bearer anahtarları:

1. Yeni anahtarı üretin ve ana değişkene yazın.
2. Eski anahtarı geçici `*_PREVIOUS` değişkenine taşıyın.
3. Servisi yeniden başlatın; yeni anahtarla readiness/smoke test yapın.
4. Tüm istemcileri yeni anahtara geçirin.
5. `*_PREVIOUS` değerini silip tekrar başlatın.

CRM HMAC sıfır kesinti sırası:

1. CRM alıcısında `VMIND_CRM_SITE_SECRET=yeni`,
   `VMIND_CRM_SITE_SECRET_PREVIOUS=eski` ile restart.
2. Calculator göndericisinde yalnız `VMIND_CRM_SITE_SECRET=yeni` ile restart.
3. İmzalı health ve örnek CRM senkronunu doğrulayın.
4. CRM alıcısından `PREVIOUS` değerini kaldırın.

OpenRouter:

1. Sağlayıcı panelinde yeni key oluşturun; eskiyi henüz iptal etmeyin.
2. Sunucu secret/env değerini değiştirip restart edin.
3. Readiness, tek vakalık bütçeli eval ve token/maliyet kaydını doğrulayın.
4. Eski key'i sağlayıcı panelinden iptal edin.

Turnstile site/secret key çifti birlikte değiştirilir; yeni widget ile doğrulama
başarılı olmadan eski çift silinmez. PostgreSQL parola rotasyonu rol parolası,
`VMIND_DATABASE_URL`, tünel ve readiness birlikte doğrulanarak yapılır.

Önerilen periyot: OpenRouter/admin/monitor/servis/CRM 90 gün; olay veya sızıntı
şüphesinde hemen. Rotation tarihi ve uygulayan kişi secret'ın kendisi olmadan
değişiklik kaydına yazılır.

## OpenClaw host bağımlılığı

`openclaw-vmind-crm` bir eklentidir; OpenClaw gateway'i kendi paketinin içine
kopyalamaz. Minimum gateway/plugin API sürümü paket manifestindeki
`openclaw.compat` alanında belirtilir; OpenClaw npm dependency olarak tekrar
kurulmaz. Güvenlik taraması iki ayrı kapsamda yapılır:

1. Eklenti dizininde `npm audit --omit=dev --audit-level=high`.
2. Gateway hostunda kurulu gerçek OpenClaw sürümü için üreticinin upgrade ve
   audit akışı.

Host upgrade'i önce staging gateway'de CRM tool kayıtları, imzalı site health ve
tek dry-run teklif ile doğrulanmadan canlıya alınmaz.
