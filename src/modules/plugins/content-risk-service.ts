import "server-only";

import { randomUUID } from "node:crypto";
import {
  parseContentContactRiskConfig,
} from "@achord/plugin-content-contact-risk/config";
import {
  evaluateContactRiskRules,
} from "@achord/plugin-content-contact-risk/rules";
import type {
  ContentRiskTargetType,
  Prisma,
} from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import type { ExternalActor } from "@/lib/external-actor";
import { encryptSecret } from "@/lib/secret-crypto";
import { withSystemDb } from "@/lib/system-db";
import {
  createNotification,
  publishEvent,
} from "@/modules/notifications/notification-service";
import { loadNotificationDeliveryRule } from "@/modules/notifications/notification-delivery-rule-service";
import { recordDingTalkContentRiskAlert } from "@/modules/plugins/dingtalk-robot-service";
import { DomainError } from "@/modules/projects/errors";

export type ContentRiskSnapshot = {
  title?: string | null;
  body?: string | null;
  visibility?: "CUSTOMER_VISIBLE" | "INTERNAL";
  attachmentIds?: string[];
  metadata?: Record<string, string | number | boolean | null>;
};

export type ContentRiskContext = {
  targetType: ContentRiskTargetType;
  targetId: string;
  actorId?: string | null;
  actorName: string;
  actorKind: "CUSTOMER" | "STAFF" | "EXTERNAL";
  isPlatformAdmin: boolean;
  customerSpaceId?: string | null;
  projectId?: string | null;
  serviceRequestId?: string | null;
  snapshot: ContentRiskSnapshot;
  previousSnapshot?: ContentRiskSnapshot | null;
};

export type ContentRiskRuntime = {
  activationId: string;
  enabledAt: Date;
  config: ReturnType<typeof parseContentContactRiskConfig>;
};

export async function enforceActorPublicContentRules(
  actor: Actor,
  input: Omit<ContentRiskContext, "actorId" | "actorName" | "actorKind" | "isPlatformAdmin" | "targetId">,
) {
  if (actor.isPlatformAdmin || input.snapshot.visibility === "INTERNAL") {
    return { candidate: false, categories: [] as string[] };
  }
  const result = await withSystemDb((tx) =>
    evaluateAndRecordRuleBlock(tx, {
      ...input,
      targetId: `submission:${randomUUID()}`,
      actorId: actor.id,
      actorName: actor.name,
      actorKind: actor.platformRole === "CUSTOMER" ? "CUSTOMER" : "STAFF",
      isPlatformAdmin: false,
    }),
  );
  if (result.blocked) {
    throw new DomainError(
      "CONTACT_INFORMATION_BLOCKED",
      actor.platformRole === "CUSTOMER"
        ? "内容疑似包含联系方式或站外交易引导，已阻止发送。请继续通过平台沟通。"
        : "严禁向客户提供个人联系方式或引导站外沟通、交易。本次行为已记录并通知平台管理员。",
      422,
    );
  }
  return result;
}

export async function enforceExternalPublicContentRules(
  actor: ExternalActor,
  input: Omit<ContentRiskContext, "actorId" | "actorName" | "actorKind" | "isPlatformAdmin" | "targetId">,
) {
  const result = await withSystemDb((tx) =>
    evaluateAndRecordRuleBlock(tx, {
      ...input,
      targetId: `submission:${randomUUID()}`,
      actorId: actor.id,
      actorName: actor.name,
      actorKind: "EXTERNAL",
      isPlatformAdmin: false,
    }),
  );
  if (result.blocked) {
    throw new DomainError(
      "CONTACT_INFORMATION_BLOCKED",
      "内容疑似包含联系方式或站外交易引导，已阻止发送。请继续通过平台沟通。",
      422,
    );
  }
  return result;
}

