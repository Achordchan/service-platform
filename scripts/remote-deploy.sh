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
if [[ ! -f "${RELEASE_STAGING}/scripts/verify-runtime-dependencies.mjs" ]]; then
  echo "Release missing runtime dependency verification script." >&2
  exit 1
fi
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Runtime env file missing: ${ENV_FILE}" >&2
  exit 1
fi
NEEDS_INSTALL=true
if [[ -f "${APP_DIR}/pnpm-lock.yaml" ]] &&
   [[ -d "${APP_DIR}/node_modules" ]] &&
   cmp -s "${RELEASE_STAGING}/pnpm-lock.yaml" "${APP_DIR}/pnpm-lock.yaml"; then
  NEEDS_INSTALL=false
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

stop_service() {
  local unit="$1"
  systemctl stop --no-block "${unit}" || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if [[ "$(systemctl show "${unit}" -p ActiveState --value)" == "inactive" ]]; then
      return 0
    fi
    sleep 1
  done
  echo "[deploy] ${unit} exceeded graceful stop window; terminating remaining processes"
  systemctl kill --kill-who=all --signal=SIGKILL "${unit}" || true
  for _ in 1 2 3 4 5; do
    if [[ "$(systemctl show "${unit}" -p ActiveState --value)" == "inactive" ]]; then
      return 0
    fi
    sleep 1
  done
  echo "[deploy] ${unit} failed to stop" >&2
  systemctl status "${unit}" --no-pager -l >&2 || true
  return 1
}

echo "[deploy] stop app processes before swap"
stop_service service-platform
stop_service service-platform-worker
echo "[deploy] sync release -> ${APP_DIR}"
rsync -a --delete \
  --exclude ".git/" \
  --exclude ".env" \
  --exclude ".env.*" \
  --exclude "/node_modules/" \
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
if [[ "${NEEDS_INSTALL}" == true ]]; then
  echo "[deploy] install deps"
  sudo -u ${APP_USER} -H bash -lc "cd ${APP_DIR} && CI=true pnpm install --frozen-lockfile"
else
  echo "[deploy] lockfile unchanged; reuse existing node_modules"
fi
echo "[deploy] verify runtime dependencies"
sudo -u ${APP_USER} -H bash -lc "cd ${APP_DIR} && node scripts/verify-runtime-dependencies.mjs"
echo "[deploy] prisma generate + migrate"
sudo -u ${APP_USER} -H bash -lc "cd ${APP_DIR} && set -a && source ${ENV_FILE} && set +a && NODE_OPTIONS=--max-old-space-size=768 pnpm exec prisma generate && pnpm exec prisma migrate deploy"
echo "[deploy] restart services"
systemctl restart service-platform
systemctl restart service-platform-worker

wait_for_stable_service() {
  local unit="$1"
  local active sub pid
  for _ in 1 2 3 4 5 6 7 8; do
    active="$(systemctl show "${unit}" -p ActiveState --value)"
    sub="$(systemctl show "${unit}" -p SubState --value)"
    pid="$(systemctl show "${unit}" -p MainPID --value)"
    if [[ "${active}" == "active" && "${sub}" == "running" && "${pid}" != "0" ]]; then
      sleep 5
      active="$(systemctl show "${unit}" -p ActiveState --value)"
      sub="$(systemctl show "${unit}" -p SubState --value)"
      pid="$(systemctl show "${unit}" -p MainPID --value)"
      if [[ "${active}" == "active" && "${sub}" == "running" && "${pid}" != "0" ]]; then
        echo "[deploy] ${unit} stable: pid=${pid}"
        return 0
      fi
    fi
    sleep 2
  done
  echo "[deploy] ${unit} failed to reach stable running state" >&2
  systemctl status "${unit}" --no-pager -l >&2 || true
  journalctl -u "${unit}" -n 80 --no-pager >&2 || true
  return 1
}

wait_for_stable_service service-platform
wait_for_stable_service service-platform-worker
systemctl is-active --quiet x-ui
if ! cmp -s "${RELEASE_STAGING}/scripts/remote-deploy.sh" /opt/service-platform/deploy.sh; then
  echo "[deploy] update canonical deploy script"
  install -o root -g root -m 755 \
    "${RELEASE_STAGING}/scripts/remote-deploy.sh" \
    /opt/service-platform/deploy.sh.next
  mv /opt/service-platform/deploy.sh.next /opt/service-platform/deploy.sh
fi
echo "[deploy] done"
