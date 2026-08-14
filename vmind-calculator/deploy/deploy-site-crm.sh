#!/usr/bin/env bash
# VMind Teklif sitesi CRM istemcisi + yalnız Docker köprüsüne bağlı SSH tüneli.

set -Eeuo pipefail

APP=/opt/vmind-agent
BACKUPS=/opt/vmind-agent-backups
TUNNEL_UNIT=/etc/systemd/system/vmind-crm-tunnel.service
TUNNEL_KEY=/home/ubuntu/.ssh/vmind-crm-tunnel
CRM_URL=http://172.29.77.1:18790/vmind-crm/v1/site/quotes
CRM_HOST_KEY_FINGERPRINT='SHA256:wrG2/Dn6q3IOPdGGjUc4xT2mOTbbkuVO8E18rPne8Lg'

STAGE=${1:-}
EXPECTED_MANIFEST_HASH=${2:-}
SECRET_FILE=${3:-}

[[ -d "$STAGE" && -f "$STAGE/manifest.sha256" ]] || { printf 'Stage/manifest yok.\n' >&2; exit 2; }
[[ "$EXPECTED_MANIFEST_HASH" =~ ^[0-9a-f]{64}$ ]] || { printf 'Manifest hash geçersiz.\n' >&2; exit 2; }
[[ -r "$SECRET_FILE" ]] || { printf 'Secret dosyası okunamıyor.\n' >&2; exit 2; }

step() { printf '\n=== %s ===\n' "$*"; }
ok() { printf '  [OK] %s\n' "$*"; }
red() { printf '\n!!! KIRMIZI: %s\n' "$*" >&2; }

install_known_host() {
  local temp fingerprint
  temp=$(mktemp)
  ssh-keyscan -T 5 -t ed25519 43.229.94.110 > "$temp" 2>/dev/null
  fingerprint=$(ssh-keygen -lf "$temp" | awk '{print $2}')
  [[ "$fingerprint" == "$CRM_HOST_KEY_FINGERPRINT" ]]
  install -o ubuntu -g ubuntu -m 600 "$temp" /home/ubuntu/.ssh/known_hosts.vmind-crm
  rm -f "$temp"
}

