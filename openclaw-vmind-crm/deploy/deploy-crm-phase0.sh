#!/usr/bin/env bash
#
# VMind CRM Faz 0 — runtime migration kapısını güvenli biçimde dağıtır.
#
# Bu script SQL veya migration ÇALIŞTIRMAZ. Yalnızca aşağıdaki beş Faz 0
# dosyasını kurar, şema parmak izinin restart öncesi/sonrası değişmediğini
# doğrular ve readiness logunu zorunlu kapı yapar.
#
# Sunucuda kullanım:
#   ./deploy-crm-phase0.sh /home/ubuntu/crm-stage
#
# Bu dağıtımın yedeğine elle dönmek için:
#   ./deploy-crm-phase0.sh --rollback 20260813-170400

set -Eeuo pipefail

EXT=/home/openclaw/.openclaw/extensions/vmind-crm
BK=/home/openclaw/.openclaw/backups
UNIT=openclaw-gateway.service
DROPIN=/home/openclaw/.config/systemd/user/openclaw-gateway.service.d/vmind-postgres.conf
OC_CLI=/home/openclaw/.npm-global/bin/openclaw
OC_UID=$(id -u openclaw)

EXPECTED_MIGRATION=001_platform_foundation.sql
EXPECTED_MIGRATION_CHECKSUM=0bb5760fd341c3a3a100414387c871bdd898b1771b8e77eef12a3d17f4e7a219
EXPECTED_READY_LOG='[vmind-crm] şema doğrulandı (001_platform_foundation.sql; uygulanmış: 1); otomatik migration KAPALI'

FILES=(
  index.js
  postgres-store.js
  schema-requirements.js
  test-schema-guard.mjs
  package.json
)

read -r -d '' EXPECTED_HASHES <<'EOF' || true
cc695337b65a67be0660789cf343458b908506990f7c7e9d934a7a143fbce0f5  index.js
ca6c498568c73d68ec448d077053b7467afcaabb7e253a327bc1725ce8d035d1  postgres-store.js
ea662e6012e31113e3ea7d440994f13d6d207853cb2fa8f639ee08aacc7570a3  schema-requirements.js
52f016dc9c8a86ff85af0a34b2a47143de37981dd54bbac90419f47825e05424  test-schema-guard.mjs
fc8d30608f279e028f9f9e3dee82fc0581ffd1e701211a10fe05b8af3b3cee5b  package.json
EOF

step() { printf '\n=== %s ===\n' "$*"; }
ok() { printf '  [OK] %s\n' "$*"; }
red() { printf '\n!!! KIRMIZI: %s\n' "$*" >&2; }

as_openclaw() {
  sudo -u openclaw -H bash -lc "$1"
}

oc_log() {
  sudo journalctl \
    _UID="$OC_UID" \
    _SYSTEMD_USER_UNIT="$UNIT" \
    --since "$1" \
    --no-pager
}

oc_restart() {
  sudo -u openclaw -H env \
    XDG_RUNTIME_DIR="/run/user/$OC_UID" \
    "$OC_CLI" gateway restart
}

unit_active() {
  sudo -u openclaw -H env \
    XDG_RUNTIME_DIR="/run/user/$OC_UID" \
    systemctl --user is-active --quiet "$UNIT"
}

load_postgres_env() {
  sudo -u openclaw test -r "$DROPIN" || {
    red "PostgreSQL drop-in okunamıyor: $DROPIN"
    return 1
  }

  while IFS= read -r line; do
    case "$line" in
      Environment=VMIND_CRM_BACKEND=*|Environment=PGHOST=*|Environment=PGDATABASE=*|\
Environment=PGUSER=*|Environment=VMIND_TENANT_ID=*)
        export "${line#Environment=}"
        ;;
    esac
  done < <(sudo -u openclaw cat "$DROPIN")

  [[ "${PGDATABASE:-}" == "vmind" ]] || {
    red "Beklenen üretim DB'si 'vmind' değil."
    return 1
  }
  [[ "${PGUSER:-}" == "openclaw" ]] || {
    red "Beklenen PostgreSQL rolü 'openclaw' değil."
    return 1
  }
}

