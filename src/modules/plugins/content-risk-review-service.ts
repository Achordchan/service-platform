import "server-only";

import {
  CONTENT_CONTACT_RISK_PLUGIN_KEY,
} from "@achord/plugin-content-contact-risk";
import {
  parseContentContactRiskConfig,
  parseContentContactRiskSecrets,
} from "@achord/plugin-content-contact-risk/config";
import {
  ContentRiskProviderError,
  inspectContentRisk,
  type ContentRiskAttachmentInput,
  type ContentRiskModelDecision,
} from "@achord/plugin-content-contact-risk/runtime";
import type {
  ContentRiskReview,
  ContentRiskTargetType,
  Prisma,
} from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { decryptSecret } from "@/lib/secret-crypto";
import { withSystemDb } from "@/lib/system-db";
import {
  readPrivateFile,
  removePrivateFile,
} from "@/modules/attachments/private-storage";
import {
  publishEvent,
} from "@/modules/notifications/notification-service";
import {
  applyPluginDisableSideEffects,
} from "@/modules/plugins/plugin-installation-service";
import {
  decryptPluginSecretConfig,
} from "@/modules/plugins/plugin-secret-config";
import {
  cancelSupersededContentRiskReview,
  encryptSnapshot,
  notifyPlatformAdmins,
  type ContentRiskSnapshot,
} from "@/modules/plugins/content-risk-service";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { DomainError } from "@/modules/projects/errors";

const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000];
const MAX_ATTEMPTS = 5;
const PROCESSING_STALE_MS = 20 * 60_000;
const MAX_SINGLE_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 40 * 1024 * 1024;

