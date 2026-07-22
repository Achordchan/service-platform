import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { env } from "@/lib/runtime-env";
import { encryptSecret } from "@/lib/secret-crypto";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  normalizeEmbedOrigin,
  normalizeWebhookUrl,
} from "@/modules/integrations/external/network-security";
import {
  lockExternalConnectorSlot,
  PRIMARY_EXTERNAL_CONNECTOR_SLOT,
} from "@/modules/integrations/external/binding-service";
import { UNIVERSAL_PLUGIN_KEY } from "@/modules/integrations/universal/constants";
import type {
  universalConnectionSchema,
  universalProfileFieldSchema,
} from "@/modules/integrations/universal/schemas";
import {
  createUniversalCredential,
  createUniversalWebhookSecret,
} from "@/modules/integrations/universal/security";
import { normalizeUniversalProfileFields } from "@/modules/integrations/universal/profile";
import { ensurePluginInstallations } from "@/modules/plugins/plugin-installation-service";
import { assertCanManageProjectDelivery } from "@/modules/projects/project-access";
import {
  assertAllowed,
  assertFound,
  DomainError,
} from "@/modules/projects/errors";
import type { z } from "zod";

type ConnectionInput = z.infer<typeof universalConnectionSchema>;
type ProfileField = z.infer<typeof universalProfileFieldSchema>;

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
  credentials: {
    select: {
      id: true,
      clientId: true,
      secretPrefix: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" as const },
  },
} as const;

function embedUrl(publicId: string) {
  return new URL(`/embed/connect/${publicId}`, env.APP_URL).toString();
}

function parseJsonArray<T>(value: Prisma.JsonValue): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function serializeConnection(
  connection: Prisma.UniversalConnectorConnectionGetPayload<{
    include: typeof connectionInclude;
  }>,
  options: {
    includeCredentials?: boolean;
    activeCredentialCount?: number;
  } = {},
) {
  const activeCredentialCount =
    options.activeCredentialCount ??
    connection.credentials.filter((credential) => !credential.revokedAt).length;
  return {
    bindingId: connection.bindingId,
    publicId: connection.binding.publicId,
    bindingStatus: connection.binding.status,
    name: connection.name,
    allowedOrigins: parseJsonArray<string>(connection.allowedOrigins),
    profileFields: parseJsonArray<ProfileField>(connection.profileFields),
    emailNotificationsEnabled: connection.emailNotificationsEnabled,
    customerMemberNotificationsEnabled:
      connection.customerMemberNotificationsEnabled,
    webhookUrl: connection.webhookUrl,
    webhookEvents: parseJsonArray<string>(connection.webhookEvents),
    hasWebhookSecret: Boolean(connection.webhookSecretEncrypted),
    webhookStatus: connection.webhookStatus,
    healthStatus: connection.healthStatus,
    lastCheckedAt: connection.lastCheckedAt?.toISOString() ?? null,
    lastError: connection.lastError,
    embedUrl: embedUrl(connection.binding.publicId),
    activeCredentialCount,
    credentials: options.includeCredentials
      ? connection.credentials.map((credential) => ({
          ...credential,
          lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
          revokedAt: credential.revokedAt?.toISOString() ?? null,
          createdAt: credential.createdAt.toISOString(),
        }))
      : [],
    project: connection.binding.project,
    updatedAt: connection.updatedAt.toISOString(),
  };
}

async function assertPluginReady(tx: Prisma.TransactionClient) {
  const installation = await tx.pluginInstallation.findUnique({
    where: { key: UNIVERSAL_PLUGIN_KEY },
    select: { enabled: true, healthStatus: true },
  });
  if (!installation?.enabled || installation.healthStatus !== "READY") {
    throw new DomainError(
      "UNIVERSAL_PLUGIN_NOT_READY",
      "请先在插件中心完成通用工单连接器检测并启用",
      409,
    );
  }
}

async function assertExternalProject(
  tx: Prisma.TransactionClient,
  projectId: string,
) {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: { id: true, title: true, kind: true, customerSpaceId: true },
  });
  assertFound(project, "项目不存在");
  if (project.kind !== "EXTERNAL_INTEGRATION") {
    throw new DomainError(
      "PROJECT_KIND_MISMATCH",
      "只有外部接入项目可以配置通用连接器",
      409,
    );
  }
  return project;
}

