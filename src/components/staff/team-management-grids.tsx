"use client";

import { useMemo } from "react";
import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import PeopleOutlineOutlinedIcon from "@mui/icons-material/PeopleOutlineOutlined";
import MailOutlineOutlinedIcon from "@mui/icons-material/MailOutlineOutlined";
import type {
  StaffInviteView,
  TeamMemberView,
} from "@/components/staff/team-manager";
import { gridHeight, gridSx } from "@/lib/data-grid-styles";
import { gridNoRowsOverlay } from "@/components/shared/data-grid-empty-overlay";

const teamMemberNoRows = gridNoRowsOverlay(
  "暂无团队成员",
  <PeopleOutlineOutlinedIcon />,
);
const staffInvitationNoRows = gridNoRowsOverlay(
  "暂无待处理邀请",
  <MailOutlineOutlinedIcon />,
);

export function TeamMemberGrid({
  rows,
  submitting,
  onEdit,
  onDelete,
}: {
  rows: TeamMemberView[];
  submitting: boolean;
  onEdit: (member: TeamMemberView) => void;
  onDelete: (member: TeamMemberView) => void;
}) {
  const columns = useMemo<GridColDef<TeamMemberView>[]>(
    () => [
      {
        field: "name",
        headerName: "姓名",
        minWidth: 230,
        flex: 1.5,
        renderCell: ({ row }) => (
          <Stack spacing={0.35} sx={{ minWidth: 0, py: 0.5 }}>
            <Typography sx={{ fontWeight: 650 }} noWrap>
              {row.name}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {row.email}
            </Typography>
            {row.pendingEmailChange ? (
              <Chip
                size="small"
                color="warning"
                variant="outlined"
                label={`待验证 ${row.pendingEmailChange.newEmail}`}
                sx={{ alignSelf: "flex-start", maxWidth: "100%" }}
              />
            ) : null}
          </Stack>
        ),
      },
      {
        field: "phone",
        headerName: "联系方式",
        minWidth: 150,
        flex: 0.7,
        valueGetter: (_value, row) =>
          [row.phone, row.wechat, row.location].filter(Boolean).join(" "),
        renderCell: ({ row }) => {
          if (!row.phone && !row.wechat) {
            return (
              <Typography variant="body2" color="text.secondary">
                —
              </Typography>
            );
          }
          return (
            <Stack spacing={0.25}>
              {row.phone ? (
                <Typography variant="body2">{row.phone}</Typography>
              ) : null}
              {row.wechat ? (
                <Typography variant="body2" color="text.secondary">
                  微信 {row.wechat}
                </Typography>
              ) : null}
              {row.location ? (
                <Typography variant="caption" color="text.secondary">
                  {row.location}
                </Typography>
              ) : null}
            </Stack>
          );
        },
      },
      {
        field: "company",
        headerName: "公司/职位",
        minWidth: 150,
        flex: 0.7,
        valueGetter: (_value, row) =>
          [row.company, row.jobTitle].filter(Boolean).join(" "),
        renderCell: ({ row }) => {
          if (!row.company && !row.jobTitle) {
            return (
              <Typography variant="body2" color="text.secondary">
                —
              </Typography>
            );
          }
          return (
            <Stack spacing={0.25}>
              {row.company ? (
                <Typography variant="body2">{row.company}</Typography>
              ) : null}
              {row.jobTitle ? (
                <Typography variant="body2" color="text.secondary">
                  {row.jobTitle}
                </Typography>
              ) : null}
            </Stack>
          );
        },
      },
      {
        field: "roleGroupName",
        headerName: "角色组",
        minWidth: 160,
        flex: 1,
        valueGetter: (_value, row) =>
          row.platformRole === "PLATFORM_ADMIN"
            ? "平台管理员"
            : row.roleGroupName || "未分配角色组",
        renderCell: ({ row }) => (
          <Chip
            size="small"
            label={
              row.platformRole === "PLATFORM_ADMIN"
                ? "平台管理员"
                : row.roleGroupName || "未分配角色组"
            }
          />
        ),
      },
      {
        field: "projectCount",
        headerName: "项目",
        type: "number",
        width: 90,
        align: "center",
        headerAlign: "center",
      },
      {
        field: "actions",
        headerName: "操作",
        width: 210,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        renderCell: ({ row }) => (
          <Stack direction="row" spacing={0.5}>
            {row.platformRole !== "PLATFORM_ADMIN" ? (
              <Button size="small" onClick={() => onEdit(row)}>
                编辑资料
              </Button>
            ) : null}
            <Button
              size="small"
              color="inherit"
              startIcon={<DeleteOutlinedIcon />}
              disabled={submitting}
              onClick={() => onDelete(row)}
            >
              删除
            </Button>
          </Stack>
        ),
      },
    ],
    [onDelete, onEdit, submitting],
  );

  return (
    <>
      <Box
        sx={{
          display: { xs: "none", md: "block" },
          width: "100%",
          height: gridHeight(rows.length, 82),
        }}
      >
        <DataGrid
          aria-label="团队成员"
          rows={rows}
          columns={columns}
          getRowHeight={() => "auto"}
          pageSizeOptions={[10, 20, 50]}
          initialState={{
            pagination: { paginationModel: { pageSize: 10, page: 0 } },
          }}
          disableRowSelectionOnClick
          hideFooter={rows.length <= 10}
          slots={{ noRowsOverlay: teamMemberNoRows }}
          sx={gridSx}
        />
      </Box>

      <Stack sx={{ display: { xs: "flex", md: "none" } }}>
        {rows.length === 0 ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ py: 6, textAlign: "center" }}
          >
            暂无团队成员
          </Typography>
        ) : (
          rows.map((row) => (
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
                sx={{ justifyContent: "space-between", alignItems: "center" }}
              >
                <Typography sx={{ fontWeight: 650 }} noWrap>
                  {row.name}
                </Typography>
                <Chip
                  size="small"
                  label={
                    row.platformRole === "PLATFORM_ADMIN"
                      ? "平台管理员"
                      : row.roleGroupName || "未分配角色组"
                  }
                />
              </Stack>
              <Typography variant="caption" color="text.secondary" noWrap>
                {row.email}
              </Typography>
              {(row.phone || row.wechat) && (
                <Typography variant="body2" color="text.secondary">
                  {[row.phone, row.wechat ? `微信 ${row.wechat}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </Typography>
              )}
              <Stack
                direction="row"
                spacing={0.5}
                sx={{ justifyContent: "flex-end", mt: 0.5 }}
              >
                {row.platformRole !== "PLATFORM_ADMIN" ? (
                  <Button size="small" onClick={() => onEdit(row)}>
                    编辑资料
                  </Button>
                ) : null}
                <Button
                  size="small"
                  color="inherit"
                  startIcon={<DeleteOutlinedIcon />}
                  disabled={submitting}
                  onClick={() => onDelete(row)}
                >
                  删除
                </Button>
              </Stack>
            </Box>
          ))
        )}
      </Stack>
    </>
  );
}

export function StaffInvitationGrid({
  rows,
  submitting,
  onRevoke,
}: {
  rows: StaffInviteView[];
  submitting: boolean;
  onRevoke: (invitationId: string) => void;
}) {
  const columns = useMemo<GridColDef<StaffInviteView>[]>(
    () => [
      {
        field: "name",
        headerName: "姓名/邮箱",
        minWidth: 230,
        flex: 1.1,
        valueGetter: (_value, row) => `${row.name ?? ""} ${row.email}`,
        renderCell: ({ row }) => (
          <Stack spacing={0.25} sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 650 }} noWrap>
              {row.name || "—"}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {row.email}
            </Typography>
          </Stack>
        ),
      },
      {
        field: "phone",
        headerName: "联系方式",
        minWidth: 180,
        flex: 0.8,
        valueGetter: (_value, row) =>
          [row.phone, row.company, row.jobTitle].filter(Boolean).join(" "),
        renderCell: ({ row }) => (
          <Stack spacing={0.25}>
            <Typography variant="body2">{row.phone || "—"}</Typography>
            <Typography variant="body2" color="text.secondary">
              {row.company || row.jobTitle || "—"}
            </Typography>
          </Stack>
        ),
      },
      {
        field: "roleGroupName",
        headerName: "角色组",
        minWidth: 150,
        flex: 0.6,
        valueGetter: (_value, row) => row.roleGroupName || "—",
      },
      {
        field: "expiresAt",
        headerName: "过期时间",
        minWidth: 190,
        flex: 0.7,
        renderCell: ({ row }) =>
          new Date(row.expiresAt).toLocaleString("zh-CN"),
      },
      {
        field: "actions",
        headerName: "操作",
        width: 190,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        renderCell: ({ row }) => (
          <Stack direction="row" spacing={1}>
            {row.previewUrl ? (
              <Button size="small" href={row.previewUrl}>
                打开邀请
              </Button>
            ) : null}
            <Button
              size="small"
              color="inherit"
              disabled={submitting}
              onClick={() => onRevoke(row.id)}
            >
              撤销
            </Button>
          </Stack>
        ),
      },
    ],
    [onRevoke, submitting],
  );

  return (
    <>
      <Box
        sx={{
          display: { xs: "none", md: "block" },
          width: "100%",
          height: gridHeight(rows.length, 70),
        }}
      >
        <DataGrid
          aria-label="待处理邀请"
          rows={rows}
          columns={columns}
          getRowHeight={() => "auto"}
          pageSizeOptions={[10, 20, 50]}
          initialState={{
            pagination: { paginationModel: { pageSize: 10, page: 0 } },
          }}
          disableRowSelectionOnClick
          hideFooter={rows.length <= 10}
          slots={{ noRowsOverlay: staffInvitationNoRows }}
          sx={gridSx}
        />
      </Box>

      <Stack sx={{ display: { xs: "flex", md: "none" } }}>
        {rows.length === 0 ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ py: 6, textAlign: "center" }}
          >
            暂无待处理邀请
          </Typography>
        ) : (
          rows.map((row) => (
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
                sx={{ justifyContent: "space-between", alignItems: "center" }}
              >
                <Typography sx={{ fontWeight: 650 }} noWrap>
                  {row.name || "—"}
                </Typography>
                {row.roleGroupName ? (
                  <Chip size="small" label={row.roleGroupName} />
                ) : null}
              </Stack>
              <Typography variant="caption" color="text.secondary" noWrap>
                {row.email}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block" }}
              >
                过期时间: {new Date(row.expiresAt).toLocaleString("zh-CN")}
              </Typography>
              <Stack
                direction="row"
                spacing={1}
                sx={{ justifyContent: "flex-end", mt: 0.5 }}
              >
                {row.previewUrl ? (
                  <Button size="small" href={row.previewUrl}>
                    打开邀请
                  </Button>
                ) : null}
                <Button
                  size="small"
                  color="inherit"
                  disabled={submitting}
                  onClick={() => onRevoke(row.id)}
                >
                  撤销
                </Button>
              </Stack>
            </Box>
          ))
        )}
      </Stack>
    </>
  );
}