async function evaluateAndRecordRuleBlock(
  tx: Prisma.TransactionClient,
  input: ContentRiskContext,
) {
  const runtime = await loadOperationalContentRiskRuntime(tx);
  if (!runtime) return { blocked: false, candidate: false, categories: [] as string[] };
  const rules = evaluateContactRiskRules(snapshotText(input.snapshot), {
    allowedDomains: runtime.config.allowedDomains,
  });
  if (!rules.blocked) {
    return { blocked: false, candidate: rules.candidate, categories: rules.categories };
  }
  const now = new Date();
  const review = await tx.contentRiskReview.create({
    data: {
      activationId: runtime.activationId,
      targetType: input.targetType,
      targetId: input.targetId,
      revision: 1,
      actorId: input.actorId ?? null,
      customerSpaceId: input.customerSpaceId ?? null,
      projectId: input.projectId ?? null,
      serviceRequestId: input.serviceRequestId ?? null,
      source: "RULE",
      status: "VIOLATION",
      decision: "VIOLATION",
      riskCategories: rules.categories,
      actorName: input.actorName,
      contentSnapshotEncrypted: encryptSnapshot(input.snapshot),
      completedAt: now,
      revokedAt: now,
    },
  });
  await notifyPlatformAdmins(tx, {
    reviewId: review.id,
    title: "内容风控已阻止发送",
    body: `${input.actorName}提交的客户可见内容命中了明确联系方式规则。`,
    actorName: input.actorName,
    input,
  });
  return { blocked: true, candidate: true, categories: rules.categories };
}

