import "server-only";

import { DingTalkRobotConfigError } from "@achord/plugin-dingtalk-robot/config";
import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { env } from "@/lib/runtime-env";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { ensurePluginInstallations } from "@/modules/plugins/plugin-installation-service";
import {
  DINGTALK_ROBOT_PLUGIN_KEY,
  getRegisteredPlugin,
  tryParseRegisteredPluginSecretConfig,
} from "@/modules/plugins/plugin-registry";
import { decryptPluginSecretConfig } from "@/modules/plugins/plugin-secret-config";
import {
  assertAllowed,
  assertFound,
  DomainError,
} from "@/modules/projects/errors";

export async function sendPluginTestMessage(
  actor: Actor,
  pluginKey: string,
  options?: {
    eventType?: "REQUEST_CREATED" | "REQUEST_CUSTOMER_REPLIED";
    template?: { title: string; body: string };
  },
) {
  assertAllowed(actor.isPlatformAdmin);
  await ensurePluginInstallations();
  const registered = getRegisteredPlugin(pluginKey);
  if (
    !registered.manifest.actions?.some(
      (action) => action.key === "send-test-message",
    ) ||
    pluginKey !== DINGTALK_ROBOT_PLUGIN_KEY
  ) {
    throw new DomainError(
      "PLUGIN_ACTION_NOT_SUPPORTED",
      "该插件不支持发送测试消息",
      409,
    );
  }

  const installation = await withActorDb(actor, (tx) =>
    tx.pluginInstallation.findUnique({
      where: { key: pluginKey },
      select: { config: true, secretConfigEncrypted: true },
    }),
  );
  assertFound(installation, "插件未安装");

  let secretCandidate: unknown;
  try {
    secretCandidate = decryptPluginSecretConfig(
      installation.secretConfigEncrypted,
    );
  } catch {
    secretCandidate = null;
  }
  const secretCheck = tryParseRegisteredPluginSecretConfig(
    pluginKey,
    secretCandidate,
  );
  if (!secretCheck.ok) {
    throw new DomainError(
      "PLUGIN_SECRET_CONFIG_INVALID",
      `请先保存有效的插件配置：${secretCheck.error}`,
      409,
    );
  }

  try {
    const {
      sendDingTalkTicketNotification,
      testDingTalkRobotBinding,
    } = await import("@achord/plugin-dingtalk-robot/runtime");
    if (options?.eventType) {
      const {
        getDingTalkRobotTemplate,
        parseDingTalkRobotConfig,
      } = await import("@achord/plugin-dingtalk-robot/config");
      const config = parseDingTalkRobotConfig(installation.config);
      const template = options.template
        ? getDingTalkRobotTemplate(
            parseDingTalkRobotConfig({
              ...config,
              templates: {
                ...config.templates,
                [options.eventType]: options.template,
              },
            }),
            options.eventType,
          )
        : getDingTalkRobotTemplate(config, options.eventType);
      await sendDingTalkTicketNotification(
        secretCheck.config,
        {
          type: options.eventType,
          requestId: "template-preview",
          requestNumber: "REQ-1001",
          title: "VPN 连接问题",
          requestUrl: `${env.APP_URL.replace(/\/$/, "")}/staff/requests/template-preview`,
          customerName: "示例客户",
          projectName: "企业 VPN 服务",
          priorityLabel: "高",
          actorName: "测试用户",
          occurredAt: new Date(),
        },
        { template },
      );
    } else {
      await testDingTalkRobotBinding(secretCheck.config);
    }
    await recordPluginTestAudit(actor, pluginKey, "SUCCESS", {
      eventType: options?.eventType ?? "CONNECTION_TEST",
    });
    return { delivered: true as const };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "测试消息发送失败";
    await recordPluginTestAudit(actor, pluginKey, "FAILED", {
      error: message,
      eventType: options?.eventType ?? "CONNECTION_TEST",
    });
    if (error instanceof DingTalkRobotConfigError) {
      throw new DomainError(
        "PLUGIN_TEST_TEMPLATE_INVALID",
        message,
        422,
      );
    }
    throw new DomainError(
      "PLUGIN_TEST_MESSAGE_FAILED",
      `测试消息发送失败：${message}`,
      502,
    );
  }
}

async function recordPluginTestAudit(
  actor: Actor,
  pluginKey: string,
  result: "SUCCESS" | "FAILED",
  metadata: Prisma.InputJsonObject,
) {
  try {
    await withActorDb(actor, (tx) =>
      writeAuditLog(tx, actor, {
        action: "PLUGIN_TEST_MESSAGE_SENT",
        resourceType: "PluginInstallation",
        resourceId: pluginKey,
        result,
        metadata,
      }),
    );
  } catch {
    console.error(
      "ACHORD_PLUGIN_TEST_AUDIT_FAILED",
      JSON.stringify({ pluginKey, result }),
    );
  }
}
