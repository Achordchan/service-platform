import type { NotificationType } from "@/generated/prisma/client";
import {
  PROJECT_DELIVERY_NOTIFICATION_TYPES,
  PROJECT_UPDATE_NOTIFICATION_TYPES,
  REQUEST_NOTIFICATION_TYPES,
} from "@/modules/notifications/activity-policy";

export type UnreadNotificationGroup = {
  type: NotificationType;
  projectId: string | null;
  serviceRequestId: string | null;
  _count: { _all: number };
};

export function summarizeUnreadNotificationGroups(
  unread: UnreadNotificationGroup[],
) {
  const projectDeliveryCounts = new Map<string, number>();
  const projectUpdateCounts = new Map<string, number>();
  const projectStageCounts = new Map<string, number>();
  const projectMilestoneCounts = new Map<string, number>();
  const projectFileCounts = new Map<string, number>();
  const projectRequestCounts = new Map<string, number>();
  const requestUnreadCounts = new Map<
    string,
    { projectId: string | null; count: number }
  >();
  let totalUnread = 0;

  for (const item of unread) {
    const itemCount = item._count._all;
    totalUnread += itemCount;
    incrementProjectCount(
      projectDeliveryCounts,
      item.projectId,
      PROJECT_DELIVERY_NOTIFICATION_TYPES.includes(item.type),
      itemCount,
    );
    incrementProjectCount(
      projectUpdateCounts,
      item.projectId,
      PROJECT_UPDATE_NOTIFICATION_TYPES.includes(item.type),
      itemCount,
    );
    incrementProjectCount(
      projectStageCounts,
      item.projectId,
      item.type === "PROJECT_CREATED" || item.type === "PROJECT_STAGE",
      itemCount,
    );
    incrementProjectCount(
      projectMilestoneCounts,
      item.projectId,
      item.type === "PROJECT_MILESTONE",
      itemCount,
    );
    incrementProjectCount(
      projectFileCounts,
      item.projectId,
      item.type === "PROJECT_FILE",
      itemCount,
    );
    incrementProjectCount(
      projectRequestCounts,
      item.projectId,
      REQUEST_NOTIFICATION_TYPES.includes(item.type),
      itemCount,
    );
    if (item.serviceRequestId) {
      const current = requestUnreadCounts.get(item.serviceRequestId);
      requestUnreadCounts.set(item.serviceRequestId, {
        projectId: item.projectId ?? current?.projectId ?? null,
        count: (current?.count ?? 0) + itemCount,
      });
    }
  }

  return {
    totalUnread,
    navigation: {
      projects: projectDeliveryCounts.size > 0,
      requests: requestUnreadCounts.size > 0,
    },
    projectDeliveryCounts: Object.fromEntries(projectDeliveryCounts),
    projectUpdateCounts: Object.fromEntries(projectUpdateCounts),
    projectStageCounts: Object.fromEntries(projectStageCounts),
    projectMilestoneCounts: Object.fromEntries(projectMilestoneCounts),
    projectFileCounts: Object.fromEntries(projectFileCounts),
    projectRequestCounts: Object.fromEntries(projectRequestCounts),
    requestUnreadCounts: Object.fromEntries(requestUnreadCounts),
  };
}

function incrementProjectCount(
  target: Map<string, number>,
  projectId: string | null,
  matches: boolean,
  count: number,
) {
  if (!projectId || !matches) return;
  target.set(projectId, (target.get(projectId) ?? 0) + count);
}
