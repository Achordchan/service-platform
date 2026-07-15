"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  matchesRealtimeScope,
  subscribeRealtime,
  subscribeRealtimeReady,
  type RealtimeEventType,
} from "@/lib/realtime-client";

export function useRealtimeRouteRefresh(input: {
  eventTypes: readonly RealtimeEventType[];
  projectId?: string;
  requestId?: string;
}) {
  const router = useRouter();
  const pendingCatchupRef = useRef(false);
  const refreshTimerRef = useRef<number | null>(null);
  const hiddenAtRef = useRef<number | null>(null);
  const eventTypesKey = input.eventTypes.join("|");

  useEffect(() => {
    const scheduleRefresh = () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        router.refresh();
      }, 120);
    };

    const unsubscribeEvents = subscribeRealtime(
      input.eventTypes,
      (event) => {
        if (
          !matchesRealtimeScope(event.payload, {
            projectId: input.projectId,
            requestId: input.requestId,
          })
        ) {
          return;
        }
        if (event.live) {
          scheduleRefresh();
        } else {
          pendingCatchupRef.current = true;
        }
      },
    );
    const unsubscribeReady = subscribeRealtimeReady(({ reconnected }) => {
      if (pendingCatchupRef.current || reconnected) {
        pendingCatchupRef.current = false;
        scheduleRefresh();
      }
    });

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        return;
      }
      if (hiddenAtRef.current !== null) {
        hiddenAtRef.current = null;
        scheduleRefresh();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      unsubscribeEvents();
      unsubscribeReady();
      document.removeEventListener("visibilitychange", handleVisibility);
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [
    eventTypesKey,
    input.eventTypes,
    input.projectId,
    input.requestId,
    router,
  ]);
}
