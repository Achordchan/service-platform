"use client";

import { useEffect, useRef } from "react";
import {
  subscribeRealtime,
  subscribeRealtimeReady,
  type RealtimeEventType,
} from "@/lib/realtime-client";

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
  const lastMarkedAtRef = useRef(0);

  useEffect(() => {
    if (!requestId) return;

    let cancelled = false;
    let pendingCatchup = false;

    async function markRead() {
      const now = Date.now();
      // Debounce bursts from SSE + initial mount.
      if (now - lastMarkedAtRef.current < 400) return;
      lastMarkedAtRef.current = now;
      try {
        const response = await fetch("/api/v1/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serviceRequestId: requestId }),
        });
        if (!response.ok || cancelled) return;
        window.dispatchEvent(
          new CustomEvent("notifications-updated", {
            detail: { serviceRequestId: requestId },
          }),
        );
      } catch {
        // Non-blocking UX helper; ignore network blips.
      }
    }

    void markRead();

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
      window.setTimeout(() => {
        if (!cancelled) void markRead();
      }, 250);
    });
    const unsubscribeReady = subscribeRealtimeReady(() => {
      if (!pendingCatchup) return;
      pendingCatchup = false;
      void markRead();
    });

    return () => {
      cancelled = true;
      unsubscribeEvents();
      unsubscribeReady();
    };
  }, [requestId]);
}