export async function createContentRiskReview(
  tx: Prisma.TransactionClient,
  input: ContentRiskContext,
) {
  if (input.isPlatformAdmin || input.snapshot.visibility === "INTERNAL") {
    await markExistingContentRiskStateSafe(tx, input);
    return null;
  }
  const runtime = await loadOperationalContentRiskRuntime(tx);
  if (!runtime || new Date() < runtime.enabledAt) return null;
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${`${input.targetType}:${input.targetId}`})
    )
  `;
  const existingState = await tx.contentRiskState.findUnique({
    where: {
      targetType_targetId: {
        targetType: input.targetType,
        targetId: input.targetId,
      },
    },
  });
  const rules = evaluateContactRiskRules(snapshotText(input.snapshot), {
    allowedDomains: runtime.config.allowedDomains,
  });
  const attachmentIds = input.snapshot.attachmentIds ?? [];
  if (!runtime.config.fullAuditEnabled && !rules.candidate && attachmentIds.length === 0) {
    if (existingState) {
      if (existingState.latestReviewId) {
        await cancelSupersededContentRiskReview(
          tx,
          existingState.latestReviewId,
          "内容已更新为无需模型复查的新版本",
        );
      }
      const revision = existingState.revision + 1;
      await tx.contentRiskState.update({
        where: { id: existingState.id },
        data: {
          revision,
          approvedRevision: revision,
          displayState: "VISIBLE",
          latestReviewId: null,
          lastApprovedSnapshotEncrypted: encryptSnapshot(input.snapshot),
          revokedAt: null,
          restoredAt: new Date(),
        },
      });
    }
    return null;
  }
  if (existingState?.latestReviewId) {
    await cancelSupersededContentRiskReview(
      tx,
      existingState.latestReviewId,
      "内容已产生新的审核版本",
    );
  }
  const revision = (existingState?.revision ?? 0) + 1;
  const previousApprovedSnapshotEncrypted = existingState
    ? existingState.lastApprovedSnapshotEncrypted
    : input.previousSnapshot
      ? encryptSnapshot(input.previousSnapshot)
      : null;
  const review = await tx.contentRiskReview.create({
    data: {
      activationId: runtime.activationId,
      targetType: input.targetType,
      targetId: input.targetId,
      revision,
      actorId: input.actorId ?? null,
      customerSpaceId: input.customerSpaceId ?? null,
      projectId: input.projectId ?? null,
      serviceRequestId: input.serviceRequestId ?? null,
      source: "AI",
      status: "QUEUED",
      riskCategories: rules.categories,
      actorName: input.actorName,
      contentSnapshotEncrypted: encryptSnapshot(input.snapshot),
      previousSnapshotEncrypted: previousApprovedSnapshotEncrypted,
      providerModel: runtime.config.model,
      nextAttemptAt: new Date(),
    },
  });
  await tx.contentRiskState.upsert({
    where: {
      targetType_targetId: {
        targetType: input.targetType,
        targetId: input.targetId,
      },
    },
    create: {
      targetType: input.targetType,
      targetId: input.targetId,
      revision,
      approvedRevision: 0,
      displayState: "VISIBLE",
      latestReviewId: review.id,
      lastApprovedSnapshotEncrypted: previousApprovedSnapshotEncrypted,
    },
    update: {
      revision,
      displayState: "VISIBLE",
      latestReviewId: review.id,
      revokedAt: null,
      restoredAt: null,
    },
  });
  await publishEvent(tx, {
    type: "CONTENT_RISK_REVIEW_UPDATED",
    userId: input.actorId ?? undefined,
    customerSpaceId: input.customerSpaceId ?? undefined,
    projectId: input.projectId ?? undefined,
    serviceRequestId: input.serviceRequestId ?? undefined,
    payload: {
      reviewId: review.id,
      targetType: input.targetType,
      targetId: input.targetId,
      status: "QUEUED",
    },
  });
  await tx.$executeRaw`SELECT pg_notify('service_platform_content_risk', ${review.id})`;
  return review;
}

async function markExistingContentRiskStateSafe(
  tx: Prisma.TransactionClient,
  input: ContentRiskContext,
) {
  const existing = await tx.contentRiskState.findUnique({
    where: {
      targetType_targetId: {
        targetType: input.targetType,
        targetId: input.targetId,
      },
    },
    select: { id: true, revision: true, latestReviewId: true },
  });
  if (!existing) return;
  if (existing.latestReviewId) {
    await cancelSupersededContentRiskReview(
      tx,
      existing.latestReviewId,
      "平台管理员或内部内容已更新该内容",
    );
  }
  const revision = existing.revision + 1;
  await tx.contentRiskState.update({
    where: { id: existing.id },
    data: {
      revision,
      approvedRevision: revision,
      displayState: "VISIBLE",
      latestReviewId: null,
      lastApprovedSnapshotEncrypted: encryptSnapshot(input.snapshot),
      revokedAt: null,
      restoredAt: new Date(),
    },
  });
}

export async function cancelSupersededContentRiskReview(
  tx: Prisma.TransactionClient,
  reviewId: string,
  reason: string,
) {
  const [result] = await tx.$queryRaw<Array<{ cancelled: boolean }>>`
    SELECT app_cancel_superseded_content_risk_review(
      ${reviewId},
      ${reason}
    ) AS cancelled
  `;
  if (!result?.cancelled) {
    throw new Error("旧风控审核作废失败");
  }
}

export async function loadOperationalContentRiskRuntime(
  existingTx?: Prisma.TransactionClient,
): Promise<ContentRiskRuntime | null> {
  const load = async (tx: Prisma.TransactionClient) => {
    const [runtime] = await tx.$queryRaw<Array<{
      activationId: string;
      enabledAt: Date;
      model: string;
      fullAuditEnabled: boolean;
      allowedDomains: unknown;
    }>>`SELECT * FROM app_get_content_risk_runtime()`;
    if (!runtime) return null;
    return {
      activationId: runtime.activationId,
      enabledAt: runtime.enabledAt,
      config: parseContentContactRiskConfig({
        baseUrl: "",
        model: runtime.model,
        fullAuditEnabled: runtime.fullAuditEnabled,
        allowedDomains: runtime.allowedDomains,
      }),
    };
  };
  return existingTx ? load(existingTx) : withSystemDb(load);
}

export async function isContentRiskPublicUiEnabled(
  tx: Prisma.TransactionClient,
) {
  return Boolean(await loadOperationalContentRiskRuntime(tx));
}

export async function isContentRiskTargetRevoked(
  tx: Prisma.TransactionClient,
  targetType: ContentRiskTargetType,
  targetId: string,
) {
  const state = await tx.contentRiskState.findUnique({
    where: { targetType_targetId: { targetType, targetId } },
    select: { displayState: true },
  });
  return state?.displayState === "REVOKED";
}

export async function isContentRiskAttachmentRevoked(
  tx: Prisma.TransactionClient,
  attachment: {
    id: string;
    requestMessageId?: string | null;
    serviceRequestId?: string | null;
    projectUpdateId?: string | null;
    updateCommentId?: string | null;
    milestoneId?: string | null;
  },
) {
  const targets: Array<{ targetType: ContentRiskTargetType; targetId: string }> = [
    { targetType: "ATTACHMENT", targetId: attachment.id },
  ];
  if (attachment.projectUpdateId) {
    targets.push({
      targetType: "PROJECT_UPDATE",
      targetId: attachment.projectUpdateId,
    });
  }
  if (attachment.updateCommentId) {
    targets.push({
      targetType: "UPDATE_COMMENT",
      targetId: attachment.updateCommentId,
    });
  }
  if (attachment.milestoneId) {
    targets.push({ targetType: "MILESTONE", targetId: attachment.milestoneId });
  }
  if (attachment.requestMessageId) {
    const message = await tx.requestMessage.findUnique({
      where: { id: attachment.requestMessageId },
      select: { id: true, isInitial: true, serviceRequestId: true },
    });
    if (message) {
      targets.push(
        message.isInitial
          ? {
              targetType: "SERVICE_REQUEST",
              targetId: message.serviceRequestId,
            }
          : { targetType: "REQUEST_MESSAGE", targetId: message.id },
      );
    }
  } else if (attachment.serviceRequestId) {
    targets.push({
      targetType: "SERVICE_REQUEST",
      targetId: attachment.serviceRequestId,
    });
  }
  const revoked = await tx.contentRiskState.findFirst({
    where: {
      displayState: "REVOKED",
      OR: targets.map((target) => ({
        targetType: target.targetType,
        targetId: target.targetId,
      })),
    },
    select: { id: true },
  });
  return Boolean(revoked);
}

export async function notifyPlatformAdmins(
  tx: Prisma.TransactionClient,
  input: {
    reviewId: string;
    title: string;
    body: string;
    actorName?: string | null;
    input: Pick<
      ContentRiskContext,
      "customerSpaceId" | "projectId" | "serviceRequestId" | "targetType" | "targetId"
    >;
  },
) {
  const admins = await tx.user.findMany({
    where: { platformRole: "PLATFORM_ADMIN", deletedAt: null },
    select: { id: true },
  });
  const rule = await loadNotificationDeliveryRule(tx, "CONTENT_RISK_ALERT");
  let firstEmailNotificationId: string | null = null;
  for (const admin of admins) {
    const notification = await createNotification(tx, {
      type: "CONTENT_RISK",
      title: input.title,
      body: input.body,
      userId: admin.id,
      customerSpaceId: input.input.customerSpaceId ?? undefined,
      projectId: input.input.projectId ?? undefined,
      serviceRequestId: input.input.serviceRequestId ?? undefined,
      aggregationKey: `content-risk:${input.reviewId}:${admin.id}`,
      emailDueAt: rule.emailEnabled ? new Date() : undefined,
    });
    if (rule.emailEnabled) firstEmailNotificationId ??= notification.id;
  }
  if (firstEmailNotificationId) {
    await tx.$executeRaw`
      SELECT pg_notify('service_platform_mail_outbox', ${firstEmailNotificationId})
    `;
  }
  await recordDingTalkContentRiskAlert(tx, {
    reviewId: input.reviewId,
    requestId: input.input.serviceRequestId,
    actorName: input.actorName,
    targetLabel: contentRiskTargetLabel(input.input.targetType),
    riskSummary: input.body,
  });
  await publishEvent(tx, {
    type: "CONTENT_RISK_DETECTED",
    customerSpaceId: input.input.customerSpaceId ?? undefined,
    projectId: input.input.projectId ?? undefined,
    serviceRequestId: input.input.serviceRequestId ?? undefined,
    payload: {
      reviewId: input.reviewId,
      targetType: input.input.targetType,
      targetId: input.input.targetId,
    },
  });
}

function contentRiskTargetLabel(targetType: ContentRiskTargetType) {
  const labels: Record<ContentRiskTargetType, string> = {
    SERVICE_REQUEST: "新建服务请求",
    REQUEST_MESSAGE: "服务请求公开回复",
    PROJECT_UPDATE: "项目进度",
    UPDATE_COMMENT: "项目进度评论",
    MILESTONE: "项目里程碑",
    ATTACHMENT: "公开附件",
  };
  return labels[targetType];
}

export function encryptSnapshot(snapshot: ContentRiskSnapshot) {
  return encryptSecret(JSON.stringify(snapshot));
}

export function snapshotText(snapshot: ContentRiskSnapshot) {
  return [snapshot.title, snapshot.body].filter(Boolean).join("\n");
}
