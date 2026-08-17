import "server-only";

import { z } from "zod";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  NOTIFICATION_DELIVERY_RULES,
  notificationDeliveryRuleKeySchema,
} from "@/modules/notifications/notification-delivery-rules";

// 客户视角隐藏仅面向员工的规则（如内容风控告警、接手通知）
const ruleKeysForAudience = (isStaff: boolean) =>
  NOTIFICATION_DELIVERY_RULES.filter(
    (rule) => rule.emailSupported && (isStaff || !("customerHidden" in rule)),
  ).map((rule) => rule.key);

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

export const perTypePreferenceSchema = z.object({
  ruleKey: notificationDeliveryRuleKeySchema,
  emailEnabled: z.boolean(),
});

export type PerTypePreference = { ruleKey: string; emailEnabled: boolean };

export function getNotificationPreferences(actor: Actor) {
  return withActorDb(actor, async (tx) => {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: {
        soundNotificationsEnabled: true,
        requestEmailNotificationsEnabled: true,
      },
    });
    const perType = await tx.userNotificationPreference.findMany({
      where: { userId: actor.id },
      select: { ruleKey: true, emailEnabled: true },
    });
    const perTypeMap: Record<string, boolean> = {};
    for (const pref of perType) {
      perTypeMap[pref.ruleKey] = pref.emailEnabled;
    }
    return {
      ...user,
      perType: ruleKeysForAudience(actor.isStaff).map((key) => ({
        ruleKey: key,
        emailEnabled: perTypeMap[key] ?? true,
      })),
    };
  });
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
          '用户已关闭业务通知邮件'
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

export function updatePerTypePreference(
  actor: Actor,
  input: PerTypePreference,
) {
  return withActorDb(actor, async (tx) => {
    const result = await tx.userNotificationPreference.upsert({
      where: {
        userId_ruleKey: { userId: actor.id, ruleKey: input.ruleKey },
      },
      create: {
        userId: actor.id,
        ruleKey: input.ruleKey,
        emailEnabled: input.emailEnabled,
      },
      update: { emailEnabled: input.emailEnabled },
      select: { ruleKey: true, emailEnabled: true },
    });
    await writeAuditLog(tx, actor, {
      action: "NOTIFICATION_PREFERENCE_TYPE_UPDATED",
      resourceType: "UserNotificationPreference",
      resourceId: `${actor.id}:${input.ruleKey}`,
      metadata: input,
    });
    return result;
  });
}
