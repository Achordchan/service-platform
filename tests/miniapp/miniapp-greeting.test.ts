import { describe, expect, it } from "vitest";

import { greetingFor, todayLabel } from "../../miniapp/src/lib/format";

describe("miniapp greeting", () => {
  const cases: Array<[number, string]> = [
    [0, "凌晨好"],
    [1, "凌晨好"],
    [4, "凌晨好"],
    [5, "早上好"],
    [10, "早上好"],
    [11, "中午好"],
    [13, "中午好"],
    [14, "下午好"],
    [17, "下午好"],
    [18, "晚上好"],
    [23, "晚上好"],
  ];

  it.each(cases)("%i 点返回 %s", (hour, expected) => {
    const now = new Date(2026, 7, 17, hour, 30);
    expect(greetingFor("张三", now)).toBe(`${expected}，张三`);
  });

  it("无姓名时仅返回时段问候", () => {
    expect(greetingFor(null, new Date(2026, 7, 17, 1, 0))).toBe("凌晨好");
  });

  it("日期标签使用本地日期与星期", () => {
    // 2026-08-17 是周一；跨天场景由页面 onShow 重新调用刷新
    expect(todayLabel(new Date(2026, 7, 17, 1, 0))).toBe("8月17日 周一");
    expect(todayLabel(new Date(2026, 11, 31, 23, 59))).toBe("12月31日 周四");
  });
});
