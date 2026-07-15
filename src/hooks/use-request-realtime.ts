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
import { bindUiSoundUnlock, playRequestUpdateSound } from "@/lib/ui-sound";

const REQUEST_LIVE_EVENTS: readonly RealtimeEventType[] = [
  "REQUEST_MESSAGE_CREATED",
  "REQUEST_STATUS_CHANGED",
  "REQUEST_ASSIGNED",
  "REQUEST_UPDATED",
] as const;

const REQUEST_SOUND_EVENTS = new Set<RealtimeEventType>([
  "REQUEST_MESSAGE_CREATED",
  "REQUEST_ASSIGNED",
]);

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
 * Plays a short chime when another party updates the current request.
 */
export function useRequestRealtime(
  requestId: string,
  options?: {
    currentUserId?: string;
    enableSound?: boolean;
  },
) {
  const router = useRouter();
  const suppressUntilRef = useRef(0);
  const pendingCatchupRef = useRef(false);
  const refreshTimerRef = useRef<number | null>(null);
  const enableSound = options?.enableSound !== false;
  const currentUserId = options?.currentUserId;

  useEffect(() => {
    bindUiSoundUnlock();
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
      if (!matchesRequest(payload, requestId)) return;

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
        enableSound &&
        REQUEST_SOUND_EVENTS.has(event.type) &&
        !suppressLocalEcho &&
        !isOwnEvent
      ) {
        playRequestUpdateSound();
      }
      if (
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
  }, [currentUserId, enableSound, requestId, router]);
}

/** Call after local send/assign/status so we skip self-chime briefly. */
export function markRequestLocalMutation() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("request-local-mutation"));
}
