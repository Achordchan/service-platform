"use client";

import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import BugReportOutlinedIcon from "@mui/icons-material/BugReportOutlined";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import { DateStringPicker } from "@/components/shared/date-string-picker";
import { gridNoRowsOverlay } from "@/components/shared/data-grid-empty-overlay";
import { staffApi } from "@/components/staff/staff-api";
import { gridSx } from "@/lib/data-grid-styles";
import { queryKeys } from "@/lib/query-keys";
import { SYSTEM_ERROR_EXPORT_MAX_ROWS } from "@/modules/system-errors/system-error-limits";

type SystemErrorRow = {
  id: string;
  referenceId: string;
  category: string;
  categoryLabel: string;
  errorName: string;
  source: string;
  operation: string | null;
  requestMethod: string | null;
  requestPath: string | null;
  actorType: string | null;
  actorTypeLabel: string;
  actorId: string | null;
  actorName: string | null;
  occurrenceCount: number;
  summary: string;
  createdAt: string;
};

type SystemErrorDetail = SystemErrorRow & {
  details: unknown;
  context: unknown;
  categoryHint: string | null;
  related: SystemErrorRow[];
  relatedWindowHours: number;
};

type SystemErrorPage = {
  rows: SystemErrorRow[];
  total: number;
  page: number;
  pageSize: number;
  facets?: {
    categories: string[];
    sources: string[];
    operations: string[];
    categoryOptions: Array<{ value: string; label: string }>;
  };
};

const emptyFilters = {
  search: "",
  category: "",
  source: "",
  operation: "",
  from: "",
  to: "",
};

const noRows = gridNoRowsOverlay("没有符合条件的系统报错", <BugReportOutlinedIcon />);

const monoSx = { fontFamily: "ui-monospace, monospace" } as const;

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

/** 数据库类错误用警告色，其余用中性色；状态只用 Chip 表达 */
function CategoryChip({ category, label }: { category: string; label: string }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      label={label}
      color={category.startsWith("DATABASE_") ? "warning" : "default"}
    />
  );
}

function copyText(text: string) {
  try {
    void navigator.clipboard?.writeText(text);
  } catch {
    // 剪贴板不可用时静默忽略，编号本身仍显示在界面上
  }
}

