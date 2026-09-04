"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import FeedbackOutlinedIcon from "@mui/icons-material/FeedbackOutlined";
import { gridNoRowsOverlay } from "@/components/shared/data-grid-empty-overlay";
import { staffApi } from "@/components/staff/staff-api";
import { gridSx } from "@/lib/data-grid-styles";
import { queryKeys } from "@/lib/query-keys";

type FeedbackRow = {
  id: string;
  title: string;
  content: string;
  source: "WEB" | "MINIAPP";
  appVersion: string | null;
  platformInfo: Record<string, unknown> | null;
  issueStatus: "PENDING" | "CREATED" | "FAILED" | "SKIPPED";
  issueNumber: number | null;
  issueUrl: string | null;
  issueError: string | null;
  createdAt: string;
  submitter: {
    id: string;
    name: string;
    email: string;
    platformRole: string;
  } | null;
  sourceLabel: string;
  issueStatusLabel: string;
};

type FeedbackPage = {
  rows: FeedbackRow[];
  total: number;
  page: number;
  pageSize: number;
};

const roleLabels: Record<string, string> = {
  PLATFORM_ADMIN: "平台管理员",
  PROJECT_MANAGER: "项目负责人",
  TECHNICIAN: "技术人员",
  CUSTOMER: "客户",
};

const issueStatusChips: Record<FeedbackRow["issueStatus"], "success" | "error" | "warning" | "default"> = {
  CREATED: "success",
  FAILED: "error",
  PENDING: "warning",
  SKIPPED: "default",
};

const platformInfoLabels: Record<string, string> = {
  userAgent: "浏览器标识",
  model: "机型",
  system: "系统",
  platform: "平台",
  sdkVersion: "基础库版本",
  appVersion: "小程序版本",
};

const emptyFilters = {
  search: "",
  source: "",
  issueStatus: "",
};

const noRows = gridNoRowsOverlay("没有符合条件的反馈", <FeedbackOutlinedIcon />);

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function submitterDisplay(row: FeedbackRow) {
  if (row.submitter) {
    const role = roleLabels[row.submitter.platformRole];
    return {
      name: row.submitter.name,
      secondary: role
        ? `${row.submitter.email} · ${role}`
        : row.submitter.email,
    };
  }
  return { name: "未知用户", secondary: "—" };
}

