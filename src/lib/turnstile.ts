import "server-only";

import { env } from "@/lib/runtime-env";

// Cloudflare Turnstile 服务端校验。
// secret 未配置 → 跳过（本地最小配置可登录）；
// 使用官方测试密钥（1x000…AA）→ 与真实链路一致但永远通过，便于上线前联调。

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export const TURNSTILE_GUARDED_PATHS = new Set([
  "/sign-in/email",
  "/sign-in/email-otp",
  "/email-otp/send-verification-otp",
]);

export function isTurnstileConfigured(): boolean {
  return Boolean(env.CF_TURNSTILE_SECRET_KEY);
}

// hostname 白名单：siteverify 响应的签发站点必须是我们自己的域名，
// 防止他站签发的有效 token 被搬运到我们的登录接口重放（canonical 要求）
function approvedHostnames(): Set<string> {
  const names = new Set<string>();
  for (const value of [env.APP_URL, env.BETTER_AUTH_URL]) {
    try {
      names.add(new URL(value).hostname);
    } catch {
      // schema 已保证可解析；防御性兜底
    }
  }
  if (process.env.NODE_ENV !== "production") {
    names.add("localhost");
    names.add("127.0.0.1");
  }
  return names;
}

/** 校验客户端提交的 turnstile token；未配置 secret 时视为通过（跳过模式） */
export async function verifyTurnstileToken(
  token: unknown,
  remoteIp?: string | null,
): Promise<{ ok: boolean; skipped: boolean }> {
  // 测试环境（vitest NODE_ENV=test）统一跳过：集成测试直调 auth.handler 无 token，
  // 守卫语义由 tests/lib/turnstile.test.ts 在 development 环境下覆盖
  if (process.env.NODE_ENV === "test") return { ok: true, skipped: true };
  const secret = env.CF_TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };
  if (typeof token !== "string" || token.length < 10) {
    return { ok: false, skipped: false };
  }
  try {
    const form = new URLSearchParams({ secret, response: token });
    if (remoteIp) form.set("remoteip", remoteIp);
    const response = await fetch(VERIFY_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(6000),
    });
    const payload = (await response.json().catch(() => null)) as {
      success?: boolean;
      hostname?: string;
    } | null;
    if (!payload?.success || typeof payload.hostname !== "string") {
      return { ok: false, skipped: false };
    }
    return {
      ok: approvedHostnames().has(payload.hostname),
      skipped: false,
    };
  } catch {
    // 校验服务不可达：fail-closed，防止验证通道被绕过
    return { ok: false, skipped: false };
  }
}

/** 守卫判定（纯函数，便于单测）：路径是否需要校验 + token 缺失错误 */
export function turnstileGuardError(path: string, hasBody: boolean): boolean {
  return hasBody && TURNSTILE_GUARDED_PATHS.has(path);
}