db_fingerprint() {
  sudo -u openclaw -H env \
    PGHOST="$PGHOST" \
    PGDATABASE="$PGDATABASE" \
    PGUSER="$PGUSER" \
    /usr/bin/psql -X -v ON_ERROR_STOP=1 -At <<'SQL'
SELECT 'migration|' || version || '|' || checksum
  FROM platform.schema_migrations
 ORDER BY version;
SELECT 'table_count|' || COUNT(*)
  FROM information_schema.tables
 WHERE table_schema IN ('identity','crm','agent','billing','calculator','platform');
SELECT 'column_count|' || COUNT(*)
  FROM information_schema.columns
 WHERE table_schema IN ('identity','crm','agent','billing','calculator','platform');
SQL
}

verify_expected_live_schema() {
  local fingerprint=$1
  local expected="migration|$EXPECTED_MIGRATION|$EXPECTED_MIGRATION_CHECKSUM"
  local migration_count

  printf '%s\n' "$fingerprint" | grep -Fqx "$expected" || {
    red "Beklenen foundation migration/checksum bulunamadı."
    return 1
  }
  migration_count=$(printf '%s\n' "$fingerprint" | grep -c '^migration|' || true)
  [[ "$migration_count" == "1" ]] || {
    red "Faz 0 kabulü için tam olarak 1 migration bekleniyordu; bulunan: $migration_count"
    return 1
  }
}

verify_snapshot() {
  local timestamp=$1
  local snapshot="$BK/vmind-crm.$timestamp"
  local sums="$BK/vmind-crm.$timestamp.sha256"

  sudo -u openclaw test -d "$snapshot" || {
    red "Yedek bulunamadı: $snapshot"
    return 1
  }
  sudo -u openclaw test -f "$sums" || {
    red "Yedek checksum dosyası bulunamadı: $sums"
    return 1
  }
  as_openclaw "cd '$snapshot' && sha256sum -c --quiet '$sums'"
}

restore_snapshot() {
  local timestamp=$1
  local reason=$2
  local snapshot="$BK/vmind-crm.$timestamp"
  local sums="$BK/vmind-crm.$timestamp.sha256"
  local failed="$EXT.failed-$(date +%Y%m%d-%H%M%S)"

  verify_snapshot "$timestamp" || return 1
  printf '  Geri dönüş nedeni: %s\n' "$reason"
  sudo -u openclaw mv "$EXT" "$failed" || return 1
  sudo -u openclaw cp -a "$snapshot" "$EXT" || return 1
  as_openclaw "cd '$EXT' && sha256sum -c --quiet '$sums'" || return 1
  oc_restart || return 1
  sleep 15
  unit_active || return 1
  ok "Yedek geri yüklendi; başarısız sürüm saklandı: $failed"
}

if [[ "${1:-}" == "--rollback" ]]; then
  rollback_ts=${2:-}
  [[ "$rollback_ts" =~ ^[0-9]{8}-[0-9]{6}$ ]] || {
    red "Kullanım: $0 --rollback YYYYMMDD-HHMMSS"
    exit 2
  }
  load_postgres_env
  restore_snapshot "$rollback_ts" "elle geri dönüş"
  exit 0
fi

STAGE=${1:-}
[[ -n "$STAGE" && -d "$STAGE" ]] || {
  red "Kullanım: $0 /tam/yol/crm-stage"
  exit 2
}

TS=$(date +%Y%m%d-%H%M%S)
SNAP="$BK/vmind-crm.$TS"
SUMS="$BK/vmind-crm.$TS.sha256"
CHANGED=0

rollback_on_error() {
  local code=$?
  trap - ERR
  set +e
  if [[ "$CHANGED" == "1" ]]; then
    red "Dağıtım kapısı kırıldı; otomatik geri dönüş başlıyor."
    if ! restore_snapshot "$TS" "Faz 0 dağıtım hatası"; then
      red "OTOMATİK GERİ DÖNÜŞ TAMAMLANAMADI — elle müdahale gerekli. Yedek: $SNAP"
    fi
  fi
  exit "$code"
}
trap rollback_on_error ERR

step "0) Ortam ve çalışan user-unit"
load_postgres_env
unit_active
ok "$UNIT aktif (UID $OC_UID)"
ok "PGHOST=$PGHOST PGDATABASE=$PGDATABASE PGUSER=$PGUSER"

step "1) Stage dosyalarının SHA-256 doğrulaması"
(
  cd "$STAGE"
  printf '%s\n' "$EXPECTED_HASHES" | sha256sum -c -
)
ok "Beş Faz 0 dosyası doğrulandı"

