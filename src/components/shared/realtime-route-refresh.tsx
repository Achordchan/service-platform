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
    "CONTENT_RISK_REVIEW_UPDATED",
    "PLUGIN_RUN_UPDATED",
  ],
  "project-list": [
    "PROJECT_UPDATED",
    "PROJECT_UPDATE_CREATED",
    "REQUEST_CREATED",
    "CONTENT_RISK_REVIEW_UPDATED",
    "PLUGIN_RUN_UPDATED",
  ],
  "request-list": [
    "PROJECT_UPDATED",
    "REQUEST_CREATED",
    "REQUEST_ASSIGNED",
    "REQUEST_MESSAGE_CREATED",
    "REQUEST_STATUS_CHANGED",
    "REQUEST_UPDATED",
    "CONTENT_RISK_REVIEW_UPDATED",
    "PLUGIN_RUN_UPDATED",
  ],
};

export function RealtimeRouteRefresh({
  mode,
  projectId,
  projectDeletedRedirect,
}: {
  mode: keyof typeof eventSets;
  projectId?: string;
  projectDeletedRedirect?: string;
}) {
  useRealtimeRouteRefresh({
    eventTypes: eventSets[mode],
    projectId,
    projectDeletedRedirect,
  });
  return null;
}
