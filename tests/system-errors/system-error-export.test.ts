import { describe, expect, it } from "vitest";
import { buildSystemErrorRecord } from "@/lib/system-error-log";
import {
  toExportCsv,
  toExportJson,
} from "@/modules/system-errors/system-error-export";
import type { SystemErrorExportRow } from "@/modules/system-errors/system-error-query";

function exportRow(overrides: Partial<SystemErrorExportRow> = {}): SystemErrorExportRow {
  const error = new Error(
    "failed for ops@example.com password=hunter2 phone 13800138000",
  );
  const record = buildSystemErrorRecord(error, {
    source: "project-api",
    operation: "project.create",
    request: { method: "POST", path: "/api/v1/x/ops%40example.com/13800138000" },
    context: { note: "ops@example.com" },
  });
  return {
    id: "1",
    referenceId: record.referenceId,
    category: record.category,
    errorName: record.errorName,
    source: record.source,
    operation: record.operation ?? null,
    requestMethod: record.requestMethod ?? null,
    requestPath: record.requestPath ?? null,
    actorType: "STAFF",
    actorId: "user-1",
    actorName: "张三",
    occurrenceCount: 1,
    summary: "",
    createdAt: "2026-10-06T01:02:03.000Z",
    details: record.details as never,
    context: (record.context ?? null) as never,
    ...overrides,
  };
}

describe("系统报错导出", () => {
  it("JSON 和 CSV 里没有凭据、邮箱、手机号，也不含操作者姓名", () => {
    const rows = [exportRow()];
    const json = JSON.stringify(toExportJson(rows));
    const csv = toExportCsv(rows);

    for (const output of [json, csv]) {
      expect(output).not.toContain("ops@example.com");
      expect(output).not.toContain("ops%40example.com");
      expect(output).not.toContain("hunter2");
      expect(output).not.toContain("13800138000");
      expect(output).not.toContain("张三");
    }
    expect(json).toContain("user-1");
  });

  it("CSV 带 BOM、正确转义逗号引号换行，并给公式开头的单元格加前缀", () => {
    const csv = toExportCsv([
      exportRow({
        operation: "=HYPERLINK(\"http://evil\")",
        requestPath: "/a,b\"c\nd",
        source: "@cmd",
      }),
    ]);

    expect(csv.startsWith("﻿时间,错误编号")).toBe(true);
    expect(csv).toContain("'=HYPERLINK(");
    expect(csv).toContain("'@cmd");
    expect(csv).toContain('"/a,b""c\nd"');
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});
