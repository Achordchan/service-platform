import { z } from "zod";

// 日期边界：管理端日期选择器传 YYYY-MM-DD，目标用户在中国（Asia/Shanghai）。
// 按 +08:00 日界换算为 UTC 瞬时（否则 UTC 日界会把当天头 8 小时漏掉、混入次日数据）；
// 完整时间戳原样透传。结束日期取当天 23:59:59.999 配合 lte 全含当天。
// 真实日历校验：JS Date 会把 2026-02-31 静默归一化到 3 月，必须显式拒绝
export function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

export function dateBound(kind: "start" | "end") {
  return z
    .string()
    .trim()
    .min(1)
    .optional()
    .transform((value, ctx) => {
      if (!value) return undefined;
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        if (!isValidCalendarDate(value)) {
          ctx.addIssue({ code: "custom", message: "日期不存在" });
          return z.NEVER;
        }
        return kind === "start"
          ? new Date(`${value}T00:00:00+08:00`)
          : new Date(`${value}T23:59:59.999+08:00`);
      }
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        ctx.addIssue({ code: "custom", message: "日期格式无效" });
        return z.NEVER;
      }
      return parsed;
    });
}