export async function revokeRequestMessageByAdmin(
  actor: Actor,
  requestId: string,
  messageId: string,
  reasonInput: string,
) {
  if (!actor.isPlatformAdmin) {
    throw new DomainError("FORBIDDEN", "仅平台管理员可撤回消息", 403);
  }
  const reason = reasonInput.trim();
  if (reason.length < 2 || reason.length > 200) {
    throw new DomainError(
      "INVALID_REVOKE_REASON",
      "请填写 2–200 个字符的撤回原因",
      422,
    );
  }

  return withActorDb(actor, async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${`REQUEST_MESSAGE:${messageId}`})
      )
    `;
    const message = await tx.requestMessage.findFirst({
      where: {
        id: messageId,
        serviceRequestId: requestId,
        isSystem: false,
        isInitial: false,
        visibility: "CUSTOMER_VISIBLE",
      },
      select: {
        id: true,
        body: true,
        authorId: true,
        externalAuthorId: true,
        author: { select: { name: true } },
        externalAuthor: { select: { displayName: true } },
        attachments: { select: { id: true } },
        serviceRequest: {
          select: {
            id: true,
            projectId: true,
            project: { select: { customerSpaceId: true } },
          },
        },
      },
    });
    if (!message) {
      throw new DomainError(
        "REQUEST_MESSAGE_NOT_FOUND",
        "消息不存在、不可撤回或无权访问",
        404,
      );
    }

    const existingState = await tx.contentRiskState.findUnique({
      where: {
        targetType_targetId: {
          targetType: "REQUEST_MESSAGE",
          targetId: message.id,
        },
      },
    });
    if (existingState?.displayState === "REVOKED") {
      throw new DomainError(
        "REQUEST_MESSAGE_ALREADY_REVOKED",
        "该消息已经被系统撤回",
        409,
      );
    }
    if (existingState?.latestReviewId) {
      await tx.contentRiskReview.updateMany({
        where: {
          id: existingState.latestReviewId,
          status: { in: ["QUEUED", "PROCESSING"] },
        },
        data: {
          status: "CANCELLED",
          completedAt: new Date(),
          nextAttemptAt: null,
          lastError: "平台管理员已人工撤回消息",
        },
      });
      await cancelHeldDeliveries(tx, existingState.latestReviewId);
    }

    const now = new Date();
    const revision = (existingState?.revision ?? 0) + 1;
    const snapshot: ContentRiskSnapshot = {
      body: message.body,
      visibility: "CUSTOMER_VISIBLE",
      attachmentIds: message.attachments.map((attachment) => attachment.id),
    };
    const review = await tx.contentRiskReview.create({
      data: {
        activationId: "manual",
        targetType: "REQUEST_MESSAGE",
        targetId: message.id,
        revision,
        actorId: message.authorId ?? message.externalAuthorId,
        actorName:
          message.author?.name ??
          message.externalAuthor?.displayName ??
          "原作者已不可用",
        customerSpaceId: message.serviceRequest.project.customerSpaceId,
        projectId: message.serviceRequest.projectId,
        serviceRequestId: message.serviceRequest.id,
        source: "ADMIN",
        status: "VIOLATION",
        decision: "VIOLATION",
        decisionReason: reason,
        riskCategories: ["ADMIN_REVOKED"],
        contentSnapshotEncrypted: encryptSnapshot(snapshot),
        previousSnapshotEncrypted:
          existingState?.lastApprovedSnapshotEncrypted ??
          encryptSnapshot(snapshot),
        completedAt: now,
        revokedAt: now,
      },
    });
    await tx.contentRiskState.upsert({
      where: {
        targetType_targetId: {
          targetType: "REQUEST_MESSAGE",
          targetId: message.id,
        },
      },
      create: {
        targetType: "REQUEST_MESSAGE",
        targetId: message.id,
        revision,
        approvedRevision: 0,
        displayState: "REVOKED",
        latestReviewId: review.id,
        lastApprovedSnapshotEncrypted: encryptSnapshot(snapshot),
        revokedAt: now,
      },
      update: {
        revision,
        displayState: "REVOKED",
        latestReviewId: review.id,
        revokedAt: now,
        restoredAt: null,
      },
    });
    await cancelRequestMessageDeliveriesForManualRevoke(
      tx,
      message.id,
      now,
    );
    await writeAuditLog(tx, actor, {
      action: "REQUEST_MESSAGE_REVOKED",
      resourceType: "RequestMessage",
      resourceId: message.id,
      customerSpaceId: message.serviceRequest.project.customerSpaceId,
      projectId: message.serviceRequest.projectId,
      serviceRequestId: message.serviceRequest.id,
      metadata: { reason, reviewId: review.id },
    });
    await publishEvent(tx, {
      type: "CONTENT_RISK_REVIEW_UPDATED",
      customerSpaceId: message.serviceRequest.project.customerSpaceId,
      projectId: message.serviceRequest.projectId,
      serviceRequestId: message.serviceRequest.id,
      payload: {
        reviewId: review.id,
        targetType: "REQUEST_MESSAGE",
        targetId: message.id,
        status: "VIOLATION",
        source: "ADMIN",
      },
    });
    return { revoked: true as const, reviewId: review.id, reason };
  });
}

async function cancelRequestMessageDeliveriesForManualRevoke(
  tx: Prisma.TransactionClient,
  messageId: string,
  revokedAt: Date,
) {
  const notifications = await tx.notification.findMany({
    where: {
      sourceType: "REQUEST_MESSAGE",
      sourceId: messageId,
    },
    select: { id: true },
  });
  const notificationIds = notifications.map((notification) => notification.id);
  if (notificationIds.length > 0) {
    await tx.notification.updateMany({
      where: { id: { in: notificationIds } },
      data: {
        readAt: revokedAt,
        body: "相关内容已被系统撤回",
        aggregationKey: null,
        emailDueAt: null,
        emailClaimedAt: null,
        contentRiskReviewId: null,
        contentRiskEmailDueAt: null,
        contentRiskReadAtBeforeSuppression: null,
        contentRiskBodyBeforeSuppression: null,
        contentRiskSuppressed: false,
        updatedAt: revokedAt,
      },
    });
  }
  await tx.mailMessage.updateMany({
    where: {
      status: { in: ["QUEUED", "PROCESSING"] },
      OR: [
        ...(notificationIds.length > 0
          ? [{ notificationId: { in: notificationIds } }]
          : []),
        { sourceType: "REQUEST_MESSAGE", sourceId: messageId },
      ],
    },
    data: {
      status: "CANCELLED",
      contentRiskReviewId: null,
      lastAttemptAt: null,
      errorMessage: "消息已由平台管理员撤回",
    },
  });
  await tx.dingTalkRobotDelivery.updateMany({
    where: {
      eventKey: `customer-replied:${messageId}`,
      status: { in: ["PENDING", "HELD", "PROCESSING"] },
    },
    data: {
      status: "SKIPPED",
      nextAttemptAt: null,
      lastError: "消息已由平台管理员撤回",
    },
  });
}

export async function listDueContentRiskReviews() {
  const staleExhausted = await withSystemDb(async (tx) => {
    const staleBefore = new Date(Date.now() - PROCESSING_STALE_MS);
    await tx.contentRiskReview.updateMany({
      where: {
        status: "PROCESSING",
        attemptCount: { lt: MAX_ATTEMPTS },
        lastAttemptAt: { lt: staleBefore },
      },
      data: {
        status: "QUEUED",
        nextAttemptAt: new Date(),
        lastError: "上次模型检测进程中断，已重新排队",
      },
    });
    return tx.contentRiskReview.findFirst({
      where: {
        status: "PROCESSING",
        attemptCount: { gte: MAX_ATTEMPTS },
        lastAttemptAt: { lt: staleBefore },
      },
      orderBy: { lastAttemptAt: "asc" },
    });
  });
  if (staleExhausted) {
    await bypassPluginAfterFailure(
      staleExhausted,
      "第5次模型检测进程中断且未返回结果",
    );
  }
  return withSystemDb((tx) =>
    tx.contentRiskReview.findMany({
      where: {
        status: "QUEUED",
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      select: { id: true },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
      take: 100,
    }),
  );
}

export async function processContentRiskReview(reviewId: string) {
  const attemptAt = new Date();
  const claimed = await withSystemDb(async (tx) => {
    const updated = await tx.contentRiskReview.updateMany({
      where: {
        id: reviewId,
        status: "QUEUED",
        attemptCount: { lt: MAX_ATTEMPTS },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: attemptAt } }],
      },
      data: {
        status: "PROCESSING",
        attemptCount: { increment: 1 },
        lastAttemptAt: attemptAt,
        nextAttemptAt: null,
        lastError: null,
      },
    });
    if (updated.count === 0) return null;
    return tx.contentRiskReview.findUnique({ where: { id: reviewId } });
  });
  if (!claimed) return { skipped: true };

  try {
    const context = await loadReviewContext(claimed);
    if (!context) {
      await cancelStaleReview(claimed.id, "插件已停用、异常或审核批次已变更");
      return { skipped: true };
    }
    const snapshot = decryptSnapshot(claimed.contentSnapshotEncrypted);
    const loadedAttachments = await loadReviewAttachments(
      snapshot.attachmentIds ?? [],
    );
    if (loadedAttachments.skipped.length > 0) {
      await recordUnsupportedAttachments(claimed, loadedAttachments.skipped);
    }
    const attachments = loadedAttachments.attachments;
    const inspectionText = [
      snapshotText(snapshot),
      ...loadedAttachments.skipped.map(
        (attachment) =>
          `未读取附件，仅检查文件名：${attachment.fileName} (${attachment.mimeType})`,
      ),
    ]
      .filter(Boolean)
      .join("\n");
    let inspection: Awaited<ReturnType<typeof inspectContentRisk>>;
    try {
      inspection = await inspectWithTimeout(
        context.config,
        context.secrets,
        { text: inspectionText, attachments },
      );
    } catch (error) {
      if (
        attachments.length > 0 &&
        isUnsupportedAttachmentProviderError(error)
      ) {
        inspection = await inspectAttachmentsAfterBatchRejection(
          claimed,
          context.config,
          context.secrets,
          inspectionText,
          attachments,
        );
      } else {
        throw error;
      }
    }
    await applyDecision(claimed, snapshot, inspection.result, inspection.providerRequestId);
    return { decision: inspection.result.decision };
  } catch (error) {
    return handleReviewFailure(claimed, error);
  }
}

function isUnsupportedAttachmentProviderError(error: unknown) {
  return (
    error instanceof ContentRiskProviderError &&
    (error.status === 400 ||
      error.status === 413 ||
      error.status === 415 ||
      error.status === 422)
  );
}

async function inspectAttachmentsAfterBatchRejection(
  review: ContentRiskReview,
  config: ReturnType<typeof parseContentContactRiskConfig>,
  secrets: ReturnType<typeof parseContentContactRiskSecrets>,
  text: string,
  attachments: ContentRiskAttachmentInput[],
) {
  const inspections = [
    await inspectWithTimeout(config, secrets, { text, attachments: [] }),
  ];
  const attachmentResults = await Promise.all(
    attachments.map(async (attachment) => {
      try {
        return {
          inspection: await inspectWithTimeout(config, secrets, {
            text: `请结合文件名和附件内容检测：${attachment.fileName}`,
            attachments: [attachment],
          }),
          unsupported: null,
        };
      } catch (error) {
        if (!isUnsupportedAttachmentProviderError(error)) throw error;
        return { inspection: null, unsupported: attachment };
      }
    }),
  );
  inspections.push(
    ...attachmentResults.flatMap((result) =>
      result.inspection ? [result.inspection] : [],
    ),
  );
  const unsupported = attachmentResults.flatMap((result) =>
    result.unsupported ? [result.unsupported] : [],
  );
  if (unsupported.length > 0) {
    await recordUnsupportedAttachments(review, unsupported);
  }
  const severity = { ALLOW: 0, UNCERTAIN: 1, VIOLATION: 2 } as const;
  const strongest = inspections.reduce((current, candidate) =>
    severity[candidate.result.decision] > severity[current.result.decision]
      ? candidate
      : current,
  );
  return {
    result: {
      decision: strongest.result.decision,
      categories: [
        ...new Set(inspections.flatMap((item) => item.result.categories)),
      ],
      reason: inspections
        .map((item) => item.result.reason.trim())
        .filter(Boolean)
        .join("；")
        .slice(0, 500),
    },
    providerRequestId:
      inspections.find((item) => item.providerRequestId)?.providerRequestId ??
      null,
  };
}

async function loadReviewContext(review: ContentRiskReview) {
  return withSystemDb(async (tx) => {
    const [installation, runtime] = await Promise.all([
      tx.pluginInstallation.findUnique({
        where: { key: CONTENT_CONTACT_RISK_PLUGIN_KEY },
      }),
      tx.contentRiskRuntimeState.findUnique({
        where: { pluginKey: CONTENT_CONTACT_RISK_PLUGIN_KEY },
      }),
    ]);
    if (
      !installation?.enabled ||
      installation.healthStatus !== "READY" ||
      !runtime ||
      runtime.bypassedAt ||
      runtime.activationId !== review.activationId ||
      !installation.secretConfigEncrypted
    ) {
      return null;
    }
    return {
      config: parseContentContactRiskConfig(installation.config),
      secrets: parseContentContactRiskSecrets(
        decryptPluginSecretConfig(installation.secretConfigEncrypted),
      ),
    };
  });
}

async function inspectWithTimeout(
  config: ReturnType<typeof parseContentContactRiskConfig>,
  secrets: ReturnType<typeof parseContentContactRiskSecrets>,
  input: Parameters<typeof inspectContentRisk>[2],
) {
  const containsDocument = input.attachments?.some(
    (item) => !item.mimeType.startsWith("image/") && !item.mimeType.startsWith("text/"),
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), containsDocument ? 180_000 : 60_000);
  try {
    return await inspectContentRisk(config, secrets, input, {
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function loadReviewAttachments(ids: string[]) {
  if (ids.length === 0) {
    return {
      attachments: [] as ContentRiskAttachmentInput[],
      skipped: [] as ContentRiskAttachmentInput[],
    };
  }
  const rows = await withSystemDb((tx) =>
    tx.attachment.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        size: true,
        storageKey: true,
      },
    }),
  );
  const attachments: ContentRiskAttachmentInput[] = [];
  const skipped: ContentRiskAttachmentInput[] = [];
  let loadedBytes = 0;
  for (const row of rows) {
    if (
      row.size > MAX_SINGLE_ATTACHMENT_BYTES ||
      loadedBytes + row.size > MAX_TOTAL_ATTACHMENT_BYTES
    ) {
      skipped.push({
        fileName: row.originalName,
        mimeType: row.mimeType,
        data: new Uint8Array(),
      });
      continue;
    }
    try {
      attachments.push({
        fileName: row.originalName,
        mimeType: row.mimeType,
        data: await readPrivateFile(row.storageKey),
      });
      loadedBytes += row.size;
    } catch {
      const latest = await withSystemDb((tx) =>
        tx.attachment.findUnique({
          where: { id: row.id },
          select: {
            originalName: true,
            mimeType: true,
            size: true,
            storageKey: true,
          },
        }),
      );
      if (
        latest &&
        latest.storageKey !== row.storageKey &&
        latest.size <= MAX_SINGLE_ATTACHMENT_BYTES &&
        loadedBytes + latest.size <= MAX_TOTAL_ATTACHMENT_BYTES
      ) {
        try {
          attachments.push({
            fileName: latest.originalName,
            mimeType: latest.mimeType,
            data: await readPrivateFile(latest.storageKey),
          });
          loadedBytes += latest.size;
          continue;
        } catch {
          // The attachment changed again or storage is unavailable.
        }
      }
      skipped.push({
        fileName: latest?.originalName ?? row.originalName,
        mimeType: latest?.mimeType ?? row.mimeType,
        data: new Uint8Array(),
      });
    }
  }
  return { attachments, skipped };
}

async function recordUnsupportedAttachments(
  review: ContentRiskReview,
  attachments: ContentRiskAttachmentInput[],
) {
  const mimeTypes = [...new Set(attachments.map((item) => item.mimeType))];
  await withSystemDb(async (tx) => {
    const runtime = await tx.contentRiskRuntimeState.findUnique({
      where: { pluginKey: CONTENT_CONTACT_RISK_PLUGIN_KEY },
    });
    if (!runtime) return;
    const notified = jsonStringSet(runtime.unsupportedNotified);
    const newlySeen = mimeTypes.filter((mime) => !notified.has(mime));
    for (const mime of mimeTypes) notified.add(mime);
    await tx.contentRiskRuntimeState.update({
      where: { pluginKey: CONTENT_CONTACT_RISK_PLUGIN_KEY },
      data: {
        unsupportedNotified: [...notified],
        capabilityReport: mergeCapabilityWarnings(runtime.capabilityReport, mimeTypes),
      },
    });
    if (newlySeen.length > 0) {
      await notifyPlatformAdmins(tx, {
        reviewId: review.id,
        title: "风控模型无法读取部分附件",
        body: `当前模型未能读取：${newlySeen.join("、")}。插件已继续检查正文并保持运行。`,
        actorName: review.actorName,
        input: {
          targetType: review.targetType,
          targetId: review.targetId,
          customerSpaceId: review.customerSpaceId,
          projectId: review.projectId,
          serviceRequestId: review.serviceRequestId,
        },
      });
    }
  });
}

async function applyDecision(
  review: ContentRiskReview,
  snapshot: ContentRiskSnapshot,
  result: ContentRiskModelDecision,
  providerRequestId: string | null,
) {
  const storageKeysToDelete = await withSystemDb(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${`${review.targetType}:${review.targetId}`})
      )
    `;
    const current = await tx.contentRiskReview.findUnique({ where: { id: review.id } });
    const runtime = await tx.contentRiskRuntimeState.findUnique({
      where: { pluginKey: CONTENT_CONTACT_RISK_PLUGIN_KEY },
    });
    const state = await tx.contentRiskState.findUnique({
      where: {
        targetType_targetId: {
          targetType: review.targetType,
          targetId: review.targetId,
        },
      },
    });
    if (
      !current ||
      current.status !== "PROCESSING" ||
      current.lastAttemptAt?.getTime() !== review.lastAttemptAt?.getTime()
    ) {
      return [] as string[];
    }
    if (
      !runtime ||
      runtime.bypassedAt ||
      runtime.activationId !== review.activationId
    ) {
      await cancelStaleReviewInTx(
        tx,
        review.id,
        "插件已停用、异常或审核批次已变更",
        true,
      );
      return [] as string[];
    }
    if (
      !state ||
      state.latestReviewId !== review.id ||
      state.revision !== review.revision
    ) {
      await cancelSupersededContentRiskReview(
        tx,
        review.id,
        "内容已产生更新版本，旧审核结果已忽略",
      );
      return [] as string[];
    }
    const now = new Date();
    if (result.decision === "VIOLATION") {
      const previousSafeSnapshot = await restorePreviousSafeSnapshot(tx, review);
      const restoredPrevious = Boolean(previousSafeSnapshot);
      if (previousSafeSnapshot) {
        await quarantineReplacementAttachments(
          tx,
          review,
          snapshot,
          previousSafeSnapshot,
        );
      }
      await tx.contentRiskState.update({
        where: { id: state.id },
        data: restoredPrevious
          ? {
              displayState: "VISIBLE",
              revokedAt: null,
            }
          : {
              displayState: "REVOKED",
              revokedAt: now,
            },
      });
      await cancelHeldDeliveries(tx, review.id);
      await notifyPlatformAdmins(tx, {
        reviewId: review.id,
        title: restoredPrevious ? "违规编辑已撤销" : "违规内容已撤回",
        body: restoredPrevious
          ? "AI检测到新版本疑似包含联系方式或站外交易引导，已恢复上一安全版本。"
          : "AI检测到疑似联系方式或站外交易引导，内容已撤回。",
        actorName: review.actorName,
        input: {
          targetType: review.targetType,
          targetId: review.targetId,
          customerSpaceId: review.customerSpaceId,
          projectId: review.projectId,
          serviceRequestId: review.serviceRequestId,
        },
      });
    } else {
      await releaseHeldDeliveries(tx, review.id);
      if (result.decision === "ALLOW") {
        const obsoleteStorageKeys = await deleteObsoleteSnapshotAttachments(
          tx,
          review.targetType,
          review.targetId,
          snapshot.attachmentIds ?? [],
        );
        await tx.contentRiskState.update({
          where: { id: state.id },
          data: {
            approvedRevision: review.revision,
            lastApprovedSnapshotEncrypted: review.contentSnapshotEncrypted,
            displayState: "VISIBLE",
            revokedAt: null,
          },
        });
        await tx.contentRiskReview.update({
          where: { id: review.id },
          data: {
            status: "PASSED",
            decision: result.decision,
            riskCategories: result.categories,
            decisionReason: result.reason,
            providerRequestId,
            completedAt: now,
            revokedAt: null,
            nextAttemptAt: null,
            lastError: null,
          },
        });
        await publishReviewDecisionEvent(tx, review, result.decision);
        return obsoleteStorageKeys;
      } else {
        await notifyPlatformAdmins(tx, {
          reviewId: review.id,
          title: "风控内容需要人工确认",
          body: "AI证据不足，内容保持显示，请平台管理员进入风控记录确认。",
          actorName: review.actorName,
          input: {
            targetType: review.targetType,
            targetId: review.targetId,
            customerSpaceId: review.customerSpaceId,
            projectId: review.projectId,
            serviceRequestId: review.serviceRequestId,
          },
        });
      }
    }
    await tx.contentRiskReview.update({
      where: { id: review.id },
      data: {
        status:
          result.decision === "VIOLATION" ? "VIOLATION" : "UNCERTAIN",
        decision: result.decision,
        riskCategories: result.categories,
        decisionReason: result.reason,
        providerRequestId,
        completedAt: now,
        revokedAt: result.decision === "VIOLATION" ? now : null,
        nextAttemptAt: null,
        lastError: null,
      },
    });
    await publishEvent(tx, {
      type: "CONTENT_RISK_REVIEW_UPDATED",
      customerSpaceId: review.customerSpaceId ?? undefined,
      projectId: review.projectId ?? undefined,
      serviceRequestId: review.serviceRequestId ?? undefined,
      payload: {
        reviewId: review.id,
        targetType: review.targetType,
        targetId: review.targetId,
        status: result.decision,
      },
    });
    return [] as string[];
  });
  await removeRiskAttachmentFiles(review, storageKeysToDelete);
}

