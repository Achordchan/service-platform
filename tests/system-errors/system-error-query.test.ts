import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actor", () => ({ withActorDb: vi.fn(), withSystemDb: vi.fn() }));

import {
  buildSystemErrorWhere,
  extractReferenceId,
} from "@/modules/system-errors/system-error-query";
import { systemErrorLogRetentionDays } from "@/modules/system-errors/system-error-retention";
import { summarizeSystemError } from "@/modules/system-errors/system-error-labels";


describe("错误编号识别", () => {
  const id = `err_${"a1".repeat(16)}`;

  it("从用户报错的整句话里提取编号", () => {
    expect(extractReferenceId(`操作暂时失败，请稍后重试。错误编号：${id}`)).toBe(id);
    expect(extractReferenceId(id.toUpperCase())).toBe(id);
    expect(extractReferenceId("错误编号：mail_clx123abc。请重试")).toBe("mail_clx123abc");
    expect(extractReferenceId("project-api")).toBeUndefined();
  });

  it("搜索含编号时精确匹配，不含时模糊匹配来源 / 操作 / 路径", () => {
    expect(buildSystemErrorWhere({ search: `错误编号：${id}` })).toEqual({
      AND: [{ referenceId: id }],
    });
    const fuzzy = buildSystemErrorWhere({ search: "audit" });
    expect(JSON.stringify(fuzzy)).toContain('"operation":{"contains":"audit"');
    expect(JSON.stringify(fuzzy)).not.toContain("referenceId");
  });

  it("筛选条件组合成 where，日期范围用 gte/lte", () => {
    const from = new Date("2026-10-01T00:00:00Z");
    const to = new Date("2026-10-02T00:00:00Z");

    expect(
      buildSystemErrorWhere({ category: "DATABASE_PERMISSION", source: "worker", from, to }),
    ).toEqual({
      category: "DATABASE_PERMISSION",
      source: "worker",
      createdAt: { gte: from, lte: to },
    });
  });
});

describe("保留期与摘要", () => {
  it("保留天数默认 90，环境变量钳在 7～365", () => {
    expect(systemErrorLogRetentionDays(undefined)).toBe(90);
    expect(systemErrorLogRetentionDays("abc")).toBe(90);
    expect(systemErrorLogRetentionDays("1")).toBe(7);
    expect(systemErrorLogRetentionDays("30")).toBe(30);
    expect(systemErrorLogRetentionDays("9999")).toBe(365);
  });

  it("摘要优先取数据库命中模板的报错，其次应用报错，最后退到类型与错误码", () => {
    expect(
      summarizeSystemError(
        { database: { message: 'new row violates row-level security policy for table "X"' } },
        "DATABASE_PERMISSION",
      ),
    ).toContain("row-level security");
    expect(summarizeSystemError({ message: "写死的报错" }, "UNEXPECTED")).toBe("写死的报错");
    expect(
      summarizeSystemError(
        { name: "PrismaClientKnownRequestError", code: "P2022", database: { sqlState: "42703", table: "Foo" } },
        "DATABASE_SCHEMA",
      ),
    ).toBe("PrismaClientKnownRequestError · P2022 · SQLSTATE 42703 · 表 Foo（数据库结构）");
  });
});
