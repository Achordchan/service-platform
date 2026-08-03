"use client";

import { useCallback, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  subscribeRealtime,
  subscribeRealtimeReady,
  type RealtimeEventType,
} from "@/lib/realtime-client";
import { apiRequest, jsonRequest } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

const streamTypes: readonly RealtimeEventType[] = [
  "NOTIFICATION_CREATED",
  "PROJECT_UPDATED",
];

export type UnreadNotificationSummary = {
  totalUnread: number;
  navigation: { projects: boolean; requests: boolean };
  projectDeliveryCounts: Record<string, number>;
  projectUpdateCounts: Record<string, number>;
  projectStageCounts: Record<string, number>;
  projectMilestoneCounts: Record<string, number>;
  projectFileCounts: Record<string, number>;
  projectRequestCounts: Record<string, number>;
  requestUnreadCounts: Record<
    string,
    { projectId: string | null; count: number }
  >;
};

const EMPTY_SUMMARY: UnreadNotificationSummary = {
  totalUnread: 0,
  navigation: { projects: false, requests: false },
  projectDeliveryCounts: {},
  projectUpdateCounts: {},
  projectStageCounts: {},
  projectMilestoneCounts: {},
  projectFileCounts: {},
  projectRequestCounts: {},
  requestUnreadCounts: {},
};

export function useUnreadNotifications() {
  const queryClient = useQueryClient();
  const summaryQuery = useQuery({
    queryKey: queryKeys.notifications.summary,
    queryFn: ({ signal }) =>
      apiRequest<UnreadNotificationSummary>(
        "/api/v1/notifications/summary",
        { cache: "no-store", signal },
        "未读通知加载失败",
      ),
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.notifications.summary,
    });
  }, [queryClient]);

  useEffect(() => {
    const unsubscribeEvents = subscribeRealtime(streamTypes, (event) => {
      if (event.live) void refresh();
    });
    const unsubscribeReady = subscribeRealtimeReady(() => void refresh());
    const onLocal = () => void refresh();
    window.addEventListener("notifications-updated", onLocal);
    return () => {
      unsubscribeEvents();
      unsubscribeReady();
      window.removeEventListener("notifications-updated", onLocal);
    };
  }, [refresh]);

  return { unread: summaryQuery.data ?? EMPTY_SUMMARY, refresh };
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      projectId: string;
      projectScope: "overview" | "updates" | "milestones" | "files";
    }) =>
      apiRequest<void>(
        "/api/v1/notifications",
        jsonRequest("PATCH", input),
        "通知状态更新失败",
      ),
    onSuccess: async (_, input) => {
      window.dispatchEvent(
        new CustomEvent("notifications-updated", { detail: input }),
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.notifications.summary,
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.notifications.list,
        }),
      ]);
    },
  });
}

export function countProjectDeliveryUnread(
  unread: UnreadNotificationSummary,
  projectId: string,
) {
  return unread.projectDeliveryCounts[projectId] ?? 0;
}

export function countProjectUpdateUnread(
  unread: UnreadNotificationSummary,
  projectId: string,
) {
  return unread.projectUpdateCounts[projectId] ?? 0;
}

export function countProjectScopeUnread(
  unread: UnreadNotificationSummary,
  projectId: string,
  scope: "overview" | "updates" | "milestones" | "files",
) {
  if (scope === "overview") return unread.projectStageCounts[projectId] ?? 0;
  if (scope === "updates") return unread.projectUpdateCounts[projectId] ?? 0;
  if (scope === "milestones") {
    return unread.projectMilestoneCounts[projectId] ?? 0;
  }
  return unread.projectFileCounts[projectId] ?? 0;
}

export function countProjectRequestUnread(
  unread: UnreadNotificationSummary,
  projectId: string,
  requestIds?: Set<string>,
) {
  if (!requestIds) return unread.projectRequestCounts[projectId] ?? 0;
  let count = 0;
  for (const requestId of requestIds) {
    count += unread.requestUnreadCounts[requestId]?.count ?? 0;
  }
  return count;
}

export function countRequestStatusUnread(
  unread: UnreadNotificationSummary,
  requests: Array<{
    id: string;
    status: string;
    projectId?: string;
    archivedAt?: string | null;
  }>,
  status?: string,
  projectId?: string,
) {
  if (!status || status === "ALL") return 0;

  let count = 0;
  for (const request of requests) {
    const unreadCount = unread.requestUnreadCounts[request.id]?.count ?? 0;
    if (unreadCount === 0) continue;
    if (projectId && request.projectId && request.projectId !== projectId) {
      continue;
    }
    if (status === "ARCHIVED" && !request.archivedAt) continue;
    if (status !== "ARCHIVED" && request.archivedAt) continue;
    if (
      status &&
      status !== "ALL" &&
      status !== "ARCHIVED" &&
      request.status !== status
    ) {
      continue;
    }
    count += unreadCount;
  }
  return count;
}
