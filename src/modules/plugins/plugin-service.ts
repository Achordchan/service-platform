import "server-only";

import { randomUUID } from "node:crypto";
import type { PluginRunStatus, Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import {
  queueImageWebpMigrationRun,
} from "@/lib/jobs";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { publishEvent } from "@/modules/notifications/notification-service";
import { publishPluginRunEvent } from "@/modules/plugins/plugin-events";
import {
  applyPluginEnableSideEffects,
  applyPluginDisableSideEffects,
  ensurePluginInstallations,
} from "@/modules/plugins/plugin-installation-service";
import {
  configsMatch,
  CONTENT_CONTACT_RISK_PLUGIN_KEY,
  getRegisteredPlugin,
  IMAGE_WEBP_PLUGIN_KEY,
  listRegisteredPlugins,
  normalizeRegisteredPluginConfig,
  registeredPluginHealthConfig,
  tryParseRegisteredPluginConfig,
  tryParseRegisteredPluginSecretConfig,
} from "@/modules/plugins/plugin-registry";
import {
  decryptPluginSecretConfig,
  encryptPluginSecretConfig,
  fingerprintPluginConfiguration,
} from "@/modules/plugins/plugin-secret-config";
import {
  assertAllowed,
  assertFound,
  DomainError,
} from "@/modules/projects/errors";

export async function listPluginViews(actor: Actor) {
  assertAllowed(actor.isPlatformAdmin);
  await ensurePluginInstallations();
  const installations = await withActorDb(actor, (tx) =>
    tx.pluginInstallation.findMany({
      include: {
        runs: {
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
      orderBy: { key: "asc" },
    }),
  );
  const manifestByKey = new Map(
    listRegisteredPlugins().map((manifest) => [manifest.key, manifest]),
  );
  return installations.flatMap((installation) => {
    const manifest = manifestByKey.get(installation.key);
    if (!manifest) return [];
    const secretConfig = inspectSecretConfig(
      installation.key,
      installation.secretConfigEncrypted,
    );
    return [
      {
        ...manifest,
        enabled: installation.enabled,
        config: normalizeRegisteredPluginConfig(
          installation.key,
          installation.config,
        ),
        configuredSecretKeys: secretConfig.keys,
        secretConfigState: secretConfig.state,
        healthStatus: installation.healthStatus,
        lastCheckedAt: installation.lastCheckedAt?.toISOString() ?? null,
        lastError: installation.lastError,
        updatedAt: installation.updatedAt.toISOString(),
        runs: installation.runs.map(serializeRun),
      },
    ];
  });
}

export async function updatePluginInstallation(
  actor: Actor,
  pluginKey: string,
  input: {
    enabled?: boolean;
    config?: unknown;
    secrets?: unknown;
  },
) {
  assertAllowed(actor.isPlatformAdmin);
  await ensurePluginInstallations();
  getRegisteredPlugin(pluginKey);
  let parsedConfig: Record<string, unknown> | undefined;
  if (input.config !== undefined) {
    const configCheck = tryParseRegisteredPluginConfig(pluginKey, input.config);
    if (!configCheck.ok) {
      throw new DomainError(
        "PLUGIN_CONFIG_INVALID",
        configCheck.error,
        400,
      );
    }
    parsedConfig = configCheck.config;
  }
  let parsedSecrets: Record<string, string> | undefined;
  if (input.secrets !== undefined) {
    const secretCheck = tryParseRegisteredPluginSecretConfig(
      pluginKey,
      input.secrets,
    );
    if (!secretCheck.ok) {
      throw new DomainError(
        "PLUGIN_SECRET_CONFIG_INVALID",
        secretCheck.error,
        400,
      );
    }
    parsedSecrets = secretCheck.config as Record<string, string>;
  }

  if (input.enabled === true && parsedSecrets !== undefined) {
    throw new DomainError(
      "PLUGIN_SECRET_ENABLE_CONFLICT",
      "请先保存敏感配置并完成运行环境检测，再启用插件",
      409,
    );
  }

  await withActorDb(actor, async (tx) => {
    const current = await tx.pluginInstallation.findUnique({
      where: { key: pluginKey },
    });
    assertFound(current, "插件未安装");
    const currentConfigCheck = tryParseRegisteredPluginConfig(
      pluginKey,
      current.config,
    );
    const healthConfigChanged =
      parsedConfig !== undefined &&
      (!currentConfigCheck.ok ||
        !configsMatch(
          registeredPluginHealthConfig(pluginKey, currentConfigCheck.config),
          registeredPluginHealthConfig(pluginKey, parsedConfig),
        ));
    if (input.enabled === true) {
      const configToValidate =
        parsedConfig !== undefined ? parsedConfig : current.config;
      const configCheck = tryParseRegisteredPluginConfig(
        pluginKey,
        configToValidate,
      );
      if (!configCheck.ok) {
        throw new DomainError(
          "PLUGIN_CONFIG_INVALID",
          `插件配置无效，无法启用：${configCheck.error}`,
          409,
        );
      }
      let currentSecrets: unknown;
      try {
        currentSecrets = decryptPluginSecretConfig(
          current.secretConfigEncrypted,
        );
      } catch {
        currentSecrets = null;
      }
      const secretCheck = tryParseRegisteredPluginSecretConfig(
        pluginKey,
        currentSecrets,
      );
      if (!secretCheck.ok) {
        throw new DomainError(
          "PLUGIN_SECRET_CONFIG_INVALID",
          `插件敏感配置无效，无法启用：${secretCheck.error}`,
          409,
        );
      }
      const currentFingerprint = fingerprintPluginConfiguration(
        registeredPluginHealthConfig(pluginKey, configCheck.config),
        secretCheck.config,
      );
      if (
        current.healthStatus !== "READY" ||
        current.healthConfigFingerprint !== currentFingerprint
      ) {
        throw new DomainError(
          "PLUGIN_HEALTH_CHECK_STALE",
          "插件配置已发生变化，请重新运行环境检测后再启用",
          409,
        );
      }
    }
    await tx.pluginInstallation.update({
      where: { key: pluginKey },
      data: {
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(parsedConfig === undefined
          ? {}
          : { config: parsedConfig as Prisma.InputJsonValue }),
        ...(parsedSecrets === undefined
          ? {}
          : {
              secretConfigEncrypted: encryptPluginSecretConfig(parsedSecrets),
              enabled: false,
              healthConfigFingerprint: null,
              healthStatus: "UNKNOWN",
              lastCheckedAt: null,
              lastError: null,
            }),
        ...(healthConfigChanged && parsedSecrets === undefined
          ? {
              enabled: false,
              healthConfigFingerprint: null,
              healthStatus: "UNKNOWN",
              lastCheckedAt: null,
              lastError: null,
            }
          : {}),
        updatedById: actor.id,
      },
    });
    if (
      input.enabled === false ||
      parsedSecrets !== undefined ||
      healthConfigChanged
    ) {
      await applyPluginDisableSideEffects(tx, pluginKey);
    }
    if (input.enabled === true) {
      await applyPluginEnableSideEffects(tx, pluginKey);
    }
    await writeAuditLog(tx, actor, {
      action: "PLUGIN_INSTALLATION_UPDATED",
      resourceType: "PluginInstallation",
      resourceId: pluginKey,
      metadata: {
        enabled: input.enabled,
        configChanged: parsedConfig !== undefined,
        healthConfigChanged,
        secretConfigChanged: parsedSecrets !== undefined,
      },
    });
    if (pluginKey === CONTENT_CONTACT_RISK_PLUGIN_KEY) {
      const [users, externalRequests] = await Promise.all([
        tx.user.findMany({
          where: { deletedAt: null },
          select: { id: true },
        }),
        tx.serviceRequest.findMany({
          where: { createdByExternalContactId: { not: null } },
          select: {
            id: true,
            projectId: true,
            project: { select: { customerSpaceId: true } },
          },
        }),
      ]);
      for (const user of users) {
        await publishEvent(tx, {
          type: "PLUGIN_RUN_UPDATED",
          userId: user.id,
          payload: {
            pluginKey,
            change: "PLUGIN_INSTALLATION_UPDATED",
            scope: "GLOBAL",
          },
        });
      }
      for (const request of externalRequests) {
        await publishEvent(tx, {
          type: "PLUGIN_RUN_UPDATED",
          customerSpaceId: request.project.customerSpaceId,
          projectId: request.projectId,
          serviceRequestId: request.id,
          payload: {
            pluginKey,
            change: "PLUGIN_INSTALLATION_UPDATED",
            audience: "EXTERNAL_EMBED",
          },
        });
      }
    } else {
      await publishEvent(tx, {
        type: "PLUGIN_RUN_UPDATED",
        payload: {
          pluginKey,
          change: "PLUGIN_INSTALLATION_UPDATED",
        },
      });
    }
  });
  return getPluginView(actor, pluginKey);
}

export async function runPluginHealthCheck(
  actor: Actor,
  pluginKey: string,
  options?: {
    configOverride?: Record<string, unknown>;
    secretOverride?: Record<string, string>;
  },
) {
  assertAllowed(actor.isPlatformAdmin);
  await ensurePluginInstallations();
  const registered = getRegisteredPlugin(pluginKey);
  const checkedAt = new Date();
  let healthStatus = "READY";
  let lastError: string | null = null;
  let detail: Record<string, string> = {};
  let healthConfigFingerprint: string | null = null;

  const installation = await withActorDb(actor, (tx) =>
    tx.pluginInstallation.findUnique({
      where: { key: pluginKey },
      select: { config: true, secretConfigEncrypted: true, enabled: true },
    }),
  );
  assertFound(installation, "插件未安装");

  const configCandidate =
    options?.configOverride !== undefined
      ? options.configOverride
      : installation.config;
  const configCheck = tryParseRegisteredPluginConfig(pluginKey, configCandidate);
  let secretCandidate: unknown = options?.secretOverride;
  if (secretCandidate === undefined) {
    try {
      secretCandidate = decryptPluginSecretConfig(
        installation.secretConfigEncrypted,
      );
    } catch {
      secretCandidate = null;
    }
  }
  const secretCheck = tryParseRegisteredPluginSecretConfig(
    pluginKey,
    secretCandidate,
  );
  const missingRequiredSecretKeys = registered.manifest.settings
    .filter(
      (field) =>
        (field.type === "secret-url" || field.type === "secret-text") &&
        field.required,
    )
    .map((field) => field.key)
    .filter(
      (key) =>
        !secretCandidate ||
        typeof secretCandidate !== "object" ||
        Array.isArray(secretCandidate) ||
        typeof Reflect.get(secretCandidate, key) !== "string" ||
        Reflect.get(secretCandidate, key).trim().length === 0,
    );
  if (!configCheck.ok) {
    healthStatus = "ERROR";
    lastError = `配置无效：${configCheck.error}`;
    detail = { config: "invalid" };
  } else if (missingRequiredSecretKeys.length > 0) {
    healthStatus = "UNKNOWN";
    lastError = null;
    detail = { configuration: "required" };
  } else if (!secretCheck.ok) {
    healthStatus = "ERROR";
    lastError = `敏感配置无效：${secretCheck.error}`;
    detail = { secretConfig: "invalid" };
  } else {
    try {
      healthConfigFingerprint = fingerprintPluginConfiguration(
        registeredPluginHealthConfig(pluginKey, configCheck.config),
        secretCheck.config,
      );
      detail = registered.healthCheck
        ? await registered.healthCheck({
            config: configCheck.config,
            secrets: secretCheck.config as Record<string, string>,
          })
        : { runtime: "ready" };
    } catch (error) {
      healthStatus = "ERROR";
      healthConfigFingerprint = null;
      lastError =
        error instanceof Error ? error.message : "插件运行环境加载失败";
    }
  }

  await withActorDb(actor, async (tx) => {
    const shouldDisableForInvalidConfig =
      missingRequiredSecretKeys.length > 0 ||
      (healthStatus === "ERROR" && (!configCheck.ok || !secretCheck.ok));
    await tx.pluginInstallation.update({
      where: { key: pluginKey },
      data: {
        // Invalid config must never stay enabled after a health check.
        ...(shouldDisableForInvalidConfig ? { enabled: false } : {}),
        healthConfigFingerprint,
        healthStatus,
        lastCheckedAt: checkedAt,
        lastError,
        updatedById: actor.id,
      },
    });
    if (
      shouldDisableForInvalidConfig ||
      (pluginKey === CONTENT_CONTACT_RISK_PLUGIN_KEY &&
        installation.enabled &&
        healthStatus === "ERROR")
    ) {
      await applyPluginDisableSideEffects(tx, pluginKey);
    }
    if (pluginKey === CONTENT_CONTACT_RISK_PLUGIN_KEY) {
      const currentRuntime = await tx.contentRiskRuntimeState.findUnique({
        where: { pluginKey },
        select: { bypassedAt: true },
      });
      const unsupportedMimeTypes = [
        ["imageCapability", "image/png"],
        ["pdfCapability", "application/pdf"],
        [
          "officeCapability",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ],
        ["animationCapability", "image/gif"],
      ].flatMap(([key, mimeType]) =>
        detail[key]?.startsWith("UNSUPPORTED:") ? [mimeType] : [],
      );
      const capabilityReport = {
        ...detail,
        unsupportedMimeTypes,
        checkedAt: checkedAt.toISOString(),
      } as Prisma.InputJsonValue;
      await tx.contentRiskRuntimeState.upsert({
        where: { pluginKey },
        create: {
          pluginKey,
          activationId: randomUUID(),
          enabledAt: checkedAt,
          capabilityReport,
          bypassedAt:
            healthStatus === "ERROR" && installation.enabled
              ? checkedAt
              : null,
        },
        update: { capabilityReport },
      });
      if (
        healthStatus === "READY" &&
        installation.enabled &&
        (currentRuntime?.bypassedAt || !currentRuntime)
      ) {
        await applyPluginEnableSideEffects(tx, pluginKey);
      }
    }
    await writeAuditLog(tx, actor, {
      action: "PLUGIN_HEALTH_CHECKED",
      resourceType: "PluginInstallation",
      resourceId: pluginKey,
      result: healthStatus === "READY" ? "SUCCESS" : "FAILED",
      metadata: {
        healthStatus,
        detail,
        configValid: configCheck.ok,
        secretConfigValid: secretCheck.ok,
      },
    });
  });
  return {
    healthStatus,
    lastCheckedAt: checkedAt.toISOString(),
    lastError,
    detail,
  };
}

function inspectSecretConfig(pluginKey: string, encrypted: string | null) {
  if (!encrypted) {
    return { keys: [], state: "MISSING" as const };
  }
  try {
    const parsed = tryParseRegisteredPluginSecretConfig(
      pluginKey,
      decryptPluginSecretConfig(encrypted),
    );
    return parsed.ok
      ? { keys: Object.keys(parsed.config).sort(), state: "VALID" as const }
      : { keys: [], state: "INVALID" as const };
  } catch {
    return { keys: [], state: "INVALID" as const };
  }
}

export async function startPluginHistoryRun(
  actor: Actor,
  pluginKey: string,
) {
  assertAllowed(actor.isPlatformAdmin);
  if (pluginKey !== IMAGE_WEBP_PLUGIN_KEY) {
    throw new DomainError(
      "PLUGIN_ACTION_NOT_SUPPORTED",
      "该插件不支持历史迁移",
      409,
    );
  }
  await ensurePluginInstallations();
  const executionToken = randomUUID();
  const run = await withActorDb(actor, async (tx) => {
    await tx.$queryRaw`SELECT "key" FROM "PluginInstallation" WHERE "key" = ${pluginKey} FOR UPDATE`;
    const installation = await tx.pluginInstallation.findUnique({
      where: { key: pluginKey },
    });
    assertFound(installation, "插件未安装");
    if (!installation.enabled) {
      throw new DomainError(
        "PLUGIN_DISABLED",
        "请先启用插件，再迁移历史图片",
        409,
      );
    }
    if (installation.healthStatus !== "READY") {
      throw new DomainError(
        "PLUGIN_NOT_READY",
        "插件版本已更新，请先重新检测运行环境",
        409,
      );
    }
    const activeRun = await tx.pluginRun.findFirst({
      where: {
        pluginKey,
        kind: "HISTORY_MIGRATION",
        status: { in: ["QUEUED", "RUNNING", "PAUSED"] },
      },
      select: { id: true },
    });
    if (activeRun) {
      throw new DomainError(
        "PLUGIN_RUN_ALREADY_ACTIVE",
        "已有历史迁移任务，请继续或取消现有任务",
        409,
      );
    }
    const totalCount = await tx.attachment.count({
      where: { mimeType: { in: ["image/jpeg", "image/png"] } },
    });
    const created = await tx.pluginRun.create({
      data: {
        pluginKey,
        kind: "HISTORY_MIGRATION",
        status: "QUEUED",
        executionToken,
        totalCount,
        requestedById: actor.id,
      },
    });
    await writeAuditLog(tx, actor, {
      action: "PLUGIN_HISTORY_RUN_CREATED",
      resourceType: "PluginRun",
      resourceId: created.id,
      metadata: { pluginKey, totalCount },
    });
    await publishPluginRunEvent(tx, created.id, pluginKey, "QUEUED");
    return created;
  });
  try {
    await queueImageWebpMigrationRun(run.id, executionToken);
  } catch (error) {
    await withActorDb(actor, (tx) =>
      tx.pluginRun.updateMany({
        where: {
          id: run.id,
          executionToken,
          status: { in: ["QUEUED", "RUNNING"] },
        },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          lastError:
            error instanceof Error ? error.message : "任务加入队列失败",
        },
      }),
    );
    throw error;
  }
  return serializeRun(run);
}

export async function controlPluginRun(
  actor: Actor,
  pluginKey: string,
  runId: string,
  action: "pause" | "resume" | "cancel",
) {
  assertAllowed(actor.isPlatformAdmin);
  const nextExecutionToken = action === "resume" ? randomUUID() : null;
  const run = await withActorDb(actor, async (tx) => {
    const current = await tx.pluginRun.findFirst({
      where: { id: runId, pluginKey },
    });
    assertFound(current, "插件任务不存在");
    if (action === "pause") {
      if (!["QUEUED", "RUNNING"].includes(current.status)) {
        throw new DomainError(
          "PLUGIN_RUN_NOT_PAUSABLE",
          "当前任务状态不能暂停",
          409,
        );
      }
      const updated = await tx.pluginRun.updateMany({
        where: {
          id: runId,
          pluginKey,
          status: { in: ["QUEUED", "RUNNING"] },
        },
        data: { status: "PAUSED" },
      });
      if (updated.count !== 1) {
        throw new DomainError(
          "PLUGIN_RUN_NOT_PAUSABLE",
          "任务状态已经变化，请刷新后重试",
          409,
        );
      }
      return tx.pluginRun.findUniqueOrThrow({ where: { id: runId } });
    }
    if (action === "cancel") {
      if (["COMPLETED", "FAILED", "CANCELLED"].includes(current.status)) {
        throw new DomainError(
          "PLUGIN_RUN_NOT_CANCELLABLE",
          "当前任务已经结束",
          409,
        );
      }
      const updated = await tx.pluginRun.updateMany({
        where: {
          id: runId,
          pluginKey,
          status: { notIn: ["COMPLETED", "FAILED", "CANCELLED"] },
        },
        data: {
          status: "CANCELLED",
          completedAt: new Date(),
        },
      });
      if (updated.count !== 1) {
        throw new DomainError(
          "PLUGIN_RUN_NOT_CANCELLABLE",
          "任务状态已经变化，请刷新后重试",
          409,
        );
      }
      return tx.pluginRun.findUniqueOrThrow({ where: { id: runId } });
    }
    if (current.status !== "PAUSED") {
      throw new DomainError(
        "PLUGIN_RUN_NOT_RESUMABLE",
        "只有已暂停任务可以继续",
        409,
      );
    }
    const installation = await tx.pluginInstallation.findUnique({
      where: { key: pluginKey },
      select: { enabled: true, healthStatus: true },
    });
    if (!installation?.enabled) {
      throw new DomainError(
        "PLUGIN_DISABLED",
        "请先启用插件再继续任务",
        409,
      );
    }
    if (installation.healthStatus !== "READY") {
      throw new DomainError(
        "PLUGIN_NOT_READY",
        "插件版本已更新，请先重新检测运行环境",
        409,
      );
    }
    const updated = await tx.pluginRun.updateMany({
      where: {
        id: runId,
        pluginKey,
        status: "PAUSED",
      },
      data: {
        status: "QUEUED",
        executionToken: nextExecutionToken!,
        completedAt: null,
        lastError: null,
      },
    });
    if (updated.count !== 1) {
      throw new DomainError(
        "PLUGIN_RUN_NOT_RESUMABLE",
        "任务状态已经变化，请刷新后重试",
        409,
      );
    }
    return tx.pluginRun.findUniqueOrThrow({ where: { id: runId } });
  });
  if (action === "resume") {
    try {
      await queueImageWebpMigrationRun(run.id, nextExecutionToken!);
    } catch (error) {
      await withActorDb(actor, (tx) =>
        tx.pluginRun.updateMany({
          where: {
            id: run.id,
            executionToken: nextExecutionToken!,
            status: "QUEUED",
          },
          data: {
            status: "PAUSED",
            lastError:
              error instanceof Error ? error.message : "任务加入队列失败",
          },
        }),
      );
      throw error;
    }
  }
  await withActorDb(actor, async (tx) => {
    await writeAuditLog(tx, actor, {
      action: `PLUGIN_RUN_${action.toUpperCase()}`,
      resourceType: "PluginRun",
      resourceId: run.id,
      metadata: { pluginKey },
    });
    await publishPluginRunEvent(tx, run.id, pluginKey, run.status);
  });
  return serializeRun(run);
}

async function getPluginView(actor: Actor, pluginKey: string) {
  const plugins = await listPluginViews(actor);
  const plugin = plugins.find((item) => item.key === pluginKey);
  assertFound(plugin, "插件不存在");
  return plugin;
}

export function serializeRun(run: {
  id: string;
  pluginKey: string;
  kind: string;
  status: PluginRunStatus;
  totalCount: number;
  processedCount: number;
  successCount: number;
  skippedCount: number;
  failedCount: number;
  sourceBytes: bigint;
  outputBytes: bigint;
  savedBytes: bigint;
  cursor: string | null;
  lastError: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: run.id,
    pluginKey: run.pluginKey,
    kind: run.kind,
    status: run.status,
    totalCount: run.totalCount,
    processedCount: run.processedCount,
    successCount: run.successCount,
    skippedCount: run.skippedCount,
    failedCount: run.failedCount,
    sourceBytes: run.sourceBytes.toString(),
    outputBytes: run.outputBytes.toString(),
    savedBytes: run.savedBytes.toString(),
    cursor: run.cursor,
    lastError: run.lastError,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}
