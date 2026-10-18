"use client";

import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  MenuItem,
  Paper,
  Popover,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import FilterAltOutlinedIcon from "@mui/icons-material/FilterAltOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import { gridNoRowsOverlay } from "@/components/shared/data-grid-empty-overlay";
import { ErrorState } from "@/components/shared/content-state";
import { AuditEventDetailDrawer } from "@/components/staff/audit-detail-drawer";
import {
  ActorIdentity,
  AuditEmptyHint,
  AuditTimeCell,
  ResultChip,
} from "@/components/staff/audit-shared";
import { staffApi } from "@/components/staff/staff-api";
import { gridHeight, gridSx } from "@/lib/data-grid-styles";
import { queryKeys } from "@/lib/query-keys";
import {
  auditCategoryOptions,
  auditCategoryLabel,
} from "@/modules/audit/audit-presentation";
import type {
  AuditCategoryKey,
  AuditFacets,
  AuditLogRow,
  AuditRange,
} from "@/modules/audit/audit-types";

type AuditPage = {
  rows: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
};

const emptyFilters = {
  category: "" as AuditCategoryKey | "",
  actorId: "",
  result: "",
  action: "",
  resourceType: "",
};

const noRows = gridNoRowsOverlay("没有符合条件的操作记录", <HistoryOutlinedIcon />);

function statusColorForResult(result: string) {
  if (result === "SUCCESS") return "success.main";
  if (result === "FAILURE" || result === "FAILED") return "error.main";
  if (result === "DENIED") return "warning.main";
  return "text.secondary";
}

