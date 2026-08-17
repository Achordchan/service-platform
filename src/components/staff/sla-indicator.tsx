"use client";

import { Chip, Tooltip, type ChipProps } from "@mui/material";
import {
  AccessTimeRounded,
  CheckCircleOutlineRounded,
  ErrorOutlineRounded,
  WarningAmberRounded,
} from "@mui/icons-material";

type SlaStatus = "on_track" | "at_risk" | "breached" | "responded";

function resolveSlaStatus(
  dueAt: string | null | undefined,
  firstRespondedAt: string | null | undefined,
  status: string,
): SlaStatus | null {
  if (!dueAt) return null;
  const closedStatuses = ["RESOLVED", "CLOSED"];
  if (closedStatuses.includes(status)) {
    if (firstRespondedAt) return "responded";
    return null;
  }
  const remaining = new Date(dueAt).getTime() - Date.now();
  if (remaining <= 0) return "breached";
  if (remaining < 3_600_000) return "at_risk";
  return "on_track";
}

function formatRemaining(dueAt: string) {
  const diff = new Date(dueAt).getTime() - Date.now();
  if (diff <= 0) {
    const overdue = Math.abs(diff);
    if (overdue < 3_600_000) return `已超时 ${Math.ceil(overdue / 60_000)} 分钟`;
    if (overdue < 86_400_000)
      return `已超时 ${Math.floor(overdue / 3_600_000)} 小时`;
    return `已超时 ${Math.floor(overdue / 86_400_000)} 天`;
  }
  if (diff < 3_600_000) return `剩余 ${Math.ceil(diff / 60_000)} 分钟`;
  if (diff < 86_400_000) return `剩余 ${Math.floor(diff / 3_600_000)} 小时`;
  return `剩余 ${Math.floor(diff / 86_400_000)} 天`;
}

const CONFIG: Record<
  SlaStatus,
  { label: string; color: ChipProps["color"]; Icon: typeof AccessTimeRounded }
> = {
  on_track: {
    label: "SLA 正常",
    color: "success",
    Icon: AccessTimeRounded,
  },
  at_risk: {
    label: "SLA 临近",
    color: "warning",
    Icon: WarningAmberRounded,
  },
  breached: {
    label: "SLA 超时",
    color: "error",
    Icon: ErrorOutlineRounded,
  },
  responded: {
    label: "已首响",
    color: "success",
    Icon: CheckCircleOutlineRounded,
  },
};

export function SlaIndicator({
  dueAt,
  firstRespondedAt,
  status,
  compact = false,
}: {
  dueAt?: string | null;
  firstRespondedAt?: string | null;
  status: string;
  compact?: boolean;
}) {
  const slaStatus = resolveSlaStatus(dueAt, firstRespondedAt, status);
  if (!slaStatus) return null;

  const config = CONFIG[slaStatus];
  const tooltip =
    slaStatus === "responded"
      ? `首响时间：${new Intl.DateTimeFormat("zh-CN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date(firstRespondedAt!))}`
      : dueAt
        ? `截止：${new Intl.DateTimeFormat("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).format(new Date(dueAt))}（${formatRemaining(dueAt)}）`
        : "";

  return (
    <Tooltip title={tooltip} arrow>
      <Chip
        size="small"
        icon={<config.Icon sx={{ fontSize: 14 }} />}
        label={compact && dueAt && slaStatus !== "responded" ? formatRemaining(dueAt) : config.label}
        color={config.color}
        variant="outlined"
        sx={{ height: 22, fontSize: 11 }}
      />
    </Tooltip>
  );
}
