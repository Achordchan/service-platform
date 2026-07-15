#!/usr/bin/env bash
# Canonical remote deploy script for VPS (/opt/service-platform/deploy.sh)
set -euo pipefail
APP_DIR=/var/www/service-platform
APP_USER=serviceplatform
ENV_FILE=/etc/service-platform/app.env
RELEASE_STAGING=${1:-}
if [[ -z "${RELEASE_STAGING}" || ! -d "${RELEASE_STAGING}" ]]; then
  echo "Usage: deploy.sh /path/to/release-dir" >&2
  exit 1
fi
if [[ ! -f "${RELEASE_STAGING}/.next/BUILD_ID" || ! -f "${RELEASE_STAGING}/.next/server/pages-manifest.json" ]]; then
  echo "Release .next incomplete (missing BUILD_ID or pages-manifest)." >&2
  exit 1
fi
if [[ ! -f "${RELEASE_STAGING}/prisma/schema.prisma" ]]; then
  echo "Release missing prisma/schema.prisma" >&2
  exit 1
fi
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Runtime env file missing: ${ENV_FILE}" >&2
  exit 1
fi
set -a
source "${ENV_FILE}"
set +a
if [[ -z "${PLATFORM_SECRET_ENCRYPTION_KEY:-}" ]]; then
  echo "[deploy] PLATFORM_SECRET_ENCRYPTION_KEY not set; app will derive a stable compatibility key"
else
  node -e '
    const key = Buffer.from(process.env.PLATFORM_SECRET_ENCRYPTION_KEY, "base64");
    if (key.length !== 32) {
      console.error("PLATFORM_SECRET_ENCRYPTION_KEY must decode to 32 bytes");
      process.exit(1);
    }
  '
fi
echo "[deploy] stop app processes before swap"
systemctl stop service-platform || true
systemctl stop service-platform-worker || true
echo "[deploy] sync release -> ${APP_DIR}"
rsync -a --delete \
  --exclude ".git/" \
  --exclude ".env" \
  --exclude ".env.*" \
  --exclude "node_modules/" \
  --exclude ".data/" \
  --exclude "public/uploads/" \
  --exclude "test-results/" \
  --exclude "playwright-report/" \
  --exclude "coverage/" \
  --chown=${APP_USER}:${APP_USER} \
  "${RELEASE_STAGING}/" "${APP_DIR}/"
install -o ${APP_USER} -g ${APP_USER} -m 640 "${ENV_FILE}" "${APP_DIR}/.env"
rm -rf "${APP_DIR}/src/generated/prisma"
cd "${APP_DIR}"
echo "[deploy] install deps"
sudo -u ${APP_USER} -H bash -lc "cd ${APP_DIR} && pnpm install --frozen-lockfile"
echo "[deploy] prisma generate + migrate"
sudo -u ${APP_USER} -H bash -lc "cd ${APP_DIR} && set -a && source ${ENV_FILE} && set +a && NODE_OPTIONS=--max-old-space-size=768 pnpm exec prisma generate && pnpm exec prisma migrate deploy"
echo "[deploy] restart services"
systemctl restart service-platform
systemctl restart service-platform-worker
sleep 2
systemctl is-active --quiet service-platform
systemctl is-active --quiet service-platform-worker
systemctl is-active --quiet x-ui
echo "[deploy] done"
