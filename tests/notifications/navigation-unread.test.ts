import { describe, expect, it } from "vitest";
import { summarizeNavigationUnread } from "@/lib/notification-navigation";

describe("导航未读红点", () => {
  it("区分项目动态与服务请求", () => {
    expect(
      summarizeNavigationUnread([
        { type: "PROJECT_UPDATE", readAt: null },
        {
          type: "REQUEST_MESSAGE",
          readAt: null,
          serviceRequestId: "request-1",
        },
      ]),
    ).toEqual({ projects: true, requests: true });
  });

  it("已读和无对应导航的通知不显示", () => {
    expect(
      summarizeNavigationUnread([
        { type: "PROJECT_UPDATE", readAt: "2026-07-18T00:00:00.000Z" },
        { type: "INVITATION", readAt: null },
      ]),
    ).toEqual({ projects: false, requests: false });
  });

  it("有工单关联时优先归入服务请求", () => {
    expect(
      summarizeNavigationUnread([
        {
          type: "PROJECT_UPDATE",
          readAt: null,
          serviceRequestId: "request-1",
        },
      ]),
    ).toEqual({ projects: false, requests: true });
  });
});
