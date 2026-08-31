import { describe, expect, it } from "vitest";

import type { AuditRow } from "../../miniapp/src/lib/api";
import {
  auditDetailItems,
  auditFilterCount,
  formatAuditMetadata,
  formatAuditTime,
  keepActiveOption,
  msUntilNextLocalMidnight,
  shanghaiToday,
} from "../../miniapp/src/lib/audit";

function row(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: "1",
    action: "PROJECT_CREATED",
    actionLabel: "创建项目",
    resourceType: "Project",
    resourceLabel: "项目",
    resourceId: "prj-1",
    result: "SUCCESS",
    resultLabel: "成功",
    createdAt: "2026-08-31T02:03:04.000Z",
    ipAddress: "203.0.113.7",
    userAgent: "Vitest UA",
    metadata: null,
    projectId: null,
    customerSpaceId: null,
    serviceRequestId: null,
    actorDisplay: { name: "管理员", secondary: "admin@local.test" },
    ...overrides,
  };
}

// 本地时区无关：用同一时钟基准构造「当天 / 同年 / 跨年」三种相对关系
const noon = new Date(2026, 7, 31, 12, 0, 0).getTime();

describe("formatAuditTime", () => {
  it("当天只留时分，把行宽让给操作文案", () => {
    const value = new Date(2026, 7, 31, 9, 5, 0).toISOString();
    expect(formatAuditTime(value, noon)).toBe("09:05");
  });

  it("同年补月日", () => {
    const value = new Date(2026, 6, 1, 23, 40, 0).toISOString();
    expect(formatAuditTime(value, noon)).toBe("07-01 23:40");
  });

  it("跨年才带年份", () => {
    const value = new Date(2025, 11, 31, 8, 9, 0).toISOString();
    expect(formatAuditTime(value, noon)).toBe("2025-12-31 08:09");
  });

  it("空值与坏时间戳都退化为占位符", () => {
    expect(formatAuditTime(null, noon)).toBe("—");
    expect(formatAuditTime("not-a-date", noon)).toBe("—");
  });
});

// 服务端按 +08:00 解释日界，日期上限必须同口径 —— 断言不依赖跑测机器的时区
describe("shanghaiToday", () => {
  it("按北京日历日推算，跨过 UTC 日界也不早退一天", () => {
    expect(shanghaiToday(Date.parse("2026-08-30T15:59:59Z"))).toBe("2026-08-30");
    expect(shanghaiToday(Date.parse("2026-08-30T16:00:00Z"))).toBe("2026-08-31");
  });

  it("跨月与跨年边界照样落在北京日", () => {
    expect(shanghaiToday(Date.parse("2026-08-31T16:00:00Z"))).toBe("2026-09-01");
    expect(shanghaiToday(Date.parse("2026-12-31T16:00:00Z"))).toBe("2027-01-01");
  });
});

describe("auditFilterCount", () => {
  it("只数收在面板里的条件（搜索与结果 chips 页面上可见，不计）", () => {
    expect(
      auditFilterCount({ action: "", resourceType: "", from: "", to: "" }),
    ).toBe(0);
    expect(
      auditFilterCount({
        action: "USER_LOGIN",
        resourceType: "Project",
        from: "2026-08-01",
        to: "2026-08-31",
      }),
    ).toBe(4);
  });
});

describe("msUntilNextLocalMidnight", () => {
  // 断言落点而非具体毫秒数，跑测机器在哪个时区都成立
  function landsOnNextMidnight(now: Date) {
    const target = new Date(now.getTime() + msUntilNextLocalMidnight(now.getTime()));
    expect([target.getHours(), target.getMinutes(), target.getSeconds()]).toEqual([0, 0, 0]);
    expect(target.getDate()).toBe(new Date(now.getTime() + 86_400_000).getDate());
  }

  it("落在下一个本地零点，跨月跨年由 Date 自己进位", () => {
    landsOnNextMidnight(new Date(2026, 7, 31, 23, 59, 30));
    landsOnNextMidnight(new Date(2026, 11, 31, 12, 0, 0));
  });

  it("至少 1 秒，不排出 0 延时的自触发循环", () => {
    const midnight = new Date(2026, 7, 31, 0, 0, 0).getTime();
    expect(msUntilNextLocalMidnight(midnight)).toBeGreaterThanOrEqual(1000);
  });
});

describe("keepActiveOption", () => {
  const previous = [
    { value: "", label: "全部" },
    { value: "SUCCESS", label: "成功" },
    { value: "FAILURE", label: "失败" },
  ];

  it("facets 没报的取值若仍在生效，带着原标签留在选项里", () => {
    const next = [{ value: "", label: "全部" }, { value: "SUCCESS", label: "成功" }];
    expect(keepActiveOption(next, previous, "FAILURE")).toEqual([
      ...next,
      { value: "FAILURE", label: "失败" },
    ]);
  });

  it("旧选项里也查不到标签时回落原值，至少看得见、点得掉", () => {
    expect(keepActiveOption([], [], "DENIED")).toEqual([
      { value: "DENIED", label: "DENIED" },
    ]);
  });

  it("未筛选或取值本就在列表里时原样返回", () => {
    const next = [{ value: "", label: "全部" }, { value: "SUCCESS", label: "成功" }];
    expect(keepActiveOption(next, previous, "")).toBe(next);
    expect(keepActiveOption(next, previous, "SUCCESS")).toBe(next);
  });
});

describe("formatAuditMetadata", () => {
  it("有内容时缩进展示", () => {
    expect(formatAuditMetadata({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it("空值与空对象都当作没有附加数据", () => {
    expect(formatAuditMetadata(null)).toBe("");
    expect(formatAuditMetadata(undefined)).toBe("");
    expect(formatAuditMetadata({})).toBe("");
  });

  it("stringify 结果为 undefined 的顶层值也当作没有附加数据", () => {
    expect(formatAuditMetadata(() => undefined)).toBe("");
    expect(formatAuditMetadata(Symbol("x"))).toBe("");
  });

  it("循环引用不炸页面", () => {
    const cyclic: Record<string, unknown> = { name: "x" };
    cyclic.self = cyclic;
    expect(formatAuditMetadata(cyclic)).toBe("");
  });
});

describe("auditDetailItems", () => {
  it("空字段不出现，避免详情里一屏占位符", () => {
    const items = auditDetailItems(row());
    const labels = items.map((item) => item.label);
    expect(labels).toContain("对象 ID");
    expect(labels).not.toContain("所属项目");
    expect(labels).not.toContain("客户空间");
  });

  it("时间精确到秒，ID / IP / UA 标为等宽（可复制）", () => {
    const items = auditDetailItems(
      row({ projectId: "prj-1", serviceRequestId: "req-9" }),
    );
    const byLabel = Object.fromEntries(
      items.map((item) => [item.label, item]),
    );
    expect(byLabel["时间"].value).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:04$/);
    expect(byLabel["时间"].mono).toBe(false);
    expect(byLabel["操作码"].mono).toBe(true);
    expect(byLabel["来源 IP"].mono).toBe(true);
    expect(byLabel["服务请求"].value).toBe("req-9");
  });

  it("执行人带上次要信息；secondary 为占位符时不拼括号", () => {
    expect(auditDetailItems(row())[2].value).toBe("管理员（admin@local.test）");
    const anonymous = auditDetailItems(
      row({ actorDisplay: { name: "系统", secondary: "—" } }),
    );
    expect(anonymous[2].value).toBe("系统");
  });
});
