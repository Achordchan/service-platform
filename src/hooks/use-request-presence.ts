"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  subscribeRealtime,
  type RealtimeEventType,
} from "@/lib/realtime-client";

const HEARTBEAT_MS = 30_000;
const TYPING_IDLE_MS = 2_200;
const TYPING_RENEW_MS = 8_000;
const REMOTE_TYPING_FALLBACK_MS = 12_000;
const PRESENCE_EVENTS: readonly RealtimeEventType[] = [
  "REQUEST_PRESENCE_CHANGED",
  "REQUEST_TYPING_CHANGED",
];

type PresenceGroup = "CUSTOMER" | "STAFF";
export type RequestTypingVisibility = "CUSTOMER_VISIBLE" | "INTERNAL";

type PresenceReport =
  | { action: "heartbeat" | "leave" }
  | {
      action: "typing";
      typing: boolean;
      visibility: RequestTypingVisibility;
    };

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
  const [counterpartTyping, setCounterpartTyping] = useState(false);
  const sessionIdRef = useRef("");
  const sendRef = useRef<
    ((payload: PresenceReport, keepalive?: boolean) => void) | null
  >(null);
  const localTypingRef = useRef(false);
  const localTypingVisibilityRef =
    useRef<RequestTypingVisibility>("CUSTOMER_VISIBLE");
  const typingIdleTimerRef = useRef<number | null>(null);
  const typingRenewTimerRef = useRef<number | null>(null);
  const counterpartTypingTimerRef = useRef<number | null>(null);
  const counterpartTypingSessionsRef = useRef(new Map<string, number>());

  const clearLocalTypingTimers = useCallback(() => {
    if (typingIdleTimerRef.current !== null) {
      window.clearTimeout(typingIdleTimerRef.current);
      typingIdleTimerRef.current = null;
    }
    if (typingRenewTimerRef.current !== null) {
      window.clearInterval(typingRenewTimerRef.current);
      typingRenewTimerRef.current = null;
    }
  }, []);

  const stopTypingInternal = useCallback(
    (keepalive = false) => {
      clearLocalTypingTimers();
      if (!localTypingRef.current) return;
      localTypingRef.current = false;
      sendRef.current?.(
        {
          action: "typing",
          typing: false,
          visibility: localTypingVisibilityRef.current,
        },
        keepalive,
      );
    },
    [clearLocalTypingTimers],
  );

  const stopTyping = useCallback(() => {
    stopTypingInternal();
  }, [stopTypingInternal]);

  const refreshCounterpartTypingState = useCallback(
    function refreshTypingSessions() {
      const now = Date.now();
      for (const [
        sessionKey,
        expiresAt,
      ] of counterpartTypingSessionsRef.current) {
        if (expiresAt <= now) {
          counterpartTypingSessionsRef.current.delete(sessionKey);
        }
      }
      setCounterpartTyping(counterpartTypingSessionsRef.current.size > 0);
      if (counterpartTypingTimerRef.current !== null) {
        window.clearTimeout(counterpartTypingTimerRef.current);
        counterpartTypingTimerRef.current = null;
      }
      const nextExpiry = Math.min(
        ...counterpartTypingSessionsRef.current.values(),
      );
      if (Number.isFinite(nextExpiry)) {
        counterpartTypingTimerRef.current = window.setTimeout(
          refreshTypingSessions,
          Math.max(0, nextExpiry - now),
        );
      }
    },
    [],
  );

  const reportTypingActivity = useCallback(
    (visibility: RequestTypingVisibility = "CUSTOMER_VISIBLE") => {
      const sender = sendRef.current;
      if (!sender) return;

      if (
        localTypingRef.current &&
        localTypingVisibilityRef.current !== visibility
      ) {
        sender({
          action: "typing",
          typing: false,
          visibility: localTypingVisibilityRef.current,
        });
        clearLocalTypingTimers();
        localTypingRef.current = false;
      }

      localTypingVisibilityRef.current = visibility;
      if (!localTypingRef.current) {
        localTypingRef.current = true;
        sender({ action: "typing", typing: true, visibility });
        typingRenewTimerRef.current = window.setInterval(() => {
          if (!localTypingRef.current) return;
          sendRef.current?.({
            action: "typing",
            typing: true,
            visibility: localTypingVisibilityRef.current,
          });
        }, TYPING_RENEW_MS);
      }

      if (typingIdleTimerRef.current !== null) {
        window.clearTimeout(typingIdleTimerRef.current);
      }
      typingIdleTimerRef.current = window.setTimeout(() => {
        stopTypingInternal();
      }, TYPING_IDLE_MS);
    },
    [clearLocalTypingTimers, stopTypingInternal],
  );

  useEffect(() => {
    if (!requestId) return;
    sessionIdRef.current ||= createSessionId();
    const counterpartTypingSessions =
      counterpartTypingSessionsRef.current;
    let active = true;
    let reportQueue = Promise.resolve();

    async function report(payload: PresenceReport, keepalive = false) {
      try {
        const response = await fetch(
          `/api/v1/requests/${requestId}/presence`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: sessionIdRef.current,
              ...payload,
            }),
            keepalive,
          },
        );
        if (!response.ok || !active || payload.action !== "heartbeat") return;
        const result = (await response.json()) as {
          data?: { counterpartOnline?: boolean };
        };
        setCounterpartOnline(Boolean(result.data?.counterpartOnline));
      } catch {
        // Keep the last known state during a temporary network interruption.
      }
    }

    sendRef.current = (payload, keepalive = false) => {
      if (keepalive) {
        void report(payload, true);
        return;
      }
      reportQueue = reportQueue.then(() => report(payload));
    };

    function refreshHeartbeat() {
      sendRef.current?.({ action: "heartbeat" });
    }

    function handlePageHide() {
      stopTypingInternal(true);
      void report({ action: "leave" }, true);
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

      if (event.type === "REQUEST_PRESENCE_CHANGED") {
        setCounterpartOnline(payload.online === true);
        return;
      }

      const sessionId =
        typeof payload.sessionId === "string" ? payload.sessionId : "default";
      const actorId =
        typeof payload.actorId === "string"
          ? payload.actorId
          : String(payload.group ?? "counterpart");
      const sessionKey = `${actorId}:${sessionId}`;
      if (payload.typing !== true) {
        counterpartTypingSessionsRef.current.delete(sessionKey);
        refreshCounterpartTypingState();
        return;
      }
      const expiresAt =
        typeof payload.expiresAt === "string"
          ? Date.parse(payload.expiresAt)
          : Number.NaN;
      const remaining = Number.isFinite(expiresAt)
        ? expiresAt - Date.now()
        : REMOTE_TYPING_FALLBACK_MS;
      if (remaining <= 0) {
        counterpartTypingSessionsRef.current.delete(sessionKey);
        refreshCounterpartTypingState();
        return;
      }
      counterpartTypingSessionsRef.current.set(
        sessionKey,
        Date.now() + Math.min(remaining, REMOTE_TYPING_FALLBACK_MS),
      );
      refreshCounterpartTypingState();
    });

    const heartbeatTimer = window.setInterval(
      refreshHeartbeat,
      HEARTBEAT_MS,
    );
    document.addEventListener("visibilitychange", refreshHeartbeat);
    window.addEventListener("focus", refreshHeartbeat);
    window.addEventListener("pageshow", refreshHeartbeat);
    window.addEventListener("pagehide", handlePageHide);
    refreshHeartbeat();

    return () => {
      stopTypingInternal(true);
      void report({ action: "leave" }, true);
      active = false;
      sendRef.current = null;
      window.clearInterval(heartbeatTimer);
      if (counterpartTypingTimerRef.current !== null) {
        window.clearTimeout(counterpartTypingTimerRef.current);
        counterpartTypingTimerRef.current = null;
      }
      counterpartTypingSessions.clear();
      unsubscribe();
      document.removeEventListener("visibilitychange", refreshHeartbeat);
      window.removeEventListener("focus", refreshHeartbeat);
      window.removeEventListener("pageshow", refreshHeartbeat);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [
    currentGroup,
    refreshCounterpartTypingState,
    requestId,
    stopTypingInternal,
  ]);

  return {
    counterpartOnline,
    counterpartTyping,
    reportTypingActivity,
    stopTyping,
  };
}
