import { Box, Chip, Stack, Typography } from "@mui/material";
import type {
  MilestoneStatus,
  ProjectStatus,
  RequestPriority,
  RequestStatus,
} from "@/components/staff/staff-types";

type StatusValue = ProjectStatus | MilestoneStatus | RequestStatus;

const labels: Record<StatusValue, string> = {
  DRAFT: "待接入",
  ACTIVE: "进行中",
  PAUSED: "已暂停",
  COMPLETED: "已完成",
  EXPIRED: "已到期",
  NOT_STARTED: "未开始",
  IN_PROGRESS: "处理中",
  PENDING: "待处理",
  WAITING_CUSTOMER: "等待客户",
  RESOLVED: "已解决",
  CLOSED: "已关闭",
};

const colors: Record<StatusValue, string> = {
  DRAFT: "#98a2b3",
  ACTIVE: "#12b76a",
  PAUSED: "#f79009",
  COMPLETED: "#12b76a",
  EXPIRED: "#667085",
  NOT_STARTED: "#98a2b3",
  IN_PROGRESS: "#1677ff",
  PENDING: "#f79009",
  WAITING_CUSTOMER: "#7f56d9",
  RESOLVED: "#12b76a",
  CLOSED: "#667085",
};

const priorityLabels: Record<RequestPriority, string> = {
  LOW: "低",
  NORMAL: "普通",
  HIGH: "高",
  URGENT: "紧急",
};

export function StaffStatus({
  value,
  compact = false,
}: {
  value: StatusValue;
  compact?: boolean;
}) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      <Box
        sx={{
          width: compact ? 7 : 8,
          height: compact ? 7 : 8,
          borderRadius: "50%",
          bgcolor: colors[value],
          flex: "0 0 auto",
        }}
      />
      <Typography variant={compact ? "body2" : "body1"} sx={{ whiteSpace: "nowrap" }}>
        {labels[value]}
      </Typography>
    </Stack>
  );
}

export function PriorityChip({ value }: { value: RequestPriority }) {
  const color =
    value === "URGENT"
      ? "error"
      : value === "HIGH"
        ? "warning"
        : value === "NORMAL"
          ? "primary"
          : "default";
  return (
    <Chip
      label={priorityLabels[value]}
      color={color}
      variant="outlined"
      size="small"
    />
  );
}

export function statusLabel(value: StatusValue) {
  return labels[value];
}
