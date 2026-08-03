"use client";

import { useMemo } from "react";
import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import type { RoleGroupView } from "@/components/staff/role-group-manager";

export function RoleGroupGrid({
  rows,
  submitting,
  onEdit,
  onDelete,
}: {
  rows: RoleGroupView[];
  submitting: boolean;
  onEdit: (group: RoleGroupView) => void;
  onDelete: (group: RoleGroupView) => void;
}) {
  const columns = useMemo<GridColDef<RoleGroupView>[]>(
    () => [
      {
        field: "name",
        headerName: "角色组",
        minWidth: 240,
        flex: 1.2,
        valueGetter: (_value, row) =>
          `${row.name} ${row.description || row.key}`,
        renderCell: ({ row }) => (
          <Stack spacing={0.25} sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 650 }} noWrap>
              {row.name}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {row.description || row.key}
            </Typography>
          </Stack>
        ),
      },
      {
        field: "accessLevel",
        headerName: "访问级别",
        minWidth: 180,
        flex: 0.8,
        valueGetter: (_value, row) =>
          row.accessLevel === "PROJECT_MANAGER"
            ? "项目负责人级"
            : "技术人员级",
        renderCell: ({ row }) => (
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Typography variant="body2">
              {row.accessLevel === "PROJECT_MANAGER"
                ? "项目负责人级"
                : "技术人员级"}
            </Typography>
            {row.isSystem ? <Chip size="small" label="系统" /> : null}
          </Stack>
        ),
      },
      {
        field: "permissionCount",
        headerName: "权限数",
        type: "number",
        width: 100,
        align: "center",
        headerAlign: "center",
        valueGetter: (_value, row) => row.permissions.length,
      },
      {
        field: "userCount",
        headerName: "成员",
        type: "number",
        minWidth: 130,
        flex: 0.5,
        valueGetter: (_value, row) => row.userCount + row.invitationCount,
        renderCell: ({ row }) =>
          row.invitationCount
            ? `${row.userCount} / 邀请 ${row.invitationCount}`
            : row.userCount,
      },
      {
        field: "active",
        headerName: "状态",
        type: "boolean",
        width: 110,
        renderCell: ({ row }) => (
          <Chip
            size="small"
            color={row.active ? "success" : "default"}
            label={row.active ? "启用" : "停用"}
          />
        ),
      },
      {
        field: "actions",
        headerName: "操作",
        width: 150,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        renderCell: ({ row }) => (
          <Stack direction="row" spacing={1}>
            <Button size="small" onClick={() => onEdit(row)}>
              编辑
            </Button>
            <Button
              size="small"
              color="inherit"
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
    <Box
      sx={{
        width: "100%",
        height: Math.min(620, Math.max(220, rows.length * 68 + 112)),
      }}
    >
      <DataGrid
        aria-label="角色组"
        rows={rows}
        columns={columns}
        getRowHeight={() => "auto"}
        pageSizeOptions={[10, 20, 50]}
        initialState={{
          pagination: { paginationModel: { pageSize: 10, page: 0 } },
        }}
        disableRowSelectionOnClick
        hideFooter={rows.length <= 10}
        localeText={{ noRowsLabel: "暂无角色组" }}
        sx={{
          border: 0,
          "& .MuiDataGrid-cell": {
            display: "flex",
            alignItems: "center",
            py: 1,
          },
          "& .MuiDataGrid-columnHeaderTitle": { fontWeight: 650 },
          "& .MuiDataGrid-columnHeaders": { borderBottomColor: "divider" },
          "& .MuiDataGrid-footerContainer": { borderTopColor: "divider" },
        }}
      />
    </Box>
  );
}
