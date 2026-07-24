import { describe, expect, it } from "vitest";
import { summarizeUnreadNotificationGroups } from "@/modules/notifications/notification-summary";

describe("完整未读通知摘要", () => {
  it("31 条以上未读仍返回完整铃铛、导航、项目和工单计数", () => {
    const summary = summarizeUnreadNotificationGroups([
      {
        type: "PROJECT_CREATED",
        projectId: "project-1",
        serviceRequestId: null,
        _count: { _all: 1 },
      },
      {
        type: "PROJECT_UPDATE",
        projectId: "project-1",
        serviceRequestId: null,
        _count: { _all: 18 },
      },
      {
        type: "PROJECT_MILESTONE",
        projectId: "project-1",
        serviceRequestId: null,
        _count: { _all: 14 },
      },
      {
        type: "REQUEST_MESSAGE",
        projectId: "project-1",
        serviceRequestId: "request-1",
        _count: { _all: 7 },
      },
    ]);

    expect(summary.totalUnread).toBe(40);
    expect(summary.navigation).toEqual({ projects: true, requests: true });
    expect(summary.projectDeliveryCounts["project-1"]).toBe(33);
    expect(summary.projectStageCounts["project-1"]).toBe(1);
    expect(summary.projectRequestCounts["project-1"]).toBe(7);
    expect(summary.requestUnreadCounts["request-1"]).toEqual({
      projectId: "project-1",
      count: 7,
    });
  });
});
