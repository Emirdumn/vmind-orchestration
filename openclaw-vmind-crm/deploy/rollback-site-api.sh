#!/usr/bin/env bash
# deploy-site-api.sh tarafından alınan tam yedeğe döner.

set -Eeuo pipefail

TS=${1:-}
[[ "$TS" =~ ^[0-9]{8}-[0-9]{6}$ ]] || {
  printf 'Kullanım: %s YYYYMMDD-HHMMSS\n' "$0" >&2
  exit 2
}

EXT=/home/openclaw/.openclaw/extensions/vmind-crm
BACKUPS=/home/openclaw/.openclaw/backups
DROPIN=/home/openclaw/.config/systemd/user/openclaw-gateway.service.d/vmind-postgres.conf
SITE_CONFIG_DIR=/home/openclaw/.config/vmind-crm
SNAP="$BACKUPS/vmind-crm.$TS"
CONFIG_SNAP="$BACKUPS/vmind-crm-site-config.$TS"
DROPIN_SNAP="$BACKUPS/vmind-postgres.conf.$TS"
UNIT=openclaw-gateway.service
OC_CLI=/home/openclaw/.npm-global/bin/openclaw
OC_UID=$(id -u openclaw)

sudo -u openclaw test -d "$SNAP"
sudo -u openclaw test -f "$DROPIN_SNAP"

FAILED="$EXT.failed-$(date +%Y%m%d-%H%M%S)"
sudo -u openclaw mv "$EXT" "$FAILED"
sudo -u openclaw cp -a "$SNAP" "$EXT"
sudo install -o openclaw -g openclaw -m 600 "$DROPIN_SNAP" "$DROPIN"
sudo rm -rf "$SITE_CONFIG_DIR"
if sudo -u openclaw test -d "$CONFIG_SNAP"; then
  sudo -u openclaw cp -a "$CONFIG_SNAP" "$SITE_CONFIG_DIR"
fi

sudo -u openclaw -H env XDG_RUNTIME_DIR="/run/user/$OC_UID" systemctl --user daemon-reload
sudo -u openclaw -H env XDG_RUNTIME_DIR="/run/user/$OC_UID" "$OC_CLI" gateway restart
sleep 12
sudo -u openclaw -H env XDG_RUNTIME_DIR="/run/user/$OC_UID" \
  systemctl --user is-active --quiet "$UNIT"

printf 'CRM geri dönüş tamamlandı. Eski sürüm: %s; başarısız sürüm: %s\n' "$SNAP" "$FAILED"
