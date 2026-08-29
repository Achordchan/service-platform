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

  it("附件事件按归属实体归模块，不是一律算文件模块", () => {
    const base = {
      isStaff: false,
      type: "PROJECT_UPDATED" as const,
      customerUpdatesEnabled: true,
      customerFilesEnabled: false,
      showMilestones: true,
      showProgress: false,
    };
    // 「开着动态、关着文件」的客户看得到动态自己的附件（附件查询放行了），
    // 那这条刷新事件就不能被文件模块开关过滤掉
    expect(
      canReceiveProjectRealtimeEvent({
        ...base,
        payload: {
          change: "PROJECT_ATTACHMENT_UPLOADED",
          projectUpdateId: "update-1",
        },
      }),
    ).toBe(true);
    // 里程碑同理
    expect(
      canReceiveProjectRealtimeEvent({
        ...base,
        payload: {
          change: "PROJECT_ATTACHMENT_UPLOADED",
          milestoneId: "milestone-1",
        },
      }),
    ).toBe(true);
    // 项目级文件（没有归属实体）才受 customerFilesEnabled 限制
    expect(
      canReceiveProjectRealtimeEvent({
        ...base,
        payload: { change: "PROJECT_ATTACHMENT_UPLOADED" },
      }),
    ).toBe(false);
  });

  it("归属实体的模块关掉时，附件事件仍要被挡住", () => {
    const base = {
      isStaff: false,
      type: "PROJECT_UPDATED" as const,
      customerUpdatesEnabled: false,
      customerFilesEnabled: true,
      showMilestones: false,
      showProgress: false,
    };
    expect(
      canReceiveProjectRealtimeEvent({
        ...base,
        payload: {
          change: "PROJECT_ATTACHMENT_UPLOADED",
          projectUpdateId: "update-1",
        },
      }),
    ).toBe(false);
    expect(
      canReceiveProjectRealtimeEvent({
        ...base,
        payload: {
          change: "PROJECT_ATTACHMENT_UPLOADED",
          milestoneId: "milestone-1",
        },
      }),
    ).toBe(false);
  });
});
