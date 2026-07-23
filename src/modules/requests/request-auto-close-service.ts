import "server-only";

import type { Actor } from "@/lib/actor";
import { withSystemDb } from "@/lib/system-db";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { dispatchRequestActivity } from "@/modules/notifications/notification-service";
import {
  REQUEST_AUTO_CLOSE_DAYS,
  requestAutoCloseCutoff,
} from "@/modules/requests/request-auto-close-policy";

const REQUEST_AUTO_CLOSE_BATCH_SIZE = 100;

const systemActor: Actor = {
  id: "system",
  name: "系统",
  email: "system@local",
  platformRole: "PLATFORM_ADMIN",
  isPlatformAdmin: true,
  isStaff: true,
};

export async function closeResolvedRequestsDue(now = new Date()) {
  const cutoff = requestAutoCloseCutoff(now);
  const candidates = await withSystemDb((tx) =>
    tx.serviceRequest.findMany({
      where: {
        status: "RESOLVED",
        resolvedAt: { lte: cutoff },
      },
      select: { id: true },
      orderBy: [{ resolvedAt: "asc" }, { id: "asc" }],
      take: REQUEST_AUTO_CLOSE_BATCH_SIZE,
    }),
  );

  let closedCount = 0;
  let failedCount = 0;
  for (const candidate of candidates) {
    try {
      const result = await closeResolvedRequestDue(candidate.id, cutoff, now);
      if (!result.closed) continue;
      closedCount += 1;
      if (result.notifyExternalContact) {
        await enqueueExternalAutoCloseMail(candidate.id);
      }
    } catch (error) {
      failedCount += 1;
      console.error(
        "ACHORD_REQUEST_AUTO_CLOSE_FAILED",
        JSON.stringify({
          requestId: candidate.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  return {
    scannedCount: candidates.length,
    closedCount,
    failedCount,
  };
}

async function enqueueExternalAutoCloseMail(requestId: string) {
  const { enqueueExternalRequestStatusMail } = await import(
    "@/modules/integrations/external/mail-service"
  );
  await enqueueExternalRequestStatusMail(requestId, "CLOSED");
}

function closeResolvedRequestDue(
  requestId: string,
  cutoff: Date,
  now: Date,
) {
  return withSystemDb(async (tx) => {
    const request = await tx.serviceRequest.findFirst({
      where: {
        id: requestId,
        status: "RESOLVED",
        resolvedAt: { lte: cutoff },
      },
      select: {
        id: true,
        number: true,
        title: true,
        resolvedAt: true,
        projectId: true,
        assigneeId: true,
        createdByExternalContactId: true,
        assignees: { select: { userId: true } },
        project: { select: { customerSpaceId: true } },
      },
    });
    if (!request?.resolvedAt) {
      return { closed: false, notifyExternalContact: false };
    }

    const result = await tx.serviceRequest.updateMany({
      where: {
        id: request.id,
        status: "RESOLVED",
        resolvedAt: request.resolvedAt,
      },
      data: {
        status: "CLOSED",
        closedAt: now,
      },
    });
    if (result.count !== 1) {
      return { closed: false, notifyExternalContact: false };
    }

    await tx.requestMessage.create({
      data: {
        body: `问题标记为已解决后 ${REQUEST_AUTO_CLOSE_DAYS} 天内未收到新的反馈，系统已自动关闭本次服务请求。`,
        visibility: "CUSTOMER_VISIBLE",
        isSystem: true,
        serviceRequestId: request.id,
      },
    });
    await writeAuditLog(tx, systemActor, {
      action: "REQUEST_STATUS_CHANGED",
      resourceType: "ServiceRequest",
      resourceId: request.id,
      customerSpaceId: request.project.customerSpaceId,
      projectId: request.projectId,
      serviceRequestId: request.id,
      metadata: {
        previousStatus: "RESOLVED",
        status: "CLOSED",
        source: "AUTO_CLOSE_AFTER_RESOLUTION",
        resolvedAt: request.resolvedAt.toISOString(),
        autoCloseDays: REQUEST_AUTO_CLOSE_DAYS,
      },
    });
    await dispatchRequestActivity(tx, systemActor, {
      eventType: "REQUEST_STATUS_CHANGED",
      eventPayload: {
        requestId: request.id,
        requestNumber: request.number,
        previousStatus: "RESOLVED",
        status: "CLOSED",
        actorId: systemActor.id,
        source: "AUTO_CLOSE_AFTER_RESOLUTION",
      },
      notificationType: "REQUEST_STATUS",
      notificationTitle: `请求 ${request.number} 已自动关闭`,
      notificationBody: `${request.title} · 解决后 ${REQUEST_AUTO_CLOSE_DAYS} 天未收到反馈`,
      includeCustomers: !request.createdByExternalContactId,
      includeExternalContact: Boolean(request.createdByExternalContactId),
      relevantWorkerUserIds: [
        request.assigneeId,
        ...request.assignees.map((item) => item.userId),
      ],
      notifyProjectManagers: false,
      notifyPlatformAdmins: false,
      createNotifications: false,
      audible: false,
      customerSpaceId: request.project.customerSpaceId,
      projectId: request.projectId,
      serviceRequestId: request.id,
    });
    return {
      closed: true,
      notifyExternalContact: Boolean(request.createdByExternalContactId),
    };
  });
}
