// 本地日历日相差几天；用 UTC 分量做减法，夏令时切换日不会让「一天」变成 23/25 小时
function calendarDayDiff(from: Date, to: Date) {
  const dayMs = 24 * 60 * 60_000;
  return Math.round(
    (Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) -
      Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) /
      dayMs,
  );
}

/**
 * 面向操作者的相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / N 天前 / 具体日期。
 * 满 24 小时后按本地日历日判断，「昨天」必须真的是昨天。
 */
export function formatRelativeTime(iso: string, now: number = Date.now()) {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "";
  const diff = Math.max(0, now - time);
  const minute = 60_000;
  const hour = 60 * minute;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < 24 * hour) return `${Math.floor(diff / hour)} 小时前`;
  const date = new Date(time);
  const days = calendarDayDiff(date, new Date(now));
  if (days <= 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return `${sameYear ? "" : `${date.getFullYear()} 年 `}${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}
