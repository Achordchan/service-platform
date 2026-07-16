import "server-only";

import { createHash } from "node:crypto";
import { parseImageWebpConfig } from "@achord/plugin-image-webp";
import { fileTypeFromBuffer } from "file-type";
import {
  createReplacementStorageKey,
  readPrivateFile,
  removePrivateFile,
  writePrivateFile,
} from "@/modules/attachments/private-storage";
import { withSystemDb } from "@/lib/system-db";
import {
  IMAGE_WEBP_PLUGIN_KEY,
} from "@/modules/plugins/plugin-registry";
import {
  publishPluginRunEvent,
} from "@/modules/plugins/plugin-events";
import {
  publishProjectChange,
  publishRequestChange,
} from "@/modules/notifications/notification-service";

type OptimizationOutcome = {
  status: "COMPLETED" | "SKIPPED" | "FAILED";
  sourceBytes: number;
  outputBytes: number;
  savedBytes: number;
  reason?: string;
};

const systemActor = {
  id: "system",
  name: "系统",
  email: "system@local",
  platformRole: "PLATFORM_ADMIN" as const,
  isPlatformAdmin: true,
  isStaff: true,
};

export async function optimizeAttachmentWithWebp(
  attachmentId: string,
  options?: { source?: "UPLOAD" | "HISTORY" },
): Promise<OptimizationOutcome> {
  const context = await withSystemDb(async (tx) => {
    const installation = await tx.pluginInstallation.findUnique({
      where: { key: IMAGE_WEBP_PLUGIN_KEY },
      select: { enabled: true, config: true },
    });
    if (!installation?.enabled) return null;
    const attachment = await tx.attachment.findUnique({
      where: { id: attachmentId },
      select: {
        id: true,
        storageKey: true,
        mimeType: true,
        size: true,
        customerSpaceId: true,
        projectId: true,
        serviceRequestId: true,
      },
    });
    if (!attachment) return null;
    return {
      attachment,
      config: parseImageWebpConfig(installation.config),
    };
  });
  if (!context) {
    return zeroOutcome("SKIPPED", "PLUGIN_DISABLED_OR_ATTACHMENT_MISSING");
  }

  const { attachment, config } = context;
  const fingerprint = createHash("sha256")
    .update(
      `${attachment.storageKey}:${attachment.size}:${attachment.mimeType}`,
    )
    .digest("hex");
  const existingState = await withSystemDb((tx) =>
    tx.pluginResourceState.findUnique({
      where: {
        pluginKey_resourceType_resourceId: {
          pluginKey: IMAGE_WEBP_PLUGIN_KEY,
          resourceType: "ATTACHMENT",
          resourceId: attachment.id,
        },
      },
    }),
  );
  if (
    existingState &&
    (existingState.inputFingerprint === fingerprint ||
      (existingState.status === "COMPLETED" &&
        readOutcomeMetadata(existingState.metadata).outputFingerprint ===
          fingerprint)) &&
    (existingState.status === "COMPLETED" ||
      existingState.status === "SKIPPED")
  ) {
    const metadata = readOutcomeMetadata(existingState.metadata);
    return {
      status: existingState.status,
      sourceBytes: metadata.sourceBytes,
      outputBytes: metadata.outputBytes,
      savedBytes: metadata.savedBytes,
      reason: metadata.reason,
    };
  }

  await setResourceState({
    attachmentId: attachment.id,
    fingerprint,
    status: "PROCESSING",
  });

  if (!["image/jpeg", "image/png"].includes(attachment.mimeType)) {
    return finishSkipped(
      attachment.id,
      fingerprint,
      attachment.size,
      "UNSUPPORTED_MIME_TYPE",
    );
  }

  let replacementStorageKey: string | null = null;
  try {
    const sourceBuffer = new Uint8Array(
      await readPrivateFile(attachment.storageKey),
    );
    const detectedType = await fileTypeFromBuffer(sourceBuffer);
    if (!detectedType || detectedType.mime !== attachment.mimeType) {
      throw new Error("IMAGE_SIGNATURE_MISMATCH");
    }
    const { optimizeImageToWebp } = await import(
      "@achord/plugin-image-webp/runtime"
    );
    const transformed = await optimizeImageToWebp({
      buffer: sourceBuffer,
      mimeType: attachment.mimeType,
      config,
    });
    if (transformed.status === "SKIPPED") {
      return finishSkipped(
        attachment.id,
        fingerprint,
        attachment.size,
        transformed.reason,
      );
    }

    const minimumOutputSize =
      attachment.size * (1 - config.minimumSavingsPercent / 100);
    if (transformed.buffer.byteLength > minimumOutputSize) {
      return finishSkipped(
        attachment.id,
        fingerprint,
        attachment.size,
        "SAVINGS_BELOW_THRESHOLD",
      );
    }

    replacementStorageKey = createReplacementStorageKey(
      attachment.storageKey,
      transformed.extension,
    );
    await writePrivateFile(replacementStorageKey, transformed.buffer);
    const outcome = {
      status: "COMPLETED" as const,
      sourceBytes: attachment.size,
      outputBytes: transformed.buffer.byteLength,
      savedBytes: attachment.size - transformed.buffer.byteLength,
      outputFingerprint: createHash("sha256")
        .update(
          `${replacementStorageKey}:${transformed.buffer.byteLength}:${transformed.mimeType}`,
        )
        .digest("hex"),
    };
    const swapped = await withSystemDb(async (tx) => {
      const updated = await tx.attachment.updateMany({
        where: {
          id: attachment.id,
          storageKey: attachment.storageKey,
          mimeType: attachment.mimeType,
          size: attachment.size,
        },
        data: {
          storageKey: replacementStorageKey!,
          mimeType: transformed.mimeType,
          size: transformed.buffer.byteLength,
        },
      });
      if (updated.count !== 1) return false;
      await tx.pluginResourceState.upsert({
        where: {
          pluginKey_resourceType_resourceId: {
            pluginKey: IMAGE_WEBP_PLUGIN_KEY,
            resourceType: "ATTACHMENT",
            resourceId: attachment.id,
          },
        },
        create: {
          pluginKey: IMAGE_WEBP_PLUGIN_KEY,
          resourceType: "ATTACHMENT",
          resourceId: attachment.id,
          status: "COMPLETED",
          inputFingerprint: fingerprint,
          metadata: outcome,
          processedAt: new Date(),
        },
        update: {
          status: "COMPLETED",
          inputFingerprint: fingerprint,
          metadata: outcome,
          lastError: null,
          processedAt: new Date(),
        },
      });
      if (options?.source === "UPLOAD") {
        if (attachment.serviceRequestId && attachment.projectId) {
          await publishRequestChange(tx, systemActor, {
            change: "ATTACHMENT_OPTIMIZED",
            customerSpaceId: attachment.customerSpaceId,
            projectId: attachment.projectId,
            serviceRequestId: attachment.serviceRequestId,
            payload: { attachmentId: attachment.id },
          });
        } else if (attachment.projectId) {
          await publishProjectChange(tx, systemActor, {
            change: "ATTACHMENT_OPTIMIZED",
            customerSpaceId: attachment.customerSpaceId,
            projectId: attachment.projectId,
            payload: { attachmentId: attachment.id },
          });
        }
      }
      return true;
    });
    if (!swapped) {
      await removePrivateFile(replacementStorageKey);
      const concurrentOutcome = await readStoredOutcome(
        attachment.id,
        fingerprint,
      );
      if (concurrentOutcome) return concurrentOutcome;
      return finishSkippedIfProcessing(
        attachment.id,
        fingerprint,
        attachment.size,
        "ATTACHMENT_CHANGED",
      );
    }
    await removePrivateFile(attachment.storageKey).catch((error) => {
      console.error("PLUGIN_OLD_ATTACHMENT_FILE_DELETE_FAILED", {
        attachmentId: attachment.id,
        storageKey: attachment.storageKey,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return outcome;
  } catch (error) {
    if (replacementStorageKey) {
      await removePrivateFile(replacementStorageKey).catch(() => undefined);
    }
    const message =
      error instanceof Error ? error.message : "图片转换失败";
    await setResourceState({
      attachmentId: attachment.id,
      fingerprint,
      status: "FAILED",
      lastError: message,
      metadata: {
        sourceBytes: attachment.size,
        outputBytes: attachment.size,
        savedBytes: 0,
        reason: message,
      },
    });
    return {
      status: "FAILED",
      sourceBytes: attachment.size,
      outputBytes: attachment.size,
      savedBytes: 0,
      reason: message,
    };
  }
}

export async function processImageWebpMigrationBatch(
  runId: string,
  executionToken: string,
) {
  const run = await withSystemDb(async (tx) => {
    const current = await tx.pluginRun.findUnique({ where: { id: runId } });
    if (
      !current ||
      current.pluginKey !== IMAGE_WEBP_PLUGIN_KEY ||
      current.executionToken !== executionToken ||
      ["PAUSED", "CANCELLED", "COMPLETED", "FAILED"].includes(current.status)
    ) {
      return null;
    }
    const installation = await tx.pluginInstallation.findUnique({
      where: { key: IMAGE_WEBP_PLUGIN_KEY },
      select: { enabled: true },
    });
    if (!installation?.enabled) {
      const paused = await tx.pluginRun.updateMany({
        where: {
          id: runId,
          executionToken,
          status: { in: ["QUEUED", "RUNNING"] },
        },
        data: { status: "PAUSED" },
      });
      if (paused.count === 1) {
        await publishPluginRunEvent(
          tx,
          runId,
          IMAGE_WEBP_PLUGIN_KEY,
          "PAUSED",
        );
      }
      return null;
    }
    const claimed = await tx.pluginRun.updateMany({
      where: {
        id: runId,
        executionToken,
        status: "QUEUED",
      },
      data: {
        status: "RUNNING",
        startedAt: current.startedAt ?? new Date(),
      },
    });
    if (claimed.count !== 1) return null;
    return tx.pluginRun.findUniqueOrThrow({ where: { id: runId } });
  });
  if (!run) return false;

  const attachments = await withSystemDb((tx) =>
    tx.attachment.findMany({
      where: {
        mimeType: { in: ["image/jpeg", "image/png"] },
        ...(run.cursor ? { id: { gt: run.cursor } } : {}),
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: 20,
    }),
  );
  if (attachments.length === 0) {
    await completeRun(runId, executionToken);
    return false;
  }

  for (const attachment of attachments) {
    const active = await withSystemDb((tx) =>
      tx.pluginRun.findUnique({
        where: { id: runId },
        select: { status: true, executionToken: true },
      }),
    );
    if (
      !active ||
      active.status !== "RUNNING" ||
      active.executionToken !== executionToken
    ) {
      return false;
    }

    const outcome = await optimizeAttachmentWithWebp(attachment.id, {
      source: "HISTORY",
    });
    const shouldContinue = await withSystemDb(async (tx) => {
      const current = await tx.pluginRun.findUnique({
        where: { id: runId },
        select: { status: true, executionToken: true },
      });
      if (
        !current ||
        current.executionToken !== executionToken ||
        !["RUNNING", "PAUSED", "CANCELLED"].includes(current.status)
      ) {
        return false;
      }
      await tx.pluginRun.update({
        where: { id: runId },
        data: {
          cursor: attachment.id,
          processedCount: { increment: 1 },
          successCount: {
            increment: outcome.status === "COMPLETED" ? 1 : 0,
          },
          skippedCount: {
            increment: outcome.status === "SKIPPED" ? 1 : 0,
          },
          failedCount: {
            increment: outcome.status === "FAILED" ? 1 : 0,
          },
          sourceBytes: { increment: BigInt(outcome.sourceBytes) },
          outputBytes: { increment: BigInt(outcome.outputBytes) },
          savedBytes: { increment: BigInt(outcome.savedBytes) },
          lastError:
            outcome.status === "FAILED" ? outcome.reason ?? null : undefined,
        },
      });
      await publishPluginRunEvent(
        tx,
        runId,
        IMAGE_WEBP_PLUGIN_KEY,
        current.status,
      );
      return current.status === "RUNNING";
    });
    if (!shouldContinue) return false;
    await delay(250);
  }

  const hasMore = await withSystemDb((tx) =>
    tx.attachment.findFirst({
      where: {
        mimeType: { in: ["image/jpeg", "image/png"] },
        id: { gt: attachments.at(-1)!.id },
      },
      select: { id: true },
    }),
  );
  if (!hasMore) {
    await completeRun(runId, executionToken);
    return false;
  }
  return withSystemDb(async (tx) => {
    const released = await tx.pluginRun.updateMany({
      where: {
        id: runId,
        executionToken,
        status: "RUNNING",
      },
      data: { status: "QUEUED" },
    });
    return released.count === 1;
  });
}

export async function releaseImageWebpMigrationRun(
  runId: string,
  executionToken: string,
  error: unknown,
) {
  await withSystemDb(async (tx) => {
    const released = await tx.pluginRun.updateMany({
      where: {
        id: runId,
        executionToken,
        status: "RUNNING",
      },
      data: {
        status: "QUEUED",
        lastError:
          error instanceof Error ? error.message : "图片迁移批次执行失败",
      },
    });
    if (released.count === 1) {
      await publishPluginRunEvent(
        tx,
        runId,
        IMAGE_WEBP_PLUGIN_KEY,
        "QUEUED",
      );
    }
  });
}

async function completeRun(runId: string, executionToken: string) {
  await withSystemDb(async (tx) => {
    const updated = await tx.pluginRun.updateMany({
      where: {
        id: runId,
        executionToken,
        status: "RUNNING",
      },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });
    if (updated.count === 1) {
      await publishPluginRunEvent(
        tx,
        runId,
        IMAGE_WEBP_PLUGIN_KEY,
        "COMPLETED",
      );
    }
  });
}

async function finishSkipped(
  attachmentId: string,
  fingerprint: string,
  sourceBytes: number,
  reason: string,
): Promise<OptimizationOutcome> {
  const outcome = {
    status: "SKIPPED" as const,
    sourceBytes,
    outputBytes: sourceBytes,
    savedBytes: 0,
    reason,
  };
  await setResourceState({
    attachmentId,
    fingerprint,
    status: "SKIPPED",
    metadata: outcome,
  });
  return outcome;
}

async function finishSkippedIfProcessing(
  attachmentId: string,
  fingerprint: string,
  sourceBytes: number,
  reason: string,
): Promise<OptimizationOutcome> {
  const outcome = {
    status: "SKIPPED" as const,
    sourceBytes,
    outputBytes: sourceBytes,
    savedBytes: 0,
    reason,
  };
  await withSystemDb((tx) =>
    tx.pluginResourceState.updateMany({
      where: {
        pluginKey: IMAGE_WEBP_PLUGIN_KEY,
        resourceType: "ATTACHMENT",
        resourceId: attachmentId,
        inputFingerprint: fingerprint,
        status: "PROCESSING",
      },
      data: {
        status: "SKIPPED",
        metadata: outcome,
        lastError: null,
        processedAt: new Date(),
      },
    }),
  );
  return outcome;
}

async function readStoredOutcome(
  attachmentId: string,
  fingerprint: string,
): Promise<OptimizationOutcome | null> {
  const state = await withSystemDb((tx) =>
    tx.pluginResourceState.findUnique({
      where: {
        pluginKey_resourceType_resourceId: {
          pluginKey: IMAGE_WEBP_PLUGIN_KEY,
          resourceType: "ATTACHMENT",
          resourceId: attachmentId,
        },
      },
    }),
  );
  if (!state || state.inputFingerprint !== fingerprint) {
    return null;
  }
  if (
    state.status !== "COMPLETED" &&
    state.status !== "SKIPPED" &&
    state.status !== "FAILED"
  ) {
    return null;
  }
  const metadata = readOutcomeMetadata(state.metadata);
  return {
    status: state.status,
    sourceBytes: metadata.sourceBytes,
    outputBytes: metadata.outputBytes,
    savedBytes: metadata.savedBytes,
    reason: metadata.reason,
  };
}

function setResourceState(input: {
  attachmentId: string;
  fingerprint: string;
  status: "PROCESSING" | "COMPLETED" | "SKIPPED" | "FAILED";
  metadata?: Record<string, string | number>;
  lastError?: string;
}) {
  return withSystemDb((tx) =>
    tx.pluginResourceState.upsert({
      where: {
        pluginKey_resourceType_resourceId: {
          pluginKey: IMAGE_WEBP_PLUGIN_KEY,
          resourceType: "ATTACHMENT",
          resourceId: input.attachmentId,
        },
      },
      create: {
        pluginKey: IMAGE_WEBP_PLUGIN_KEY,
        resourceType: "ATTACHMENT",
        resourceId: input.attachmentId,
        status: input.status,
        inputFingerprint: input.fingerprint,
        metadata: input.metadata,
        lastError: input.lastError,
        processedAt:
          input.status === "PROCESSING" ? undefined : new Date(),
      },
      update: {
        status: input.status,
        inputFingerprint: input.fingerprint,
        metadata: input.metadata,
        lastError: input.lastError ?? null,
        processedAt:
          input.status === "PROCESSING" ? null : new Date(),
      },
    }),
  );
}

function readOutcomeMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      sourceBytes: 0,
      outputBytes: 0,
      savedBytes: 0,
      reason: undefined,
      outputFingerprint: undefined,
    };
  }
  const metadata = value as Record<string, unknown>;
  return {
    sourceBytes:
      typeof metadata.sourceBytes === "number" ? metadata.sourceBytes : 0,
    outputBytes:
      typeof metadata.outputBytes === "number" ? metadata.outputBytes : 0,
    savedBytes:
      typeof metadata.savedBytes === "number" ? metadata.savedBytes : 0,
    reason: typeof metadata.reason === "string" ? metadata.reason : undefined,
    outputFingerprint:
      typeof metadata.outputFingerprint === "string"
        ? metadata.outputFingerprint
        : undefined,
  };
}

function zeroOutcome(
  status: OptimizationOutcome["status"],
  reason: string,
): OptimizationOutcome {
  return {
    status,
    sourceBytes: 0,
    outputBytes: 0,
    savedBytes: 0,
    reason,
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