export function SystemErrorWorkspace() {
  const [filters, setFilters] = useState(emptyFilters);
  const [pagination, setPagination] = useState({ page: 0, pageSize: 25 });
  const [openReferenceId, setOpenReferenceId] = useState<string | null>(null);
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);

  const filterQuery = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value.trim());
    }
    return params;
  }, [filters]);

  const search = useMemo(() => {
    const params = new URLSearchParams(filterQuery);
    params.set("page", String(pagination.page));
    params.set("pageSize", String(pagination.pageSize));
    params.set("withFacets", "1");
    return params.toString();
  }, [filterQuery, pagination]);

  const query = useQuery({
    queryKey: queryKeys.systemErrors.list(search),
    queryFn: () =>
      staffApi<SystemErrorPage>(`/api/v1/admin/system-errors?${search}`),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo<GridColDef<SystemErrorRow>[]>(
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
        field: "referenceId",
        headerName: "错误编号",
        minWidth: 300,
        flex: 1,
        renderCell: ({ row }) => (
          <Typography variant="caption" sx={monoSx} noWrap>
            {row.referenceId}
          </Typography>
        ),
      },
      {
        field: "category",
        headerName: "分类",
        minWidth: 130,
        renderCell: ({ row }) => (
          <CategoryChip category={row.category} label={row.categoryLabel} />
        ),
      },
      {
        field: "source",
        headerName: "来源 / 操作",
        minWidth: 220,
        flex: 1,
        renderCell: ({ row }) => (
          <Stack spacing={0.25} sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {row.source}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={monoSx} noWrap>
              {row.operation ?? "—"}
            </Typography>
          </Stack>
        ),
      },
      {
        field: "summary",
        headerName: "摘要",
        minWidth: 280,
        flex: 1.6,
        renderCell: ({ row }) => (
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {row.summary}
            </Typography>
            {row.occurrenceCount > 1 ? (
              <Chip size="small" label={`×${row.occurrenceCount}`} />
            ) : null}
          </Stack>
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

  function exportHref(format: "json" | "csv") {
    const params = new URLSearchParams(filterQuery);
    params.set("format", format);
    return `/api/v1/admin/system-errors/export?${params.toString()}`;
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
            placeholder="粘贴错误编号，或输入来源 / 操作 / 路径"
            value={filters.search}
            onChange={(event) => update("search", event.target.value)}
            size="small"
            sx={{ flex: { xs: "none", md: "1 1 300px" } }}
          />
          <TextField
            select
            label="分类"
            value={filters.category}
            onChange={(event) => update("category", event.target.value)}
            size="small"
            sx={{ flex: { xs: "none", md: "0 1 180px" }, minWidth: 150 }}
          >
            <MenuItem value="">全部</MenuItem>
            {(facets?.categoryOptions ?? []).map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="来源"
            value={filters.source}
            onChange={(event) => update("source", event.target.value)}
            size="small"
            sx={{ flex: { xs: "none", md: "0 1 180px" }, minWidth: 150 }}
          >
            <MenuItem value="">全部</MenuItem>
            {(facets?.sources ?? []).map((source) => (
              <MenuItem key={source} value={source}>
                {source}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="操作"
            value={filters.operation}
            onChange={(event) => update("operation", event.target.value)}
            size="small"
            sx={{ flex: { xs: "none", md: "0 1 220px" }, minWidth: 180 }}
          >
            <MenuItem value="">全部</MenuItem>
            {(facets?.operations ?? []).map((operation) => (
              <MenuItem key={operation} value={operation}>
                {operation}
              </MenuItem>
            ))}
          </TextField>
          <Box sx={{ flex: { xs: "none", md: "0 1 170px" }, minWidth: 150 }}>
            <DateStringPicker
              label="起始日期"
              value={filters.from}
              onChange={(value) => update("from", value)}
              maxDate={filters.to || undefined}
            />
          </Box>
          <Box sx={{ flex: { xs: "none", md: "0 1 170px" }, minWidth: 150 }}>
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
          <Button
            variant="outlined"
            startIcon={<FileDownloadOutlinedIcon />}
            disabled={total === 0}
            onClick={(event) => setExportAnchor(event.currentTarget)}
          >
            导出
          </Button>
          <Menu
            anchorEl={exportAnchor}
            open={Boolean(exportAnchor)}
            onClose={() => setExportAnchor(null)}
          >
            <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 0.5, display: "block" }}>
              按当前筛选导出 {Math.min(total, SYSTEM_ERROR_EXPORT_MAX_ROWS)} 条
              {total > SYSTEM_ERROR_EXPORT_MAX_ROWS ? `（共 ${total} 条，超出部分请缩小范围）` : ""}
            </Typography>
            <MenuItem
              component="a"
              href={exportHref("csv")}
              onClick={() => setExportAnchor(null)}
            >
              CSV（Excel 可直接打开）
            </MenuItem>
            <MenuItem
              component="a"
              href={exportHref("json")}
              onClick={() => setExportAnchor(null)}
            >
              JSON（发给开发）
            </MenuItem>
          </Menu>
        </Stack>
      </Paper>

      {query.isError ? (
        <Alert severity="error">系统报错加载失败，请稍后重试。</Alert>
      ) : null}

      <Paper variant="outlined" sx={{ p: 0 }}>
        <Box sx={{ width: "100%", height: 640, display: { xs: "none", md: "block" } }}>
          <DataGrid
            aria-label="系统报错"
            rows={rows}
            columns={columns}
            loading={query.isPending || query.isFetching}
            rowCount={total}
            paginationMode="server"
            paginationModel={pagination}
            onPaginationModelChange={setPagination}
            pageSizeOptions={[25, 50, 100]}
            disableColumnFilter
            // 服务端分页下列头排序只会重排当前页，结果会误导；列表固定按时间倒序
            disableColumnSorting
            disableRowSelectionOnClick
            onRowClick={({ row }) => setOpenReferenceId(row.referenceId)}
            slots={{ noRowsOverlay: noRows }}
            sx={{ ...gridSx, "& .MuiDataGrid-row": { cursor: "pointer" } }}
          />
        </Box>

        <Stack sx={{ display: { xs: "flex", md: "none" } }}>
          {query.isPending ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
              <CircularProgress />
            </Box>
          ) : rows.length === 0 ? (
            <Stack sx={{ alignItems: "center", py: 6, gap: 1 }}>
              <BugReportOutlinedIcon color="disabled" />
              <Typography variant="body2" color="text.secondary">
                没有符合条件的系统报错
              </Typography>
            </Stack>
          ) : (
            rows.map((row) => (
              <Stack
                key={row.id}
                component="button"
                onClick={() => setOpenReferenceId(row.referenceId)}
                sx={{
                  width: "100%",
                  border: 0,
                  bgcolor: "background.paper",
                  color: "text.primary",
                  textAlign: "left",
                  cursor: "pointer",
                  py: 1.5,
                  px: 2,
                  gap: 0.5,
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
                    {row.operation ?? row.source}
                  </Typography>
                  <Box sx={{ ml: 1, flexShrink: 0 }}>
                    <CategoryChip category={row.category} label={row.categoryLabel} />
                  </Box>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                  {row.summary}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ ...monoSx, overflowWrap: "anywhere" }}>
                  {row.referenceId}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatTime(row.createdAt)}
                  {row.occurrenceCount > 1 ? ` · 发生 ${row.occurrenceCount} 次` : ""}
                </Typography>
              </Stack>
            ))
          )}

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
                onClick={() => setPagination((prev) => ({ ...prev, page: prev.page - 1 }))}
              >
                上一页
              </Button>
              <Typography variant="caption" color="text.secondary">
                {pagination.page + 1} / {Math.max(1, Math.ceil(total / pagination.pageSize))}
              </Typography>
              <Button
                size="small"
                disabled={(pagination.page + 1) * pagination.pageSize >= total}
                onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
              >
                下一页
              </Button>
            </Stack>
          )}
        </Stack>
      </Paper>

      <SystemErrorDrawer
        referenceId={openReferenceId}
        onSelect={setOpenReferenceId}
        onClose={() => setOpenReferenceId(null)}
      />
    </Stack>
  );
}

function SystemErrorDrawer({
  referenceId,
  onSelect,
  onClose,
}: {
  referenceId: string | null;
  onSelect: (referenceId: string) => void;
  onClose: () => void;
}) {
  const detailQuery = useQuery({
    queryKey: queryKeys.systemErrors.detail(referenceId ?? ""),
    queryFn: () =>
      staffApi<SystemErrorDetail>(
        `/api/v1/admin/system-errors/${encodeURIComponent(referenceId ?? "")}`,
      ),
    enabled: Boolean(referenceId),
  });
  const detail = detailQuery.data;

  return (
    <Drawer
      anchor="right"
      open={Boolean(referenceId)}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: "100%", sm: 560 }, maxWidth: "100%" } } }}
    >
      <Stack sx={{ height: "100%" }}>
        <Stack
          direction="row"
          sx={{ alignItems: "center", justifyContent: "space-between", px: 2.5, py: 1.5 }}
        >
          <Typography variant="h6">错误详情</Typography>
          <IconButton aria-label="关闭" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Stack>
        <Divider />
        <Box sx={{ flex: 1, overflowY: "auto", p: 2.5 }}>
          {detailQuery.isPending && referenceId ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
              <CircularProgress />
            </Box>
          ) : detailQuery.isError ? (
            <Alert severity="error">
              详情加载失败，可能已过保留期被清理，请稍后重试。
            </Alert>
          ) : detail ? (
            <Stack spacing={2.5}>
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Typography variant="body2" sx={{ ...monoSx, overflowWrap: "anywhere" }}>
                    {detail.referenceId}
                  </Typography>
                  <Tooltip title="复制错误编号">
                    <IconButton
                      size="small"
                      aria-label="复制错误编号"
                      onClick={() => copyText(detail.referenceId)}
                    >
                      <ContentCopyOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                  <CategoryChip category={detail.category} label={detail.categoryLabel} />
                  {detail.occurrenceCount > 1 ? (
                    <Chip size="small" label={`发生 ${detail.occurrenceCount} 次`} />
                  ) : null}
                </Stack>
                <Typography variant="body1" sx={{ overflowWrap: "anywhere" }}>
                  {detail.summary}
                </Typography>
              </Stack>

              {detail.categoryHint ? (
                <Alert severity="info" icon={false}>
                  {detail.categoryHint}
                </Alert>
              ) : null}

              <Stack spacing={1.5}>
                <DetailRow label="时间（最近一次）" value={formatTime(detail.createdAt)} />
                <DetailRow label="来源" value={detail.source} mono />
                <DetailRow label="操作" value={detail.operation} mono />
                <DetailRow
                  label="请求"
                  value={
                    detail.requestPath
                      ? `${detail.requestMethod ?? ""} ${detail.requestPath}`.trim()
                      : null
                  }
                  mono
                />
                <DetailRow label="错误类型" value={detail.errorName} mono />
                <DetailRow
                  label="操作者"
                  value={
                    detail.actorId
                      ? `${detail.actorTypeLabel}${detail.actorName ? ` · ${detail.actorName}` : ""}（${detail.actorId}）`
                      : detail.actorTypeLabel
                  }
                />
              </Stack>

              {detail.context ? (
                <JsonBlock title="业务标识" value={detail.context} />
              ) : null}
              <JsonBlock title="结构化详情（已脱敏）" value={detail.details} />

              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  同一操作最近 {detail.relatedWindowHours} 小时的同类错误
                </Typography>
                {detail.related.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                    没有其他同类错误，看起来是偶发。
                  </Typography>
                ) : (
                  <Stack divider={<Divider flexItem />} sx={{ mt: 0.75 }}>
                    {detail.related.map((item) => (
                      <Box
                        key={item.id}
                        component="button"
                        onClick={() => onSelect(item.referenceId)}
                        sx={{
                          border: 0,
                          bgcolor: "transparent",
                          color: "text.primary",
                          textAlign: "left",
                          cursor: "pointer",
                          py: 1,
                          px: 0,
                        }}
                      >
                        <Typography variant="caption" color="text.secondary">
                          {formatTime(item.createdAt)}
                        </Typography>
                        <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                          {item.summary}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ ...monoSx, overflowWrap: "anywhere" }}>
                          {item.referenceId}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                )}
              </Box>
            </Stack>
          ) : null}
        </Box>
      </Stack>
    </Drawer>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary">
        {title}
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
        {JSON.stringify(value, null, 2)}
      </Box>
    </Box>
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
        sx={{ mt: 0.25, overflowWrap: "anywhere", ...(mono ? monoSx : {}) }}
      >
        {value}
      </Typography>
    </Box>
  );
}

