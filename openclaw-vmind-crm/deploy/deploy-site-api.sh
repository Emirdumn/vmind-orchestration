#!/usr/bin/env bash
# VMind Teklif sitesi -> OpenClaw CRM API dağıtımı.
# SQL/migration çalıştırmaz; şema parmak izini dağıtım öncesi/sonrası karşılaştırır.

set -Eeuo pipefail

EXT=/home/openclaw/.openclaw/extensions/vmind-crm
BACKUPS=/home/openclaw/.openclaw/backups
DROPIN=/home/openclaw/.config/systemd/user/openclaw-gateway.service.d/vmind-postgres.conf
SITE_CONFIG_DIR=/home/openclaw/.config/vmind-crm
SITE_ENV="$SITE_CONFIG_DIR/site-api.env"
UNIT=openclaw-gateway.service
OC_CLI=/home/openclaw/.npm-global/bin/openclaw
OC_UID=$(id -u openclaw)

STAGE=${1:-}
EXPECTED_MANIFEST_HASH=${2:-}
SECRET_FILE=${3:-}

[[ -d "$STAGE" && -f "$STAGE/manifest.sha256" ]] || {
  printf 'Stage/manifest bulunamadı.\n' >&2
  exit 2
}
[[ "$EXPECTED_MANIFEST_HASH" =~ ^[0-9a-f]{64}$ ]] || {
  printf 'Beklenen manifest SHA-256 geçersiz.\n' >&2
  exit 2
}
[[ -r "$SECRET_FILE" ]] || {
  printf 'Site HMAC secret dosyası okunamıyor.\n' >&2
  exit 2
}

step() { printf '\n=== %s ===\n' "$*"; }
ok() { printf '  [OK] %s\n' "$*"; }
red() { printf '\n!!! KIRMIZI: %s\n' "$*" >&2; }

as_openclaw() { sudo -u openclaw -H bash -lc "$1"; }
oc_systemctl() {
  sudo -u openclaw -H env XDG_RUNTIME_DIR="/run/user/$OC_UID" systemctl --user "$@"
}
oc_restart() {
  sudo -u openclaw -H env XDG_RUNTIME_DIR="/run/user/$OC_UID" "$OC_CLI" gateway restart
}
oc_log() {
  sudo journalctl _UID="$OC_UID" _SYSTEMD_USER_UNIT="$UNIT" --since "$1" --no-pager
}

load_pg_env() {
  while IFS= read -r line; do
    case "$line" in
      Environment=VMIND_CRM_BACKEND=*|Environment=PGHOST=*|Environment=PGDATABASE=*|\
Environment=PGUSER=*|Environment=VMIND_TENANT_ID=*) export "${line#Environment=}" ;;
    esac
  done < <(sudo -u openclaw cat "$DROPIN")
  [[ "${VMIND_CRM_BACKEND:-}" == postgres && "${PGDATABASE:-}" == vmind && "${PGUSER:-}" == openclaw ]]
}

db_fingerprint() {
  sudo -u openclaw -H env PGHOST="$PGHOST" PGDATABASE="$PGDATABASE" PGUSER="$PGUSER" \
    psql -X -v ON_ERROR_STOP=1 -At <<'SQL'
SELECT 'migration|' || version || '|' || checksum FROM platform.schema_migrations ORDER BY version;
SELECT 'table_count|' || COUNT(*) FROM information_schema.tables
 WHERE table_schema IN ('identity','crm','agent','billing','calculator','platform');
SELECT 'column_count|' || COUNT(*) FROM information_schema.columns
 WHERE table_schema IN ('identity','crm','agent','billing','calculator','platform');
SQL
}

