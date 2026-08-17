import "server-only";

import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  defaultNotificationDeliveryRuleState,
  dingTalkEventTypesForRule,
  findNotificationDeliveryRuleViolation,
  notificationTypesForEmailRule,
  NOTIFICATION_DELIVERY_RULES,
  type NotificationDeliveryRuleKey,
  type NotificationDeliveryRuleState,
  type NotificationDeliveryRuleView,
  updateNotificationDeliveryRulesSchema,
} from "@/modules/notifications/notification-delivery-rules";
import { assertAllowed, DomainError } from "@/modules/projects/errors";
import { ensurePluginInstallations } from "@/modules/plugins/plugin-installation-service";

const defaults = new Map<
  NotificationDeliveryRuleKey,
  NotificationDeliveryRuleState
>(
  NOTIFICATION_DELIVERY_RULES.map((rule) => [
    rule.key,
    defaultNotificationDeliveryRuleState(rule.key),
  ]),
);

export async function listNotificationDeliveryRules(actor: Actor) {
  assertAllowed(actor.isPlatformAdmin);
  await ensurePluginInstallations();
  return withActorDb(actor, async (tx) => {
    const stored = await tx.notificationDeliveryRule.findMany();
    const riskOperational = await isContentRiskOperational(tx);
    const byKey = new Map<string, NotificationDeliveryRuleState>(
      stored.map((rule) => [rule.key, rule]),
    );
    return visibleDefinitions(byKey, riskOperational);
  });
}

export async function updateNotificationDeliveryRules(
  actor: Actor,
  raw: unknown,
) {
  assertAllowed(actor.isPlatformAdmin);
  const input = updateNotificationDeliveryRulesSchema.parse(raw);
  const violation = findNotificationDeliveryRuleViolation(input.rules);
  if (violation) {
    throw new DomainError(violation.code, violation.message, 422);
  }
  const uniqueKeys = new Set(input.rules.map((rule) => rule.key));

  return withActorDb(actor, async (tx) => {
    for (const rule of input.rules) {
      await tx.notificationDeliveryRule.upsert({
        where: { key: rule.key },
        create: { ...rule, updatedById: actor.id },
        update: {
          notificationEnabled: rule.notificationEnabled,
          soundEnabled: rule.soundEnabled,
          emailEnabled: rule.emailEnabled,
          dingtalkEnabled: rule.dingtalkEnabled,
          wechatEnabled: rule.wechatEnabled,
          updatedById: actor.id,
        },
      });
    }
    const disabledEmailNotificationTypes = input.rules
      .filter((rule) => !rule.notificationEnabled || !rule.emailEnabled)
      .flatMap((rule) => [...notificationTypesForEmailRule(rule.key)]);
    if (disabledEmailNotificationTypes.length > 0) {
      await tx.notification.updateMany({
        where: {
          type: { in: disabledEmailNotificationTypes },
          emailDueAt: { not: null },
        },
        data: { emailDueAt: null, emailClaimedAt: null },
      });
      await tx.mailMessage.updateMany({
        where: {
          sourceType: {
            in: [
              "STANDARD_REQUEST_NOTIFICATION",
              "STANDARD_PROJECT_NOTIFICATION",
              "CONTENT_RISK_NOTIFICATION",
            ],
          },
          status: "QUEUED",
          notification: {
            is: { type: { in: disabledEmailNotificationTypes } },
          },
        },
        data: {
          status: "CANCELLED",
          errorMessage: "通知规则已关闭",
        },
      });
    }
    const disabledDingTalkEventTypes = input.rules
      .filter((rule) => !rule.dingtalkEnabled)
      .flatMap((rule) => [...dingTalkEventTypesForRule(rule.key)]);
    if (disabledDingTalkEventTypes.length > 0) {
      await tx.dingTalkRobotDelivery.updateMany({
        where: {
          eventType: { in: disabledDingTalkEventTypes },
          status: { in: ["PENDING", "HELD", "PROCESSING"] },
        },
        data: {
          status: "SKIPPED",
          nextAttemptAt: null,
          lastError: "钉钉通知规则已关闭",
        },
      });
    }
    await writeAuditLog(tx, actor, {
      action: "NOTIFICATION_DELIVERY_RULES_UPDATED",
      resourceType: "NotificationDeliveryRule",
      resourceId: "platform",
      metadata: { keys: [...uniqueKeys] },
    });
    const stored = await listRulesInTx(tx);
    const riskOperational = await isContentRiskOperational(tx);
    return visibleDefinitions(
      new Map<string, NotificationDeliveryRuleState>(
        stored.map((rule) => [rule.key, rule]),
      ),
      riskOperational,
    );
  });
}

export async function loadNotificationDeliveryRule(
  tx: Parameters<typeof listRulesInTx>[0],
  key: NotificationDeliveryRuleKey,
) {
  const stored = await tx.notificationDeliveryRule.findUnique({
    where: { key },
  });
  return stored ?? { key, ...defaults.get(key)! };
}

function listRulesInTx(
  tx: import("@/generated/prisma/client").Prisma.TransactionClient,
) {
  return tx.notificationDeliveryRule.findMany({ orderBy: { key: "asc" } });
}

function mergeDefinitions(
  byKey: Map<string, NotificationDeliveryRuleState>,
): NotificationDeliveryRuleView[] {
  return NOTIFICATION_DELIVERY_RULES.map((definition) => {
    const state = byKey.get(definition.key) ?? defaults.get(definition.key)!;
    return { ...definition, ...state };
  });
}

function visibleDefinitions(
  byKey: Map<string, NotificationDeliveryRuleState>,
  riskOperational: boolean,
) {
  return mergeDefinitions(byKey).filter(
    (rule) => rule.key !== "CONTENT_RISK_ALERT" || riskOperational,
  );
}

async function isContentRiskOperational(
  tx: import("@/generated/prisma/client").Prisma.TransactionClient,
) {
  const installation = await tx.pluginInstallation.findUnique({
    where: { key: "content-contact-risk" },
    select: { enabled: true, healthStatus: true },
  });
  const runtime = await tx.contentRiskRuntimeState.findUnique({
    where: { pluginKey: "content-contact-risk" },
    select: { bypassedAt: true },
  });
  return Boolean(
    installation?.enabled &&
      installation.healthStatus === "READY" &&
      runtime &&
      !runtime.bypassedAt,
  );
}
