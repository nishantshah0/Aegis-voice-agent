#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 Vultr server for Refill Guard (task 2.6).
# Run it on the server as root:
#   DOMAIN=refill.example.com bash setup-server.sh
# It installs Node.js 24 (from nodejs.org, checksum verified), Caddy (Ubuntu's package, which
# gets and renews the https certificate on its own), a systemd service for the app, and a
# firewall that only lets SSH, http and https in. The app itself arrives with deploy.sh.
set -euo pipefail

: "${DOMAIN:?Set DOMAIN, e.g. DOMAIN=refill.example.com bash setup-server.sh}"
[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }

APP_USER=refill
APP_DIR=/opt/refill-guard/app

echo "== Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q caddy ufw rsync ca-certificates curl xz-utils

echo "== Node.js 24 from nodejs.org"
case "$(uname -m)" in
  x86_64) ARCH=x64 ;;
  aarch64) ARCH=arm64 ;;
  *) echo "Unsupported CPU: $(uname -m)" >&2; exit 1 ;;
esac
TMP=$(mktemp -d)
BASE=https://nodejs.org/dist/latest-v24.x
curl -fsSL "$BASE/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
TARBALL=$(grep -o "node-v[0-9.]*-linux-$ARCH.tar.xz" "$TMP/SHASUMS256.txt" | head -1)
curl -fsSL "$BASE/$TARBALL" -o "$TMP/$TARBALL"
(cd "$TMP" && grep " $TARBALL\$" SHASUMS256.txt | sha256sum -c -)
tar -xJf "$TMP/$TARBALL" -C /usr/local --strip-components=1
rm -rf "$TMP"
node -v

echo "== App user and folder"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/refill-guard --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"
chown -R "$APP_USER:$APP_USER" /opt/refill-guard

echo "== systemd service (the app listens on 127.0.0.1:3000 only; Caddy faces the internet)"
cat > /etc/systemd/system/refill-guard.service <<UNIT
[Unit]
Description=Refill Guard (Next.js)
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
ExecStart=/usr/local/bin/npm run start -- -p 3000 -H 127.0.0.1
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable refill-guard

echo "== Caddy: https for $DOMAIN, proxied to the app"
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	# flush_interval -1 sends server-sent events (/api/events) through without buffering.
	reverse_proxy 127.0.0.1:3000 {
		flush_interval -1
	}
}
CADDY
systemctl reload caddy || systemctl restart caddy

echo "== Firewall: SSH, http (for the certificate check) and https only"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo
echo "Done. Next, from your laptop: HOST=root@<server-ip> DOMAIN=$DOMAIN bash hosting/deploy.sh --env"
