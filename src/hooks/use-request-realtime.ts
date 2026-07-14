"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { bindUiSoundUnlock, playRequestUpdateSound } from "@/lib/ui-sound";

const REQUEST_LIVE_EVENTS = [
  "REQUEST_MESSAGE_CREATED",
  "REQUEST_STATUS_CHANGED",
  "REQUEST_ASSIGNED",
] as const;

type LiveEventPayload = {
  requestId?: string;
  serviceRequestId?: string;
  actorId?: string;
  eventId?: string;
};

function matchesRequest(payload: LiveEventPayload, requestId: string) {
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
  const liveReadyRef = useRef(false);
  const enableSound = options?.enableSound !== false;
  const currentUserId = options?.currentUserId;

  useEffect(() => {
    bindUiSoundUnlock();
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

    liveReadyRef.current = false;
    const source = new EventSource("/api/v1/notifications/stream");

    // First backlog from SSE is historical catch-up; only live events should chime.
    const markLiveReady = () => {
      window.setTimeout(() => {
        liveReadyRef.current = true;
      }, 600);
    };
    source.addEventListener("open", markLiveReady);

    const handleEvent = (event: MessageEvent<string>) => {
      let payload: LiveEventPayload = {};
      try {
        payload = JSON.parse(event.data) as LiveEventPayload;
      } catch {
        return;
      }
      if (!matchesRequest(payload, requestId)) return;

      // Ignore historical replay when the stream first connects.
      if (!liveReadyRef.current) {
        return;
      }

      const isLocalWindow = Date.now() < suppressUntilRef.current;
      const isOwnEvent =
        Boolean(currentUserId) && payload.actorId === currentUserId;

      if (enableSound && !isLocalWindow && !isOwnEvent) {
        playRequestUpdateSound();
      }

      if (!isLocalWindow || !isOwnEvent) {
        router.refresh();
      }
    };

    for (const type of REQUEST_LIVE_EVENTS) {
      source.addEventListener(type, handleEvent as EventListener);
    }

    return () => {
      source.removeEventListener("open", markLiveReady);
      for (const type of REQUEST_LIVE_EVENTS) {
        source.removeEventListener(type, handleEvent as EventListener);
      }
      source.close();
    };
  }, [currentUserId, enableSound, requestId, router]);
}

/** Call after local send/assign/status so we skip self-chime briefly. */
export function markRequestLocalMutation() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("request-local-mutation"));
}
