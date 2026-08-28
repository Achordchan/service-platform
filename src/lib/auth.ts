import "server-only";

import { betterAuth, type BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import {
  TURNSTILE_GUARDED_PATHS,
  isInternalTurnstileBypass,
  verifyTurnstileToken,
} from "@/lib/turnstile";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { emailOTP } from "better-auth/plugins";
import { prisma } from "@/lib/db";
import { enqueueMail } from "@/lib/jobs";
import { clientIpFromHeaders } from "@/lib/request-network";
import { env } from "@/lib/runtime-env";
import { recordAuthEvent } from "@/modules/audit/auth-audit";
import { assertEmailOtpLoginAvailable } from "@/modules/platform-settings/email-otp-login-service";
import { hasActiveLoginAccount } from "@/modules/users/login-account-service";

// 凭密码 / 邮箱验证码登录的端点路径；登录失败审计据此匹配。
const SIGN_IN_PATHS = new Set(["/sign-in/email", "/sign-in/email-otp"]);

function hookIp(headers: Headers | undefined): string | null {
  return headers ? clientIpFromHeaders(headers) : null;
}

function hookUserAgent(headers: Headers | undefined): string | null {
  return headers?.get("user-agent") ?? null;
}

// 人机验证守卫：密码/验证码登录提交前校验 Cloudflare Turnstile token
//（客户端通过 authClient 额外字段 cfTurnstileToken 传入；secret 未配置时跳过）。
function turnstileGuard(): BetterAuthPlugin {
  return {
    id: "turnstile-guard",
    hooks: {
      before: [
        {
          matcher: (context) =>
            context.method === "POST" &&
            typeof context.path === "string" &&
            TURNSTILE_GUARDED_PATHS.has(context.path),
          handler: createAuthMiddleware(async (context) => {
            // 服务端内部可信调用（如小程序绑定复用登录校验）携带进程内令牌，跳过人机验证
            if (isInternalTurnstileBypass(context.headers)) return;
            const body = context.body as { cfTurnstileToken?: unknown } | null;
            const forwardedFor = context.headers?.get("x-forwarded-for");
            const remoteIp = forwardedFor?.split(",")[0]?.trim() ?? null;
            const result = await verifyTurnstileToken(
              body?.cfTurnstileToken,
              remoteIp,
            );
            if (!result.ok) {
              throw new APIError("FORBIDDEN", {
                code: "TURNSTILE_FAILED",
                message: "人机验证未通过，请刷新后重试",
              });
            }
          }),
        },
      ],
    },
  };
}

function trustedOrigins() {
  const origins = new Set([env.APP_URL, env.BETTER_AUTH_URL]);
  if (process.env.NODE_ENV === "production") return [...origins];

  for (const value of [...origins]) {
    const url = new URL(value);
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      continue;
    }
    const port = url.port ? `:${url.port}` : "";
    origins.add(`${url.protocol}//localhost${port}`);
    origins.add(`${url.protocol}//127.0.0.1${port}`);
  }
  return [...origins];
}

function emailOtpAccountGuard(): BetterAuthPlugin {
  return {
    id: "email-otp-account-guard",
    hooks: {
      before: [
        {
          matcher: (context) =>
            context.path === "/email-otp/send-verification-otp",
          handler: createAuthMiddleware(async (context) => {
            const body = context.body as {
              email?: unknown;
              type?: unknown;
            };
            if (body.type !== "sign-in" || typeof body.email !== "string") {
              return;
            }
            if (!(await hasActiveLoginAccount(body.email))) {
              throw new APIError("BAD_REQUEST", {
                code: "EMAIL_NOT_FOUND",
                message: "邮箱不存在",
              });
            }
          }),
        },
      ],
    },
  };
}

// 认证审计：登出（会话删除前取用户）与登录失败（端点抛 APIError 后 after 钩子仍执行）。
// 登录成功走顶层 databaseHooks.session.create；这里的钩子内自吞异常，绝不阻断认证。
function authAuditPlugin(): BetterAuthPlugin {
  return {
    id: "auth-audit",
    hooks: {
      before: [
        {
          matcher: (context) => context.path === "/sign-out",
          handler: createAuthMiddleware(async (context) => {
            try {
              const current = await getSessionFromCtx(context);
              const userId = current?.user?.id;
              if (userId) {
                await recordAuthEvent({
                  action: "USER_LOGOUT",
                  userId,
                  ipAddress: hookIp(context.headers),
                  userAgent: hookUserAgent(context.headers),
                });
              }
            } catch {
              // 取会话失败绝不阻断登出
            }
          }),
        },
      ],
      after: [
        {
          // context.returned 在端点抛 APIError 时即该错误（见 to-auth-endpoints）。
          matcher: (context) =>
            typeof context.path === "string" &&
            SIGN_IN_PATHS.has(context.path),
          handler: createAuthMiddleware(async (context) => {
            const returned = context.context.returned;
            if (!(returned instanceof APIError)) return;
            const body = context.body as { email?: unknown } | null;
            const email =
              typeof body?.email === "string" ? body.email : null;
            const code = (returned.body as { code?: unknown } | undefined)
              ?.code;
            await recordAuthEvent({
              action: "USER_LOGIN_FAILED",
              email,
              result: "FAILURE",
              ipAddress: hookIp(context.headers),
              userAgent: hookUserAgent(context.headers),
              metadata: {
                path: context.path,
                code: typeof code === "string" ? code : undefined,
              },
            });
          }),
        },
      ],
    },
  };
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 10,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }, request) => {
      await enqueueMail({
        to: user.email,
        templateKey: "PASSWORD_RESET",
        variables: {
          recipientName: user.name || user.email,
          recipientEmail: user.email,
          expiresIn: "1 小时",
        },
        actionUrl: url,
      });
      await recordAuthEvent({
        action: "USER_PASSWORD_RESET_REQUESTED",
        userId: user.id,
        ipAddress: hookIp(request?.headers),
        userAgent: hookUserAgent(request?.headers),
      });
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 20,
  },
  databaseHooks: {
    session: {
      create: {
        // 会话建成即登录成功——覆盖密码与邮箱验证码两种方式；better-auth 已在
        // session 上填好来源 IP/UA。小程序走独立会话，不触发此钩子。
        after: async (session, context) => {
          await recordAuthEvent({
            action: "USER_LOGIN",
            userId: session.userId,
            ipAddress: session.ipAddress ?? null,
            userAgent: session.userAgent ?? null,
            metadata: context?.path ? { path: context.path } : undefined,
          });
        },
      },
    },
  },
  plugins: [
    turnstileGuard(),
    emailOtpAccountGuard(),
    authAuditPlugin(),
    emailOTP({
      disableSignUp: true,
      otpLength: 6,
      expiresIn: 60 * 5,
      allowedAttempts: 3,
      storeOTP: "hashed",
      rateLimit: { window: 60, max: 3 },
      sendVerificationOTP: async ({ email, otp, type }) => {
        if (type !== "sign-in") return;
        await assertEmailOtpLoginAvailable();
        await enqueueMail({
          to: email,
          templateKey: "LOGIN_EMAIL_OTP",
          variables: {
            recipientEmail: email,
            otp,
            expiresIn: "5 分钟",
          },
          sourceType: "LOGIN_EMAIL_OTP",
          sourceId: email.toLowerCase(),
        });
      },
    }),
  ],
  trustedOrigins: trustedOrigins(),
});
