"use client";

import { useEffect, useRef } from "react";

/**
 * When the user is on a request detail page, mark related notifications as read.
 * Also re-marks after live request events so "I'm already here" stays caught up.
 */
export function useRequestNotificationsRead(requestId: string) {
  const lastMarkedAtRef = useRef(0);

  useEffect(() => {
    if (!requestId) return;

    let cancelled = false;

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

    const source = new EventSource("/api/v1/notifications/stream");
    const liveTypes = [
      "REQUEST_MESSAGE_CREATED",
      "REQUEST_STATUS_CHANGED",
      "REQUEST_ASSIGNED",
      "NOTIFICATION_CREATED",
    ] as const;

    const onLive = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as {
          requestId?: string;
          serviceRequestId?: string;
        };
        if (
          payload.requestId === requestId ||
          payload.serviceRequestId === requestId
        ) {
          window.setTimeout(() => {
            if (!cancelled) void markRead();
          }, 250);
        }
      } catch {
        // ignore malformed events
      }
    };

    for (const type of liveTypes) {
      source.addEventListener(type, onLive as EventListener);
    }

    return () => {
      cancelled = true;
      for (const type of liveTypes) {
        source.removeEventListener(type, onLive as EventListener);
      }
      source.close();
    };
  }, [requestId]);
}