async function publishReviewDecisionEvent(
  tx: Prisma.TransactionClient,
  review: ContentRiskReview,
  status: ContentRiskModelDecision["decision"],
) {
  await publishEvent(tx, {
    type: "CONTENT_RISK_REVIEW_UPDATED",
    customerSpaceId: review.customerSpaceId ?? undefined,
    projectId: review.projectId ?? undefined,
    serviceRequestId: review.serviceRequestId ?? undefined,
    payload: {
      reviewId: review.id,
      targetType: review.targetType,
      targetId: review.targetId,
      status,
    },
  });
}

async function handleReviewFailure(review: ContentRiskReview, error: unknown) {
  const message = error instanceof Error ? error.message : "模型检测失败";
  const attemptCount = review.attemptCount;
  const obsolete = await withSystemDb(async (tx) => {
    const state = await tx.contentRiskState.findUnique({
      where: {
        targetType_targetId: {
          targetType: review.targetType,
          targetId: review.targetId,
        },
      },
      select: { latestReviewId: true, revision: true },
    });
    if (
      state?.latestReviewId === review.id &&
      state.revision === review.revision
    ) {
      return false;
    }
    await cancelSupersededContentRiskReview(
      tx,
      review.id,
      "内容已产生更新版本，旧审核失败不再重试",
    );
    return true;
  });
  if (obsolete) return { cancelled: true };
  if (attemptCount < MAX_ATTEMPTS) {
    const delay = RETRY_DELAYS_MS[Math.max(0, attemptCount - 1)] ?? 60_000;
    await withSystemDb((tx) =>
      tx.contentRiskReview.updateMany({
        where: {
          id: review.id,
          status: "PROCESSING",
          lastAttemptAt: review.lastAttemptAt,
        },
        data: {
          status: "QUEUED",
          nextAttemptAt: new Date(Date.now() + delay),
          lastError: message,
        },
      }),
    );
    return { retrying: true, attemptCount };
  }
  await bypassPluginAfterFailure(review, message);
  return { failed: true, attemptCount };
}

