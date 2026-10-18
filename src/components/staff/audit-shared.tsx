"use client";

import { parseISO } from "date-fns";
import {
  Avatar,
  Box,
  Button,
  Chip,
  IconButton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import BusinessOutlinedIcon from "@mui/icons-material/BusinessOutlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import DevicesOutlinedIcon from "@mui/icons-material/DevicesOutlined";
import PersonOffOutlinedIcon from "@mui/icons-material/PersonOffOutlined";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import { DateStringPicker } from "@/components/shared/date-string-picker";
import { useToast } from "@/components/shared/toast-provider";
import {
  getAvatarInitials,
  getAvatarPalette,
} from "@/lib/default-avatar";
import { formatRelativeTime } from "@/lib/relative-time";
import { formatDuration } from "@/modules/audit/audit-presentation";
import type {
  AuditActorView,
  AuditDeviceView,
  AuditRange,
  AuditRangePreset,
  AuditSessionView,
} from "@/modules/audit/audit-types";

export { formatDuration } from "@/modules/audit/audit-presentation";

export const AUDIT_TIME_ZONE = "Asia/Shanghai";

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: AUDIT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function shanghaiDayKey(date: Date = new Date()): string {
  const parts = dayFormatter.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: AUDIT_TIME_ZONE,
  hourCycle: "h23",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const fullFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: AUDIT_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const dayHeadingFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: AUDIT_TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  weekday: "short",
});

function normalize(value: string) {
  return value.replace(/\//g, "-").replace(/\s+/g, " ").trim();
}

/** 列表里的短时间：`10-18 09:47`，固定北京时间，避免浏览器时区造成「昨天/今天」错位。 */
export function formatAuditTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : normalize(timeFormatter.format(date));
}

/** 详情/提示里的完整时间（精确到秒）。 */
export function formatAuditFullTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : `${normalize(fullFormatter.format(date))}（北京时间）`;
}

export function formatAuditDayHeading(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = dayHeadingFormatter.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const sameYear = pick("year") === String(new Date().getFullYear());
  return `${sameYear ? "" : `${pick("year")} 年 `}${pick("month")} 月 ${pick("day")} 日 · ${pick("weekday")}`;
}

export function AuditTimeCell({ iso }: { iso: string }) {
  return (
    <Tooltip title={formatAuditFullTime(iso)}>
      <Stack spacing={0.25} sx={{ minWidth: 0 }}>
        <Typography
          variant="body2"
          sx={{ fontVariantNumeric: "tabular-nums" }}
          noWrap
        >
          {formatAuditTime(iso)}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {formatRelativeTime(iso)}
        </Typography>
      </Stack>
    </Tooltip>
  );
}

const RESULT_TONE: Record<string, "success" | "error" | "warning" | "default"> = {
  SUCCESS: "success",
  FAILURE: "error",
  FAILED: "error",
  DENIED: "warning",
};

export function ResultChip({ result, label }: { result: string; label: string }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      label={label}
      color={RESULT_TONE[result] ?? "default"}
    />
  );
}

function ActorAvatar({ actor, size = 30 }: { actor: AuditActorView; size?: number }) {
  if (actor.kind === "USER") {
    const palette = getAvatarPalette(actor.id ?? actor.name);
    return (
      <Avatar
        sx={{
          width: size,
          height: size,
          fontSize: size * 0.42,
          fontWeight: 650,
          bgcolor: palette.bg,
          color: palette.fg,
        }}
      >
        {getAvatarInitials(actor.name)}
      </Avatar>
    );
  }
  const icon =
    actor.kind === "ANONYMOUS" ? (
      <PersonOffOutlinedIcon sx={{ fontSize: size * 0.55 }} />
    ) : actor.kind === "EXTERNAL" ? (
      <BusinessOutlinedIcon sx={{ fontSize: size * 0.55 }} />
    ) : (
      <SmartToyOutlinedIcon sx={{ fontSize: size * 0.55 }} />
    );
  return (
    <Avatar
      sx={{
        width: size,
        height: size,
        bgcolor: "action.hover",
        color: "text.secondary",
      }}
    >
      {icon}
    </Avatar>
  );
}

/** 执行人：头像 + 姓名；副行是角色与邮箱，未登录/系统任务有明确标注。 */
export function ActorIdentity({
  actor,
  showEmail = true,
}: {
  actor: AuditActorView;
  showEmail?: boolean;
}) {
  const secondary =
    actor.kind === "USER"
      ? showEmail && actor.email
        ? `${actor.roleLabel ?? "用户"} · ${actor.email}`
        : actor.roleLabel ?? actor.email ?? "用户"
      : actor.kind === "ANONYMOUS"
        ? actor.email
          ? `未登录尝试 · ${actor.email}`
          : "未登录尝试"
        : actor.kind === "EXTERNAL"
          ? "外部联系人"
          : "自动任务";
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
      <ActorAvatar actor={actor} />
      <Stack spacing={0.15} sx={{ minWidth: 0 }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 550 }}>
          {actor.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {secondary}
        </Typography>
      </Stack>
    </Stack>
  );
}

export function DeviceLine({
  device,
  ipAddress,
  ipScope,
}: {
  device: AuditDeviceView;
  ipAddress?: string | null;
  ipScope?: "PRIVATE" | "PUBLIC" | null;
}) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", minWidth: 0 }}>
      <DevicesOutlinedIcon fontSize="small" sx={{ color: "text.secondary" }} />
      <Stack spacing={0.15} sx={{ minWidth: 0 }}>
        <Typography variant="body2" noWrap>
          {device.label}
        </Typography>
        {ipAddress ? (
          <Typography variant="caption" color="text.secondary" noWrap>
            {ipAddress}
            {ipScope === "PRIVATE"
              ? " · 内网"
              : ipScope === "PUBLIC"
                ? " · 公网"
                : ""}
          </Typography>
        ) : null}
      </Stack>
    </Stack>
  );
}