tunnel_health_from_container() {
  (cd "$APP" && docker compose exec -T agent node --input-type=module -e '
    import { createHmac } from "node:crypto";
    const timestamp = String(Math.floor(Date.now()/1000));
    const signature = createHmac("sha256", process.env.VMIND_CRM_SITE_SECRET)
      .update(`${timestamp}.`).digest("hex");
    const response = await fetch("http://172.29.77.1:18790/vmind-crm/v1/site/health", {
      headers: {
        "X-VMind-CRM-Timestamp": timestamp,
        "X-VMind-CRM-Signature": `v1=${signature}`,
      },
    });
    const body = await response.json();
    if (!response.ok || body.ok !== true || body.database !== "ready") process.exit(1);
    console.log(JSON.stringify({ok:true,database:body.database}));
  ')
}

TS=$(date +%Y%m%d-%H%M%S)
SNAP="$BACKUPS/vmind-agent.$TS"
UNIT_SNAP="$BACKUPS/vmind-crm-tunnel.service.$TS"
UNIT_EXISTED=0
CHANGED=0

restore() {
  local reason=$1
  red "Geri dönüş: $reason"
  systemctl disable --now vmind-crm-tunnel.service >/dev/null 2>&1 || true
  mv "$APP" "$APP.failed-$(date +%Y%m%d-%H%M%S)"
  cp -a "$SNAP" "$APP"
  if [[ "$UNIT_EXISTED" == 1 ]]; then
    install -o root -g root -m 644 "$UNIT_SNAP" "$TUNNEL_UNIT"
    systemctl daemon-reload
    systemctl enable --now vmind-crm-tunnel.service
  else
    rm -f "$TUNNEL_UNIT"
    systemctl daemon-reload
  fi
  (cd "$APP" && docker compose up -d --build agent)
}

on_error() {
  local code=$?
  trap - ERR
  set +e
  if [[ "$CHANGED" == 1 ]]; then restore "dağıtım kapısı kırıldı" || true; fi
  exit "$code"
}
trap on_error ERR

step "0) Ön koşullar"
systemctl is-active --quiet docker
ip -4 addr show | grep -F '172.29.77.1/24' >/dev/null
[[ -r "$TUNNEL_KEY" && -r "$TUNNEL_KEY.pub" ]]
SECRET=$(tr -d '\r\n' < "$SECRET_FILE")
[[ "$SECRET" =~ ^[0-9a-f]{64}$ ]] || { red "Secret 64 karakter hex olmalı."; exit 1; }
unset SECRET
ok "Docker, sabit köprü IP'si, tünel anahtarı ve secret hazır"

step "1) Stage bütünlüğü"
ACTUAL_MANIFEST_HASH=$(sha256sum "$STAGE/manifest.sha256" | awk '{print $1}')
[[ "$ACTUAL_MANIFEST_HASH" == "$EXPECTED_MANIFEST_HASH" ]]
(cd "$STAGE" && sha256sum -c --quiet manifest.sha256)
ok "Manifest ve stage dosyaları doğrulandı"

step "2) Uygulama ve unit yedeği"
install -d -o root -g root -m 700 "$BACKUPS"
cp -a "$APP" "$SNAP"
if [[ -f "$TUNNEL_UNIT" ]]; then
  cp -a "$TUNNEL_UNIT" "$UNIT_SNAP"
  UNIT_EXISTED=1
fi
ok "Yedek: $SNAP"

step "3) Kaynaklar, env ve kısıtlı tünel"
CHANGED=1
rsync -a --exclude manifest.sha256 "$STAGE/" "$APP/"
chown -R ubuntu:ubuntu "$APP"

python3 - "$APP/.env" "$SECRET_FILE" "$CRM_URL" <<'PY'
import pathlib, sys
env_path, secret_path = map(pathlib.Path, sys.argv[1:3])
url = sys.argv[3]
secret = secret_path.read_text().strip()
replace = {"VMIND_CRM_SITE_URL": url, "VMIND_CRM_SITE_SECRET": secret}
lines = []
seen = set()
for line in env_path.read_text().splitlines():
    key = line.split("=", 1)[0] if "=" in line else ""
    if key in replace:
        lines.append(f"{key}={replace[key]}")
        seen.add(key)
    else:
        lines.append(line)
for key, value in replace.items():
    if key not in seen:
        lines.append(f"{key}={value}")
env_path.write_text("\n".join(lines) + "\n")
PY
chown ubuntu:ubuntu "$APP/.env"
chmod 600 "$APP/.env"

install_known_host
install -o root -g root -m 644 "$APP/deploy/vmind-crm-tunnel.service" "$TUNNEL_UNIT"
systemctl daemon-reload
systemctl enable --now vmind-crm-tunnel.service
sleep 3
systemctl is-active --quiet vmind-crm-tunnel.service
ss -ltn | grep -F '172.29.77.1:18790' >/dev/null
ok "Tünel yalnız Docker köprü adresinde dinliyor"

step "4) Compose doğrulama, build ve kontrollü restart"
(cd "$APP" && docker compose config --quiet)
(cd "$APP" && docker compose build agent)
(cd "$APP" && docker compose up -d agent)
for _ in $(seq 1 30); do
  container_id=$(cd "$APP" && docker compose ps -q agent)
  status=$(docker inspect --format '{{.State.Health.Status}}' "$container_id" 2>/dev/null || true)
  [[ "$status" == healthy ]] && break
  sleep 2
done
[[ "$status" == healthy ]]
ok "Yeni konteyner healthy"

step "5) Uçtan uca, yazmasız kapılar"
curl -fsS http://127.0.0.1:8080/api/auth/config | python3 -c \
  'import json,sys; x=json.load(sys.stdin); assert x.get("kind") in {"shared-secret","vmind-token"}'
tunnel_health_from_container
LOGS=$(cd "$APP" && docker compose logs --since 5m agent)
printf '%s\n' "$LOGS" | grep -F 'CRM senkronu     : imzalı site API'
if printf '%s\n' "$LOGS" | grep -iE 'ECONNREFUSED|unhandled|fatal'; then
  red "Uygulama logunda kritik hata bulundu."
  exit 1
fi
curl -fsS https://teklif.43-229-94-48.sslip.io/api/auth/config >/dev/null
ok "Tarayıcı girişi + container→tünel→CRM HMAC health yeşil"

trap - ERR
cat <<EOF

=== TEKLİF SİTESİ CRM DAĞITIMI YEŞİL ===
Yedek: $SNAP
Tünel: 172.29.77.1:18790 -> CRM 127.0.0.1:18789
Genel internete yeni port açılmadı.
EOF