async function bypassPluginAfterFailure(review: ContentRiskReview, message: string) {
  await withSystemDb(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${`${review.targetType}:${review.targetId}`})
      )
    `;
    const [installation, runtime, current, state] = await Promise.all([
      tx.pluginInstallation.findUnique({
        where: { key: CONTENT_CONTACT_RISK_PLUGIN_KEY },
        select: { enabled: true },
      }),
      tx.contentRiskRuntimeState.findUnique({
        where: { pluginKey: CONTENT_CONTACT_RISK_PLUGIN_KEY },
      }),
      tx.contentRiskReview.findUnique({ where: { id: review.id } }),
      tx.contentRiskState.findUnique({
        where: {
          targetType_targetId: {
            targetType: review.targetType,
            targetId: review.targetId,
          },
        },
        select: { latestReviewId: true, revision: true },
      }),
    ]);
    if (
      !current ||
      current.status !== "PROCESSING" ||
      current.lastAttemptAt?.getTime() !== review.lastAttemptAt?.getTime()
    ) {
      return;
    }
    if (
      state?.latestReviewId !== review.id ||
      state.revision !== review.revision
    ) {
      await cancelSupersededContentRiskReview(
        tx,
        review.id,
        "内容已产生更新版本，旧审核失败不触发旁路",
      );
      return;
    }
    if (
      !installation?.enabled ||
      !runtime ||
      runtime.bypassedAt ||
      runtime.activationId !== review.activationId
    ) {
      await cancelStaleReviewInTx(
        tx,
        review.id,
        "插件已停用、异常或审核批次已变更",
        true,
      );
      return;
    }
    await tx.pluginInstallation.update({
      where: { key: CONTENT_CONTACT_RISK_PLUGIN_KEY },
      data: {
        healthStatus: "ERROR",
        lastError: `模型检测连续5次失败：${message}`,
      },
    });
    await applyPluginDisableSideEffects(tx, CONTENT_CONTACT_RISK_PLUGIN_KEY);
    await notifyPlatformAdmins(tx, {
      reviewId: review.id,
      title: "联系方式风控已停止拦截",
      body: "模型连续5次调用失败，插件已进入异常旁路，所有内容将正常发送。请检查 Base URL、API Key 和模型状态。",
      actorName: review.actorName,
      input: {
        targetType: review.targetType,
        targetId: review.targetId,
        customerSpaceId: review.customerSpaceId,
        projectId: review.projectId,
        serviceRequestId: review.serviceRequestId,
      },
    });
    await publishEvent(tx, {
      type: "CONTENT_RISK_PLUGIN_FAILED",
      payload: { pluginKey: CONTENT_CONTACT_RISK_PLUGIN_KEY, reviewId: review.id },
    });
  });
}

async function releaseHeldDeliveries(tx: Prisma.TransactionClient, reviewId: string) {
  const [dingTalkDeliveries, heldMail] = await Promise.all([
    tx.dingTalkRobotDelivery.findMany({
      where: {
        contentRiskReviewId: reviewId,
        status: { in: ["HELD", "SKIPPED"] },
      },
      select: { id: true },
    }),
    tx.mailMessage.findFirst({
      where: {
        contentRiskReviewId: reviewId,
        status: { in: ["QUEUED", "CANCELLED"] },
      },
      select: { id: true },
    }),
  ]);
  const releasedNotifications = await tx.$queryRaw<
    Array<{ id: string; readAt: Date | null; emailDueAt: Date | null }>
  >`
    UPDATE "Notification"
    SET "emailDueAt" = "contentRiskEmailDueAt",
        "contentRiskEmailDueAt" = NULL,
        "contentRiskReviewId" = NULL,
        "emailClaimedAt" = NULL,
        "readAt" = CASE
          WHEN "contentRiskSuppressed" = TRUE
            THEN "contentRiskReadAtBeforeSuppression"
          ELSE "readAt"
        END,
        body = CASE
          WHEN "contentRiskSuppressed" = TRUE
            THEN COALESCE("contentRiskBodyBeforeSuppression", body)
          ELSE body
        END,
        "contentRiskReadAtBeforeSuppression" = NULL,
        "contentRiskBodyBeforeSuppression" = NULL,
        "contentRiskSuppressed" = FALSE
    WHERE "contentRiskReviewId" = ${reviewId}
    RETURNING id, "readAt", "emailDueAt"
  `;
  await tx.dingTalkRobotDelivery.updateMany({
    where: {
      contentRiskReviewId: reviewId,
      status: { in: ["HELD", "SKIPPED"] },
    },
    data: {
      contentRiskReviewId: null,
      status: "PENDING",
      nextAttemptAt: new Date(),
      lastError: null,
    },
  });
  await tx.mailMessage.updateMany({
    where: {
      contentRiskReviewId: reviewId,
      status: { in: ["QUEUED", "CANCELLED"] },
    },
    data: {
      contentRiskReviewId: null,
      status: "QUEUED",
      lastAttemptAt: null,
      errorMessage: null,
    },
  });
  const mailNotification = releasedNotifications.find(
    (notification) => !notification.readAt && notification.emailDueAt,
  );
  if (mailNotification) {
    await tx.$executeRaw`
      SELECT pg_notify('service_platform_mail_outbox', ${mailNotification.id})
    `;
  }
  if (heldMail) {
    await tx.$executeRaw`
      SELECT pg_notify('service_platform_mail_outbox', ${heldMail.id})
    `;
  }
  for (const delivery of dingTalkDeliveries) {
    await tx.$executeRaw`
      SELECT pg_notify('service_platform_dingtalk_deliveries', ${delivery.id})
    `;
  }
}

async function cancelHeldDeliveries(tx: Prisma.TransactionClient, reviewId: string) {
  await tx.$executeRaw`
    UPDATE "Notification"
    SET "contentRiskReadAtBeforeSuppression" = "readAt",
        "contentRiskBodyBeforeSuppression" = body,
        "contentRiskSuppressed" = TRUE,
        "readAt" = CURRENT_TIMESTAMP,
        body = '相关内容已被系统撤回',
        "aggregationKey" = NULL,
        "emailDueAt" = NULL,
        "emailClaimedAt" = NULL
    WHERE "contentRiskReviewId" = ${reviewId}
      AND "contentRiskSuppressed" = FALSE
  `;
  await tx.dingTalkRobotDelivery.updateMany({
    where: { contentRiskReviewId: reviewId, status: "HELD" },
    data: { status: "SKIPPED", nextAttemptAt: null, lastError: "原内容已被风控撤回" },
  });
  await tx.mailMessage.updateMany({
    where: { contentRiskReviewId: reviewId, status: "QUEUED" },
    data: {
      status: "CANCELLED",
      lastAttemptAt: null,
      errorMessage: "原内容已被风控撤回",
    },
  });
}

async function cancelStaleReview(reviewId: string, reason: string) {
  await withSystemDb(async (tx) => {
    await cancelStaleReviewInTx(tx, reviewId, reason, true);
  });
}

async function cancelStaleReviewInTx(
  tx: Prisma.TransactionClient,
  reviewId: string,
  reason: string,
  releaseDeliveries: boolean,
) {
  await tx.contentRiskReview.updateMany({
    where: { id: reviewId, status: "PROCESSING" },
    data: {
      status: "CANCELLED",
      completedAt: new Date(),
      nextAttemptAt: null,
      lastError: reason,
    },
  });
  if (releaseDeliveries) {
    await releaseHeldDeliveries(tx, reviewId);
  }
}

async function restorePreviousSafeSnapshot(
  tx: Prisma.TransactionClient,
  review: ContentRiskReview,
) {
  if (!review.previousSnapshotEncrypted) return null;
  const snapshot = decryptSnapshot(review.previousSnapshotEncrypted);
  await applySnapshotToTarget(tx, review.targetType, review.targetId, snapshot);
  return snapshot;
}

async function quarantineReplacementAttachments(
  tx: Prisma.TransactionClient,
  review: ContentRiskReview,
  currentSnapshot: ContentRiskSnapshot,
  previousSnapshot: ContentRiskSnapshot,
) {
  const previousIds = new Set(previousSnapshot.attachmentIds ?? []);
  const replacementIds = [...new Set(currentSnapshot.attachmentIds ?? [])]
    .filter((id) => !previousIds.has(id))
    .sort();
  for (const attachmentId of replacementIds) {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${`ATTACHMENT:${attachmentId}`})
      )
    `;
    const existing = await tx.contentRiskState.findUnique({
      where: {
        targetType_targetId: {
          targetType: "ATTACHMENT",
          targetId: attachmentId,
        },
      },
      select: { revision: true, latestReviewId: true },
    });
    if (existing?.latestReviewId) {
      await cancelSupersededContentRiskReview(
        tx,
        existing.latestReviewId,
        "父内容违规回退，附件已隔离",
      );
    }
    await tx.contentRiskState.upsert({
      where: {
        targetType_targetId: {
          targetType: "ATTACHMENT",
          targetId: attachmentId,
        },
      },
      create: {
        targetType: "ATTACHMENT",
        targetId: attachmentId,
        revision: 1,
        approvedRevision: 0,
        displayState: "REVOKED",
        latestReviewId: null,
        revokedAt: new Date(),
      },
      update: {
        revision: (existing?.revision ?? 0) + 1,
        displayState: "REVOKED",
        latestReviewId: null,
        revokedAt: new Date(),
        restoredAt: null,
      },
    });
  }
}

