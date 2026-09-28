import "server-only";

import { checkRateLimit } from "@/lib/rate-limit";
import { withSystemDb } from "@/lib/system-db";
import {
  UNIVERSAL_RATE_WINDOW_MS,
  UNIVERSAL_UNREAD_MAX_REQUESTS,
  UNIVERSAL_UNREAD_RATE_LIMIT,
} from "@/modules/integrations/universal/constants";
import type { UniversalLaunchAuthentication } from "@/modules/integrations/universal/ticket-service";
import { DomainError } from "@/modules/projects/errors";

export function universalUnreadRateLimitKey(bindingId: string) {
  return `achord-connect:unread:${bindingId}`;
}

/**
 * 服务器之间查询某个外部用户的未读情况（接入方启动时 / Webhook 丢失后重建红点）。
 * 只看当前凭据所属连接下的联系人；联系人不存在时与「没有未读」返回完全相同，
 * 不泄露该用户是否来过。口径与门户列表一致：本项目、本人创建、未归档。
 */
export async function getUniversalContactUnread(
  authentication: UniversalLaunchAuthentication,
  externalUserId: string,
) {
  if (
    !checkRateLimit(
      universalUnreadRateLimitKey(authentication.bindingId),
      UNIVERSAL_UNREAD_RATE_LIMIT,
      UNIVERSAL_RATE_WINDOW_MS,
    )
  ) {
    throw new DomainError(
      "UNIVERSAL_RATE_LIMITED",
      "未读查询过于频繁，请稍后重试",
      429,
    );
  }
  return withSystemDb(async (tx) => {
    const contact = await tx.externalContact.findUnique({
      where: {
        bindingId_externalUserId: {
          bindingId: authentication.bindingId,
          externalUserId,
        },
      },
      select: { id: true, binding: { select: { projectId: true } } },
    });
    if (!contact) {
      return { externalUserId, unreadCount: 0, requests: [] };
    }
    const unreadWhere = {
      externalContactId: contact.id,
      unreadCount: { gt: 0 },
      serviceRequest: {
        projectId: contact.binding.projectId,
        createdByExternalContactId: contact.id,
        archivedAt: null,
      },
    };
    const total = await tx.externalRequestReadState.aggregate({
      where: unreadWhere,
      _sum: { unreadCount: true },
    });
    const states = await tx.externalRequestReadState.findMany({
      where: unreadWhere,
      select: {
        unreadCount: true,
        serviceRequest: {
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            updatedAt: true,
          },
        },
      },
      orderBy: [
        { serviceRequest: { updatedAt: "desc" } },
        { serviceRequestId: "desc" },
      ],
      take: UNIVERSAL_UNREAD_MAX_REQUESTS,
    });
    return {
      externalUserId,
      unreadCount: total._sum.unreadCount ?? 0,
      requests: states.map((state) => ({
        id: state.serviceRequest.id,
        number: state.serviceRequest.number,
        title: state.serviceRequest.title,
        status: state.serviceRequest.status,
        unreadCount: state.unreadCount,
        updatedAt: state.serviceRequest.updatedAt.toISOString(),
      })),
    };
  });
}
