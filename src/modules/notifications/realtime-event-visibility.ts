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

/**
 * 附件类事件归哪个模块，要看附件挂在谁身上 —— 与 RLS 的
 * app_project_attachment_feature_enabled 同口径：
 * 动态/评论看 customerUpdatesEnabled、里程碑看 showMilestones、
 * 项目级文件才看 customerFilesEnabled。
 *
 * 一律当成文件模块事件的话，「开着动态、关着文件」的客户收不到动态附件的刷新 ——
 * 而附件查询恰恰是放行他们看这些附件的，于是他们停在「实体已刷新、附件却没有」
 * 的版本上。
 */
function attachmentEventOwner(type: EventType, payload: Prisma.JsonValue) {
  if (type !== "PROJECT_UPDATED") return null;
  const change = eventPayloadString(payload, "change");
  if (
    change !== "PROJECT_ATTACHMENT_UPLOADED" &&
    change !== "PROJECT_ATTACHMENT_DELETED" &&
    change !== "ATTACHMENT_OPTIMIZED" &&
    change !== "ATTACHMENT_PREVIEW_READY"
  ) {
    return null;
  }
  if (eventPayloadString(payload, "projectUpdateId")) return "UPDATE" as const;
  if (eventPayloadString(payload, "updateCommentId")) return "UPDATE" as const;
  if (eventPayloadString(payload, "milestoneId")) return "MILESTONE" as const;
  return "PROJECT_FILE" as const;
}

function isProjectUpdateModuleEvent(
  type: EventType,
  payload: Prisma.JsonValue,
) {
  if (type === "PROJECT_UPDATE_CREATED" || type === "UPDATE_COMMENT_CREATED") {
    return true;
  }
  if (attachmentEventOwner(type, payload) === "UPDATE") return true;
  const change = eventPayloadString(payload, "change");
  return (
    change === "PROJECT_UPDATE_UPDATED" ||
    change === "PROJECT_UPDATE_DELETED" ||
    change === "UPDATE_COMMENT_UPDATED"
  );
}

function isProjectFileModuleEvent(type: EventType, payload: Prisma.JsonValue) {
  return attachmentEventOwner(type, payload) === "PROJECT_FILE";
}

function isProjectMilestoneEvent(type: EventType, payload: Prisma.JsonValue) {
  if (type !== "PROJECT_UPDATED") return false;
  if (attachmentEventOwner(type, payload) === "MILESTONE") return true;
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
