import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { ExternalActor } from "@/lib/external-actor";
import { withExternalActorDb } from "@/lib/external-actor";
import type { embedPresenceSchema } from "@/modules/integrations/external/schemas";
import {
  publishEvent,
  publishTransientEvent,
} from "@/modules/notifications/notification-service";
import { DomainError } from "@/modules/projects/errors";
import { PRESENCE_RETENTION_MS } from "@/modules/requests/presence-sweep-service";
import type { z } from "zod";

const PRESENCE_TTL_MS = 3 * 60 * 1000;
const TYPING_TTL_MS = 12_000;
type PresenceInput = z.infer<typeof embedPresenceSchema>;

async function isCustomerGroupOnline(
  tx: Prisma.TransactionClient,
  serviceRequestId: string,
  now: Date,
) {
  const customerPresence = await tx.requestPresence.findFirst({
    where: {
      serviceRequestId,
      expiresAt: { gt: now },
      user: { platformRole: "CUSTOMER" },
    },
    select: { id: true },
  });
  const externalPresence = await tx.externalRequestPresence.findFirst({
    where: {
      serviceRequestId,
      expiresAt: { gt: now },
    },
    select: { id: true },
  });
  return Boolean(customerPresence || externalPresence);
}

export function updateExternalPresence(
  actor: ExternalActor,
  requestId: string,
  input: PresenceInput,
  /**
   * 已鉴权的 ExternalEmbedSession.id。IP 与 UA 记在会话上，「客户设备与网络」
   * 靠这一列去连；input.sessionId 是前端 crypto.randomUUID 生成的每标签页临时 id，
   * 跟会话表没有任何关系，拿它连永远连不上。
   */
  embedSessionId?: string,
) {
  return withExternalActorDb(actor, async (tx) => {
    const request = await tx.serviceRequest.findFirst({
      where: {
        id: requestId,
        projectId: actor.projectId,
        createdByExternalContactId: actor.id,
      },
      select: {
        id: true,
        projectId: true,
        project: { select: { customerSpaceId: true } },
      },
    });
    if (!request) {
      throw new DomainError("REQUEST_NOT_FOUND", "服务请求不存在", 404);
    }
    const now = new Date();
    const wasOnline = await isCustomerGroupOnline(tx, request.id, now);
    // 顺带清理过了保留期的行。不能按 expiresAt <= now 清 —— 离开时是把行标成
    // 已过期而不是删掉（见下），立刻清就等于没保留。真正的兜底是
    // request-presence-sweep 定时任务，这里只是顺手。
    await tx.externalRequestPresence.deleteMany({
      where: {
        expiresAt: { lt: new Date(now.getTime() - PRESENCE_RETENTION_MS) },
      },
    });
    if (input.action === "heartbeat" || (input.action === "typing" && input.typing)) {
      await tx.externalRequestPresence.upsert({
        where: {
          serviceRequestId_externalContactId_sessionId: {
            serviceRequestId: request.id,
            externalContactId: actor.id,
            sessionId: input.sessionId,
          },
        },
        create: {
          serviceRequestId: request.id,
          externalContactId: actor.id,
          sessionId: input.sessionId,
          embedSessionId,
          expiresAt: new Date(now.getTime() + PRESENCE_TTL_MS),
        },
        update: {
          expiresAt: new Date(now.getTime() + PRESENCE_TTL_MS),
          // 同一标签页换了会话（重新进入）时要跟上，否则设备信息停在旧会话
          ...(embedSessionId ? { embedSessionId } : {}),
        },
      });
      await tx.externalContact.update({
        where: { id: actor.id },
        data: { lastSeenAt: now },
      });
    } else if (input.action === "leave") {
      // 与站内 presence 同理：不删行，只标成已过期。这张表是「客户设备与网络」
      // 里外部联系人那半边的数据来源（SQL 函数从它连到 ExternalEmbedSession 取
      // IP/UA），删掉的话对方一关页面，后台就再也看不到工单真正提交者的设备信息。
      await tx.externalRequestPresence.updateMany({
        where: {
          serviceRequestId: request.id,
          externalContactId: actor.id,
          sessionId: input.sessionId,
        },
        data: { expiresAt: now },
      });
    }
    const isOnline = await isCustomerGroupOnline(tx, request.id, now);
    if (wasOnline !== isOnline) {
      await publishEvent(tx, {
        type: "REQUEST_PRESENCE_CHANGED",
        customerSpaceId: request.project.customerSpaceId,
        projectId: request.projectId,
        serviceRequestId: request.id,
        payload: {
          actorType: "EXTERNAL_CONTACT",
          actorId: actor.id,
          requestId: request.id,
          group: "CUSTOMER",
          online: isOnline,
        },
      });
    }
    const staffPresences = await tx.requestPresence.findMany({
      where: {
        serviceRequestId: request.id,
        expiresAt: { gt: now },
        user: { platformRole: { not: "CUSTOMER" } },
      },
      select: { userId: true },
    });
    const staffUserIds = Array.from(
      new Set(staffPresences.map((presence) => presence.userId)),
    );
    if (input.action === "typing") {
      await publishTransientEvent(tx, {
        type: "REQUEST_TYPING_CHANGED",
        userIds: staffUserIds,
        payload: {
          requestId: request.id,
          serviceRequestId: request.id,
          actorType: "EXTERNAL_CONTACT",
          actorId: actor.id,
          sessionId: input.sessionId,
          group: "CUSTOMER",
          typing: input.typing,
          visibility: "CUSTOMER_VISIBLE",
          expiresAt: new Date(
            now.getTime() + (input.typing ? TYPING_TTL_MS : 0),
          ).toISOString(),
        },
      });
    }
    // 刻意不返回站内 presence 那份 counterpartClients：外部门户自绘一个
    // 简单在线点，不展示端图标；这是对外契约，不为内部 UI 需要而加字段。
    return { counterpartOnline: staffUserIds.length > 0 };
  });
}
