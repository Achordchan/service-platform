import { Box, Stack, Typography } from "@mui/material";
import type {
  MilestoneStatus,
  ProjectStatus,
  RequestStatus,
} from "@/components/customer/customer-types";

const statusMap = {
  DRAFT: { label: "待开始", color: "#98a2b3" },
  ACTIVE: { label: "进行中", color: "#1677ff" },
  PAUSED: { label: "已暂停", color: "#d98b16" },
  COMPLETED: { label: "已完成", color: "#16a466" },
  EXPIRED: { label: "已到期", color: "#d14343" },
  NOT_STARTED: { label: "未开始", color: "#98a2b3" },
  IN_PROGRESS: { label: "处理中", color: "#1677ff" },
  PENDING: { label: "待处理", color: "#d98b16" },
  WAITING_CUSTOMER: { label: "等待回复", color: "#8b5cf6" },
  RESOLVED: { label: "已解决", color: "#16a466" },
  CLOSED: { label: "已关闭", color: "#667085" },
} satisfies Record<
  ProjectStatus | MilestoneStatus | RequestStatus,
  { label: string; color: string }
>;

export function statusLabel(
  status: ProjectStatus | MilestoneStatus | RequestStatus,
) {
  return statusMap[status].label;
}

export function StatusIndicator({
  status,
  compact = false,
}: {
  status: ProjectStatus | MilestoneStatus | RequestStatus;
  compact?: boolean;
}) {
  const config = statusMap[status];
  return (
    <Stack direction="row" spacing={0.9} sx={{ alignItems: "center" }}>
      <Box
        aria-hidden
        sx={{
          width: compact ? 6 : 7,
          height: compact ? 6 : 7,
          borderRadius: "50%",
          bgcolor: config.color,
          flex: "0 0 auto",
        }}
      />
      <Typography
        component="span"
        variant="body2"
        sx={{ color: compact ? "text.secondary" : "text.primary" }}
      >
        {config.label}
      </Typography>
    </Stack>
  );
}
