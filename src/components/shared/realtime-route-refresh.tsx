"use client";

import { useRealtimeRouteRefresh } from "@/hooks/use-realtime-route-refresh";
import type { RealtimeEventType } from "@/lib/realtime-client";

const eventSets: Record<
  "project-detail" | "project-list" | "request-list",
  readonly RealtimeEventType[]
> = {
  "project-detail": [
    "PROJECT_UPDATED",
    "PROJECT_UPDATE_CREATED",
    "UPDATE_COMMENT_CREATED",
    "REQUEST_CREATED",
    "REQUEST_ASSIGNED",
    "REQUEST_MESSAGE_CREATED",
    "REQUEST_STATUS_CHANGED",
    "REQUEST_UPDATED",
  ],
  "project-list": [
    "PROJECT_UPDATED",
    "PROJECT_UPDATE_CREATED",
    "REQUEST_CREATED",
  ],
  "request-list": [
    "REQUEST_CREATED",
    "REQUEST_ASSIGNED",
    "REQUEST_MESSAGE_CREATED",
    "REQUEST_STATUS_CHANGED",
    "REQUEST_UPDATED",
  ],
};

export function RealtimeRouteRefresh({
  mode,
  projectId,
}: {
  mode: keyof typeof eventSets;
  projectId?: string;
}) {
  useRealtimeRouteRefresh({
    eventTypes: eventSets[mode],
    projectId,
  });
  return null;
}
