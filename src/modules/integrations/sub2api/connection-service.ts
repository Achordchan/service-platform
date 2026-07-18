import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { env } from "@/lib/runtime-env";
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  checkSub2ApiConnection,
  normalizeSub2ApiBaseUrl,
} from "@/modules/integrations/sub2api/client";
import { resolveSub2ApiConnectionAddress } from "@/modules/integrations/sub2api/connection-utils";
import {
  lockExternalConnectorSlot,
  PRIMARY_EXTERNAL_CONNECTOR_SLOT,
} from "@/modules/integrations/external/binding-service";
import type {
  sub2ApiConnectionPatchSchema,
  sub2ApiConnectionSchema,
} from "@/modules/integrations/sub2api/schemas";
import { ensurePluginInstallations } from "@/modules/plugins/plugin-installation-service";
import { SUB2API_CONNECTOR_PLUGIN_KEY } from "@/modules/plugins/plugin-registry";
import {
  assertAllowed,
  assertFound,
  DomainError,
} from "@/modules/projects/errors";
import { assertCanManageProjectDelivery } from "@/modules/projects/project-access";
import type { z } from "zod";

type ConnectionInput = z.infer<typeof sub2ApiConnectionSchema>;
type ConnectionPatchInput = z.infer<typeof sub2ApiConnectionPatchSchema>;

const connectionInclude = {
  binding: {
    include: {
      project: {
        select: {
          id: true,
          title: true,
          kind: true,
          status: true,
          customerSpaceId: true,
        },
      },
    },
  },
} as const;

function iframeUrl(publicId: string) {
  return new URL(`/embed/sub2api/${publicId}`, env.APP_URL).toString();
}

function serializeConnection(
  connection: Prisma.Sub2ApiConnectionGetPayload<{
    include: typeof connectionInclude;
  }>,
) {
  return {
    bindingId: connection.bindingId,
    publicId: connection.binding.publicId,
    bindingStatus: connection.binding.status,
    baseUrl: connection.baseUrl,
    sourceOrigin: connection.sourceOrigin,
    hasAdminApiKey: Boolean(connection.adminApiKeyEncrypted),
    emailNotificationsEnabled: connection.emailNotificationsEnabled,
    customerMemberNotificationsEnabled:
      connection.customerMemberNotificationsEnabled,
    healthStatus: connection.healthStatus,
    lastCheckedAt: connection.lastCheckedAt?.toISOString() ?? null,
    lastError: connection.lastError,
    iframeUrl: iframeUrl(connection.binding.publicId),
    project: connection.binding.project,
    updatedAt: connection.updatedAt.toISOString(),
  };
}

async function loadInstallation(tx: Prisma.TransactionClient) {
  const installation = await tx.pluginInstallation.findUnique({
    where: { key: SUB2API_CONNECTOR_PLUGIN_KEY },
  });
  assertFound(installation, "Sub2API 连接器尚未安装");
  return installation;
}

async function assertPluginReady(tx: Prisma.TransactionClient) {
  const installation = await loadInstallation(tx);
  if (!installation.enabled) {
    throw new DomainError(
      "SUB2API_PLUGIN_DISABLED",
      "请先在插件中心启用 Sub2API 工单连接器",
      409,
    );
  }
  if (installation.healthStatus !== "READY") {
    throw new DomainError(
      "SUB2API_PLUGIN_NOT_READY",
      "Sub2API 连接器环境检测未通过",
      409,
    );
  }
  return installation;
}

async function assertExternalProject(
  tx: Prisma.TransactionClient,
  projectId: string,
) {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: { id: true, kind: true, customerSpaceId: true, title: true },
  });
  assertFound(project, "项目不存在");
  if (project.kind !== "EXTERNAL_INTEGRATION") {
    throw new DomainError(
      "PROJECT_KIND_MISMATCH",
      "只有外部接入项目可以配置 Sub2API",
      409,
    );
  }
  return project;
}

async function loadConnection(
  tx: Prisma.TransactionClient,
  projectId: string,
) {
  return tx.sub2ApiConnection.findFirst({
    where: {
      binding: {
        projectId,
        pluginKey: SUB2API_CONNECTOR_PLUGIN_KEY,
      },
    },
    include: connectionInclude,
  });
}

export async function getSub2ApiIntegration(actor: Actor, projectId: string) {
  await ensurePluginInstallations();
  return withActorDb(actor, async (tx) => {
    await assertCanManageProjectDelivery(tx, actor, projectId);
    const project = await assertExternalProject(tx, projectId);
    const installation = await loadInstallation(tx);
    const connection = await loadConnection(tx, projectId);
    return {
      plugin: {
        enabled: installation.enabled,
        healthStatus: installation.healthStatus,
        lastError: installation.lastError,
      },
      project,
      connection: connection ? serializeConnection(connection) : null,
    };
  });
}

