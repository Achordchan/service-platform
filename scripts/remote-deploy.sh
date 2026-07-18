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

ensure_sub2api_nginx_log_hardening() {
  local source_dir="$1"
  if [[ ! -d /etc/nginx ]]; then
    return 0
  fi
  if [[ ! -f "${source_dir}/scripts/nginx-sub2api-embed-log-format.conf" || ! -f "${source_dir}/scripts/nginx-sub2api-embed-location.conf" ]]; then
    echo "[deploy] ERROR: release missing Sub2API Nginx log hardening snippets" >&2
    return 1
  fi
  echo "[deploy] ensure Sub2API embed Nginx log hardening is live (before service stop)"
  install -d -m 755 /etc/nginx/snippets
  install -m 644 "${source_dir}/scripts/nginx-sub2api-embed-log-format.conf" /etc/nginx/snippets/sub2api-embed-log-format.conf
  install -m 644 "${source_dir}/scripts/nginx-sub2api-embed-location.conf" /etc/nginx/snippets/sub2api-embed-location.conf

  local rendered_config
  if ! rendered_config="$(nginx -T 2>&1)"; then
    echo "[deploy] ERROR: unable to render active Nginx configuration" >&2
    return 1
  fi
  local LIVE_FORMAT_MATCH=0
  local LIVE_LOCATION_MATCH=0
  local LIVE_NO_ARGS_MATCH=0
  if [[ "${rendered_config}" == *'log_format main_no_args'* ]]; then
    LIVE_FORMAT_MATCH=1
  fi
  if [[ "${rendered_config}" == *'location ^~ /embed/sub2api/'* ]]; then
    LIVE_LOCATION_MATCH=1
  fi
  if [[ "${rendered_config}" == *'access_log /var/log/nginx/sub2api_embed.access.log main_no_args;'* ]]; then
    LIVE_NO_ARGS_MATCH=1
  fi
  if [[ "${LIVE_FORMAT_MATCH}" != "1" || "${LIVE_LOCATION_MATCH}" != "1" || "${LIVE_NO_ARGS_MATCH}" != "1" ]]; then
    echo "[deploy] ERROR: Sub2API embed Nginx JWT log protection is not live." >&2
    echo "[deploy] include snippets/sub2api-embed-log-format.conf in http {}, and snippets/sub2api-embed-location.conf in the HTTPS server {}." >&2
    echo "[deploy] the /embed/sub2api/ location must use access_log ... main_no_args." >&2
    if [[ "${LIVE_FORMAT_MATCH}" != "1" ]]; then
      echo "[deploy] missing live include for log_format snippet." >&2
    fi
    if [[ "${LIVE_LOCATION_MATCH}" != "1" ]]; then
      echo "[deploy] missing live include/location for /embed/sub2api/." >&2
    fi
    if [[ "${LIVE_NO_ARGS_MATCH}" != "1" ]]; then
      echo "[deploy] missing verified main_no_args access_log for /embed/sub2api/." >&2
    fi
    return 1
  fi
  if ! command -v nginx >/dev/null 2>&1; then
    echo "[deploy] ERROR: nginx binary not found after installing Sub2API snippets" >&2
    return 1
  fi
  if ! nginx -t; then
    echo "[deploy] ERROR: nginx -t failed after Sub2API embed log hardening" >&2
    return 1
  fi
  systemctl reload nginx
  echo "[deploy] nginx config valid; reload requested"
}

ensure_universal_request_body_limits() {
  local source_dir="$1"
  if [[ ! -d /etc/nginx ]]; then
    return 0
  fi
  local snippet="${source_dir}/scripts/nginx-universal-request-body-limits.conf"
  if [[ ! -f "${snippet}" ]]; then
    echo "[deploy] ERROR: release missing Universal request body limit snippet" >&2
    return 1
  fi
  install -d -m 755 /etc/nginx/snippets
  install -m 644 "${snippet}" /etc/nginx/snippets/universal-request-body-limits.conf
  local rendered_config
  if ! rendered_config="$(nginx -T 2>&1)"; then
    echo "[deploy] ERROR: unable to render active Nginx configuration" >&2
    return 1
  fi
  if [[ "${rendered_config}" != *'location = /api/v1/integrations/universal/launch-tickets'* ]]; then
    echo "[deploy] ERROR: launch-ticket endpoint is missing client_max_body_size 64k" >&2
    return 1
  fi
  if [[ "${rendered_config}" != *'location = /api/v1/embed/universal/exchange'* ]]; then
    echo "[deploy] ERROR: universal exchange endpoint is missing client_max_body_size 64k" >&2
    return 1
  fi
  local body_limit_count
  body_limit_count="$(grep -c 'client_max_body_size 64k;' <<<"${rendered_config}" || true)"
  if [[ "${body_limit_count}" -lt 2 ]]; then
    echo "[deploy] ERROR: both Universal public endpoints must enforce client_max_body_size 64k" >&2
    return 1
  fi
  if ! nginx -t; then
    echo "[deploy] ERROR: nginx -t failed after Universal request limit verification" >&2
    return 1
  fi
  systemctl reload nginx
  echo "[deploy] Universal public request body limits verified"
}

# Fail closed on JWT logging before we ever take the app offline.
ensure_sub2api_nginx_log_hardening "${RELEASE_STAGING}"
ensure_universal_request_body_limits "${RELEASE_STAGING}"

DEPLOY_SERVICES_STOPPED=0
restore_services_if_needed() {
  local code=$?
  if [[ "${DEPLOY_SERVICES_STOPPED}" == "1" ]]; then
    echo "[deploy] restoring services after deploy failure (exit=${code})" >&2
    systemctl restart service-platform || true
    systemctl restart service-platform-worker || true
  fi
  return "${code}"
}
trap restore_services_if_needed EXIT

echo "[deploy] stop app processes before swap"
# Arm restore before the first stop. If either unit fails mid-stop, EXIT trap
# must still bring both services back up.
DEPLOY_SERVICES_STOPPED=1
stop_service service-platform
stop_service service-platform-worker
if [[ "${NEEDS_INSTALL}" == true && -d "${APP_DIR}/node_modules" ]]; then
  echo "[deploy] dependency manifest changed; clear node_modules before install"
  find "${APP_DIR}/node_modules" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
fi
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

# Nginx JWT protection was already verified before stopping services.
echo "[deploy] restart services"
systemctl restart service-platform
systemctl restart service-platform-worker
DEPLOY_SERVICES_STOPPED=0

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
