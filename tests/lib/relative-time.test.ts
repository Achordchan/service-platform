import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "@/lib/relative-time";

describe("formatRelativeTime", () => {
  it("按传入时区计算日历日，跨时区不会把日期显示错一天", () => {
    const iso = "2026-10-10T23:00:00.000Z";
    const now = new Date("2026-10-18T04:00:00.000Z").getTime();
    expect(formatRelativeTime(iso, now, { timeZone: "Asia/Shanghai" })).toBe(
      "10 月 11 日",
    );
    expect(formatRelativeTime(iso, now, { timeZone: "America/New_York" })).toBe(
      "10 月 10 日",
    );
  });

  it("24 小时内仍按经过时长显示，不受时区影响", () => {
    const now = new Date("2026-10-18T04:00:00.000Z").getTime();
    expect(
      formatRelativeTime("2026-10-18T03:30:00.000Z", now, {
        timeZone: "Asia/Shanghai",
      }),
    ).toBe("30 分钟前");
    expect(
      formatRelativeTime("2026-10-17T20:00:00.000Z", now, {
        timeZone: "Asia/Shanghai",
      }),
    ).toBe("8 小时前");
  });
});
