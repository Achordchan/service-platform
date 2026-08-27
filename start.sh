#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="$ROOT_DIR/.data/local-runtime"
LOG_FILE="$RUNTIME_DIR/web.log"
WORKER_LOG_FILE="$RUNTIME_DIR/worker.log"
# 默认对局域网开放，真机调试可直接 ./start.sh；只想回环用 HOST=127.0.0.1 ./start.sh
HOST="${HOST:-0.0.0.0}"
worker_pid=""
web_pid=""

cd "$ROOT_DIR"

fail() {
  printf '启动失败：%s\n' "$1" >&2
  exit 1
}

cleanup() {
  local exit_status=$?
  trap - EXIT
  if [[ -n "$web_pid" ]] && kill -0 "$web_pid" >/dev/null 2>&1; then
    kill "$web_pid" >/dev/null 2>&1 || true
    wait "$web_pid" 2>/dev/null || true
  fi
  if [[ -n "$worker_pid" ]] && kill -0 "$worker_pid" >/dev/null 2>&1; then
    kill "$worker_pid" >/dev/null 2>&1 || true
    wait "$worker_pid" 2>/dev/null || true
  fi
  exit "$exit_status"
}

trap cleanup EXIT
trap 'exit 130' INT TERM

usage() {
  printf '用法：./start.sh [端口号]\n'
  printf '示例：./start.sh 3001\n'
}

select_node_24() {
  local candidate
  local candidates=""

  if command -v node >/dev/null 2>&1; then
    candidates="$(dirname "$(command -v node)")"
  fi
  candidates="$candidates
/opt/homebrew/opt/node@24/bin
/usr/local/opt/node@24/bin
$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"

  while IFS= read -r candidate; do
    [[ -n "$candidate" && -x "$candidate/node" ]] || continue
    if [[ "$("$candidate/node" -p 'process.versions.node.split(".")[0]')" == "24" ]]; then
      export PATH="$candidate:$PATH"
      return 0
    fi
  done <<< "$candidates"

  fail "未找到 Node.js 24。请先安装 node@24。"
}

case "${1:-}" in
  -h | --help)
    usage
    exit 0
    ;;
esac

(( $# <= 1 )) || {
  usage >&2
  exit 1
}

PORT="${1:-${PORT:-3000}}"

select_node_24

[[ "$PORT" =~ ^[0-9]+$ ]] || fail "PORT 必须是数字。"
(( PORT >= 1 && PORT <= 65535 )) || fail "PORT 必须在 1 到 65535 之间。"
# 默认仅回环，安全；真机调试时用 HOST=0.0.0.0 ./start.sh 对局域网开放，手机方可连本机
[[ "$HOST" == "127.0.0.1" || "$HOST" == "localhost" || "$HOST" == "0.0.0.0" ]] \
  || fail "HOST 只允许使用 127.0.0.1、localhost 或 0.0.0.0（真机调试）。"

command -v pnpm >/dev/null 2>&1 || fail "未找到 pnpm。"
command -v lsof >/dev/null 2>&1 || fail "未找到 lsof。"

[[ -f .env ]] || fail "缺少 .env，请先根据 .env.example 创建本地配置。"
[[ -d node_modules ]] || fail "依赖尚未安装，请先执行 pnpm install。"

mkdir -p "$RUNTIME_DIR"
rm -f \
  "$RUNTIME_DIR/web.pid" \
  "$RUNTIME_DIR/web-listener.pid" \
  "$RUNTIME_DIR/web.host" \
  "$RUNTIME_DIR/web.port" \
  "$RUNTIME_DIR/web.mode"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "端口 $PORT 已被其他进程占用，请先关闭占用进程或执行 ./start.sh 其他端口。"
fi

database_info="$(node - <<'NODE'
const fs = require("node:fs");
const dotenv = require("dotenv");

try {
  const baseEnv = dotenv.parse(fs.readFileSync(".env"));
  const localEnv = fs.existsSync(".env.local")
    ? dotenv.parse(fs.readFileSync(".env.local"))
    : {};
  const env = { ...baseEnv, ...localEnv };
  const databaseKeys = ["DATABASE_URL", "DATABASE_MIGRATION_URL", "JOB_DATABASE_URL"];
  for (const key of databaseKeys) {
    if (baseEnv[key] && localEnv[key] && baseEnv[key] !== localEnv[key]) {
      throw new Error(`${key} 在 .env 与 .env.local 中不一致，请只保留一份本地数据库配置`);
    }
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }

  if (!env.DATABASE_URL) throw new Error("DATABASE_URL 未配置");
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  for (const key of databaseKeys) {
    for (const [source, value] of [
      [".env", baseEnv[key]],
      [".env.local", localEnv[key]],
      ["当前终端环境", process.env[key]],
    ]) {
      if (!value) continue;
      const url = new URL(value);
      if (!localHosts.has(url.hostname)) {
        throw new Error(`${source} 的 ${key} 指向非本机地址 ${url.hostname}，本地启动脚本已拒绝运行`);
      }
    }
  }

  const databaseUrl = new URL(env.DATABASE_URL);
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ""));
  process.stdout.write(
    [databaseUrl.hostname, databaseUrl.port || "5432", databaseName].join("\t"),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
NODE
)" || fail "无法读取本地数据库配置。"

