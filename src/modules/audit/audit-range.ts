import { z } from "zod";
import { dateBound } from "@/modules/http/date-bound";
import { DomainError } from "@/modules/projects/errors";

/** 概览/用户活动最多看一年，避免一次查询扫全表。 */
export const AUDIT_ACTIVITY_RANGE_MAX_DAYS = 366;

export const auditRangeQueryShape = {
  from: dateBound("start"),
  to: dateBound("end"),
};

export const auditRangeSchema = z.object(auditRangeQueryShape);

export type AuditRangeInput = { from?: Date; to?: Date };

/**
 * 统计区间：默认近 7 天；结束时间取当天 23:59，开始时间取当天 00:00（+08:00，
 * 由 dateBound 负责换算）。区间非法或过长时给出可读的中文错误。
 */
const DAY_MS = 24 * 60 * 60_000;
const SHANGHAI_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function shanghaiDayKey(date: Date): string {
  const parts = SHANGHAI_DAY.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

export function resolveAuditRange(
  input: AuditRangeInput,
  now = new Date(),
): { from: Date; to: Date } {
  const to = input.to ?? now;
  // 默认近 7 天：从 6 天前的北京时间 00:00 起，而不是「现在减 6 天」
  const from =
    input.from ??
    new Date(`${shanghaiDayKey(new Date(to.getTime() - 6 * DAY_MS))}T00:00:00+08:00`);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new DomainError("AUDIT_RANGE_INVALID", "统计时间范围无效", 422);
  }
  if (from.getTime() > to.getTime()) {
    throw new DomainError(
      "AUDIT_RANGE_INVALID",
      "开始时间不能晚于结束时间",
      422,
    );
  }
  // 结束日是 23:59:59.999，向下取整得到实际覆盖的自然日数
  const days = Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;
  if (days > AUDIT_ACTIVITY_RANGE_MAX_DAYS) {
    throw new DomainError(
      "AUDIT_RANGE_TOO_LONG",
      `统计区间最长 ${AUDIT_ACTIVITY_RANGE_MAX_DAYS} 天，请缩小范围`,
      422,
    );
  }
  return { from, to };
}
