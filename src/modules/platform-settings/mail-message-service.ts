import "server-only";

import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import {
  queueMailMessage,
  recordMailQueueFailure,
} from "@/lib/jobs";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { resolveLockedMailDeliveryMode } from "@/modules/platform-settings/mail-provider-lifecycle";
import {
  assertAllowed,
  assertFound,
  DomainError,
} from "@/modules/projects/errors";

const retryableStatuses = new Set(["QUEUED", "FAILED", "CANCELLED"]);

export async function retryMailMessage(
  actor: Actor,
  mailMessageId: string,
) {
  assertAllowed(actor.isPlatformAdmin);
  const result = await withActorDb(actor, async (tx) => {
    const deliveryMode = await resolveLockedMailDeliveryMode(tx);
    const existing = await tx.mailMessage.findUnique({
      where: { id: mailMessageId },
    });
    assertFound(existing, "邮件记录不存在");
    if (!retryableStatuses.has(existing.status)) {
      throw new DomainError(
        "MAIL_MESSAGE_NOT_RETRYABLE",
        "当前邮件状态不允许重试",
        409,
      );
    }
    const updated = await tx.mailMessage.updateMany({
      where: {
        id: mailMessageId,
        status: existing.status,
      },
      data: {
        deliveryMode,
        status: "QUEUED",
        attemptCount: 0,
        lastAttemptAt: null,
        errorMessage: null,
        providerId: null,
        sentAt: null,
        lastEventAt: null,
      },
    });
    if (updated.count === 0) {
      throw new DomainError(
        "MAIL_MESSAGE_STATE_CHANGED",
        "邮件状态已变化，请刷新后重试",
        409,
      );
    }
    const queued = await tx.mailMessage.findUniqueOrThrow({
      where: { id: mailMessageId },
    });
    return {
      queued,
      deliveryMode,
      previousStatus: existing.status,
      previousDeliveryMode: existing.deliveryMode,
    };
  });

  try {
    await queueMailMessage(result.queued.id, result.deliveryMode);
  } catch (error) {
    const failure = await recordMailQueueFailure(
      result.queued.id,
      error,
      "manual_retry",
    );
    throw new DomainError(
      "MAIL_QUEUE_UNAVAILABLE",
      `邮件已重新排队，但任务队列暂时不可用；系统会自动补投。错误编号：${failure.referenceId}`,
      503,
    );
  }

  await withActorDb(actor, (tx) =>
    writeAuditLog(tx, actor, {
      action: "MAIL_MESSAGE_REQUEUED",
      resourceType: "MailMessage",
      resourceId: result.queued.id,
      metadata: {
        previousStatus: result.previousStatus,
        previousDeliveryMode: result.previousDeliveryMode,
        deliveryMode: result.deliveryMode,
        toEmail: result.queued.toEmail,
      },
    }),
  );
  return result.queued;
}

export async function cancelMailMessage(
  actor: Actor,
  mailMessageId: string,
) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, async (tx) => {
    const existing = await tx.mailMessage.findUnique({
      where: { id: mailMessageId },
    });
    assertFound(existing, "邮件记录不存在");
    if (existing.status !== "QUEUED") {
      throw new DomainError(
        "MAIL_MESSAGE_NOT_CANCELLABLE",
        "只有排队中的邮件可以取消",
        409,
      );
    }

    const updated = await tx.mailMessage.updateMany({
      where: {
        id: mailMessageId,
        status: "QUEUED",
      },
      data: {
        status: "CANCELLED",
        errorMessage: "管理员已取消发送",
      },
    });
    if (updated.count === 0) {
      throw new DomainError(
        "MAIL_MESSAGE_STATE_CHANGED",
        "邮件已开始处理，请刷新查看最新状态",
        409,
      );
    }
    const cancelled = await tx.mailMessage.findUniqueOrThrow({
      where: { id: mailMessageId },
    });
    await writeAuditLog(tx, actor, {
      action: "MAIL_MESSAGE_CANCELLED",
      resourceType: "MailMessage",
      resourceId: cancelled.id,
      metadata: {
        deliveryMode: cancelled.deliveryMode,
        toEmail: cancelled.toEmail,
      },
    });
    return cancelled;
  });
}
