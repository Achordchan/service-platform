"use client";

import { useMemo } from "react";
import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import type { MailMessageView } from "@/components/staff/platform-settings-types";
import MailOutlineOutlinedIcon from "@mui/icons-material/MailOutlineOutlined";
import { gridHeight, gridSx } from "@/lib/data-grid-styles";
import { gridNoRowsOverlay } from "@/components/shared/data-grid-empty-overlay";

const noRows = gridNoRowsOverlay("暂无邮件记录", <MailOutlineOutlinedIcon />);

const statusLabel: Record<MailMessageView["status"], string> = {
  QUEUED: "排队中",
  PROCESSING: "发送中",
  SENT: "已提交",
  DELIVERY_DELAYED: "投递延迟",
  DELIVERED: "已送达",
  BOUNCED: "已退信",
  COMPLAINED: "被投诉",
  SUPPRESSED: "已拦截",
  FAILED: "失败",
  CANCELLED: "已取消",
};

const statusColor = {
  QUEUED: "default",
  PROCESSING: "info",
  SENT: "info",
  DELIVERY_DELAYED: "warning",
  DELIVERED: "success",
  BOUNCED: "error",
  COMPLAINED: "error",
  SUPPRESSED: "error",
  FAILED: "error",
  CANCELLED: "default",
} as const;

export const deliveryModeLabel: Record<
  MailMessageView["deliveryMode"],
  string
> = {
  LOCAL_OUTBOX: "未启用",
  RESEND: "Resend",
  SMTP: "SMTP",
};


