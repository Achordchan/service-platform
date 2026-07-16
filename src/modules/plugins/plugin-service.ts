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
import { ensurePluginInstallations } from "@/modules/plugins/plugin-installation-service";
import {
  getRegisteredPlugin,
  IMAGE_WEBP_PLUGIN_KEY,
  listRegisteredPlugins,
} from "@/modules/plugins/plugin-registry";
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
    return [
      {
        ...manifest,
        enabled: installation.enabled,
        config: installation.config as Record<string, unknown>,
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
  },
) {
  assertAllowed(actor.isPlatformAdmin);
  await ensurePluginInstallations();
  const registered = getRegisteredPlugin(pluginKey);
  const parsedConfig =
    input.config === undefined
      ? undefined
      : registered.parseConfig(input.config);

  if (input.enabled === true) {
    const health = await runPluginHealthCheck(actor, pluginKey);
    if (health.healthStatus !== "READY") {
      throw new DomainError(
        "PLUGIN_NOT_READY",
        health.lastError || "插件环境检测未通过",
        409,
      );
    }
  }

  await withActorDb(actor, async (tx) => {
    const current = await tx.pluginInstallation.findUnique({
      where: { key: pluginKey },
    });
    assertFound(current, "插件未安装");
    await tx.pluginInstallation.update({
      where: { key: pluginKey },
      data: {
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(parsedConfig === undefined
          ? {}
          : { config: parsedConfig as Prisma.InputJsonValue }),
        updatedById: actor.id,
      },
    });
    if (input.enabled === false) {
      await tx.pluginRun.updateMany({
        where: {
          pluginKey,
          status: { in: ["QUEUED", "RUNNING"] },
        },
        data: { status: "PAUSED" },
      });
    }
    await writeAuditLog(tx, actor, {
      action: "PLUGIN_INSTALLATION_UPDATED",
      resourceType: "PluginInstallation",
      resourceId: pluginKey,
      metadata: {
        enabled: input.enabled,
        configChanged: parsedConfig !== undefined,
      },
    });
    await publishEvent(tx, {
      type: "PLUGIN_RUN_UPDATED",
      payload: {
        pluginKey,
        change: "PLUGIN_INSTALLATION_UPDATED",
      },
    });
  });
  return getPluginView(actor, pluginKey);
}

export async function runPluginHealthCheck(
  actor: Actor,
  pluginKey: string,
) {
  assertAllowed(actor.isPlatformAdmin);
  await ensurePluginInstallations();
  getRegisteredPlugin(pluginKey);
  const checkedAt = new Date();
  let healthStatus = "READY";
  let lastError: string | null = null;
  let detail: Record<string, string> = {};
  try {
    if (pluginKey === IMAGE_WEBP_PLUGIN_KEY) {
      const { getImageWebpRuntimeHealth } = await import(
        "@achord/plugin-image-webp/runtime"
      );
      detail = getImageWebpRuntimeHealth();
    }
  } catch (error) {
    healthStatus = "ERROR";
    lastError =
      error instanceof Error ? error.message : "插件运行环境加载失败";
  }

  await withActorDb(actor, async (tx) => {
    await tx.pluginInstallation.update({
      where: { key: pluginKey },
      data: {
        healthStatus,
        lastCheckedAt: checkedAt,
        lastError,
        updatedById: actor.id,
      },
    });
    await writeAuditLog(tx, actor, {
      action: "PLUGIN_HEALTH_CHECKED",
      resourceType: "PluginInstallation",
      resourceId: pluginKey,
      result: healthStatus === "READY" ? "SUCCESS" : "FAILED",
      metadata: {
        healthStatus,
        detail,
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