export async function saveSub2ApiIntegration(
  actor: Actor,
  projectId: string,
  input: ConnectionInput | ConnectionPatchInput,
) {
  assertAllowed(actor.isPlatformAdmin);
  await ensurePluginInstallations();
  const normalized = input.baseUrl
    ? normalizeSub2ApiBaseUrl(input.baseUrl)
    : null;

  return withActorDb(actor, async (tx) => {
    await assertPluginReady(tx);
    const project = await assertExternalProject(tx, projectId);
    const current = await loadConnection(tx, projectId);
    const connectionAddress = resolveSub2ApiConnectionAddress(
      normalized,
      current,
    );
    const baseUrlChanged = Boolean(
      normalized && normalized.baseUrl !== current?.baseUrl,
    );

    const clearKey = input.clearAdminApiKey === true;
    const newKey = input.adminApiKey?.trim();
    if (clearKey && newKey) {
      throw new DomainError(
        "SUB2API_KEY_ACTION_CONFLICT",
        "不能同时更换并清除管理员 API Key",
        422,
      );
    }

    if (current?.binding.status === "ARCHIVED") {
      throw new DomainError(
        "SUB2API_CONNECTION_ARCHIVED",
        "已归档的连接不能再修改或重新激活，请新建外部接入项目",
        409,
      );
    }

    const requestedStatus =
      input.activate === true
        ? "ACTIVE"
        : "status" in input
          ? input.status
          : undefined;
    if (baseUrlChanged && requestedStatus === "ACTIVE") {
      throw new DomainError(
        "SUB2API_CONNECTION_NOT_VERIFIED",
        "更换 Sub2API 地址后需要重新检测并激活",
        409,
      );
    }
    if (
      requestedStatus === "ACTIVE" &&
      (!current || current.healthStatus !== "READY" || baseUrlChanged)
    ) {
      throw new DomainError(
        "SUB2API_CONNECTION_NOT_VERIFIED",
        "请先保存配置并完成连接检测，再激活入口",
        409,
      );
    }

    // Changing the upstream identity source must immediately kill old embed
    // sessions that were minted against the previous instance.
    const nextBindingStatus = baseUrlChanged
      ? "DISABLED"
      : requestedStatus;

    await lockExternalConnectorSlot(
      tx,
      projectId,
      SUB2API_CONNECTOR_PLUGIN_KEY,
    );
    const binding = await tx.projectPluginBinding.upsert({
      where: {
        projectId_pluginKey: {
          projectId,
          pluginKey: SUB2API_CONNECTOR_PLUGIN_KEY,
        },
      },
      create: {
        projectId,
        pluginKey: SUB2API_CONNECTOR_PLUGIN_KEY,
        externalConnectorSlot: PRIMARY_EXTERNAL_CONNECTOR_SLOT,
        status: input.activate ? "ACTIVE" : "DRAFT",
      },
      update: {
        externalConnectorSlot: PRIMARY_EXTERNAL_CONNECTOR_SLOT,
        ...(nextBindingStatus
          ? { status: nextBindingStatus }
          : {}),
      },
    });

    const encryptedKey = clearKey
      ? null
      : newKey
        ? encryptSecret(newKey)
        : current?.adminApiKeyEncrypted;
    const keyChanged = Boolean(newKey) || clearKey;
    const shouldResetHealth = baseUrlChanged || keyChanged;
    const connection = await tx.sub2ApiConnection.upsert({
      where: { bindingId: binding.id },
      create: {
        bindingId: binding.id,
        baseUrl: connectionAddress.baseUrl,
        sourceOrigin: connectionAddress.sourceOrigin,
        adminApiKeyEncrypted: encryptedKey,
        emailNotificationsEnabled:
          input.emailNotificationsEnabled ?? true,
        customerMemberNotificationsEnabled:
          input.customerMemberNotificationsEnabled ?? false,
      },
      update: {
        ...(normalized
          ? {
              baseUrl: normalized.baseUrl,
              sourceOrigin: normalized.sourceOrigin,
            }
          : {}),
        adminApiKeyEncrypted: encryptedKey,
        ...(shouldResetHealth
          ? {
              healthStatus: "UNKNOWN",
              lastCheckedAt: null,
              lastError: null,
            }
          : {}),
        ...(input.emailNotificationsEnabled === undefined
          ? {}
          : { emailNotificationsEnabled: input.emailNotificationsEnabled }),
        ...(input.customerMemberNotificationsEnabled === undefined
          ? {}
          : {
              customerMemberNotificationsEnabled:
                input.customerMemberNotificationsEnabled,
            }),
      },
      include: connectionInclude,
    });

    if (binding.status !== "ACTIVE" || baseUrlChanged) {
      await tx.externalEmbedSession.updateMany({
        where: { bindingId: binding.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await writeAuditLog(tx, actor, {
      action: current
        ? "SUB2API_CONNECTION_UPDATED"
        : "SUB2API_CONNECTION_CREATED",
      resourceType: "Sub2ApiConnection",
      resourceId: binding.id,
      customerSpaceId: project.customerSpaceId,
      projectId,
      metadata: {
        baseUrl: connection.baseUrl,
        status: binding.status,
        adminApiKeyChanged: Boolean(newKey) || clearKey,
        emailNotificationsEnabled: connection.emailNotificationsEnabled,
        customerMemberNotificationsEnabled:
          connection.customerMemberNotificationsEnabled,
      },
    });
    return serializeConnection(connection);
  });
}

export async function checkProjectSub2ApiConnection(
  actor: Actor,
  projectId: string,
) {
  assertAllowed(actor.isPlatformAdmin);
  await ensurePluginInstallations();
  const current = await withActorDb(actor, async (tx) => {
    await assertPluginReady(tx);
    await assertExternalProject(tx, projectId);
    const connection = await loadConnection(tx, projectId);
    assertFound(connection, "请先保存 Sub2API 连接配置");
    return {
      bindingId: connection.bindingId,
      baseUrl: connection.baseUrl,
      adminApiKeyEncrypted: connection.adminApiKeyEncrypted,
    };
  });

  let detail: Record<string, string> = {};
  let errorMessage: string | null = null;
  try {
    detail = await checkSub2ApiConnection(
      current.baseUrl,
      current.adminApiKeyEncrypted
        ? decryptSecret(current.adminApiKeyEncrypted)
        : null,
    );
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "连接检测失败";
  }

  const connection = await withActorDb(actor, async (tx) => {
    await tx.$queryRaw`
      SELECT "bindingId"
      FROM "Sub2ApiConnection"
      WHERE "bindingId" = ${current.bindingId}
      FOR UPDATE
    `;
    const latest = await tx.sub2ApiConnection.findUnique({
      where: { bindingId: current.bindingId },
      select: {
        baseUrl: true,
        adminApiKeyEncrypted: true,
        binding: { select: { status: true, archivedAt: true } },
      },
    });
    assertFound(latest, "Sub2API 连接不存在");
    if (latest.binding.status === "ARCHIVED" || latest.binding.archivedAt) {
      throw new DomainError(
        "SUB2API_CONNECTION_ARCHIVED",
        "已归档的连接不能执行检测",
        409,
      );
    }
    const cas = await tx.sub2ApiConnection.updateMany({
      where: {
        bindingId: current.bindingId,
        baseUrl: current.baseUrl,
        adminApiKeyEncrypted: current.adminApiKeyEncrypted,
      },
      data: {
        healthStatus: errorMessage ? "ERROR" : "READY",
        lastCheckedAt: new Date(),
        lastError: errorMessage,
      },
    });
    if (cas.count !== 1) {
      throw new DomainError(
        "SUB2API_CONNECTION_CHANGED",
        "连接配置已在检测过程中被修改，请重新检测",
        409,
      );
    }
    const updated = await tx.sub2ApiConnection.findUniqueOrThrow({
      where: { bindingId: current.bindingId },
      include: connectionInclude,
    });
    await writeAuditLog(tx, actor, {
      action: "SUB2API_CONNECTION_CHECKED",
      resourceType: "Sub2ApiConnection",
      resourceId: current.bindingId,
      customerSpaceId: updated.binding.project.customerSpaceId,
      projectId,
      result: errorMessage ? "FAILED" : "SUCCESS",
      metadata: { healthStatus: updated.healthStatus, detail },
    });
    return updated;
  });
  if (errorMessage) {
    throw new DomainError(
      "SUB2API_CONNECTION_CHECK_FAILED",
      errorMessage,
      502,
      { connection: serializeConnection(connection) },
    );
  }
  return { ...serializeConnection(connection), detail };
}

export async function archiveProjectSub2ApiConnection(
  actor: Actor,
  projectId: string,
) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, async (tx) => {
    const project = await assertExternalProject(tx, projectId);
    const connection = await loadConnection(tx, projectId);
    assertFound(connection, "Sub2API 连接不存在");
    const now = new Date();
    await tx.projectPluginBinding.update({
      where: { id: connection.bindingId },
      data: { status: "ARCHIVED", archivedAt: now },
    });
    await tx.externalEmbedSession.updateMany({
      where: { bindingId: connection.bindingId, revokedAt: null },
      data: { revokedAt: now },
    });
    await writeAuditLog(tx, actor, {
      action: "SUB2API_CONNECTION_ARCHIVED",
      resourceType: "Sub2ApiConnection",
      resourceId: connection.bindingId,
      customerSpaceId: project.customerSpaceId,
      projectId,
    });
    return { archived: true };
  });
}
