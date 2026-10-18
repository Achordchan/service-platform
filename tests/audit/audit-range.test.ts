import { describe, expect, it } from "vitest";
import { buildAuditFacetOptions } from "@/modules/audit/audit-facet-options";
import { resolveAuditRange } from "@/modules/audit/audit-range";

describe("审计统计区间", () => {
  it("默认近 7 天，从 6 天前的北京时间零点开始", () => {
    const now = new Date("2026-10-18T02:00:00.000Z"); // 北京 10:00
    const range = resolveAuditRange({}, now);
    expect(range.from.toISOString()).toBe("2026-10-11T16:00:00.000Z"); // 10-12 00:00 +08
    expect(range.to.toISOString()).toBe(now.toISOString());
  });

  it("同一天的起止日期算 1 天，不会多算一天", () => {
    const range = resolveAuditRange({
      from: new Date("2026-10-18T00:00:00+08:00"),
      to: new Date("2026-10-18T23:59:59.999+08:00"),
    });
    expect(range.from.getTime()).toBeLessThan(range.to.getTime());
    // 不抛错即说明没有被误判为超过上限或开始晚于结束
    expect(range.to.toISOString()).toBe("2026-10-18T15:59:59.999Z");
  });

  it("开始晚于结束会给出可读错误", () => {
    expect(() =>
      resolveAuditRange({
        from: new Date("2026-10-19T00:00:00+08:00"),
        to: new Date("2026-10-18T23:59:59.999+08:00"),
      }),
    ).toThrowError(/开始时间不能晚于结束时间/);
  });

  it("按北京时间自然日计数，带具体时刻的 367 个日历日会拒绝", () => {
    expect(() =>
      resolveAuditRange({
        from: new Date("2025-01-01T12:00:00+08:00"),
        to: new Date("2026-01-02T11:00:00+08:00"),
      }),
    ).toThrowError(/统计区间最长/);
  });

  it("超过一年会拒绝，避免一次查询扫全表", () => {
    expect(() =>
      resolveAuditRange({
        from: new Date("2025-01-01T00:00:00+08:00"),
        to: new Date("2026-10-18T23:59:59.999+08:00"),
      }),
    ).toThrowError(/统计区间最长/);
  });
});

describe("审计筛选项", () => {
  it("FAILURE 与 FAILED 合并成一个「失败」选项，原始数组保持不变", () => {
    const facets = {
      actions: ["USER_LOGIN", "REQUEST_CREATED"],
      resourceTypes: ["User", "ServiceRequest"],
      results: ["SUCCESS", "FAILURE", "FAILED", "DENIED"],
    };
    const options = buildAuditFacetOptions(facets);
    expect(options.results).toEqual([
      "SUCCESS",
      "FAILURE",
      "FAILED",
      "DENIED",
    ]);
    expect(options.resultOptions).toEqual([
      { value: "SUCCESS", label: "成功" },
      { value: "FAILURE", label: "失败" },
      { value: "DENIED", label: "拒绝" },
    ]);
    expect(options.actionOptions[0]).toEqual({
      value: "USER_LOGIN",
      label: "登录",
    });
    expect(options.categoryOptions.length).toBeGreaterThan(3);
    expect(options.actors).toEqual([]);
  });
});
