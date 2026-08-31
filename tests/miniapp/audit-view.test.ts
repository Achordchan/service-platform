import { describe, expect, it } from "vitest";

import type { AuditRow } from "../../miniapp/src/lib/api";
import {
  auditDetailItems,
  auditFilterCount,
  formatAuditMetadata,
  formatAuditTime,
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

describe("formatAuditMetadata", () => {
  it("有内容时缩进展示", () => {
    expect(formatAuditMetadata({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it("空值与空对象都当作没有附加数据", () => {
    expect(formatAuditMetadata(null)).toBe("");
    expect(formatAuditMetadata(undefined)).toBe("");
    expect(formatAuditMetadata({})).toBe("");
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