health_check() {
  local timestamp signature response
  timestamp=$(date +%s)
  signature=$(sudo python3 - "$timestamp" "$SECRET_FILE" <<'PY'
import hashlib, hmac, pathlib, sys
timestamp, path = sys.argv[1:]
secret = pathlib.Path(path).read_text().strip().encode()
print(hmac.new(secret, f"{timestamp}.".encode(), hashlib.sha256).hexdigest())
PY
  )
  response=$(curl -fsS \
    -H "X-VMind-CRM-Timestamp: $timestamp" \
    -H "X-VMind-CRM-Signature: v1=$signature" \
    http://127.0.0.1:18789/vmind-crm/v1/site/health)
  python3 -c 'import json,sys; x=json.load(sys.stdin); assert x.get("ok") is True and x.get("database")=="ready"' \
    <<<"$response"
}

TS=$(date +%Y%m%d-%H%M%S)
SNAP="$BACKUPS/vmind-crm.$TS"
CONFIG_SNAP="$BACKUPS/vmind-crm-site-config.$TS"
DROPIN_SNAP="$BACKUPS/vmind-postgres.conf.$TS"
CHANGED=0

restore() {
  local reason=$1
  red "Geri dönüş: $reason"
  sudo -u openclaw rm -rf "$EXT"
  sudo -u openclaw cp -a "$SNAP" "$EXT"
  sudo install -o openclaw -g openclaw -m 600 "$DROPIN_SNAP" "$DROPIN"
  sudo rm -rf "$SITE_CONFIG_DIR"
  if [[ -d "$CONFIG_SNAP" ]]; then
    sudo -u openclaw cp -a "$CONFIG_SNAP" "$SITE_CONFIG_DIR"
  fi
  oc_systemctl daemon-reload
  oc_restart
  sleep 12
  oc_systemctl is-active --quiet "$UNIT"
}

on_error() {
  local code=$?
  trap - ERR
  set +e
  if [[ "$CHANGED" == 1 ]]; then restore "dağıtım kapısı kırıldı" || true; fi
  exit "$code"
}
trap on_error ERR

step "0) Salt-okunur ön koşullar"
load_pg_env
oc_systemctl is-active --quiet "$UNIT"
SECRET=$(sudo tr -d '\r\n' < "$SECRET_FILE")
[[ "$SECRET" =~ ^[0-9a-f]{64}$ ]] || { red "Secret 64 karakter hex olmalı."; exit 1; }
unset SECRET
BEFORE=$(db_fingerprint)
printf '%s\n' "$BEFORE"
ok "Gateway aktif; PostgreSQL hedefi ve şema parmak izi alındı"

step "1) Stage bütünlüğü"
ACTUAL_MANIFEST_HASH=$(sha256sum "$STAGE/manifest.sha256" | awk '{print $1}')
[[ "$ACTUAL_MANIFEST_HASH" == "$EXPECTED_MANIFEST_HASH" ]]
(cd "$STAGE" && sha256sum -c --quiet manifest.sha256)
ok "Manifest ve tüm stage dosyaları doğrulandı"

step "2) Tam eklenti/config yedeği"
sudo install -d -o openclaw -g openclaw -m 700 "$BACKUPS"
sudo -u openclaw cp -a "$EXT" "$SNAP"
sudo -u openclaw cp -a "$DROPIN" "$DROPIN_SNAP"
if sudo -u openclaw test -d "$SITE_CONFIG_DIR"; then
  sudo -u openclaw cp -a "$SITE_CONFIG_DIR" "$CONFIG_SNAP"
fi
ok "Yedek: $SNAP"

step "3) Dosyalar ve gizli yapılandırma"
CHANGED=1
while IFS= read -r path; do
  [[ "$path" != manifest.sha256 ]]
  sudo install -D -o openclaw -g openclaw -m 644 "$STAGE/$path" "$EXT/$path"
done < <(cd "$STAGE" && find . -type f ! -name manifest.sha256 -printf '%P\n' | sort)

sudo install -d -o openclaw -g openclaw -m 700 "$SITE_CONFIG_DIR"
sudo python3 - "$SECRET_FILE" "$SITE_ENV" <<'PY'
import pathlib, sys
source, target = map(pathlib.Path, sys.argv[1:])
secret = source.read_text().strip()
target.write_text(f"VMIND_CRM_SITE_SECRET={secret}\n")
PY
sudo chown openclaw:openclaw "$SITE_ENV"
sudo chmod 600 "$SITE_ENV"

sudo python3 - "$DROPIN" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
lines = [x for x in path.read_text().splitlines() if not x.startswith("EnvironmentFile=")]
lines.append("EnvironmentFile=/home/openclaw/.config/vmind-crm/site-api.env")
path.write_text("\n".join(lines) + "\n")
PY
sudo chown openclaw:openclaw "$DROPIN"
sudo chmod 600 "$DROPIN"
(cd "$STAGE" && sha256sum -c --quiet manifest.sha256)
ok "Site API dosyaları ve 0600 secret env kuruldu"

step "4) Testler ve migration-yok kapısı"
as_openclaw "cd '$EXT' && node --check index.js && node --check site-api.js && node --check postgres-store.js"
as_openclaw "cd '$EXT' && npm test"
[[ "$(db_fingerprint)" == "$BEFORE" ]]
ok "Testler yeşil; şema değişmedi"

step "5) Gateway restart ve imzalı salt-okunur sağlık"
RESTART_AT=$(date '+%Y-%m-%d %H:%M:%S')
oc_systemctl daemon-reload
oc_restart
sleep 12
oc_systemctl is-active --quiet "$UNIT"
LOGS=$(oc_log "$RESTART_AT")
printf '%s\n' "$LOGS" | grep -F '[vmind-crm] şema doğrulandı'
printf '%s\n' "$LOGS" | grep -F '[vmind-crm] site API etkin:'
if printf '%s\n' "$LOGS" | grep -iE 'ŞEMA DOĞRULANAMADI|ECONNREFUSED|unhandled|fatal'; then
  red "Gateway logunda kritik hata var."
  exit 1
fi
health_check
[[ "$(db_fingerprint)" == "$BEFORE" ]]
ok "HMAC + gateway + PostgreSQL health yeşil; kayıt oluşturulmadı"

trap - ERR
cat <<EOF

=== CRM SITE API DAĞITIMI YEŞİL ===
Yedek: $SNAP
Geri dönüş: ./rollback-site-api.sh $TS
Şema/migration değişmedi.
EOF
