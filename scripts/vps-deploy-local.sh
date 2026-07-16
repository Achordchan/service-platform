#!/usr/bin/env bash
# Local emergency deploy: build on this machine, then sync artifacts to VPS.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${VPS_HOST:-179.255.156.73}"
USER_NAME="${VPS_USER:-deploy}"
PORT="${VPS_PORT:-22}"
KEY="${VPS_SSH_KEY_PATH:-$ROOT_DIR/.data/deploy-keys/vps_deploy_ed25519}"
STAMP="$(date -u +%Y%m%d%H%M%S)-local"
REMOTE_DIR="/home/${USER_NAME}/releases/${STAMP}"

cd "${ROOT_DIR}"
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
rm -rf .next/dev .next/cache
DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build?schema=public \
JOB_DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
BETTER_AUTH_SECRET=local-emergency-build-secret-at-least-32-chars \
BETTER_AUTH_URL=https://support.achord.cn \
APP_URL=https://support.achord.cn \
NEXT_PUBLIC_APP_URL=https://support.achord.cn \
NODE_ENV=production \
pnpm build
pnpm verify:runtime-deps

ssh -i "${KEY}" -p "${PORT}" -o IdentitiesOnly=yes "${USER_NAME}@${HOST}" "mkdir -p '${REMOTE_DIR}'"
rsync -az --delete \
  -e "ssh -i ${KEY} -p ${PORT} -o IdentitiesOnly=yes" \
  --exclude '.git/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '/node_modules/' \
  --exclude '.next/dev/' \
  --exclude '.next/cache/' \
  --exclude '.data/' \
  --exclude 'public/uploads/' \
  --exclude 'test-results/' \
  --exclude 'playwright-report/' \
  --exclude 'coverage/' \
  --exclude '.DS_Store' \
  --exclude 'tsconfig.tsbuildinfo' \
  "${ROOT_DIR}/" "${USER_NAME}@${HOST}:${REMOTE_DIR}/"
ssh -i "${KEY}" -p "${PORT}" -o IdentitiesOnly=yes "${USER_NAME}@${HOST}" "sudo /opt/service-platform/deploy.sh '${REMOTE_DIR}'"
