"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  subscribeRealtime,
  subscribeRealtimeReady,
  type RealtimeEventType,
} from "@/lib/realtime-client";
import {
  bindTabAttentionReset,
  startTabAttention,
} from "@/lib/tab-attention";

const REQUEST_LIVE_EVENTS: readonly RealtimeEventType[] = [
  "PROJECT_UPDATED",
  "REQUEST_MESSAGE_CREATED",
  "REQUEST_STATUS_CHANGED",
  "REQUEST_ASSIGNED",
  "REQUEST_UPDATED",
  "CONTENT_RISK_REVIEW_UPDATED",
  "PLUGIN_RUN_UPDATED",
] as const;

function matchesRequest(
  payload: { requestId?: string; serviceRequestId?: string | null },
  requestId: string,
) {
  return (
    payload.requestId === requestId || payload.serviceRequestId === requestId
  );
}

/**
 * Keep a service-request detail page in sync via existing SSE stream.
 */
export function useRequestRealtime(
  requestId: string,
  options?: {
    currentUserId?: string;
    projectId?: string;
  },
) {
  const router = useRouter();
  const suppressUntilRef = useRef(0);
  const pendingCatchupRef = useRef(false);
  const refreshTimerRef = useRef<number | null>(null);
  const currentUserId = options?.currentUserId;
  const projectId = options?.projectId;

  useEffect(() => {
    bindTabAttentionReset();
    const markLocalMutation = () => {
      suppressUntilRef.current = Date.now() + 2000;
    };
    window.addEventListener("request-local-mutation", markLocalMutation);
    return () => {
      window.removeEventListener("request-local-mutation", markLocalMutation);
    };
  }, []);

  useEffect(() => {
    if (!requestId) return;
    const scheduleRefresh = () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        router.refresh();
      }, 120);
    };

    const unsubscribeEvents = subscribeRealtime(REQUEST_LIVE_EVENTS, (event) => {
      const payload = event.payload;
      const projectChanged =
        event.type === "PROJECT_UPDATED" &&
        Boolean(projectId) &&
        payload.projectId === projectId;
      const pluginChanged =
        event.type === "PLUGIN_RUN_UPDATED" && payload.scope === "GLOBAL";
      if (
        !pluginChanged &&
        !projectChanged &&
        !matchesRequest(payload, requestId)
      ) {
        return;
      }

      if (!event.live) {
        pendingCatchupRef.current = true;
        return;
      }

      const isLocalWindow = Date.now() < suppressUntilRef.current;
      const isOwnEvent =
        Boolean(currentUserId) && payload.actorId === currentUserId;
      const suppressLocalEcho =
        isLocalWindow && (isOwnEvent || !payload.actorId);

      if (
        !projectChanged &&
        event.type === "REQUEST_MESSAGE_CREATED" &&
        !suppressLocalEcho &&
        !isOwnEvent
      ) {
        startTabAttention();
      }

      if (!suppressLocalEcho) {
        scheduleRefresh();
      }
    });
    const unsubscribeReady = subscribeRealtimeReady(() => {
      if (!pendingCatchupRef.current) return;
      pendingCatchupRef.current = false;
      scheduleRefresh();
    });

    return () => {
      unsubscribeEvents();
      unsubscribeReady();
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [currentUserId, projectId, requestId, router]);
}

/** Call after local send/assign/status so local SSE echoes can be ignored. */
export function markRequestLocalMutation() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("request-local-mutation"));
}