export function FeedbackWorkspace() {
  const [filters, setFilters] = useState(emptyFilters);
  const [pagination, setPagination] = useState({ page: 0, pageSize: 25 });
  const [detail, setDetail] = useState<FeedbackRow | null>(null);

  const search = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    params.set("page", String(pagination.page));
    params.set("pageSize", String(pagination.pageSize));
    return params.toString();
  }, [filters, pagination]);

  const query = useQuery({
    queryKey: queryKeys.feedback.list(search),
    queryFn: () => staffApi<FeedbackPage>(`/api/v1/admin/feedback?${search}`),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo<GridColDef<FeedbackRow>[]>(
    () => [
      {
        field: "createdAt",
        headerName: "时间",
        minWidth: 165,
        flex: 0.7,
        renderCell: ({ row }) => (
          <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
            {formatTime(row.createdAt)}
          </Typography>
        ),
      },
      {
        field: "title",
        headerName: "标题",
        minWidth: 220,
        flex: 1.4,
        renderCell: ({ row }) => (
          <Stack sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 650 }} noWrap>
              {row.title}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {row.content}
            </Typography>
          </Stack>
        ),
      },
      {
        field: "source",
        headerName: "来源",
        width: 100,
        renderCell: ({ row }) => (
          <Chip size="small" label={row.sourceLabel} variant="outlined" />
        ),
      },
      {
        field: "submitterName",
        headerName: "提交人",
        minWidth: 200,
        flex: 1,
        renderCell: ({ row }) => {
          const { name, secondary } = submitterDisplay(row);
          return (
            <Stack spacing={0.25} sx={{ minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {name}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {secondary}
              </Typography>
            </Stack>
          );
        },
      },
      {
        field: "issueStatus",
        headerName: "issue 状态",
        width: 150,
        renderCell: ({ row }) => (
          <Chip
            size="small"
            label={row.issueStatusLabel}
            color={issueStatusChips[row.issueStatus] ?? "default"}
            variant="outlined"
          />
        ),
      },
    ],
    [],
  );

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const filtersDirty = Object.values(filters).some(Boolean);

  function update(key: keyof typeof filters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPagination((current) => ({ ...current, page: 0 }));
  }

  return (
    <Stack spacing={2.5}>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={1.5}
          sx={{ flexWrap: "wrap", alignItems: { md: "center" } }}
        >
          <TextField
            label="搜索"
            placeholder="标题 / 内容 / 提交人"
            value={filters.search}
            onChange={(event) => update("search", event.target.value)}
            size="small"
            sx={{ flex: "1 1 260px" }}
          />
          <TextField
            select
            label="来源"
            value={filters.source}
            onChange={(event) => update("source", event.target.value)}
            size="small"
            sx={{ flex: "0 1 160px", minWidth: 130 }}
          >
            <MenuItem value="">全部</MenuItem>
            <MenuItem value="WEB">Web 端</MenuItem>
            <MenuItem value="MINIAPP">小程序</MenuItem>
          </TextField>
          <TextField
            select
            label="issue 状态"
            value={filters.issueStatus}
            onChange={(event) => update("issueStatus", event.target.value)}
            size="small"
            sx={{ flex: "0 1 180px", minWidth: 150 }}
          >
            <MenuItem value="">全部</MenuItem>
            <MenuItem value="CREATED">已建 issue</MenuItem>
            <MenuItem value="FAILED">建 issue 失败</MenuItem>
            <MenuItem value="PENDING">待同步</MenuItem>
            <MenuItem value="SKIPPED">未同步（未配置）</MenuItem>
          </TextField>
          {filtersDirty ? (
            <Button
              color="inherit"
              onClick={() => {
                setFilters(emptyFilters);
                setPagination((current) => ({ ...current, page: 0 }));
              }}
            >
              重置
            </Button>
          ) : null}
        </Stack>
      </Paper>

      {query.isError ? (
        <Alert severity="error">反馈列表加载失败，请稍后重试。</Alert>
      ) : null}

      <Paper variant="outlined" sx={{ p: 0 }}>
        {/* Desktop data grid */}
        <Box sx={{ width: "100%", height: 640, display: { xs: "none", md: "block" } }}>
          <DataGrid
            aria-label="用户反馈"
            rows={rows}
            columns={columns}
            loading={query.isPending || query.isFetching}
            rowCount={total}
            paginationMode="server"
            paginationModel={pagination}
            onPaginationModelChange={setPagination}
            pageSizeOptions={[25, 50, 100]}
            disableColumnFilter
            disableRowSelectionOnClick
            onRowClick={({ row }) => setDetail(row)}
            slots={{ noRowsOverlay: noRows }}
            sx={{ ...gridSx, "& .MuiDataGrid-row": { cursor: "pointer" } }}
          />
        </Box>

        {/* Mobile card list */}
        <Stack sx={{ display: { xs: "flex", md: "none" } }}>
          {query.isPending ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
              <CircularProgress />
            </Box>
          ) : rows.length === 0 ? (
            <Stack sx={{ alignItems: "center", py: 6, gap: 1 }}>
              <FeedbackOutlinedIcon color="disabled" />
              <Typography variant="body2" color="text.secondary">
                没有符合条件的反馈
              </Typography>
            </Stack>
          ) : (
            rows.map((row) => {
              const { name } = submitterDisplay(row);
              return (
                <Stack
                  key={row.id}
                  component="button"
                  onClick={() => setDetail(row)}
                  sx={{
                    width: "100%",
                    border: 0,
                    bgcolor: "background.paper",
                    color: "text.primary",
                    textAlign: "left",
                    cursor: "pointer",
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
                      {row.title}
                    </Typography>
                    <Chip
                      size="small"
                      label={row.sourceLabel}
                      variant="outlined"
                      sx={{ ml: 1, flexShrink: 0 }}
                    />
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {name} · {formatTime(row.createdAt)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {row.content}
                  </Typography>
                </Stack>
              );
            })
          )}

          {/* Mobile pagination */}
          {rows.length > 0 && (
            <Stack
              direction="row"
              sx={{
                justifyContent: "space-between",
                alignItems: "center",
                px: 2,
                py: 1,
                borderTop: "1px solid",
                borderColor: "divider",
              }}
            >
              <Button
                size="small"
                disabled={pagination.page === 0}
                onClick={() =>
                  setPagination((prev) => ({ ...prev, page: prev.page - 1 }))
                }
              >
                上一页
              </Button>
              <Typography variant="caption" color="text.secondary">
                {pagination.page + 1} / {Math.max(1, Math.ceil(total / pagination.pageSize))}
              </Typography>
              <Button
                size="small"
                disabled={
                  (pagination.page + 1) * pagination.pageSize >= total
                }
                onClick={() =>
                  setPagination((prev) => ({ ...prev, page: prev.page + 1 }))
                }
              >
                下一页
              </Button>
            </Stack>
          )}
        </Stack>
      </Paper>

      <FeedbackDetailDialog detail={detail} onClose={() => setDetail(null)} />
    </Stack>
  );
}

function FeedbackDetailDialog({
  detail,
  onClose,
}: {
  detail: FeedbackRow | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(detail)} onClose={onClose} fullWidth maxWidth="sm">
      {detail ? (
        <>
          <DialogTitle>{detail.title}</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              <DetailRow label="内容" value={detail.content} preWrap />
              <DetailRow
                label="时间"
                value={formatTime(detail.createdAt)}
              />
              <DetailRow
                label="提交人"
                value={
                  detail.submitter
                    ? `${detail.submitter.name}（${detail.submitter.email}${
                        roleLabels[detail.submitter.platformRole]
                          ? ` · ${roleLabels[detail.submitter.platformRole]}`
                          : ""
                      }）`
                    : "未知用户"
                }
              />
              <DetailRow
                label="来源"
                value={`${detail.sourceLabel}${detail.appVersion ? ` · 版本 ${detail.appVersion}` : ""}`}
              />
              {detail.platformInfo ? (
                <Stack spacing={0.5}>
                  <Typography variant="subtitle2" color="text.secondary">
                    平台信息
                  </Typography>
                  {Object.entries(detail.platformInfo).map(([key, value]) => (
                    <Typography
                      key={key}
                      variant="body2"
                      sx={{ overflowWrap: "anywhere" }}
                    >
                      {platformInfoLabels[key] ?? key}
                      ：{String(value)}
                    </Typography>
                  ))}
                </Stack>
              ) : null}
              <Stack spacing={0.5}>
                <Typography variant="subtitle2" color="text.secondary">
                  GitHub issue
                </Typography>
                {detail.issueUrl ? (
                  <Typography variant="body2">
                    <Link href={detail.issueUrl} target="_blank" rel="noopener noreferrer">
                      #{detail.issueNumber} {detail.issueUrl}
                    </Link>
                  </Typography>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {detail.issueStatusLabel}
                    {detail.issueError ? `（${detail.issueError}）` : ""}
                  </Typography>
                )}
              </Stack>
            </Stack>
          </DialogContent>
        </>
      ) : null}
    </Dialog>
  );
}

function DetailRow({
  label,
  value,
  preWrap,
}: {
  label: string;
  value: string | null;
  preWrap?: boolean;
}) {
  if (!value) return null;
  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          mt: 0.25,
          overflowWrap: "anywhere",
          ...(preWrap ? { whiteSpace: "pre-wrap" } : {}),
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}
