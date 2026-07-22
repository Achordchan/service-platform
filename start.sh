#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="$ROOT_DIR/.data/local-runtime"
LOG_FILE="$RUNTIME_DIR/web.log"
HOST="${HOST:-127.0.0.1}"

cd "$ROOT_DIR"

fail() {
  printf '启动失败：%s\n' "$1" >&2
  exit 1
}

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
[[ "$HOST" == "127.0.0.1" || "$HOST" == "localhost" ]] || fail "HOST 只允许使用 127.0.0.1 或 localhost。"

command -v pnpm >/dev/null 2>&1 || fail "未找到 pnpm。"
command -v lsof >/dev/null 2>&1 || fail "未找到 lsof。"
command -v pg_isready >/dev/null 2>&1 || fail "未找到 PostgreSQL 客户端 pg_isready。"

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
if ! pg_isready -q -t 3 -h "$database_host" -p "$database_port" -d "$database_name"; then
  fail "PostgreSQL 未就绪（${database_host}:${database_port}/${database_name}）。请先启动本地 PostgreSQL 16。"
fi

printf 'Node.js：%s\n' "$(node -v)"
printf '数据库：%s:%s/%s\n' "$database_host" "$database_port" "$database_name"
printf '正在生成 Prisma Client 并应用已有迁移...\n'
pnpm db:generate
pnpm exec prisma migrate deploy

: > "$LOG_FILE"
LOCAL_APP_URL="http://localhost:$PORT"
export APP_URL="$LOCAL_APP_URL"
export BETTER_AUTH_URL="$LOCAL_APP_URL"

printf '\n本地服务将在前台运行： %s\n' "$LOCAL_APP_URL"
printf '按 Ctrl+C 或关闭当前终端即可停止。\n'
printf '运行日志：%s\n\n' "$LOG_FILE"

exec pnpm dev --hostname "$HOST" --port "$PORT" > >(tee -a "$LOG_FILE") 2>&1