function loadConnection(tx: Prisma.TransactionClient, projectId: string) {
  return tx.universalConnectorConnection.findFirst({
    where: {
      binding: { projectId, pluginKey: UNIVERSAL_PLUGIN_KEY },
    },
    include: connectionInclude,
  });
}

export async function getUniversalIntegration(actor: Actor, projectId: string) {
  await ensurePluginInstallations();
  return withActorDb(actor, async (tx) => {
    await assertCanManageProjectDelivery(tx, actor, projectId);
    const project = await assertExternalProject(tx, projectId);
    const plugin = await tx.pluginInstallation.findUnique({
      where: { key: UNIVERSAL_PLUGIN_KEY },
      select: { enabled: true, healthStatus: true, lastError: true },
    });
    const connection = await loadConnection(tx, projectId);
    const activeCredentialCount =
      connection && !actor.isPlatformAdmin
        ? (
            await tx.$queryRaw<Array<{ count: number }>>`
              SELECT app_count_active_universal_credentials(${connection.bindingId}) AS count
            `
          )[0]?.count ?? 0
        : undefined;
    return {
      plugin,
      project,
      connection: connection
        ? serializeConnection(connection, {
            includeCredentials: actor.isPlatformAdmin,
            activeCredentialCount,
          })
        : null,
    };
  });
}

