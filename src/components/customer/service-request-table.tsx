"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Box,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import ChevronRightOutlinedIcon from "@mui/icons-material/ChevronRightOutlined";
import type { ServiceRequestSummary } from "@/components/customer/customer-types";
import { EmptyState } from "@/components/shared/content-state";
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
      <TableContainer sx={{ display: { xs: "none", md: "block" } }}>
        <Table size={compact ? "small" : "medium"}>
          <TableHead>
            <TableRow>
              <TableCell>请求编号</TableCell>
              <TableCell>标题</TableCell>
              {showProjectColumn ? <TableCell>所属项目</TableCell> : null}
              <TableCell>请求分类</TableCell>
              <TableCell>状态</TableCell>
              <TableCell>更新时间</TableCell>
              <TableCell>处理人</TableCell>
              <TableCell width={48} />
            </TableRow>
          </TableHead>
          <TableBody>
            {requests.map((request) => (
              <TableRow
                key={request.id}
                hover
                onClick={() =>
                  router.push(`/customer/requests/${request.id}`)
                }
                sx={{
                  cursor: "pointer",
                  "&:last-child td": { borderBottom: 0 },
                }}
              >
                <TableCell sx={{ whiteSpace: "nowrap" }}>
                  {request.number}
                </TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{request.title}</TableCell>
                {showProjectColumn ? (
                  <TableCell>{request.projectTitle}</TableCell>
                ) : null}
                <TableCell>{request.category.name}</TableCell>
                <TableCell sx={{ whiteSpace: "nowrap" }}>
                  <StatusIndicator status={request.status} compact />
                </TableCell>
                <TableCell sx={{ whiteSpace: "nowrap" }}>
                  {dateFormatter.format(new Date(request.updatedAt))}
                </TableCell>
                <TableCell sx={{ whiteSpace: "nowrap" }}>
                  {request.assigneeName || "待分配"}
                </TableCell>
                <TableCell>
                  <ChevronRightOutlinedIcon color="action" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}
