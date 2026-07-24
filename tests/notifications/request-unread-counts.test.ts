import { describe, expect, it } from "vitest";
import {
  countRequestStatusUnread,
  type UnreadNotificationSummary,
} from "@/hooks/use-unread-notifications";

const unread: UnreadNotificationSummary = {
  totalUnread: 2,
  navigation: { projects: false, requests: true },
  projectDeliveryCounts: {},
  projectUpdateCounts: {},
  projectStageCounts: {},
  projectMilestoneCounts: {},
  projectFileCounts: {},
  projectRequestCounts: { "project-1": 2 },
  requestUnreadCounts: {
    "request-1": { projectId: "project-1", count: 2 },
  },
};

const requests = [
  {
    id: "request-1",
    projectId: "project-1",
    status: "IN_PROGRESS",
    archivedAt: null,
  },
];

describe("服务请求状态未读数", () => {
  it("does not duplicate unread counts on the ALL tab", () => {
    expect(countRequestStatusUnread(unread, requests, "ALL")).toBe(0);
  });

  it("shows unread counts only on the request current status", () => {
    expect(countRequestStatusUnread(unread, requests, "IN_PROGRESS")).toBe(2);
    expect(countRequestStatusUnread(unread, requests, "PENDING")).toBe(0);
  });
});
