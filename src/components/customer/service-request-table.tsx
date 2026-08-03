"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Box,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import ChevronRightOutlinedIcon from "@mui/icons-material/ChevronRightOutlined";
import type { ServiceRequestSummary } from "@/components/customer/customer-types";
import { EmptyState } from "@/components/shared/content-state";
import { ServiceRequestGrid } from "@/components/customer/service-request-grid";
import { StatusIndicator } from "@/components/shared/status-indicator";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function MobileRequestRow({
  request,
}: {
  request: ServiceRequestSummary;
}) {
  return (
    <Stack
      component={Link}
      href={`/customer/requests/${request.id}`}
      direction="row"
      spacing={1.5}
      sx={{
        alignItems: "center",
        p: 2,
        borderBottom: "1px solid",
        borderColor: "divider",
        color: "inherit",
        textDecoration: "none",
        "&:last-child": { borderBottom: 0 },
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography noWrap sx={{ fontWeight: 650 }}>
          {request.title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {request.number} · {request.category.name}
        </Typography>
        <Stack
          direction="row"
          sx={{
            mt: 1.25,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <StatusIndicator status={request.status} compact />
          <Typography variant="body2" color="text.secondary">
            {dateFormatter.format(new Date(request.updatedAt))}
          </Typography>
        </Stack>
      </Box>
      <ChevronRightOutlinedIcon color="action" />
    </Stack>
  );
}

export function ServiceRequestTable({
  requests,
  compact = false,
  hideProjectColumn = false,
}: {
  requests: ServiceRequestSummary[];
  compact?: boolean;
  hideProjectColumn?: boolean;
}) {
  const router = useRouter();
  const showProjectColumn = !compact && !hideProjectColumn;
  if (requests.length === 0) {
    return (
      <EmptyState
        title="暂无服务请求"
        description="提交服务请求后，可在这里持续查看处理状态。"
      />
    );
  }

  return (
    <Paper variant="outlined" sx={{ overflow: "hidden" }}>
      <Box sx={{ display: { xs: "block", md: "none" } }}>
        {requests.map((request) => (
          <MobileRequestRow key={request.id} request={request} />
          ))}
      </Box>
      <Box sx={{ display: { xs: "none", md: "block" } }}>
        <ServiceRequestGrid
          rows={requests}
          compact={compact}
          hideProjectColumn={!showProjectColumn}
          onOpen={(request) =>
            router.push(`/customer/requests/${request.id}`)
          }
        />
      </Box>
    </Paper>
  );
}
