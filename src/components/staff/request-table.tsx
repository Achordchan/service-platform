"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Box,
  Button,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import {
  PriorityChip,
  StaffStatus,
} from "@/components/staff/staff-status";
import { TabBadgeLabel } from "@/components/shared/tab-badge-label";
import {
  countRequestStatusUnread,
  useUnreadNotifications,
} from "@/hooks/use-unread-notifications";
import type {
  RequestListItem,
  RequestStatus,
} from "@/components/staff/staff-types";

type StatusFilter = "ALL" | RequestStatus;

const statusFilters: Array<{ value: StatusFilter; label: string }> = [
  { value: "ALL", label: "全部" },
  { value: "PENDING", label: "待处理" },
  { value: "IN_PROGRESS", label: "处理中" },
  { value: "WAITING_CUSTOMER", label: "等待客户" },
  { value: "RESOLVED", label: "已解决" },
  { value: "CLOSED", label: "已关闭" },
];

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function RequestTable({
  requests,
  hideProjectFilter = false,
}: {
  requests: RequestListItem[];
  hideProjectFilter?: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const { unread } = useUnreadNotifications();
  const [projectId, setProjectId] = useState("ALL");
  const [keyword, setKeyword] = useState("");
  const projectOptions = useMemo(
    () =>
      Array.from(
        new Map(
          requests.map((request) => [
            request.projectId,
            { id: request.projectId, title: request.projectTitle },
          ]),
        ).values(),
      ),
    [requests],
  );
  const rows = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    return requests.filter(
      (request) =>
        (status === "ALL" || request.status === status) &&
        (projectId === "ALL" || request.projectId === projectId) &&
        (!normalized ||
          request.number.toLowerCase().includes(normalized) ||
          request.title.toLowerCase().includes(normalized) ||
          request.customerName.toLowerCase().includes(normalized) ||
          request.categoryName.toLowerCase().includes(normalized)),
    );
  }, [keyword, projectId, requests, status]);

  const columns = useMemo<GridColDef<RequestListItem>[]>(
    () => [
      { field: "number", headerName: "请求编号", minWidth: 170 },
      { field: "title", headerName: "标题", minWidth: 210, flex: 1.3 },
      {
        field: "customer",
        headerName: "客户",
        minWidth: 130,
        flex: 0.8,
        renderCell: ({ row }) => row.customerName,
      },
      {
        field: "project",
        headerName: "所属项目",
        minWidth: 170,
        flex: 1,
        renderCell: ({ row }) => row.projectTitle,
      },
      {
        field: "category",
        headerName: "请求分类",
        minWidth: 140,
        flex: 0.8,
        renderCell: ({ row }) => row.categoryName,
      },
      {
        field: "priority",
        headerName: "优先级",
        minWidth: 100,
        renderCell: ({ row }) => <PriorityChip value={row.priority} />,
      },
      {
        field: "assignee",
        headerName: "处理人",
        minWidth: 130,
        renderCell: ({ row }) => row.assigneeName || "待分配",
      },
      {
        field: "status",
        headerName: "状态",
        minWidth: 120,
        renderCell: ({ row }) => <StaffStatus value={row.status} compact />,
      },
      {
        field: "updatedAt",
        headerName: "更新时间",
        minWidth: 170,
        renderCell: ({ row }) =>
          dateFormatter.format(new Date(row.updatedAt)),
      },
      {
        field: "actions",
        headerName: "操作",
        sortable: false,
        filterable: false,
        minWidth: 110,
        display: "flex",
        renderCell: ({ row }) => (
          <Button
            size="small"
            startIcon={<EditOutlinedIcon />}
            onClick={(event) => {
              event.stopPropagation();
              router.push(`/staff/requests/${row.id}`);
            }}
          >
            处理
          </Button>
        ),
      },
    ],
    [router],
  );

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: "column", lg: "row" }}
        spacing={2}
        sx={{
          borderBottom: "1px solid",
          borderColor: "divider",
          alignItems: { xs: "stretch", lg: "flex-end" },
          justifyContent: "space-between",
        }}
      >
        <Tabs
          value={status}
          onChange={(_, value: StatusFilter) => setStatus(value)}
          variant="scrollable"
          scrollButtons={false}
          sx={{ minWidth: 0, "& .MuiTab-root": { minWidth: 86, px: 1.5 } }}
        >
          {statusFilters.map((filter) => (
            <Tab
              key={filter.value}
              value={filter.value}
              label={
                <TabBadgeLabel
                  label={filter.label}
                  count={countRequestStatusUnread(
                    unread,
                    requests.map((item) => ({
                      id: item.id,
                      status: item.status,
                      projectId: item.projectId,
                    })),
                    filter.value,
                    projectId === "ALL" ? undefined : projectId,
                  )}
                />
              }
            />
          ))}
        </Tabs>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{ pb: 1 }}
        >
          {!hideProjectFilter && projectOptions.length > 1 ? (
            <TextField
              select
              label="所属项目"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              sx={{ minWidth: { sm: 190 } }}
            >
              <MenuItem value="ALL">全部项目</MenuItem>
              {projectOptions.map((option) => (
                <MenuItem key={option.id} value={option.id}>
                  {option.title}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          <TextField
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索编号、标题、客户或分类"
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchOutlinedIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
            sx={{ width: { xs: "100%", sm: 340 } }}
          />
        </Stack>
      </Stack>

      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        <Box
          sx={{
            display: { xs: "none", md: "block" },
            width: "100%",
            minHeight: 520,
            height: { md: "min(70vh, 720px)" },
          }}
        >
          <DataGrid
            rows={rows}
            columns={columns}
            onRowClick={({ row }) => router.push(`/staff/requests/${row.id}`)}
            pageSizeOptions={[10, 20, 50]}
            initialState={{
              pagination: { paginationModel: { pageSize: 10, page: 0 } },
              sorting: {
                sortModel: [{ field: "updatedAt", sort: "desc" }],
              },
            }}
            disableRowSelectionOnClick
            sx={{
              border: 0,
              height: "100%",
              "& .MuiDataGrid-columnHeaders": {
                borderBottomColor: "divider",
              },
              "& .MuiDataGrid-cell": {
                display: "flex",
                alignItems: "center",
              },
              "& .MuiDataGrid-row": { cursor: "pointer" },
              "& .MuiDataGrid-footerContainer": {
                borderTopColor: "divider",
              },
            }}
          />
        </Box>
        <Stack sx={{ display: { xs: "flex", md: "none" } }}>
          {rows.map((request) => (
            <Stack
              component="button"
              type="button"
              key={request.id}
              spacing={1}
              onClick={() => router.push(`/staff/requests/${request.id}`)}
              sx={{
                width: "100%",
                p: 2,
                border: 0,
                borderBottom: "1px solid",
                borderColor: "divider",
                bgcolor: "background.paper",
                color: "text.primary",
                textAlign: "left",
                "&:last-child": { borderBottom: 0 },
              }}
            >
              <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between" }}>
                <Typography sx={{ fontWeight: 650 }}>{request.title}</Typography>
                <StaffStatus value={request.status} compact />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {request.number} · {request.customerName}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <PriorityChip value={request.priority} />
                <Typography variant="body2" color="text.secondary">
                  {request.assigneeName || "待分配"}
                </Typography>
              </Stack>
            </Stack>
          ))}
          {rows.length === 0 ? (
            <Box sx={{ p: 4, textAlign: "center" }}>
              <Typography color="text.secondary">没有符合条件的服务请求</Typography>
            </Box>
          ) : null}
        </Stack>
      </Paper>
      <Typography variant="body2" color="text.secondary">
        共 {rows.length} 条
      </Typography>
    </Stack>
  );
}
