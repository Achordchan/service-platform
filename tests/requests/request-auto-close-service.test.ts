import { describe, expect, it } from "vitest";

import {
  isResolvedRequestDueForAutoClose,
  requestAutoCloseCutoff,
} from "@/modules/requests/request-auto-close-policy";

const now = new Date("2026-07-23T12:00:00.000Z");

describe("已解决工单自动关闭", () => {
  it("使用固定 7 天期限", () => {
    expect(requestAutoCloseCutoff(now).toISOString()).toBe(
      "2026-07-16T12:00:00.000Z",
    );
  });

  it("达到 7 天时进入自动关闭范围", () => {
    expect(
      isResolvedRequestDueForAutoClose(
        "RESOLVED",
        new Date("2026-07-16T12:00:00.000Z"),
        now,
      ),
    ).toBe(true);
  });

  it("未满 7 天、无解决时间或其他状态均不关闭", () => {
    expect(
      isResolvedRequestDueForAutoClose(
        "RESOLVED",
        new Date("2026-07-16T12:00:00.001Z"),
        now,
      ),
    ).toBe(false);
    expect(isResolvedRequestDueForAutoClose("RESOLVED", null, now)).toBe(false);
    expect(
      isResolvedRequestDueForAutoClose(
        "IN_PROGRESS",
        new Date("2026-07-10T12:00:00.000Z"),
        now,
      ),
    ).toBe(false);
  });
});