const SESSION_TONE: Record<
  AuditSessionView["endReason"],
  "success" | "primary" | "warning" | "default"
> = {
  LOGGED_OUT: "success",
  ACTIVE: "primary",
  STALE: "warning",
  UNKNOWN: "default",
};

export function SessionStatusChip({
  reason,
  label,
}: {
  reason: AuditSessionView["endReason"];
  label: string;
}) {
  return (
    <Chip
      size="small"
      variant="outlined"
      color={SESSION_TONE[reason]}
      label={label}
    />
  );
}

export function DurationText({
  ms,
  compact = true,
}: {
  ms: number | null | undefined;
  compact?: boolean;
}) {
  return (
    <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
      {formatDuration(ms ?? null, compact)}
    </Typography>
  );
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const toast = useToast();
  return (
    <Tooltip title={label}>
      <IconButton
        size="small"
        aria-label={label}
        onClick={() => {
          try {
            void navigator.clipboard?.writeText(value);
            toast.success("已复制");
          } catch {
            toast.error("复制失败，请手动选择文本");
          }
        }}
      >
        <ContentCopyOutlinedIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

export function rangeForPreset(
  preset: Exclude<AuditRangePreset, "custom">,
  now: Date = new Date(),
): AuditRange {
  const today = shanghaiDayKey(now);
  if (preset === "today") return { preset, from: today, to: today };
  const days = preset === "7d" ? 7 : 30;
  // 用 UTC 毫秒做日历减法：本地时区的 DST 切换日不能让「近 7 天」少一天
  const start = new Date(
    parseISO(`${today}T00:00:00Z`).getTime() - (days - 1) * 86_400_000,
  );
  return { preset, from: start.toISOString().slice(0, 10), to: today };
}

export function formatRangeLabel(range: Pick<AuditRange, "from" | "to">): string {
  const format = (value: string) => {
    const [year, month, day] = value.split("-");
    return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
  };
  if (range.from === range.to) return format(range.from);
  const [fromYear, fromMonth, fromDay] = range.from.split("-");
  const [toYear, toMonth, toDay] = range.to.split("-");
  if (fromYear === toYear && fromMonth === toMonth) {
    return `${Number(fromMonth)} 月 ${Number(fromDay)} – ${Number(toDay)} 日`;
  }
  return `${format(range.from)} – ${format(range.to)}`;
}

const PRESET_OPTIONS: Array<{ value: AuditRangePreset; label: string }> = [
  { value: "today", label: "今天" },
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "custom", label: "自定义" },
];

export function AuditRangePicker({
  value,
  onChange,
}: {
  value: AuditRange;
  onChange: (range: AuditRange) => void;
}) {
  return (
    <Stack
      direction={{ xs: "column", md: "row" }}
      spacing={1.25}
      sx={{ alignItems: { xs: "stretch", md: "center" } }}
    >
      <ToggleButtonGroup
        size="small"
        exclusive
        value={value.preset}
        onChange={(_event, next: AuditRangePreset | null) => {
          if (!next) return;
          if (next === "custom") {
            onChange({ ...value, preset: "custom" });
            return;
          }
          onChange(rangeForPreset(next));
        }}
        aria-label="统计时间范围"
        sx={{ flexShrink: 0 }}
      >
        {PRESET_OPTIONS.map((option) => (
          <ToggleButton key={option.value} value={option.value} sx={{ px: 1.5 }}>
            {option.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      {value.preset === "custom" ? (
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
          <Box sx={{ minWidth: 150 }}>
            <DateStringPicker
              label="开始日期"
              value={value.from}
              onChange={(from) => onChange({ ...value, from: from || value.from })}
              maxDate={value.to}
            />
          </Box>
          <Box sx={{ minWidth: 150 }}>
            <DateStringPicker
              label="结束日期"
              value={value.to}
              onChange={(to) => onChange({ ...value, to: to || value.to })}
              minDate={value.from}
              maxDate={shanghaiDayKey()}
            />
          </Box>
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ pl: { md: 0.5 } }}>
          {formatRangeLabel(value)}
        </Typography>
      )}
    </Stack>
  );
}

/**
 * 「当前登录」说明：Session 的 7 天有效期不等于人还在电脑前。
 * 这个提示放在所有展示处旁边，避免把「会话有效」误读成「在线」。
 */
export function SessionCaveat({ children }: { children?: React.ReactNode }) {
  return (
    <Typography variant="caption" color="text.secondary">
      {children ??
        "按登录会话统计：会话仍有效即算「登录中」，不代表此刻正在浏览页面。"}
    </Typography>
  );
}

export function AuditEmptyHint({ onReset }: { onReset?: () => void }) {
  return (
    <Stack spacing={1} sx={{ alignItems: "center", py: 5, px: 3, textAlign: "center" }}>
      <Typography variant="subtitle1">没有符合条件的记录</Typography>
      <Typography variant="body2" color="text.secondary">
        换一个时间范围，或清除筛选条件再试。
      </Typography>
      {onReset ? (
        <Button size="small" onClick={onReset}>
          清除筛选
        </Button>
      ) : null}
    </Stack>
  );
}
