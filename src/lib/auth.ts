import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@/lib/db";
import { enqueueMail } from "@/lib/jobs";
import { env } from "@/lib/runtime-env";

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
  trustedOrigins: trustedOrigins(),
});
