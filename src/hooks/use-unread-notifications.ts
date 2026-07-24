"use client";

import { useCallback, useEffect, useState } from "react";
import {
  subscribeRealtime,
  subscribeRealtimeReady,
  type RealtimeEventType,
} from "@/lib/realtime-client";

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
  const [unread, setUnread] = useState<UnreadNotificationSummary>(EMPTY_SUMMARY);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/notifications/summary", {
        cache: "no-store",
      });
      if (!response.ok) return;
      const result = (await response.json()) as {
        data: UnreadNotificationSummary;
      };
      setUnread(result.data);
    } catch {
      // Keep the last known unread state during transient network failures.
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    const unsubscribeEvents = subscribeRealtime(streamTypes, (event) => {
      if (event.live) void refresh();
    });
    const unsubscribeReady = subscribeRealtimeReady(() => void refresh());
    const onLocal = () => void refresh();
    window.addEventListener("notifications-updated", onLocal);
    return () => {
      window.clearTimeout(timer);
      unsubscribeEvents();
      unsubscribeReady();
      window.removeEventListener("notifications-updated", onLocal);
    };
  }, [refresh]);

  return { unread, refresh };
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
