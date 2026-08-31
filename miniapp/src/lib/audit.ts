// 审计日志的纯展示逻辑：列表时间、筛选角标、详情字段。页面只做取数与 setData。
import type { AuditFacetOption, AuditRow } from "./api";
import { formatDateTime } from "./format";

export type AuditFilterState = {
  search: string;
  action: string;
  resourceType: string;
  result: string;
  /** YYYY-MM-DD，服务端按 +08:00 换算日界 */
  from: string;
  to: string;
};

export const EMPTY_AUDIT_FILTERS: AuditFilterState = {
  search: "",
  action: "",
  resourceType: "",
  result: "",
  from: "",
  to: "",
};

/**
 * 筛选入口角标只数「收在面板里」的条件：搜索框与结果 chips 本来就摆在页面上，
 * 再计一次数字会让用户以为还有看不见的条件在生效。
 */
export function auditFilterCount(
  filters: Pick<AuditFilterState, "action" | "resourceType" | "from" | "to">,
): number {
  return (
    (filters.action ? 1 : 0) +
    (filters.resourceType ? 1 : 0) +
    (filters.from ? 1 : 0) +
    (filters.to ? 1 : 0)
  );
}

/**
 * 合并筛选项时保住仍在生效的取值：facets 只报「库里现存的取值」，若用户先选了
 * 一个（例如 facets 到达前从默认 chips 里选的 FAILURE）而服务端没报它，直接替换
 * 选项会让条件还生效、界面上却看不见，列表空了也无从解释、更无从取消。
 */
export function keepActiveOption(
  options: AuditFacetOption[],
  previous: AuditFacetOption[],
  active: string,
): AuditFacetOption[] {
  if (!active || options.some((option) => option.value === active)) {
    return options;
  }
  const known = previous.find((option) => option.value === active);
  return [...options, known ?? { value: active, label: active }];
}

/**
 * 服务端把 from/to 当作 +08:00 的日历日，日期选择器的上限必须用同一时区推算：
 * 设备时区偏西时，跨日界那几个小时会把服务端的「今天」挡住；偏东则能选到服务端
 * 还没到来的日子。先把时刻平移 +8 小时，再取 UTC 日期即为北京日历日。
 */
export function shanghaiToday(now: number = Date.now()): string {
  const shifted = new Date(now + 8 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * 列表行的时间：当天只给时分，同年补月日，跨年才带年份 —— 单行卡片留给操作文案
 * 的宽度有限，而审计场景又不能像别处那样退化成「3 小时前」。
 */
export function formatAuditTime(
  value: string | null | undefined,
  now: number = Date.now(),
): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const today = new Date(now);
  const sameYear = date.getFullYear() === today.getFullYear();
  if (
    sameYear &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  ) {
    return clock;
  }
  const monthDay = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return sameYear
    ? `${monthDay} ${clock}`
    : `${date.getFullYear()}-${monthDay} ${clock}`;
}

/** 距下一个本地零点的毫秒数（跨月、跨年由 Date 自己进位）；至少给 1 秒，
 *  免得时钟回拨或边界抖动时排出一个 0 延时的自触发循环 */
export function msUntilNextLocalMidnight(now: number = Date.now()): number {
  const current = new Date(now);
  const midnight = new Date(
    current.getFullYear(),
    current.getMonth(),
    current.getDate() + 1,
  ).getTime();
  return Math.max(midnight - now, 1000);
}

/** metadata 为 JSON 列，缩进后原样展示；空对象与不可序列化值都视作没有附加数据 */
export function formatAuditMetadata(metadata: unknown): string {
  if (metadata === null || metadata === undefined) return "";
  if (typeof metadata === "object" && Object.keys(metadata).length === 0) {
    return "";
  }
  try {
    // 函数、Symbol 这类顶层值 stringify 出来是 undefined，一并按「没有」处理
    return JSON.stringify(metadata, null, 2) ?? "";
  } catch {
    return "";
  }
}

export type AuditDetailItem = {
  label: string;
  value: string;
  /** ID / IP / UA 这类值等宽展示，并支持轻触复制（小程序里无法框选文本） */
  mono: boolean;
};

/** 详情字段与 Web 端弹窗对齐；空值直接不出现，避免一屏「—」 */
export function auditDetailItems(row: AuditRow): AuditDetailItem[] {
  const actor = row.actorDisplay;
  const actorText =
    actor.secondary && actor.secondary !== "—"
      ? `${actor.name}（${actor.secondary}）`
      : actor.name;
  const items: Array<[string, string | null, boolean]> = [
    ["操作码", row.action, true],
    ["时间", formatDateTime(row.createdAt, { seconds: true }), false],
    ["执行人", actorText, false],
    ["结果", row.resultLabel || row.result, false],
    ["资源类型", row.resourceLabel, false],
    ["对象 ID", row.resourceId, true],
    ["所属项目", row.projectId, true],
    ["客户空间", row.customerSpaceId, true],
    ["服务请求", row.serviceRequestId, true],
    ["来源 IP", row.ipAddress, true],
    ["User-Agent", row.userAgent, true],
  ];
  return items
    .filter(([, value]) => Boolean(value))
    .map(([label, value, mono]) => ({ label, value: value as string, mono }));
}
