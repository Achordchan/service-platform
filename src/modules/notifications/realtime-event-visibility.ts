import type { EventType, Prisma } from "@/generated/prisma/client";

export function canReceiveRequestRealtimeEvent(
  isStaff: boolean,
  customerRequestsEnabled: boolean,
) {
  return isStaff || customerRequestsEnabled;
}

export function canReceiveProjectRealtimeEvent(input: {
  isStaff: boolean;
  type: EventType;
  payload: Prisma.JsonValue;
  customerUpdatesEnabled: boolean;
  customerFilesEnabled: boolean;
  showMilestones: boolean;
  showProgress: boolean;
}) {
  if (input.isStaff) return true;
  if (
    isProjectUpdateModuleEvent(input.type, input.payload) &&
    !input.customerUpdatesEnabled
  ) {
    return false;
  }
  if (
    isProjectFileModuleEvent(input.type, input.payload) &&
    !input.customerFilesEnabled
  ) {
    return false;
  }
  if (
    isProjectMilestoneEvent(input.type, input.payload) &&
    !input.showMilestones &&
    !input.showProgress
  ) {
    return false;
  }
  return true;
}

function isProjectUpdateModuleEvent(
  type: EventType,
  payload: Prisma.JsonValue,
) {
  if (type === "PROJECT_UPDATE_CREATED" || type === "UPDATE_COMMENT_CREATED") {
    return true;
  }
  const change = eventPayloadString(payload, "change");
  return (
    change === "PROJECT_UPDATE_UPDATED" ||
    change === "UPDATE_COMMENT_UPDATED"
  );
}

function isProjectFileModuleEvent(type: EventType, payload: Prisma.JsonValue) {
  if (type !== "PROJECT_UPDATED") return false;
  const change = eventPayloadString(payload, "change");
  return (
    change === "PROJECT_ATTACHMENT_UPLOADED" ||
    change === "ATTACHMENT_OPTIMIZED"
  );
}

function isProjectMilestoneEvent(type: EventType, payload: Prisma.JsonValue) {
  if (type !== "PROJECT_UPDATED") return false;
  const change = eventPayloadString(payload, "change");
  return (
    change === "MILESTONE_CREATED" ||
    change === "MILESTONE_UPDATED" ||
    change === "MILESTONE_DELETED"
  );
}

function eventPayloadString(payload: Prisma.JsonValue, key: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const value = payload[key];
  return typeof value === "string" ? value : null;
}
