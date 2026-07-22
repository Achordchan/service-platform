import "server-only";

import { z } from "zod";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { writeAuditLog } from "@/modules/audit/audit-service";

export const notificationPreferenceSchema = z
  .object({
    soundNotificationsEnabled: z.boolean().optional(),
    requestEmailNotificationsEnabled: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.soundNotificationsEnabled !== undefined ||
      value.requestEmailNotificationsEnabled !== undefined,
    "请至少修改一项通知设置",
  );

export function getNotificationPreferences(actor: Actor) {
  return withActorDb(actor, (tx) =>
    tx.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: {
        soundNotificationsEnabled: true,
        requestEmailNotificationsEnabled: true,
      },
    }),
  );
}

export function updateNotificationPreferences(
  actor: Actor,
  input: z.infer<typeof notificationPreferenceSchema>,
) {
  return withActorDb(actor, async (tx) => {
    const updated = await tx.user.update({
      where: { id: actor.id },
      data: input,
      select: {
        soundNotificationsEnabled: true,
        requestEmailNotificationsEnabled: true,
      },
    });
    if (input.requestEmailNotificationsEnabled === false) {
      await tx.$executeRaw`
        SELECT app_cancel_notification_mail_for_current_user(
          '用户已关闭未读邮件提醒'
        )
      `;
    }
    await writeAuditLog(tx, actor, {
      action: "NOTIFICATION_PREFERENCES_UPDATED",
      resourceType: "User",
      resourceId: actor.id,
      metadata: input,
    });
    return updated;
  });
}
