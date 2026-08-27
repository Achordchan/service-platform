import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_MIGRATION_URL: z.string().min(1).optional(),
  JOB_DATABASE_URL: z.string().min(1),
  MAIL_INLINE_WORKER: z
    .enum(["true", "false"])
    .optional()
    .transform((value) =>
      value === undefined ? undefined : value === "true",
    ),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  APP_URL: z.url(),
  UPLOAD_DIR: z.string().default(".data/uploads"),
  // LibreOffice 可执行文件路径（Office 附件转 PDF 预览件）；默认 PATH 中的 soffice
  SOFFICE_PATH: z.string().min(1).optional(),
  PLATFORM_SECRET_ENCRYPTION_KEY: z
    .string()
    .refine((value) => {
      try {
        return Buffer.from(value, "base64").length === 32;
      } catch {
        return false;
      }
    }, "PLATFORM_SECRET_ENCRYPTION_KEY 必须是 32 字节 Base64 密钥")
    .optional(),
  // SMTP env is only a bootstrap fallback. Prefer admin platform settings.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  // 微信小程序：real = 正式微信接口；dev = 本地开发/测试用假 Provider。
  // dev Provider 在生产环境被 wechat-provider 硬性拒绝。
  MINIAPP_WECHAT_PROVIDER: z.enum(["real", "dev"]).default("real"),
  WECHAT_MINIAPP_APPID: z.string().min(1).optional(),
  WECHAT_MINIAPP_APP_SECRET: z.string().min(1).optional(),
  MINIAPP_DEV_OPENID: z.string().min(1).optional(),
  // 订阅消息模板 ID：正式模板审批通过后配置；缺失时投递在 worker 侧 SKIPPED
  WECHAT_TEMPLATE_REQUEST_REPLY_ID: z.string().min(1).optional(),
  WECHAT_TEMPLATE_REQUEST_STATUS_ID: z.string().min(1).optional(),
  WECHAT_TEMPLATE_PROJECT_UPDATE_ID: z.string().min(1).optional(),
  // Cloudflare Turnstile 人机验证。默认为 CF 官方测试密钥（永远通过），
  // 上线前替换为正式密钥；两者都不配则完全跳过校验（本地最小配置），
  // 只配其一会导致前端不渲染验证件而服务端强制拒绝 → 全站无法登录，启动即报错。
  CF_TURNSTILE_SITE_KEY: z.string().min(1).optional(),
  CF_TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
});

const pairedEnvSchema = envSchema.superRefine((env, ctx) => {
  const pairs: Array<[keyof typeof env, keyof typeof env, string]> = [
    ["CF_TURNSTILE_SITE_KEY", "CF_TURNSTILE_SECRET_KEY", "Turnstile"],
    [
      "WECHAT_MINIAPP_APPID",
      "WECHAT_MINIAPP_APP_SECRET",
      "微信小程序凭据",
    ],
  ];
  for (const [first, second, label] of pairs) {
    if (Boolean(env[first]) !== Boolean(env[second])) {
      ctx.addIssue({
        code: "custom",
        path: [env[first] ? second : first],
        message: `${label} ${String(first)} 与 ${String(second)} 必须同时配置或同时留空`,
      });
    }
  }
});

export type RuntimeEnv = z.infer<typeof envSchema>;

function isBuildPhase() {
  return process.env.NEXT_PHASE === "phase-production-build";
}

