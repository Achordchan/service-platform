import { Box, Chip, Stack, Typography } from "@mui/material";
import type {
  MilestoneStatus,
  ProjectStatus,
  RequestPriority,
  RequestStatus,
} from "@/components/staff/staff-types";
import { statusColorFor, statusLabelFor } from "@/lib/status-config";

type StatusValue = ProjectStatus | MilestoneStatus | RequestStatus;

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
          bgcolor: statusColorFor(value),
          flex: "0 0 auto",
        }}
      />
      <Typography variant={compact ? "body2" : "body1"} sx={{ whiteSpace: "nowrap" }}>
        {statusLabelFor(value)}
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
  return statusLabelFor(value);
}