async function restoreQuarantinedAttachments(
  tx: Prisma.TransactionClient,
  attachmentIds: string[],
) {
  if (attachmentIds.length === 0) return;
  await tx.contentRiskState.updateMany({
    where: {
      targetType: "ATTACHMENT",
      targetId: { in: [...new Set(attachmentIds)] },
      latestReviewId: null,
      displayState: "REVOKED",
    },
    data: {
      displayState: "VISIBLE",
      revokedAt: null,
      restoredAt: new Date(),
    },
  });
}

async function applySnapshotToTarget(
  tx: Prisma.TransactionClient,
  targetType: ContentRiskTargetType,
  targetId: string,
  snapshot: ContentRiskSnapshot,
) {
  if (targetType === "PROJECT_UPDATE") {
    await tx.projectUpdate.updateMany({
      where: { id: targetId },
      data: {
        ...(snapshot.title === undefined ? {} : { title: snapshot.title ?? "" }),
        ...(snapshot.body === undefined ? {} : { body: snapshot.body ?? "" }),
        ...(snapshot.visibility ? { visibility: snapshot.visibility } : {}),
      },
    });
  } else if (targetType === "UPDATE_COMMENT") {
    await tx.updateComment.updateMany({
      where: { id: targetId },
      data: {
        ...(snapshot.body === undefined ? {} : { body: snapshot.body ?? "" }),
        ...(snapshot.visibility ? { visibility: snapshot.visibility } : {}),
      },
    });
  } else if (targetType === "MILESTONE_COMMENT") {
    await tx.milestoneComment.updateMany({
      where: { id: targetId },
      data: {
        ...(snapshot.body === undefined ? {} : { body: snapshot.body ?? "" }),
        ...(snapshot.visibility ? { visibility: snapshot.visibility } : {}),
      },
    });
  } else if (targetType === "MILESTONE") {
    await tx.milestone.updateMany({
      where: { id: targetId },
      data: {
        ...(snapshot.title === undefined ? {} : { title: snapshot.title ?? "" }),
        ...(snapshot.body === undefined ? {} : { description: snapshot.body }),
      },
    });
  }
}

