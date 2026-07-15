"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  subscribeRealtime,
  subscribeRealtimeReady,
  type RealtimeEventType,
} from "@/lib/realtime-client";

export type UnreadNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt?: string | null;
  projectId?: string | null;
  serviceRequestId?: string | null;
  createdAt: string;
};

const streamTypes: readonly RealtimeEventType[] = [
  "NOTIFICATION_CREATED",
  "PROJECT_UPDATE_CREATED",
  "UPDATE_COMMENT_CREATED",
  "REQUEST_CREATED",
  "REQUEST_ASSIGNED",
  "REQUEST_MESSAGE_CREATED",
  "REQUEST_STATUS_CHANGED",
];

export function useUnreadNotifications() {
  const [items, setItems] = useState<UnreadNotification[]>([]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/notifications", {
        cache: "no-store",
      });
      if (!response.ok) return;
      const result = (await response.json()) as { data: UnreadNotification[] };
      setItems(result.data.filter((item) => !item.readAt));
    } catch {
      // ignore transient network errors
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    const unsubscribeEvents = subscribeRealtime(streamTypes, (event) => {
      if (event.live) void refresh();
    });
    const unsubscribeReady = subscribeRealtimeReady(() => {
      void refresh();
    });
    const onLocal = () => void refresh();
    window.addEventListener("notifications-updated", onLocal);
    return () => {
      window.clearTimeout(timer);
      unsubscribeEvents();
      unsubscribeReady();
      window.removeEventListener("notifications-updated", onLocal);
    };
  }, [refresh]);

  const unread = useMemo(() => items, [items]);

  return { unread, refresh };
}

export function isProjectUpdateNotification(item: UnreadNotification) {
  return (
    item.type === "PROJECT_UPDATE" ||
    item.type === "UPDATE_COMMENT" ||
    item.type === "PROJECT_UPDATE_CREATED" ||
    item.type === "UPDATE_COMMENT_CREATED"
  );
}

export function isRequestNotification(item: UnreadNotification) {
  return Boolean(item.serviceRequestId) || item.type.startsWith("REQUEST_");
}

export function countProjectUpdateUnread(
  unread: UnreadNotification[],
  projectId: string,
) {
  return unread.filter(
    (item) => item.projectId === projectId && isProjectUpdateNotification(item),
  ).length;
}

export function countProjectRequestUnread(
  unread: UnreadNotification[],
  projectId: string,
  requestIds?: Set<string>,
) {
  return unread.filter((item) => {
    if (!isRequestNotification(item)) return false;
    if (item.projectId === projectId) return true;
    if (item.serviceRequestId && requestIds?.has(item.serviceRequestId)) {
      return true;
    }
    return false;
  }).length;
}

export function countRequestStatusUnread(
  unread: UnreadNotification[],
  requests: Array<{ id: string; status: string; projectId?: string }>,
  status?: string,
  projectId?: string,
) {
  const requestMap = new Map(requests.map((item) => [item.id, item]));
  let count = 0;
  for (const item of unread) {
    if (!item.serviceRequestId) continue;
    const request = requestMap.get(item.serviceRequestId);
    if (!request) continue;
    if (projectId && request.projectId && request.projectId !== projectId) {
      continue;
    }
    if (status && status !== "ALL" && request.status !== status) continue;
    count += 1;
  }
  return count;
}