step "2) Restart öncesi salt-okunur şema parmak izi"
BEFORE_FINGERPRINT=$(db_fingerprint)
printf '%s\n' "$BEFORE_FINGERPRINT"
verify_expected_live_schema "$BEFORE_FINGERPRINT"
ok "Foundation migration/checksum ve mevcut şema kaydedildi"

step "3) Zaman damgalı tam yedek ve checksum"
sudo install -d -o openclaw -g openclaw -m 700 "$BK"
sudo -u openclaw cp -a "$EXT" "$SNAP"
as_openclaw "cd '$SNAP' && find . -path ./node_modules -prune -o -type f -print0 | sort -z | xargs -0 sha256sum > '$SUMS'"
verify_snapshot "$TS"
ok "Yedek doğrulandı: $SNAP"

step "4) Beş Faz 0 dosyasını kur"
CHANGED=1
for file in "${FILES[@]}"; do
  sudo install -o openclaw -g openclaw -m 644 "$STAGE/$file" "$EXT/$file"
done
as_openclaw "cd '$EXT' && printf '%s\\n' '$EXPECTED_HASHES' | sha256sum -c -"
ok "Kurulan dosyalar stage hash'leriyle aynı"

step "5) Sözdizimi ve veritabanına dokunmayan testler"
as_openclaw "cd '$EXT' && node --check index.js && node --check postgres-store.js && node --check schema-requirements.js && node --check test-schema-guard.mjs"
as_openclaw "cd '$EXT' && npm test"
ok "Sözdizimi ve yerel testler yeşil"

step "6) İzole canlı PostgreSQL smoke testi"
PG_OUTPUT=$(sudo -u openclaw -H env \
  VMIND_CRM_BACKEND="${VMIND_CRM_BACKEND:-postgres}" \
  PGHOST="$PGHOST" \
  PGDATABASE="$PGDATABASE" \
  PGUSER="$PGUSER" \
  VMIND_TENANT_ID="${VMIND_TENANT_ID:-}" \
  VMIND_ALLOW_LIVE_DB_TEST=1 \
  bash -lc "cd '$EXT' && npm run test:postgres")
printf '%s\n' "$PG_OUTPUT"
printf '%s\n' "$PG_OUTPUT" | grep -q '"migrations":"atlanacak"'
printf '%s\n' "$PG_OUTPUT" | grep -q '"remaining_rows":0'
printf '%s\n' "$PG_OUTPUT" | grep -q '"remaining_tenant_rows":0'
ok "Canlı test tenant'ı tamamen temizlendi; migration atlandı"

step "7) Restart öncesi şema hâlâ aynı mı"
PRE_RESTART_FINGERPRINT=$(db_fingerprint)
[[ "$PRE_RESTART_FINGERPRINT" == "$BEFORE_FINGERPRINT" ]] || {
  red "Dosya kurulumu/testler sırasında şema değişti."
  exit 1
}
ok "Şema parmak izi değişmedi"

step "8) Gateway restart"
RESTART_TS=$(date '+%Y-%m-%d %H:%M:%S')
oc_restart
sleep 15
unit_active
ok "$UNIT yeniden aktif"

step "9) Readiness ve hata log kapıları"
LOG_OUTPUT=$(oc_log "$RESTART_TS")
printf '%s\n' "$LOG_OUTPUT" | grep -F "$EXPECTED_READY_LOG"
printf '%s\n' "$LOG_OUTPUT" | grep -F '[gateway] ready'
if printf '%s\n' "$LOG_OUTPUT" | grep -iE \
  'ŞEMA DOĞRULANAMADI|ECONNREFUSED|unhandled|fatal|error'; then
  red "Restart sonrasında hata kaydı bulundu."
  exit 1
fi
ok "Readiness logu görüldü; başlangıç/DB hatası yok"

step "10) Restart sonrası şema parmak izi"
AFTER_FINGERPRINT=$(db_fingerprint)
printf '%s\n' "$AFTER_FINGERPRINT"
[[ "$AFTER_FINGERPRINT" == "$BEFORE_FINGERPRINT" ]] || {
  red "Restart sonrasında platform.schema_migrations veya şema değişti."
  exit 1
}
ok "Restart şemayı değiştirmedi"

trap - ERR
cat <<EOF

=== FAZ 0 DAĞITIMI YEŞİL ===
Yedek       : $SNAP
Checksum    : $SUMS
Manuel dönüş: ./deploy-crm-phase0.sh --rollback $TS

Garanti: runtime/gateway migration çalıştırmadı; şema parmak izi değişmedi.
EOF
