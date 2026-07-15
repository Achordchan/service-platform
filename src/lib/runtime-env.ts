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
  };
}

let cachedEnv: RuntimeEnv | null = null;

function getEnv(): RuntimeEnv {
  if (!cachedEnv) {
    cachedEnv = envSchema.parse(readEnvSource());
  }
  return cachedEnv;
}

export const env: RuntimeEnv = new Proxy({} as RuntimeEnv, {
  get(_target, prop, receiver) {
    return Reflect.get(getEnv(), prop, receiver);
  },
});
