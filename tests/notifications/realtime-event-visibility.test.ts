import { describe, expect, it } from "vitest";
import {
  canReceiveProjectRealtimeEvent,
  canReceiveRequestRealtimeEvent,
} from "@/modules/notifications/realtime-event-visibility";

describe("实时事件模块可见性", () => {
  it("客户请求模块关闭时只过滤客户，不过滤后台人员", () => {
    expect(canReceiveRequestRealtimeEvent(false, false)).toBe(false);
    expect(canReceiveRequestRealtimeEvent(true, false)).toBe(true);
  });

  it.each([
    ["项目动态", "PROJECT_UPDATE_CREATED", {}, "customerUpdatesEnabled"],
    [
      "项目动态删除",
      "PROJECT_UPDATED",
      { change: "PROJECT_UPDATE_DELETED" },
      "customerUpdatesEnabled",
    ],
    [
      "项目文件",
      "PROJECT_UPDATED",
      { change: "PROJECT_ATTACHMENT_UPLOADED" },
      "customerFilesEnabled",
    ],
    [
      "里程碑",
      "PROJECT_UPDATED",
      { change: "MILESTONE_UPDATED" },
      "milestones",
    ],
  ] as const)("%s 模块关闭时只过滤客户，不过滤后台人员", (_, type, payload, disabledModule) => {
    const base = {
      type,
      payload,
      customerUpdatesEnabled: true,
      customerFilesEnabled: true,
      showMilestones: true,
      showProgress: true,
    };
    const disabled = {
      ...base,
      ...(disabledModule === "customerUpdatesEnabled"
        ? { customerUpdatesEnabled: false }
        : {}),
      ...(disabledModule === "customerFilesEnabled"
        ? { customerFilesEnabled: false }
        : {}),
      ...(disabledModule === "milestones"
        ? { showMilestones: false, showProgress: false }
        : {}),
    };

    expect(
      canReceiveProjectRealtimeEvent({ ...disabled, isStaff: false }),
    ).toBe(false);
    expect(
      canReceiveProjectRealtimeEvent({ ...disabled, isStaff: true }),
    ).toBe(true);
  });
});
