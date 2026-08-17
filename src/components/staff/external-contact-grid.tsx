"use client";

import { useMemo } from "react";
import { Avatar, Box, Button, Chip, Stack, Typography } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import ContactsOutlinedIcon from "@mui/icons-material/ContactsOutlined";
import { gridHeight, gridSx } from "@/lib/data-grid-styles";
import { gridNoRowsOverlay } from "@/components/shared/data-grid-empty-overlay";

const noRows = gridNoRowsOverlay("暂无外部联系人", <ContactsOutlinedIcon />);

export type ExternalContact = {
  id: string;
  externalUserId: string;
  email: string | null;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  profileAttributes: Record<string, string | number | boolean>;
  sourceKey: string;
  sourceLabel: string;
  status: "ACTIVE" | "BLOCKED";
  firstSeenAt: string;
  lastSeenAt: string;
  _count: { requestsCreated: number };
};

export function ExternalContactGrid({
  rows,
  actionContactId,
  onView,
  onToggle,
}: {
  rows: ExternalContact[];
  actionContactId: string | null;
  onView: (contact: ExternalContact) => void;
  onToggle: (contact: ExternalContact) => void;
}) {
  const columns = useMemo<GridColDef<ExternalContact>[]>(
    () => [
      {
        field: "displayName",
        headerName: "联系人",
        minWidth: 230,
        flex: 1.1,
        valueGetter: (_value, row) =>
          `${row.displayName} ${
            row.status === "ACTIVE" ? "正常" : "已停用"
          }`,
        renderCell: ({ row }) => (
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", minWidth: 0, py: 0.5 }}
          >
            <Avatar
              src={row.avatarUrl ?? undefined}
              sx={{ width: 28, height: 28 }}
            >
              {row.displayName.slice(0, 1)}
            </Avatar>
            <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
              {row.displayName}
            </Typography>
            <Chip
              size="small"
              label={row.status === "ACTIVE" ? "正常" : "已停用"}
              color={row.status === "ACTIVE" ? "success" : "default"}
            />
          </Stack>
        ),
      },
      {
        field: "sourceLabel",
        headerName: "来源",
        minWidth: 140,
        flex: 0.65,
        renderCell: ({ row }) => (
          <Chip size="small" label={row.sourceLabel} variant="outlined" />
        ),
      },
      {
        field: "externalUserId",
        headerName: "外部用户 ID",
        minWidth: 180,
        flex: 0.85,
      },
      {
        field: "contactAccount",
        headerName: "邮箱 / 用户名",
        minWidth: 210,
        flex: 1,
        valueGetter: (_value, row) => row.email || row.username || "未提供",
      },
      {
        field: "requestsCreated",
        headerName: "服务请求",
        type: "number",
        width: 110,
        align: "right",
        headerAlign: "right",
        valueGetter: (_value, row) => row._count.requestsCreated,
      },
      {
        field: "lastSeenAt",
        headerName: "最后访问",
        type: "dateTime",
        minWidth: 180,
        flex: 0.8,
        valueGetter: (value) => new Date(value as string),
        renderCell: ({ row }) =>
          new Date(row.lastSeenAt).toLocaleString("zh-CN"),
      },
      {
        field: "actions",
        headerName: "操作",
        width: 180,
        align: "right",
        headerAlign: "right",
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        renderCell: ({ row }) => {
          const working = actionContactId === row.id;
          return (
            <Stack
              direction="row"
              spacing={0.5}
              sx={{ justifyContent: "flex-end", width: "100%" }}
            >
              <Button size="small" onClick={() => onView(row)}>
                查看资料
              </Button>
              <Button
                size="small"
                color={row.status === "ACTIVE" ? "inherit" : "primary"}
                onClick={() => onToggle(row)}
                disabled={actionContactId !== null}
              >
                {working
                  ? row.status === "ACTIVE"
                    ? "停用中"
                    : "恢复中"
                  : row.status === "ACTIVE"
                    ? "停用"
                    : "恢复"}
              </Button>
            </Stack>
          );
        },
      },
    ],
    [actionContactId, onToggle, onView],
  );

  return (
    <>
      <Box
        sx={{
          width: "100%",
          height: gridHeight(rows.length, 68),
          display: { xs: "none", md: "block" },
        }}
      >
        <DataGrid
          aria-label="外部联系人"
          rows={rows}
          columns={columns}
          getRowHeight={() => "auto"}
          getEstimatedRowHeight={() => 68}
          pageSizeOptions={[50, 100]}
          initialState={{
            pagination: { paginationModel: { pageSize: 50, page: 0 } },
          }}
          disableRowSelectionOnClick
          hideFooter={rows.length <= 50}
          slots={{ noRowsOverlay: noRows }}
          sx={gridSx}
        />
      </Box>

      <Stack sx={{ display: { xs: "flex", md: "none" } }}>
        {rows.map((row) => {
          const working = actionContactId === row.id;
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
                spacing={1}
                sx={{ alignItems: "center", mb: 0.5 }}
              >
                <Avatar
                  src={row.avatarUrl ?? undefined}
                  sx={{ width: 28, height: 28 }}
                >
                  {row.displayName.slice(0, 1)}
                </Avatar>
                <Typography
                  variant="body2"
                  noWrap
                  sx={{ fontWeight: 650, minWidth: 0, flex: 1 }}
                >
                  {row.displayName}
                </Typography>
                <Chip
                  size="small"
                  label={row.status === "ACTIVE" ? "正常" : "已停用"}
                  color={row.status === "ACTIVE" ? "success" : "default"}
                />
              </Stack>

              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: "center", mb: 0.5 }}
              >
                <Chip
                  size="small"
                  label={row.sourceLabel}
                  variant="outlined"
                />
                <Typography variant="caption" color="text.secondary" noWrap>
                  {row.email || row.username || "未提供"}
                </Typography>
              </Stack>

              <Typography variant="caption" color="text.secondary">
                服务请求 {row._count.requestsCreated} · 最后访问{" "}
                {new Date(row.lastSeenAt).toLocaleDateString("zh-CN")}
              </Typography>

              <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                <Button size="small" onClick={() => onView(row)}>
                  查看资料
                </Button>
                <Button
                  size="small"
                  color={row.status === "ACTIVE" ? "inherit" : "primary"}
                  onClick={() => onToggle(row)}
                  disabled={actionContactId !== null}
                >
                  {working
                    ? row.status === "ACTIVE"
                      ? "停用中"
                      : "恢复中"
                    : row.status === "ACTIVE"
                      ? "停用"
                      : "恢复"}
                </Button>
              </Stack>
            </Box>
          );
        })}
        {rows.length === 0 && (
          <Box sx={{ p: 4, textAlign: "center" }}>
            <Typography color="text.secondary">暂无外部联系人</Typography>
          </Box>
        )}
      </Stack>
    </>
  );
}