function readEnvSource() {
  // Vercel 构建阶段允许先用占位值通过编译；真正运行时仍会按 schema 严格校验。
  if (isBuildPhase()) {
    return {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://build:build@127.0.0.1:5432/build?schema=public",
      DATABASE_MIGRATION_URL: process.env.DATABASE_MIGRATION_URL,
      JOB_DATABASE_URL:
        process.env.JOB_DATABASE_URL ??
        process.env.DATABASE_URL ??
        "postgresql://build:build@127.0.0.1:5432/build",
      MAIL_INLINE_WORKER: process.env.MAIL_INLINE_WORKER,
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ??
        "build-only-secret-please-override-32chars",
      BETTER_AUTH_URL:
        process.env.BETTER_AUTH_URL ??
        process.env.APP_URL ??
        "http://localhost:3000",
      APP_URL: process.env.APP_URL ?? "http://localhost:3000",
      UPLOAD_DIR: process.env.UPLOAD_DIR,
      PLATFORM_SECRET_ENCRYPTION_KEY:
        process.env.PLATFORM_SECRET_ENCRYPTION_KEY,
      SMTP_HOST: process.env.SMTP_HOST,
      SMTP_PORT: process.env.SMTP_PORT,
      SMTP_USER: process.env.SMTP_USER,
      SMTP_PASSWORD: process.env.SMTP_PASSWORD,
      SMTP_FROM: process.env.SMTP_FROM,
      SMTP_SECURE: process.env.SMTP_SECURE,
      MINIAPP_WECHAT_PROVIDER: process.env.MINIAPP_WECHAT_PROVIDER as
        | "real"
        | "dev"
        | undefined,
      WECHAT_MINIAPP_APPID: process.env.WECHAT_MINIAPP_APPID,
      WECHAT_MINIAPP_APP_SECRET: process.env.WECHAT_MINIAPP_APP_SECRET,
      MINIAPP_DEV_OPENID: process.env.MINIAPP_DEV_OPENID,
      WECHAT_TEMPLATE_REQUEST_REPLY_ID: process.env.WECHAT_TEMPLATE_REQUEST_REPLY_ID,
      WECHAT_TEMPLATE_REQUEST_STATUS_ID: process.env.WECHAT_TEMPLATE_REQUEST_STATUS_ID,
      WECHAT_TEMPLATE_PROJECT_UPDATE_ID: process.env.WECHAT_TEMPLATE_PROJECT_UPDATE_ID,
      CF_TURNSTILE_SITE_KEY: process.env.CF_TURNSTILE_SITE_KEY,
      CF_TURNSTILE_SECRET_KEY: process.env.CF_TURNSTILE_SECRET_KEY,
    };
  }

  return {
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_MIGRATION_URL: process.env.DATABASE_MIGRATION_URL,
    JOB_DATABASE_URL: process.env.JOB_DATABASE_URL,
    MAIL_INLINE_WORKER: process.env.MAIL_INLINE_WORKER,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    APP_URL: process.env.APP_URL,
    UPLOAD_DIR: process.env.UPLOAD_DIR,
    PLATFORM_SECRET_ENCRYPTION_KEY:
      process.env.PLATFORM_SECRET_ENCRYPTION_KEY,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD,
    SMTP_FROM: process.env.SMTP_FROM,
    SMTP_SECURE: process.env.SMTP_SECURE,
    MINIAPP_WECHAT_PROVIDER: process.env.MINIAPP_WECHAT_PROVIDER as
      | "real"
      | "dev"
      | undefined,
    WECHAT_MINIAPP_APPID: process.env.WECHAT_MINIAPP_APPID,
    WECHAT_MINIAPP_APP_SECRET: process.env.WECHAT_MINIAPP_APP_SECRET,
    MINIAPP_DEV_OPENID: process.env.MINIAPP_DEV_OPENID,
    WECHAT_TEMPLATE_REQUEST_REPLY_ID: process.env.WECHAT_TEMPLATE_REQUEST_REPLY_ID,
    WECHAT_TEMPLATE_REQUEST_STATUS_ID: process.env.WECHAT_TEMPLATE_REQUEST_STATUS_ID,
    WECHAT_TEMPLATE_PROJECT_UPDATE_ID: process.env.WECHAT_TEMPLATE_PROJECT_UPDATE_ID,
    CF_TURNSTILE_SITE_KEY: process.env.CF_TURNSTILE_SITE_KEY,
    CF_TURNSTILE_SECRET_KEY: process.env.CF_TURNSTILE_SECRET_KEY,
  };
}

let cachedEnv: RuntimeEnv | null = null;

function getEnv(): RuntimeEnv {
  if (!cachedEnv) {
    cachedEnv = pairedEnvSchema.parse(readEnvSource());
  }
  return cachedEnv;
}

export const env: RuntimeEnv = new Proxy({} as RuntimeEnv, {
  get(_target, prop, receiver) {
    return Reflect.get(getEnv(), prop, receiver);
  },
});
