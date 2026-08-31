"use client";

import { useMemo, useState } from "react";
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
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import { DateStringPicker } from "@/components/shared/date-string-picker";
import { gridNoRowsOverlay } from "@/components/shared/data-grid-empty-overlay";
import { staffApi } from "@/components/staff/staff-api";
import { gridSx } from "@/lib/data-grid-styles";
import { queryKeys } from "@/lib/query-keys";
import {
  auditActionLabel,
  auditResultLabel,
  isUnauthenticatedAuditAction,
} from "@/modules/audit/audit-labels";

type AuditLogRow = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: string;
  createdAt: string;
  actorName: string | null;
  actorEmail: string | null;
  externalActorName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  projectId: string | null;
  customerSpaceId: string | null;
  serviceRequestId: string | null;
};

type FacetOption = { value: string; label: string };

type AuditResponse = {
  rows: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
  facets?: {
    actions: FacetOption[];
    resourceTypes: FacetOption[];
    results: FacetOption[];
  };
};

const emptyFilters = {
  search: "",
  action: "",
  resourceType: "",
  result: "",
  from: "",
  to: "",
};

const noRows = gridNoRowsOverlay("没有符合条件的审计记录", <HistoryOutlinedIcon />);

/** 执行人展示：优先真实操作者 / 外部联系人；未认证动作（登录失败、忘记密码）显式
 * 标为「未认证访客」，其余空 actor 才归为系统 / 自动任务。 */
function auditActorDisplay(row: AuditLogRow): { name: string; secondary: string } {
  if (row.actorName) {
    return { name: row.actorName, secondary: row.actorEmail ?? "—" };
  }
  if (row.externalActorName) {
    return { name: row.externalActorName, secondary: "外部联系人" };
  }
  if (isUnauthenticatedAuditAction(row.action)) {
    return { name: "未认证访客", secondary: "未登录尝试" };
  }
  return { name: "系统", secondary: "自动任务" };
}

