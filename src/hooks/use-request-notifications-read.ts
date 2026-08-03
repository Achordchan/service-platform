"use client";

import { useEffect } from "react";
import {
  subscribeRealtime,
  subscribeRealtimeReady,
  type RealtimeEventType,
} from "@/lib/realtime-client";
import { apiRequest, jsonRequest } from "@/lib/api-client";

const liveTypes: readonly RealtimeEventType[] = [
  "REQUEST_MESSAGE_CREATED",
  "REQUEST_STATUS_CHANGED",
  "REQUEST_ASSIGNED",
  "NOTIFICATION_CREATED",
];

/**
 * When the user is on a request detail page, mark related notifications as read.
 * Also re-marks after live request events so "I'm already here" stays caught up.
 */
export function useRequestNotificationsRead(requestId: string) {
  useEffect(() => {
    if (!requestId) return;

    let cancelled = false;
    let pendingCatchup = false;
    let lastMarkedAt = 0;
    let markTimer: number | null = null;

    function isActivelyViewingRequest() {
      return document.visibilityState === "visible" && document.hasFocus();
    }

    async function markRead() {
      if (!isActivelyViewingRequest()) {
        pendingCatchup = true;
        return;
      }
      pendingCatchup = false;
      lastMarkedAt = Date.now();
      try {
        await apiRequest<void>(
          "/api/v1/notifications",
          jsonRequest("PATCH", { serviceRequestId: requestId }),
          "通知状态更新失败",
        );
        if (cancelled) return;
        window.dispatchEvent(
          new CustomEvent("notifications-updated", {
            detail: { serviceRequestId: requestId },
          }),
        );
      } catch {
        // Non-blocking UX helper; ignore network blips.
      }
    }

    function scheduleMarkRead(delay = 0) {
      const debounceDelay = Math.max(0, 400 - (Date.now() - lastMarkedAt));
      const wait = Math.max(delay, debounceDelay);
      if (markTimer !== null) window.clearTimeout(markTimer);
      markTimer = window.setTimeout(() => {
        markTimer = null;
        if (!cancelled) void markRead();
      }, wait);
    }

    function catchUpWhenActive() {
      if (!pendingCatchup || !isActivelyViewingRequest()) return;
      pendingCatchup = false;
      scheduleMarkRead();
    }

    if (isActivelyViewingRequest()) {
      scheduleMarkRead();
    } else {
      pendingCatchup = true;
    }

    const unsubscribeEvents = subscribeRealtime(liveTypes, (event) => {
      const payload = event.payload;
      if (
        payload.requestId !== requestId &&
        payload.serviceRequestId !== requestId
      ) {
        return;
      }
      if (!event.live) {
        pendingCatchup = true;
        return;
      }
      if (!isActivelyViewingRequest()) {
        pendingCatchup = true;
        return;
      }
      scheduleMarkRead(250);
    });
    const unsubscribeReady = subscribeRealtimeReady(() => {
      catchUpWhenActive();
    });
    document.addEventListener("visibilitychange", catchUpWhenActive);
    window.addEventListener("focus", catchUpWhenActive);

    return () => {
      cancelled = true;
      if (markTimer !== null) window.clearTimeout(markTimer);
      unsubscribeEvents();
      unsubscribeReady();
      document.removeEventListener("visibilitychange", catchUpWhenActive);
      window.removeEventListener("focus", catchUpWhenActive);
    };
  }, [requestId]);
}
