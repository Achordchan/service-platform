#!/usr/bin/env bash
# Local emergency deploy to VPS (requires deploy SSH key).
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${VPS_HOST:-179.255.156.73}"
USER_NAME="${VPS_USER:-deploy}"
PORT="${VPS_PORT:-22}"
KEY="${VPS_SSH_KEY_PATH:-/tmp/sp-deploy-key/id_ed25519}"
STAMP="$(date -u +%Y%m%d%H%M%S)-local"
REMOTE_DIR="/home/${USER_NAME}/releases/${STAMP}"

ssh -i "${KEY}" -p "${PORT}" -o IdentitiesOnly=yes "${USER_NAME}@${HOST}" "mkdir -p '${REMOTE_DIR}'"
rsync -az --delete \
  -e "ssh -i ${KEY} -p ${PORT} -o IdentitiesOnly=yes" \
  --exclude '.git/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'node_modules/' \
  --exclude '.next/' \
  --exclude '.data/' \
  --exclude 'public/uploads/' \
  --exclude 'test-results/' \
  --exclude 'playwright-report/' \
  --exclude 'coverage/' \
  --exclude '.DS_Store' \
  "${ROOT_DIR}/" "${USER_NAME}@${HOST}:${REMOTE_DIR}/"
ssh -i "${KEY}" -p "${PORT}" -o IdentitiesOnly=yes "${USER_NAME}@${HOST}" "sudo /opt/service-platform/deploy.sh '${REMOTE_DIR}'"
