import "server-only";

import { z } from "zod";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { THEME_PREFERENCES } from "@/theme/theme-mode";

export const appearancePreferenceSchema = z.object({
  themePreference: z.enum(THEME_PREFERENCES),
});

export function getAppearancePreference(actor: Actor) {
  return withActorDb(actor, (tx) =>
    tx.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: { themePreference: true },
    }),
  );
}

export function updateAppearancePreference(
  actor: Actor,
  input: z.infer<typeof appearancePreferenceSchema>,
) {
  return withActorDb(actor, async (tx) => {
    const updated = await tx.user.update({
      where: { id: actor.id },
      data: input,
      select: { themePreference: true },
    });
    await writeAuditLog(tx, actor, {
      action: "APPEARANCE_PREFERENCE_UPDATED",
      resourceType: "User",
      resourceId: actor.id,
      metadata: input,
    });
    return updated;
  });
}