IFS=$'\t' read -r database_host database_port database_name <<< "$database_info"

# 就绪探测优先用宿主 pg_isready；纯 Docker 环境可能没有本地 PostgreSQL 客户端，
# 此时退回容器内 pg_isready（经由本脚本管理的 compose 服务），最后以 TCP 连通兜底。
probe_db_ready() {
  local timeout="${1:-3}"
  if command -v pg_isready >/dev/null 2>&1; then
    pg_isready -q -t "$timeout" -h "$database_host" -p "$database_port" -d "$database_name"
    return
  fi
  if [[ "$database_host" == "localhost" || "$database_host" == "127.0.0.1" ]] \
    && command -v docker >/dev/null 2>&1 \
    && docker compose ps -q postgres 2>/dev/null | grep -q .; then
    docker compose exec -T postgres \
      pg_isready -q -t "$timeout" -U postgres -d "$database_name"
    return
  fi
  (echo > "/dev/tcp/$database_host/$database_port") 2>/dev/null
}

# 本地数据库跑在 Docker 容器里（docker-compose.yml，postgres:16 映射 5438）。
# 若容器未就绪则尝试拉起；遵循“只启动不停止、不接管 brew 等共享服务”的原则，
# docker 出问题也不硬失败，最终仍以下方就绪探测为准（保留 brew 等其它部署方式）。
if [[ -f docker-compose.yml ]] && command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    if ! probe_db_ready 1; then
      printf '本地数据库容器未就绪，正在通过 docker compose 拉起...\n'
      docker compose up -d --wait postgres \
        || printf '警告：docker compose 拉起失败，继续按现有数据库探测。\n' >&2
    fi
  else
    printf '提示：检测到 docker-compose.yml 但 Docker 未运行；本地库在容器中，请先启动 Docker Desktop。\n' >&2
  fi
fi

if ! probe_db_ready 3; then
  fail "PostgreSQL 未就绪（${database_host}:${database_port}/${database_name}）。请先启动本地数据库（Docker：docker compose up -d）。"
fi

printf 'Node.js：%s\n' "$(node -v)"
printf '数据库：%s:%s/%s\n' "$database_host" "$database_port" "$database_name"
printf '正在生成 Prisma Client 并应用已有迁移...\n'
pnpm db:generate
pnpm exec prisma migrate deploy

: > "$LOG_FILE"
: > "$WORKER_LOG_FILE"
LOCAL_APP_URL="http://localhost:$PORT"
export APP_URL="$LOCAL_APP_URL"
export BETTER_AUTH_URL="$LOCAL_APP_URL"
export MAIL_INLINE_WORKER=false

printf '\n本地服务将在前台运行： %s\n' "$LOCAL_APP_URL"
if [[ "$HOST" == "0.0.0.0" ]]; then
  lan_ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  if [[ -n "$lan_ip" ]]; then
    printf '真机调试：手机（同一 WiFi）请求 http://%s:%s ，把小程序 DEV_API_BASE_URL 指到这里。\n' "$lan_ip" "$PORT"
  else
    printf '真机调试：已对局域网开放，但未探测到局域网 IP，请手动查看本机 IP。\n'
  fi
fi
printf '按 Ctrl+C 或关闭当前终端即可停止。\n'
printf 'Web 日志：%s\n' "$LOG_FILE"
printf '后台任务日志：%s\n\n' "$WORKER_LOG_FILE"

pnpm worker > >(tee -a "$WORKER_LOG_FILE") 2>&1 &
worker_pid=$!
if ! kill -0 "$worker_pid" >/dev/null 2>&1; then
  wait "$worker_pid" || true
  fail "后台任务 Worker 启动失败，请查看 $WORKER_LOG_FILE。"
fi

pnpm dev --hostname "$HOST" --port "$PORT" > >(tee -a "$LOG_FILE") 2>&1 &
web_pid=$!

while true; do
  if ! kill -0 "$worker_pid" >/dev/null 2>&1; then
    set +e
    wait "$worker_pid"
    worker_status=$?
    set -e
    if (( worker_status == 0 )); then
      worker_status=1
    fi
    printf '后台任务 Worker 已退出，正在停止 Web。请查看 %s。\n' "$WORKER_LOG_FILE" >&2
    exit "$worker_status"
  fi
  if ! kill -0 "$web_pid" >/dev/null 2>&1; then
    set +e
    wait "$web_pid"
    web_status=$?
    set -e
    exit "$web_status"
  fi
  sleep 1
done
