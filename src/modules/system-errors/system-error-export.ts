import {
  summarizeSystemError,
  systemErrorActorTypeLabel,
  systemErrorCategoryLabel,
} from "@/modules/system-errors/system-error-labels";
import type { SystemErrorExportRow } from "@/modules/system-errors/system-error-query";

/**
 * 导出给开发排查用。内容全部来自入库时已脱敏的字段，这里再做两件事：
 * 不导出操作者姓名（只留类型和 ID）；CSV 单元格防公式注入。
 */
export function toExportJson(rows: SystemErrorExportRow[]) {
  return rows.map((row) => ({
    ...row,
    actorName: undefined,
    categoryLabel: systemErrorCategoryLabel(row.category),
  }));
}

// 以 = + - @ 或制表符、回车开头的单元格会被 Excel 当成公式执行
function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  let text = typeof value === "string" ? value : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const COLUMNS: Array<{
  header: string;
  value: (row: SystemErrorExportRow) => unknown;
}> = [
  { header: "时间", value: (row) => row.createdAt },
  { header: "错误编号", value: (row) => row.referenceId },
  { header: "分类", value: (row) => systemErrorCategoryLabel(row.category) },
  { header: "分类代码", value: (row) => row.category },
  { header: "错误类型", value: (row) => row.errorName },
  { header: "来源", value: (row) => row.source },
  { header: "操作", value: (row) => row.operation },
  { header: "请求方法", value: (row) => row.requestMethod },
  { header: "请求路径", value: (row) => row.requestPath },
  { header: "操作者类型", value: (row) => systemErrorActorTypeLabel(row.actorType) },
  { header: "操作者ID", value: (row) => row.actorId },
  { header: "摘要", value: (row) => summarizeSystemError(row.details, row.category) },
  { header: "发生次数", value: (row) => row.occurrenceCount },
  { header: "业务标识", value: (row) => row.context },
  { header: "详情", value: (row) => row.details },
];

/** 带 BOM 的 UTF-8 CSV：Excel 直接打开中文不乱码 */
export function toExportCsv(rows: SystemErrorExportRow[]) {
  const lines = [
    COLUMNS.map((column) => csvCell(column.header)).join(","),
    ...rows.map((row) => COLUMNS.map((column) => csvCell(column.value(row))).join(",")),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}
