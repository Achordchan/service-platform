import "server-only";

import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import {
  TURNSTILE_GUARDED_PATHS,
  verifyTurnstileToken,
} from "@/lib/turnstile";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { emailOTP } from "better-auth/plugins";
import { prisma } from "@/lib/db";
import { enqueueMail } from "@/lib/jobs";
import { env } from "@/lib/runtime-env";
import { assertEmailOtpLoginAvailable } from "@/modules/platform-settings/email-otp-login-service";
import { hasActiveLoginAccount } from "@/modules/users/login-account-service";

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
    sendResetPassword: async ({ user, url }) => {
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
  plugins: [
    turnstileGuard(),
    emailOtpAccountGuard(),
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