export async function saveUniversalIntegration(
  actor: Actor,
  projectId: string,
  input: ConnectionInput,
) {
  assertAllowed(actor.isPlatformAdmin);
  await ensurePluginInstallations();
  const allowedOrigins = Array.from(
    new Set(input.allowedOrigins.map(normalizeEmbedOrigin)),
  ).sort();
  const profileFields = normalizeUniversalProfileFields(input.profileFields);
  const webhookEvents = Array.from(new Set(input.webhookEvents));
  const webhookUrl = input.webhookUrl
    ? normalizeWebhookUrl(input.webhookUrl)
    : null;
  if (input.rotateWebhookSecret && !webhookUrl) {
    throw new DomainError(
      "WEBHOOK_URL_REQUIRED",
      "请先填写 Webhook 地址",
      422,
    );
  }
  const webhookSecret = input.rotateWebhookSecret
    ? createUniversalWebhookSecret()
    : null;

  const result = await withActorDb(actor, async (tx) => {
    await assertPluginReady(tx);
    const project = await assertExternalProject(tx, projectId);
    const current = await loadConnection(tx, projectId);
    if (current?.binding.status === "ARCHIVED") {
      throw new DomainError(
        "UNIVERSAL_CONNECTION_ARCHIVED",
        "已归档的连接不能修改",
        409,
      );
    }
    await lockExternalConnectorSlot(tx, projectId, UNIVERSAL_PLUGIN_KEY);
    const binding = await tx.projectPluginBinding.upsert({
      where: {
        projectId_pluginKey: { projectId, pluginKey: UNIVERSAL_PLUGIN_KEY },
      },
      create: {
        projectId,
        pluginKey: UNIVERSAL_PLUGIN_KEY,
        externalConnectorSlot: PRIMARY_EXTERNAL_CONNECTOR_SLOT,
        status: "DRAFT",
      },
      update: { externalConnectorSlot: PRIMARY_EXTERNAL_CONNECTOR_SLOT },
    });
    const connectionCriticalChanged = Boolean(
      !current ||
        JSON.stringify(current.allowedOrigins) !== JSON.stringify(allowedOrigins) ||
        JSON.stringify(current.profileFields) !== JSON.stringify(profileFields),
    );
    const webhookChanged = Boolean(
      current &&
        (current.webhookUrl !== webhookUrl ||
          JSON.stringify(current.webhookEvents) !== JSON.stringify(webhookEvents)),
    );
    if (input.activate) {
      if (
        !current ||
        current.healthStatus !== "READY" ||
        connectionCriticalChanged
      ) {
        throw new DomainError(
          "UNIVERSAL_CONNECTION_NOT_VERIFIED",
          "请保存配置并完成连接检测后再激活",
          409,
        );
      }
      const activeCredentialCount = await tx.universalConnectorCredential.count({
        where: { bindingId: binding.id, revokedAt: null },
      });
      if (activeCredentialCount === 0) {
        throw new DomainError(
          "UNIVERSAL_CREDENTIAL_REQUIRED",
          "激活前至少需要一个有效凭据",
          409,
        );
      }
      await tx.projectPluginBinding.update({
        where: { id: binding.id },
        data: { status: "ACTIVE" },
      });
      await tx.project.updateMany({
        where: { id: projectId, status: "DRAFT" },
        data: { status: "ACTIVE" },
      });
    }
    const connection = await tx.universalConnectorConnection.upsert({
      where: { bindingId: binding.id },
      create: {
        bindingId: binding.id,
        name: input.name,
        allowedOrigins,
        profileFields,
        emailNotificationsEnabled: input.emailNotificationsEnabled,
        customerMemberNotificationsEnabled:
          input.customerMemberNotificationsEnabled,
        webhookUrl,
        webhookEvents,
        webhookSecretEncrypted: webhookSecret
          ? encryptSecret(webhookSecret)
          : null,
        webhookStatus: webhookUrl ? "UNVERIFIED" : "DISABLED",
      },
      update: {
        name: input.name,
        allowedOrigins,
        profileFields,
        emailNotificationsEnabled: input.emailNotificationsEnabled,
        customerMemberNotificationsEnabled:
          input.customerMemberNotificationsEnabled,
        webhookUrl,
        webhookEvents,
        ...(webhookSecret
          ? {
              webhookSecretEncrypted: encryptSecret(webhookSecret),
              webhookStatus: "UNVERIFIED",
            }
          : webhookUrl
            ? webhookChanged
              ? { webhookStatus: "UNVERIFIED" }
              : {}
            : {
                webhookSecretEncrypted: null,
                webhookStatus: "DISABLED",
              }),
        ...(connectionCriticalChanged
          ? {
              healthStatus: "UNKNOWN",
              lastCheckedAt: null,
              lastError: null,
            }
          : {}),
      },
      include: connectionInclude,
    });
    if (connectionCriticalChanged && binding.status === "ACTIVE") {
      await tx.projectPluginBinding.update({
        where: { id: binding.id },
        data: { status: "DISABLED" },
      });
      await tx.externalEmbedSession.updateMany({
        where: { bindingId: binding.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await writeAuditLog(tx, actor, {
      action: current
        ? "UNIVERSAL_CONNECTION_UPDATED"
        : "UNIVERSAL_CONNECTION_CREATED",
      resourceType: "UniversalConnectorConnection",
      resourceId: binding.id,
      customerSpaceId: project.customerSpaceId,
      projectId,
      metadata: {
        allowedOriginCount: allowedOrigins.length,
        profileFieldCount: profileFields.length,
        webhookConfigured: Boolean(webhookUrl),
        webhookEventCount: webhookEvents.length,
        webhookSecretRotated: Boolean(webhookSecret),
      },
    });
    return connection;
  });
  return {
    connection: serializeConnection(result, { includeCredentials: true }),
    webhookSecret,
  };
}

export async function checkUniversalIntegration(
  actor: Actor,
  projectId: string,
) {
  assertAllowed(actor.isPlatformAdmin);
  await ensurePluginInstallations();
  return withActorDb(actor, async (tx) => {
    await assertPluginReady(tx);
    const project = await assertExternalProject(tx, projectId);
    const connection = await loadConnection(tx, projectId);
    assertFound(connection, "请先保存通用连接配置");
    const activeCredentials = connection.credentials.filter(
      (credential) => !credential.revokedAt,
    );
    const errors: string[] = [];
    if (parseJsonArray<string>(connection.allowedOrigins).length === 0) {
      errors.push("至少需要一个允许嵌入的 Origin");
    }
    if (activeCredentials.length === 0) {
      errors.push("至少需要一个有效凭据");
    }
    if (connection.webhookUrl && !connection.webhookSecretEncrypted) {
      errors.push("Webhook 尚未生成签名密钥");
    }
    const updated = await tx.universalConnectorConnection.update({
      where: { bindingId: connection.bindingId },
      data: {
        healthStatus: errors.length === 0 ? "READY" : "ERROR",
        lastCheckedAt: new Date(),
        lastError: errors.join("；") || null,
      },
      include: connectionInclude,
    });
    await writeAuditLog(tx, actor, {
      action: "UNIVERSAL_CONNECTION_CHECKED",
      resourceType: "UniversalConnectorConnection",
      resourceId: connection.bindingId,
      customerSpaceId: project.customerSpaceId,
      projectId,
      result: errors.length === 0 ? "SUCCESS" : "FAILED",
      metadata: {
        allowedOriginCount: parseJsonArray<string>(connection.allowedOrigins)
          .length,
        activeCredentialCount: activeCredentials.length,
        webhookConfigured: Boolean(connection.webhookUrl),
      },
    });
    if (errors.length > 0) {
      throw new DomainError(
        "UNIVERSAL_CONNECTION_CHECK_FAILED",
        errors.join("；"),
        409,
        { connection: serializeConnection(updated, { includeCredentials: true }) },
      );
    }
    return serializeConnection(updated, { includeCredentials: true });
  });
}

export async function createUniversalCredentialForProject(
  actor: Actor,
  projectId: string,
) {
  assertAllowed(actor.isPlatformAdmin);
  const generated = createUniversalCredential();
  const credential = await withActorDb(actor, async (tx) => {
    await assertPluginReady(tx);
    const project = await assertExternalProject(tx, projectId);
    const connection = await loadConnection(tx, projectId);
    assertFound(connection, "请先保存通用连接配置");
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`universal-credential:${connection.bindingId}`}, 0)
      )
    `;
    const activeCount = await tx.universalConnectorCredential.count({
      where: { bindingId: connection.bindingId, revokedAt: null },
    });
    if (activeCount >= 2) {
      throw new DomainError(
        "UNIVERSAL_CREDENTIAL_LIMIT",
        "每个连接最多保留两个有效凭据",
        409,
      );
    }
    const created = await tx.universalConnectorCredential.create({
      data: {
        bindingId: connection.bindingId,
        clientId: generated.clientId,
        secretHash: generated.secretHash,
        secretPrefix: generated.secretPrefix,
      },
      select: {
        id: true,
        clientId: true,
        secretPrefix: true,
        createdAt: true,
      },
    });
    await writeAuditLog(tx, actor, {
      action: "UNIVERSAL_CREDENTIAL_CREATED",
      resourceType: "UniversalConnectorCredential",
      resourceId: created.id,
      customerSpaceId: project.customerSpaceId,
      projectId,
      metadata: { clientId: created.clientId },
    });
    return created;
  });
  return {
    ...credential,
    createdAt: credential.createdAt.toISOString(),
    clientSecret: generated.clientSecret,
  };
}

export async function revokeUniversalCredential(
  actor: Actor,
  projectId: string,
  credentialId: string,
) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, async (tx) => {
    const project = await assertExternalProject(tx, projectId);
    const connection = await loadConnection(tx, projectId);
    assertFound(connection, "通用连接不存在");
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`universal-credential:${connection.bindingId}`}, 0)
      )
    `;
    const credential = await tx.universalConnectorCredential.findFirst({
      where: { id: credentialId, bindingId: connection.bindingId },
    });
    assertFound(credential, "凭据不存在");
    if (credential.revokedAt) return { revoked: true };
    const activeCount = await tx.universalConnectorCredential.count({
      where: { bindingId: connection.bindingId, revokedAt: null },
    });
    if (connection.binding.status === "ACTIVE" && activeCount <= 1) {
      throw new DomainError(
        "LAST_ACTIVE_CREDENTIAL",
        "激活中的连接必须保留一个有效凭据，请先生成新凭据",
        409,
      );
    }
    await tx.universalConnectorCredential.update({
      where: { id: credential.id },
      data: { revokedAt: new Date() },
    });
    await writeAuditLog(tx, actor, {
      action: "UNIVERSAL_CREDENTIAL_REVOKED",
      resourceType: "UniversalConnectorCredential",
      resourceId: credential.id,
      customerSpaceId: project.customerSpaceId,
      projectId,
      metadata: { clientId: credential.clientId },
    });
    return { revoked: true };
  });
}

export async function archiveUniversalIntegration(
  actor: Actor,
  projectId: string,
) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, async (tx) => {
    const project = await assertExternalProject(tx, projectId);
    const connection = await loadConnection(tx, projectId);
    assertFound(connection, "通用连接不存在");
    const now = new Date();
    await tx.projectPluginBinding.update({
      where: { id: connection.bindingId },
      data: { status: "ARCHIVED", archivedAt: now },
    });
    await tx.externalEmbedSession.updateMany({
      where: { bindingId: connection.bindingId, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.universalConnectorCredential.updateMany({
      where: { bindingId: connection.bindingId, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.universalLaunchTicket.updateMany({
      where: {
        bindingId: connection.bindingId,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { expiresAt: now },
    });
    await writeAuditLog(tx, actor, {
      action: "UNIVERSAL_CONNECTION_ARCHIVED",
      resourceType: "UniversalConnectorConnection",
      resourceId: connection.bindingId,
      customerSpaceId: project.customerSpaceId,
      projectId,
    });
    return { archived: true };
  });
}
