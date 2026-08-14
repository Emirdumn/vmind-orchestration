#!/usr/bin/env bash
# deploy-site-crm.sh tarafından alınan tam uygulama yedeğine döner.

set -Eeuo pipefail

TS=${1:-}
[[ "$TS" =~ ^[0-9]{8}-[0-9]{6}$ ]] || {
  printf 'Kullanım: %s YYYYMMDD-HHMMSS\n' "$0" >&2
  exit 2
}

APP=/opt/vmind-agent
BACKUPS=/opt/vmind-agent-backups
SNAP="$BACKUPS/vmind-agent.$TS"
UNIT=/etc/systemd/system/vmind-crm-tunnel.service
UNIT_SNAP="$BACKUPS/vmind-crm-tunnel.service.$TS"

[[ -d "$SNAP" && -f "$SNAP/docker-compose.yml" && -f "$SNAP/.env" ]]
systemctl disable --now vmind-crm-tunnel.service >/dev/null 2>&1 || true

FAILED="$APP.failed-$(date +%Y%m%d-%H%M%S)"
mv "$APP" "$FAILED"
cp -a "$SNAP" "$APP"

if [[ -f "$UNIT_SNAP" ]]; then
  install -o root -g root -m 644 "$UNIT_SNAP" "$UNIT"
  systemctl daemon-reload
  systemctl enable --now vmind-crm-tunnel.service
else
  rm -f "$UNIT"
  systemctl daemon-reload
fi

cd "$APP"
docker compose up -d --build agent
for _ in $(seq 1 30); do
  container_id=$(docker compose ps -q agent)
  status=$(docker inspect --format '{{.State.Health.Status}}' "$container_id" 2>/dev/null || true)
  [[ "$status" == healthy ]] && break
  sleep 2
done
[[ "$status" == healthy ]]
curl -fsS http://127.0.0.1:8080/api/auth/config >/dev/null

printf 'Teklif sitesi geri dönüş tamamlandı. Eski sürüm: %s; başarısız sürüm: %s\n' "$SNAP" "$FAILED"
