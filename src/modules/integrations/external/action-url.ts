import type { Prisma } from "@/generated/prisma/client";

export function resolveUniversalActionUrl(
  lastParentOrigin: string | null | undefined,
  allowedOrigins: Prisma.JsonValue | null | undefined,
) {
  const origins = Array.isArray(allowedOrigins)
    ? allowedOrigins.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  if (lastParentOrigin && origins.includes(lastParentOrigin)) {
    return lastParentOrigin;
  }
  return origins.length === 1 ? origins[0] : null;
}
