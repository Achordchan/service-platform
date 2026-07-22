import { describe, expect, it } from "vitest";
import { matchesNotificationLocalUpdate } from "@/lib/notification-local-update";

const requestNotification = {
  id: "notification-1",
  type: "REQUEST_MESSAGE",
  projectId: "project-1",
  serviceRequestId: "request-1",
};

describe("matchesNotificationLocalUpdate", () => {
  it("matches one notification by id", () => {
    expect(
      matchesNotificationLocalUpdate(requestNotification, {
        notificationId: "notification-1",
      }),
    ).toBe(true);
    expect(
      matchesNotificationLocalUpdate(requestNotification, {
        notificationId: "notification-2",
      }),
    ).toBe(false);
  });

  it("matches all aggregated notifications for one request", () => {
    expect(
      matchesNotificationLocalUpdate(requestNotification, {
        serviceRequestId: "request-1",
      }),
    ).toBe(true);
  });

  it("only matches project updates for update scope", () => {
    expect(
      matchesNotificationLocalUpdate(
        {
          id: "update-1",
          type: "PROJECT_UPDATE",
          projectId: "project-1",
        },
        { projectId: "project-1", projectScope: "updates" },
      ),
    ).toBe(true);
    expect(
      matchesNotificationLocalUpdate(requestNotification, {
        projectId: "project-1",
        projectScope: "updates",
      }),
    ).toBe(false);
  });

  it("matches every notification for all-read updates", () => {
    expect(
      matchesNotificationLocalUpdate(requestNotification, { all: true }),
    ).toBe(true);
  });
});
