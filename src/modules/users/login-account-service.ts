import "server-only";

import { withSystemDb } from "@/lib/system-db";

export async function hasActiveLoginAccount(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return false;

  const user = await withSystemDb((tx) =>
    tx.user.findUnique({
      where: { email: normalizedEmail },
      select: { deletedAt: true, emailVerified: true },
    }),
  );

  return Boolean(user && !user.deletedAt && user.emailVerified);
}