function ObjectCell({ row }: { row: AuditLogRow }) {
  if (!row.object && !row.scope) {
    return (
      <Typography variant="caption" color="text.disabled">
        —
      </Typography>
    );
  }
  if (!row.object && row.scope) {
    return (
      <Stack spacing={0.25} sx={{ minWidth: 0 }}>
        <Typography variant="body2" noWrap>
          {row.scope.label}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          所属{row.scope.typeLabel}
        </Typography>
      </Stack>
    );
  }
  return (
    <Stack spacing={0.25} sx={{ minWidth: 0 }}>
      {row.object!.href ? (
        <Typography
          component="a"
          href={row.object!.href}
          variant="body2"
          noWrap
          onClick={(event) => event.stopPropagation()}
          sx={{
            color: "primary.main",
            textDecoration: "none",
            "&:hover": { textDecoration: "underline" },
          }}
        >
          {row.object!.label}
        </Typography>
      ) : (
        <Typography variant="body2" noWrap>
          {row.object!.label}
        </Typography>
      )}
      {row.scope && row.scope.label !== row.object!.label ? (
        <Typography variant="caption" color="text.secondary" noWrap>
          {row.scope.typeLabel} · {row.scope.label}
        </Typography>
      ) : (
        <Typography variant="caption" color="text.secondary" noWrap>
          {row.object!.typeLabel}
        </Typography>
      )}
    </Stack>
  );
}
export function AuditEventPanel({ range }: { range: AuditRange }) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(emptyFilters);
  const [pagination, setPagination] = useState({ page: 0, pageSize: 25 });
  const [detail, setDetail] = useState<AuditLogRow | null>(null);
  const [advancedAnchor, setAdvancedAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPagination((current) => ({ ...current, page: 0 }));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const facetsQuery = useQuery({
    queryKey: queryKeys.auditLogs.facets,
    queryFn: () => staffApi<AuditFacets>("/api/v1/admin/audit-logs/facets"),
    staleTime: 5 * 60_000,
  });
  const facets = facetsQuery.data;

  const filterQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (filters.category) params.set("category", filters.category);
    if (filters.actorId) params.set("actorId", filters.actorId);
    if (filters.result) params.set("result", filters.result);
    if (filters.action) params.set("action", filters.action);
    if (filters.resourceType) params.set("resourceType", filters.resourceType);
    return params;
  }, [search, filters]);

  const requestQuery = useMemo(() => {
    const params = new URLSearchParams(filterQuery);
    params.set("from", range.from);
    params.set("to", range.to);
    params.set("page", String(pagination.page));
    params.set("pageSize", String(pagination.pageSize));
    return params.toString();
  }, [filterQuery, range.from, range.to, pagination]);

  const query = useQuery({
    queryKey: queryKeys.auditLogs.list(requestQuery),
    queryFn: () => staffApi<AuditPage>(`/api/v1/admin/audit-logs?${requestQuery}`),
    placeholderData: keepPreviousData,
  });

  const actorOptions = facets?.actors ?? [];
  const selectedActor =
    actorOptions.find((option) => option.value === filters.actorId) ?? null;
  const advancedCount = [filters.action, filters.resourceType].filter(Boolean).length;
  const filtersDirty =
    Boolean(search) || Object.values(filters).some(Boolean);
  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;

  function update<K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPagination((current) => ({ ...current, page: 0 }));
  }

  function reset() {
    setSearchInput("");
    setSearch("");
    setFilters(emptyFilters);
    setPagination((current) => ({ ...current, page: 0 }));
  }

  const columns = useMemo<GridColDef<AuditLogRow>[]>(
    () => [
      {
        field: "createdAt",
        headerName: "时间",
        minWidth: 150,
        flex: 0.7,
        renderCell: ({ row }) => <AuditTimeCell iso={row.createdAt} />,
      },
      {
        field: "actor",
        headerName: "谁",
        minWidth: 190,
        flex: 1,
        sortable: false,
        renderCell: ({ row }) => <ActorIdentity actor={row.actor} />,
      },
      {
        field: "summary",
        headerName: "做了什么",
        minWidth: 320,
        flex: 2.4,
        sortable: false,
        renderCell: ({ row }) => (
          <Stack spacing={0.25} sx={{ minWidth: 0, py: 0.25 }}>
            <Typography
              variant="body2"
              sx={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                lineHeight: 1.45,
              }}
            >
              {row.summary}
            </Typography>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
              <Box
                component="span"
                sx={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  bgcolor: statusColorForResult(row.result),
                  flexShrink: 0,
                }}
              />
              <Typography variant="caption" color="text.secondary" noWrap>
                {row.categoryLabel}
                {row.changes.length > 0
                  ? ` · ${row.changes.map((change) => change.label).join("、")}`
                  : ""}
              </Typography>
            </Stack>
          </Stack>
        ),
      },
      {
        field: "object",
        headerName: "对象",
        minWidth: 200,
        flex: 1.1,
        sortable: false,
        renderCell: ({ row }) => <ObjectCell row={row} />,
      },
      {
        field: "result",
        headerName: "结果",
        width: 92,
        sortable: false,
        renderCell: ({ row }) => <ResultChip result={row.result} label={row.resultLabel} />,
      },
    ],
    [],
  );

  return (
    <Stack spacing={2.5}>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2 } }}>
        <Stack
          direction={{ xs: "column", lg: "row" }}
          spacing={1.25}
          sx={{ alignItems: { xs: "stretch", lg: "center" } }}
        >
          <TextField
            label="搜索姓名 / 邮箱 / 单号 / IP"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            size="small"
            sx={{ flex: { xs: "0 0 auto", lg: "1 1 260px" }, minWidth: { xs: 0, lg: 200 } }}
          />
          <TextField
            select
            label="操作类型"
            value={filters.category}
            onChange={(event) =>
              update("category", event.target.value as AuditCategoryKey | "")
            }
            size="small"
            sx={{ flex: { xs: "0 0 auto", lg: "0 1 170px" }, minWidth: { xs: 0, lg: 150 } }}
          >
            <MenuItem value="">全部</MenuItem>
            {auditCategoryOptions.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <Autocomplete
            size="small"
            options={actorOptions}
            value={selectedActor}
            onChange={(_event, next) => update("actorId", next?.value ?? "")}
            getOptionLabel={(option) => option.label}
            isOptionEqualToValue={(left, right) => left.value === right.value}
            renderOption={(props, option) => (
              <li {...props}>
                <Stack spacing={0.15}>
                  <Typography variant="body2">{option.label}</Typography>
                  {option.secondary ? (
                    <Typography variant="caption" color="text.secondary">
                      {option.secondary}
                    </Typography>
                  ) : null}
                </Stack>
              </li>
            )}
            renderInput={(params) => (
              <TextField {...params} label="执行人" placeholder="全部人员" />
            )}
            sx={{ flex: { xs: "0 0 auto", lg: "0 1 210px" }, minWidth: { xs: 0, lg: 180 } }}
          />
          <TextField
            select
            label="结果"
            value={filters.result}
            onChange={(event) => update("result", event.target.value)}
            size="small"
            sx={{ flex: { xs: "0 0 auto", lg: "0 1 120px" }, minWidth: { xs: 0, lg: 110 } }}
          >
            <MenuItem value="">全部</MenuItem>
            {(facets?.resultOptions ?? []).map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<FilterAltOutlinedIcon />}
            onClick={(event) => setAdvancedAnchor(event.currentTarget)}
            sx={{ flexShrink: 0 }}
          >
            更多筛选{advancedCount > 0 ? `（${advancedCount}）` : ""}
          </Button>
          {filtersDirty ? (
            <Button color="inherit" onClick={reset} sx={{ flexShrink: 0 }}>
              重置
            </Button>
          ) : null}
        </Stack>

        {filtersDirty ? (
          <Stack
            direction="row"
            spacing={1}
            sx={{ mt: 1.5, flexWrap: "wrap", gap: 1 }}
          >
            {search ? (
              <Chip
                size="small"
                label={`搜索：${search}`}
                onDelete={() => {
                  setSearchInput("");
                  setSearch("");
                  setPagination((current) => ({ ...current, page: 0 }));
                }}
              />
            ) : null}
            {filters.category ? (
              <Chip
                size="small"
                label={`类型：${auditCategoryLabel(filters.category)}`}
                onDelete={() => update("category", "")}
              />
            ) : null}
            {filters.actorId ? (
              <Chip
                size="small"
                label={`执行人：${selectedActor?.label ?? filters.actorId}`}
                onDelete={() => update("actorId", "")}
              />
            ) : null}
            {filters.result ? (
              <Chip
                size="small"
                label={`结果：${
                  (facets?.resultOptions ?? []).find(
                    (option) => option.value === filters.result,
                  )?.label ?? filters.result
                }`}
                onDelete={() => update("result", "")}
              />
            ) : null}
            {filters.action ? (
              <Chip
                size="small"
                label={`具体操作：${
                  (facets?.actionOptions ?? []).find(
                    (option) => option.value === filters.action,
                  )?.label ?? filters.action
                }`}
                onDelete={() => update("action", "")}
              />
            ) : null}
            {filters.resourceType ? (
              <Chip
                size="small"
                label={`资源：${
                  (facets?.resourceTypeOptions ?? []).find(
                    (option) => option.value === filters.resourceType,
                  )?.label ?? filters.resourceType
                }`}
                onDelete={() => update("resourceType", "")}
              />
            ) : null}
          </Stack>
        ) : null}
      </Paper>

      <Popover
        open={Boolean(advancedAnchor)}
        anchorEl={advancedAnchor}
        onClose={() => setAdvancedAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { sx: { width: 360, maxWidth: "calc(100vw - 32px)", p: 2 } } }}
      >
        <Stack spacing={1.5}>
          <Typography variant="h3">更多筛选</Typography>
          <TextField
            select
            label="具体操作"
            value={filters.action}
            onChange={(event) => update("action", event.target.value)}
            size="small"
            fullWidth
            helperText="按动作码精确筛选，日常建议用「操作类型」"
          >
            <MenuItem value="">全部操作</MenuItem>
            {(facets?.actionOptions ?? []).map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="资源类型"
            value={filters.resourceType}
            onChange={(event) => update("resourceType", event.target.value)}
            size="small"
            fullWidth
          >
            <MenuItem value="">全部资源</MenuItem>
            {(facets?.resourceTypeOptions ?? []).map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
            <Button
              size="small"
              color="inherit"
              onClick={() => {
                update("action", "");
                update("resourceType", "");
              }}
            >
              清除
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={() => setAdvancedAnchor(null)}
            >
              完成
            </Button>
          </Stack>
        </Stack>
      </Popover>

      {query.isError ? (
        <ErrorState
          message="操作记录加载失败，请稍后重试。"
          onRetry={() => void query.refetch()}
        />
      ) : null}

      <Paper variant="outlined" sx={{ p: 0 }}>
        <Stack
          direction="row"
          sx={{
            alignItems: "center",
            justifyContent: "space-between",
            px: 2,
            py: 1.25,
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <Typography variant="body2" color="text.secondary">
            共 {total} 条
            {query.isFetching && !query.isPending ? " · 正在刷新" : ""}
          </Typography>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
            {query.isFetching && !query.isPending ? (
              <CircularProgress size={14} sx={{ mr: 0.5 }} />
            ) : null}
            <Tooltip title="刷新">
              <IconButton size="small" aria-label="刷新" onClick={() => void query.refetch()}>
                <RefreshOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>

        <Box sx={{ width: "100%", display: { xs: "none", md: "block" } }}>
          <DataGrid
            aria-label="操作记录"
            rows={rows}
            columns={columns}
            loading={query.isPending}
            rowCount={total}
            paginationMode="server"
            paginationModel={pagination}
            onPaginationModelChange={setPagination}
            pageSizeOptions={[25, 50, 100]}
            disableColumnFilter
            disableColumnSorting
            disableRowSelectionOnClick
            getRowHeight={() => 68}
            onRowClick={({ row }) => setDetail(row)}
            slots={{ noRowsOverlay: noRows }}
            sx={{
              ...gridSx,
              height: rows.length > 0 ? gridHeight(rows.length, 68) : 420,
              "& .MuiDataGrid-row": { cursor: "pointer" },
            }}
          />
        </Box>

        <Stack sx={{ display: { xs: "flex", md: "none" } }}>
          {query.isPending ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
              <CircularProgress />
            </Box>
          ) : rows.length === 0 ? (
            <AuditEmptyHint onReset={filtersDirty ? reset : undefined} />
          ) : (
            rows.map((row) => (
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
                  gap: 0.75,
                  borderBottom: "1px solid",
                  borderColor: "divider",
                  "&:last-child": { borderBottom: 0 },
                }}
              >
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ justifyContent: "space-between", alignItems: "center" }}
                >
                  <AuditTimeCell iso={row.createdAt} />
                  <ResultChip result={row.result} label={row.resultLabel} />
                </Stack>
                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                  {row.summary}
                </Typography>
                <ActorIdentity actor={row.actor} showEmail={false} />
                {row.object ? (
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {row.object.typeLabel} · {row.object.label}
                  </Typography>
                ) : null}
              </Stack>
            ))
          )}

          {rows.length > 0 ? (
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
                第 {pagination.page + 1} / {Math.max(1, Math.ceil(total / pagination.pageSize))} 页 ·
                共 {total} 条
              </Typography>
              <Button
                size="small"
                disabled={(pagination.page + 1) * pagination.pageSize >= total}
                onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
              >
                下一页
              </Button>
            </Stack>
          ) : null}
        </Stack>
      </Paper>

      <AuditEventDetailDrawer row={detail} onClose={() => setDetail(null)} />
    </Stack>
  );
}
