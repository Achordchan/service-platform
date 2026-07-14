import "server-only";

import type { PlatformRole } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { assertPlatformAdmin } from "@/modules/authorization/policies";

export function listUsers(
  actor: Actor,
  options: {
    role?: PlatformRole;
    query?: string;
    limit?: number;
  } = {},
) {
  assertPlatformAdmin(actor);
  const query = options.query?.trim();
  return withActorDb(actor, (tx) =>
    tx.user.findMany({
      where: {
        platformRole: options.role,
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { email: { contains: query, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        platformRole: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ platformRole: "asc" }, { createdAt: "desc" }],
      take: Math.min(Math.max(options.limit ?? 100, 1), 200),
    }),
  );
}
