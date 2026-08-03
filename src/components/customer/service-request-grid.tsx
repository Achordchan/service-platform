"use client";

import { useMemo } from "react";
import { Box, Typography } from "@mui/material";
import ChevronRightOutlinedIcon from "@mui/icons-material/ChevronRightOutlined";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import type { ServiceRequestSummary } from "@/components/customer/customer-types";
import { statusLabel, StatusIndicator } from "@/components/shared/status-indicator";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function gridHeight(rowCount: number, compact: boolean) {
  const rowHeight = compact ? 58 : 72;
  return Math.min(620, Math.max(220, rowCount * rowHeight + 112));
}

export function ServiceRequestGrid({
  rows,
  compact,
  hideProjectColumn,
  onOpen,
}: {
  rows: ServiceRequestSummary[];
  compact: boolean;
  hideProjectColumn: boolean;
  onOpen: (request: ServiceRequestSummary) => void;
}) {
  const columns = useMemo<GridColDef<ServiceRequestSummary>[]>(() => {
    const baseColumns: GridColDef<ServiceRequestSummary>[] = [
      {
        field: "number",
        headerName: "请求编号",
        minWidth: 145,
        flex: 0.65,
      },
      {
        field: "title",
        headerName: "标题",
        minWidth: 230,
        flex: 1.25,
        renderCell: ({ row }) => (
          <Typography noWrap sx={{ fontWeight: 650, minWidth: 0 }}>
            {row.title}
          </Typography>
        ),
      },
      {
        field: "categoryName",
        headerName: "请求分类",
        minWidth: 160,
        flex: 0.8,
        valueGetter: (_value, row) => row.category.name,
      },
      {
        field: "status",
        headerName: "状态",
        minWidth: 150,
        flex: 0.7,
        valueGetter: (_value, row) => statusLabel(row.status),
        renderCell: ({ row }) => (
          <StatusIndicator status={row.status} compact={compact} />
        ),
      },
      {
        field: "updatedAt",
        headerName: "更新时间",
        type: "dateTime",
        minWidth: 180,
        flex: 0.85,
        valueGetter: (value) => new Date(value as string),
        renderCell: ({ row }) => dateFormatter.format(new Date(row.updatedAt)),
      },
      {
        field: "assigneeName",
        headerName: "处理人",
        minWidth: 150,
        flex: 0.7,
        valueGetter: (_value, row) => row.assigneeName || "待分配",
      },
      {
        field: "actions",
        headerName: "",
        width: 48,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        renderCell: () => <ChevronRightOutlinedIcon color="action" />,
      },
    ];

    if (hideProjectColumn) return baseColumns;

    baseColumns.splice(2, 0, {
      field: "projectTitle",
      headerName: "所属项目",
      minWidth: 190,
      flex: 0.95,
    });
    return baseColumns;
  }, [compact, hideProjectColumn]);

  return (
    <Box sx={{ width: "100%", height: gridHeight(rows.length, compact) }}>
      <DataGrid
        aria-label="客户服务请求"
        rows={rows}
        columns={columns}
        density={compact ? "compact" : "standard"}
        getRowHeight={() => "auto"}
        getEstimatedRowHeight={() => (compact ? 58 : 72)}
        pageSizeOptions={[10, 20, 50]}
        initialState={{
          pagination: { paginationModel: { pageSize: 10, page: 0 } },
        }}
        disableRowSelectionOnClick
        hideFooter={rows.length <= 10}
        onRowClick={({ row }) => onOpen(row)}
        localeText={{ noRowsLabel: "暂无服务请求" }}
        sx={{
          border: 0,
          "& .MuiDataGrid-cell": {
            display: "flex",
            alignItems: "center",
            py: compact ? 0.5 : 1,
          },
          "& .MuiDataGrid-columnHeaderTitle": { fontWeight: 650 },
          "& .MuiDataGrid-columnHeaders": { borderBottomColor: "divider" },
          "& .MuiDataGrid-row": { cursor: "pointer" },
          "& .MuiDataGrid-footerContainer": { borderTopColor: "divider" },
        }}
      />
    </Box>
  );
}
