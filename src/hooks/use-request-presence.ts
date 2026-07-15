"use client";

import { useEffect, useRef, useState } from "react";
import {
  subscribeRealtime,
  type RealtimeEventType,
} from "@/lib/realtime-client";

const HEARTBEAT_MS = 25_000;
const PRESENCE_EVENTS: readonly RealtimeEventType[] = [
  "REQUEST_PRESENCE_CHANGED",
];

type PresenceGroup = "CUSTOMER" | "STAFF";

function createSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useRequestPresence(
  requestId: string,
  currentGroup: PresenceGroup,
) {
  const [counterpartOnline, setCounterpartOnline] = useState(false);
  const sessionIdRef = useRef("");

  useEffect(() => {
    if (!requestId) return;
    sessionIdRef.current ||= createSessionId();
    let active = true;
    let heartbeatTimer: number | null = null;

    async function report(
      action: "heartbeat" | "leave",
      keepalive = false,
    ) {
      try {
        const response = await fetch(
          `/api/v1/requests/${requestId}/presence`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: sessionIdRef.current,
              action,
            }),
            keepalive,
          },
        );
        if (!response.ok || !active || action !== "heartbeat") return;
        const result = (await response.json()) as {
          data?: { counterpartOnline?: boolean };
        };
        setCounterpartOnline(Boolean(result.data?.counterpartOnline));
      } catch {
        if (active && action === "heartbeat") {
          setCounterpartOnline(false);
        }
      }
    }

    function stopHeartbeat(sendLeave: boolean) {
      if (heartbeatTimer !== null) {
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (sendLeave) void report("leave", true);
    }

    function startHeartbeat() {
      if (document.visibilityState !== "visible") return;
      void report("heartbeat");
      if (heartbeatTimer === null) {
        heartbeatTimer = window.setInterval(() => {
          void report("heartbeat");
        }, HEARTBEAT_MS);
      }
    }

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        startHeartbeat();
      } else {
        stopHeartbeat(true);
        setCounterpartOnline(false);
      }
    }

    function handlePageHide() {
      stopHeartbeat(true);
    }

    const unsubscribe = subscribeRealtime(PRESENCE_EVENTS, (event) => {
      const payload = event.payload;
      if (
        payload.requestId !== requestId &&
        payload.serviceRequestId !== requestId
      ) {
        return;
      }
      if (payload.group === currentGroup) return;
      setCounterpartOnline(payload.online === true);
    });

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);
    startHeartbeat();

    return () => {
      active = false;
      stopHeartbeat(true);
      unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [currentGroup, requestId]);

  return counterpartOnline;
}