export function MailMessageGrid({
  rows,
  asOf,
  messageAction,
  onView,
  onRetry,
  onCancel,
}: {
  rows: MailMessageView[];
  asOf: string;
  messageAction: string | null;
  onView: (message: MailMessageView) => void;
  onRetry: (messageId: string) => void;
  onCancel: (messageId: string) => void;
}) {
  const asOfTimestamp = new Date(asOf).getTime();
  const columns = useMemo<GridColDef<MailMessageView>[]>(
    () => [
      {
        field: "createdAt",
        headerName: "时间",
        type: "dateTime",
        minWidth: 180,
        flex: 0.75,
        valueGetter: (value) => new Date(value as string),
        renderCell: ({ row }) =>
          new Date(row.createdAt).toLocaleString("zh-CN"),
      },
      {
        field: "toEmail",
        headerName: "收件人",
        minWidth: 210,
        flex: 0.9,
      },
      {
        field: "subject",
        headerName: "主题",
        minWidth: 260,
        flex: 1.2,
        valueGetter: (_value, row) => `${row.subject} ${row.heading}`,
        renderCell: ({ row }) => (
          <Stack spacing={0.25} sx={{ minWidth: 0, py: 0.5 }}>
            <Typography sx={{ fontWeight: 650 }} noWrap>
              {row.subject}
            </Typography>
            <Typography color="text.secondary" variant="body2" noWrap>
              {row.heading}
            </Typography>
          </Stack>
        ),
      },
      {
        field: "deliveryMode",
        headerName: "方式",
        minWidth: 110,
        flex: 0.45,
        valueGetter: (value) =>
          deliveryModeLabel[value as MailMessageView["deliveryMode"]],
      },
      {
        field: "status",
        headerName: "状态",
        minWidth: 210,
        flex: 0.9,
        valueGetter: (value) =>
          statusLabel[value as MailMessageView["status"]],
        renderCell: ({ row }) => {
          const overdue =
            row.status === "QUEUED" &&
            new Date(row.sendAfter).getTime() <=
              asOfTimestamp - 2 * 60 * 1000;

          return (
            <Stack spacing={0.25} sx={{ py: 0.5 }}>
              <Chip
                size="small"
                label={statusLabel[row.status]}
                color={statusColor[row.status]}
                sx={{ alignSelf: "flex-start" }}
              />
              {overdue ? (
                <Typography
                  color="error"
                  variant="caption"
                  sx={{ fontWeight: 650 }}
                >
                  已逾期超过 2 分钟
                </Typography>
              ) : null}
              {row.errorMessage ? (
                <Typography color="error" variant="caption">
                  {row.errorMessage}
                </Typography>
              ) : null}
              {row.lastEventAt ? (
                <Typography color="text.secondary" variant="caption">
                  {new Date(row.lastEventAt).toLocaleString("zh-CN")}
                </Typography>
              ) : null}
              {row.attemptCount > 0 ? (
                <Typography color="text.secondary" variant="caption">
                  尝试 {row.attemptCount} 次
                </Typography>
              ) : null}
            </Stack>
          );
        },
      },
      {
        field: "actions",
        headerName: "操作",
        minWidth: 260,
        flex: 1,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        renderCell: ({ row }) => (
          <Stack
            direction="row"
            spacing={0.5}
            useFlexGap
            sx={{ flexWrap: "wrap", py: 0.5 }}
          >
            <Button size="small" onClick={() => onView(row)}>
              查看内容
            </Button>
            {row.actionUrl ? (
              <Button
                size="small"
                href={row.actionUrl}
                target="_blank"
                rel="noreferrer"
              >
                打开链接
              </Button>
            ) : null}
            {row.status === "QUEUED" ||
            row.status === "FAILED" ||
            row.status === "CANCELLED" ? (
              <Button
                size="small"
                disabled={messageAction !== null}
                onClick={() => onRetry(row.id)}
              >
                {messageAction === `${row.id}:retry` ? "入队中" : "重试"}
              </Button>
            ) : null}
            {row.status === "QUEUED" ? (
              <Button
                size="small"
                color="inherit"
                disabled={messageAction !== null}
                onClick={() => onCancel(row.id)}
              >
                {messageAction === `${row.id}:cancel` ? "取消中" : "取消"}
              </Button>
            ) : null}
          </Stack>
        ),
      },
    ],
    [asOfTimestamp, messageAction, onCancel, onRetry, onView],
  );

  return (
    <>
      <Box
        sx={{
          display: { xs: "none", md: "block" },
          width: "100%",
          height: gridHeight(rows.length, 96),
        }}
      >
        <DataGrid
          aria-label="邮件发送记录"
          rows={rows}
          columns={columns}
          getRowHeight={() => "auto"}
          getEstimatedRowHeight={() => 96}
          pageSizeOptions={[10, 20, 50]}
          initialState={{
            pagination: { paginationModel: { pageSize: 10, page: 0 } },
          }}
          disableRowSelectionOnClick
          hideFooter={rows.length <= 10}
          slots={{ noRowsOverlay: noRows }}
          sx={gridSx}
        />
      </Box>

      <Stack sx={{ display: { xs: "flex", md: "none" } }}>
        {rows.map((row) => {
          const overdue =
            row.status === "QUEUED" &&
            new Date(row.sendAfter).getTime() <=
              asOfTimestamp - 2 * 60 * 1000;

          return (
            <Box
              key={row.id}
              sx={{
                py: 1.5,
                px: 2,
                borderBottom: "1px solid",
                borderColor: "divider",
                "&:last-child": { borderBottom: 0 },
              }}
            >
              <Stack
                direction="row"
                sx={{
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 1,
                }}
              >
                <Typography sx={{ fontWeight: 650, minWidth: 0 }} noWrap>
                  {row.subject}
                </Typography>
                <Chip
                  size="small"
                  label={statusLabel[row.status]}
                  color={statusColor[row.status]}
                  sx={{ flexShrink: 0 }}
                />
              </Stack>

              <Typography
                variant="body2"
                color="text.secondary"
                noWrap
              >
                {row.heading}
              </Typography>

              <Typography variant="caption" color="text.secondary">
                {row.toEmail} · {deliveryModeLabel[row.deliveryMode]} ·{" "}
                {new Date(row.createdAt).toLocaleString("zh-CN")}
              </Typography>

              {(row.errorMessage || overdue) && (
                <Stack spacing={0.25} sx={{ mt: 0.5 }}>
                  {row.errorMessage && (
                    <Typography color="error" variant="caption">
                      {row.errorMessage}
                    </Typography>
                  )}
                  {overdue && (
                    <Typography
                      color="error"
                      variant="caption"
                      sx={{ fontWeight: 650 }}
                    >
                      已逾期超过 2 分钟
                    </Typography>
                  )}
                </Stack>
              )}

              <Stack
                direction="row"
                spacing={0.5}
                useFlexGap
                sx={{ flexWrap: "wrap", mt: 1 }}
              >
                <Button size="small" onClick={() => onView(row)}>
                  查看内容
                </Button>
                {row.actionUrl && (
                  <Button
                    size="small"
                    href={row.actionUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    打开链接
                  </Button>
                )}
                {(row.status === "QUEUED" ||
                  row.status === "FAILED" ||
                  row.status === "CANCELLED") && (
                  <Button
                    size="small"
                    disabled={messageAction !== null}
                    onClick={() => onRetry(row.id)}
                  >
                    {messageAction === `${row.id}:retry` ? "入队中" : "重试"}
                  </Button>
                )}
                {row.status === "QUEUED" && (
                  <Button
                    size="small"
                    color="inherit"
                    disabled={messageAction !== null}
                    onClick={() => onCancel(row.id)}
                  >
                    {messageAction === `${row.id}:cancel` ? "取消中" : "取消"}
                  </Button>
                )}
              </Stack>
            </Box>
          );
        })}
        {rows.length === 0 && (
          <Box sx={{ p: 4, textAlign: "center" }}>
            <Typography color="text.secondary">暂无邮件记录</Typography>
          </Box>
        )}
      </Stack>
    </>
  );
}