export async function restoreContentRiskReview(
  actor: Actor,
  reviewId: string,
  reason: string,
) {
  if (!actor.isPlatformAdmin) {
    throw new DomainError("FORBIDDEN", "仅平台管理员可恢复风控内容", 403);
  }
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 2 || normalizedReason.length > 500) {
    throw new DomainError("INVALID_RESTORE_REASON", "请填写恢复原因", 422);
  }
  const result = await withActorDb(actor, async (tx) => {
    const reviewForLock = await tx.contentRiskReview.findUnique({
      where: { id: reviewId },
      select: { targetType: true, targetId: true },
    });
    if (!reviewForLock) {
      throw new DomainError("CONTENT_RISK_REVIEW_NOT_RESTORABLE", "该风控记录不可恢复", 409);
    }
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${`${reviewForLock.targetType}:${reviewForLock.targetId}`})
      )
    `;
    const review = await tx.contentRiskReview.findUnique({ where: { id: reviewId } });
    if (!review || review.source !== "AI" || review.status !== "VIOLATION") {
      throw new DomainError("CONTENT_RISK_REVIEW_NOT_RESTORABLE", "该风控记录不可恢复", 409);
    }
    const state = await tx.contentRiskState.findUnique({
      where: {
        targetType_targetId: {
          targetType: review.targetType,
          targetId: review.targetId,
        },
      },
      select: { latestReviewId: true, revision: true },
    });
    if (
      state?.latestReviewId !== review.id ||
      state.revision !== review.revision
    ) {
      throw new DomainError(
        "CONTENT_RISK_REVIEW_SUPERSEDED",
        "该内容已有更新版本，不能恢复旧风控记录",
        409,
      );
    }
    const snapshot = decryptSnapshot(review.contentSnapshotEncrypted);
    await applySnapshotToTarget(tx, review.targetType, review.targetId, snapshot);
    await restoreQuarantinedAttachments(tx, snapshot.attachmentIds ?? []);
    const obsoleteStorageKeys = await deleteObsoleteSnapshotAttachments(
      tx,
      review.targetType,
      review.targetId,
      snapshot.attachmentIds ?? [],
    );
    const now = new Date();
    await tx.contentRiskState.updateMany({
      where: { targetType: review.targetType, targetId: review.targetId },
      data: {
        displayState: "VISIBLE",
        approvedRevision: review.revision,
        lastApprovedSnapshotEncrypted: review.contentSnapshotEncrypted,
        revokedAt: null,
        restoredAt: now,
      },
    });
    await tx.contentRiskReview.update({
      where: { id: review.id },
      data: {
        restoredAt: now,
        restoredById: actor.id,
        restoreReason: normalizedReason,
      },
    });
    await releaseHeldDeliveries(tx, review.id);
    await publishEvent(tx, {
      type: "CONTENT_RISK_REVIEW_UPDATED",
      customerSpaceId: review.customerSpaceId ?? undefined,
      projectId: review.projectId ?? undefined,
      serviceRequestId: review.serviceRequestId ?? undefined,
      payload: {
        reviewId: review.id,
        targetType: review.targetType,
        targetId: review.targetId,
        status: "RESTORED",
      },
    });
    return { restored: true as const, obsoleteStorageKeys };
  });
  await removeRiskAttachmentFiles(reviewId, result.obsoleteStorageKeys);
  return { restored: true as const };
}

async function deleteObsoleteSnapshotAttachments(
  tx: Prisma.TransactionClient,
  targetType: ContentRiskTargetType,
  targetId: string,
  keepAttachmentIds: string[],
) {
  const relationWhere =
    targetType === "PROJECT_UPDATE"
      ? { projectUpdateId: targetId }
      : targetType === "UPDATE_COMMENT"
        ? { updateCommentId: targetId }
        : targetType === "MILESTONE_COMMENT"
          ? { milestoneCommentId: targetId }
          : targetType === "MILESTONE"
            ? { milestoneId: targetId }
            : null;
  if (!relationWhere) return [];
  const obsolete = await tx.attachment.findMany({
    where: {
      ...relationWhere,
      inline: true,
      ...(keepAttachmentIds.length > 0
        ? { id: { notIn: [...new Set(keepAttachmentIds)] } }
        : {}),
    },
    select: { id: true, storageKey: true, previewStorageKey: true },
  });
  if (obsolete.length === 0) return [];
  await tx.contentRiskState.deleteMany({
    where: {
      targetType: "ATTACHMENT",
      targetId: { in: obsolete.map((attachment) => attachment.id) },
    },
  });
  await tx.attachment.deleteMany({
    where: { id: { in: obsolete.map((attachment) => attachment.id) } },
  });
  return obsolete.flatMap((attachment) =>
    [attachment.storageKey, attachment.previewStorageKey].filter(
      (value): value is string => Boolean(value),
    ),
  );
}

async function removeRiskAttachmentFiles(
  review: Pick<ContentRiskReview, "id"> | string,
  storageKeys: string[],
) {
  let failedCount = 0;
  for (const storageKey of storageKeys) {
    try {
      await removePrivateFile(storageKey);
    } catch {
      failedCount += 1;
    }
  }
  if (failedCount > 0) {
    console.error("CONTENT_RISK_ATTACHMENT_CLEANUP_FAILED", {
      reviewId: typeof review === "string" ? review : review.id,
      failedCount,
    });
  }
}

export function decryptSnapshot(value: string): ContentRiskSnapshot {
  const parsed = JSON.parse(decryptSecret(value)) as ContentRiskSnapshot;
  return parsed;
}

function snapshotText(snapshot: ContentRiskSnapshot) {
  return [snapshot.title, snapshot.body].filter(Boolean).join("\n");
}

function jsonStringSet(value: Prisma.JsonValue | null) {
  return new Set(
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [],
  );
}

function mergeCapabilityWarnings(value: Prisma.JsonValue | null, mimeTypes: string[]) {
  const current = value && typeof value === "object" && !Array.isArray(value)
    ? value as Prisma.JsonObject
    : {};
  const existing = Array.isArray(current.unsupportedMimeTypes)
    ? current.unsupportedMimeTypes.filter((item): item is string => typeof item === "string")
    : [];
  const existingCounts =
    current.unsupportedMimeCounts &&
    typeof current.unsupportedMimeCounts === "object" &&
    !Array.isArray(current.unsupportedMimeCounts)
      ? (current.unsupportedMimeCounts as Prisma.JsonObject)
      : {};
  const unsupportedMimeCounts = { ...existingCounts } as Record<
    string,
    number
  >;
  for (const mimeType of mimeTypes) {
    const currentCount = unsupportedMimeCounts[mimeType];
    unsupportedMimeCounts[mimeType] =
      (typeof currentCount === "number" ? currentCount : 0) + 1;
  }
  return {
    ...current,
    unsupportedMimeTypes: [...new Set([...existing, ...mimeTypes])],
    unsupportedMimeCounts,
  } as Prisma.InputJsonValue;
}
