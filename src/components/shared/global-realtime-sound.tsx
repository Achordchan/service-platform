"use client";

import { useEffect, useRef, useState } from "react";
import {
  subscribeRealtime,
  type RealtimeEvent,
  type RealtimeEventType,
} from "@/lib/realtime-client";
import {
  bindUiSoundUnlock,
  playRealtimeUpdateSound,
  suspendUiSound,
} from "@/lib/ui-sound";

export const GLOBAL_SOUND_EVENT_TYPES: readonly RealtimeEventType[] = [
  "PROJECT_UPDATED",
  "PROJECT_UPDATE_CREATED",
  "UPDATE_COMMENT_CREATED",
  "REQUEST_CREATED",
  "REQUEST_ASSIGNED",
  "REQUEST_MESSAGE_CREATED",
  "REQUEST_STATUS_CHANGED",
  "REQUEST_UPDATED",
] as const;

export function shouldPlayGlobalRealtimeSound(
  event: RealtimeEvent,
  currentUserId: string,
  suppressUntil: number,
  now = Date.now(),
) {
  if (!event.live) return false;
  if (event.payload.audible === false) return false;
  // 发送方在「本次提醒方式」里把这个人排除了：事件照收（页面要刷新），但不响铃
  const silenced = event.payload.silencedUserIds;
  if (Array.isArray(silenced) && silenced.includes(currentUserId)) return false;
  if (event.payload.actorId) {
    if (event.payload.actorId === "system") return false;
    return event.payload.actorId !== currentUserId;
  }
  return now >= suppressUntil;
}

export function GlobalRealtimeSound({
  currentUserId,
  enabled: initialEnabled,
}: {
  currentUserId: string;
  enabled: boolean;
}) {
  const suppressUntilRef = useRef(0);
  const [enabled, setEnabled] = useState(initialEnabled);

  useEffect(() => {
    const handlePreference = (event: Event) => {
      const detail = (
        event as CustomEvent<{ soundNotificationsEnabled?: boolean }>
      ).detail;
      if (typeof detail?.soundNotificationsEnabled === "boolean") {
        setEnabled(detail.soundNotificationsEnabled);
      }
    };
    window.addEventListener("notification-preferences-updated", handlePreference);
    return () => {
      window.removeEventListener(
        "notification-preferences-updated",
        handlePreference,
      );
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      suspendUiSound();
      return;
    }
    const unbindSoundUnlock = bindUiSoundUnlock();
    const markLocalMutation = () => {
      suppressUntilRef.current = Date.now() + 2_000;
    };
    window.addEventListener("request-local-mutation", markLocalMutation);
    const unsubscribe = subscribeRealtime(GLOBAL_SOUND_EVENT_TYPES, (event) => {
      if (
        shouldPlayGlobalRealtimeSound(
          event,
          currentUserId,
          suppressUntilRef.current,
        )
      ) {
        playRealtimeUpdateSound();
      }
    });
    return () => {
      window.removeEventListener("request-local-mutation", markLocalMutation);
      unsubscribe();
      unbindSoundUnlock();
    };
  }, [currentUserId, enabled]);

  return null;
}