export function AuditLogWorkspace() {
  const [filters, setFilters] = useState(emptyFilters);
  const [pagination, setPagination] = useState({ page: 0, pageSize: 25 });
  const [detail, setDetail] = useState<AuditLogRow | null>(null);

  const search = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    params.set("page", String(pagination.page));
    params.set("pageSize", String(pagination.pageSize));
    params.set("withFacets", "1");
    return params.toString();
  }, [filters, pagination]);

  const query = useQuery({
    queryKey: queryKeys.auditLogs.list(search),
    queryFn: () => staffApi<AuditResponse>(`/api/v1/admin/audit-logs?${search}`),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo<GridColDef<AuditLogRow>[]>(
    () => [
      {
        field: "createdAt",
        headerName: "时间",
        minWidth: 165,
        flex: 0.7,
        renderCell: ({ row }) => (
          <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
            {new Date(row.createdAt).toLocaleString("zh-CN", { hour12: false })}
          </Typography>
        ),
      },
      {
        field: "action",
        headerName: "操作",
        minWidth: 240,
        flex: 1.2,
        renderCell: ({ row }) => (
          <Stack spacing={0.25} sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 650 }} noWrap>
              {auditActionLabel(row.action, row.resourceType)}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontFamily: "ui-monospace, monospace" }}
              noWrap
            >
              {row.action}
            </Typography>
          </Stack>
        ),
      },
      {
        field: "actorName",
        headerName: "执行人",
        minWidth: 180,
        flex: 1,
        renderCell: ({ row }) => {
          const { name, secondary } = auditActorDisplay(row);
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
        field: "resourceId",
        headerName: "对象 ID",
        minWidth: 150,
        flex: 0.8,
        renderCell: ({ row }) => (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontFamily: "ui-monospace, monospace" }}
            noWrap
          >
            {row.resourceId ?? "—"}
          </Typography>
        ),
      },
      {
        field: "result",
        headerName: "结果",
        width: 110,
        renderCell: ({ row }) => (
          <Chip
            size="small"
            label={auditResultLabel(row.result)}
            color={row.result === "SUCCESS" ? "success" : "warning"}
            variant="outlined"
          />
        ),
      },
      {
        field: "ipAddress",
        headerName: "来源 IP",
        minWidth: 130,
        flex: 0.6,
        renderCell: ({ row }) => (
          <Typography variant="caption" color="text.secondary" noWrap>
            {row.ipAddress ?? "—"}
          </Typography>
        ),
      },
    ],
    [],
  );

  const facets = query.data?.facets;
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
            placeholder="操作码 / 对象 ID / 执行人 / IP"
            value={filters.search}
            onChange={(event) => update("search", event.target.value)}
            size="small"
            sx={{ flex: "1 1 260px" }}
          />
          <TextField
            select
            label="操作类型"
            value={filters.action}
            onChange={(event) => update("action", event.target.value)}
            size="small"
            sx={{ flex: "0 1 220px", minWidth: 180 }}
          >
            <MenuItem value="">全部</MenuItem>
            {(facets?.actions ?? []).map((action) => (
              <MenuItem key={action.value} value={action.value}>
                {action.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="资源类型"
            value={filters.resourceType}
            onChange={(event) => update("resourceType", event.target.value)}
            size="small"
            sx={{ flex: "0 1 200px", minWidth: 160 }}
          >
            <MenuItem value="">全部</MenuItem>
            {(facets?.resourceTypes ?? []).map((type) => (
              <MenuItem key={type.value} value={type.value}>
                {type.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="结果"
            value={filters.result}
            onChange={(event) => update("result", event.target.value)}
            size="small"
            sx={{ flex: "0 1 140px", minWidth: 120 }}
          >
            <MenuItem value="">全部</MenuItem>
            {(facets?.results ?? []).map((result) => (
              <MenuItem key={result.value} value={result.value}>
                {result.label}
              </MenuItem>
            ))}
          </TextField>
          <Box sx={{ flex: "0 1 170px", minWidth: 150 }}>
            <DateStringPicker
              label="起始日期"
              value={filters.from}
              onChange={(value) => update("from", value)}
              maxDate={filters.to || undefined}
            />
          </Box>
          <Box sx={{ flex: "0 1 170px", minWidth: 150 }}>
            <DateStringPicker
              label="结束日期"
              value={filters.to}
              onChange={(value) => update("to", value)}
              minDate={filters.from || undefined}
            />
          </Box>
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
        <Alert severity="error">审计日志加载失败，请稍后重试。</Alert>
      ) : null}

      <Paper variant="outlined" sx={{ p: 0 }}>
        {/* Desktop data grid */}
        <Box sx={{ width: "100%", height: 640, display: { xs: "none", md: "block" } }}>
          <DataGrid
            aria-label="审计日志"
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
              <HistoryOutlinedIcon color="disabled" />
              <Typography variant="body2" color="text.secondary">
                没有符合条件的审计记录
              </Typography>
            </Stack>
          ) : (
            rows.map((row) => {
              const label = auditActionLabel(row.action, row.resourceType);
              const actorName = auditActorDisplay(row).name;
              const time = new Date(row.createdAt).toLocaleString("zh-CN", {
                hour12: false,
              });

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
                      {label}
                    </Typography>
                    <Chip
                      size="small"
                      label={auditResultLabel(row.result)}
                      color={row.result === "SUCCESS" ? "success" : "warning"}
                      variant="outlined"
                      sx={{ ml: 1, flexShrink: 0 }}
                    />
                  </Stack>

                  <Typography variant="caption" color="text.secondary">
                    {actorName} · {time}
                  </Typography>

                  {row.resourceId ? (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ fontFamily: "ui-monospace, monospace" }}
                      noWrap
                    >
                      {row.resourceId}
                    </Typography>
                  ) : null}
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

      <AuditDetailDialog detail={detail} onClose={() => setDetail(null)} />
    </Stack>
  );
}

function AuditDetailDialog({
  detail,
  onClose,
}: {
  detail: AuditLogRow | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(detail)} onClose={onClose} fullWidth maxWidth="sm">
      {detail ? (
        <>
          <DialogTitle>
            {auditActionLabel(detail.action, detail.resourceType)}
          </DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              <DetailRow label="操作码" value={detail.action} mono />
              <DetailRow
                label="时间"
                value={new Date(detail.createdAt).toLocaleString("zh-CN", {
                  hour12: false,
                })}
              />
              <DetailRow
                label="执行人"
                value={
                  detail.actorName
                    ? `${detail.actorName}${detail.actorEmail ? ` (${detail.actorEmail})` : ""}`
                    : detail.externalActorName
                      ? detail.externalActorName
                      : isUnauthenticatedAuditAction(detail.action)
                        ? "未认证访客（未登录尝试）"
                        : "系统 / 自动任务"
                }
              />
              <DetailRow label="结果" value={auditResultLabel(detail.result)} />
              <DetailRow label="对象 ID" value={detail.resourceId} mono />
              <DetailRow label="所属项目" value={detail.projectId} mono />
              <DetailRow label="客户空间" value={detail.customerSpaceId} mono />
              <DetailRow label="服务请求" value={detail.serviceRequestId} mono />
              <DetailRow label="来源 IP" value={detail.ipAddress} mono />
              <DetailRow label="User-Agent" value={detail.userAgent} />
              {detail.metadata ? (
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    附加数据
                  </Typography>
                  <Box
                    component="pre"
                    sx={{
                      mt: 0.75,
                      p: 1.5,
                      m: 0,
                      borderRadius: 1.5,
                      bgcolor: "action.hover",
                      fontSize: 12,
                      overflowX: "auto",
                    }}
                  >
                    {JSON.stringify(detail.metadata, null, 2)}
                  </Box>
                </Box>
              ) : null}
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
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
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
          ...(mono ? { fontFamily: "ui-monospace, monospace" } : {}),
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}
