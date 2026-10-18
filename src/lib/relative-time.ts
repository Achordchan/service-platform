// 本地日历日相差几天；用 UTC 分量做减法，夏令时切换日不会让「一天」变成 23/25 小时
function calendarDayDiff(from: Date, to: Date) {
  const dayMs = 24 * 60 * 60_000;
  return Math.round(
    (Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) -
      Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) /
      dayMs,
  );
}

const zoneDayFormatters = new Map<string, Intl.DateTimeFormat>();

function dayKeyInZone(date: Date, timeZone: string): string {
  let formatter = zoneDayFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    zoneDayFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function calendarDayDiffInZone(from: Date, to: Date, timeZone: string) {
  const dayMs = 24 * 60 * 60_000;
  const fromKey = dayKeyInZone(from, timeZone).split("-").map(Number);
  const toKey = dayKeyInZone(to, timeZone).split("-").map(Number);
  return Math.round(
    (Date.UTC(toKey[0]!, toKey[1]! - 1, toKey[2]!) -
      Date.UTC(fromKey[0]!, fromKey[1]! - 1, fromKey[2]!)) /
      dayMs,
  );
}

const zoneDateFormatters = new Map<string, Intl.DateTimeFormat>();

function datePartsInZone(date: Date, timeZone: string) {
  let formatter = zoneDateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    });
    zoneDateFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: pick("year"),
    month: Number(pick("month")),
    day: Number(pick("day")),
  };
}

export type RelativeTimeOptions = {
  /** 传入 IANA 时区后，「昨天 / 月日」按该时区的日历计算（审计固定北京时间） */
  timeZone?: string;
};

/**
 * 面向操作者的相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / N 天前 / 具体日期。
 * 满 24 小时后按日历日判断，「昨天」必须真的是昨天。
 * 传 `timeZone` 时，日历判断和最终日期都按该时区，避免跨时区显示错一天。
 */
export function formatRelativeTime(
  iso: string,
  now: number = Date.now(),
  options: RelativeTimeOptions = {},
) {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "";
  const diff = Math.max(0, now - time);
  const minute = 60_000;
  const hour = 60 * minute;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < 24 * hour) return `${Math.floor(diff / hour)} 小时前`;
  const date = new Date(time);
  const days = options.timeZone
    ? calendarDayDiffInZone(date, new Date(now), options.timeZone)
    : calendarDayDiff(date, new Date(now));
  if (days <= 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  if (options.timeZone) {
    const parts = datePartsInZone(date, options.timeZone);
    const sameYear =
      parts.year === String(datePartsInZone(new Date(now), options.timeZone).year);
    return `${sameYear ? "" : `${parts.year} 年 `}${parts.month} 月 ${parts.day} 日`;
  }
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return `${sameYear ? "" : `${date.getFullYear()} 年 `}${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}
