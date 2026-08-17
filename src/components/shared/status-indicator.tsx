import { Box, Stack, Typography } from "@mui/material";
import type {
  MilestoneStatus,
  ProjectStatus,
  RequestStatus,
} from "@/components/customer/customer-types";
import {
  statusColorFor,
  statusLabelFor,
  type StatusAudience,
} from "@/lib/status-config";

type Status = ProjectStatus | MilestoneStatus | RequestStatus;

export function statusLabel(status: Status, audience?: StatusAudience) {
  return statusLabelFor(status, audience);
}

export function StatusIndicator({
  status,
  compact = false,
  audience,
}: {
  status: Status;
  compact?: boolean;
  audience?: StatusAudience;
}) {
  const color = statusColorFor(status);
  return (
    <Stack direction="row" spacing={0.9} sx={{ alignItems: "center" }}>
      <Box
        aria-hidden
        sx={{
          width: compact ? 6 : 7,
          height: compact ? 6 : 7,
          borderRadius: "50%",
          bgcolor: color,
          flex: "0 0 auto",
        }}
      />
      <Typography
        component="span"
        variant="body2"
        sx={{ color: compact ? "text.secondary" : "text.primary" }}
      >
        {statusLabelFor(status, audience)}
      </Typography>
    </Stack>
  );
}
